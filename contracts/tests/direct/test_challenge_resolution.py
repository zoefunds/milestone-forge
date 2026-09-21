"""Tests for the challenge/dispute resolution correctness fixes:

1. A challenge must be bound to one specific pinned criterion — you cannot
   dispute "the milestone" in general.
2. Additive evidence can only corroborate a failure when it verifiably
   references the SAME criterion's own artifact anchor (its URL/repo/
   contract address) — a page that merely contains a generic failure
   keyword, with no connection to the disputed criterion, can never
   overturn a result.
3. A challenge against one criterion of a PARTIAL_PASS milestone is decided
   on that criterion alone, not by requiring every other (already-failing)
   criterion to newly pass too — the old "full re-pass or uphold" standard
   made every challenge against a partial-pass milestone auto-succeed
   regardless of evidence relevance.
"""

import json


def _hex(addr_bytes: bytes) -> str:
    return "0x" + addr_bytes.hex()


def _create_two_criteria_grant(contract, direct_vm, funder, grantee):
    """One milestone, two 50/50-weighted HTTP criteria: A always passes,
    B always fails. Claiming it should land on PARTIAL_PASS."""
    direct_vm.sender = funder
    direct_vm.value = 10 * 10**18
    spec = [
        {
            "title": "Two-criteria milestone",
            "reward_wei": "10000000000000000000",
            "challenge_window_seconds": 86400,
            "claimable_after": 0,
            "criteria": [
                {
                    "criterion_type": "HTTP_ENDPOINT",
                    "description": "Criterion A: passing endpoint returns HTTP 200",
                    "weight_bps": 5000,
                    "target_url": "https://httpbin.org/status/200",
                    "expected_status_min": 200,
                    "expected_status_max": 299,
                    "expected_body_contains": "",
                },
                {
                    "criterion_type": "HTTP_ENDPOINT",
                    "description": "Criterion B: failing endpoint returns HTTP 200",
                    "weight_bps": 5000,
                    "target_url": "https://httpbin.org/status/500",
                    "expected_status_min": 200,
                    "expected_status_max": 299,
                    "expected_body_contains": "",
                },
            ],
        }
    ]
    grant_id = contract.create_grant(_hex(grantee), "Two-Criteria Grant", json.dumps(spec))
    direct_vm.value = 0

    grant = contract.get_grant(grant_id)
    milestone_id = grant["milestone_ids"][0]

    direct_vm.mock_web(r"httpbin\.org/status/200", {"status": 200, "body": ""})
    direct_vm.mock_web(r"httpbin\.org/status/500", {"status": 500, "body": ""})
    direct_vm.sender = grantee
    contract.submit_milestone_claim(milestone_id, "")

    return grant_id, milestone_id


def _file_challenge(contract, direct_vm, challenger, milestone_id, criterion_id, evidence_url):
    direct_vm.sender = challenger
    direct_vm.value = 2500 * 10**18
    challenge_id = contract.file_challenge(milestone_id, criterion_id, "downtime", evidence_url, "test note")
    direct_vm.value = 0
    return challenge_id


def test_challenge_must_reference_a_real_criterion_of_the_milestone(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)
    _grant_id, milestone_id = _create_two_criteria_grant(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_charlie
    direct_vm.value = 2500 * 10**18
    with direct_vm.expect_revert():
        contract.file_challenge(milestone_id, "crit-does-not-exist", "downtime", "https://example.com/x", "note")


def test_partial_pass_milestone_unrelated_generic_evidence_does_not_uphold(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """The milestone is PARTIAL_PASS (criterion A passes, B fails). A
    challenger disputes the ALREADY-PASSING criterion A with evidence that
    contains a generic failure keyword but never mentions A's own URL. This
    must be REJECTED — the old logic required the ENTIRE milestone to newly
    re-pass 100% to reject a challenge, which is nonsensical for a milestone
    that's already only PARTIAL_PASS (criterion B was always going to keep
    failing), and it let totally unrelated "evidence" win by default.
    """
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)
    _grant_id, milestone_id = _create_two_criteria_grant(contract, direct_vm, direct_alice, direct_bob)

    milestone = contract.get_milestone(milestone_id)
    assert milestone["verdict"] == "PARTIAL_PASS"
    criterion_a_id = milestone["criteria_ids"][0]  # the passing one

    # Evidence page is reachable and contains a generic failure word, but
    # does NOT reference criterion A's target_url anywhere — unbound.
    direct_vm.mock_web(
        r"example\.com/unrelated-incident-report",
        {"status": 200, "body": "Our service experienced a major outage and error today."},
    )
    challenge_id = _file_challenge(
        contract, direct_vm, direct_charlie, milestone_id, criterion_a_id,
        "https://example.com/unrelated-incident-report",
    )

    direct_vm.sender = direct_charlie
    status = contract.resolve_challenge(challenge_id)

    assert status == "REJECTED"
    challenge = contract.get_challenge(challenge_id)
    assert challenge["status"] == "REJECTED"
    # Milestone must return to CHALLENGE_WINDOW, untouched, with its
    # original PARTIAL_PASS payout still standing.
    milestone = contract.get_milestone(milestone_id)
    assert milestone["status"] == "CHALLENGE_WINDOW"
    assert milestone["verdict"] == "PARTIAL_PASS"
    assert milestone["recommended_payout_bps"] == 5000


def test_bound_evidence_referencing_the_disputed_criterion_upholds(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """Same PARTIAL_PASS setup, but this time the evidence page explicitly
    references criterion A's own target_url AND contains a failure keyword
    — genuinely bound, verifiable evidence. This should UPHOLD even though
    criterion A's live re-check still happens to return 200 (the evidence
    is what independently corroborates a failure during the actual disputed
    window, e.g. an archival log of downtime that isn't visible right now).
    """
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)
    _grant_id, milestone_id = _create_two_criteria_grant(contract, direct_vm, direct_alice, direct_bob)

    milestone = contract.get_milestone(milestone_id)
    criterion_a_id = milestone["criteria_ids"][0]

    direct_vm.mock_web(
        r"example\.com/archival-downtime-log",
        {
            "status": 200,
            "body": "Archival uptime monitor log: https://httpbin.org/status/200 was down and returned error "
            "responses during the evaluation window.",
        },
    )
    challenge_id = _file_challenge(
        contract, direct_vm, direct_charlie, milestone_id, criterion_a_id,
        "https://example.com/archival-downtime-log",
    )

    direct_vm.sender = direct_charlie
    status = contract.resolve_challenge(challenge_id)

    assert status == "UPHELD"
    milestone = contract.get_milestone(milestone_id)
    assert milestone["status"] == "FAILED"
    # Settlement correctness, not just the status label: exactly the
    # upheld_bounty_bps share (20% as configured at deploy) leaves the
    # reward escrow to the challenger as a bounty; the remaining 80% stays
    # in reward_deposited (the funder claims it back via
    # claim_failed_milestone_refund, not lost) — and the challenge's own
    # bond ledger is zeroed, proving the zero-then-transfer `_send_gen`
    # path actually executed for both halves of the payout rather than
    # just the verdict flag changing.
    assert milestone["recommended_payout_bps"] == 0
    reward_wei = 10 * 10**18
    expected_bounty = reward_wei * 2000 // 10000  # 20% upheld_bounty_bps
    assert milestone["reward_deposited"] == str(reward_wei - expected_bounty)
    challenge = contract.get_challenge(challenge_id)
    assert challenge["bond_deposited"] == "0"
    assert challenge["status"] == "UPHELD"

    # And the funder can now pull back what's left of the escrow.
    direct_vm.sender = direct_alice
    contract.claim_failed_milestone_refund(milestone_id)
    milestone = contract.get_milestone(milestone_id)
    assert milestone["reward_deposited"] == "0"


def test_criterion_that_now_fails_on_recheck_upholds_without_needing_evidence(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """If the disputed criterion itself now independently fails on
    re-inspection (e.g. the endpoint really did go down), the challenge is
    upheld regardless of the evidence page's content — an honest re-check
    flip is sufficient on its own.
    """
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)
    _grant_id, milestone_id = _create_two_criteria_grant(contract, direct_vm, direct_alice, direct_bob)

    milestone = contract.get_milestone(milestone_id)
    criterion_a_id = milestone["criteria_ids"][0]

    # Criterion A's endpoint has since gone down for real.
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"httpbin\.org/status/200", {"status": 503, "body": ""})
    direct_vm.mock_web(r"httpbin\.org/status/500", {"status": 500, "body": ""})
    direct_vm.mock_web(r"example\.com/no-info", {"status": 200, "body": "nothing relevant here"})

    challenge_id = _file_challenge(
        contract, direct_vm, direct_charlie, milestone_id, criterion_a_id, "https://example.com/no-info"
    )

    direct_vm.sender = direct_charlie
    status = contract.resolve_challenge(challenge_id)

    assert status == "UPHELD"
    milestone = contract.get_milestone(milestone_id)
    assert milestone["status"] == "FAILED"
    reward_wei = 10 * 10**18
    expected_bounty = reward_wei * 2000 // 10000
    assert milestone["reward_deposited"] == str(reward_wei - expected_bounty)
    challenge = contract.get_challenge(challenge_id)
    assert challenge["bond_deposited"] == "0"


def test_rejected_challenger_bond_is_slashed_to_grantee(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)
    _grant_id, milestone_id = _create_two_criteria_grant(contract, direct_vm, direct_alice, direct_bob)

    milestone = contract.get_milestone(milestone_id)
    criterion_a_id = milestone["criteria_ids"][0]

    direct_vm.mock_web(r"example\.com/irrelevant", {"status": 200, "body": "irrelevant content"})
    challenge_id = _file_challenge(
        contract, direct_vm, direct_charlie, milestone_id, criterion_a_id, "https://example.com/irrelevant"
    )

    direct_vm.sender = direct_charlie
    status = contract.resolve_challenge(challenge_id)
    assert status == "REJECTED"

    challenge = contract.get_challenge(challenge_id)
    # 100% frivolous_slash_bps (as configured at deploy) — bond fully gone,
    # none refunded to the challenger.
    assert challenge["bond_deposited"] == "0"

import json


def _hex(addr_bytes: bytes) -> str:
    return "0x" + addr_bytes.hex()


def _create_and_claim(contract, direct_vm, funder, grantee, challenge_window_seconds=86400):
    direct_vm.sender = funder
    direct_vm.value = 10 * 10**18
    spec = [
        {
            "title": "Health check test",
            "reward_wei": "10000000000000000000",
            "challenge_window_seconds": challenge_window_seconds,
            "claimable_after": 0,
            "criteria": [
                {
                    "criterion_type": "HTTP_ENDPOINT",
                    "description": "The live URL returns HTTP 200",
                    "weight_bps": 10000,
                    "target_url": "https://httpbin.org/status/200",
                    "expected_status_min": 200,
                    "expected_status_max": 299,
                    "expected_body_contains": "",
                }
            ],
        }
    ]
    grant_id = contract.create_grant(_hex(grantee), "Test Grant 1", json.dumps(spec))
    direct_vm.value = 0

    grant = contract.get_grant(grant_id)
    milestone_id = grant["milestone_ids"][0]

    direct_vm.mock_web(r"httpbin\.org/status/200", {"status": 200, "body": ""})
    direct_vm.sender = grantee
    contract.submit_milestone_claim(milestone_id, "")

    return grant_id, milestone_id


def test_release_before_window_closes_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)

    _grant_id, milestone_id = _create_and_claim(contract, direct_vm, direct_alice, direct_bob)

    milestone = contract.get_milestone(milestone_id)
    assert milestone["status"] == "CHALLENGE_WINDOW"
    assert milestone["challenge_window_closes_at"] > milestone["challenge_window_opens_at"]

    with direct_vm.expect_revert():
        contract.release_milestone(milestone_id)

    # Escrow must still be fully intact — the revert must not have moved funds.
    milestone = contract.get_milestone(milestone_id)
    assert milestone["reward_deposited"] == milestone["reward_wei"]
    assert milestone["status"] == "CHALLENGE_WINDOW"


# NOTE: There is no test here for "release succeeds after the window
# elapses." gltest's direct-mode `direct_vm.warp()` updates sender/origin
# in the cached `gl.message_raw` dict but does NOT update the `datetime`
# key (see `gltest/direct/vm.py::VMContext._refresh_gl_message`), so
# `_current_timestamp()` never observes the warped time in direct mode —
# this is a test-harness limitation, not a contract bug. In real GenVM,
# every call is a fresh process that reads current wall-clock time from
# stdin, so `_current_timestamp()` behaves correctly in production. This
# path should be covered by an integration test against a real/local
# StudioNet-equivalent node instead, where time actually advances.


def test_challenge_bond_mismatch_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)

    _grant_id, milestone_id = _create_and_claim(contract, direct_vm, direct_alice, direct_bob)
    criterion_id = contract.get_milestone(milestone_id)["criteria_ids"][0]

    direct_vm.sender = direct_charlie
    direct_vm.value = 1 * 10**18  # wrong bond amount, should be 2500 GEN
    with direct_vm.expect_revert():
        contract.file_challenge(milestone_id, criterion_id, "downtime", "https://example.com/evidence", "note")

import json


def _hex(addr_bytes: bytes) -> str:
    return "0x" + addr_bytes.hex()


def _create_test_grant(contract, direct_vm, funder, grantee):
    direct_vm.sender = funder
    direct_vm.value = 10 * 10**18
    spec = [
        {
            "title": "Health check test",
            "reward_wei": "10000000000000000000",
            "challenge_window_seconds": 86400,
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
    return grant_id


def test_submit_claim_passes_and_opens_challenge_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)

    grant_id = _create_test_grant(contract, direct_vm, direct_alice, direct_bob)
    grant = contract.get_grant(grant_id)
    milestone_id = grant["milestone_ids"][0]

    direct_vm.mock_web(
        r"httpbin\.org/status/200",
        {"status": 200, "body": ""},
    )

    direct_vm.sender = direct_bob
    contract.submit_milestone_claim(milestone_id, "")

    milestone = contract.get_milestone(milestone_id)
    assert milestone["verdict"] == "PASSED"
    assert milestone["status"] == "CHALLENGE_WINDOW"
    assert milestone["recommended_payout_bps"] == 10000
    assert len(milestone["result_ids"]) == 1

    result = contract.get_criterion_result(milestone["result_ids"][0])
    assert result["passed"] is True


def test_submit_claim_from_non_grantee_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/milestone_forge.py", "2500000000000000000000", 10000, 2000)

    grant_id = _create_test_grant(contract, direct_vm, direct_alice, direct_bob)
    grant = contract.get_grant(grant_id)
    milestone_id = grant["milestone_ids"][0]

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert():
        contract.submit_milestone_claim(milestone_id, "")

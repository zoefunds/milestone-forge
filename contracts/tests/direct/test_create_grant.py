import json


def _hex(addr_bytes: bytes) -> str:
    return "0x" + addr_bytes.hex()


def test_create_grant_single_milestone(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(
        "contracts/milestone_forge.py",
        "2500000000000000000000", 10000, 2000,
    )

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

    grant_id = contract.create_grant(_hex(direct_bob), "Test Grant 1", json.dumps(spec))
    assert grant_id

    grant = contract.get_grant(grant_id)
    assert grant["funder"].lower() == _hex(direct_alice).lower()
    assert grant["grantee"].lower() == _hex(direct_bob).lower()
    assert grant["status"] == "ACTIVE"
    assert len(grant["milestone_ids"]) == 1

    milestone = contract.get_milestone(grant["milestone_ids"][0])
    assert milestone["status"] == "CLAIMABLE"
    assert milestone["reward_wei"] == "10000000000000000000"


def test_update_protocol_params(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(
        "contracts/milestone_forge.py",
        "2500000000000000000000", 10000, 10000,
    )

    contract.update_protocol_params("2500000000000000000000", 10000, 2000)

    params = contract.get_protocol_params()
    assert params["upheld_bounty_bps"] == 2000

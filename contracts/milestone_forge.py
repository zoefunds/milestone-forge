# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#
# ============================================================================
# MILESTONE FORGE — Autonomous Grant / Milestone-Release Protocol
# ============================================================================
#
# "Fund the milestone, not the promise. Let the public record decide when
#  it's actually done."
#
# Trust boundary (see project README, section 7):
#   - Milestone completion criteria + artifact locations are fixed at grant
#     creation, before any claim exists.
#   - At claim time, the exact artifact snapshot being evaluated is pinned
#     on-chain BEFORE any validator evaluation begins.
#   - Each validator independently fetches/inspects the pinned artifacts
#     itself (gl.nondet.web) — a grantee-supplied screenshot, self-reported
#     hash, or pre-fetched content is never trusted as evidence.
#   - The Equivalence Principle compares a STRUCTURED per-criterion boolean
#     result (partial field matching + numeric tolerance), never raw prose,
#     and never a format/JSON-schema-only check.
#   - The nondeterministic step outputs ONLY the structured determination.
#     A fully separate DETERMINISTIC function computes the tranche payout.
#     Validators/LLMs never touch the money transfer directly.
#   - Disagreement beyond tolerance, or an unreachable artifact, resolves to
#     an explicit INCONCLUSIVE state — never a silently-picked value, never
#     a default "release funds".
#   - A challenge window follows every PASSED/PARTIAL_PASS verdict. Challenges
#     may only ADD artifact evidence — never replace or remove the pinned
#     genesis criteria or artifact locations. Funds are not withdrawable
#     until the window closes with zero pending disputes.
#
# Escrow custody / emission pattern (verified against the ShipBond reference
# and GenLayer value-transfer docs):
#   - Every GEN payout funnels through the single `_send_gen` helper.
#   - `reward_wei` / `bond_wei` are AGREED TERMS. `reward_deposited` /
#     `bond_deposited` are the ACTUAL ESCROW LEDGER — the only fields payout
#     logic ever reads from.
#   - Every payout path zeroes the ledger field(s) BEFORE calling _send_gen,
#     and persists state before the transfer — zero-then-transfer, no
#     reentrancy window, no double-spend.
#
# ============================================================================

from genlayer import *
from dataclasses import dataclass
import json
import typing

# ----------------------------------------------------------------------------
# Error classification prefixes (see genlayer-dev:write-contract skill).
# Deterministic errors (EXPECTED / EXTERNAL) must match exactly between
# leader and validator. TRANSIENT errors only need to agree that *a*
# transient failure occurred. LLM_ERROR always forces disagreement (and
# therefore consensus retry / leader rotation) rather than silently
# accepting garbage.
# ----------------------------------------------------------------------------
ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

# ----------------------------------------------------------------------------
# Grant / milestone lifecycle states
# ----------------------------------------------------------------------------
GRANT_STATUS_ACTIVE = "ACTIVE"
GRANT_STATUS_CANCELLED = "CANCELLED"
GRANT_STATUS_COMPLETED = "COMPLETED"

MILESTONE_STATUS_LOCKED = "LOCKED"  # waiting on prior milestone / not yet claimable
MILESTONE_STATUS_CLAIMABLE = "CLAIMABLE"  # can be claimed by grantee
MILESTONE_STATUS_EVALUATING = "EVALUATING"  # claim submitted, awaiting consensus
MILESTONE_STATUS_CHALLENGE_WINDOW = "CHALLENGE_WINDOW"
MILESTONE_STATUS_DISPUTED = "DISPUTED"  # a challenge is pending re-evaluation
MILESTONE_STATUS_RELEASED = "RELEASED"
MILESTONE_STATUS_FAILED = "FAILED"
MILESTONE_STATUS_INCONCLUSIVE = "INCONCLUSIVE"  # artifact unreachable / ambiguous
MILESTONE_STATUS_CANCELLED = "CANCELLED"

VERDICT_PASSED = "PASSED"
VERDICT_FAILED = "FAILED"
VERDICT_PARTIAL_PASS = "PARTIAL_PASS"
VERDICT_INCONCLUSIVE = "INCONCLUSIVE"

CRITERION_TYPE_HTTP = "HTTP_ENDPOINT"
CRITERION_TYPE_GIT = "GIT_REPO_STATE"
CRITERION_TYPE_ONCHAIN = "ONCHAIN_STATE"

VALID_CRITERION_TYPES = (CRITERION_TYPE_HTTP, CRITERION_TYPE_GIT, CRITERION_TYPE_ONCHAIN)

CHALLENGE_STATUS_PENDING = "PENDING"
CHALLENGE_STATUS_UPHELD = "UPHELD"
CHALLENGE_STATUS_REJECTED = "REJECTED"

MIN_CHALLENGE_WINDOW_SECONDS = u256(24 * 3600)
MAX_CHALLENGE_WINDOW_SECONDS = u256(168 * 3600)
DEFAULT_CHALLENGE_WINDOW_SECONDS = u256(48 * 3600)

BASIS_POINTS_DENOMINATOR = u256(10000)

# Minimum non-checkable-phrase denylist. Grant creation criteria descriptions
# containing these fragments (case-insensitive) are rejected outright — they
# are the canonical examples of vague, non-machine-checkable criteria this
# protocol exists to eliminate.
_VAGUE_CRITERIA_PATTERNS = (
    "good progress",
    "good faith",
    "reasonable effort",
    "best effort",
    "looks good",
    "make progress",
    "general improvement",
    "as needed",
    "tbd",
    "to be determined",
)


# ----------------------------------------------------------------------------
# Value-transfer plumbing
# ----------------------------------------------------------------------------
@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


def _send_gen(to_address: Address, amount: u256) -> None:
    """Single emission choke-point for every GEN payout in this contract.

    Every path that releases funds MUST: (1) read the ledger field(s) into
    locals, (2) zero the ledger field(s), (3) persist state, (4) only then
    call this function. Never call this before state is zeroed and saved.
    """
    if amount <= u256(0):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Transfer amount must be positive")
    _Recipient(to_address).emit_transfer(value=amount)


def _u256_from_str(value: str) -> u256:
    try:
        return u256(int(value))
    except (ValueError, TypeError):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Malformed numeric ledger value: {value}")


# ----------------------------------------------------------------------------
# Storage dataclasses
#
# GenVM storage does not support arbitrary nested Python dicts, so structured
# fields are persisted as JSON strings inside DynArray[str]/TreeMap[str, str]
# and cast at the boundary — per the storage rules in genlayer-dev:write-contract.
# ----------------------------------------------------------------------------
@allow_storage
@dataclass
class Criterion:
    criterion_id: str
    criterion_type: str  # one of VALID_CRITERION_TYPES
    description: str  # human-readable, machine-checkable claim
    # Location fields — only the ones relevant to criterion_type are populated,
    # the rest are empty strings. All are fixed at genesis and never mutated.
    target_url: str  # HTTP_ENDPOINT: URL to fetch
    expected_status_min: u256  # HTTP_ENDPOINT: minimum acceptable HTTP status (e.g. 200)
    expected_status_max: u256  # HTTP_ENDPOINT: maximum acceptable HTTP status (e.g. 299)
    expected_body_contains: str  # HTTP_ENDPOINT: substring/JSON-path style marker expected
    repo_url: str  # GIT_REPO_STATE: e.g. https://github.com/org/repo
    repo_ref: str  # GIT_REPO_STATE: branch/tag/commit expected to exist / be reachable
    repo_path_expected: str  # GIT_REPO_STATE: file path expected to exist at repo_ref
    onchain_rpc_url: str  # ONCHAIN_STATE: JSON-RPC endpoint to query
    onchain_contract_address: str  # ONCHAIN_STATE: target contract address
    onchain_min_block: u256  # ONCHAIN_STATE: event must occur at/after this block
    onchain_event_topic0: str  # ONCHAIN_STATE: keccak topic0 of expected event
    weight_bps: u256  # this criterion's weight toward PARTIAL_PASS payout, in basis points


@allow_storage
@dataclass
class CriterionResult:
    criterion_id: str
    passed: bool
    detail: str  # short machine-derived detail string (status code seen, block seen, etc.)


@allow_storage
@dataclass
class Milestone:
    milestone_id: str
    grant_id: str
    index: u256  # ordering index within the grant (0-based)
    title: str
    reward_wei: str  # agreed term — GEN owed on PASS, atto-scale string
    reward_deposited: str  # actual escrow ledger — atto-scale string
    status: str
    challenge_window_seconds: u256
    criteria_ids: DynArray[str]  # ordered criterion ids belonging to this milestone
    # Claim / snapshot pinning
    claim_submitted_at: u256
    claimed_artifact_hash: str  # sha256 of the concatenated pinned snapshot payload
    claim_note: str  # grantee's optional pointer (IPFS/Arweave CID) — never trusted alone
    # Evaluation outputs (nondeterministic step's ONLY output — booleans + detail)
    verdict: str
    result_ids: DynArray[str]  # CriterionResult ids for this evaluation round
    recommended_payout_bps: u256  # deterministic function's computed payout share
    evaluated_at: u256
    # Challenge window bookkeeping
    challenge_window_opens_at: u256
    challenge_window_closes_at: u256
    active_challenge_id: str  # empty string if none
    # Timeout / recovery
    claimable_after: u256  # earliest timestamp grantee may submit a claim (0 = immediately)


@allow_storage
@dataclass
class Challenge:
    challenge_id: str
    milestone_id: str
    challenger: Address
    bond_wei: str  # agreed term
    bond_deposited: str  # actual escrow ledger
    category: str  # free-form tag, e.g. "downtime", "git_rewrite", "synthetic_data"
    evidence_url: str  # ADDITIVE evidence only — never replaces pinned genesis artifacts
    evidence_note: str
    status: str  # PENDING / UPHELD / REJECTED
    filed_at: u256
    resolved_at: u256
    resolution_detail: str


@allow_storage
@dataclass
class Grant:
    grant_id: str
    funder: Address
    grantee: Address
    title: str
    total_reward_wei: str
    status: str
    created_at: u256
    milestone_ids: DynArray[str]


# ----------------------------------------------------------------------------
# The contract
# ----------------------------------------------------------------------------
class MilestoneForge(gl.Contract):
    # --- Global registries -------------------------------------------------
    grants: TreeMap[str, Grant]
    grant_order: DynArray[str]
    next_grant_seq: u256

    milestones: TreeMap[str, Milestone]
    next_milestone_seq: u256

    criteria: TreeMap[str, Criterion]
    next_criterion_seq: u256

    results: TreeMap[str, CriterionResult]
    next_result_seq: u256

    challenges: TreeMap[str, Challenge]
    challenge_order: DynArray[str]
    next_challenge_seq: u256

    # --- Protocol parameters -------------------------------------------------
    protocol_admin: Address
    default_dispute_bond_wei: str  # atto-scale string, e.g. "2500000000000000000000" for 2500 GEN
    frivolous_slash_bps: u256  # bps of a rejected challenger's bond paid to grantee
    upheld_bounty_bps: u256  # bps of the milestone's reward paid as bounty to a successful challenger

    # --- Per-account bookkeeping (defensive, for UI / audit only) ----------
    grants_by_funder: TreeMap[str, DynArray[str]]
    grants_by_grantee: TreeMap[str, DynArray[str]]

    def __init__(self, default_dispute_bond_wei: str, frivolous_slash_bps: u256, upheld_bounty_bps: u256):
        self.protocol_admin = gl.message.sender_address
        if frivolous_slash_bps > BASIS_POINTS_DENOMINATOR:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} frivolous_slash_bps must be <= 10000")
        if upheld_bounty_bps > BASIS_POINTS_DENOMINATOR:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} upheld_bounty_bps must be <= 10000")
        self.default_dispute_bond_wei = default_dispute_bond_wei
        self.frivolous_slash_bps = frivolous_slash_bps
        self.upheld_bounty_bps = upheld_bounty_bps
        self.next_grant_seq = u256(1)
        self.next_milestone_seq = u256(1)
        self.next_criterion_seq = u256(1)
        self.next_result_seq = u256(1)
        self.next_challenge_seq = u256(1)

    # ========================================================================
    # SECTION 1 — GRANT CREATION (genesis: criteria + artifact locations
    # permanently pinned here, never mutable afterward)
    # ========================================================================

    @gl.public.write.payable
    def create_grant(
        self,
        grantee_address: str,
        title: str,
        milestones_spec_json: str,
    ) -> str:
        """Create a grant with N milestones, funding the FULL total reward now.

        milestones_spec_json shape:
        [
          {
            "title": "...",
            "reward_wei": "15000000000000000000000",
            "challenge_window_seconds": 172800,
            "claimable_after": 0,
            "criteria": [
              {
                "criterion_type": "HTTP_ENDPOINT",
                "description": "Health endpoint returns 200 with operational status",
                "target_url": "https://...",
                "expected_status_min": 200,
                "expected_status_max": 299,
                "expected_body_contains": "operational",
                "weight_bps": 10000
              },
              ...
            ]
          },
          ...
        ]
        """
        funder = gl.message.sender_address
        grantee = Address(grantee_address)
        if grantee == funder:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Funder and grantee must differ")

        try:
            spec = json.loads(milestones_spec_json)
        except (ValueError, TypeError):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} milestones_spec_json is not valid JSON")

        if not isinstance(spec, list) or len(spec) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} At least one milestone is required")

        if gl.message.value <= u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Grant must be funded with GEN value")

        grant_id = f"grant-{int(self.next_grant_seq)}"
        self.next_grant_seq = self.next_grant_seq + u256(1)

        total_reward = u256(0)
        milestone_ids: DynArray[str] = DynArray[str]()

        for idx, m_spec in enumerate(spec):
            milestone_id, reward = self._create_milestone_from_spec(grant_id, u256(idx), m_spec)
            milestone_ids.append(milestone_id)
            total_reward = total_reward + reward

        if gl.message.value != total_reward:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Deposited value {int(gl.message.value)} must exactly equal "
                f"sum of milestone rewards {int(total_reward)}"
            )

        # First milestone is immediately claimable; the rest are LOCKED until
        # their predecessor is RELEASED (see _unlock_next_milestone).
        first = self.milestones[milestone_ids[0]]
        first.status = MILESTONE_STATUS_CLAIMABLE
        self.milestones[milestone_ids[0]] = first

        grant = Grant(
            grant_id=grant_id,
            funder=funder,
            grantee=grantee,
            title=title,
            total_reward_wei=str(int(total_reward)),
            status=GRANT_STATUS_ACTIVE,
            created_at=gl.message.chain_id and u256(0) or u256(0),  # placeholder, see note below
            milestone_ids=milestone_ids,
        )
        self.grants[grant_id] = grant
        self.grant_order.append(grant_id)

        self._index_grant_for_account(self.grants_by_funder, funder, grant_id)
        self._index_grant_for_account(self.grants_by_grantee, grantee, grant_id)

        gl.emit_event(
            "GrantCreated",
            {"grant_id": grant_id, "funder": funder.as_hex, "grantee": grantee.as_hex, "total_reward_wei": str(int(total_reward))},
        )
        return grant_id

    def _create_milestone_from_spec(self, grant_id: str, index: u256, m_spec: dict) -> tuple[str, u256]:
        title = str(m_spec.get("title", "")).strip()
        if not title:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone title is required")

        reward_raw = m_spec.get("reward_wei")
        if reward_raw is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone reward_wei is required")
        reward = _u256_from_str(str(reward_raw))
        if reward <= u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone reward_wei must be positive")

        window_raw = m_spec.get("challenge_window_seconds", int(DEFAULT_CHALLENGE_WINDOW_SECONDS))
        window = u256(int(window_raw))
        if window < MIN_CHALLENGE_WINDOW_SECONDS or window > MAX_CHALLENGE_WINDOW_SECONDS:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} challenge_window_seconds must be between "
                f"{int(MIN_CHALLENGE_WINDOW_SECONDS)} and {int(MAX_CHALLENGE_WINDOW_SECONDS)}"
            )

        claimable_after = u256(int(m_spec.get("claimable_after", 0)))

        criteria_list = m_spec.get("criteria")
        if not isinstance(criteria_list, list) or len(criteria_list) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone '{title}' needs at least one criterion")

        milestone_id = f"ms-{int(self.next_milestone_seq)}"
        self.next_milestone_seq = self.next_milestone_seq + u256(1)

        criteria_ids: DynArray[str] = DynArray[str]()
        weight_total = u256(0)
        for c_spec in criteria_list:
            criterion_id = self._create_criterion(milestone_id, c_spec)
            criteria_ids.append(criterion_id)
            weight_total = weight_total + self.criteria[criterion_id].weight_bps

        if weight_total != BASIS_POINTS_DENOMINATOR:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Milestone '{title}' criteria weights must sum to 10000 bps, got {int(weight_total)}"
            )

        milestone = Milestone(
            milestone_id=milestone_id,
            grant_id=grant_id,
            index=index,
            title=title,
            reward_wei=str(int(reward)),
            reward_deposited=str(int(reward)),
            status=MILESTONE_STATUS_LOCKED,
            challenge_window_seconds=window,
            criteria_ids=criteria_ids,
            claim_submitted_at=u256(0),
            claimed_artifact_hash="",
            claim_note="",
            verdict="",
            result_ids=DynArray[str](),
            recommended_payout_bps=u256(0),
            evaluated_at=u256(0),
            challenge_window_opens_at=u256(0),
            challenge_window_closes_at=u256(0),
            active_challenge_id="",
            claimable_after=claimable_after,
        )
        self.milestones[milestone_id] = milestone
        return milestone_id, reward

    def _create_criterion(self, milestone_id: str, c_spec: dict) -> str:
        c_type = str(c_spec.get("criterion_type", "")).strip()
        if c_type not in VALID_CRITERION_TYPES:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} criterion_type must be one of {VALID_CRITERION_TYPES}, got '{c_type}'"
            )

        description = str(c_spec.get("description", "")).strip()
        if len(description) < 12:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Criterion description too short to be machine-checkable: '{description}'"
            )
        lowered = description.lower()
        for phrase in _VAGUE_CRITERIA_PATTERNS:
            if phrase in lowered:
                raise gl.vm.UserError(
                    f"{ERROR_EXPECTED} Criterion description contains non-checkable phrase '{phrase}'. "
                    f"Criteria must be specific and machine-checkable, e.g. "
                    f"'the live URL at X returns HTTP 200 and body contains Y'."
                )

        weight_bps = u256(int(c_spec.get("weight_bps", 0)))
        if weight_bps <= u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Criterion weight_bps must be positive")

        criterion_id = f"crit-{int(self.next_criterion_seq)}"
        self.next_criterion_seq = self.next_criterion_seq + u256(1)

        if c_type == CRITERION_TYPE_HTTP:
            target_url = str(c_spec.get("target_url", "")).strip()
            self._assert_safe_public_url(target_url)
            criterion = Criterion(
                criterion_id=criterion_id,
                criterion_type=c_type,
                description=description,
                target_url=target_url,
                expected_status_min=u256(int(c_spec.get("expected_status_min", 200))),
                expected_status_max=u256(int(c_spec.get("expected_status_max", 299))),
                expected_body_contains=str(c_spec.get("expected_body_contains", "")),
                repo_url="",
                repo_ref="",
                repo_path_expected="",
                onchain_rpc_url="",
                onchain_contract_address="",
                onchain_min_block=u256(0),
                onchain_event_topic0="",
                weight_bps=weight_bps,
            )
        elif c_type == CRITERION_TYPE_GIT:
            repo_url = str(c_spec.get("repo_url", "")).strip()
            self._assert_safe_public_url(repo_url)
            repo_ref = str(c_spec.get("repo_ref", "")).strip()
            if not repo_ref:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} GIT_REPO_STATE criterion needs repo_ref (branch/tag/commit)")
            criterion = Criterion(
                criterion_id=criterion_id,
                criterion_type=c_type,
                description=description,
                target_url="",
                expected_status_min=u256(0),
                expected_status_max=u256(0),
                expected_body_contains="",
                repo_url=repo_url,
                repo_ref=repo_ref,
                repo_path_expected=str(c_spec.get("repo_path_expected", "")),
                onchain_rpc_url="",
                onchain_contract_address="",
                onchain_min_block=u256(0),
                onchain_event_topic0="",
                weight_bps=weight_bps,
            )
        else:  # CRITERION_TYPE_ONCHAIN
            rpc_url = str(c_spec.get("onchain_rpc_url", "")).strip()
            self._assert_safe_public_url(rpc_url)
            contract_address = str(c_spec.get("onchain_contract_address", "")).strip()
            if not contract_address:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} ONCHAIN_STATE criterion needs onchain_contract_address")
            criterion = Criterion(
                criterion_id=criterion_id,
                criterion_type=c_type,
                description=description,
                target_url="",
                expected_status_min=u256(0),
                expected_status_max=u256(0),
                expected_body_contains="",
                repo_url="",
                repo_ref="",
                repo_path_expected="",
                onchain_rpc_url=rpc_url,
                onchain_contract_address=contract_address,
                onchain_min_block=u256(int(c_spec.get("onchain_min_block", 0))),
                onchain_event_topic0=str(c_spec.get("onchain_event_topic0", "")),
                weight_bps=weight_bps,
            )

        self.criteria[criterion_id] = criterion
        return criterion_id

    def _assert_safe_public_url(self, url: str) -> None:
        """Reject obviously unsafe/private-network URLs at genesis time.

        This is a best-effort deterministic guard (string pattern matching —
        deterministic, runs identically on every validator) against SSRF-style
        targets. It is NOT a substitute for the backend's own SSRF-guarded
        fetch layer used for UI previews; it exists so the contract itself
        never even records a criterion pointed at loopback/link-local/internal
        infrastructure.
        """
        if not url:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} URL is required for this criterion type")
        if not (url.startswith("https://") or url.startswith("http://")):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} URL must start with http:// or https://: {url}")
        lowered = url.lower()
        forbidden_hosts = (
            "localhost",
            "127.0.0.1",
            "0.0.0.0",
            "169.254.",  # link-local / cloud metadata
            "10.",
            "192.168.",
            "::1",
            "metadata.google.internal",
        )
        # crude host extraction: strip scheme, take up to first '/'
        after_scheme = lowered.split("://", 1)[-1]
        host_part = after_scheme.split("/", 1)[0].split(":", 1)[0]
        for forbidden in forbidden_hosts:
            if host_part == forbidden or host_part.startswith(forbidden):
                raise gl.vm.UserError(f"{ERROR_EXPECTED} URL host is not a permitted public target: {host_part}")

    def _index_grant_for_account(self, index: TreeMap[str, DynArray[str]], account: Address, grant_id: str) -> None:
        key = account.as_hex
        if key in index:
            index[key].append(grant_id)
        else:
            bucket: DynArray[str] = DynArray[str]()
            bucket.append(grant_id)
            index[key] = bucket

    # ========================================================================
    # SECTION 2 — CANCELLATION (pre-claim, funder-initiated, refund-only)
    # ========================================================================

    @gl.public.write
    def cancel_milestone(self, milestone_id: str) -> None:
        milestone = self._require_milestone(milestone_id)
        grant = self._require_grant(milestone.grant_id)

        if gl.message.sender_address != grant.funder:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the funder may cancel a milestone")
        if milestone.status not in (MILESTONE_STATUS_LOCKED, MILESTONE_STATUS_CLAIMABLE):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Milestone in status {milestone.status} cannot be cancelled "
                f"(a claim is already in progress or it is already finalized)"
            )

        refund = _u256_from_str(milestone.reward_deposited)
        if refund <= u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No reward deposited to refund")

        milestone.reward_deposited = "0"
        milestone.status = MILESTONE_STATUS_CANCELLED
        self.milestones[milestone_id] = milestone

        gl.emit_event("MilestoneCancelled", {"milestone_id": milestone_id, "refund_wei": str(int(refund))})
        _send_gen(grant.funder, refund)

    # ========================================================================
    # SECTION 3 — CLAIM SUBMISSION (pins the artifact snapshot BEFORE
    # evaluation begins; then triggers independent multi-validator inspection)
    # ========================================================================

    @gl.public.write
    def submit_milestone_claim(self, milestone_id: str, claim_note: str) -> str:
        """Grantee submits a claim. This immediately pins a cryptographic
        snapshot of the exact evaluation inputs, then runs the nondeterministic
        multi-validator inspection, then applies the DETERMINISTIC payout
        calculation, then opens (or skips, on FAILED) a challenge window.

        `claim_note` is an optional pointer (e.g. IPFS/Arweave CID) the
        grantee may attach for human readers. It is NEVER used as evidence by
        validators — only the pinned genesis criteria/artifact locations are
        inspected.
        """
        milestone = self._require_milestone(milestone_id)
        grant = self._require_grant(milestone.grant_id)

        if gl.message.sender_address != grant.grantee:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the grant's grantee may submit a claim")
        if milestone.status != MILESTONE_STATUS_CLAIMABLE:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Milestone status is {milestone.status}, expected {MILESTONE_STATUS_CLAIMABLE}"
            )
        if milestone.claimable_after > u256(0) and gl.message.chain_id is not None:
            # claimable_after is a business-logic timestamp gate set at genesis;
            # deterministic comparison against the current block timestamp.
            if gl.block.timestamp < milestone.claimable_after:
                raise gl.vm.UserError(
                    f"{ERROR_EXPECTED} Milestone not claimable until timestamp {int(milestone.claimable_after)}"
                )

        # Pin the snapshot: deterministic hash of milestone_id + criteria ids +
        # claim_note + current timestamp, computed identically by every
        # validator from on-chain inputs only (no external fetch here).
        pin_payload = "|".join([milestone_id] + list(milestone.criteria_ids) + [claim_note, str(int(gl.block.timestamp))])
        snapshot_hash = gl.hash.sha3_256(pin_payload.encode("utf-8")).hex()

        milestone.claim_submitted_at = gl.block.timestamp
        milestone.claimed_artifact_hash = snapshot_hash
        milestone.claim_note = claim_note
        milestone.status = MILESTONE_STATUS_EVALUATING
        self.milestones[milestone_id] = milestone

        gl.emit_event(
            "MilestoneClaimSubmitted",
            {"milestone_id": milestone_id, "snapshot_hash": snapshot_hash, "grantee": grant.grantee.as_hex},
        )

        # Run the independent multi-validator inspection + Equivalence
        # Principle consensus. This mutates milestone state to reflect the
        # verdict and, on PASSED/PARTIAL_PASS, opens the challenge window.
        self._evaluate_milestone(milestone_id)
        return snapshot_hash

    # ------------------------------------------------------------------------
    # SECTION 3a — NONDETERMINISTIC EVALUATION + EQUIVALENCE PRINCIPLE
    #
    # This is the heart of the trust-boundary guarantee. The leader fetches
    # every pinned artifact and computes a structured per-criterion boolean
    # result. Each validator INDEPENDENTLY repeats the exact same fetch+check
    # against the exact same pinned criteria and compares only the STABLE
    # decision fields (booleans + small derived numeric fields) with explicit
    # tolerance — never raw page bodies, never free text, never a format-only
    # check. This is Pattern 1 (partial field matching) + Pattern 2 (numeric
    # tolerance) from GenLayer's Equivalence Principle guidance, which is the
    # combination that avoids both false leader-rotation storms (too strict)
    # and rubber-stamping (too loose).
    # ------------------------------------------------------------------------

    def _evaluate_milestone(self, milestone_id: str) -> None:
        milestone = self.milestones[milestone_id]
        criteria = [self.criteria[cid] for cid in milestone.criteria_ids]

        def leader_fn():
            return self._inspect_all_criteria(criteria)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return self._handle_leader_error(leaders_res, leader_fn)

            leader_data = leaders_res.calldata
            validator_data = leader_fn()

            if not isinstance(leader_data, dict) or "criteria" not in leader_data:
                return False
            if not isinstance(validator_data, dict) or "criteria" not in validator_data:
                return False

            leader_criteria = leader_data["criteria"]
            validator_criteria = validator_data["criteria"]
            if len(leader_criteria) != len(validator_criteria):
                return False

            for i in range(len(leader_criteria)):
                l_entry = leader_criteria[i]
                v_entry = validator_criteria[i]
                if l_entry.get("criterion_id") != v_entry.get("criterion_id"):
                    return False
                # Core decision field must match exactly — this is the
                # substantive boolean outcome, not a format check.
                if bool(l_entry.get("passed")) != bool(v_entry.get("passed")):
                    return False
                # Numeric tolerance for fields that legitimately drift between
                # two independent HTTP calls a few seconds apart (e.g. latency
                # reported by an HTTP_ENDPOINT check). Tolerance is only
                # applied to whitelisted numeric detail fields, never to the
                # `passed` boolean itself.
                l_latency = l_entry.get("latency_ms")
                v_latency = v_entry.get("latency_ms")
                if isinstance(l_latency, (int, float)) and isinstance(v_latency, (int, float)):
                    if l_latency > 0 and v_latency > 0:
                        ratio = float(l_latency) / float(v_latency) if v_latency else 0
                        # allow up to +/-40% latency drift without disputing
                        # the underlying pass/fail decision
                        if ratio > 1.4 or ratio < 0.6:
                            # latency drift alone never flips consensus; only
                            # the `passed` field (already compared above) does
                            pass

            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self._apply_evaluation_result(milestone_id, result)

    def _inspect_all_criteria(self, criteria: list) -> dict:
        entries = []
        any_unreachable = False
        for criterion in criteria:
            entry = self._inspect_one_criterion(criterion)
            if entry.get("unreachable"):
                any_unreachable = True
            entries.append(entry)
        return {"criteria": entries, "any_unreachable": any_unreachable}

    def _inspect_one_criterion(self, criterion) -> dict:
        try:
            if criterion.criterion_type == CRITERION_TYPE_HTTP:
                return self._inspect_http_criterion(criterion)
            elif criterion.criterion_type == CRITERION_TYPE_GIT:
                return self._inspect_git_criterion(criterion)
            else:
                return self._inspect_onchain_criterion(criterion)
        except gl.vm.UserError:
            raise
        except Exception as exc:  # noqa: BLE001 — must not leak a bare unrecoverable VMError
            raise gl.vm.UserError(f"{ERROR_LLM} Unexpected inspection failure: {exc}")

    def _inspect_http_criterion(self, criterion) -> dict:
        try:
            response = gl.nondet.web.get(criterion.target_url)
        except Exception:
            return {
                "criterion_id": criterion.criterion_id,
                "passed": False,
                "unreachable": True,
                "latency_ms": 0,
                "detail": "unreachable",
            }

        status = int(getattr(response, "status_code", getattr(response, "status", 0)))
        body_bytes = getattr(response, "body", b"")
        try:
            body_text = body_bytes.decode("utf-8") if isinstance(body_bytes, (bytes, bytearray)) else str(body_bytes)
        except UnicodeDecodeError:
            body_text = ""

        status_ok = criterion.expected_status_min <= u256(status) <= criterion.expected_status_max
        body_ok = True
        if criterion.expected_body_contains:
            body_ok = criterion.expected_body_contains in body_text

        passed = bool(status_ok and body_ok)
        return {
            "criterion_id": criterion.criterion_id,
            "passed": passed,
            "unreachable": False,
            "latency_ms": 0,
            "detail": f"status={status} body_match={body_ok}",
        }

    def _inspect_git_criterion(self, criterion) -> dict:
        # Use GitHub's REST API (stable, structured JSON) rather than scraping
        # the repo web UI, so leader/validator responses normalize cleanly.
        api_url = self._github_ref_api_url(criterion.repo_url, criterion.repo_ref)
        try:
            response = gl.nondet.web.get(api_url)
        except Exception:
            return {
                "criterion_id": criterion.criterion_id,
                "passed": False,
                "unreachable": True,
                "latency_ms": 0,
                "detail": "unreachable",
            }

        status = int(getattr(response, "status_code", getattr(response, "status", 0)))
        if status != 200:
            return {
                "criterion_id": criterion.criterion_id,
                "passed": False,
                "unreachable": status >= 500,
                "latency_ms": 0,
                "detail": f"ref_lookup_status={status}",
            }

        body_bytes = getattr(response, "body", b"")
        try:
            data = json.loads(body_bytes.decode("utf-8") if isinstance(body_bytes, (bytes, bytearray)) else body_bytes)
        except (ValueError, UnicodeDecodeError):
            return {
                "criterion_id": criterion.criterion_id,
                "passed": False,
                "unreachable": False,
                "latency_ms": 0,
                "detail": "malformed_ref_response",
            }

        ref_exists = isinstance(data, dict) and bool(data.get("sha") or data.get("commit"))
        path_ok = True
        if criterion.repo_path_expected:
            path_ok = self._github_path_exists(criterion.repo_url, criterion.repo_ref, criterion.repo_path_expected)

        passed = bool(ref_exists and path_ok)
        return {
            "criterion_id": criterion.criterion_id,
            "passed": passed,
            "unreachable": False,
            "latency_ms": 0,
            "detail": f"ref_exists={ref_exists} path_ok={path_ok}",
        }

    def _github_path_exists(self, repo_url: str, ref: str, path: str) -> bool:
        owner_repo = self._extract_owner_repo(repo_url)
        contents_url = f"https://api.github.com/repos/{owner_repo}/contents/{path}?ref={ref}"
        try:
            response = gl.nondet.web.get(contents_url)
        except Exception:
            return False
        status = int(getattr(response, "status_code", getattr(response, "status", 0)))
        return status == 200

    def _github_ref_api_url(self, repo_url: str, ref: str) -> str:
        owner_repo = self._extract_owner_repo(repo_url)
        return f"https://api.github.com/repos/{owner_repo}/commits/{ref}"

    def _extract_owner_repo(self, repo_url: str) -> str:
        cleaned = repo_url.rstrip("/")
        if cleaned.endswith(".git"):
            cleaned = cleaned[: -len(".git")]
        parts = cleaned.split("github.com/")
        if len(parts) != 2:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} repo_url is not a github.com URL: {repo_url}")
        owner_repo = parts[1].strip("/")
        segments = owner_repo.split("/")
        if len(segments) < 2:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} repo_url missing owner/repo segments: {repo_url}")
        return f"{segments[0]}/{segments[1]}"

    def _inspect_onchain_criterion(self, criterion) -> dict:
        # eth_getLogs against the target contract, filtered by topic0 and a
        # minimum block, gives a stable, structured, independently-verifiable
        # signal that an expected event has occurred at/after genesis.
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_getLogs",
            "params": [
                {
                    "address": criterion.onchain_contract_address,
                    "topics": [criterion.onchain_event_topic0] if criterion.onchain_event_topic0 else [],
                    "fromBlock": hex(int(criterion.onchain_min_block)),
                    "toBlock": "latest",
                }
            ],
        }
        try:
            response = gl.nondet.web.request(
                criterion.onchain_rpc_url,
                method="POST",
                body=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
        except Exception:
            return {
                "criterion_id": criterion.criterion_id,
                "passed": False,
                "unreachable": True,
                "latency_ms": 0,
                "detail": "rpc_unreachable",
            }

        status = int(getattr(response, "status_code", getattr(response, "status", 0)))
        if status != 200:
            return {
                "criterion_id": criterion.criterion_id,
                "passed": False,
                "unreachable": status >= 500,
                "latency_ms": 0,
                "detail": f"rpc_status={status}",
            }

        body_bytes = getattr(response, "body", b"")
        try:
            data = json.loads(body_bytes.decode("utf-8") if isinstance(body_bytes, (bytes, bytearray)) else body_bytes)
        except (ValueError, UnicodeDecodeError):
            return {
                "criterion_id": criterion.criterion_id,
                "passed": False,
                "unreachable": False,
                "latency_ms": 0,
                "detail": "malformed_rpc_response",
            }

        if "error" in data:
            return {
                "criterion_id": criterion.criterion_id,
                "passed": False,
                "unreachable": False,
                "latency_ms": 0,
                "detail": f"rpc_error={data['error']}",
            }

        logs = data.get("result", [])
        passed = isinstance(logs, list) and len(logs) > 0
        return {
            "criterion_id": criterion.criterion_id,
            "passed": passed,
            "unreachable": False,
            "latency_ms": 0,
            "detail": f"log_count={len(logs) if isinstance(logs, list) else 0}",
        }

    def _handle_leader_error(self, leaders_res, leader_fn) -> bool:
        leader_msg = getattr(leaders_res, "message", "") or ""
        try:
            leader_fn()
            # Leader (as re-run by this validator) succeeded where the
            # original leader failed — that is a disagreement.
            return False
        except gl.vm.UserError as exc:
            validator_msg = getattr(exc, "message", str(exc))
            if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(ERROR_EXTERNAL):
                return validator_msg == leader_msg
            if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
                return True
            return False
        except Exception:
            return False

    # ------------------------------------------------------------------------
    # SECTION 3b — APPLYING THE CONSENSUS RESULT (still nondeterministic
    # inputs, but the LOGIC applied here is pure and deterministic given
    # `result`; see _compute_deterministic_payout for the fully separated
    # money-math step)
    # ------------------------------------------------------------------------

    def _apply_evaluation_result(self, milestone_id: str, result: dict) -> None:
        milestone = self.milestones[milestone_id]
        criteria_entries = result.get("criteria", [])
        any_unreachable = bool(result.get("any_unreachable", False))

        result_ids: DynArray[str] = DynArray[str]()
        passed_weight = u256(0)
        total_weight = u256(0)
        for entry in criteria_entries:
            criterion_id = entry.get("criterion_id")
            criterion = self.criteria.get(criterion_id)
            if criterion is None:
                continue
            passed = bool(entry.get("passed"))
            detail = str(entry.get("detail", ""))[:256]

            result_id = f"res-{int(self.next_result_seq)}"
            self.next_result_seq = self.next_result_seq + u256(1)
            self.results[result_id] = CriterionResult(criterion_id=criterion_id, passed=passed, detail=detail)
            result_ids.append(result_id)

            total_weight = total_weight + criterion.weight_bps
            if passed:
                passed_weight = passed_weight + criterion.weight_bps

        milestone.result_ids = result_ids
        milestone.evaluated_at = gl.block.timestamp

        if any_unreachable:
            verdict = VERDICT_INCONCLUSIVE
        elif total_weight == u256(0):
            verdict = VERDICT_INCONCLUSIVE
        elif passed_weight == total_weight:
            verdict = VERDICT_PASSED
        elif passed_weight == u256(0):
            verdict = VERDICT_FAILED
        else:
            verdict = VERDICT_PARTIAL_PASS

        milestone.verdict = verdict
        milestone.recommended_payout_bps = self._compute_deterministic_payout_bps(verdict, passed_weight, total_weight)

        if verdict in (VERDICT_PASSED, VERDICT_PARTIAL_PASS):
            milestone.status = MILESTONE_STATUS_CHALLENGE_WINDOW
            milestone.challenge_window_opens_at = gl.block.timestamp
            milestone.challenge_window_closes_at = gl.block.timestamp + milestone.challenge_window_seconds
        elif verdict == VERDICT_FAILED:
            milestone.status = MILESTONE_STATUS_FAILED
        else:  # INCONCLUSIVE
            milestone.status = MILESTONE_STATUS_INCONCLUSIVE

        self.milestones[milestone_id] = milestone

        gl.emit_event(
            "MilestoneEvaluated",
            {
                "milestone_id": milestone_id,
                "verdict": verdict,
                "recommended_payout_bps": str(int(milestone.recommended_payout_bps)),
            },
        )

    def _compute_deterministic_payout_bps(self, verdict: str, passed_weight: u256, total_weight: u256) -> u256:
        """Pure deterministic function — no web access, no LLM, no randomness.
        Takes only the already-agreed structured result and computes the
        payout share. This is the required separation between the
        nondeterministic evaluation and the deterministic money math.
        """
        if verdict == VERDICT_PASSED:
            return BASIS_POINTS_DENOMINATOR
        if verdict == VERDICT_FAILED:
            return u256(0)
        if verdict == VERDICT_PARTIAL_PASS:
            if total_weight == u256(0):
                return u256(0)
            return (passed_weight * BASIS_POINTS_DENOMINATOR) // total_weight
        return u256(0)  # INCONCLUSIVE — no payout until re-evaluated

    # ========================================================================
    # SECTION 4 — RE-EVALUATION OF INCONCLUSIVE MILESTONES
    # ========================================================================

    @gl.public.write
    def retry_inconclusive_milestone(self, milestone_id: str) -> None:
        """Anyone may trigger a re-run of the multi-validator inspection for
        a milestone stuck at INCONCLUSIVE (e.g. an artifact was temporarily
        unreachable). This re-runs the exact same pinned criteria — it can
        never introduce new criteria or artifact locations.
        """
        milestone = self._require_milestone(milestone_id)
        if milestone.status != MILESTONE_STATUS_INCONCLUSIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone is not INCONCLUSIVE")
        milestone.status = MILESTONE_STATUS_EVALUATING
        self.milestones[milestone_id] = milestone
        self._evaluate_milestone(milestone_id)

    # ========================================================================
    # SECTION 5 — CHALLENGE / DISPUTE HANDLING (additive evidence only)
    # ========================================================================

    @gl.public.write.payable
    def file_challenge(self, milestone_id: str, category: str, evidence_url: str, evidence_note: str) -> str:
        milestone = self._require_milestone(milestone_id)
        grant = self._require_grant(milestone.grant_id)

        if milestone.status != MILESTONE_STATUS_CHALLENGE_WINDOW:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone is not in an active challenge window")
        if gl.block.timestamp >= milestone.challenge_window_closes_at:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Challenge window has already closed")
        if milestone.active_challenge_id:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} A challenge is already pending for this milestone")

        sender = gl.message.sender_address
        if sender not in (grant.funder, grant.grantee):
            # Third-party watchdogs are allowed to challenge too — the
            # protocol is not limited to the two named parties — but they
            # still must stake the bond and are subject to the same slashing.
            pass

        bond_wei = _u256_from_str(self.default_dispute_bond_wei)
        if gl.message.value != bond_wei:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Must stake exactly the dispute bond of {int(bond_wei)} wei GEN"
            )
        self._assert_safe_public_url(evidence_url)

        challenge_id = f"chal-{int(self.next_challenge_seq)}"
        self.next_challenge_seq = self.next_challenge_seq + u256(1)

        challenge = Challenge(
            challenge_id=challenge_id,
            milestone_id=milestone_id,
            challenger=sender,
            bond_wei=str(int(bond_wei)),
            bond_deposited=str(int(gl.message.value)),
            category=category,
            evidence_url=evidence_url,
            evidence_note=evidence_note,
            status=CHALLENGE_STATUS_PENDING,
            filed_at=gl.block.timestamp,
            resolved_at=u256(0),
            resolution_detail="",
        )
        self.challenges[challenge_id] = challenge
        self.challenge_order.append(challenge_id)

        milestone.active_challenge_id = challenge_id
        milestone.status = MILESTONE_STATUS_DISPUTED
        self.milestones[milestone_id] = milestone

        gl.emit_event(
            "ChallengeFiled",
            {"challenge_id": challenge_id, "milestone_id": milestone_id, "challenger": sender.as_hex, "category": category},
        )
        return challenge_id

    @gl.public.write
    def resolve_challenge(self, challenge_id: str) -> str:
        """Re-runs the SAME pinned genesis criteria via the multi-validator
        inspection, then additionally checks whether the challenger's
        additive evidence_url independently corroborates a failure that the
        original evaluation missed (e.g. the target URL is verifiably down
        right now per a second independent fetch). The original criteria/
        artifact locations are never replaced — only additional evidence is
        consulted, and only to decide whether the ORIGINAL verdict holds.
        """
        challenge = self.challenges.get(challenge_id)
        if challenge is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown challenge_id")
        if challenge.status != CHALLENGE_STATUS_PENDING:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Challenge already resolved")

        milestone = self._require_milestone(challenge.milestone_id)
        criteria = [self.criteria[cid] for cid in milestone.criteria_ids]

        def leader_fn():
            base = self._inspect_all_criteria(criteria)
            evidence_check = self._inspect_evidence_url(challenge.evidence_url)
            return {"base": base, "evidence": evidence_check}

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return self._handle_leader_error(leaders_res, leader_fn)
            leader_data = leaders_res.calldata
            validator_data = leader_fn()
            if not isinstance(leader_data, dict) or not isinstance(validator_data, dict):
                return False
            l_base = leader_data.get("base", {}).get("criteria", [])
            v_base = validator_data.get("base", {}).get("criteria", [])
            if len(l_base) != len(v_base):
                return False
            for i in range(len(l_base)):
                if bool(l_base[i].get("passed")) != bool(v_base[i].get("passed")):
                    return False
            l_ev = leader_data.get("evidence", {})
            v_ev = validator_data.get("evidence", {})
            return bool(l_ev.get("reachable")) == bool(v_ev.get("reachable")) and bool(
                l_ev.get("corroborates_failure")
            ) == bool(v_ev.get("corroborates_failure"))

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        return self._settle_challenge(challenge_id, result)

    def _inspect_evidence_url(self, evidence_url: str) -> dict:
        try:
            response = gl.nondet.web.get(evidence_url)
        except Exception:
            return {"reachable": False, "corroborates_failure": False}
        status = int(getattr(response, "status_code", getattr(response, "status", 0)))
        body_bytes = getattr(response, "body", b"")
        try:
            body_text = body_bytes.decode("utf-8") if isinstance(body_bytes, (bytes, bytearray)) else str(body_bytes)
        except UnicodeDecodeError:
            body_text = ""
        # A structured, conservative heuristic: the additive evidence
        # corroborates a failure only if it is itself reachable (HTTP 200)
        # AND its own content explicitly references a failure signal keyword.
        # This keeps the check machine-checkable and reproducible rather than
        # an open-ended LLM judgment call over free text.
        lowered = body_text.lower()
        failure_markers = ("down", "unreachable", "timeout", "error", "outage", "failed", "offline")
        corroborates = status == 200 and any(marker in lowered for marker in failure_markers)
        return {"reachable": status == 200, "corroborates_failure": corroborates}

    def _settle_challenge(self, challenge_id: str, result: dict) -> str:
        challenge = self.challenges[challenge_id]
        milestone = self.milestones[challenge.milestone_id]

        base = result.get("base", {})
        evidence = result.get("evidence", {})
        base_criteria = base.get("criteria", [])
        any_unreachable = bool(base.get("any_unreachable", False))
        evidence_corroborates = bool(evidence.get("corroborates_failure", False))

        passed_weight = u256(0)
        total_weight = u256(0)
        for entry in base_criteria:
            criterion = self.criteria.get(entry.get("criterion_id"))
            if criterion is None:
                continue
            total_weight = total_weight + criterion.weight_bps
            if bool(entry.get("passed")):
                passed_weight = passed_weight + criterion.weight_bps

        re_verdict_passed_fully = (not any_unreachable) and total_weight > u256(0) and passed_weight == total_weight

        # UPHELD only when the re-inspection now shows the milestone does NOT
        # fully pass anymore, OR the additive evidence independently
        # corroborates a failure the base re-check might still be masking
        # (e.g. the target was up during re-check but the challenger's
        # independent archival log shows it was down during the actual
        # evaluation window).
        upheld = (not re_verdict_passed_fully) or evidence_corroborates

        bond = _u256_from_str(challenge.bond_deposited)
        challenge.bond_deposited = "0"

        if upheld:
            challenge.status = CHALLENGE_STATUS_UPHELD
            challenge.resolution_detail = "Re-inspection or additive evidence contradicted original verdict"
            self._settle_upheld_challenge(milestone, challenge, bond)
        else:
            challenge.status = CHALLENGE_STATUS_REJECTED
            challenge.resolution_detail = "Re-inspection confirmed original verdict; evidence did not corroborate"
            self._settle_rejected_challenge(milestone, challenge, bond)

        challenge.resolved_at = gl.block.timestamp
        self.challenges[challenge_id] = challenge

        gl.emit_event(
            "ChallengeResolved",
            {"challenge_id": challenge_id, "milestone_id": milestone.milestone_id, "status": challenge.status},
        )
        return challenge.status

    def _settle_upheld_challenge(self, milestone: Milestone, challenge: Challenge, bond: u256) -> None:
        grant = self.grants[milestone.grant_id]

        # Milestone reward reverts to FAILED — funder is refunded on
        # withdrawal, grantee gets nothing for this tranche.
        milestone.status = MILESTONE_STATUS_FAILED
        milestone.active_challenge_id = ""
        milestone.recommended_payout_bps = u256(0)
        self.milestones[milestone.milestone_id] = milestone

        # Challenger bond returned in full, plus a bounty carved out of the
        # (now-failed) reward escrow, capped at what remains deposited.
        reward_pool = _u256_from_str(milestone.reward_deposited)
        bounty = (reward_pool * self.upheld_bounty_bps) // BASIS_POINTS_DENOMINATOR
        if bounty > reward_pool:
            bounty = reward_pool

        milestone.reward_deposited = str(int(reward_pool - bounty))
        self.milestones[milestone.milestone_id] = milestone

        payout_to_challenger = bond + bounty
        if payout_to_challenger > u256(0):
            _send_gen(challenge.challenger, payout_to_challenger)

    def _settle_rejected_challenge(self, milestone: Milestone, challenge: Challenge, bond: u256) -> None:
        grant = self.grants[milestone.grant_id]

        # Milestone resumes its challenge window (a rejected frivolous
        # challenge does not itself finalize release — it simply clears the
        # dispute and, if the window has already elapsed, allows immediate
        # release on the next call to release_milestone).
        milestone.status = MILESTONE_STATUS_CHALLENGE_WINDOW
        milestone.active_challenge_id = ""
        self.milestones[milestone.milestone_id] = milestone

        slash_to_grantee = (bond * self.frivolous_slash_bps) // BASIS_POINTS_DENOMINATOR
        refund_to_challenger = bond - slash_to_grantee

        if slash_to_grantee > u256(0):
            _send_gen(grant.grantee, slash_to_grantee)
        if refund_to_challenger > u256(0):
            _send_gen(challenge.challenger, refund_to_challenger)

    # ========================================================================
    # SECTION 6 — DETERMINISTIC RELEASE (pull-based withdrawal)
    # ========================================================================

    @gl.public.write
    def release_milestone(self, milestone_id: str) -> None:
        """Pull-based withdrawal. Callable by anyone (typically the grantee)
        once the challenge window has closed with zero pending disputes.
        Splits PASSED / PARTIAL_PASS payouts using the already-computed,
        purely deterministic `recommended_payout_bps` — no web access, no
        LLM call, no randomness in this function.
        """
        milestone = self._require_milestone(milestone_id)
        grant = self._require_grant(milestone.grant_id)

        if milestone.status != MILESTONE_STATUS_CHALLENGE_WINDOW:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone is not awaiting release")
        if milestone.active_challenge_id:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Cannot release while a challenge is pending")
        if gl.block.timestamp < milestone.challenge_window_closes_at:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Challenge window has not closed yet")

        reward_pool = _u256_from_str(milestone.reward_deposited)
        if reward_pool <= u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No reward deposited")

        payout_bps = milestone.recommended_payout_bps
        grantee_share = (reward_pool * payout_bps) // BASIS_POINTS_DENOMINATOR
        funder_refund = reward_pool - grantee_share

        # Zero the ledger BEFORE any transfer — structurally impossible to
        # release twice.
        milestone.reward_deposited = "0"
        milestone.status = MILESTONE_STATUS_RELEASED
        self.milestones[milestone_id] = milestone

        self._unlock_next_milestone(grant, milestone)
        self._maybe_complete_grant(grant)

        gl.emit_event(
            "MilestoneReleased",
            {
                "milestone_id": milestone_id,
                "grantee_share_wei": str(int(grantee_share)),
                "funder_refund_wei": str(int(funder_refund)),
            },
        )

        if grantee_share > u256(0):
            _send_gen(grant.grantee, grantee_share)
        if funder_refund > u256(0):
            _send_gen(grant.funder, funder_refund)

    def _unlock_next_milestone(self, grant: Grant, released: Milestone) -> None:
        milestone_ids = list(grant.milestone_ids)
        try:
            pos = milestone_ids.index(released.milestone_id)
        except ValueError:
            return
        if pos + 1 >= len(milestone_ids):
            return
        next_id = milestone_ids[pos + 1]
        next_milestone = self.milestones[next_id]
        if next_milestone.status == MILESTONE_STATUS_LOCKED:
            next_milestone.status = MILESTONE_STATUS_CLAIMABLE
            self.milestones[next_id] = next_milestone

    def _maybe_complete_grant(self, grant: Grant) -> None:
        all_terminal = True
        for mid in grant.milestone_ids:
            status = self.milestones[mid].status
            if status not in (MILESTONE_STATUS_RELEASED, MILESTONE_STATUS_FAILED, MILESTONE_STATUS_CANCELLED):
                all_terminal = False
                break
        if all_terminal:
            grant.status = GRANT_STATUS_COMPLETED
            self.grants[grant.grant_id] = grant

    @gl.public.write
    def claim_failed_milestone_refund(self, milestone_id: str) -> None:
        """Funder-initiated refund path for a milestone that resolved to
        FAILED (either directly from evaluation, or via an upheld
        challenge). Refunds whatever remains in reward_deposited (a bounty
        may already have been carved out).
        """
        milestone = self._require_milestone(milestone_id)
        grant = self._require_grant(milestone.grant_id)

        if gl.message.sender_address != grant.funder:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the funder may claim a failed-milestone refund")
        if milestone.status != MILESTONE_STATUS_FAILED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone is not in FAILED status")

        refund = _u256_from_str(milestone.reward_deposited)
        if refund <= u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No reward deposited to refund")

        milestone.reward_deposited = "0"
        self.milestones[milestone_id] = milestone

        self._unlock_next_milestone_after_failure(grant, milestone)
        self._maybe_complete_grant(grant)

        gl.emit_event("MilestoneRefunded", {"milestone_id": milestone_id, "refund_wei": str(int(refund))})
        _send_gen(grant.funder, refund)

    def _unlock_next_milestone_after_failure(self, grant: Grant, failed: Milestone) -> None:
        # A failed milestone does not unlock the next tranche automatically —
        # the funder must explicitly re-fund/replace it via a new grant, or
        # the grant simply completes with the remaining milestones untouched
        # (they stay LOCKED forever, which is intentional: a failed milestone
        # should stop the pipeline, not silently skip ahead).
        return

    # ========================================================================
    # SECTION 7 — SPONSOR TIMEOUT RECOVERY (grantee-side safety valve)
    #
    # If a milestone sits EVALUATING for an abnormally long time (e.g. the
    # nondeterministic step never got picked up due to network conditions —
    # note under normal GenVM operation `submit_milestone_claim` completes
    # evaluation synchronously within the same transaction; this path exists
    # purely as a defensive recovery valve should a future protocol version
    # decouple submission from evaluation), the grantee may force a fresh
    # evaluation attempt. This never bypasses validator consensus — it only
    # retries it.
    # ========================================================================

    @gl.public.write
    def force_retry_evaluation(self, milestone_id: str) -> None:
        milestone = self._require_milestone(milestone_id)
        grant = self._require_grant(milestone.grant_id)
        if gl.message.sender_address != grant.grantee:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the grantee may force a retry")
        if milestone.status != MILESTONE_STATUS_EVALUATING:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone is not stuck in EVALUATING")
        self._evaluate_milestone(milestone_id)

    # ========================================================================
    # SECTION 8 — READ-ONLY VIEWS
    # ========================================================================

    @gl.public.view
    def get_grant(self, grant_id: str) -> dict:
        grant = self._require_grant(grant_id)
        return {
            "grant_id": grant.grant_id,
            "funder": grant.funder.as_hex,
            "grantee": grant.grantee.as_hex,
            "title": grant.title,
            "total_reward_wei": grant.total_reward_wei,
            "status": grant.status,
            "milestone_ids": list(grant.milestone_ids),
        }

    @gl.public.view
    def get_milestone(self, milestone_id: str) -> dict:
        m = self._require_milestone(milestone_id)
        return {
            "milestone_id": m.milestone_id,
            "grant_id": m.grant_id,
            "index": int(m.index),
            "title": m.title,
            "reward_wei": m.reward_wei,
            "reward_deposited": m.reward_deposited,
            "status": m.status,
            "challenge_window_seconds": int(m.challenge_window_seconds),
            "criteria_ids": list(m.criteria_ids),
            "claim_submitted_at": int(m.claim_submitted_at),
            "claimed_artifact_hash": m.claimed_artifact_hash,
            "claim_note": m.claim_note,
            "verdict": m.verdict,
            "result_ids": list(m.result_ids),
            "recommended_payout_bps": int(m.recommended_payout_bps),
            "evaluated_at": int(m.evaluated_at),
            "challenge_window_opens_at": int(m.challenge_window_opens_at),
            "challenge_window_closes_at": int(m.challenge_window_closes_at),
            "active_challenge_id": m.active_challenge_id,
            "claimable_after": int(m.claimable_after),
        }

    @gl.public.view
    def get_criterion(self, criterion_id: str) -> dict:
        c = self.criteria.get(criterion_id)
        if c is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown criterion_id")
        return {
            "criterion_id": c.criterion_id,
            "criterion_type": c.criterion_type,
            "description": c.description,
            "target_url": c.target_url,
            "expected_status_min": int(c.expected_status_min),
            "expected_status_max": int(c.expected_status_max),
            "expected_body_contains": c.expected_body_contains,
            "repo_url": c.repo_url,
            "repo_ref": c.repo_ref,
            "repo_path_expected": c.repo_path_expected,
            "onchain_rpc_url": c.onchain_rpc_url,
            "onchain_contract_address": c.onchain_contract_address,
            "onchain_min_block": int(c.onchain_min_block),
            "onchain_event_topic0": c.onchain_event_topic0,
            "weight_bps": int(c.weight_bps),
        }

    @gl.public.view
    def get_criterion_result(self, result_id: str) -> dict:
        r = self.results.get(result_id)
        if r is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown result_id")
        return {"criterion_id": r.criterion_id, "passed": r.passed, "detail": r.detail}

    @gl.public.view
    def get_challenge(self, challenge_id: str) -> dict:
        c = self.challenges.get(challenge_id)
        if c is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown challenge_id")
        return {
            "challenge_id": c.challenge_id,
            "milestone_id": c.milestone_id,
            "challenger": c.challenger.as_hex,
            "bond_wei": c.bond_wei,
            "bond_deposited": c.bond_deposited,
            "category": c.category,
            "evidence_url": c.evidence_url,
            "evidence_note": c.evidence_note,
            "status": c.status,
            "filed_at": int(c.filed_at),
            "resolved_at": int(c.resolved_at),
            "resolution_detail": c.resolution_detail,
        }

    @gl.public.view
    def list_grants(self) -> DynArray[str]:
        return self.grant_order

    @gl.public.view
    def list_grants_by_funder(self, funder_address: str) -> DynArray[str]:
        return self.grants_by_funder.get(Address(funder_address).as_hex, DynArray[str]())

    @gl.public.view
    def list_grants_by_grantee(self, grantee_address: str) -> DynArray[str]:
        return self.grants_by_grantee.get(Address(grantee_address).as_hex, DynArray[str]())

    @gl.public.view
    def list_challenges(self) -> DynArray[str]:
        return self.challenge_order

    @gl.public.view
    def get_protocol_params(self) -> dict:
        return {
            "protocol_admin": self.protocol_admin.as_hex,
            "default_dispute_bond_wei": self.default_dispute_bond_wei,
            "frivolous_slash_bps": int(self.frivolous_slash_bps),
            "upheld_bounty_bps": int(self.upheld_bounty_bps),
            "min_challenge_window_seconds": int(MIN_CHALLENGE_WINDOW_SECONDS),
            "max_challenge_window_seconds": int(MAX_CHALLENGE_WINDOW_SECONDS),
        }

    # ========================================================================
    # SECTION 9 — ADMIN (parameter tuning only — never touches escrowed
    # funds, never overrides a verdict, never bypasses a challenge window)
    # ========================================================================

    @gl.public.write
    def update_protocol_params(
        self, default_dispute_bond_wei: str, frivolous_slash_bps: u256, upheld_bounty_bps: u256
    ) -> None:
        if gl.message.sender_address != self.protocol_admin:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the protocol admin may update parameters")
        if frivolous_slash_bps > BASIS_POINTS_DENOMINATOR:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} frivolous_slash_bps must be <= 10000")
        if upheld_bounty_bps > BASIS_POINTS_DENOMINATOR:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} upheld_bounty_bps must be <= 10000")
        _u256_from_str(default_dispute_bond_wei)  # validates it parses
        self.default_dispute_bond_wei = default_dispute_bond_wei
        self.frivolous_slash_bps = frivolous_slash_bps
        self.upheld_bounty_bps = upheld_bounty_bps
        gl.emit_event("ProtocolParamsUpdated", {"default_dispute_bond_wei": default_dispute_bond_wei})

    @gl.public.write
    def transfer_admin(self, new_admin_address: str) -> None:
        if gl.message.sender_address != self.protocol_admin:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the protocol admin may transfer admin rights")
        self.protocol_admin = Address(new_admin_address)
        gl.emit_event("AdminTransferred", {"new_admin": self.protocol_admin.as_hex})

    # ========================================================================
    # Internal lookup helpers
    # ========================================================================

    def _require_grant(self, grant_id: str) -> Grant:
        grant = self.grants.get(grant_id)
        if grant is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown grant_id: {grant_id}")
        return grant

    def _require_milestone(self, milestone_id: str) -> Milestone:
        milestone = self.milestones.get(milestone_id)
        if milestone is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown milestone_id: {milestone_id}")
        return milestone

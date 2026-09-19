-- Milestone Forge — read-cache/indexer schema.
-- This mirrors contract state for fast reads; the contract remains the
-- source of truth. Nothing here is authoritative for money movement.

CREATE TABLE IF NOT EXISTS grants (
  grant_id TEXT PRIMARY KEY,
  funder_address TEXT NOT NULL,
  grantee_address TEXT NOT NULL,
  title TEXT NOT NULL,
  total_reward_wei TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grants_funder ON grants (funder_address);
CREATE INDEX IF NOT EXISTS idx_grants_grantee ON grants (grantee_address);
CREATE INDEX IF NOT EXISTS idx_grants_status ON grants (status);

CREATE TABLE IF NOT EXISTS milestones (
  milestone_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES grants (grant_id),
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  reward_wei TEXT NOT NULL,
  status TEXT NOT NULL,
  challenge_window_seconds INTEGER NOT NULL,
  verdict TEXT,
  recommended_payout_bps INTEGER,
  claim_submitted_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ,
  challenge_window_closes_at TIMESTAMPTZ,
  active_challenge_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_grant ON milestones (grant_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones (status);

CREATE TABLE IF NOT EXISTS challenges (
  challenge_id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones (milestone_id),
  challenger_address TEXT NOT NULL,
  category TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  status TEXT NOT NULL,
  filed_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolution_detail TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenges_milestone ON challenges (milestone_id);

-- Raw event log mirror — append-only, used to rebuild the tables above and
-- to power the "History" page's full audit trail.
CREATE TABLE IF NOT EXISTS contract_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  tx_hash TEXT,
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_events_name ON contract_events (event_name);

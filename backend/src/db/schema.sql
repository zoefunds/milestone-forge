-- Milestone Forge — read-cache/indexer schema.
-- This mirrors contract state for fast reads; the contract remains the
-- source of truth. Nothing here is authoritative for money movement.
--
-- grant_id / milestone_id / challenge_id are sequential counters the
-- CONTRACT assigns starting fresh on every new deployment — they are
-- unique only *within* one deployed contract instance, not globally. Every
-- table is therefore keyed by (contract_address, <id>), not by <id> alone,
-- so cached rows from a superseded deployment can never collide with (or
-- be mistaken for) a new deployment's own rows that happen to reuse the
-- same id. See memory/MEMORY.md for the real incident this fixes.

CREATE TABLE IF NOT EXISTS grants (
  contract_address TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  funder_address TEXT NOT NULL,
  grantee_address TEXT NOT NULL,
  title TEXT NOT NULL,
  total_reward_wei TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_address, grant_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  contract_address TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_address, milestone_id),
  FOREIGN KEY (contract_address, grant_id) REFERENCES grants (contract_address, grant_id)
);

CREATE TABLE IF NOT EXISTS challenges (
  contract_address TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  challenger_address TEXT NOT NULL,
  category TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  status TEXT NOT NULL,
  filed_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolution_detail TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_address, challenge_id),
  FOREIGN KEY (contract_address, milestone_id) REFERENCES milestones (contract_address, milestone_id)
);

-- Raw event log mirror — append-only, used to rebuild the tables above and
-- to power the "History" page's full audit trail.
CREATE TABLE IF NOT EXISTS contract_events (
  id BIGSERIAL PRIMARY KEY,
  contract_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  tx_hash TEXT,
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- In-place migration for a database that already has these tables from
-- before contract_address existed (pre-2026-09-21). Safe to rerun: each
-- block is a no-op once the column/constraint it adds is already present.
-- Since this is a pure read-cache with no way to know which deployment a
-- legacy (pre-migration) row belongs to, legacy rows are deleted rather
-- than guessed at — they repopulate from the next indexer poll. This must
-- run BEFORE the "CREATE INDEX" statements below, since those index on
-- contract_address.
-- ---------------------------------------------------------------------

-- Decouple the old single-column FK chain (challenges -> milestones ->
-- grants) BEFORE any table's rows are deleted below — otherwise deleting
-- legacy grants/milestones rows fails with a foreign-key violation from a
-- not-yet-migrated child table still pointing at them by the old columns.
-- Harmless no-op once already dropped (a later ADD FOREIGN KEY below
-- re-establishes the composite-key version).
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_milestone_id_fkey;
ALTER TABLE milestones DROP CONSTRAINT IF EXISTS milestones_grant_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grants' AND column_name = 'contract_address'
  ) THEN
    ALTER TABLE grants ADD COLUMN contract_address TEXT;
    DELETE FROM grants WHERE contract_address IS NULL;
    ALTER TABLE grants ALTER COLUMN contract_address SET NOT NULL;
    ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_pkey;
    ALTER TABLE grants ADD PRIMARY KEY (contract_address, grant_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'milestones' AND column_name = 'contract_address'
  ) THEN
    ALTER TABLE milestones ADD COLUMN contract_address TEXT;
    DELETE FROM milestones WHERE contract_address IS NULL;
    ALTER TABLE milestones ALTER COLUMN contract_address SET NOT NULL;
    ALTER TABLE milestones DROP CONSTRAINT IF EXISTS milestones_pkey;
    ALTER TABLE milestones ADD PRIMARY KEY (contract_address, milestone_id);
    ALTER TABLE milestones ADD FOREIGN KEY (contract_address, grant_id) REFERENCES grants (contract_address, grant_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'challenges' AND column_name = 'contract_address'
  ) THEN
    ALTER TABLE challenges ADD COLUMN contract_address TEXT;
    DELETE FROM challenges WHERE contract_address IS NULL;
    ALTER TABLE challenges ALTER COLUMN contract_address SET NOT NULL;
    ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_pkey;
    ALTER TABLE challenges ADD PRIMARY KEY (contract_address, challenge_id);
    ALTER TABLE challenges ADD FOREIGN KEY (contract_address, milestone_id) REFERENCES milestones (contract_address, milestone_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_events' AND column_name = 'contract_address'
  ) THEN
    ALTER TABLE contract_events ADD COLUMN contract_address TEXT;
    DELETE FROM contract_events WHERE contract_address IS NULL;
    ALTER TABLE contract_events ALTER COLUMN contract_address SET NOT NULL;
  END IF;
END $$;

-- Old (pre-migration) single-column indexes may still exist under their
-- original names with no contract_address in them — drop before recreating
-- as composite so a rerun doesn't just add a second, redundant index.
DROP INDEX IF EXISTS idx_grants_funder;
DROP INDEX IF EXISTS idx_grants_grantee;
DROP INDEX IF EXISTS idx_grants_status;
DROP INDEX IF EXISTS idx_milestones_grant;
DROP INDEX IF EXISTS idx_milestones_status;
DROP INDEX IF EXISTS idx_challenges_milestone;
DROP INDEX IF EXISTS idx_contract_events_name;

CREATE INDEX IF NOT EXISTS idx_grants_funder ON grants (contract_address, funder_address);
CREATE INDEX IF NOT EXISTS idx_grants_grantee ON grants (contract_address, grantee_address);
CREATE INDEX IF NOT EXISTS idx_grants_status ON grants (contract_address, status);
CREATE INDEX IF NOT EXISTS idx_milestones_grant ON milestones (contract_address, grant_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones (contract_address, status);
CREATE INDEX IF NOT EXISTS idx_challenges_milestone ON challenges (contract_address, milestone_id);
CREATE INDEX IF NOT EXISTS idx_contract_events_name ON contract_events (contract_address, event_name);

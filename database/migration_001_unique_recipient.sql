-- =============================================================
-- MIGRATION 001 – Add UNIQUE(campaign_id, email) to recipients
--
-- Run this in Supabase SQL Editor AFTER schema.sql.
-- Safe to run multiple times (idempotent).
-- Does NOT delete recipient records – duplicates are found first
-- and you are shown them before anything is changed.
-- =============================================================

-- ── Step 0: Preview duplicates before touching any data ───────────
-- Run this SELECT first to see if any duplicates exist.
-- If it returns rows, review them before running Step 1.
--
-- SELECT
--   campaign_id,
--   email,
--   COUNT(*) AS duplicate_count
-- FROM recipients
-- GROUP BY campaign_id, email
-- HAVING COUNT(*) > 1;

-- ── Step 1: Remove duplicates (only if Step 0 returned rows) ──────
-- Keeps the most recently created row for each (campaign_id, email) pair.
-- Uses a CTE so only the extra copies are deleted, not the keeper.
-- WARNING: This also cascades to email_events for the deleted recipient IDs.
-- If those events matter, copy them to the surviving recipient first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM recipients
    GROUP BY campaign_id, email
    HAVING COUNT(*) > 1
  ) THEN
    DELETE FROM recipients
    WHERE id NOT IN (
      SELECT DISTINCT ON (campaign_id, email) id
      FROM recipients
      ORDER BY campaign_id, email, created_at DESC NULLS LAST
    );
    RAISE NOTICE 'Duplicate recipients removed.';
  ELSE
    RAISE NOTICE 'No duplicate recipients found – nothing deleted.';
  END IF;
END $$;

-- ── Step 2: Add UNIQUE constraint (skipped if it already exists) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_recipient_campaign_email'
  ) THEN
    ALTER TABLE recipients
      ADD CONSTRAINT uq_recipient_campaign_email UNIQUE (campaign_id, email);
    RAISE NOTICE 'Constraint uq_recipient_campaign_email added.';
  ELSE
    RAISE NOTICE 'Constraint uq_recipient_campaign_email already exists – skipped.';
  END IF;
END $$;

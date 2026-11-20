-- =============================================================
-- EMAIL TRACKING SYSTEM - Complete Database Schema
-- Run this entire file once in Supabase SQL Editor
-- =============================================================

-- ─── EXTENSIONS ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── CAMPAIGNS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sending','sent','paused','cancelled')),
  sent_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RECIPIENTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  token           TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  consent_given   BOOLEAN NOT NULL DEFAULT FALSE,
  consent_date    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_email CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- ─── EMAIL EVENTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL
                    CHECK (event_type IN ('open','click','form_submit','unsubscribe')),
  url             TEXT,                 -- for click events
  user_agent      TEXT,
  is_bot          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── LEADS (form submissions) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  recipient_id    UUID REFERENCES recipients(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  phone           TEXT,
  company         TEXT,
  message         TEXT,
  ip_address      TEXT,                 -- stored ONLY when user ticked consent checkbox
  ip_consent      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── UNSUBSCRIBE LIST ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unsubscribe_list (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL UNIQUE,
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AUDIT LOGS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  performed_by    TEXT,
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recipients_token    ON recipients(token);
CREATE INDEX IF NOT EXISTS idx_recipients_email    ON recipients(email);
CREATE INDEX IF NOT EXISTS idx_events_campaign     ON email_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_events_recipient    ON email_events(recipient_id);
CREATE INDEX IF NOT EXISTS idx_events_type         ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created      ON email_events(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_campaign      ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity        ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_unsubscribe_email   ON unsubscribe_list(email);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
-- All tables are locked to service-role access only.
-- The frontend NEVER connects to Supabase directly.
-- Your Node.js backend uses the SERVICE ROLE key server-side.

ALTER TABLE campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE unsubscribe_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs      ENABLE ROW LEVEL SECURITY;

-- Block all access via anon/authenticated JWT tokens.
-- Only the service_role (used by your backend) can read/write.
CREATE POLICY "deny_anon_campaigns"
  ON campaigns FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_recipients"
  ON recipients FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_events"
  ON email_events FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_leads"
  ON leads FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_unsubscribe"
  ON unsubscribe_list FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_audit"
  ON audit_logs FOR ALL TO anon USING (false);

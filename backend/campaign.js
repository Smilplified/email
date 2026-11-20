/**
 * campaign.js – Campaign management + analytics API
 *
 * All routes require admin JWT (enforced by requireAdmin middleware).
 * CSV uploads use multer (memory storage, 5 MB limit).
 */

const express  = require('express');
const multer   = require('multer');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');
const { requireAdmin } = require('./auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ── Multer: in-memory CSV uploads, 5 MB max ───────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv files are allowed'));
    }
  }
});

// All campaign routes require admin login.
router.use(requireAdmin);

// ─────────────────────────────────────────────────────────────────
// CAMPAIGNS
// ─────────────────────────────────────────────────────────────────

// GET /api/campaigns  –  list all campaigns
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/campaigns  –  create a campaign
router.post('/', async (req, res) => {
  const { name, subject } = req.body;
  if (!name || !subject) return res.status(400).json({ error: 'name and subject required' });

  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name: name.trim(), subject: subject.trim() })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('audit_logs').insert({
    action: 'create_campaign',
    entity_type: 'campaign',
    entity_id: data.id,
    performed_by: 'admin',
    details: { name: data.name }
  });

  res.status(201).json(data);
});

// ─────────────────────────────────────────────────────────────────
// ANALYTICS – dashboard summary MUST be before /:id or Express
// will match the literal string "dashboard" as the :id parameter.
// ─────────────────────────────────────────────────────────────────

// GET /api/campaigns/dashboard/summary  –  aggregate stats across ALL campaigns
router.get('/dashboard/summary', async (req, res) => {
  const [camps, events, leads] = await Promise.all([
    supabase.from('campaigns').select('id, status', { count: 'exact' }),
    supabase.from('email_events').select('event_type, is_bot, recipient_id, created_at'),
    supabase.from('leads').select('id', { count: 'exact' })
  ]);

  const allEvents   = events.data || [];
  const humanEvents = allEvents.filter(e => !e.is_bot);

  const uniqueOpeners  = new Set(humanEvents.filter(e => e.event_type === 'open').map(e => e.recipient_id));
  const uniqueClickers = new Set(humanEvents.filter(e => e.event_type === 'click').map(e => e.recipient_id));

  const { count: sentCount } = await supabase
    .from('recipients')
    .select('id', { count: 'exact', head: true })
    .not('sent_at', 'is', null);

  res.json({
    total_campaigns:  camps.count || 0,
    emails_sent:      sentCount   || 0,
    unique_opens:     uniqueOpeners.size,
    unique_clicks:    uniqueClickers.size,
    form_submissions: leads.count  || 0
  });
});

// GET /api/campaigns/:id  –  single campaign details
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Campaign not found' });
  res.json(data);
});

// PUT /api/campaigns/:id/status  –  update status
router.put('/:id/status', async (req, res) => {
  const { status } = req.body;
  const valid = ['draft','sending','sent','paused','cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const { data, error } = await supabase
    .from('campaigns')
    .update({ status })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────
// RECIPIENTS – CSV upload
// ─────────────────────────────────────────────────────────────────

// POST /api/campaigns/:id/recipients  –  upload CSV
// Expected CSV columns: email, first_name (optional), last_name (optional), consent (optional: "true"/"false")
router.post('/:id/recipients', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

  // Check campaign exists
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', req.params.id)
    .single();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  let rows;
  try {
    rows = parse(req.file.buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid CSV: ' + e.message });
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const valid   = [];
  const invalid = [];

  for (const row of rows) {
    const email = (row.email || '').toLowerCase().trim();
    if (!EMAIL_RE.test(email)) { invalid.push(row); continue; }

    // Check unsubscribe list
    const { data: unsub } = await supabase
      .from('unsubscribe_list')
      .select('id')
      .eq('email', email)
      .limit(1);
    if (unsub && unsub.length > 0) { invalid.push({ ...row, reason: 'unsubscribed' }); continue; }

    const consent = row.consent === 'true' || row.consent === '1' || row.consent === 'yes';

    valid.push({
      campaign_id:  req.params.id,
      email,
      first_name:   row.first_name  || null,
      last_name:    row.last_name   || null,
      consent_given: consent,
      consent_date:  consent ? new Date().toISOString() : null
    });
  }

  if (valid.length === 0) {
    return res.status(400).json({ error: 'No valid email addresses found', invalid });
  }

  // Upsert in batches of 500 to stay within Supabase limits.
  // ignoreDuplicates: true means existing (campaign_id, email) rows are silently skipped.
  // We count the rows actually returned to get the true inserted count.
  const BATCH = 500;
  let inserted = 0;
  let upsertErrors = [];
  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    const { data: upserted, error } = await supabase
      .from('recipients')
      .upsert(batch, { onConflict: 'campaign_id,email', ignoreDuplicates: true })
      .select('id');
    if (error) {
      console.error('[recipients upsert]', error.message);
      upsertErrors.push(error.message);
    } else {
      inserted += upserted?.length ?? 0;
    }
  }

  if (upsertErrors.length) {
    return res.status(500).json({ error: 'Some records failed to insert', details: upsertErrors });
  }

  res.json({ inserted, skipped: invalid.length, invalid });
});

// GET /api/campaigns/:id/recipients  –  list recipients (paginated)
router.get('/:id/recipients', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, parseInt(req.query.limit || '50'));
  const from  = (page - 1) * limit;

  const { data, count, error } = await supabase
    .from('recipients')
    .select('*', { count: 'exact' })
    .eq('campaign_id', req.params.id)
    .range(from, from + limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, total: count, page, limit });
});

// ─────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────

// GET /api/campaigns/:id/stats  –  stats for one campaign
router.get('/:id/stats', async (req, res) => {
  const id = req.params.id;

  const [recipientsRes, eventsRes] = await Promise.all([
    supabase.from('recipients').select('id, sent_at', { count: 'exact' }).eq('campaign_id', id),
    supabase.from('email_events').select('event_type, is_bot, recipient_id').eq('campaign_id', id)
  ]);

  const recipients = recipientsRes.data || [];
  const events     = eventsRes.data     || [];

  const humanEvents    = events.filter(e => !e.is_bot);
  const uniqueOpeners  = new Set(humanEvents.filter(e => e.event_type === 'open').map(e => e.recipient_id));
  const uniqueClickers = new Set(humanEvents.filter(e => e.event_type === 'click').map(e => e.recipient_id));
  const formSubmits    = humanEvents.filter(e => e.event_type === 'form_submit').length;
  const unsubscribes   = humanEvents.filter(e => e.event_type === 'unsubscribe').length;

  const sent = recipients.filter(r => r.sent_at).length;

  res.json({
    total_recipients: recipients.length,
    sent,
    unique_opens:    uniqueOpeners.size,
    unique_clicks:   uniqueClickers.size,
    form_submits:    formSubmits,
    unsubscribes,
    open_rate:       sent > 0 ? ((uniqueOpeners.size / sent) * 100).toFixed(1) : '0.0',
    click_rate:      sent > 0 ? ((uniqueClickers.size / sent) * 100).toFixed(1) : '0.0'
  });
});

// GET /api/campaigns/:id/events  –  event history (paginated, last 200)
router.get('/:id/events', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(200, parseInt(req.query.limit || '50'));
  const from  = (page - 1) * limit;

  const { data, count, error } = await supabase
    .from('email_events')
    .select('*, recipients(email, first_name)', { count: 'exact' })
    .eq('campaign_id', req.params.id)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, total: count, page, limit });
});

// GET /api/campaigns/:id/leads  –  leads list (paginated)
router.get('/:id/leads', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, parseInt(req.query.limit || '50'));
  const from  = (page - 1) * limit;

  const { data, count, error } = await supabase
    .from('leads')
    .select('id, email, first_name, last_name, phone, company, message, ip_consent, created_at', { count: 'exact' })
    .eq('campaign_id', req.params.id)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, total: count, page, limit });
});

// ─────────────────────────────────────────────────────────────────
// TRACKING LINK GENERATOR
// Returns the tracking-wrapped URLs for a specific recipient.
// Use this to build the personalised HTML you paste into Benchmark.
// ─────────────────────────────────────────────────────────────────

// GET /api/campaigns/:id/tracking-links/:recipientId
router.get('/:id/tracking-links/:recipientId', async (req, res) => {
  const { data: recipient, error } = await supabase
    .from('recipients')
    .select('token, email, first_name')
    .eq('id', req.params.recipientId)
    .eq('campaign_id', req.params.id)
    .single();

  if (error || !recipient) return res.status(404).json({ error: 'Recipient not found' });

  const base = process.env.BACKEND_URL || 'http://localhost:3000';
  const token = recipient.token;

  res.json({
    email:         recipient.email,
    first_name:    recipient.first_name,
    open_pixel:    `${base}/track/open/${token}`,
    click_base:    `${base}/track/click/${token}?url=`,
    form_endpoint: `${base}/track/form/${token}`,
    unsubscribe:   `${base}/track/unsubscribe/${token}`
  });
});

// ─────────────────────────────────────────────────────────────────
// CSV EXPORT  –  GET /api/campaigns/:id/export?type=events|leads
// ─────────────────────────────────────────────────────────────────
router.get('/:id/export', async (req, res) => {
  const type = req.query.type === 'leads' ? 'leads' : 'events';

  let rows = [];
  if (type === 'events') {
    const { data } = await supabase
      .from('email_events')
      .select('id, event_type, url, is_bot, created_at, recipients(email)')
      .eq('campaign_id', req.params.id)
      .order('created_at', { ascending: false });
    rows = (data || []).map(r => ({
      id:         r.id,
      email:      r.recipients?.email || '',
      event_type: r.event_type,
      url:        r.url || '',
      is_bot:     r.is_bot,
      created_at: r.created_at
    }));
  } else {
    const { data } = await supabase
      .from('leads')
      .select('id, email, first_name, last_name, phone, company, message, ip_consent, created_at')
      .eq('campaign_id', req.params.id)
      .order('created_at', { ascending: false });
    rows = data || [];
  }

  if (!rows.length) return res.status(404).json({ error: 'No data to export' });

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
  ].join('\n');

  res.set({
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="campaign_${req.params.id}_${type}.csv"`
  });
  res.send(csv);
});

module.exports = router;

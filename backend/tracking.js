/**
 * tracking.js – open pixel, click redirect, form submission, unsubscribe
 *
 * Design decisions:
 * - All DB writes complete BEFORE the response is sent. On Vercel serverless,
 *   any work started after res.send()/res.redirect() is not guaranteed to run.
 * - Events are only recorded for recipients with consent_given = true.
 * - Bot/scanner detection flags suspected automated traffic as is_bot=true.
 *   Flagged events are stored but excluded from dashboard counts.
 * - Unsubscribe requires a two-step confirmation (GET = confirm page, POST = act).
 *   This prevents email security scanners from accidentally unsubscribing recipients
 *   by prefetching every link in an email.
 * - IP addresses are stored ONLY on form submission with explicit user consent.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ── 1×1 transparent GIF ──────────────────────────────────────────
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// ── Bot / scanner User-Agent patterns ────────────────────────────
const BOT_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /preview/i, /scanner/i,
  /facebookexternalhit/i, /linkedinbot/i, /twitterbot/i,
  /slackbot/i, /whatsapp/i, /googleimageproxy/i, /yahoo.*mail/i,
  /outlook.*link.*preview/i, /microsoft.*link.*preview/i,
  /proofpoint/i, /barracuda/i, /mimecast/i
];

function isBot(userAgent) {
  if (!userAgent) return false;
  return BOT_PATTERNS.some(p => p.test(userAgent));
}

// ── Validate token and fetch recipient ───────────────────────────
// Returns null for invalid tokens.
// Also fetches consent_given – events are only recorded when true.
async function getRecipient(token) {
  if (!token || typeof token !== 'string' || token.length !== 48) return null;
  const { data, error } = await supabase
    .from('recipients')
    .select('id, campaign_id, email, consent_given')
    .eq('token', token)
    .single();
  if (error || !data) return null;
  return data;
}

// ── Duplicate guard: same event within 5 seconds ─────────────────
async function isDuplicate(recipientId, eventType, url) {
  const fiveSecsAgo = new Date(Date.now() - 5000).toISOString();
  let query = supabase
    .from('email_events')
    .select('id')
    .eq('recipient_id', recipientId)
    .eq('event_type', eventType)
    .gte('created_at', fiveSecsAgo);
  if (url) query = query.eq('url', url);
  const { data } = await query.limit(1);
  return data && data.length > 0;
}

// ── Record event ──────────────────────────────────────────────────
async function recordEvent(campaignId, recipientId, eventType, extras = {}) {
  const { error } = await supabase.from('email_events').insert({
    campaign_id:  campaignId,
    recipient_id: recipientId,
    event_type:   eventType,
    ...extras
  });
  if (error) console.error(`[recordEvent] ${eventType} error:`, error.message);
}

// ─────────────────────────────────────────────────────────────────
// GET /track/open/:token
// All async DB work runs BEFORE res.send() so it completes on Vercel.
// ─────────────────────────────────────────────────────────────────
router.get('/open/:token', async (req, res) => {
  const ua        = req.headers['user-agent'] || '';
  const bot       = isBot(ua);
  const recipient = await getRecipient(req.params.token);

  // Record only if recipient exists and gave consent.
  if (recipient && recipient.consent_given) {
    const dup = await isDuplicate(recipient.id, 'open', null);
    if (!dup) {
      await recordEvent(recipient.campaign_id, recipient.id, 'open', {
        user_agent: ua.slice(0, 500),
        is_bot:     bot
      });
    }
  }

  // Send pixel AFTER all DB work – required for Vercel serverless.
  res.set({
    'Content-Type':  'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma':        'no-cache'
  });
  res.send(PIXEL);
});

// ─────────────────────────────────────────────────────────────────
// GET /track/click/:token?url=DESTINATION_URL
// DB work completes BEFORE redirect so it isn't dropped on Vercel.
// ─────────────────────────────────────────────────────────────────
router.get('/click/:token', async (req, res) => {
  const destination = req.query.url;

  if (!destination) return res.status(400).send('Missing url parameter');

  // Validate destination – only allow http/https to prevent open redirect abuse.
  let destUrl;
  try {
    destUrl = new URL(destination);
    if (!['http:', 'https:'].includes(destUrl.protocol)) throw new Error('invalid protocol');
  } catch {
    return res.redirect(302, 'https://example.com');
  }

  const ua        = req.headers['user-agent'] || '';
  const bot       = isBot(ua);
  const recipient = await getRecipient(req.params.token);

  // Record only for consenting recipients.
  if (recipient && recipient.consent_given) {
    const dup = await isDuplicate(recipient.id, 'click', destUrl.toString());
    if (!dup) {
      await recordEvent(recipient.campaign_id, recipient.id, 'click', {
        url:        destUrl.toString().slice(0, 2048),
        user_agent: ua.slice(0, 500),
        is_bot:     bot
      });
    }
  }

  // Redirect AFTER DB work.
  res.redirect(302, destUrl.toString());
});

// ─────────────────────────────────────────────────────────────────
// POST /track/form/:token
// IP stored ONLY when ip_consent = true (user ticked checkbox).
// ─────────────────────────────────────────────────────────────────
router.post('/form/:token', async (req, res) => {
  const recipient = await getRecipient(req.params.token);
  if (!recipient) return res.status(400).json({ error: 'Invalid token' });

  const {
    first_name, last_name, phone, company, message,
    ip_consent
  } = req.body;

  const email = recipient.email;
  if (!email) return res.status(400).json({ error: 'No email associated with token' });

  const consentGiven = ip_consent === true || ip_consent === 'true';

  // req.ip is correct because server.js sets trust proxy 1.
  const ip = consentGiven ? (req.ip || null) : null;

  const { error } = await supabase.from('leads').insert({
    campaign_id:  recipient.campaign_id,
    recipient_id: recipient.id,
    email,
    first_name:   first_name || null,
    last_name:    last_name  || null,
    phone:        phone      || null,
    company:      company    || null,
    message:      message    || null,
    ip_address:   ip,
    ip_consent:   consentGiven
  });

  if (error) {
    console.error('[form] insert error', error.message);
    return res.status(500).json({ error: 'Failed to save lead' });
  }

  await recordEvent(recipient.campaign_id, recipient.id, 'form_submit', {
    user_agent: (req.headers['user-agent'] || '').slice(0, 500)
  });

  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────
// GET /track/unsubscribe/:token
// Shows a confirmation page – does NOT unsubscribe yet.
// This prevents email security scanners from triggering unsubscribes
// by pre-fetching all links in an email.
// ─────────────────────────────────────────────────────────────────
router.get('/unsubscribe/:token', async (req, res) => {
  const recipient = await getRecipient(req.params.token);
  if (!recipient) {
    return res.status(400).send('<h2>Invalid unsubscribe link.</h2>');
  }

  const token = req.params.token;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 60px auto; text-align: center; padding: 0 20px; }
    .btn { display: inline-block; padding: 12px 28px; background: #dc2626; color: #fff;
           border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; margin-top: 16px; }
    .btn:hover { background: #b91c1c; }
    p { color: #64748b; line-height: 1.6; }
  </style>
</head>
<body>
  <h2>Unsubscribe Request</h2>
  <p>You are about to unsubscribe <strong>${escapeHtml(recipient.email)}</strong>
     from future emails. This cannot be undone.</p>
  <form method="POST" action="/track/unsubscribe/${escapeHtml(token)}">
    <button type="submit" class="btn">Confirm Unsubscribe</button>
  </form>
  <p style="margin-top:16px"><a href="/">Cancel</a></p>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────
// POST /track/unsubscribe/:token
// Performs the actual unsubscribe after the user confirms.
// ─────────────────────────────────────────────────────────────────
router.post('/unsubscribe/:token', async (req, res) => {
  const recipient = await getRecipient(req.params.token);
  if (!recipient) {
    return res.status(400).send('<h2>Invalid unsubscribe link.</h2>');
  }

  const { error } = await supabase.from('unsubscribe_list').upsert(
    { email: recipient.email, campaign_id: recipient.campaign_id },
    { onConflict: 'email' }
  );

  if (error) console.error('[unsubscribe] upsert error:', error.message);

  await recordEvent(recipient.campaign_id, recipient.id, 'unsubscribe');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Unsubscribed</title>
  <style>body{font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;}</style>
</head>
<body>
  <h2>You have been unsubscribed.</h2>
  <p>You will no longer receive emails from this campaign.</p>
</body>
</html>`);
});

// ── HTML escaping helper (used in unsubscribe confirmation page) ──
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

module.exports = router;

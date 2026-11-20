# Email Campaign Tracking System

Node.js + Express backend · Supabase database · Vercel hosting · Benchmark Email sending

---

## Project structure

```
Email_tracking/
  api/
    index.js              ← Vercel serverless entry point (imports Express app)
  backend/
    server.js             ← Express app: routes, static files, exported for Vercel
    tracking.js           ← /track/* endpoints (open, click, form, unsubscribe)
    campaign.js           ← /api/campaigns/* CRUD + analytics + CSV upload
    auth.js               ← Admin login (JWT) + requireAdmin middleware
    .env.example          ← Template – copy to .env and fill in secrets
  frontend/
    index.html            ← Login page
    dashboard.html        ← Analytics overview
    campaigns.html        ← Campaign list + detail
    form.html             ← Recipient-facing contact form
    css/style.css
    js/auth.js, dashboard.js, campaigns.js
  database/
    schema.sql                        ← Run once in Supabase
    migration_001_unique_recipient.sql ← Run after schema.sql
  package.json            ← Root – Vercel installs dependencies from here
  vercel.json             ← Vercel routing config
  .gitignore
  README.md
```

---

## Step 1 – Run the database schema in Supabase

1. Go to https://supabase.com and open your project.
2. Click **SQL Editor** → **New query**.
3. Open `database/schema.sql`, copy everything (Ctrl+A then Ctrl+C), paste, click **Run**.
4. Run `database/migration_001_unique_recipient.sql` the same way immediately after.

> The migration adds the `UNIQUE(campaign_id, email)` constraint required by CSV upload.
> It is safe to run even on an empty table.

---

## Step 2 – Get Supabase credentials

1. Supabase → **Project Settings → API**.
2. Copy **Project URL** (e.g. `https://abcdef.supabase.co`).
3. Under **Secret keys**, click the eye icon → copy the `sb_secret_...` key.

> The secret key is server-side only. It never goes in frontend HTML or JS.

---

## Step 3 – Run locally (Windows)

### 3a – Install Node.js (if not installed)
Download from https://nodejs.org and install version 18 or higher.

### 3b – Install dependencies
Open a terminal in VS Code (Ctrl+`). Make sure you are in the **project root**
(`Email_tracking/`), then run:
```
npm install
```

### 3c – Create your .env file
In the `backend/` folder, copy `.env.example` to `.env`:
```
copy backend\.env.example backend\.env
```
Open `backend\.env` and fill in:
```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_your_key_here
PORT=3000
BACKEND_URL=http://localhost:3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose_a_strong_password
JWT_SECRET=paste_the_64_char_random_string_here
```

Generate a JWT secret in PowerShell:
```powershell
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

### 3d – Start the server
From the project root:
```
npm run dev
```
Open **http://localhost:3000** in your browser. Login page appears.

> No Live Server extension needed. Express serves both the API and the frontend files.

---

## Step 4 – Deploy to Vercel

### 4a – Push your project to GitHub

1. Create a new **private** repository on https://github.com.
2. In the `Email_tracking/` folder, open a terminal and run:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```
3. Confirm that `backend/.env` does **not** appear in the commit (it is in `.gitignore`).

### 4b – Import to Vercel

1. Go to https://vercel.com and sign in (or sign up free).
2. Click **Add New → Project**.
3. Click **Import** next to your GitHub repository.
4. Vercel auto-detects the project. Leave all settings at their defaults.
   - Framework preset: **Other**
   - Root directory: `.` (project root)
   - Build command: *(leave empty)*
   - Output directory: *(leave empty)*
5. Click **Deploy** – skip the environment variables for now.
6. Wait for the first deploy to finish (it will fail because .env secrets are missing – that is expected).

### 4c – Add environment variables in Vercel

1. In Vercel, go to your project → **Settings → Environment Variables**.
2. Add each of the following (one at a time, all environments: Production + Preview + Development):

| Name | Value |
|------|-------|
| `SUPABASE_URL` | `https://your-project-id.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | your `sb_secret_...` key |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | your strong password |
| `JWT_SECRET` | your 64-char random string |
| `BACKEND_URL` | *(leave blank – Vercel sets this automatically)* |

> Do NOT add FRONTEND_URL on Vercel. Frontend and API share the same domain so CORS is not needed.

### 4d – Redeploy

1. Go to **Deployments** tab → click the three dots on the latest deployment → **Redeploy**.
2. After it succeeds, click **Visit** to open your live URL.
3. The login page should appear at `https://your-app.vercel.app`.

---

## Step 5 – Create a campaign and upload recipients

1. Log in at your Vercel URL.
2. Go to **Campaigns** → fill in name and subject → **Create Campaign**.
3. Click the campaign name to open its detail page.
4. Prepare a CSV file:
   ```
   email,first_name,last_name,consent
   john@example.com,John,Smith,true
   jane@example.com,Jane,Doe,true
   ```
5. Upload it on the detail page.

---

## Step 6 – Get tracking links for a recipient

After uploading recipients, call the tracking-links endpoint from your browser or any API tool (like Hoppscotch):

```
GET https://your-app.vercel.app/api/campaigns/CAMPAIGN_ID/tracking-links/RECIPIENT_ID
Authorization: Bearer YOUR_JWT_TOKEN
```

Response:
```json
{
  "email": "john@example.com",
  "open_pixel": "https://your-app.vercel.app/track/open/TOKEN",
  "click_base": "https://your-app.vercel.app/track/click/TOKEN?url=",
  "form_endpoint": "https://your-app.vercel.app/track/form/TOKEN",
  "unsubscribe": "https://your-app.vercel.app/track/unsubscribe/TOKEN"
}
```

---

## Step 7 – Benchmark Email integration

### What Benchmark Email does
- Delivers your HTML email via SMTP to your recipients.
- Has its own open pixel and click tracker (shows in Benchmark's own dashboard).
- Those are separate from your backend tracking.

### What your backend does
- Records open/click/form/unsubscribe events in your Supabase database.
- Gives you full control over the data.

### How to send a tracked email through Benchmark

**Key limitation**: Benchmark Email does NOT support custom merge tags that you define yourself. Only Benchmark's built-in tags (like `{firstname}`, `{email}`) work. This means you cannot put `{{TRACKING_TOKEN}}` in your template and have Benchmark replace it per-recipient automatically.

**Workaround for small campaigns (up to ~200 recipients)**:

1. Use the tracking-links endpoint to get personalised URLs for each recipient.
2. Build a separate HTML file per recipient with their specific token embedded.
3. Upload each HTML into Benchmark as a separate campaign, targeted to that one recipient.

**Workaround for large campaigns (500–5000 recipients)**:

Skip Benchmark for delivery. Use Nodemailer with your own SMTP:

1. Set SMTP credentials in `.env` and in Vercel environment variables:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=your_app_password
   SMTP_FROM=you@gmail.com
   ```
2. The backend can then send one personalised email per recipient with the correct tracking token already embedded.
3. This is the only reliable way to get per-recipient tracking at scale.

> IMPORTANT: Never use both Benchmark AND Nodemailer for the same campaign. Choose one per campaign.

### Tracking pixel (paste inside your email HTML)
```html
<img src="https://your-app.vercel.app/track/open/RECIPIENT_TOKEN"
     width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">
```

### Tracked link
```html
<a href="https://your-app.vercel.app/track/click/RECIPIENT_TOKEN?url=https%3A%2F%2Fyourwebsite.com%2Foffer">
  View Offer
</a>
```

### Form link
```html
<a href="https://your-app.vercel.app/form.html?t=RECIPIENT_TOKEN">
  Request a Quote
</a>
```

---

## Step 8 – Test tracking events

**Open event** – visit in browser:
```
https://your-app.vercel.app/track/open/PASTE_A_TOKEN_HERE
```
Check Supabase → Table Editor → `email_events` for a new row with `event_type = 'open'`.

**Click event**:
```
https://your-app.vercel.app/track/click/PASTE_TOKEN?url=https://google.com
```
Browser redirects to Google. Check `email_events` for `event_type = 'click'`.

**Form submission** – open:
```
https://your-app.vercel.app/form.html?t=PASTE_TOKEN
```
Fill out the form, tick the consent checkbox, submit. Check `leads` table.

**Unsubscribe**:
```
https://your-app.vercel.app/track/unsubscribe/PASTE_TOKEN
```
Check `unsubscribe_list` table.

---

## Security summary

| Feature | Detail |
|---------|--------|
| Supabase service key | Backend only. Never in HTML or JS. RLS blocks all browser access. |
| Admin auth | JWT, 8h expiry, stored in sessionStorage only |
| Fallback credentials | None. Server refuses to start if `ADMIN_PASSWORD` or `JWT_SECRET` are missing |
| Bot detection | User-Agent patterns; bots recorded but excluded from dashboard counts |
| IP collection | Only stored in `leads.ip_address` when user ticks the consent checkbox |
| Rate limiting | 100 req/15 min global; 30 req/min tracking; 5 login attempts/15 min |
| CSV uploads | Email validated, unsubscribe list checked, 5 MB size limit |

---

## Vercel free plan limits to be aware of

| Limit | Value |
|-------|-------|
| Serverless function timeout | 10 seconds (hobby plan) |
| Request body size | 4.5 MB |
| Bandwidth | 100 GB/month |

The 10-second timeout means very large CSV uploads (thousands of rows) may time out. For campaigns over 1,000 recipients, split your CSV into batches of 500 rows.

---

## Benchmark Email vs. your backend – quick reference

| Feature | Benchmark Email | Your Backend |
|---------|-----------------|--------------|
| SMTP delivery | ✅ | Optional (Nodemailer) |
| Bounce handling | ✅ | ❌ |
| Per-recipient custom tokens | ❌ (not supported) | ✅ |
| Open tracking (their data) | ✅ | Your pixel |
| Click tracking (their data) | ✅ | Your links |
| Your Supabase analytics | ❌ | ✅ |
| Form submissions | ❌ | ✅ |
| Bot detection | ❌ | ✅ |
| Consent-based IP | ❌ | ✅ |
| CSV export | Limited | ✅ |

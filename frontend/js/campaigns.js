import { requireLogin, logout, apiFetch } from './auth.js';

requireLogin();
document.getElementById('logout-btn')?.addEventListener('click', logout);

const params     = new URLSearchParams(location.search);
const campaignId = params.get('id');

// ── Helper ───────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showAlert(id, msg, type = 'success') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ════════════════════════════════════════════════════════════════
// LIST VIEW  (no ?id in URL)
// ════════════════════════════════════════════════════════════════
if (!campaignId) {
  loadList();

  document.getElementById('create-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await apiFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name:    document.getElementById('c-name').value.trim(),
          subject: document.getElementById('c-subject').value.trim()
        })
      });
      showAlert('create-alert', 'Campaign created!');
      e.target.reset();
      loadList();
    } catch (err) {
      showAlert('create-alert', err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadList() {
  const tbody = document.getElementById('campaigns-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  try {
    const campaigns = await apiFetch('/api/campaigns');
    tbody.innerHTML = '';
    if (!campaigns.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px">No campaigns yet. Create one above.</td></tr>';
      return;
    }
    for (const c of campaigns) {
      const statusClass = {
        draft:'badge-muted', sending:'badge-info', sent:'badge-success',
        paused:'badge-warning', cancelled:'badge-danger'
      }[c.status] || 'badge-muted';
      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td><a href="campaigns.html?id=${c.id}">${escHtml(c.name)}</a></td>
          <td>${escHtml(c.subject)}</td>
          <td><span class="badge ${statusClass}">${c.status}</span></td>
          <td>${c.sent_count.toLocaleString()}</td>
          <td>${new Date(c.created_at).toLocaleDateString()}</td>
        </tr>
      `);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:red">${escHtml(err.message)}</td></tr>`;
  }
}


// ════════════════════════════════════════════════════════════════
// DETAIL VIEW  (?id=UUID in URL)
// ════════════════════════════════════════════════════════════════
if (campaignId) {
  loadDetail();
  loadStats();
  loadEvents();
  setupCsvUpload();
  setupStatusButtons();
  setupExportButtons();
}

async function loadDetail() {
  try {
    const c = await apiFetch(`/api/campaigns/${campaignId}`);
    document.getElementById('campaign-title').textContent  = c.name;
    document.getElementById('campaign-subject').textContent = c.subject;
    document.getElementById('campaign-status').textContent  = c.status;
  } catch (err) {
    console.error(err);
  }
}

async function loadStats() {
  try {
    const s = await apiFetch(`/api/campaigns/${campaignId}/stats`);
    document.getElementById('stat-sent').textContent         = s.sent.toLocaleString();
    document.getElementById('stat-opens').textContent        = `${s.unique_opens} (${s.open_rate}%)`;
    document.getElementById('stat-clicks').textContent       = `${s.unique_clicks} (${s.click_rate}%)`;
    document.getElementById('stat-forms').textContent        = s.form_submits.toLocaleString();
    document.getElementById('stat-unsubscribes').textContent = s.unsubscribes.toLocaleString();
  } catch (err) {
    console.error('Stats error:', err);
  }
}

let eventsPage = 1;
async function loadEvents() {
  const tbody = document.getElementById('events-tbody');
  if (!tbody) return;
  try {
    const r = await apiFetch(`/api/campaigns/${campaignId}/events?page=${eventsPage}&limit=50`);
    tbody.innerHTML = '';
    if (!r.data?.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:16px">No events yet.</td></tr>';
      return;
    }
    for (const ev of r.data) {
      const typeClass = {
        open:'badge-info', click:'badge-success', form_submit:'badge-warning', unsubscribe:'badge-danger'
      }[ev.event_type] || 'badge-muted';
      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${escHtml(ev.recipients?.email || '—')}</td>
          <td><span class="badge ${typeClass}">${escHtml(ev.event_type)}</span></td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(ev.url || '—')}</td>
          <td>${ev.is_bot ? '<span class="badge badge-danger">bot</span>' : '<span class="badge badge-success">human</span>'}</td>
          <td>${new Date(ev.created_at).toLocaleString()}</td>
        </tr>
      `);
    }
    document.getElementById('events-count').textContent = `${r.total} events`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:red">${escHtml(err.message)}</td></tr>`;
  }
}

function setupCsvUpload() {
  const form = document.getElementById('csv-form');
  if (!form) return;
  const zone    = document.getElementById('upload-zone');
  const fileIn  = document.getElementById('csv-file');

  zone?.addEventListener('click', () => fileIn.click());
  zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone?.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) { const dt = new DataTransfer(); dt.items.add(file); fileIn.files = dt.files; updateZoneLabel(file.name); }
  });
  fileIn?.addEventListener('change', () => {
    if (fileIn.files[0]) updateZoneLabel(fileIn.files[0].name);
  });

  function updateZoneLabel(name) {
    const p = zone?.querySelector('p');
    if (p) p.textContent = `Selected: ${name}`;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (!fileIn.files[0]) { showAlert('csv-alert', 'Please select a CSV file', 'error'); return; }
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    const fd = new FormData();
    fd.append('file', fileIn.files[0]);
    try {
      const API_BASE = window.APP_CONFIG?.apiBase ?? '';
      const token = sessionStorage.getItem('admin_token');
      const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/recipients`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      showAlert('csv-alert', `Imported ${json.inserted} recipients. Skipped: ${json.skipped}.`);
      form.reset();
      if (zone?.querySelector('p')) zone.querySelector('p').textContent = 'Drag & drop CSV or click to browse';
      loadStats();
    } catch (err) {
      showAlert('csv-alert', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload Recipients';
    }
  });
}

function setupStatusButtons() {
  document.querySelectorAll('[data-set-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.setStatus;
      try {
        await apiFetch(`/api/campaigns/${campaignId}/status`, {
          method: 'PUT', body: JSON.stringify({ status })
        });
        showAlert('status-alert', `Status changed to "${status}"`);
        loadDetail();
      } catch (err) {
        showAlert('status-alert', err.message, 'error');
      }
    });
  });
}

function setupExportButtons() {
  document.getElementById('export-events')?.addEventListener('click', () => {
    exportCSV('events');
  });
  document.getElementById('export-leads')?.addEventListener('click', () => {
    exportCSV('leads');
  });
}

function exportCSV(type) {
  const API_BASE = window.APP_CONFIG?.apiBase ?? '';
  const token    = sessionStorage.getItem('admin_token');
  const url      = `${API_BASE}/api/campaigns/${campaignId}/export?type=${type}`;
  // Trigger download via a temporary link
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', '');
  // Note: Authorization header can't be set in anchor href downloads.
  // Instead we fetch the data and create a blob URL.
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.ok ? r.blob() : Promise.reject('Export failed'))
    .then(blob => {
      const burl = URL.createObjectURL(blob);
      a.href = burl;
      a.click();
      setTimeout(() => URL.revokeObjectURL(burl), 5000);
    })
    .catch(err => alert('Export error: ' + err));
}

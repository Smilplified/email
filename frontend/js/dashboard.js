import { requireLogin, logout, apiFetch } from './auth.js';

requireLogin();

document.getElementById('logout-btn')?.addEventListener('click', logout);

async function loadSummary() {
  try {
    const data = await apiFetch('/api/campaigns/dashboard/summary');
    document.getElementById('stat-campaigns').textContent = data.total_campaigns;
    document.getElementById('stat-sent').textContent      = data.emails_sent.toLocaleString();
    document.getElementById('stat-opens').textContent     = data.unique_opens.toLocaleString();
    document.getElementById('stat-clicks').textContent    = data.unique_clicks.toLocaleString();
    document.getElementById('stat-forms').textContent     = data.form_submissions.toLocaleString();
  } catch (err) {
    console.error('Summary error:', err);
  }
}

async function loadRecentCampaigns() {
  const tbody = document.getElementById('campaigns-tbody');
  if (!tbody) return;
  try {
    const campaigns = await apiFetch('/api/campaigns');
    tbody.innerHTML = '';
    if (!campaigns.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px">No campaigns yet.</td></tr>';
      return;
    }
    for (const c of campaigns.slice(0, 10)) {
      const statusClass = {
        draft:'badge-muted', sending:'badge-info',
        sent:'badge-success', paused:'badge-warning', cancelled:'badge-danger'
      }[c.status] || 'badge-muted';

      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td><a href="/campaigns.html?id=${c.id}">${escHtml(c.name)}</a></td>
          <td>${escHtml(c.subject)}</td>
          <td><span class="badge ${statusClass}">${c.status}</span></td>
          <td>${c.sent_count.toLocaleString()}</td>
          <td>${new Date(c.created_at).toLocaleDateString()}</td>
        </tr>
      `);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:red">Error: ${escHtml(err.message)}</td></tr>`;
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

loadSummary();
loadRecentCampaigns();

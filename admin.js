const loginView = document.querySelector('#login-view');
const dashboardView = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const enquiriesList = document.querySelector('#enquiries-list');
const adminEmail = document.querySelector('#admin-email');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showDashboard(email) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  adminEmail.textContent = email;
  loadEnquiries();
}

function renderEnquiries(enquiries) {
  if (!enquiries.length) { enquiriesList.innerHTML = '<div class="empty-state"><strong>No enquiries yet</strong><span>New quote requests will appear here.</span></div>'; return; }
  enquiriesList.innerHTML = enquiries.map((item) => `<article class="enquiry-card"><div class="enquiry-top"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.project)} · ${formatDate(item.created_at)}</span></div><select data-id="${item.id}" class="status-select" aria-label="Update status for ${escapeHtml(item.name)}"><option value="new" ${item.status === 'new' ? 'selected' : ''}>New</option><option value="contacted" ${item.status === 'contacted' ? 'selected' : ''}>Contacted</option><option value="completed" ${item.status === 'completed' ? 'selected' : ''}>Completed</option></select></div><dl><div><dt>Phone</dt><dd><a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a></dd></div><div><dt>Email</dt><dd>${item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : 'Not provided'}</dd></div><div><dt>Location</dt><dd>${escapeHtml(item.location)}</dd></div><div><dt>Start</dt><dd>${escapeHtml(item.start_date || 'Not provided')}</dd></div></dl><p>${escapeHtml(item.details)}</p></article>`).join('');
  enquiriesList.querySelectorAll('.status-select').forEach((select) => select.addEventListener('change', async () => { select.disabled = true; try { await request(`/api/admin/enquiries/${select.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); } catch { select.value = 'new'; } finally { select.disabled = false; } }));
}

async function loadEnquiries() {
  try { renderEnquiries(await request('/api/admin/enquiries')); } catch { enquiriesList.innerHTML = '<p class="muted">Could not load enquiries. Try refresh.</p>'; }
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault(); loginMessage.textContent = 'Signing in…'; loginMessage.className = 'form-message';
  const data = Object.fromEntries(new FormData(loginForm));
  try { const result = await request('/api/admin/login', { method: 'POST', body: JSON.stringify(data) }); showDashboard(result.email); } catch { loginMessage.textContent = 'Email or password was not recognised.'; loginMessage.className = 'form-message error'; }
});
document.querySelector('#refresh-button')?.addEventListener('click', loadEnquiries);
document.querySelector('#logout-button')?.addEventListener('click', async () => { await request('/api/admin/logout', { method: 'POST' }); window.location.reload(); });

request('/api/admin/me').then((data) => { if (data.authenticated) showDashboard(data.email); }).catch(() => {});

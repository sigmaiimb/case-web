const API = 'http://localhost:3000/api';
let currentCaseId = null;
let allCases = [];

async function loadFilters() {
  const res = await fetch(`${API}/filters`);
  const { industries, case_types } = await res.json();
  const iSel = document.getElementById('filterIndustry');
  const tSel = document.getElementById('filterType');
  industries.forEach(i => iSel.innerHTML += `<option value="${i}">${i}</option>`);
  case_types.forEach(t => tSel.innerHTML += `<option value="${t}">${t}</option>`);
}

async function loadCases() {
  const search = document.getElementById('searchInput').value;
  const industry = document.getElementById('filterIndustry').value;
  const case_type = document.getElementById('filterType').value;
  const outcome = document.getElementById('filterOutcome').value;

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (industry) params.set('industry', industry);
  if (case_type) params.set('case_type', case_type);
  if (outcome) params.set('outcome', outcome);

  const res = await fetch(`${API}/cases?${params}`);
  allCases = await res.json();
  renderCases(allCases);
}

function renderCases(cases) {
  const grid = document.getElementById('caseGrid');
  const empty = document.getElementById('emptyState');
  const stats = document.getElementById('stats');

  const total = cases.length;
  const passed = cases.filter(c => c.outcome === 'Pass').length;
  const failed = cases.filter(c => c.outcome === 'Fail').length;
  stats.textContent = total
    ? `${total} case${total !== 1 ? 's' : ''} · ${passed} pass · ${failed} fail`
    : '';

  if (!cases.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  grid.innerHTML = cases.map(c => `
    <div class="case-card" onclick="openModal(${c.id})">
      <div class="card-top">
        <div class="card-firm">${esc(c.firm)}</div>
        <span class="outcome-badge outcome-${c.outcome || ''}">${c.outcome || '—'}</span>
      </div>
      <div class="card-meta">
        ${c.case_type ? `<span class="tag">${esc(c.case_type)}</span>` : ''}
        ${c.industry ? `<span class="tag">${esc(c.industry)}</span>` : ''}
        ${c.round ? `<span class="tag">${esc(c.round)}</span>` : ''}
      </div>
      ${c.problem_statement ? `<div class="card-problem">${esc(c.problem_statement)}</div>` : ''}
      ${c.date ? `<div class="card-date">${fmt(c.date)}</div>` : ''}
    </div>
  `).join('');
}

async function openModal(id) {
  currentCaseId = id;
  const res = await fetch(`${API}/cases/${id}`);
  const c = await res.json();

  document.getElementById('modalTitle').textContent = `${c.firm}${c.round ? ' · ' + c.round : ''}`;

  document.getElementById('modalBody').innerHTML = `
    <div class="detail-grid">
      ${field('Case Type', c.case_type)}
      ${field('Industry', c.industry)}
      ${field('Date', c.date ? fmt(c.date) : null)}
      ${field('Outcome', c.outcome)}
    </div>
    ${section('Problem Statement', c.problem_statement)}
    ${section('My Approach / Framework', c.my_approach)}
    ${section('Key Insights & Recommendations', c.key_insights)}
    ${section('Notes / Feedback', c.notes)}
  `;

  document.getElementById('modal').style.display = 'flex';
}

function field(label, val) {
  if (!val) return '';
  return `<div class="detail-section"><div class="detail-label">${label}</div><div class="detail-value">${esc(val)}</div></div>`;
}
function section(label, val) {
  if (!val) return '';
  return `<div class="detail-section"><div class="detail-label">${label}</div><div class="detail-value">${esc(val)}</div></div>`;
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  currentCaseId = null;
}

function editCase(id) {
  window.location.href = `add.html?id=${id}`;
}

async function deleteCase(id) {
  if (!confirm('Delete this case?')) return;
  await fetch(`${API}/cases/${id}`, { method: 'DELETE' });
  closeModal();
  loadCases();
  toast('Case deleted');
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// Debounce search
let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadCases, 300);
});
document.getElementById('filterIndustry').addEventListener('change', loadCases);
document.getElementById('filterType').addEventListener('change', loadCases);
document.getElementById('filterOutcome').addEventListener('change', loadCases);

// Close modal on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

loadFilters();
loadCases();

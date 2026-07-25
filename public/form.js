const API = 'http://localhost:3000/api';

const params = new URLSearchParams(location.search);
const editId = params.get('id');

if (editId) {
  document.getElementById('formTitle').textContent = 'Edit Case Experience';
  fetch(`${API}/cases/${editId}`)
    .then(r => r.json())
    .then(c => {
      document.getElementById('caseId').value = c.id;
      document.getElementById('firm').value = c.firm || '';
      document.getElementById('round').value = c.round || '';
      document.getElementById('industry').value = c.industry || '';
      document.getElementById('case_type').value = c.case_type || '';
      document.getElementById('date').value = c.date || '';
      document.getElementById('outcome').value = c.outcome || '';
      document.getElementById('problem_statement').value = c.problem_statement || '';
      document.getElementById('my_approach').value = c.my_approach || '';
      document.getElementById('key_insights').value = c.key_insights || '';
      document.getElementById('notes').value = c.notes || '';
    });
}

document.getElementById('caseForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const body = {
    firm: document.getElementById('firm').value.trim(),
    round: document.getElementById('round').value,
    industry: document.getElementById('industry').value.trim(),
    case_type: document.getElementById('case_type').value,
    date: document.getElementById('date').value,
    outcome: document.getElementById('outcome').value,
    problem_statement: document.getElementById('problem_statement').value.trim(),
    my_approach: document.getElementById('my_approach').value.trim(),
    key_insights: document.getElementById('key_insights').value.trim(),
    notes: document.getElementById('notes').value.trim(),
  };

  const id = document.getElementById('caseId').value;
  const url = id ? `${API}/cases/${id}` : `${API}/cases`;
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (res.ok) {
    window.location.href = 'index.html';
  } else {
    const err = await res.json();
    alert(err.error || 'Failed to save');
    btn.disabled = false;
    btn.textContent = 'Save Case';
  }
});

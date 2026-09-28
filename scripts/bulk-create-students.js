// One-off bulk import: Name/Email Excel -> Supabase Auth + profiles (role=student).
// Writes a companion Excel with generated credentials to share with students.
// Usage: node scripts/bulk-create-students.js <input-xlsx> <output-xlsx>
try { require('node:process').loadEnvFile(); } catch {}

const XLSX = require('xlsx');
const { supabaseAdmin } = require('../lib/supabase');

const [, , INPUT_PATH, OUTPUT_PATH] = process.argv;
if (!INPUT_PATH || !OUTPUT_PATH) {
  console.error('Usage: node scripts/bulk-create-students.js <input-xlsx> <output-xlsx>');
  process.exit(1);
}

const ALLOWED_DOMAIN = '@iimb.ac.in';
const CONCURRENCY = 8;

function genPassword() {
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(10 + Math.random() * 90);
}

function readRows(path) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const [header, ...data] = rows;
  return data
    .filter(r => r[1] != null && String(r[1]).trim() !== '')
    .map(r => ({ name: r[0] != null ? String(r[0]).trim() : '', email: String(r[1]).trim().toLowerCase() }));
}

async function processOne({ name, email }) {
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    return { name, email, password: '', status: `skipped: must end with ${ALLOWED_DOMAIN}` };
  }
  const { data: existing } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (existing) {
    return { name, email, password: '', status: 'skipped: already registered' };
  }
  const password = genPassword();
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    return { name, email, password: '', status: `failed: ${error.message}` };
  }
  const { error: profileErr } = await supabaseAdmin.from('profiles').insert({ id: created.user.id, email, name: name || email.split('@')[0], role: 'student' });
  if (profileErr) {
    return { name, email, password: '', status: `failed (profile insert): ${profileErr.message}` };
  }
  return { name, email, password, status: 'created' };
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
      done++;
      if (done % 25 === 0 || done === items.length) console.log(`Progress: ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  const rows = readRows(INPUT_PATH);
  console.log(`Read ${rows.length} rows from ${INPUT_PATH}`);

  const results = await runWithConcurrency(rows, CONCURRENCY, processOne);

  const created = results.filter(r => r.status === 'created').length;
  const skipped = results.filter(r => r.status.startsWith('skipped')).length;
  const failed = results.filter(r => r.status.startsWith('failed')).length;
  console.log(`\nDone. created=${created} skipped=${skipped} failed=${failed}`);

  const outWb = XLSX.utils.book_new();
  const outWs = XLSX.utils.json_to_sheet(results, { header: ['name', 'email', 'password', 'status'] });
  XLSX.utils.sheet_add_aoa(outWs, [['Name', 'Email', 'Password', 'Status']], { origin: 'A1' });
  XLSX.utils.book_append_sheet(outWb, outWs, 'Credentials');
  XLSX.writeFile(outWb, OUTPUT_PATH);
  console.log(`Wrote credentials to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('Bulk create failed:', err.message);
  process.exit(1);
});

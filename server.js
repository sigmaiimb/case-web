try { require('node:process').loadEnvFile(); } catch {}

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin, supabaseAuth } = require('./lib/supabase');

const JWT_SECRET = process.env.JWT_SECRET || 'caseweb-dev-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@caseweb.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DIAGRAM_BUCKET = 'diagrams';

const app = express();

app.use(cors());
app.use(express.json());

// PostgREST or-filter syntax treats , ( ) as structural and % _ as ILIKE
// wildcards — escape all of them before interpolating user search text.
function escapeSearchTerm(s) {
  return String(s).replace(/[%_]/g, m => '\\' + m).replace(/[,()]/g, m => '\\' + m);
}

function genPassword() {
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(10 + Math.random() * 90);
}

async function distinctColumn(table, col) {
  const { data, error } = await supabaseAdmin.from(table).select(col).not(col, 'is', null).neq(col, '');
  if (error) throw error;
  return [...new Set(data.map(r => r[col]))].sort();
}

async function seedAdmin() {
  const { data: existing } = await supabaseAdmin.from('profiles').select('id').eq('role', 'admin').maybeSingle();
  if (existing) return;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, email_confirm: true });
  if (error) { console.error('Failed to seed admin:', error.message); return; }
  await supabaseAdmin.from('profiles').insert({ id: data.user.id, email: ADMIN_EMAIL, name: 'Admin', role: 'admin' });
  console.log(`Admin seeded: ${ADMIN_EMAIL}`);
}

// ── Auth middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

// ── Auth endpoints ────────────────────────────────────────────────

// POST /api/admin/users — admin creates student accounts
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { emails } = req.body; // array of email strings
  if (!Array.isArray(emails) || !emails.length) return res.status(400).json({ error: 'emails array required' });

  const ALLOWED_DOMAIN = '@iimb.ac.in';
  const results = [];

  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email.endsWith(ALLOWED_DOMAIN)) {
      results.push({ email, success: false, error: `Must end with ${ALLOWED_DOMAIN}` });
      continue;
    }
    const { data: existingProfile } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existingProfile) {
      results.push({ email, success: false, error: 'Already registered' });
      continue;
    }
    const password = genPassword();
    const name = email.split('@')[0];
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      results.push({ email, success: false, error: error.message });
      continue;
    }
    await supabaseAdmin.from('profiles').insert({ id: created.user.id, email, name, role: 'student' });
    results.push({ email, success: true, password, name });
  }

  res.json({ results });
});

// GET /api/admin/users — list all non-admin users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('profiles').select('id, email, name, created_at').eq('role', 'student').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/admin/users/:id
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', id).maybeSingle();
  if (!profile || profile.role !== 'student') return res.json({ success: true });
  await supabaseAdmin.from('case_progress').delete().eq('user_id', id);
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/auth/login — admin or student
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(401).json({ error: 'Invalid email or password' });
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error || !data.user) return res.status(401).json({ error: 'Invalid email or password' });
  const { data: profile } = await supabaseAdmin.from('profiles').select('name, role').eq('id', data.user.id).maybeSingle();
  const payload = { id: data.user.id, email: data.user.email, name: profile?.name ?? null, role: profile?.role ?? 'student' };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: payload });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// ── Personal cases (unchanged) ────────────────────────────────────
app.get('/api/cases', async (req, res) => {
  const { search, industry, case_type, outcome } = req.query;
  let q = supabaseAdmin.from('personal_cases').select('*');
  if (search) {
    const t = escapeSearchTerm(search);
    q = q.or(`firm.ilike.%${t}%,problem_statement.ilike.%${t}%,key_insights.ilike.%${t}%`);
  }
  if (industry) q = q.eq('industry', industry);
  if (case_type) q = q.eq('case_type', case_type);
  if (outcome) q = q.eq('outcome', outcome);
  q = q.order('date', { ascending: false }).order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get('/api/cases/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('personal_cases').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});
app.post('/api/cases', async (req, res) => {
  const { firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes } = req.body;
  if (!firm) return res.status(400).json({ error: 'Firm is required' });
  const { data, error } = await supabaseAdmin.from('personal_cases')
    .insert({ firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes })
    .select('id').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id });
});
app.put('/api/cases/:id', async (req, res) => {
  const { firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes } = req.body;
  const { error } = await supabaseAdmin.from('personal_cases')
    .update({ firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
app.delete('/api/cases/:id', async (req, res) => {
  const { error } = await supabaseAdmin.from('personal_cases').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
app.get('/api/filters', async (req, res) => {
  try {
    const [industries, case_types] = await Promise.all([
      distinctColumn('personal_cases', 'industry'),
      distinctColumn('personal_cases', 'case_type'),
    ]);
    res.json({ industries, case_types });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Diagram upload (Supabase Storage) ─────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Casebook read endpoints (public) ─────────────────────────────

app.get('/api/casebook/cases', async (req, res) => {
  const { search, case_type, difficulty, firm, is_numerical } = req.query;
  let q = supabaseAdmin.from('cases').select('*');
  if (search) {
    const t = escapeSearchTerm(search);
    q = q.or(`case_title.ilike.%${t}%,case_statement.ilike.%${t}%,firm.ilike.%${t}%`);
  }
  if (case_type)  q = q.eq('case_type', case_type);
  if (difficulty) q = q.eq('difficulty', difficulty);
  if (firm)       q = q.eq('firm', firm);
  if (is_numerical !== undefined) q = q.eq('is_numerical', is_numerical === '1' || is_numerical === 'true');
  q = q.order('case_type').order('case_title');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/casebook/filters', async (req, res) => {
  try {
    const [case_types, difficulties, firms] = await Promise.all([
      distinctColumn('cases', 'case_type'),
      distinctColumn('cases', 'difficulty'),
      distinctColumn('cases', 'firm'),
    ]);
    res.json({ case_types, difficulties, firms });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/casebook/cases/:id', async (req, res) => {
  const id = req.params.id;
  const { data: c, error } = await supabaseAdmin.from('cases').select('*').eq('case_id', id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!c) return res.status(404).json({ error: 'Not found' });

  const [{ data: dialogue }, { data: notes }, { data: diagrams }] = await Promise.all([
    supabaseAdmin.from('case_dialogue').select('*').eq('case_id', id).order('sequence_no'),
    supabaseAdmin.from('case_notes').select('*').eq('case_id', id).order('sort_order'),
    supabaseAdmin.from('case_diagrams').select('*, frameworks(framework_name)').eq('case_id', id).order('diagram_order'),
  ]);

  c.dialogue = dialogue || [];
  c.notes = notes || [];
  c.diagrams = (diagrams || []).map(({ frameworks, ...d }) => ({ ...d, framework_name: frameworks?.framework_name ?? null }));
  res.json(c);
});

// ── Student progress endpoints (auth required) ────────────────────

// GET /api/casebook/progress — all progress for current user
app.get('/api/casebook/progress', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('case_progress').select('*').eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/casebook/cases/:id/progress — single case progress for current user
app.get('/api/casebook/cases/:id/progress', requireAuth, async (req, res) => {
  const { data } = await supabaseAdmin.from('case_progress').select('*').eq('user_id', req.user.id).eq('case_id', req.params.id).maybeSingle();
  res.json(data || { status: null, reaction: null });
});

// PUT /api/casebook/cases/:id/progress — upsert status/reaction
app.put('/api/casebook/cases/:id/progress', requireAuth, async (req, res) => {
  const { status, reaction } = req.body;
  const { data: existing } = await supabaseAdmin.from('case_progress').select('id').eq('user_id', req.user.id).eq('case_id', req.params.id).maybeSingle();
  if (existing) {
    const patch = {};
    if (status !== undefined) patch.status = status;
    if (reaction !== undefined) patch.reaction = reaction;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from('case_progress').update(patch).eq('id', existing.id);
      if (error) return res.status(500).json({ error: error.message });
    }
  } else {
    const { error } = await supabaseAdmin.from('case_progress').insert({ user_id: req.user.id, case_id: req.params.id, status: status ?? null, reaction: reaction ?? null });
    if (error) return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// PATCH /api/casebook/cases/:id/personal-notes — save student's personal notes
app.patch('/api/casebook/cases/:id/personal-notes', requireAuth, async (req, res) => {
  const { notes } = req.body;
  const { data: existing } = await supabaseAdmin.from('case_progress').select('id').eq('user_id', req.user.id).eq('case_id', req.params.id).maybeSingle();
  if (existing) {
    const { error } = await supabaseAdmin.from('case_progress').update({ personal_notes: notes ?? '' }).eq('id', existing.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin.from('case_progress').insert({ user_id: req.user.id, case_id: req.params.id, personal_notes: notes ?? '' });
    if (error) return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// GET /api/casebook/cases/:id/reactions — aggregate like/dislike counts (public)
app.get('/api/casebook/cases/:id/reactions', async (req, res) => {
  const id = req.params.id;
  const [{ count: likes }, { count: dislikes }] = await Promise.all([
    supabaseAdmin.from('case_progress').select('*', { count: 'exact', head: true }).eq('case_id', id).eq('reaction', 'like'),
    supabaseAdmin.from('case_progress').select('*', { count: 'exact', head: true }).eq('case_id', id).eq('reaction', 'dislike'),
  ]);
  res.json({ likes: likes ?? 0, dislikes: dislikes ?? 0 });
});

// ── Casebook write endpoints (admin only) ─────────────────────────

app.post('/api/casebook/cases', requireAdmin, async (req, res) => {
  const { case_title, firm, difficulty, category, case_type, is_numerical, page_number, case_statement, source_volume, dialogue = [], notes = {} } = req.body;
  if (!case_title) return res.status(400).json({ error: 'case_title is required' });

  const { data: caseRow, error } = await supabaseAdmin.from('cases')
    .insert({ case_title, firm, difficulty, category, case_type, is_numerical: !!is_numerical, page_number, case_statement, source_volume })
    .select('case_id').single();
  if (error) return res.status(500).json({ error: error.message });
  const caseId = caseRow.case_id;

  if (dialogue.length) {
    await supabaseAdmin.from('case_dialogue').insert(dialogue.map((d, i) => ({ case_id: caseId, sequence_no: i + 1, speaker: d.speaker, dialogue_text: d.text })));
  }
  const noteRows = [];
  ['case_facts', 'additional_info', 'recommendations', 'tips_tricks'].forEach(cat => (notes[cat] || []).forEach((t, i) => noteRows.push({ case_id: caseId, note_category: cat, note_text: t, sort_order: i + 1 })));
  if (noteRows.length) await supabaseAdmin.from('case_notes').insert(noteRows);

  res.status(201).json({ case_id: caseId });
});

app.put('/api/casebook/cases/:id', requireAdmin, async (req, res) => {
  const { case_title, firm, difficulty, category, case_type, is_numerical, page_number, case_statement, source_volume, dialogue = [], notes = {} } = req.body;
  const id = req.params.id;

  const { error } = await supabaseAdmin.from('cases')
    .update({ case_title, firm, difficulty, category, case_type, is_numerical: !!is_numerical, page_number, case_statement, source_volume })
    .eq('case_id', id);
  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin.from('case_dialogue').delete().eq('case_id', id);
  if (dialogue.length) {
    await supabaseAdmin.from('case_dialogue').insert(dialogue.map((d, i) => ({ case_id: id, sequence_no: i + 1, speaker: d.speaker, dialogue_text: d.text })));
  }
  await supabaseAdmin.from('case_notes').delete().eq('case_id', id);
  const noteRows = [];
  ['case_facts', 'additional_info', 'recommendations', 'tips_tricks'].forEach(cat => (notes[cat] || []).forEach((t, i) => noteRows.push({ case_id: id, note_category: cat, note_text: t, sort_order: i + 1 })));
  if (noteRows.length) await supabaseAdmin.from('case_notes').insert(noteRows);

  res.json({ success: true });
});

app.delete('/api/casebook/cases/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  await supabaseAdmin.from('case_dialogue').delete().eq('case_id', id);
  await supabaseAdmin.from('case_notes').delete().eq('case_id', id);
  await supabaseAdmin.from('case_diagrams').delete().eq('case_id', id);
  await supabaseAdmin.from('cases').delete().eq('case_id', id);
  res.json({ success: true });
});

app.patch('/api/casebook/cases/:id/notes/:category', requireAdmin, async (req, res) => {
  const { id, category } = req.params;
  const { text } = req.body;
  await supabaseAdmin.from('case_notes').delete().eq('case_id', id).eq('note_category', category);
  if (text && text.trim()) {
    await supabaseAdmin.from('case_notes').insert({ case_id: id, note_category: category, note_text: text.trim(), sort_order: 1 });
  }
  res.json({ success: true });
});

app.post('/api/casebook/cases/:id/diagram', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filename = `diagram_${Date.now()}${path.extname(req.file.originalname)}`;
  const { error: uploadError } = await supabaseAdmin.storage.from(DIAGRAM_BUCKET).upload(filename, req.file.buffer, { contentType: req.file.mimetype });
  if (uploadError) return res.status(500).json({ error: uploadError.message });
  const { data: { publicUrl } } = supabaseAdmin.storage.from(DIAGRAM_BUCKET).getPublicUrl(filename);
  const { data, error } = await supabaseAdmin.from('case_diagrams').insert({ case_id: req.params.id, image_path: publicUrl, diagram_order: 1 }).select('diagram_id').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ diagram_id: data.diagram_id, image_path: publicUrl });
});

app.delete('/api/casebook/diagrams/:id', requireAdmin, async (req, res) => {
  const { data: row } = await supabaseAdmin.from('case_diagrams').select('image_path').eq('diagram_id', req.params.id).maybeSingle();
  await supabaseAdmin.from('case_diagrams').delete().eq('diagram_id', req.params.id);
  if (row?.image_path) {
    const filename = row.image_path.split('/').pop();
    await supabaseAdmin.storage.from(DIAGRAM_BUCKET).remove([filename]);
  }
  res.json({ success: true });
});

// Serve React build in production
const clientBuild = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.use((req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

const PORT = process.env.PORT || 3000;
seedAdmin()
  .catch(err => console.error('Admin seed error:', err))
  .finally(() => {
    app.listen(PORT, () => console.log(`CaseWeb running at http://localhost:${PORT}`));
  });

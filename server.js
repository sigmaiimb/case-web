const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'caseweb-dev-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@caseweb.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const app = express();
const db = new Database('cases.db');
const cbdb = new Database('casebook.db');

app.use(cors());
app.use(express.json());

// ── Personal cases DB ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm TEXT NOT NULL,
    round TEXT,
    industry TEXT,
    case_type TEXT,
    problem_statement TEXT,
    my_approach TEXT,
    key_insights TEXT,
    outcome TEXT,
    date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ── Casebook DB schema ────────────────────────────────────────────
cbdb.exec(`
  CREATE TABLE IF NOT EXISTS cases (
    case_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    case_title    TEXT NOT NULL,
    case_type     TEXT,
    category      TEXT,
    difficulty    TEXT,
    is_numerical  INTEGER DEFAULT 0,
    firm          TEXT,
    page_number   INTEGER,
    case_statement TEXT,
    source_volume TEXT
  );
  CREATE TABLE IF NOT EXISTS case_dialogue (
    dialogue_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id       INTEGER REFERENCES cases(case_id),
    sequence_no   INTEGER,
    speaker       TEXT,
    dialogue_text TEXT
  );
  CREATE TABLE IF NOT EXISTS case_notes (
    note_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id       INTEGER REFERENCES cases(case_id),
    note_category TEXT,
    note_text     TEXT,
    sort_order    INTEGER
  );
  CREATE TABLE IF NOT EXISTS frameworks (
    framework_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    framework_name TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS case_diagrams (
    diagram_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id        INTEGER REFERENCES cases(case_id),
    framework_id   INTEGER REFERENCES frameworks(framework_id),
    image_path     TEXT,
    diagram_order  INTEGER
  );
  CREATE TABLE IF NOT EXISTS diagram_nodes (
    node_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    diagram_id     INTEGER REFERENCES case_diagrams(diagram_id),
    parent_node_id INTEGER REFERENCES diagram_nodes(node_id),
    label          TEXT,
    sort_order     INTEGER
  );
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    role          TEXT NOT NULL DEFAULT 'student',
    created_at    TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS case_progress (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER REFERENCES users(id),
    case_id        INTEGER REFERENCES cases(case_id),
    status         TEXT,
    reaction       TEXT,
    personal_notes TEXT DEFAULT '',
    UNIQUE(user_id, case_id)
  );
`);

// Migrate: add personal_notes column if missing
const cpCols = cbdb.prepare("PRAGMA table_info(case_progress)").all().map(c => c.name);
if (!cpCols.includes('personal_notes')) {
  cbdb.exec("ALTER TABLE case_progress ADD COLUMN personal_notes TEXT DEFAULT ''");
}

// Seed admin account if not exists
const existingAdmin = cbdb.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!existingAdmin) {
  cbdb.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run(ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10), 'Admin', 'admin');
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
app.post('/api/admin/users', requireAdmin, (req, res) => {
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
    const existing = cbdb.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      results.push({ email, success: false, error: 'Already registered' });
      continue;
    }
    const password = Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(10 + Math.random() * 90);
    const name = email.split('@')[0];
    cbdb.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)').run(email, bcrypt.hashSync(password, 10), name, 'student');
    results.push({ email, success: true, password, name });
  }

  res.json({ results });
});

// GET /api/admin/users — list all non-admin users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = cbdb.prepare("SELECT id, email, name, created_at FROM users WHERE role = 'student' ORDER BY created_at DESC").all();
  res.json(users);
});

// DELETE /api/admin/users/:id
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  cbdb.prepare('DELETE FROM case_progress WHERE user_id = ?').run(req.params.id);
  cbdb.prepare("DELETE FROM users WHERE id = ? AND role = 'student'").run(req.params.id);
  res.json({ success: true });
});

// POST /api/auth/login — admin or student
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = cbdb.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// ── Personal cases (unchanged) ────────────────────────────────────
app.get('/api/cases', (req, res) => {
  const { search, industry, case_type, outcome } = req.query;
  let query = 'SELECT * FROM cases WHERE 1=1';
  const params = [];
  if (search) { query += ' AND (firm LIKE ? OR problem_statement LIKE ? OR key_insights LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (industry) { query += ' AND industry = ?'; params.push(industry); }
  if (case_type) { query += ' AND case_type = ?'; params.push(case_type); }
  if (outcome) { query += ' AND outcome = ?'; params.push(outcome); }
  query += ' ORDER BY date DESC, created_at DESC';
  res.json(db.prepare(query).all(...params));
});
app.get('/api/cases/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});
app.post('/api/cases', (req, res) => {
  const { firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes } = req.body;
  if (!firm) return res.status(400).json({ error: 'Firm is required' });
  const result = db.prepare(`INSERT INTO cases (firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes);
  res.status(201).json({ id: result.lastInsertRowid });
});
app.put('/api/cases/:id', (req, res) => {
  const { firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes } = req.body;
  db.prepare(`UPDATE cases SET firm=?, round=?, industry=?, case_type=?, problem_statement=?, my_approach=?, key_insights=?, outcome=?, date=?, notes=? WHERE id=?`).run(firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes, req.params.id);
  res.json({ success: true });
});
app.delete('/api/cases/:id', (req, res) => { db.prepare('DELETE FROM cases WHERE id = ?').run(req.params.id); res.json({ success: true }); });
app.get('/api/filters', (req, res) => {
  res.json({
    industries: db.prepare('SELECT DISTINCT industry FROM cases WHERE industry IS NOT NULL AND industry != "" ORDER BY industry').all().map(r => r.industry),
    case_types: db.prepare('SELECT DISTINCT case_type FROM cases WHERE case_type IS NOT NULL AND case_type != "" ORDER BY case_type').all().map(r => r.case_type),
  });
});

// ── Diagram serving + upload ──────────────────────────────────────
app.use('/diagrams', express.static(path.join(__dirname, 'diagrams')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'diagrams');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `diagram_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Casebook read endpoints (public) ─────────────────────────────

app.get('/api/casebook/cases', (req, res) => {
  const { search, case_type, difficulty, firm, is_numerical } = req.query;
  let q = 'SELECT * FROM cases WHERE 1=1';
  const p = [];
  if (search) { q += ' AND (case_title LIKE ? OR case_statement LIKE ? OR firm LIKE ?)'; p.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (case_type)    { q += ' AND case_type = ?';    p.push(case_type); }
  if (difficulty)   { q += ' AND difficulty = ?';   p.push(difficulty); }
  if (firm)         { q += ' AND firm = ?';          p.push(firm); }
  if (is_numerical) { q += ' AND is_numerical = ?'; p.push(Number(is_numerical)); }
  q += ' ORDER BY case_type, case_title';
  res.json(cbdb.prepare(q).all(...p));
});

app.get('/api/casebook/filters', (req, res) => {
  const col = (c) => cbdb.prepare(`SELECT DISTINCT ${c} FROM cases WHERE ${c} IS NOT NULL AND ${c} != '' ORDER BY ${c}`).all().map(r => r[c]);
  res.json({ case_types: col('case_type'), difficulties: col('difficulty'), firms: col('firm') });
});

app.get('/api/casebook/cases/:id', (req, res) => {
  const c = cbdb.prepare('SELECT * FROM cases WHERE case_id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.dialogue = cbdb.prepare('SELECT * FROM case_dialogue WHERE case_id = ? ORDER BY sequence_no').all(req.params.id);
  c.notes    = cbdb.prepare('SELECT * FROM case_notes WHERE case_id = ? ORDER BY sort_order').all(req.params.id);
  c.diagrams = cbdb.prepare(`SELECT cd.*, f.framework_name FROM case_diagrams cd LEFT JOIN frameworks f ON f.framework_id = cd.framework_id WHERE cd.case_id = ? ORDER BY cd.diagram_order`).all(req.params.id);
  res.json(c);
});

// ── Student progress endpoints (auth required) ────────────────────

// GET /api/casebook/progress — all progress for current user
app.get('/api/casebook/progress', requireAuth, (req, res) => {
  const rows = cbdb.prepare('SELECT * FROM case_progress WHERE user_id = ?').all(req.user.id);
  res.json(rows);
});

// GET /api/casebook/cases/:id/progress — single case progress for current user
app.get('/api/casebook/cases/:id/progress', requireAuth, (req, res) => {
  const row = cbdb.prepare('SELECT * FROM case_progress WHERE user_id = ? AND case_id = ?').get(req.user.id, req.params.id);
  res.json(row || { status: null, reaction: null });
});

// PUT /api/casebook/cases/:id/progress — upsert status/reaction
app.put('/api/casebook/cases/:id/progress', requireAuth, (req, res) => {
  const { status, reaction } = req.body;
  const existing = cbdb.prepare('SELECT id FROM case_progress WHERE user_id = ? AND case_id = ?').get(req.user.id, req.params.id);
  if (existing) {
    const sets = [], vals = [];
    if (status !== undefined)   { sets.push('status = ?');   vals.push(status); }
    if (reaction !== undefined) { sets.push('reaction = ?'); vals.push(reaction); }
    if (sets.length) cbdb.prepare(`UPDATE case_progress SET ${sets.join(', ')} WHERE user_id = ? AND case_id = ?`).run(...vals, req.user.id, req.params.id);
  } else {
    cbdb.prepare('INSERT INTO case_progress (user_id, case_id, status, reaction) VALUES (?, ?, ?, ?)').run(req.user.id, req.params.id, status ?? null, reaction ?? null);
  }
  res.json({ success: true });
});

// PATCH /api/casebook/cases/:id/personal-notes — save student's personal notes
app.patch('/api/casebook/cases/:id/personal-notes', requireAuth, (req, res) => {
  const { notes } = req.body;
  const existing = cbdb.prepare('SELECT id FROM case_progress WHERE user_id = ? AND case_id = ?').get(req.user.id, req.params.id);
  if (existing) {
    cbdb.prepare('UPDATE case_progress SET personal_notes = ? WHERE user_id = ? AND case_id = ?').run(notes ?? '', req.user.id, req.params.id);
  } else {
    cbdb.prepare('INSERT INTO case_progress (user_id, case_id, personal_notes) VALUES (?, ?, ?)').run(req.user.id, req.params.id, notes ?? '');
  }
  res.json({ success: true });
});

// GET /api/casebook/cases/:id/reactions — aggregate like/dislike counts (public)
app.get('/api/casebook/cases/:id/reactions', (req, res) => {
  const likes    = cbdb.prepare("SELECT COUNT(*) as n FROM case_progress WHERE case_id = ? AND reaction = 'like'").get(req.params.id).n;
  const dislikes = cbdb.prepare("SELECT COUNT(*) as n FROM case_progress WHERE case_id = ? AND reaction = 'dislike'").get(req.params.id).n;
  res.json({ likes, dislikes });
});

// ── Casebook write endpoints (admin only) ─────────────────────────

app.post('/api/casebook/cases', requireAdmin, (req, res) => {
  const { case_title, firm, difficulty, category, case_type, is_numerical, page_number, case_statement, source_volume, dialogue = [], notes = {} } = req.body;
  if (!case_title) return res.status(400).json({ error: 'case_title is required' });
  const caseId = cbdb.transaction(() => {
    const { lastInsertRowid: caseId } = cbdb.prepare(`INSERT INTO cases (case_title, firm, difficulty, category, case_type, is_numerical, page_number, case_statement, source_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(case_title, firm, difficulty, category, case_type, is_numerical ? 1 : 0, page_number, case_statement, source_volume);
    const insD = cbdb.prepare(`INSERT INTO case_dialogue (case_id, sequence_no, speaker, dialogue_text) VALUES (?, ?, ?, ?)`);
    dialogue.forEach((d, i) => insD.run(caseId, i + 1, d.speaker, d.text));
    const insN = cbdb.prepare(`INSERT INTO case_notes (case_id, note_category, note_text, sort_order) VALUES (?, ?, ?, ?)`);
    ['case_facts','additional_info','recommendations','tips_tricks'].forEach(cat => (notes[cat]||[]).forEach((t,i) => insN.run(caseId, cat, t, i+1)));
    return caseId;
  })();
  res.status(201).json({ case_id: caseId });
});

app.put('/api/casebook/cases/:id', requireAdmin, (req, res) => {
  const { case_title, firm, difficulty, category, case_type, is_numerical, page_number, case_statement, source_volume, dialogue = [], notes = {} } = req.body;
  const id = req.params.id;
  cbdb.transaction(() => {
    cbdb.prepare(`UPDATE cases SET case_title=?, firm=?, difficulty=?, category=?, case_type=?, is_numerical=?, page_number=?, case_statement=?, source_volume=? WHERE case_id=?`).run(case_title, firm, difficulty, category, case_type, is_numerical ? 1 : 0, page_number, case_statement, source_volume, id);
    cbdb.prepare('DELETE FROM case_dialogue WHERE case_id = ?').run(id);
    const insD = cbdb.prepare(`INSERT INTO case_dialogue (case_id, sequence_no, speaker, dialogue_text) VALUES (?, ?, ?, ?)`);
    dialogue.forEach((d, i) => insD.run(id, i + 1, d.speaker, d.text));
    cbdb.prepare('DELETE FROM case_notes WHERE case_id = ?').run(id);
    const insN = cbdb.prepare(`INSERT INTO case_notes (case_id, note_category, note_text, sort_order) VALUES (?, ?, ?, ?)`);
    ['case_facts','additional_info','recommendations','tips_tricks'].forEach(cat => (notes[cat]||[]).forEach((t,i) => insN.run(id, cat, t, i+1)));
  })();
  res.json({ success: true });
});

app.delete('/api/casebook/cases/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  cbdb.transaction(() => {
    cbdb.prepare('DELETE FROM case_dialogue WHERE case_id = ?').run(id);
    cbdb.prepare('DELETE FROM case_notes WHERE case_id = ?').run(id);
    cbdb.prepare('DELETE FROM case_diagrams WHERE case_id = ?').run(id);
    cbdb.prepare('DELETE FROM cases WHERE case_id = ?').run(id);
  })();
  res.json({ success: true });
});

app.patch('/api/casebook/cases/:id/notes/:category', requireAdmin, (req, res) => {
  const { id, category } = req.params;
  const { text } = req.body;
  cbdb.transaction(() => {
    cbdb.prepare('DELETE FROM case_notes WHERE case_id = ? AND note_category = ?').run(id, category);
    if (text && text.trim()) cbdb.prepare('INSERT INTO case_notes (case_id, note_category, note_text, sort_order) VALUES (?, ?, ?, 1)').run(id, category, text.trim());
  })();
  res.json({ success: true });
});

app.post('/api/casebook/cases/:id/diagram', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { lastInsertRowid: diagramId } = cbdb.prepare(`INSERT INTO case_diagrams (case_id, image_path, diagram_order) VALUES (?, ?, 1)`).run(req.params.id, req.file.filename);
  res.status(201).json({ diagram_id: diagramId, image_path: req.file.filename });
});

app.delete('/api/casebook/diagrams/:id', requireAdmin, (req, res) => {
  const row = cbdb.prepare('SELECT image_path FROM case_diagrams WHERE diagram_id = ?').get(req.params.id);
  if (row) {
    cbdb.prepare('DELETE FROM case_diagrams WHERE diagram_id = ?').run(req.params.id);
    const fp = path.join(__dirname, 'diagrams', row.image_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
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
app.listen(PORT, () => console.log(`CaseWeb running at http://localhost:${PORT}`));

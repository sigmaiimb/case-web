// One-off migration: local SQLite (cases.db, casebook.db, diagrams/) -> Supabase.
// Run once: node scripts/migrate-to-supabase.js
try { require('node:process').loadEnvFile(); } catch {}

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const Database = require('better-sqlite3');
const { supabaseAdmin } = require('../lib/supabase');

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@caseweb.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL in .env');
  process.exit(1);
}

function genPassword() {
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(10 + Math.random() * 90);
}

function mimeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
}

async function resyncSequence(pg, table, col) {
  await pg.query(`SELECT setval(pg_get_serial_sequence('${table}', '${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}), 1))`);
}

async function applySchema(pg) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await pg.query(sql);
  console.log('Schema applied.');
}

async function migratePersonalCases(pg, db) {
  const rows = db.prepare('SELECT * FROM cases').all();
  for (const r of rows) {
    await pg.query(
      `INSERT INTO personal_cases (id, firm, round, industry, case_type, problem_statement, my_approach, key_insights, outcome, date, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [r.id, r.firm, r.round, r.industry, r.case_type, r.problem_statement, r.my_approach, r.key_insights, r.outcome, r.date, r.notes, r.created_at]
    );
  }
  if (rows.length) await resyncSequence(pg, 'personal_cases', 'id');
  console.log(`Migrated ${rows.length} personal cases.`);
}

async function migrateCasebook(pg, cbdb) {
  const cases = cbdb.prepare('SELECT * FROM cases').all();
  for (const c of cases) {
    await pg.query(
      `INSERT INTO cases (case_id, case_title, case_type, category, difficulty, is_numerical, firm, page_number, case_statement, source_volume)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.case_id, c.case_title, c.case_type, c.category, c.difficulty, !!c.is_numerical, c.firm, c.page_number, c.case_statement, c.source_volume]
    );
  }

  const dialogue = cbdb.prepare('SELECT * FROM case_dialogue').all();
  for (const d of dialogue) {
    await pg.query(
      `INSERT INTO case_dialogue (dialogue_id, case_id, sequence_no, speaker, dialogue_text) VALUES ($1,$2,$3,$4,$5)`,
      [d.dialogue_id, d.case_id, d.sequence_no, d.speaker, d.dialogue_text]
    );
  }

  const notes = cbdb.prepare('SELECT * FROM case_notes').all();
  for (const n of notes) {
    await pg.query(
      `INSERT INTO case_notes (note_id, case_id, note_category, note_text, sort_order) VALUES ($1,$2,$3,$4,$5)`,
      [n.note_id, n.case_id, n.note_category, n.note_text, n.sort_order]
    );
  }

  if (cases.length) await resyncSequence(pg, 'cases', 'case_id');
  if (dialogue.length) await resyncSequence(pg, 'case_dialogue', 'dialogue_id');
  if (notes.length) await resyncSequence(pg, 'case_notes', 'note_id');

  console.log(`Migrated ${cases.length} casebook cases, ${dialogue.length} dialogue lines, ${notes.length} notes.`);
}

async function migrateUsers(cbdb) {
  const users = cbdb.prepare('SELECT * FROM users').all();
  const idMap = new Map(); // old integer id -> new Supabase Auth uuid
  const newPasswords = [];

  for (const u of users) {
    const isAdmin = u.role === 'admin';
    const email = isAdmin ? ADMIN_EMAIL : u.email;
    const password = isAdmin ? ADMIN_PASSWORD : genPassword();

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      console.error(`Failed to create user ${email}: ${error.message}`);
      continue;
    }
    await supabaseAdmin.from('profiles').insert({ id: created.user.id, email, name: u.name, role: u.role });
    idMap.set(u.id, created.user.id);
    if (!isAdmin) newPasswords.push({ email, password });
  }

  console.log(`Migrated ${idMap.size}/${users.length} users.`);
  return { idMap, newPasswords };
}

async function migrateProgress(pg, cbdb, idMap) {
  const rows = cbdb.prepare('SELECT * FROM case_progress').all();
  let migrated = 0;
  for (const r of rows) {
    const newUserId = idMap.get(r.user_id);
    if (!newUserId) continue;
    await pg.query(
      `INSERT INTO case_progress (user_id, case_id, status, reaction, personal_notes) VALUES ($1,$2,$3,$4,$5)`,
      [newUserId, r.case_id, r.status, r.reaction, r.personal_notes ?? '']
    );
    migrated++;
  }
  console.log(`Migrated ${migrated}/${rows.length} progress rows.`);
}

async function migrateDiagrams(cbdb) {
  const diagramsDir = path.join(__dirname, '..', 'diagrams');
  const rows = cbdb.prepare('SELECT * FROM case_diagrams').all();
  let migrated = 0;

  for (const d of rows) {
    const filePath = path.join(diagramsDir, d.image_path);
    if (!fs.existsSync(filePath)) {
      console.warn(`Skipping missing diagram file: ${d.image_path}`);
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const { error: uploadError } = await supabaseAdmin.storage.from('diagrams').upload(d.image_path, buffer, { contentType: mimeFor(d.image_path) });
    if (uploadError) {
      console.error(`Failed to upload ${d.image_path}: ${uploadError.message}`);
      continue;
    }
    const { data: { publicUrl } } = supabaseAdmin.storage.from('diagrams').getPublicUrl(d.image_path);
    const { error: insertError } = await supabaseAdmin.from('case_diagrams').insert({
      diagram_id: d.diagram_id, case_id: d.case_id, framework_id: d.framework_id, image_path: publicUrl, diagram_order: d.diagram_order,
    });
    if (insertError) {
      console.error(`Failed to insert case_diagrams row for ${d.image_path}: ${insertError.message}`);
      continue;
    }
    migrated++;
  }

  console.log(`Migrated ${migrated}/${rows.length} diagrams.`);
}

async function main() {
  const pg = new Client({ connectionString: SUPABASE_DB_URL });
  await pg.connect();

  const db = new Database(path.join(__dirname, '..', 'cases.db'), { readonly: true });
  const cbdb = new Database(path.join(__dirname, '..', 'casebook.db'), { readonly: true });

  try {
    await applySchema(pg);

    const { error: bucketError } = await supabaseAdmin.storage.createBucket('diagrams', { public: true });
    if (bucketError && !/already exists/i.test(bucketError.message)) throw bucketError;

    await migratePersonalCases(pg, db);
    await migrateCasebook(pg, cbdb);
    const { idMap, newPasswords } = await migrateUsers(cbdb);
    await migrateProgress(pg, cbdb, idMap);
    await migrateDiagrams(cbdb);

    console.log('\ndone');
    if (newPasswords.length) {
      console.log('\nNew student passwords (redistribute to each student):');
      for (const { email, password } of newPasswords) console.log(`  ${email}: ${password}`);
    }
  } finally {
    db.close();
    cbdb.close();
    await pg.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

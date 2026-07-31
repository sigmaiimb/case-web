// One-off migration: local SQLite (cases.db, casebook.db, diagrams/) -> Supabase.
// Prerequisite: run supabase/schema.sql once in the Supabase SQL Editor.
// Run once: node scripts/migrate-to-supabase.js
try { require('node:process').loadEnvFile(); } catch {}

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { supabaseAdmin } = require('../lib/supabase');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@caseweb.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function genPassword() {
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(10 + Math.random() * 90);
}

function mimeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
}

async function assertSchemaApplied() {
  const { error } = await supabaseAdmin.from('cases').select('case_id').limit(1);
  if (error) {
    console.error('Could not read the `cases` table from Supabase.');
    console.error('Have you run supabase/schema.sql in the Supabase SQL Editor yet? (Dashboard -> SQL Editor -> New query -> paste -> Run)');
    console.error('Underlying error:', error.message);
    process.exit(1);
  }
}

async function migratePersonalCases(db) {
  const rows = db.prepare('SELECT * FROM cases').all();
  let migrated = 0;
  for (const r of rows) {
    const { error } = await supabaseAdmin.from('personal_cases').insert({
      firm: r.firm, round: r.round, industry: r.industry, case_type: r.case_type,
      problem_statement: r.problem_statement, my_approach: r.my_approach, key_insights: r.key_insights,
      outcome: r.outcome, date: r.date, notes: r.notes, created_at: r.created_at,
    });
    if (error) { console.error(`Failed to migrate personal case "${r.firm}": ${error.message}`); continue; }
    migrated++;
  }
  console.log(`Migrated ${migrated}/${rows.length} personal cases.`);
}

async function migrateCasebookCases(cbdb) {
  const cases = cbdb.prepare('SELECT * FROM cases').all();
  const caseIdMap = new Map(); // old case_id -> new case_id
  let migrated = 0;

  for (const c of cases) {
    const { data, error } = await supabaseAdmin.from('cases').insert({
      case_title: c.case_title, case_type: c.case_type, category: c.category, difficulty: c.difficulty,
      is_numerical: !!c.is_numerical, firm: c.firm, page_number: c.page_number,
      case_statement: c.case_statement, source_volume: c.source_volume,
    }).select('case_id').single();
    if (error) { console.error(`Failed to migrate case "${c.case_title}": ${error.message}`); continue; }
    caseIdMap.set(c.case_id, data.case_id);
    migrated++;
  }
  console.log(`Migrated ${migrated}/${cases.length} casebook cases.`);
  return caseIdMap;
}

async function migrateDialogueAndNotes(cbdb, caseIdMap) {
  const dialogue = cbdb.prepare('SELECT * FROM case_dialogue ORDER BY case_id, sequence_no').all();
  const dialogueRows = dialogue
    .filter(d => caseIdMap.has(d.case_id))
    .map(d => ({ case_id: caseIdMap.get(d.case_id), sequence_no: d.sequence_no, speaker: d.speaker, dialogue_text: d.dialogue_text }));
  if (dialogueRows.length) {
    const { error } = await supabaseAdmin.from('case_dialogue').insert(dialogueRows);
    if (error) console.error(`Failed to migrate dialogue: ${error.message}`);
  }
  console.log(`Migrated ${dialogueRows.length}/${dialogue.length} dialogue lines.`);

  const notes = cbdb.prepare('SELECT * FROM case_notes ORDER BY case_id, sort_order').all();
  const noteRows = notes
    .filter(n => caseIdMap.has(n.case_id))
    .map(n => ({ case_id: caseIdMap.get(n.case_id), note_category: n.note_category, note_text: n.note_text, sort_order: n.sort_order }));
  if (noteRows.length) {
    const { error } = await supabaseAdmin.from('case_notes').insert(noteRows);
    if (error) console.error(`Failed to migrate notes: ${error.message}`);
  }
  console.log(`Migrated ${noteRows.length}/${notes.length} notes.`);
}

async function migrateUsers(cbdb) {
  const users = cbdb.prepare('SELECT * FROM users').all();
  const userIdMap = new Map(); // old integer id -> new Supabase Auth uuid
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
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({ id: created.user.id, email, name: u.name, role: u.role });
    if (profileError) { console.error(`Failed to insert profile for ${email}: ${profileError.message}`); continue; }
    userIdMap.set(u.id, created.user.id);
    if (!isAdmin) newPasswords.push({ email, password });
  }

  console.log(`Migrated ${userIdMap.size}/${users.length} users.`);
  return { userIdMap, newPasswords };
}

async function migrateProgress(cbdb, userIdMap, caseIdMap) {
  const rows = cbdb.prepare('SELECT * FROM case_progress').all();
  const progressRows = rows
    .filter(r => userIdMap.has(r.user_id) && caseIdMap.has(r.case_id))
    .map(r => ({
      user_id: userIdMap.get(r.user_id), case_id: caseIdMap.get(r.case_id),
      status: r.status, reaction: r.reaction, personal_notes: r.personal_notes ?? '',
    }));
  if (progressRows.length) {
    const { error } = await supabaseAdmin.from('case_progress').insert(progressRows);
    if (error) console.error(`Failed to migrate progress rows: ${error.message}`);
  }
  console.log(`Migrated ${progressRows.length}/${rows.length} progress rows.`);
}

async function migrateDiagrams(cbdb, caseIdMap) {
  const diagramsDir = path.join(__dirname, '..', 'diagrams');
  const rows = cbdb.prepare('SELECT * FROM case_diagrams').all();
  let migrated = 0;

  for (const d of rows) {
    if (!caseIdMap.has(d.case_id)) continue;
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
      case_id: caseIdMap.get(d.case_id), framework_id: null, image_path: publicUrl, diagram_order: d.diagram_order,
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
  await assertSchemaApplied();

  const { error: bucketError } = await supabaseAdmin.storage.createBucket('diagrams', { public: true });
  if (bucketError && !/already exists/i.test(bucketError.message)) throw bucketError;

  const db = new Database(path.join(__dirname, '..', 'cases.db'), { readonly: true });
  const cbdb = new Database(path.join(__dirname, '..', 'casebook.db'), { readonly: true });

  try {
    await migratePersonalCases(db);
    const caseIdMap = await migrateCasebookCases(cbdb);
    await migrateDialogueAndNotes(cbdb, caseIdMap);
    const { userIdMap, newPasswords } = await migrateUsers(cbdb);
    await migrateProgress(cbdb, userIdMap, caseIdMap);
    await migrateDiagrams(cbdb, caseIdMap);

    console.log('\ndone');
    if (newPasswords.length) {
      console.log('\nNew student passwords (redistribute to each student):');
      for (const { email, password } of newPasswords) console.log(`  ${email}: ${password}`);
    }
  } finally {
    db.close();
    cbdb.close();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

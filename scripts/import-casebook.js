// One-off import: ICON IIMB Casebook Excel + flowchart image zips -> Supabase.
// Usage: node scripts/import-casebook.js <xlsx-path> <case-images-dir> <guesstimate-images-dir> [--dry-run]
try { require('node:process').loadEnvFile(); } catch {}

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { supabaseAdmin } = require('../lib/supabase');

const [, , XLSX_PATH, CASE_IMG_DIR, GUESS_IMG_DIR] = process.argv;
const DRY_RUN = process.argv.includes('--dry-run');

if (!XLSX_PATH || !CASE_IMG_DIR || !GUESS_IMG_DIR) {
  console.error('Usage: node scripts/import-casebook.js <xlsx-path> <case-images-dir> <guesstimate-images-dir> [--dry-run]');
  process.exit(1);
}

function clean(v) {
  return typeof v === 'string' ? v.trim() : v;
}

function splitBullets(text) {
  if (!text) return [];
  return String(text)
    .split(/\r?\n/)
    .map(s => s.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean);
}

function mimeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
}

// Image files are named CASE_<pdf-page-number>[_<n>].ext, NOT by spreadsheet Case ID.
// Groups sorted by that page number line up 1:1, in order, with cases sorted by Case ID.
function groupImagesByPage(dir) {
  const files = fs.readdirSync(dir).filter(f => /^CASE_\d+(?:_\d+)?\.\w+$/i.test(f));
  const groups = new Map();
  for (const f of files) {
    const num = parseInt(f.match(/^CASE_(\d+)/i)[1], 10);
    if (!groups.has(num)) groups.set(num, []);
    groups.get(num).push(f);
  }
  return [...groups.keys()].sort((a, b) => a - b).map(n => groups.get(n).sort());
}

function readCases(wb) {
  const ws = wb.Sheets['Cases'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1 }); // row2 = header
  const data = rows.slice(1);
  return data
    .filter(r => r[0] != null && String(r[0]).trim() !== '')
    .map(r => ({
      case_id: String(r[0]).trim(),
      case_title: clean(r[1]),
      firm: clean(r[2]),
      case_type: clean(r[3]),
      category: clean(r[4]) || null,
      difficulty: clean(r[5]),
      is_numerical: String(r[6]).trim().toLowerCase() === 'yes',
      page_number: r[7] != null ? parseInt(r[7], 10) : null,
      source_volume: clean(r[8]),
      case_statement: clean(r[9]),
      case_facts: splitBullets(r[10]),
      additional_info: splitBullets(r[11]),
      recommendations: splitBullets(r[12]),
      tips_tricks: splitBullets(r[13]),
    }))
    .sort((a, b) => parseInt(a.case_id, 10) - parseInt(b.case_id, 10));
}

function readDialogue(wb) {
  const ws = wb.Sheets['Dialogue'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1 });
  const data = rows.slice(1);
  const byCase = new Map();
  for (const r of data) {
    if (r[0] == null || String(r[0]).trim() === '') continue;
    const id = String(r[0]).trim();
    if (!byCase.has(id)) byCase.set(id, []);
    byCase.get(id).push({ turn: r[1], speaker: clean(r[2]), text: clean(r[3]) });
  }
  for (const arr of byCase.values()) arr.sort((a, b) => a.turn - b.turn);
  return byCase;
}

async function uploadImage(dir, filename) {
  const buffer = fs.readFileSync(path.join(dir, filename));
  const storagePath = `casebook/${filename}`;
  const { error } = await supabaseAdmin.storage.from('diagrams').upload(storagePath, buffer, { contentType: mimeFor(filename), upsert: true });
  if (error) throw new Error(`upload ${filename}: ${error.message}`);
  const { data } = supabaseAdmin.storage.from('diagrams').getPublicUrl(storagePath);
  return data.publicUrl;
}

const NOTE_CATEGORIES = [
  ['case_facts', 'case_facts'],
  ['additional_info', 'additional_info'],
  ['recommendations', 'recommendations'],
  ['tips_tricks', 'tips_tricks'],
];

async function importCase(c, dialogueRows, imageFiles, imageDir) {
  if (DRY_RUN) {
    console.log(`[dry-run] case ${c.case_id} "${c.case_title}" -> images [${imageFiles.join(', ')}], dialogue turns: ${dialogueRows.length}`);
    return;
  }

  const { data: caseRow, error } = await supabaseAdmin
    .from('cases')
    .insert({
      case_title: c.case_title,
      firm: c.firm,
      difficulty: c.difficulty,
      category: c.category,
      case_type: c.case_type,
      is_numerical: c.is_numerical,
      page_number: c.page_number,
      case_statement: c.case_statement,
      source_volume: c.source_volume,
    })
    .select('case_id')
    .single();
  if (error) throw new Error(`insert case ${c.case_id}: ${error.message}`);
  const dbCaseId = caseRow.case_id;

  const noteRows = [];
  for (const [col, category] of NOTE_CATEGORIES) {
    c[col].forEach((text, i) => noteRows.push({ case_id: dbCaseId, note_category: category, note_text: text, sort_order: i + 1 }));
  }
  if (noteRows.length) {
    const { error: notesErr } = await supabaseAdmin.from('case_notes').insert(noteRows);
    if (notesErr) throw new Error(`insert notes for case ${c.case_id}: ${notesErr.message}`);
  }

  if (dialogueRows.length) {
    const dialogueInsert = dialogueRows.map((d, i) => ({ case_id: dbCaseId, sequence_no: i + 1, speaker: d.speaker, dialogue_text: d.text }));
    const { error: dErr } = await supabaseAdmin.from('case_dialogue').insert(dialogueInsert);
    if (dErr) throw new Error(`insert dialogue for case ${c.case_id}: ${dErr.message}`);
  }

  for (let i = 0; i < imageFiles.length; i++) {
    const publicUrl = await uploadImage(imageDir, imageFiles[i]);
    const { error: imgErr } = await supabaseAdmin.from('case_diagrams').insert({ case_id: dbCaseId, image_path: publicUrl, diagram_order: i + 1 });
    if (imgErr) throw new Error(`insert diagram for case ${c.case_id}: ${imgErr.message}`);
  }

  console.log(`Imported case ${c.case_id} -> db case_id ${dbCaseId} (${noteRows.length} notes, ${dialogueRows.length} dialogue turns, ${imageFiles.length} images)`);
}

async function main() {
  const wb = XLSX.readFile(XLSX_PATH);
  const cases = readCases(wb);
  const dialogueByCase = readDialogue(wb);
  const caseImageGroups = groupImagesByPage(CASE_IMG_DIR);
  const guessImageGroups = groupImagesByPage(GUESS_IMG_DIR);

  const withDialogue = cases.filter(c => dialogueByCase.has(c.case_id));
  const withoutDialogue = cases.filter(c => !dialogueByCase.has(c.case_id));

  console.log(`Cases: ${cases.length} total (${withDialogue.length} with dialogue, ${withoutDialogue.length} guesstimates without)`);
  console.log(`Case image groups: ${caseImageGroups.length}, Guesstimate image groups: ${guessImageGroups.length}`);

  if (withDialogue.length !== caseImageGroups.length) {
    throw new Error(`Mismatch: ${withDialogue.length} cases-with-dialogue vs ${caseImageGroups.length} case image groups — refusing to guess the mapping.`);
  }
  if (withoutDialogue.length !== guessImageGroups.length) {
    throw new Error(`Mismatch: ${withoutDialogue.length} guesstimates vs ${guessImageGroups.length} guesstimate image groups — refusing to guess the mapping.`);
  }

  for (let i = 0; i < withDialogue.length; i++) {
    const c = withDialogue[i];
    await importCase(c, dialogueByCase.get(c.case_id) || [], caseImageGroups[i], CASE_IMG_DIR);
  }
  for (let i = 0; i < withoutDialogue.length; i++) {
    const c = withoutDialogue[i];
    await importCase(c, [], guessImageGroups[i], GUESS_IMG_DIR);
  }

  console.log(DRY_RUN ? '\nDry run complete — no data written.' : '\nImport complete.');
}

main().catch(err => {
  console.error('Import failed:', err.message);
  process.exit(1);
});

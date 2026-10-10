#!/usr/bin/env node
// Build data/store.json from CSV exports instead of synthetic seed data.
//
//   node scripts/import.js <dir> [--dry-run]
//
// <dir> must contain patients.csv, immunizations.csv, appointments.csv, lots.csv.
// Optional: claims.csv, waste.csv (historical, for the dashboard KPIs).
// Column definitions and templates: data/templates/*.csv and docs/DATA.md.
const fs = require('fs');
const path = require('path');
const { VACCINES, SUPPLIES, PAYERS } = require('../src/catalog');

const dir = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!dir) { console.error('usage: node scripts/import.js <dir-with-csv-files> [--dry-run]'); process.exit(2); }

const productIds = new Set([...VACCINES, ...SUPPLIES].map(p => p.id));
const vaccineIds = new Set(VACCINES.map(v => v.id));
const payerIds = new Set(PAYERS.map(p => p.id));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const errors = [], warnings = [];
const err = (f, i, m) => errors.push(`${f} row ${i + 2}: ${m}`);

function readCsv(name, required = true) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) { if (required) errors.push(`${name} is missing`); return []; }
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(c => c.trim() !== '')).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const need = (f, i, r, cols) => cols.forEach(c => { if (!r[c]) err(f, i, `missing ${c}`); });
const date = (f, i, r, c, optional) => { if (!r[c]) { if (!optional) err(f, i, `missing ${c}`); return null; } if (!ISO.test(r[c])) err(f, i, `${c} must be YYYY-MM-DD, got "${r[c]}"`); return r[c]; };
const num = (f, i, r, c, d) => { if (r[c] === '' || r[c] === undefined) return d; const n = Number(r[c]); if (!Number.isFinite(n)) err(f, i, `${c} must be a number`); return n; };
const bool = v => /^(1|true|yes|y)$/i.test(v || '');

// ---- patients -------------------------------------------------------------------
const patients = readCsv('patients.csv').map((r, i) => {
  const f = 'patients.csv'; need(f, i, r, ['patient_id', 'name', 'dob', 'payer_id']);
  if (!payerIds.has(r.payer_id)) err(f, i, `unknown payer_id "${r.payer_id}" (valid: ${[...payerIds].join(', ')})`);
  return { id: r.patient_id, name: r.name, dob: date(f, i, r, 'dob'), payerId: r.payer_id,
    insurance: { memberId: r.member_id || null, plan: r.plan || '', termDate: date(f, i, r, 'coverage_end', true), flaky: false },
    guardian: r.guardian || '', phone: r.phone || '', eligibility: null };
});
const patientIds = new Set(patients.map(p => p.id));
if (patientIds.size !== patients.length) errors.push('patients.csv: duplicate patient_id values');

// ---- immunizations --------------------------------------------------------------
const immunizations = readCsv('immunizations.csv').map((r, i) => {
  const f = 'immunizations.csv'; need(f, i, r, ['patient_id', 'vaccine_id', 'date']);
  if (!patientIds.has(r.patient_id)) err(f, i, `unknown patient_id "${r.patient_id}"`);
  if (!vaccineIds.has(r.vaccine_id)) err(f, i, `unknown vaccine_id "${r.vaccine_id}" (valid: ${[...vaccineIds].join(', ')})`);
  return { id: `I${i + 1}`, patientId: r.patient_id, vaccineId: r.vaccine_id, doseNumber: num(f, i, r, 'dose_number', 0), date: date(f, i, r, 'date'), lotNumber: r.lot_number || null, source: r.source || 'import' };
});
// dose_number 0 means "unknown": fill in by order of date
for (const p of patients) for (const v of VACCINES) {
  const mine = immunizations.filter(x => x.patientId === p.id && x.vaccineId === v.id).sort((a, b) => a.date.localeCompare(b.date));
  mine.forEach((x, k) => { if (!x.doseNumber) x.doseNumber = k + 1; });
}

// ---- appointments ---------------------------------------------------------------
const appointments = readCsv('appointments.csv').map((r, i) => {
  const f = 'appointments.csv'; need(f, i, r, ['appointment_id', 'patient_id', 'date', 'time', 'type']);
  if (!patientIds.has(r.patient_id)) err(f, i, `unknown patient_id "${r.patient_id}"`);
  if (!['well', 'sick'].includes(r.type)) err(f, i, `type must be well or sick, got "${r.type}"`);
  if (!/^\d{2}:\d{2}$/.test(r.time)) err(f, i, `time must be HH:MM, got "${r.time}"`);
  return { id: r.appointment_id, patientId: r.patient_id, date: date(f, i, r, 'date'), time: r.time, type: r.type, status: r.status || 'scheduled', reason: r.reason || (r.type === 'well' ? 'Well visit' : 'Sick visit') };
});

// ---- lots -----------------------------------------------------------------------
const lots = readCsv('lots.csv').map((r, i) => {
  const f = 'lots.csv'; need(f, i, r, ['product_id', 'lot_number', 'funding_source', 'quantity', 'expires_on']);
  if (!productIds.has(r.product_id)) err(f, i, `unknown product_id "${r.product_id}" (valid: ${[...productIds].join(', ')})`);
  if (!['PRIVATE', 'VFC'].includes(r.funding_source)) err(f, i, `funding_source must be PRIVATE or VFC`);
  const product = [...VACCINES, ...SUPPLIES].find(p => p.id === r.product_id);
  const unitCost = r.unit_cost !== '' && r.unit_cost !== undefined ? num(f, i, r, 'unit_cost') : (r.funding_source === 'VFC' ? 0 : (product ? product.cost : 0));
  return { id: `L${String(i + 1).padStart(3, '0')}`, productId: r.product_id, lotNumber: r.lot_number, fundingSource: r.funding_source, quantity: num(f, i, r, 'quantity', 0), unitCost, expiresOn: date(f, i, r, 'expires_on'), location: r.location || '', receivedOn: date(f, i, r, 'received_on', true) };
});

// ---- optional history ----------------------------------------------------------------
const claims = readCsv('claims.csv', false).map((r, i) => {
  const f = 'claims.csv'; need(f, i, r, ['patient_id', 'service_date', 'product_id', 'status']);
  const p = patients.find(x => x.id === r.patient_id); if (!p) err(f, i, `unknown patient_id "${r.patient_id}"`);
  const v = VACCINES.find(x => x.id === r.product_id); if (!v) err(f, i, `unknown product_id "${r.product_id}"`);
  if (!['paid', 'submitted', 'denied', 'self-pay'].includes(r.status)) err(f, i, 'status must be paid, submitted, denied or self-pay');
  const funding = r.funding_source || (p && PAYERS.find(x => x.id === p.payerId)?.vfc ? 'VFC' : 'PRIVATE');
  return { id: r.claim_id || `C${String(i + 1).padStart(4, '0')}`, patientId: r.patient_id, patientName: p ? p.name : '', payerId: p ? p.payerId : '', serviceDate: date(f, i, r, 'service_date'), productId: r.product_id, short: v ? v.short : r.product_id, fundingSource: funding,
    cptLines: v ? [{ cpt: v.cpt, desc: v.name, charge: num(f, i, r, 'charge', 0) }, { cpt: '90460', desc: 'Immunization admin, first component, with counseling', charge: 45 }] : [],
    cost: funding === 'VFC' ? 0 : num(f, i, r, 'cost', v ? v.cost : 0), expectedAmount: num(f, i, r, 'expected_amount', 0), status: r.status, paidAmount: num(f, i, r, 'paid_amount', 0), denialReason: r.denial_reason || null, submittedOn: date(f, i, r, 'submitted_on', true) };
});
const waste = readCsv('waste.csv', false).map((r, i) => {
  const f = 'waste.csv'; need(f, i, r, ['date', 'product_id', 'reason']);
  const v = [...VACCINES, ...SUPPLIES].find(x => x.id === r.product_id); if (!v) err(f, i, `unknown product_id "${r.product_id}"`);
  const p = r.patient_id ? patients.find(x => x.id === r.patient_id) : null;
  return { id: `W${String(i + 1).padStart(3, '0')}`, date: date(f, i, r, 'date'), productId: r.product_id, short: v ? v.short : r.product_id, lotNumber: r.lot_number || '', patientId: p ? p.id : null, patientName: p ? p.name : null, fundingSource: r.funding_source || 'PRIVATE', cost: num(f, i, r, 'cost', v ? v.cost : 0), reason: r.reason, recordedBy: r.recorded_by || 'import' };
});

// ---- warnings ------------------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
if (!appointments.some(a => a.date >= today)) warnings.push('no appointments on or after today: Readiness will be empty');
for (const p of patients) if (!immunizations.some(i => i.patientId === p.id)) warnings.push(`patient ${p.id} has no immunization history: every age-eligible dose will show as due`);
if (!lots.some(l => l.fundingSource === 'VFC') && patients.some(p => PAYERS.find(x => x.id === p.payerId)?.vfc)) warnings.push('VFC-eligible patients exist but no VFC lots were provided');

// ---- report / write --------------------------------------------------------------------
console.log(`Read ${patients.length} patients, ${immunizations.length} immunizations, ${appointments.length} appointments, ${lots.length} lots, ${claims.length} claims, ${waste.length} waste records from ${dir}`);
for (const w of warnings.slice(0, 20)) console.log('  warning:', w);
if (warnings.length > 20) console.log(`  ... and ${warnings.length - 20} more warnings`);
if (errors.length) { console.error(`\n${errors.length} error(s):`); errors.slice(0, 50).forEach(e => console.error('  ' + e)); process.exit(1); }
if (dryRun) { console.log('\nDry run: no files written. Data is valid.'); process.exit(0); }

const state = { meta: { synthetic: false, source: path.basename(path.resolve(dir)), importedOn: today }, patients, immunizations, appointments, lots, orders: [], doses: [], claims, waste,
  auditLog: [{ at: new Date().toISOString(), actor: 'importer', action: 'import', detail: `Imported from ${dir}` }] };
const out = path.join(__dirname, '..', 'data', 'store.json');
if (fs.existsSync(out)) fs.copyFileSync(out, out.replace(/\.json$/, `.backup-${Date.now()}.json`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(state, null, 1));
console.log(`\nWrote ${out} (previous store backed up alongside). Start the app with: npm run dev`);

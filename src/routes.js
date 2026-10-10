const express = require('express');
const store = require('./store');
const E = require('./engine');
const D = require('./dates');
const { VACCINES, SUPPLIES, PAYERS, productById, expectedReimbursement } = require('./catalog');
const CFG = require('./config');

const r = express.Router();
const S = () => store.load();
const newId = (prefix, arr) => `${prefix}${String(arr.length + 1).padStart(4, '0')}`;
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
function audit(state, actor, action, detail) { state.auditLog.unshift({ at: new Date().toISOString(), actor: actor || 'front desk', action, detail }); state.auditLog = state.auditLog.slice(0, 500); }

r.get('/meta', (_q, res) => res.json({ ...S().meta, practice: CFG.PRACTICE_NAME, today: D.today(), nextDay: D.nextBusinessDay(D.today()), config: { safetyStock: E.SAFETY_STOCK, leadTimeDays: E.LEAD_TIME_DAYS, orderCutoff: E.ORDER_CUTOFF, expiryWarnDays: E.EXPIRY_WARN_DAYS } }));
r.get('/catalog', (_q, res) => res.json({ vaccines: VACCINES, supplies: SUPPLIES, payers: PAYERS }));
r.get('/dashboard', (_q, res) => res.json(E.dashboard(S())));

// ---- Inventory --------------------------------------------------------------------------
r.get('/inventory', (_q, res) => {
  const s = S(); const t = D.today();
  const lots = s.lots.map(l => ({ ...l, short: productById(l.productId).short, name: productById(l.productId).name, daysToExpiry: D.daysBetween(t, l.expiresOn), value: l.quantity * l.unitCost }))
    .sort((a, b) => a.short.localeCompare(b.short) || a.expiresOn.localeCompare(b.expiresOn));
  // 7-day demand per product|funding, for the summary table
  const demand = {};
  for (let i = 0; i < 10; i++) { const d = D.addDays(t, i); if (D.isWeekend(d)) continue; for (const ln of E.readiness(s, d).lines) { const k = `${ln.productId}|${ln.fundingSource}`; demand[k] = (demand[k] || 0) + ln.demand; } }
  const summary = [...VACCINES.map(v => ({ ...v, kind: 'vaccine' })), ...SUPPLIES.map(x => ({ ...x, kind: 'supply' }))].flatMap(p => (p.kind === 'vaccine' ? ['PRIVATE', 'VFC'] : ['PRIVATE']).map(f => ({
    productId: p.id, short: p.short, name: p.name, kind: p.kind, fundingSource: f, cost: f === 'VFC' ? 0 : p.cost,
    onHand: E.onHand(s, p.id, f, t), demand7: demand[`${p.id}|${f}`] || 0,
    expiringSoon: lots.filter(l => l.productId === p.id && l.fundingSource === f && l.daysToExpiry >= 0 && l.daysToExpiry <= E.EXPIRY_WARN_DAYS).reduce((a, l) => a + l.quantity, 0),
  })));
  res.json({ lots, summary });
});
r.post('/inventory/adjust', (q, res) => {
  const s = S(); const l = s.lots.find(x => x.id === q.body.lotId) || fail(404, 'Lot not found');
  const delta = Number(q.body.delta); if (!Number.isFinite(delta)) fail(400, 'delta required');
  if (l.quantity + delta < 0) fail(400, 'Cannot go below zero');
  l.quantity += delta;
  if (delta < 0 && q.body.reason) {
    const p = productById(l.productId);
    s.waste.unshift({ id: newId('W', s.waste), date: D.today(), productId: l.productId, short: p.short, lotNumber: l.lotNumber, patientId: null, patientName: null, fundingSource: l.fundingSource, cost: -delta * l.unitCost, reason: q.body.reason, recordedBy: q.body.actor || 'front desk' });
  }
  audit(s, q.body.actor, 'inventory.adjust', `${l.lotNumber} ${delta > 0 ? '+' : ''}${delta} (${q.body.reason || 'count correction'})`);
  store.save(); res.json(l);
});

// ---- Patients & appointments ------------------------------------------------------------------
r.get('/patients', (_q, res) => {
  const s = S(); const t = D.today();
  res.json(s.patients.map(p => ({ ...p, ageLabel: E.ageLabel(p.dob, t), payerName: E.payerById(p.payerId).name, fundingSource: E.fundingSourceFor(p), due: E.dueVaccines(p, t, s.immunizations.filter(i => i.patientId === p.id)).map(d => d.vaccineId), nextAppt: (s.appointments.filter(a => a.patientId === p.id && a.date >= t && a.status === 'scheduled').sort((a, b) => a.date.localeCompare(b.date))[0] || null) })));
});
r.get('/patients/:id', (q, res) => {
  const s = S(); const p = s.patients.find(x => x.id === q.params.id) || fail(404, 'Patient not found');
  const history = s.immunizations.filter(i => i.patientId === p.id).map(i => ({ ...i, short: E.vaccineById(i.vaccineId).short })).sort((a, b) => a.date.localeCompare(b.date));
  res.json({ ...p, ageLabel: E.ageLabel(p.dob, D.today()), payerName: E.payerById(p.payerId).name, fundingSource: E.fundingSourceFor(p), history, due: E.dueVaccines(p, D.today(), history).map(d => ({ ...d, short: E.vaccineById(d.vaccineId).short })), appointments: s.appointments.filter(a => a.patientId === p.id), claims: s.claims.filter(c => c.patientId === p.id) });
});
r.get('/appointments', (q, res) => {
  const s = S(); const date = q.query.date;
  const list = s.appointments.filter(a => !date || a.date === date).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  res.json(list.map(a => E.enrichAppointment(s, a)));
});
r.get('/appointments/:id', (q, res) => { const s = S(); const a = s.appointments.find(x => x.id === q.params.id) || fail(404, 'Appointment not found'); res.json(E.enrichAppointment(s, a)); });
r.get('/readiness', (q, res) => res.json(E.readiness(S(), q.query.date || D.nextBusinessDay(D.today()))));

// ---- Eligibility ----------------------------------------------------------------------------
r.post('/eligibility/verify', (q, res) => {
  const s = S(); const p = s.patients.find(x => x.id === q.body.patientId) || fail(404, 'Patient not found');
  p.eligibility = E.runEligibilityCheck(p, q.body.date || D.today());
  audit(s, q.body.actor, 'eligibility.verify', `${p.name}: ${p.eligibility.status}`);
  store.save(); res.json(p.eligibility);
});
r.post('/eligibility/verify-day', (q, res) => {
  const s = S(); const date = q.body.date || D.nextBusinessDay(D.today());
  const appts = s.appointments.filter(a => a.date === date && a.status === 'scheduled');
  const results = appts.map(a => { const p = s.patients.find(x => x.id === a.patientId); p.eligibility = E.runEligibilityCheck(p, date); return { patientId: p.id, name: p.name, ...p.eligibility }; });
  audit(s, q.body.actor, 'eligibility.batch', `${date}: ${results.length} checked, ${results.filter(x => x.status === 'inactive').length} inactive`);
  store.save(); res.json({ date, results });
});
r.post('/patients/:id/fix-insurance', (q, res) => {
  // Demo helper: front desk called the family and got the corrected card.
  const s = S(); const p = s.patients.find(x => x.id === q.params.id) || fail(404, 'Patient not found');
  if (q.body.payerId) p.payerId = q.body.payerId;
  if (q.body.memberId) p.insurance.memberId = q.body.memberId;
  p.insurance.flaky = false; p.insurance.termDate = null;
  p.eligibility = E.runEligibilityCheck(p, D.today());
  audit(s, q.body.actor, 'patient.insurance', `${p.name}: updated to ${E.payerById(p.payerId).name}`);
  store.save(); res.json(p);
});

// ---- Orders ------------------------------------------------------------------------------------
r.get('/orders', (_q, res) => res.json(S().orders.sort((a, b) => b.createdOn.localeCompare(a.createdOn))));
r.post('/orders', (q, res) => {
  const s = S(); const lines = (q.body.lines || []).filter(l => l.quantity > 0);
  if (!lines.length) fail(400, 'No lines');
  const t = D.today();
  const vfc = lines.some(l => l.fundingSource === 'VFC'), priv = lines.some(l => l.fundingSource === 'PRIVATE');
  const made = [];
  if (priv) made.push(mkOrder(s, lines.filter(l => l.fundingSource === 'PRIVATE'), CFG.DISTRIBUTOR_NAME, D.nextBusinessDay(t), 'submitted', q.body.note, q.body.actor));
  if (vfc) made.push(mkOrder(s, lines.filter(l => l.fundingSource === 'VFC'), CFG.VFC_PROGRAM_NAME, D.addDays(D.nextBusinessDay(t), CFG.VFC_LEAD_TIME_DAYS), 'submitted', (q.body.note ? q.body.note + ' | ' : '') + 'VFC allocation request', q.body.actor));
  store.save(); res.json(made);
});
function mkOrder(s, lines, vendor, expectedOn, status, note, actor) {
  const o = { id: newId('O', s.orders), createdOn: D.today(), status, vendor, expectedOn, note: note || '', createdBy: actor || 'front desk',
    lines: lines.map(l => ({ productId: l.productId, short: productById(l.productId).short, fundingSource: l.fundingSource, quantity: Number(l.quantity), unitCost: l.fundingSource === 'VFC' ? 0 : productById(l.productId).cost })) };
  o.total = o.lines.reduce((a, l) => a + l.quantity * l.unitCost, 0);
  s.orders.unshift(o); audit(s, actor, 'order.create', `${o.id} ${vendor} $${o.total}`); return o;
}
r.post('/orders/:id/receive', (q, res) => {
  const s = S(); const o = s.orders.find(x => x.id === q.params.id) || fail(404, 'Order not found');
  if (o.status === 'received') fail(400, 'Already received');
  const t = D.today();
  for (const l of o.lines) {
    const p = productById(l.productId);
    s.lots.push({ id: `L${String(s.lots.length + 1).padStart(3, '0')}`, productId: l.productId, lotNumber: `${p.mfr.slice(0, 3).toUpperCase()}${Math.floor(10000 + Math.random() * 89999)}`, fundingSource: l.fundingSource, quantity: l.quantity, unitCost: l.unitCost, expiresOn: D.addDays(t, 365 + Math.floor(Math.random() * 300)), location: l.fundingSource === 'VFC' ? 'Fridge 2 (VFC, shelf B)' : 'Fridge 1 (private)', receivedOn: t, orderId: o.id });
  }
  o.status = 'received'; o.receivedOn = t; audit(s, q.body.actor, 'order.receive', `${o.id} ${o.lines.length} line(s) into stock`);
  store.save(); res.json(o);
});

// ---- Visit workflow: draw -> administer | waste -----------------------------------------------
r.post('/visits/:apptId/draw', (q, res) => {
  const s = S(); const a = s.appointments.find(x => x.id === q.params.apptId) || fail(404, 'Appointment not found');
  const ea = E.enrichAppointment(s, a);
  const need = ea.needs.find(n => n.vaccineId === q.body.vaccineId) || fail(400, 'That vaccine is not due for this patient');
  if (need.dose) fail(400, 'A dose is already drawn or given for this vaccine');
  // The guardrail Raj asked for: no dose leaves the fridge without active coverage.
  if (ea.eligibility.status !== 'active' && !q.body.override) fail(409, `Eligibility is ${ea.eligibility.status}. Verify insurance (or record a self-pay override) before drawing.`);
  const lots = E.lotsFor(s, need.vaccineId, need.fundingSource, a.date);
  if (!lots.length) fail(409, `No ${need.short} in ${need.fundingSource} stock.`);
  const lot = lots[0]; lot.quantity -= 1;
  const dose = { id: newId('D', s.doses), appointmentId: a.id, patientId: a.patientId, productId: need.vaccineId, short: need.short, doseNumber: need.doseNumber, lotId: lot.id, lotNumber: lot.lotNumber, fundingSource: need.fundingSource, unitCost: lot.unitCost, status: 'drawn', drawnAt: new Date().toISOString(), drawnBy: q.body.actor || 'MA', override: !!q.body.override };
  s.doses.push(dose); if (a.status === 'scheduled') a.status = 'in-progress';
  audit(s, q.body.actor, 'dose.draw', `${ea.patient.name}: ${need.short} from ${lot.lotNumber} (${need.fundingSource})`);
  store.save(); res.json(E.enrichAppointment(s, a));
});
r.post('/visits/:apptId/administer', (q, res) => {
  const s = S(); const a = s.appointments.find(x => x.id === q.params.apptId) || fail(404, 'Appointment not found');
  const dose = s.doses.find(d => d.id === q.body.doseId && d.appointmentId === a.id) || fail(404, 'Dose not found');
  if (dose.status !== 'drawn') fail(400, `Dose is ${dose.status}`);
  const p = s.patients.find(x => x.id === a.patientId); const v = E.vaccineById(dose.productId); const payer = E.payerById(p.payerId);
  dose.status = 'administered'; dose.administeredAt = new Date().toISOString(); dose.site = q.body.site || 'Left thigh IM';
  s.immunizations.push({ id: `I${Math.random().toString(36).slice(2, 9)}`, patientId: p.id, vaccineId: v.id, doseNumber: dose.doseNumber, date: a.date, lotNumber: dose.lotNumber, source: 'administered' });
  // Billing hand-off: claim is created the moment the dose is given, with the right funding treatment.
  const exp = expectedReimbursement(v, payer, dose.fundingSource);
  const nAdministeredToday = s.doses.filter(d => d.appointmentId === a.id && d.status === 'administered').length;
  const adminCpt = nAdministeredToday === 1 ? '90460' : '90461';
  const claim = { id: newId('C', s.claims), patientId: p.id, patientName: p.name, payerId: p.payerId, serviceDate: a.date, productId: v.id, short: v.short, fundingSource: dose.fundingSource,
    cptLines: [{ cpt: v.cpt, desc: v.name, charge: dose.fundingSource === 'VFC' ? 0 : Math.round(v.cost * 1.6 * 100) / 100, ndc: true, lot: dose.lotNumber }, { cpt: adminCpt, desc: adminCpt === '90460' ? 'Immunization admin, first component, with counseling' : 'Immunization admin, each additional component', charge: adminCpt === '90460' ? 45 : 25 }],
    cost: dose.unitCost, expectedAmount: p.payerId === 'SELF' ? 0 : exp.total, status: p.payerId === 'SELF' ? 'self-pay' : 'submitted', paidAmount: 0, denialReason: null, submittedOn: D.today(), doseId: dose.id };
  s.claims.unshift(claim); dose.claimId = claim.id;
  audit(s, q.body.actor, 'dose.administer', `${p.name}: ${v.short} dose ${dose.doseNumber}, claim ${claim.id} ($${claim.expectedAmount} expected)`);
  store.save(); res.json(E.enrichAppointment(s, a));
});
r.post('/visits/:apptId/waste', (q, res) => {
  const s = S(); const a = s.appointments.find(x => x.id === q.params.apptId) || fail(404, 'Appointment not found');
  const dose = s.doses.find(d => d.id === q.body.doseId && d.appointmentId === a.id) || fail(404, 'Dose not found');
  if (dose.status !== 'drawn') fail(400, `Dose is ${dose.status}`);
  const p = s.patients.find(x => x.id === a.patientId);
  dose.status = 'wasted'; dose.wastedAt = new Date().toISOString(); dose.wasteReason = q.body.reason || 'Parent declined after draw';
  s.waste.unshift({ id: newId('W', s.waste), date: a.date, productId: dose.productId, short: dose.short, lotNumber: dose.lotNumber, patientId: p.id, patientName: p.name, fundingSource: dose.fundingSource, cost: dose.unitCost, reason: dose.wasteReason, recordedBy: q.body.actor || 'MA', doseId: dose.id });
  audit(s, q.body.actor, 'dose.waste', `${p.name}: ${dose.short} wasted ($${dose.unitCost}) - ${dose.wasteReason}`);
  store.save(); res.json(E.enrichAppointment(s, a));
});
r.post('/visits/:apptId/complete', (q, res) => {
  const s = S(); const a = s.appointments.find(x => x.id === q.params.apptId) || fail(404, 'Appointment not found');
  if (s.doses.some(d => d.appointmentId === a.id && d.status === 'drawn')) fail(400, 'A drawn dose is still open. Administer or waste it first.');
  a.status = 'completed'; audit(s, q.body.actor, 'visit.complete', a.id); store.save(); res.json(E.enrichAppointment(s, a));
});
r.post('/appointments/:id/status', (q, res) => {
  const s = S(); const a = s.appointments.find(x => x.id === q.params.id) || fail(404, 'Appointment not found');
  if (!['scheduled', 'cancelled', 'rescheduled'].includes(q.body.status)) fail(400, 'Bad status');
  a.status = q.body.status; audit(s, q.body.actor, 'appointment.status', `${a.id} -> ${a.status}`); store.save(); res.json(E.enrichAppointment(s, a));
});

// ---- Claims & waste -------------------------------------------------------------------------------
r.get('/claims', (_q, res) => res.json(S().claims.sort((a, b) => b.serviceDate.localeCompare(a.serviceDate))));
r.post('/claims/:id/adjudicate', (q, res) => {
  // Simulated 835 remittance. Real system: clearinghouse posts ERA.
  const s = S(); const c = s.claims.find(x => x.id === q.params.id) || fail(404, 'Claim not found');
  if (c.status !== 'submitted') fail(400, `Claim is ${c.status}`);
  const p = s.patients.find(x => x.id === c.patientId);
  const elig = E.runEligibilityCheck(p, c.serviceDate);
  if (elig.status === 'active') { c.status = 'paid'; c.paidAmount = c.expectedAmount; c.paidOn = D.today(); }
  else { c.status = 'denied'; c.denialReason = 'CO-27 Coverage terminated before service date'; }
  audit(s, q.body.actor, 'claim.adjudicate', `${c.id} ${c.status} $${c.paidAmount}`); store.save(); res.json(c);
});
r.get('/waste', (_q, res) => res.json(S().waste.sort((a, b) => b.date.localeCompare(a.date))));
r.get('/audit', (_q, res) => res.json(S().auditLog.slice(0, 200)));

// ---- Demo controls -----------------------------------------------------------------------------
r.post('/reset', (_q, res) => {
  // Guard: never wipe a store that was imported from real data.
  if (!S().meta.synthetic) fail(403, 'Reset is disabled because this store holds imported (non-synthetic) data. Re-run the importer instead.');
  store.reset(); res.json({ ok: true });
});

module.exports = r;

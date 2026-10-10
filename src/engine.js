// Core logic: due-dose forecasting, eligibility, stock matching, reorder math, alerts.
const { VACCINES, SUPPLIES, PAYERS, expectedReimbursement } = require('./catalog');
const D = require('./dates');
const { SAFETY_STOCK, LEAD_TIME_DAYS, ORDER_CUTOFF, EXPIRY_WARN_DAYS, MIN_INTERVAL_DAYS, VFC_PROGRAM_NAME } = require('./config');

const payerById = id => PAYERS.find(p => p.id === id);
const vaccineById = id => VACCINES.find(v => v.id === id);

// ---- Due doses -----------------------------------------------------------------
// Which vaccine doses are due for this patient on the given date, given history.
function dueVaccines(patient, onDate, history) {
  const age = D.ageMonths(patient.dob, onDate);
  const month = D.monthOf(onDate);
  const out = [];
  for (const v of VACCINES) {
    const given = history.filter(h => h.vaccineId === v.id).sort((a, b) => a.date.localeCompare(b.date));
    if (age > v.maxAgeMonths) continue;
    if (v.season && !v.season.includes(month)) continue;
    if (v.annual) {
      const season = onDate.slice(0, 4);
      if (age >= v.doses[0] && !given.some(g => g.date.slice(0, 4) === season)) {
        out.push({ vaccineId: v.id, doseNumber: given.length + 1, reason: `annual ${v.short} not yet given this season` });
      }
      continue;
    }
    const n = given.length;
    if (n >= v.doses.length) continue;
    const minAge = v.doses[n];
    if (age < minAge) continue;
    const last = given[n - 1];
    if (last && D.daysBetween(last.date, onDate) < MIN_INTERVAL_DAYS) continue;
    const overdue = age - minAge;
    out.push({ vaccineId: v.id, doseNumber: n + 1, reason: overdue >= 2 ? `dose ${n + 1} overdue by ${overdue} mo` : `dose ${n + 1} due at ${minAge} mo` });
  }
  return out;
}

// ---- Eligibility (mock 270/271 transaction) ------------------------------------
// Deterministic stand-in for a payer eligibility API. Real system: clearinghouse call.
function runEligibilityCheck(patient, onDate) {
  const payer = payerById(patient.payerId);
  const ins = patient.insurance;
  let status, detail;
  if (patient.payerId === 'SELF') { status = 'active'; detail = 'Self-pay. VFC-eligible (uninsured).'; }
  else if (ins.termDate && ins.termDate <= onDate) { status = 'inactive'; detail = `Coverage terminated ${ins.termDate}. Payer returned AAA-72 (subscriber not found).`; }
  else if (ins.flaky) { status = 'inactive'; detail = 'Member ID not found at payer. Likely a typo in the member ID on file.'; }
  else { status = 'active'; detail = `${payer.name} ${ins.plan}. Preventive care covered at 100%, copay $0 for immunizations.`; }
  return { status, detail, checkedOn: onDate, checkedAt: new Date().toISOString(), payerId: patient.payerId };
}

function fundingSourceFor(patient) {
  const payer = payerById(patient.payerId);
  return payer && payer.vfc ? 'VFC' : 'PRIVATE';
}

// ---- Inventory ------------------------------------------------------------------
function lotsFor(state, productId, fundingSource, onDate) {
  return state.lots
    .filter(l => l.productId === productId && l.fundingSource === fundingSource && l.quantity > 0 && l.expiresOn > onDate)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)); // FEFO: first-expire, first-out
}
function onHand(state, productId, fundingSource, onDate) {
  return lotsFor(state, productId, fundingSource, onDate).reduce((s, l) => s + l.quantity, 0);
}
function inboundBy(state, productId, fundingSource, byDate) {
  return state.orders
    .filter(o => ['submitted', 'approved', 'shipped'].includes(o.status) && o.expectedOn <= byDate)
    .flatMap(o => o.lines)
    .filter(ln => ln.productId === productId && ln.fundingSource === fundingSource)
    .reduce((s, ln) => s + ln.quantity, 0);
}

// ---- Appointment enrichment --------------------------------------------------------
function enrichAppointment(state, appt) {
  const patient = state.patients.find(p => p.id === appt.patientId);
  const history = state.immunizations.filter(i => i.patientId === patient.id);
  const elig = patient.eligibility;
  const eligStatus = elig && elig.checkedOn >= D.addDays(appt.date, -7) ? elig.status : 'unverified';
  const funding = fundingSourceFor(patient);
  const payer = payerById(patient.payerId);
  const doses = state.doses.filter(d => d.appointmentId === appt.id);
  let needs = [];
  if (appt.type === 'well') {
    needs = dueVaccines(patient, appt.date, history).map(n => {
      const v = vaccineById(n.vaccineId);
      const existing = doses.find(d => d.productId === n.vaccineId && d.status !== 'wasted');
      return {
        ...n, short: v.short, name: v.name, cost: funding === 'VFC' ? 0 : v.cost, fundingSource: funding,
        onHand: onHand(state, v.id, funding, appt.date),
        expected: expectedReimbursement(v, payer, funding).total,
        dose: existing || null,
      };
    });
  }
  const expectedTests = appt.type === 'sick' ? SUPPLIES.map(s => ({ productId: s.id, short: s.short, probability: s.perSickVisit })) : [];
  return {
    ...appt,
    patient: { id: patient.id, name: patient.name, dob: patient.dob, ageLabel: ageLabel(patient.dob, appt.date), payerId: patient.payerId, payerName: payer.name, memberId: patient.insurance.memberId },
    eligibility: { status: eligStatus, detail: elig ? elig.detail : 'Not yet verified for this visit.', checkedOn: elig ? elig.checkedOn : null },
    fundingSource: funding,
    needs, expectedTests, doses,
    flags: buildApptFlags(eligStatus, needs),
  };
}

function buildApptFlags(eligStatus, needs) {
  const f = [];
  if (eligStatus === 'inactive') f.push({ level: 'danger', text: 'Insurance inactive. Do not draw vaccine until resolved.' });
  if (eligStatus === 'unverified') f.push({ level: 'warn', text: 'Eligibility not verified.' });
  const short = needs.filter(n => n.onHand <= 0);
  if (short.length) f.push({ level: 'danger', text: `Out of stock: ${short.map(s => s.short).join(', ')}` });
  return f;
}

function ageLabel(dob, on) {
  const m = D.ageMonths(dob, on);
  if (m < 24) return `${m} mo`;
  return `${Math.floor(m / 12)} yr ${m % 12 ? (m % 12) + ' mo' : ''}`.trim();
}

// ---- Readiness: demand vs stock for a day --------------------------------------------
function readiness(state, date) {
  const appts = state.appointments.filter(a => a.date === date && a.status !== 'cancelled').map(a => enrichAppointment(state, a));
  const demand = {}; // key productId|funding
  for (const a of appts) {
    // Inactive patients still count toward demand: the front desk usually fixes coverage before the visit.
    for (const n of a.needs) {
      if (n.dose && n.dose.status === 'administered') continue;
      const k = `${n.vaccineId}|${n.fundingSource}`;
      demand[k] = demand[k] || { productId: n.vaccineId, short: n.short, name: n.name, fundingSource: n.fundingSource, cost: n.cost, kind: 'vaccine', demand: 0, patients: [] };
      demand[k].demand += 1;
      demand[k].patients.push(a.patient.name);
    }
    if (a.type === 'sick') {
      for (const s of SUPPLIES) {
        const k = `${s.id}|PRIVATE`;
        demand[k] = demand[k] || { productId: s.id, short: s.short, name: s.name, fundingSource: 'PRIVATE', cost: s.cost, kind: 'supply', demand: 0, patients: [] };
        demand[k].demand += s.perSickVisit;
      }
    }
  }
  const lines = Object.values(demand).map(row => {
    const dem = Math.ceil(row.demand);
    const have = onHand(state, row.productId, row.fundingSource, date);
    const inbound = inboundBy(state, row.productId, row.fundingSource, date);
    const shortfall = Math.max(0, dem + SAFETY_STOCK - have - inbound);
    return { ...row, demand: dem, onHand: have, inbound, shortfall,
      status: have + inbound >= dem ? (have + inbound >= dem + SAFETY_STOCK ? 'ok' : 'tight') : 'short' };
  }).sort((a, b) => (b.shortfall - a.shortfall) || (b.demand - a.demand));

  const todayISO = D.today();
  const canArrive = D.nextBusinessDay(todayISO) <= date;
  const recommendation = lines.filter(l => l.shortfall > 0).map(l => ({
    productId: l.productId, short: l.short, name: l.name, fundingSource: l.fundingSource, quantity: l.shortfall,
    unitCost: l.fundingSource === 'VFC' ? 0 : l.cost,
    channel: l.fundingSource === 'VFC' ? `${VFC_PROGRAM_NAME} order` : 'Distributor, next-morning delivery',
    arrivesInTime: l.fundingSource === 'VFC' ? false : canArrive,
  }));

  return {
    date, appointments: appts, lines, recommendation,
    summary: {
      appointments: appts.length,
      wellVisits: appts.filter(a => a.type === 'well').length,
      sickVisits: appts.filter(a => a.type === 'sick').length,
      unverified: appts.filter(a => a.eligibility.status === 'unverified').length,
      inactive: appts.filter(a => a.eligibility.status === 'inactive').length,
      dosesNeeded: lines.filter(l => l.kind === 'vaccine').reduce((s, l) => s + l.demand, 0),
      productsShort: lines.filter(l => l.status === 'short').length,
      orderValue: recommendation.reduce((s, r) => s + r.quantity * r.unitCost, 0),
      orderCutoff: ORDER_CUTOFF, leadTimeDays: LEAD_TIME_DAYS, canArrive,
    },
  };
}

// ---- Dashboard --------------------------------------------------------------------
function dashboard(state) {
  const t = D.today();
  const since60 = D.addDays(t, -60);
  const mtd = t.slice(0, 8) + '01';
  const lotRows = state.lots.map(l => ({ ...l, daysToExpiry: D.daysBetween(t, l.expiresOn) }));
  const expiringSoon = lotRows.filter(l => l.quantity > 0 && l.daysToExpiry >= 0 && l.daysToExpiry <= EXPIRY_WARN_DAYS);
  const expired = lotRows.filter(l => l.quantity > 0 && l.daysToExpiry < 0);
  const privateValue = lotRows.filter(l => l.fundingSource === 'PRIVATE' && l.daysToExpiry >= 0).reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const wasted = state.waste.filter(w => w.date >= since60);
  const wastedMTD = state.waste.filter(w => w.date >= mtd);
  const claims = state.claims.filter(c => c.serviceDate >= since60);
  const paid = claims.filter(c => c.status === 'paid');
  const denied = claims.filter(c => c.status === 'denied');
  const margin = paid.reduce((s, c) => s + (c.paidAmount - c.cost), 0);
  const deniedLoss = denied.reduce((s, c) => s + c.cost, 0);

  const nextDay = D.nextBusinessDay(t);
  const tomorrow = readiness(state, nextDay);
  const todayR = readiness(state, t);

  const alerts = [];
  for (const l of tomorrow.lines.filter(x => x.status === 'short'))
    alerts.push({ level: 'danger', area: 'stock', text: `${l.short} (${l.fundingSource}): ${l.demand} needed ${nextDay}, ${l.onHand} on hand${l.inbound ? `, ${l.inbound} inbound` : ''}. Order ${l.shortfall} before ${ORDER_CUTOFF} today.` });
  if (tomorrow.summary.inactive) alerts.push({ level: 'danger', area: 'eligibility', text: `${tomorrow.summary.inactive} patient(s) scheduled ${nextDay} have inactive insurance. Call family before visit.` });
  if (tomorrow.summary.unverified) alerts.push({ level: 'warn', area: 'eligibility', text: `${tomorrow.summary.unverified} patient(s) scheduled ${nextDay} not yet verified. Run batch verification.` });
  for (const l of expired) alerts.push({ level: 'danger', area: 'expiry', text: `Lot ${l.lotNumber} (${productShort(l.productId)}) expired ${l.expiresOn} with ${l.quantity} doses. Quarantine and report.` });
  for (const l of expiringSoon) alerts.push({ level: 'warn', area: 'expiry', text: `Lot ${l.lotNumber} (${productShort(l.productId)}) expires in ${l.daysToExpiry} days, ${l.quantity} doses ($${(l.quantity * l.unitCost).toFixed(0)}). Use first or transfer.` });
  for (const l of todayR.lines.filter(x => x.status === 'short'))
    alerts.push({ level: 'danger', area: 'stock', text: `TODAY: ${l.short} short by ${l.demand - l.onHand}. Reschedule or borrow from partner practice.` });

  return {
    today: t, nextDay,
    kpis: {
      privateInventoryValue: round(privateValue),
      dosesExpiringSoon: expiringSoon.reduce((s, l) => s + l.quantity, 0),
      valueExpiringSoon: round(expiringSoon.reduce((s, l) => s + l.quantity * l.unitCost, 0)),
      wasted60: wasted.length, wastedValue60: round(wasted.reduce((s, w) => s + w.cost, 0)),
      wastedValueMTD: round(wastedMTD.reduce((s, w) => s + w.cost, 0)),
      claims60: claims.length, paid60: paid.length, denied60: denied.length,
      margin60: round(margin), deniedLoss60: round(deniedLoss),
      pendingClaimsValue: round(claims.filter(c => c.status === 'submitted').reduce((s, c) => s + c.expectedAmount, 0)),
    },
    tomorrow: tomorrow.summary, todaySummary: todayR.summary,
    alerts: alerts.sort((a, b) => (a.level === 'danger' ? 0 : 1) - (b.level === 'danger' ? 0 : 1)),
    wasteByReason: groupSum(wasted, w => w.reason, w => w.cost),
    lossBreakdown: {
      wasted: round(wasted.reduce((s, w) => s + w.cost, 0)),
      denied: round(deniedLoss),
      expired: round(expired.reduce((s, l) => s + l.quantity * l.unitCost, 0)),
    },
  };
}

function productShort(id) { const p = VACCINES.find(v => v.id === id) || SUPPLIES.find(s => s.id === id); return p ? p.short : id; }
function round(n) { return Math.round(n * 100) / 100; }
function groupSum(arr, keyFn, valFn) {
  const out = {};
  for (const x of arr) { const k = keyFn(x); out[k] = round((out[k] || 0) + valFn(x)); }
  return out;
}

module.exports = { dueVaccines, runEligibilityCheck, fundingSourceFor, lotsFor, onHand, enrichAppointment, readiness, dashboard, ageLabel, SAFETY_STOCK, LEAD_TIME_DAYS, ORDER_CUTOFF, EXPIRY_WARN_DAYS, payerById, vaccineById };

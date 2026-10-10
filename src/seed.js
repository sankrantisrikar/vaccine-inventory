// Deterministic demo data, generated relative to the current date so the demo always
// has "today", "tomorrow" and a week of appointments.
const { VACCINES, SUPPLIES, PAYERS, expectedReimbursement } = require('./catalog');
const D = require('./dates');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const FIRST = ['Aiden', 'Mia', 'Liam', 'Sofia', 'Noah', 'Ava', 'Ethan', 'Isabella', 'Mateo', 'Emma', 'Arjun', 'Zoe', 'Lucas', 'Layla', 'Elijah', 'Priya', 'Oliver', 'Harper', 'Santiago', 'Nora', 'Kai', 'Amara', 'Leo', 'Chloe', 'Ishaan', 'Luna', 'Jaxon', 'Maya', 'Diego', 'Ellie', 'Rohan', 'Aria', 'Caleb', 'Camila', 'Owen', 'Ivy', 'Vihaan', 'Scarlett', 'Henry', 'Riya', 'Jack', 'Penelope', 'Micah', 'Elena', 'Theo', 'Hazel'];
const LAST = ['Garcia', 'Nguyen', 'Patel', 'Johnson', 'Martinez', 'Reddy', 'Smith', 'Hernandez', 'Kim', 'Williams', 'Lopez', 'Brown', 'Sharma', 'Davis', 'Rodriguez', 'Tran', 'Wilson', 'Flores', 'Ali', 'Torres'];

function buildSeed() {
  const rand = rng(20261010);
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const t = D.today();
  const state = { meta: { synthetic: true, source: 'seed', seededOn: t }, patients: [], immunizations: [], appointments: [], lots: [], orders: [], doses: [], claims: [], waste: [], auditLog: [] };

  // --- Patients: ages spread across the vaccine schedule -------------------------------------
  const ageBuckets = [0, 1, 2, 2, 4, 4, 6, 6, 9, 12, 12, 15, 15, 18, 24, 30, 36, 48, 48, 50, 60, 72, 96, 120, 132, 132, 138, 144, 156, 168, 192, 192, 204];
  const payerWeights = ['BCBSTX', 'BCBSTX', 'BCBSTX', 'AETNA', 'AETNA', 'UHC', 'UHC', 'CIGNA', 'TXMCD', 'TXMCD', 'TXMCD', 'TXMCD', 'CHIP', 'SELF'];
  const N = 44;
  for (let i = 0; i < N; i++) {
    const months = ageBuckets[i % ageBuckets.length] + Math.floor(rand() * 2);
    const dob = D.addDays(D.addMonths(t, -months), -Math.floor(rand() * 25));
    const payerId = payerWeights[Math.floor(rand() * payerWeights.length)];
    const p = {
      id: `P${String(i + 1).padStart(3, '0')}`,
      name: `${FIRST[i % FIRST.length]} ${pick(LAST)}`,
      dob, payerId,
      insurance: { memberId: payerId === 'SELF' ? null : `${payerId.slice(0, 3)}${Math.floor(100000000 + rand() * 900000000)}`, plan: pick(['PPO', 'HMO', 'EPO', 'STAR']), termDate: null, flaky: false },
      guardian: `${pick(['Maria', 'Jennifer', 'Priya', 'Ashley', 'Rosa', 'Amanda', 'Deepa', 'Nicole'])} ${pick(LAST)}`,
      phone: `(512) 555-0${String(100 + i).slice(-3)}`,
      eligibility: null,
    };
    state.patients.push(p);
    // History: each dose whose min age was reached >= 1 month ago was given with p=0.88; sequence must be contiguous.
    for (const v of VACCINES) {
      if (v.annual) {
        if (months >= v.doses[0] + 1 && rand() < 0.35) state.immunizations.push(imm(p.id, v.id, 1, D.addDays(t, -Math.floor(10 + rand() * 60))));
        continue;
      }
      for (let n = 0; n < v.doses.length; n++) {
        const minAge = v.doses[n];
        if (months < minAge + 1) break;
        if (months > v.maxAgeMonths && n === 0) break;
        if (rand() > 0.88) break;
        const givenAgeMonths = Math.min(minAge + Math.floor(rand() * 2), months - 1);
        state.immunizations.push(imm(p.id, v.id, n + 1, D.addDays(D.addMonths(dob, givenAgeMonths), Math.floor(rand() * 20))));
      }
    }
  }

  // --- Appointments: today + next 7 business days, ~7 per day -----------------------------------
  const days = [];
  let d = t;
  while (days.length < 7) { if (!D.isWeekend(d)) days.push(d); d = D.addDays(d, 1); }
  const times = ['08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];
  // Next business day is the demo day: load it with infants (PCV20 / RSV demand) and preteens (HPV).
  const tomorrow = D.nextBusinessDay(t); // same "next clinic day" the dashboard uses
  const ageOn = p => D.ageMonths(p.dob, tomorrow);
  const infants = state.patients.filter(p => ageOn(p) <= 16).sort(() => rand() - 0.5).slice(0, 7);
  const preteens = state.patients.filter(p => ageOn(p) >= 130 && ageOn(p) <= 150).sort(() => rand() - 0.5).slice(0, 2);
  const tomorrowSet = new Set([...infants, ...preteens].map(p => p.id));
  const rest = state.patients.filter(p => !tomorrowSet.has(p.id)).sort(() => rand() - 0.5);
  const otherDays = days.filter(x => x !== tomorrow);
  const plan = [...[...infants, ...preteens].map(p => ({ p, date: tomorrow })), ...rest.map((p, i) => ({ p, date: otherDays[i % otherDays.length] }))];
  const perDayCount = {};
  plan.forEach(({ p, date }, i) => {
    const months = D.ageMonths(p.dob, date);
    const slot = perDayCount[date] = (perDayCount[date] || 0) + 1;
    const type = (date === tomorrow && slot <= 8) ? 'well' : rand() < (months > 36 ? 0.3 : 0.15) ? 'sick' : 'well';
    state.appointments.push({ id: `A${String(i + 1).padStart(3, '0')}`, patientId: p.id, date, time: times[(slot - 1) % times.length], type, status: 'scheduled', reason: type === 'well' ? wellReason(months) : pick(['Fever and sore throat', 'Cough, congestion x3 days', 'Ear pain', 'Fever, body aches', 'Sore throat, no cough']) });
  });
  state.appointments.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  // Make sure tomorrow's demo has the interesting cases
  const tomorrows = state.appointments.filter(a => a.date === tomorrow);
  const wellTomorrow = tomorrows.filter(a => a.type === 'well').map(a => state.patients.find(p => p.id === a.patientId)).filter(p => p.payerId !== 'SELF' && p.payerId !== 'TXMCD');
  if (wellTomorrow[0]) { wellTomorrow[0].insurance.termDate = D.addDays(t, -40); } // coverage termed: the "gave vaccine, no insurance" trap
  if (wellTomorrow[1]) { wellTomorrow[1].insurance.flaky = true; }                 // member ID typo
  // Some patients already verified (today's are done, most of tomorrow not yet)
  for (const a of state.appointments.filter(a => a.date === t)) {
    const p = state.patients.find(p => p.id === a.patientId);
    p.eligibility = { status: 'active', detail: `${payerName(p.payerId)} ${p.insurance.plan}. Preventive care covered at 100%.`, checkedOn: D.addDays(t, -1), checkedAt: new Date().toISOString(), payerId: p.payerId };
  }

  // --- Inventory lots ------------------------------------------------------------------------
  // Target on-hand roughly equals one week of demand; then deliberately short a few.
  const tune = { PCV20: 1, RSV: 1, HPV: 9, MMR: 10, VAR: 7, DTAP: 16, IPV: 14, HIB: 12, HEPB: 15, HEPA: 9, ROTA: 7, FLU: 30, COVID: 6, TDAP: 7, MENACWY: 6, MENB: 3 };
  let lotSeq = 1;
  for (const v of VACCINES) {
    const qty = tune[v.id] ?? 8;
    const split = qty > 3 ? [Math.ceil(qty * 0.6), qty - Math.ceil(qty * 0.6)] : [qty];
    split.forEach((q, i) => state.lots.push(lot(lotSeq++, v, q, 'PRIVATE', D.addDays(t, i === 0 ? 120 + Math.floor(rand() * 300) : 45 + Math.floor(rand() * 60)), v.cost)));
    const vfcQty = Math.max(2, Math.round(qty * 0.6));
    state.lots.push(lot(lotSeq++, v, vfcQty, 'VFC', D.addDays(t, 90 + Math.floor(rand() * 300)), 0));
  }
  // Deliberate expiry scenarios
  const mmr = state.lots.find(l => l.productId === 'MMR' && l.fundingSource === 'PRIVATE'); mmr.expiresOn = D.addDays(t, 12);
  const hepa = state.lots.find(l => l.productId === 'HEPA' && l.fundingSource === 'PRIVATE'); hepa.expiresOn = D.addDays(t, -3); hepa.quantity = 2;
  const pcvVfc = state.lots.find(l => l.productId === 'PCV20' && l.fundingSource === 'VFC'); pcvVfc.quantity = 1;
  for (const s of SUPPLIES) state.lots.push({ id: `L${String(lotSeq++).padStart(3, '0')}`, productId: s.id, lotNumber: `${s.mfr.slice(0, 3).toUpperCase()}${Math.floor(10000 + rand() * 89999)}`, fundingSource: 'PRIVATE', quantity: s.id === 'RESP_PCR' ? 4 : 25, unitCost: s.cost, expiresOn: D.addDays(t, 200 + Math.floor(rand() * 200)), location: 'Lab cabinet B', receivedOn: D.addDays(t, -30) });

  // --- History: last 60 days of claims and waste ----------------------------------------------
  for (let i = 0; i < 70; i++) {
    const date = D.addDays(t, -Math.floor(1 + rand() * 59));
    const v = pick(VACCINES.filter(x => !x.season));
    const p = pick(state.patients);
    const payer = PAYERS.find(x => x.id === p.payerId);
    const funding = payer.vfc ? 'VFC' : 'PRIVATE';
    const exp = expectedReimbursement(v, payer, funding);
    const r = rand();
    const status = r < 0.72 ? 'paid' : r < 0.9 ? 'submitted' : 'denied';
    state.claims.push({
      id: `C${String(i + 1).padStart(4, '0')}`, patientId: p.id, patientName: p.name, payerId: p.payerId, serviceDate: date, productId: v.id, short: v.short,
      fundingSource: funding, cptLines: [{ cpt: v.cpt, desc: v.name, charge: funding === 'VFC' ? 0 : round(v.cost * 1.6) }, { cpt: '90460', desc: 'Immunization admin, first component, with counseling', charge: 45 }],
      cost: funding === 'VFC' ? 0 : v.cost, expectedAmount: exp.total,
      status, paidAmount: status === 'paid' ? exp.total : 0,
      denialReason: status === 'denied' ? pick(['CO-27 Coverage terminated before service date', 'CO-31 Patient cannot be identified as our insured', 'CO-197 Precert/authorization absent', 'CO-16 Claim lacks information (missing NDC)']) : null,
      submittedOn: D.addDays(date, 1),
    });
  }
  const wasteReasons = ['Parent declined after draw', 'Child uncooperative, dose not given', 'Drawn for wrong patient', 'Syringe dropped / contaminated', 'Vial left out of refrigerator', 'Expired in refrigerator'];
  for (let i = 0; i < 11; i++) {
    const v = pick(VACCINES.filter(x => x.cost > 50));
    const p = pick(state.patients);
    state.waste.push({ id: `W${String(i + 1).padStart(3, '0')}`, date: D.addDays(t, -Math.floor(1 + rand() * 59)), productId: v.id, short: v.short, lotNumber: `${v.mfr.slice(0, 3).toUpperCase()}${Math.floor(10000 + rand() * 89999)}`, patientId: p.id, patientName: p.name, fundingSource: 'PRIVATE', cost: v.cost, reason: wasteReasons[i % wasteReasons.length], recordedBy: pick(['MA Lopez', 'RN Chen', 'MA Davis']) });
  }

  // --- One pending order (shows inbound logic) --------------------------------------------
  state.orders.push({ id: 'O0001', createdOn: D.addDays(t, -1), status: 'shipped', vendor: 'Henry Schein Medical', expectedOn: t,
    lines: [{ productId: 'FLU', short: 'Flu', fundingSource: 'PRIVATE', quantity: 20, unitCost: 25 }], total: 500, note: 'Weekly flu replenishment', createdBy: 'system' });

  state.auditLog.push({ at: new Date().toISOString(), actor: 'system', action: 'seed', detail: `Demo data generated for ${t}` });
  return state;
}

function imm(patientId, vaccineId, doseNumber, date) { return { id: `I${Math.random().toString(36).slice(2, 9)}`, patientId, vaccineId, doseNumber, date, source: 'history' }; }
function lot(seq, v, qty, funding, expiresOn, unitCost) {
  return { id: `L${String(seq).padStart(3, '0')}`, productId: v.id, lotNumber: `${v.mfr.slice(0, 3).toUpperCase()}${String(seq * 7919 % 90000 + 10000)}`, fundingSource: funding, quantity: qty, unitCost, expiresOn, location: funding === 'VFC' ? 'Fridge 2 (VFC, shelf B)' : 'Fridge 1 (private)', receivedOn: D.addDays(expiresOn, -400) };
}
function wellReason(m) {
  if (m < 1) return 'Newborn visit'; if (m < 24) return `${m}-month well check`;
  if (m < 36) return '2-year well check'; return `${Math.floor(m / 12)}-year well check`;
}
function payerName(id) { return PAYERS.find(p => p.id === id).name; }
function round(n) { return Math.round(n * 100) / 100; }

module.exports = { buildSeed };

if (require.main === module) {
  const store = require('./store');
  const s = store.reset();
  console.log(`Seeded ${s.patients.length} patients, ${s.appointments.length} appointments, ${s.lots.length} lots, ${s.claims.length} claims -> ${store.FILE}`);
}

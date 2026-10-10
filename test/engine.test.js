const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine');
const D = require('../src/dates');
const { buildSeed } = require('../src/seed');

const t = D.today();
const patient = (months, payerId = 'BCBSTX') => ({ id: 'X', name: 'Test', dob: D.addMonths(t, -months), payerId, insurance: { memberId: 'M1', plan: 'PPO', termDate: null, flaky: false } });

test('2-month-old with no history is due the 2-month series', () => {
  const due = E.dueVaccines(patient(2), t, []).map(d => d.vaccineId);
  for (const v of ['ROTA', 'DTAP', 'HIB', 'PCV20', 'IPV']) assert.ok(due.includes(v), v);
  assert.ok(!due.includes('MMR'));
});

test('rotavirus is not offered after 8 months', () => {
  const due = E.dueVaccines(patient(9), t, []).map(d => d.vaccineId);
  assert.ok(!due.includes('ROTA'));
});

test('a dose given 10 days ago blocks the next dose (minimum interval)', () => {
  const hist = [{ vaccineId: 'DTAP', doseNumber: 1, date: D.addDays(t, -10) }];
  const due = E.dueVaccines(patient(4), t, hist).map(d => d.vaccineId);
  assert.ok(!due.includes('DTAP'));
});

test('annual flu is due once per season', () => {
  const givenThisYear = [{ vaccineId: 'FLU', doseNumber: 1, date: t.slice(0, 4) + '-01-15' }];
  assert.ok(!E.dueVaccines(patient(24), t, givenThisYear).some(d => d.vaccineId === 'FLU'));
  assert.ok(E.dueVaccines(patient(24), t, []).some(d => d.vaccineId === 'FLU'));
});

test('eligibility: terminated coverage comes back inactive', () => {
  const p = patient(12); p.insurance.termDate = D.addDays(t, -5);
  assert.equal(E.runEligibilityCheck(p, t).status, 'inactive');
  p.insurance.termDate = D.addDays(t, 5);
  assert.equal(E.runEligibilityCheck(p, t).status, 'active');
});

test('Medicaid and uninsured children use VFC stock', () => {
  assert.equal(E.fundingSourceFor(patient(12, 'TXMCD')), 'VFC');
  assert.equal(E.fundingSourceFor(patient(12, 'SELF')), 'VFC');
  assert.equal(E.fundingSourceFor(patient(12, 'AETNA')), 'PRIVATE');
});

test('readiness: shortfall = demand + safety - onHand - inbound, and expired lots do not count', () => {
  const s = buildSeed();
  const next = D.nextBusinessDay(t);
  const r = E.readiness(s, next);
  for (const l of r.lines) {
    assert.equal(l.shortfall, Math.max(0, l.demand + E.SAFETY_STOCK - l.onHand - l.inbound));
  }
  const expiredHepA = s.lots.find(l => l.productId === 'HEPA' && l.expiresOn < t);
  assert.ok(expiredHepA);
  assert.equal(E.lotsFor(s, 'HEPA', 'PRIVATE', t).some(l => l.id === expiredHepA.id), false);
});

test('FEFO: the lot that expires first is picked first', () => {
  const s = buildSeed();
  const lots = E.lotsFor(s, 'DTAP', 'PRIVATE', t);
  assert.ok(lots.length >= 2);
  assert.ok(lots[0].expiresOn <= lots[1].expiresOn);
});

// Product catalog: pediatric vaccines + in-office test kits.
// Prices approximate 2025 CDC private-sector vaccine price list; reimbursement
// modeled as a payer allowable a little above acquisition cost (the "$25-30 on
// a $200 vaccine" Raj described) plus the administration fee.

// Schedule: minimum age (months) for each dose, per ACIP routine schedule
// (simplified: no combination products, no accelerated catch-up intervals).
// maxAgeMonths: do not give after this age (e.g. rotavirus). season: only during RSV season.

const VACCINES = [
  { id: 'HEPB',  name: 'Hepatitis B (Engerix-B peds)',     short: 'HepB',   cvx: '08', cpt: '90744', cost: 27,  mfr: 'GSK',        doses: [0, 1, 6],            maxAgeMonths: 228 },
  { id: 'ROTA',  name: 'Rotavirus (RotaTeq)',              short: 'Rota',   cvx: '116', cpt: '90680', cost: 95, mfr: 'Merck',      doses: [2, 4, 6],            maxAgeMonths: 8 },
  { id: 'DTAP',  name: 'DTaP (Infanrix)',                  short: 'DTaP',   cvx: '20', cpt: '90700', cost: 30,  mfr: 'GSK',        doses: [2, 4, 6, 15, 48],    maxAgeMonths: 83 },
  { id: 'HIB',   name: 'Hib (ActHIB)',                     short: 'Hib',    cvx: '48', cpt: '90648', cost: 12,  mfr: 'Sanofi',     doses: [2, 4, 6, 12],        maxAgeMonths: 59 },
  { id: 'PCV20', name: 'Pneumococcal conjugate (Prevnar 20)', short: 'PCV20', cvx: '216', cpt: '90677', cost: 255, mfr: 'Pfizer',   doses: [2, 4, 6, 12],        maxAgeMonths: 71 },
  { id: 'IPV',   name: 'Polio, inactivated (IPOL)',        short: 'IPV',    cvx: '10', cpt: '90713', cost: 38,  mfr: 'Sanofi',     doses: [2, 4, 6, 48],        maxAgeMonths: 228 },
  { id: 'FLU',   name: 'Influenza (Fluzone Quad peds)',    short: 'Flu',    cvx: '150', cpt: '90686', cost: 25, mfr: 'Sanofi',     doses: [6], annual: true,     maxAgeMonths: 228 },
  { id: 'COVID', name: 'COVID-19 (Spikevax peds)',         short: 'COVID',  cvx: '311', cpt: '91320', cost: 140, mfr: 'Moderna',   doses: [6], annual: true,     maxAgeMonths: 228 },
  { id: 'RSV',   name: 'RSV mAb, nirsevimab (Beyfortus)',  short: 'RSV',    cvx: '307', cpt: '90380', cost: 520, mfr: 'Sanofi',    doses: [0], maxAgeMonths: 8, season: [10, 11, 12, 1, 2, 3] },
  { id: 'MMR',   name: 'MMR (M-M-R II)',                   short: 'MMR',    cvx: '03', cpt: '90707', cost: 90,  mfr: 'Merck',      doses: [12, 48],             maxAgeMonths: 228 },
  { id: 'VAR',   name: 'Varicella (Varivax)',              short: 'Var',    cvx: '21', cpt: '90716', cost: 160, mfr: 'Merck',      doses: [12, 48],             maxAgeMonths: 228 },
  { id: 'HEPA',  name: 'Hepatitis A (Havrix peds)',        short: 'HepA',   cvx: '83', cpt: '90633', cost: 38,  mfr: 'GSK',        doses: [12, 18],             maxAgeMonths: 228 },
  { id: 'TDAP',  name: 'Tdap (Boostrix)',                  short: 'Tdap',   cvx: '115', cpt: '90715', cost: 50, mfr: 'GSK',        doses: [132],                maxAgeMonths: 228 },
  { id: 'HPV',   name: 'HPV 9-valent (Gardasil 9)',        short: 'HPV',    cvx: '165', cpt: '90651', cost: 280, mfr: 'Merck',     doses: [132, 138],           maxAgeMonths: 228 },
  { id: 'MENACWY', name: 'Meningococcal ACWY (MenQuadfi)', short: 'MenACWY', cvx: '203', cpt: '90619', cost: 150, mfr: 'Sanofi',  doses: [132, 192],           maxAgeMonths: 228 },
  { id: 'MENB',  name: 'Meningococcal B (Bexsero)',        short: 'MenB',   cvx: '163', cpt: '90620', cost: 200, mfr: 'GSK',       doses: [192, 193],           maxAgeMonths: 228 },
];

// In-office tests. Demand comes from sick visits, not the immunization schedule.
const SUPPLIES = [
  { id: 'STREP_PCR', name: 'Strep A molecular (Xpert Xpress)', short: 'Strep PCR', cpt: '87651', cost: 35, mfr: 'Cepheid',  perSickVisit: 0.45 },
  { id: 'RESP_PCR',  name: 'Flu A/B + COVID + RSV PCR (4-plex)', short: 'Resp PCR', cpt: '87637', cost: 62, mfr: 'Cepheid',  perSickVisit: 0.55 },
  { id: 'STREP_RAPID', name: 'Strep A rapid antigen',         short: 'Strep rapid', cpt: '87880', cost: 5, mfr: 'Quidel',   perSickVisit: 0.30 },
  { id: 'UA_DIP',    name: 'Urinalysis dipstick',             short: 'UA dip',    cpt: '81002', cost: 1.2, mfr: 'Siemens',  perSickVisit: 0.15 },
];

// Administration codes (first component / each additional component, with counseling, <19y)
const { ADMIN_FEE_FIRST, ADMIN_FEE_ADDITIONAL, MARKUP } = require('./config');

const PAYERS = [
  { id: 'BCBSTX',  name: 'BlueCross BlueShield of Texas', vfc: false, payRate: 1.00 },
  { id: 'AETNA',   name: 'Aetna',                          vfc: false, payRate: 0.98 },
  { id: 'UHC',     name: 'UnitedHealthcare',               vfc: false, payRate: 0.96 },
  { id: 'CIGNA',   name: 'Cigna',                          vfc: false, payRate: 0.97 },
  { id: 'TXMCD',   name: 'Texas Medicaid (STAR)',          vfc: true,  payRate: 1.00 },  // VFC stock, admin fee only
  { id: 'CHIP',    name: 'Texas CHIP',                     vfc: false, payRate: 0.92 },
  { id: 'SELF',    name: 'Uninsured / self-pay',           vfc: true,  payRate: 0 },
];

function productById(id) {
  return VACCINES.find(v => v.id === id) || SUPPLIES.find(s => s.id === id) || null;
}

// Expected reimbursement for one administered dose, by funding source.
function expectedReimbursement(vaccine, payer, fundingSource) {
  const admin = ADMIN_FEE_FIRST;
  if (fundingSource === 'VFC') return { product: 0, admin, total: admin };
  const product = Math.round(vaccine.cost * MARKUP * payer.payRate * 100) / 100;
  return { product, admin, total: Math.round((product + admin) * 100) / 100 };
}

module.exports = { VACCINES, SUPPLIES, PAYERS, ADMIN_FEE_FIRST, ADMIN_FEE_ADDITIONAL, MARKUP, productById, expectedReimbursement };

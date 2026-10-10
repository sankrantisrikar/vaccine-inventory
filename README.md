# Pediatric Vaccine & Supply Inventory (prototype)

Prototype of the vaccine / test-kit management loop for a pediatric practice:
predict what each scheduled child needs, verify insurance the day before, compare demand
to the refrigerator, build the reorder in time for next-morning delivery, and make sure
every dose that leaves the fridge is either administered (claim created) or recorded as
waste (loss visible).

> **Everything in this repo runs on synthetic data.** No real patients, payers, lots or
> claims. See [Synthetic vs real data](#synthetic-vs-real-data) before pointing it at anything real.

---

## 1. First look (no install)

Screens, in the order the workflow runs:

| Screen | What it answers |
|---|---|
| **Dashboard** | How much margin did vaccines earn, how much leaked (wasted / denied / expired), what needs action today |
| **Readiness** | For a chosen clinic day: predicted doses per child, eligibility status, demand vs on-hand, the recommended order |
| **Visits** | Exam-room workflow per appointment: draw, administer, waste |
| **Inventory** | On hand vs the next 7 days of demand, lots with expiry, private vs VFC stock |
| **Orders** | Orders generated from Readiness; receive into stock |
| **Billing & loss** | Claims created at administration, waste log |
| **Patients** | Immunization history, what is due now |
| **Audit log** | Every stock movement, check, order and claim event |

The logic that matters lives in two files you can read without running anything:

* `src/catalog.js` – the 16 vaccines and 4 test kits, their CPT codes, costs and the ACIP-style schedule
* `src/engine.js` – due-dose forecast, mock eligibility, FEFO lots, readiness / reorder math, alerts

`docs/DESIGN.md` explains the rules and the money behind them.

## 2. Run locally

Requirements: Node 20 or newer. One dependency (Express). No database.

```bash
git clone https://github.com/sankrantisrikar/vaccine-inventory.git
cd vaccine-inventory
npm install
npm run dev
```

Open http://localhost:4100. On first start the app generates synthetic data relative to
**today's date** into `data/store.json` (git-ignored), so the demo always has a "next clinic day".

```bash
npm test          # engine unit tests
npm run seed      # throw away data/store.json and regenerate synthetic data
npm run validate  # dry-run the CSV importer against the templates
```

### 5-minute demo script

1. **Dashboard**: note the 60-day margin, the loss breakdown, and the action items.
2. **Readiness → Next clinic day**: nine visits, mostly infants. PCV20 and RSV show *short*.
   Click **Verify all**: two families come back *inactive* (one terminated plan, one bad member ID).
   Click **Place order**: private doses go to the distributor for 8:30 am delivery, VFC doses
   become a state-program request.
3. **Fix insurance** on an inactive patient: the front desk captured the new card, it re-verifies.
4. **Visits → open a well visit**. *Draw dose* is disabled until eligibility is active.
   Draw → **Administer** writes the immunization and creates the claim (product CPT + 90460/90461).
   Draw → **Waste** records the loss with a reason. The visit cannot be completed with an open dose.
5. **Orders → Receive into stock**; **Billing & loss** shows the new claim and the waste record.

**Reset demo data** in the sidebar regenerates everything. The button only exists while the
store is synthetic.

## 3. Synthetic vs real data

The sidebar badge tells you which mode you are in: **Synthetic demo data** (yellow) or
**Imported data** (green).

### What is synthetic today

| Thing | Where it is defined | Real-world source |
|---|---|---|
| Practice name, safety stock, cutoff, lead times, admin fees, markup | `src/config.js` (or env vars) | Practice decides |
| Vaccine catalog: names, CVX, CPT, acquisition cost, manufacturer, schedule | `src/catalog.js` → `VACCINES` | Your actual formulary and distributor invoice prices |
| Test kits and per-sick-visit usage rate | `src/catalog.js` → `SUPPLIES` | Lab purchasing + historical usage |
| Payers, VFC eligibility per payer, pay rate | `src/catalog.js` → `PAYERS` | Your contracted payers and fee schedules |
| Patients, insurance, immunization history | `src/seed.js` (generated) | EMR / state registry export |
| Appointments | `src/seed.js` (generated) | EMR schedule export |
| Inventory lots, expiry, location | `src/seed.js` (generated) | Fridge count / last received invoices |
| Historical claims and waste (dashboard KPIs) | `src/seed.js` (generated) | PM / billing system export, waste log |
| Eligibility responses | `src/engine.js` → `runEligibilityCheck` (deterministic mock) | Clearinghouse 270/271 |
| Order placement, delivery | `src/routes.js` → `/api/orders` (simulated) | Distributor API / EDI; ImmTrac2 for VFC |
| Claim adjudication | `/api/claims/:id/adjudicate` (simulated) | 835 remittance from the clearinghouse |

### Step A: change the practice-level fields

Edit `src/config.js` (or set env vars). Then edit `src/catalog.js`:

* `VACCINES[].cost` – your acquisition price per dose
* `VACCINES[].doses` – minimum age in months per dose, `maxAgeMonths`, `season`, `annual` (only if your protocol differs from the simplified ACIP schedule)
* `PAYERS` – add or rename payers; `vfc: true` means children on that payer draw VFC stock; `payRate` scales the expected allowable
* `SUPPLIES[].perSickVisit` – expected kits used per sick visit (0.45 = 45% of sick visits use it)

Product IDs (`PCV20`, `DTAP`, …) and payer IDs (`BCBSTX`, `TXMCD`, …) are the keys the CSV
import validates against, so decide them here first.

### Step B: inject real records with the CSV importer

```bash
mkdir -p data/real                      # git-ignored
cp data/templates/*.csv data/real/      # templates have the exact headers + example rows
# replace the example rows with exports from your EMR / PM system
npm run import -- data/real --dry-run   # validates, prints every problem with file + row number
npm run import -- data/real             # writes data/store.json (previous store is backed up)
npm run dev
```

Required files: `patients.csv`, `immunizations.csv`, `appointments.csv`, `lots.csv`.
Optional: `claims.csv`, `waste.csv` (history for the dashboard). Column-by-column definitions,
which columns may be blank, and how the app fills gaps: **[docs/DATA.md](docs/DATA.md)**.

After an import the **Reset demo data** button disappears and `/api/reset` is refused, so a
click cannot wipe real records.

### Step C: replace the mocks with integrations

Keep the function shapes and swap the inside. Each is a single function or route:

| Mock | Swap for | Keep this contract |
|---|---|---|
| `runEligibilityCheck(patient, date)` in `src/engine.js` | Clearinghouse 270/271 call | returns `{ status: 'active' \| 'inactive', detail, checkedOn, payerId }` |
| Appointments / immunizations in the store | Nightly FHIR or HL7 pull from the EMR, written through the importer | same CSV columns or the same JSON shapes |
| `POST /api/orders` in `src/routes.js` | Distributor order API; ImmTrac2 for VFC | order object with `lines[]`, `expectedOn`, `status` |
| `POST /api/orders/:id/receive` | Barcode scan at receipt | creates lot records with real lot number + expiry |
| `POST /api/claims/:id/adjudicate` | 835 posting from the clearinghouse | sets `status`, `paidAmount`, `denialReason` |
| `data/store.json` | Postgres | `src/store.js` is the only file that touches disk |

## 4. Do not put PHI in this repo

`data/store.json`, `data/real/` and backups are git-ignored. Real exports stay on the machine
that runs the app. This prototype has no authentication, no encryption at rest and no audit
retention policy; it is not HIPAA-ready. Treat any real-data run as a local, single-user test.

## Layout

```
src/config.js    practice settings (name, safety stock, cutoff, lead times, fees)
src/catalog.js   products, CPT, cost, schedule, payers
src/engine.js    forecast, eligibility, lots, readiness, reorder math, alerts
src/routes.js    REST API
src/store.js     JSON file store (data/store.json)
src/seed.js      synthetic data generator
scripts/import.js  CSV -> store.json importer with validation
data/templates/  CSV templates with headers and example rows
public/          single-page UI (vanilla JS)
test/            node:test unit tests
docs/DATA.md     data model, every field, synthetic vs real
docs/DESIGN.md   domain rules, money model, production integrations
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | /api/meta · /api/catalog · /api/dashboard | settings, products, KPIs + alerts |
| GET | /api/readiness?date= | demand vs stock, eligibility summary, recommended order |
| GET | /api/appointments?date= · /api/appointments/:id | enriched visits (needs, eligibility, doses) |
| POST | /api/eligibility/verify · /api/eligibility/verify-day | eligibility for one patient / a whole day |
| POST | /api/patients/:id/fix-insurance | update payer / member ID and re-verify |
| GET | /api/inventory · POST /api/inventory/adjust | lots, summary, count corrections / waste |
| GET/POST | /api/orders · POST /api/orders/:id/receive | create from recommendation, receive into lots |
| POST | /api/visits/:id/draw · /administer · /waste · /complete | exam-room dose workflow |
| GET | /api/claims · POST /api/claims/:id/adjudicate | claims; simulate remittance |
| GET | /api/waste · /api/audit · /api/patients · /api/patients/:id | logs and records |
| POST | /api/reset | regenerate synthetic data (refused on imported stores) |

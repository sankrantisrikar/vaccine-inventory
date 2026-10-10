# Data model and import guide

Everything the app knows lives in one JSON document, `data/store.json`. It is created either by
the synthetic generator (`npm run seed`, or automatically on first run) or by the CSV importer
(`npm run import -- <dir>`). The importer is the intended path for real data.

```
store.json
├─ meta            { synthetic: true|false, source, seededOn | importedOn }
├─ patients[]      demographics + insurance + last eligibility result
├─ immunizations[] dose history (one row per dose given, ever)
├─ appointments[]  upcoming and past visits
├─ lots[]          physical inventory, one row per lot per funding source
├─ orders[]        purchase orders (created by the app)
├─ doses[]         doses drawn during visits (created by the app)
├─ claims[]        one per administered dose (history can be imported)
├─ waste[]         one per lost dose (history can be imported)
└─ auditLog[]      append-only event log (created by the app)
```

Only the first five collections plus `claims` and `waste` are imported. The app creates the rest.

## Reference IDs the importer validates against

* **vaccine_id / product_id** – from `src/catalog.js`:
  `HEPB ROTA DTAP HIB PCV20 IPV FLU COVID RSV MMR VAR HEPA TDAP HPV MENACWY MENB`
  and supplies `STREP_PCR RESP_PCR STREP_RAPID UA_DIP`. Add products there before importing.
* **payer_id** – from `PAYERS` in `src/catalog.js`: `BCBSTX AETNA UHC CIGNA TXMCD CHIP SELF`.
  `vfc: true` on a payer means that payer's patients draw VFC stock.
* **funding_source** – `PRIVATE` or `VFC`.
* Dates are `YYYY-MM-DD`. Times are `HH:MM` 24-hour.

## CSV files

### patients.csv (required)

| column | required | notes |
|---|---|---|
| patient_id | yes | your EMR MRN or any stable unique ID; referenced by every other file |
| name | yes | display name |
| dob | yes | drives the due-dose forecast |
| payer_id | yes | see list above |
| member_id | no | shown in the visit screen; the real eligibility call will need it |
| plan | no | free text (PPO, HMO, STAR…) |
| coverage_end | no | if set and in the past, the mock eligibility check returns *inactive* |
| guardian, phone | no | shown in Patients |

### immunizations.csv (required)

| column | required | notes |
|---|---|---|
| patient_id | yes | |
| vaccine_id | yes | |
| date | yes | date given |
| dose_number | no | leave blank or 0 and the importer numbers doses by date |
| lot_number | no | |
| source | no | `emr`, `registry`, … informational |

A patient with no rows here is treated as never vaccinated: every age-eligible dose will show as
due. Export the full history, including doses given elsewhere (state registry).

### appointments.csv (required)

| column | required | notes |
|---|---|---|
| appointment_id | yes | unique |
| patient_id | yes | |
| date, time | yes | |
| type | yes | `well` (vaccines forecast from schedule) or `sick` (test kits forecast, vaccines deferred) |
| status | no | `scheduled` (default), `completed`, `cancelled` |
| reason | no | shown in the schedule |

Readiness only looks at future dates, so export at least the next 7 to 10 clinic days.

### lots.csv (required)

| column | required | notes |
|---|---|---|
| product_id | yes | |
| lot_number | yes | |
| funding_source | yes | `PRIVATE` or `VFC`; keep one row per lot per funding source |
| quantity | yes | doses on hand now |
| expires_on | yes | expired lots are excluded from on-hand and flagged |
| unit_cost | no | defaults to catalog cost for PRIVATE, 0 for VFC |
| location | no | fridge / shelf |
| received_on | no | |

### claims.csv (optional, history for KPIs)

| column | required | notes |
|---|---|---|
| claim_id | no | generated if blank |
| patient_id, service_date, product_id | yes | |
| funding_source | no | derived from the patient's payer if blank |
| status | yes | `paid`, `submitted`, `denied`, `self-pay` |
| cost | no | acquisition cost; defaults to catalog, 0 for VFC |
| charge, expected_amount, paid_amount | no | numbers; used for margin and pending totals |
| denial_reason | no | shown on denied claims |
| submitted_on | no | |

### waste.csv (optional, history for KPIs)

| column | required | notes |
|---|---|---|
| date, product_id, reason | yes | |
| lot_number, patient_id, funding_source, cost, recorded_by | no | cost defaults to catalog |

## Running the importer

```bash
npm run import -- data/real --dry-run   # validate only; exit code 1 and a list of problems if any
npm run import -- data/real             # write data/store.json, back up the previous one
```

The importer refuses to write if any row has an error and prints `file row N: problem`. Warnings
(for example a patient with no history) do not block the import.

After import `meta.synthetic` is `false`: the Reset button is hidden and `POST /api/reset` is refused.

## Fields the app fills in itself

* `patients[].eligibility` – written by the Verify buttons (mock today, clearinghouse later)
* `appointments[].status` – `in-progress` on first draw, `completed` on Complete visit
* `doses[]`, `orders[]`, `auditLog[]` – always app-generated
* new `lots[]` – created by Receive into stock
* new `claims[]` – created by Administer; new `waste[]` – created by Waste or a negative lot adjustment

## Synthetic generator, for reference

`src/seed.js` builds 44 patients across the schedule, histories with ~12% missed doses, seven
clinic days of appointments with the next clinic day loaded with infants and preteens, two
deliberate eligibility failures, one expired lot, one lot expiring in 12 days, deliberately
short PCV20 and RSV, 70 historical claims and 11 waste records. All of it is regenerated
relative to the current date on every reset.

# Design notes

## The problem, in money

A pediatric practice buys a dose for ~$200-250 and is paid ~$225-280 (product allowable plus the
90460 administration fee). Margin per dose is $25-30. One failure anywhere in the chain costs the
full acquisition price, so one lost $255 PCV20 wipes out eight to ten clean administrations.

Failure modes the prototype guards against, mapped to Raj's examples:

| Scenario | Where it is caught |
|---|---|
| Dose drawn, parent declines | Waste record with reason and $ value. Visible on dashboard and billing. Draw is only offered once the patient is in the room and eligibility is active. |
| Vaccine given, patient had no coverage | Batch eligibility check the evening before. `draw` returns 409 unless eligibility is `active`. Front desk fixes the card before the visit, not after the claim denies. |
| Patient arrives, vaccine not in fridge | Readiness forecasts doses per visit from age + history, compares to on-hand (minus expired, plus inbound), builds the order before the 3 pm distributor cutoff for 8:30 am delivery. |
| Expired stock | Lots are FEFO; expiring lots are flagged at 30 days; expired lots drop out of on-hand and raise an alert. |
| VFC / private mix-up | Funding source is derived from the payer (Medicaid, uninsured → VFC). Stock, draw and claim all follow it. VFC claims bill the admin fee only. |

## Rules implemented

* **Due doses**: per vaccine, a list of minimum ages (months) per dose, a maximum age, a 28-day
  minimum interval, annual products (flu, COVID) once per calendar season, RSV only in season
  (Oct-Mar) and under 8 months. Simplified ACIP; no combination products, no catch-up intervals.
* **Shortfall** = ceil(demand) + safety stock (2) − on hand − inbound by that date.
* **Supplies** (PCR / rapid tests) use a per-sick-visit probability instead of the schedule.
* **Claim** is created at administration with the product CPT (charge 0 for VFC), 90460 for the
  first component and 90461 for each additional component in the same visit, NDC/lot attached.
* **Expected reimbursement** = cost × 1.13 × payer rate + admin fee. Self-pay → $0, VFC → admin only.

## What a production build replaces

| Prototype piece | Real integration |
|---|---|
| `runEligibilityCheck` (deterministic mock) | 270/271 eligibility via clearinghouse (Availity, Change, Waystar) run nightly for next-day schedule, plus real-time at check-in |
| Appointments in the JSON store | EMR schedule (FHIR `Appointment` / `Patient` / `Immunization`, or HL7 SIU/VXU feeds) |
| Immunization history | EMR + state registry (Texas ImmTrac2) query so history is complete even for new patients |
| Distributor order | Vendor order API / EDI 850 (Henry Schein, McKesson, Sanofi/Merck direct) |
| VFC request | ImmTrac2 VFC ordering with doses-administered reporting |
| Claim creation | Charge posting into the PM / billing system; 837P out, 835 in |
| Lot counts | Barcode scan (2D GS1) at receive and at draw; temperature logger alerts for excursions |
| JSON file store | Postgres with audit tables; row-level access; PHI encryption at rest |

## Suggested next steps for the intern team

1. Replace the mock eligibility with a clearinghouse sandbox and keep the same `{status, detail}` shape.
2. Pull real schedule + history from a FHIR sandbox (e.g. HAPI or an EMR vendor sandbox).
3. Add a 2D barcode scan step on draw so lot/expiry come from the vial, not a dropdown.
4. Add temperature excursion events as a waste source.
5. Track "doses administered per visit" and compare predicted vs actual to tune the forecast.
6. Weekly report: margin, waste by reason, denial by reason, expiring stock, per provider.

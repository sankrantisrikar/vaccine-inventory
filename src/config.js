// Practice-level settings. Edit these for a real practice; nothing else in src/ needs to change.
// Values can also be overridden with environment variables of the same name.
const env = (k, d) => (process.env[k] !== undefined ? process.env[k] : d);
module.exports = {
  PRACTICE_NAME: env('PRACTICE_NAME', 'Sunrise Pediatrics (demo)'),
  PORT: Number(env('PORT', 4100)),
  SAFETY_STOCK: Number(env('SAFETY_STOCK', 2)),         // extra doses kept per vaccine per funding source
  LEAD_TIME_DAYS: Number(env('LEAD_TIME_DAYS', 1)),     // distributor: order today, arrives next business day
  ORDER_CUTOFF: env('ORDER_CUTOFF', '15:00'),           // distributor cutoff for next-morning delivery
  VFC_LEAD_TIME_DAYS: Number(env('VFC_LEAD_TIME_DAYS', 7)), // state VFC program fulfilment
  EXPIRY_WARN_DAYS: Number(env('EXPIRY_WARN_DAYS', 30)),
  MIN_INTERVAL_DAYS: Number(env('MIN_INTERVAL_DAYS', 28)), // minimum spacing between doses of one vaccine
  MARKUP: Number(env('MARKUP', 1.13)),                  // payer allowable vs acquisition cost (private stock)
  ADMIN_FEE_FIRST: Number(env('ADMIN_FEE_FIRST', 28)),  // CPT 90460 expected payment
  ADMIN_FEE_ADDITIONAL: Number(env('ADMIN_FEE_ADDITIONAL', 15)), // CPT 90461
  DISTRIBUTOR_NAME: env('DISTRIBUTOR_NAME', 'Henry Schein Medical'),
  VFC_PROGRAM_NAME: env('VFC_PROGRAM_NAME', 'Texas VFC Program (ImmTrac2)'),
};

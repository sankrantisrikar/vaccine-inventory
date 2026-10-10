// Date helpers. Everything is a local calendar date string YYYY-MM-DD.
function today() { return toISO(new Date()); }
function toISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parse(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(iso, n) { const d = parse(iso); d.setDate(d.getDate() + n); return toISO(d); }
function addMonths(iso, n) { const d = parse(iso); d.setMonth(d.getMonth() + n); return toISO(d); }
function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
function ageMonths(dob, on) {
  const a = parse(dob), b = parse(on);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return m;
}
function isWeekend(iso) { const d = parse(iso).getDay(); return d === 0 || d === 6; }
function nextBusinessDay(iso) { let d = addDays(iso, 1); while (isWeekend(d)) d = addDays(d, 1); return d; }
function monthOf(iso) { return parse(iso).getMonth() + 1; }
module.exports = { today, toISO, parse, addDays, addMonths, daysBetween, ageMonths, isWeekend, nextBusinessDay, monthOf };

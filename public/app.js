/* VaxLedger prototype front end. Vanilla JS, hash routing, talks to /api. */
const $ = sel => document.querySelector(sel);
const main = $('#main');
let META = null, CATALOG = null;

// ---------- utilities ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const post = (path, body = {}) => api(path, { method: 'POST', body });
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n || 0)).toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', opts); }
function relDay(iso) { if (iso === META.today) return 'Today'; if (iso === META.nextDay) return META.nextDay === addDaysISO(META.today, 1) ? 'Tomorrow' : 'Next clinic day'; return fmtDate(iso); }
function addDaysISO(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
let toastT; function toast(msg, isErr) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' error' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', 3200); }
function modal(html) { $('#modalCard').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
const eligBadge = s => `<span class="badge ${s === 'active' ? 'ok' : s === 'inactive' ? 'danger' : 'warn'}">${s}</span>`;
const fundBadge = f => `<span class="badge ${f === 'VFC' ? 'vfc' : 'private'}">${f}</span>`;
const stockBadge = s => `<span class="badge ${s === 'ok' ? 'ok' : s === 'tight' ? 'warn' : 'danger'}">${s}</span>`;
const claimBadge = s => `<span class="badge ${s === 'paid' ? 'ok' : s === 'denied' ? 'danger' : s === 'submitted' ? 'warn' : 'neutral'}">${s}</span>`;
async function act(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; } }

// ---------- router ----------
const views = {};
async function route() {
  const [view, ...rest] = (location.hash.replace(/^#\//, '') || 'dashboard').split('/');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  main.innerHTML = '<div class="loading">Loading…</div>';
  try { await (views[view] || views.dashboard)(...rest); } catch (e) { main.innerHTML = `<div class="alert danger"><span class="tag">Error</span><div>${esc(e.message)}</div></div>`; }
  refreshNavBadge();
}
window.addEventListener('hashchange', route);
async function refreshNavBadge() { try { const r = await api('/readiness'); const n = r.summary.productsShort + r.summary.inactive + r.summary.unverified; $('#navReadiness').textContent = n || ''; } catch {} }

// ---------- Dashboard ----------
views.dashboard = async () => {
  const d = await api('/dashboard');
  const k = d.kpis;
  const lossTotal = d.lossBreakdown.wasted + d.lossBreakdown.denied + d.lossBreakdown.expired;
  main.innerHTML = `
  <div class="page-head"><div><h1>Dashboard</h1><div class="subtitle">${esc(META.practice)} · ${fmtDate(d.today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div></div>
    <a class="btn primary" href="#/readiness">Prepare ${relDay(d.nextDay).toLowerCase()} →</a></div>
  <div class="grid cols-4" style="margin-bottom:16px">
    ${kpi('Vaccine margin, 60 days', money(k.margin60), 'ok', `${k.paid60} paid claims · ${money(k.pendingClaimsValue)} pending`)}
    ${kpi('Money lost, 60 days', money(lossTotal), lossTotal > 0 ? 'danger' : 'ok', `wasted ${money(d.lossBreakdown.wasted)} · denied ${money(d.lossBreakdown.denied)} · expired ${money(d.lossBreakdown.expired)}`)}
    ${kpi('Private stock on hand', money(k.privateInventoryValue), '', `${k.dosesExpiringSoon} doses (${money(k.valueExpiringSoon)}) expire within 30 days`)}
    ${kpi(`${relDay(d.nextDay)} readiness`, `${d.tomorrow.appointments} visits`, d.tomorrow.productsShort || d.tomorrow.inactive ? 'danger' : d.tomorrow.unverified ? 'warn' : 'ok', `${d.tomorrow.dosesNeeded} doses needed · ${d.tomorrow.productsShort} short · ${d.tomorrow.unverified} unverified · ${d.tomorrow.inactive} inactive`)}
  </div>
  <div class="grid cols-2">
    <div class="card"><div class="card-head"><h2>Action items</h2><span class="muted small">${d.alerts.length} open</span></div>
      ${d.alerts.length ? d.alerts.map(a => `<div class="alert ${a.level}"><span class="tag">${a.area}</span><div>${esc(a.text)}</div></div>`).join('') : '<div class="empty">Nothing needs attention.</div>'}
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h2>Where the margin leaks</h2>
        ${lossTotal ? ['wasted', 'denied', 'expired'].map(key => `<div style="margin-bottom:8px"><div class="stat-line" style="border:0;padding:2px 0"><span>${{ wasted: 'Drawn but not given', denied: 'Given, claim denied', expired: 'Expired in refrigerator' }[key]}</span><b>${money(d.lossBreakdown[key])}</b></div><div class="bar danger"><div style="width:${Math.round(d.lossBreakdown[key] / lossTotal * 100)}%"></div></div></div>`).join('') : '<div class="empty">No losses recorded.</div>'}
        <div class="muted small" style="margin-top:8px">Each $200+ dose lost needs 7 to 8 clean administrations to earn back.</div>
      </div>
      <div class="card"><h2>Wastage by reason, 60 days</h2>
        ${Object.entries(d.wasteByReason).sort((a, b) => b[1] - a[1]).map(([r, v]) => `<div class="stat-line"><span>${esc(r)}</span><b>${money(v)}</b></div>`).join('') || '<div class="empty">None</div>'}
      </div>
      <div class="card"><h2>How the loop closes</h2>
        ${['Schedule knows who is coming and what they are due, from age and history.', 'Eligibility is verified the evening before, not at the counter.', 'Demand is compared to stock. Shortfalls become a next-morning order before the 3 pm cutoff.', 'A dose cannot be drawn for an inactive patient. Every draw is administered or wasted, never silent.', 'Administering creates the claim with the right CPT and funding treatment (private vs VFC).'].map((s, i) => `<div class="step"><div class="step-n">${i + 1}</div><div>${s}</div></div>`).join('')}
      </div>
    </div>
  </div>`;
};
const kpi = (label, value, tone, hint) => `<div class="card kpi"><div class="label">${label}</div><div class="value ${tone}">${value}</div><div class="hint">${hint}</div></div>`;

// ---------- Readiness ----------
views.readiness = async (date) => {
  date = date || META.nextDay;
  const days = []; let d = META.today; while (days.length < 7) { const dt = new Date(d + 'T00:00:00'); if (dt.getDay() % 6) days.push(d); d = addDaysISO(d, 1); }
  const [r, all] = await Promise.all([api('/readiness?date=' + date), api('/appointments')]);
  const perDay = Object.fromEntries(days.map(x => [x, all.filter(a => a.date === x && a.status !== 'cancelled').length]));
  const s = r.summary;
  main.innerHTML = `
  <div class="page-head"><div><h1>Readiness</h1><div class="subtitle">Predict what each child needs, verify coverage, make sure the refrigerator can cover it.</div></div>
    <div class="tabs">${days.map(x => `<button class="${x === date ? 'active' : ''}" onclick="location.hash='#/readiness/${x}'">${relDay(x)}<span class="sub">${fmtDate(x, { month: 'short', day: 'numeric' })} · ${perDay[x]} visits</span></button>`).join('')}</div></div>
  <div class="grid cols-4" style="margin-bottom:16px">
    ${kpi('Visits', s.appointments, '', `${s.wellVisits} well · ${s.sickVisits} sick`)}
    ${kpi('Doses predicted', s.dosesNeeded, '', 'from age + immunization history')}
    ${kpi('Eligibility', `${s.unverified} unverified`, s.inactive ? 'danger' : s.unverified ? 'warn' : 'ok', `${s.inactive} inactive · ${s.appointments - s.unverified - s.inactive} active`)}
    ${kpi('Stock', `${s.productsShort} short`, s.productsShort ? 'danger' : 'ok', r.recommendation.length ? `order ${money(s.orderValue)} by ${s.orderCutoff} today` : 'no order needed')}
  </div>
  <div class="grid cols-2" style="margin-bottom:16px">
    <div class="card flush"><div class="card-head"><h2>Demand vs stock</h2><span class="muted small">safety stock ${META.config.safetyStock}</span></div>
      <table><thead><tr><th>Product</th><th>Fund</th><th class="right">Need</th><th class="right">On hand</th><th class="right">Inbound</th><th>Status</th></tr></thead><tbody>
      ${r.lines.map(l => `<tr><td>${esc(l.short)}<div class="muted small">${l.kind === 'supply' ? 'sick-visit estimate' : esc(l.patients.join(', '))}</div></td><td>${fundBadge(l.fundingSource)}</td><td class="right mono">${l.demand}</td><td class="right mono">${l.onHand}</td><td class="right mono">${l.inbound || ''}</td><td>${stockBadge(l.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No visits scheduled.</td></tr>'}
      </tbody></table></div>
    <div class="card"><div class="card-head"><h2>Recommended order</h2>${r.recommendation.length ? `<button class="btn primary" id="placeOrder">Place order${s.orderValue ? ' · ' + money(s.orderValue) : ''}</button>` : ''}</div>
      ${r.recommendation.length ? `<table><thead><tr><th>Product</th><th>Fund</th><th class="right">Qty</th><th class="right">Cost</th><th>Channel</th></tr></thead><tbody>
        ${r.recommendation.map(x => `<tr><td>${esc(x.short)}</td><td>${fundBadge(x.fundingSource)}</td><td class="right mono">${x.quantity}</td><td class="right mono">${money(x.quantity * x.unitCost)}</td><td class="small">${esc(x.channel)}${x.arrivesInTime ? '' : '<div class="muted">will not arrive in time; reschedule or use VFC-borrowing protocol</div>'}</td></tr>`).join('')}</tbody></table>
        <div class="muted small" style="margin-top:10px">Distributor cutoff ${s.orderCutoff}. Private orders arrive 8:30 am next business day. VFC stock comes from the state program and takes longer, so VFC shortfalls need a reschedule or a documented borrow.</div>`
        : '<div class="alert ok"><span class="tag">OK</span><div>Stock covers every predicted dose plus safety stock.</div></div>'}
    </div>
  </div>
  <div class="card flush"><div class="card-head"><h2>Schedule for ${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
    <div class="btn-row">${s.unverified ? `<button class="btn primary" id="verifyAll">Verify all ${s.unverified} unverified</button>` : `<button class="btn" id="verifyAll">Re-verify all</button>`}</div></div>
    <table><thead><tr><th>Time</th><th>Patient</th><th>Visit</th><th>Coverage</th><th>Eligibility</th><th>Predicted doses</th><th></th></tr></thead><tbody>
    ${r.appointments.map(a => `<tr>
      <td class="mono">${a.time}</td>
      <td><b>${esc(a.patient.name)}</b><div class="muted small">${a.patient.ageLabel} · ${esc(a.patient.id)}</div></td>
      <td>${a.type === 'well' ? 'Well' : 'Sick'}<div class="muted small">${esc(a.reason)}</div></td>
      <td class="small">${esc(a.patient.payerName)} ${fundBadge(a.fundingSource)}</td>
      <td>${eligBadge(a.eligibility.status)}${a.eligibility.status === 'inactive' ? `<div class="small" style="color:var(--danger);max-width:220px">${esc(a.eligibility.detail)}</div><button class="btn small" style="margin-top:4px" onclick="fixInsurance('${a.patient.id}','#/readiness/${date}')">Fix insurance</button>` : a.eligibility.status === 'unverified' ? `<div><button class="btn small ghost" onclick="verifyOne('${a.patient.id}','${date}')">Verify</button></div>` : ''}</td>
      <td>${a.type === 'sick' ? `<span class="muted small">tests as needed</span>` : a.needs.length ? a.needs.map(n => `<span class="chip ${n.dose && n.dose.status === 'administered' ? 'done' : n.onHand <= 0 ? 'short' : ''}" title="${esc(n.reason)} · ${n.onHand} on hand (${n.fundingSource})">${esc(n.short)}${n.onHand <= 0 ? ' · out' : ''}</span>`).join('') : '<span class="muted small">up to date</span>'}</td>
      <td class="right nowrap"><a class="btn small" href="#/visits/${a.id}">Open visit</a></td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No visits scheduled.</td></tr>'}
    </tbody></table></div>`;
  $('#verifyAll').onclick = () => act(async () => { const res = await post('/eligibility/verify-day', { date }); route(); return res; }).then(res => toast(`${res.results.length} checked, ${res.results.filter(x => x.status === 'inactive').length} inactive`));
  const po = $('#placeOrder'); if (po) po.onclick = () => act(async () => { await post('/orders', { lines: r.recommendation, note: `Readiness order for ${date}` }); route(); }, 'Order placed');
};
window.verifyOne = (patientId, date) => act(async () => { const e = await post('/eligibility/verify', { patientId, date }); route(); return e; }).then(e => toast(`Eligibility: ${e.status}`));
window.fixInsurance = async (patientId, backTo) => {
  const p = await api('/patients/' + patientId);
  modal(`<h2>Update insurance · ${esc(p.name)}</h2>
    <div class="alert danger"><span class="tag">Payer said</span><div>${esc(p.eligibility ? p.eligibility.detail : '')}</div></div>
    <p class="muted small">Front desk calls the family before the visit and captures the current card. Re-verification runs immediately.</p>
    <div class="field"><label>Payer</label><select id="fxPayer">${CATALOG.payers.map(x => `<option value="${x.id}" ${x.id === p.payerId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Member ID</label><input id="fxMember" value="${esc(p.insurance.memberId || '')}"></div>
    <div class="btn-row"><button class="btn primary" id="fxSave">Save and re-verify</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  $('#fxSave').onclick = () => act(async () => { await post(`/patients/${patientId}/fix-insurance`, { payerId: $('#fxPayer').value, memberId: $('#fxMember').value }); closeModal(); if (backTo) location.hash = backTo; route(); }, 'Insurance updated and verified');
};

// ---------- Visits ----------
views.visits = async (apptId) => {
  if (apptId) return visitDetail(apptId);
  const days = []; let d = META.today; while (days.length < 7) { const dt = new Date(d + 'T00:00:00'); if (dt.getDay() % 6) days.push(d); d = addDaysISO(d, 1); }
  const sel = sessionStorage.getItem('visitsDay') || META.today;
  const appts = await api('/appointments?date=' + sel);
  main.innerHTML = `
  <div class="page-head"><div><h1>Visits</h1><div class="subtitle">Exam-room workflow. Draw, administer or waste each dose so inventory and billing stay in sync.</div></div>
    <div class="tabs">${days.map(x => `<button class="${x === sel ? 'active' : ''}" onclick="sessionStorage.setItem('visitsDay','${x}');route()">${relDay(x)}<span class="sub">${fmtDate(x, { month: 'short', day: 'numeric' })}</span></button>`).join('')}</div></div>
  <div class="card flush"><table><thead><tr><th>Time</th><th>Patient</th><th>Visit</th><th>Eligibility</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
  ${appts.map(a => `<tr class="clickable" onclick="location.hash='#/visits/${a.id}'"><td class="mono">${a.time}</td><td><b>${esc(a.patient.name)}</b><div class="muted small">${a.patient.ageLabel} · ${esc(a.patient.payerName)}</div></td><td>${a.type === 'well' ? 'Well' : 'Sick'}<div class="muted small">${esc(a.reason)}</div></td><td>${eligBadge(a.eligibility.status)}</td>
    <td>${a.needs.map(n => `<span class="chip ${n.dose ? (n.dose.status === 'administered' ? 'done' : n.dose.status === 'wasted' ? 'short' : '') : n.onHand <= 0 ? 'short' : ''}">${esc(n.short)}</span>`).join('') || '<span class="muted small">—</span>'}</td>
    <td><span class="badge ${a.status === 'completed' ? 'ok' : a.status === 'in-progress' ? 'warn' : 'neutral'}">${a.status}</span></td><td class="right"><span class="btn small">Open</span></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No visits this day.</td></tr>'}
  </tbody></table></div>`;
};
async function visitDetail(apptId) {
  const a = await api('/appointments/' + apptId);
  const canDraw = a.eligibility.status === 'active' && a.status !== 'completed';
  const openDrawn = a.doses.filter(d => d.status === 'drawn').length;
  main.innerHTML = `
  <div class="page-head"><div><a href="#/visits" class="small">← Visits</a><h1>${esc(a.patient.name)} <span class="muted" style="font-weight:400">· ${a.patient.ageLabel}</span></h1>
    <div class="subtitle">${fmtDate(a.date, { weekday: 'long', month: 'long', day: 'numeric' })} ${a.time} · ${a.type === 'well' ? 'Well visit' : 'Sick visit'} · ${esc(a.reason)}</div></div>
    <div class="btn-row"><a class="btn" href="#/patients/${a.patient.id}">Patient record</a>${a.status !== 'completed' ? `<button class="btn primary" id="complete" ${openDrawn ? 'disabled title="Close open doses first"' : ''}>Complete visit</button>` : '<span class="badge ok">completed</span>'}</div></div>
  ${a.flags.map(f => `<div class="alert ${f.level}"><span class="tag">${f.level === 'danger' ? 'Stop' : 'Check'}</span><div>${esc(f.text)}</div></div>`).join('')}
  <div class="grid cols-3" style="margin-bottom:16px">
    <div class="card"><h3>Coverage</h3><dl class="kv"><dt>Payer</dt><dd>${esc(a.patient.payerName)}</dd><dt>Member ID</dt><dd class="mono">${esc(a.patient.memberId || 'n/a')}</dd><dt>Funding</dt><dd>${fundBadge(a.fundingSource)} <span class="muted small">${a.fundingSource === 'VFC' ? 'use VFC fridge, bill admin fee only' : 'use private stock, bill product + admin'}</span></dd><dt>Eligibility</dt><dd>${eligBadge(a.eligibility.status)} <span class="muted small">${a.eligibility.checkedOn ? 'checked ' + a.eligibility.checkedOn : ''}</span><div class="small muted">${esc(a.eligibility.detail)}</div></dd></dl>
      <div class="btn-row" style="margin-top:10px">${a.eligibility.status !== 'active' ? `<button class="btn primary small" onclick="verifyOne('${a.patient.id}','${a.date}')">Verify now</button>` : ''}${a.eligibility.status === 'inactive' ? `<button class="btn small" onclick="fixInsurance('${a.patient.id}')">Fix insurance</button>` : ''}</div></div>
    <div class="card" style="grid-column: span 2"><h3>Vaccines due at this visit</h3>
      ${a.type === 'sick' ? '<div class="muted">Sick visit. Vaccines are deferred; tests are drawn from lab supplies.</div>' : a.needs.length === 0 ? '<div class="alert ok"><span class="tag">OK</span><div>Up to date for age. Nothing due today.</div></div>' :
        a.needs.map(n => doseRow(a, n, canDraw)).join('')}
    </div>
  </div>
  ${a.doses.length ? `<div class="card flush"><h2>Dose log for this visit</h2><table><thead><tr><th>Vaccine</th><th>Lot</th><th>Fund</th><th>Status</th><th>Outcome</th><th class="right">Cost</th></tr></thead><tbody>
    ${a.doses.map(d => `<tr><td>${esc(d.short)} <span class="muted small">dose ${d.doseNumber}</span></td><td class="mono">${esc(d.lotNumber)}</td><td>${fundBadge(d.fundingSource)}</td><td><span class="badge ${d.status === 'administered' ? 'ok' : d.status === 'wasted' ? 'danger' : 'warn'}">${d.status}</span></td><td class="small">${d.status === 'administered' ? `claim ${d.claimId} created` : d.status === 'wasted' ? esc(d.wasteReason) : 'out of refrigerator, not yet given'}</td><td class="right mono">${d.status === 'wasted' ? '<span style="color:var(--danger)">-' + money(d.unitCost) + '</span>' : money(d.unitCost)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  const c = $('#complete'); if (c) c.onclick = () => act(async () => { await post(`/visits/${a.id}/complete`); route(); }, 'Visit completed');
}
function doseRow(a, n, canDraw) {
  const d = n.dose;
  const state = d ? d.status : (n.onHand <= 0 ? 'out' : 'due');
  const right = !d
    ? (a.status === 'completed' ? `<span class="badge neutral">not given</span>` : n.onHand <= 0 ? `<span class="badge danger">out of stock</span>` : canDraw ? `<button class="btn primary small" onclick="drawDose('${a.id}','${n.vaccineId}')">Draw dose</button>` : `<button class="btn small" disabled title="Verify eligibility first">Draw dose</button>`)
    : d.status === 'drawn' ? `<div class="btn-row"><button class="btn ok small" onclick="administerDose('${a.id}','${d.id}')">Administer</button><button class="btn danger small" onclick="wasteDose('${a.id}','${d.id}')">Waste</button></div>`
    : d.status === 'administered' ? `<span class="badge ok">given</span>` : `<span class="badge danger">wasted</span>`;
  return `<div class="dose-row">
    <div><b>${esc(n.short)}</b> <span class="muted small">dose ${n.doseNumber}</span><div class="muted small">${esc(n.reason)}</div></div>
    <div class="small">${fundBadge(n.fundingSource)}<div class="muted">${n.onHand} on hand</div></div>
    <div class="small"><div>cost ${money(n.cost)}</div><div class="muted">expect ${money(n.expected)}</div></div>
    <div class="small">${d ? `<span class="mono">${esc(d.lotNumber)}</span>` : n.onHand > 0 ? '<span class="muted">FEFO lot auto-picked</span>' : ''}</div>
    <div class="right">${right}</div></div>`;
}
window.drawDose = (apptId, vaccineId) => act(() => post(`/visits/${apptId}/draw`, { vaccineId }).then(route), 'Dose drawn from refrigerator').catch(() => {});
window.administerDose = (apptId, doseId) => act(() => post(`/visits/${apptId}/administer`, { doseId }).then(route), 'Administered. Immunization recorded, claim created.');
window.wasteDose = (apptId, doseId) => {
  modal(`<h2>Record wasted dose</h2><p class="muted small">The dose left the refrigerator and will not be given. Recording it keeps the count honest and shows where the practice loses money.</p>
    <div class="field"><label>Reason</label><select id="wReason">${['Parent declined after draw', 'Child uncooperative, dose not given', 'Drawn for wrong patient', 'Syringe dropped / contaminated', 'Vial left out of refrigerator'].map(r => `<option>${r}</option>`).join('')}</select></div>
    <div class="btn-row"><button class="btn danger" id="wGo">Record waste</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  $('#wGo').onclick = () => act(async () => { await post(`/visits/${apptId}/waste`, { doseId, reason: $('#wReason').value }); closeModal(); route(); }, 'Waste recorded');
};

// ---------- Inventory ----------
views.inventory = async () => {
  const inv = await api('/inventory');
  const vacc = inv.summary.filter(s => s.kind === 'vaccine'), sup = inv.summary.filter(s => s.kind === 'supply');
  const row = s => { const cover = s.demand7 ? s.onHand / s.demand7 : 9; const tone = s.onHand <= 0 && s.demand7 ? 'danger' : cover < 1 ? 'danger' : cover < 1.5 ? 'warn' : 'ok';
    return `<tr><td>${esc(s.short)}<div class="muted small">${esc(s.name)}</div></td><td>${fundBadge(s.fundingSource)}</td><td class="right mono">${s.onHand}</td><td class="right mono">${s.demand7}</td><td style="min-width:120px"><div class="bar ${tone}"><div style="width:${Math.min(100, Math.round(cover * 50))}%"></div></div></td><td class="right mono">${s.expiringSoon ? `<span style="color:var(--warn)">${s.expiringSoon}</span>` : ''}</td><td class="right mono">${money(s.onHand * s.cost)}</td></tr>`; };
  const lotRow = l => `<tr><td>${esc(l.short)}</td><td class="mono">${esc(l.lotNumber)}</td><td>${fundBadge(l.fundingSource)}</td><td class="right mono">${l.quantity}</td><td class="mono">${l.expiresOn} ${l.daysToExpiry < 0 ? '<span class="badge danger">expired</span>' : l.daysToExpiry <= META.config.expiryWarnDays ? `<span class="badge warn">${l.daysToExpiry}d</span>` : ''}</td><td class="small">${esc(l.location)}</td><td class="right mono">${money(l.value)}</td><td class="right nowrap"><button class="btn small ghost" onclick="adjustLot('${l.id}','${esc(l.short)}',${l.quantity})">Adjust</button></td></tr>`;
  main.innerHTML = `
  <div class="page-head"><div><h1>Inventory</h1><div class="subtitle">On hand vs the next 7 clinic days of predicted demand. Private and VFC stock are tracked separately.</div></div></div>
  <div class="grid cols-2" style="margin-bottom:16px">
    <div class="card flush"><h2>Vaccines</h2><table><thead><tr><th>Product</th><th>Fund</th><th class="right">On hand</th><th class="right">7-day need</th><th>Cover</th><th class="right">Exp ≤30d</th><th class="right">Value</th></tr></thead><tbody>${vacc.map(row).join('')}</tbody></table></div>
    <div class="grid" style="align-content:start">
      <div class="card flush"><h2>Test kits &amp; supplies</h2><table><thead><tr><th>Product</th><th>Fund</th><th class="right">On hand</th><th class="right">7-day need</th><th>Cover</th><th class="right">Exp</th><th class="right">Value</th></tr></thead><tbody>${sup.map(row).join('')}</tbody></table></div>
      <div class="card"><h3>Rules in play</h3><ul class="small muted" style="margin:0;padding-left:18px"><li>FEFO: the lot expiring first is drawn first.</li><li>VFC doses are never used for privately insured children, and vice versa.</li><li>Expired lots are excluded from on-hand and flagged for quarantine.</li><li>Shortfall = need + safety stock − on hand − inbound.</li></ul></div>
    </div>
  </div>
  <div class="card flush"><h2>Lots</h2><table><thead><tr><th>Product</th><th>Lot</th><th>Fund</th><th class="right">Qty</th><th>Expires</th><th>Location</th><th class="right">Value</th><th></th></tr></thead><tbody>${inv.lots.map(lotRow).join('')}</tbody></table></div>`;
};
window.adjustLot = (lotId, short, qty) => {
  modal(`<h2>Adjust lot · ${esc(short)}</h2><p class="muted small">Current count ${qty}. Negative adjustments with a reason are logged as waste.</p>
    <div class="field"><label>Change (e.g. -2 or +5)</label><input id="adjDelta" type="number" value="-1"></div>
    <div class="field"><label>Reason</label><select id="adjReason"><option>Count correction</option><option>Expired in refrigerator</option><option>Vial left out of refrigerator</option><option>Broken vial</option><option>Transferred to partner practice</option></select></div>
    <div class="btn-row"><button class="btn primary" id="adjGo">Apply</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  $('#adjGo').onclick = () => act(async () => { const delta = Number($('#adjDelta').value); const reason = $('#adjReason').value; await post('/inventory/adjust', { lotId, delta, reason: reason === 'Count correction' ? null : reason }); closeModal(); route(); }, 'Lot adjusted');
};

// ---------- Orders ----------
views.orders = async () => {
  const orders = await api('/orders');
  main.innerHTML = `
  <div class="page-head"><div><h1>Orders</h1><div class="subtitle">Private orders go to the distributor for next-morning delivery. VFC requests go to the state program.</div></div><a class="btn primary" href="#/readiness">Build order from readiness →</a></div>
  <div class="grid">${orders.map(o => `<div class="card"><div class="card-head"><div><b>${o.id}</b> · ${esc(o.vendor)} <span class="badge ${o.status === 'received' ? 'ok' : o.status === 'shipped' ? 'warn' : 'neutral'}">${o.status}</span><div class="muted small">created ${o.createdOn} · expected ${o.expectedOn}${o.note ? ' · ' + esc(o.note) : ''}</div></div>
      <div class="btn-row"><b class="mono">${money(o.total)}</b>${o.status !== 'received' ? `<button class="btn ok small" onclick="receiveOrder('${o.id}')">Receive into stock</button>` : `<span class="muted small">received ${o.receivedOn}</span>`}</div></div>
      <table><thead><tr><th>Product</th><th>Fund</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Line</th></tr></thead><tbody>${o.lines.map(l => `<tr><td>${esc(l.short)}</td><td>${fundBadge(l.fundingSource)}</td><td class="right mono">${l.quantity}</td><td class="right mono">${money(l.unitCost)}</td><td class="right mono">${money(l.quantity * l.unitCost)}</td></tr>`).join('')}</tbody></table></div>`).join('') || '<div class="empty">No orders.</div>'}</div>`;
};
window.receiveOrder = id => act(() => post(`/orders/${id}/receive`).then(route), 'Received. New lots added to inventory.');

// ---------- Billing & loss ----------
views.billing = async () => {
  const [claims, waste] = await Promise.all([api('/claims'), api('/waste')]);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  main.innerHTML = `
  <div class="page-head"><div><h1>Billing &amp; loss</h1><div class="subtitle">Every administered dose becomes a claim. Every drawn-but-not-given dose becomes a waste record. Both are visible here.</div></div></div>
  <div class="grid cols-4" style="margin-bottom:16px">
    ${kpi('Paid', money(sum(claims.filter(c => c.status === 'paid'), c => c.paidAmount)), 'ok', `${claims.filter(c => c.status === 'paid').length} claims`)}
    ${kpi('Awaiting payer', money(sum(claims.filter(c => c.status === 'submitted'), c => c.expectedAmount)), 'warn', `${claims.filter(c => c.status === 'submitted').length} claims`)}
    ${kpi('Denied (vaccine cost lost)', money(sum(claims.filter(c => c.status === 'denied'), c => c.cost)), 'danger', `${claims.filter(c => c.status === 'denied').length} claims`)}
    ${kpi('Wasted doses', money(sum(waste, w => w.cost)), 'danger', `${waste.length} doses`)}
  </div>
  <div class="grid cols-2">
    <div class="card flush"><div class="card-head"><h2>Claims</h2><span class="muted small">${claims.length} total</span></div><div style="max-height:560px;overflow:auto"><table><thead><tr><th>Date</th><th>Patient</th><th>Vaccine</th><th>CPT</th><th class="right">Expected</th><th>Status</th><th></th></tr></thead><tbody>
      ${claims.map(c => `<tr><td class="mono">${c.serviceDate}</td><td>${esc(c.patientName)}<div class="muted small">${esc(c.payerId)}</div></td><td>${esc(c.short)} ${fundBadge(c.fundingSource)}</td><td class="mono small">${c.cptLines.map(l => l.cpt).join(', ')}</td><td class="right mono">${money(c.expectedAmount)}</td><td>${claimBadge(c.status)}${c.denialReason ? `<div class="small" style="color:var(--danger)">${esc(c.denialReason)}</div>` : ''}</td><td class="right">${c.status === 'submitted' ? `<button class="btn small ghost" onclick="adjudicate('${c.id}')" title="Simulate payer remittance">Post ERA</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card flush"><div class="card-head"><h2>Waste log</h2><span class="muted small">${waste.length} records</span></div><div style="max-height:560px;overflow:auto"><table><thead><tr><th>Date</th><th>Vaccine</th><th>Patient</th><th>Reason</th><th class="right">Loss</th></tr></thead><tbody>
      ${waste.map(w => `<tr><td class="mono">${w.date}</td><td>${esc(w.short)}<div class="muted small mono">${esc(w.lotNumber)}</div></td><td class="small">${esc(w.patientName || '—')}</td><td class="small">${esc(w.reason)}<div class="muted">${esc(w.recordedBy)}</div></td><td class="right mono" style="color:var(--danger)">-${money(w.cost)}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
};
window.adjudicate = id => act(() => post(`/claims/${id}/adjudicate`).then(route)).then(() => toast('Remittance posted'));

// ---------- Patients ----------
views.patients = async (id) => {
  if (id) return patientDetail(id);
  const ps = await api('/patients');
  main.innerHTML = `
  <div class="page-head"><div><h1>Patients</h1><div class="subtitle">${ps.length} active patients. Due list is computed from age and immunization history as of today.</div></div></div>
  <div class="card flush"><table><thead><tr><th>Patient</th><th>Age</th><th>Coverage</th><th>Eligibility</th><th>Due now</th><th>Next visit</th></tr></thead><tbody>
  ${ps.sort((a, b) => a.dob.localeCompare(b.dob) * -1).map(p => `<tr class="clickable" onclick="location.hash='#/patients/${p.id}'"><td><b>${esc(p.name)}</b><div class="muted small">${p.id} · ${esc(p.guardian)} · ${esc(p.phone)}</div></td><td>${p.ageLabel}</td><td class="small">${esc(p.payerName)} ${fundBadge(p.fundingSource)}</td><td>${p.eligibility ? eligBadge(p.eligibility.status) : '<span class="badge warn">unverified</span>'}</td><td>${p.due.map(v => `<span class="chip">${esc(CATALOG.vaccines.find(x => x.id === v).short)}</span>`).join('') || '<span class="muted small">up to date</span>'}</td><td class="small">${p.nextAppt ? `${fmtDate(p.nextAppt.date)} ${p.nextAppt.time} <span class="muted">${p.nextAppt.type}</span>` : '<span class="muted">none</span>'}</td></tr>`).join('')}
  </tbody></table></div>`;
};
async function patientDetail(id) {
  const p = await api('/patients/' + id);
  main.innerHTML = `
  <div class="page-head"><div><a href="#/patients" class="small">← Patients</a><h1>${esc(p.name)} <span class="muted" style="font-weight:400">· ${p.ageLabel}</span></h1><div class="subtitle">DOB ${p.dob} · guardian ${esc(p.guardian)} · ${esc(p.phone)}</div></div></div>
  <div class="grid cols-3">
    <div class="card"><h3>Coverage</h3><dl class="kv"><dt>Payer</dt><dd>${esc(p.payerName)}</dd><dt>Member ID</dt><dd class="mono">${esc(p.insurance.memberId || 'n/a')}</dd><dt>Funding</dt><dd>${fundBadge(p.fundingSource)}</dd><dt>Eligibility</dt><dd>${p.eligibility ? eligBadge(p.eligibility.status) + ` <span class="muted small">${p.eligibility.checkedOn}</span><div class="small muted">${esc(p.eligibility.detail)}</div>` : '<span class="badge warn">unverified</span>'}</dd></dl>
      <div class="btn-row" style="margin-top:10px"><button class="btn small primary" onclick="verifyOne('${p.id}','${META.today}')">Verify now</button><button class="btn small" onclick="fixInsurance('${p.id}')">Update insurance</button></div>
      <h3 style="margin-top:16px">Due now</h3>${p.due.map(d => `<span class="chip">${esc(d.short)} <span class="muted">dose ${d.doseNumber}</span></span>`).join('') || '<div class="muted small">Up to date for age.</div>'}
      <h3 style="margin-top:16px">Appointments</h3>${p.appointments.map(a => `<div class="small"><a href="#/visits/${a.id}">${fmtDate(a.date)} ${a.time}</a> · ${a.type} · <span class="muted">${a.status}</span></div>`).join('') || '<div class="muted small">None</div>'}
    </div>
    <div class="card flush" style="grid-column: span 2"><h2>Immunization history</h2><table><thead><tr><th>Date</th><th>Vaccine</th><th>Dose</th><th>Lot</th><th>Source</th></tr></thead><tbody>
      ${p.history.slice().reverse().map(h => `<tr><td class="mono">${h.date}</td><td>${esc(h.short)}</td><td>${h.doseNumber}</td><td class="mono small">${esc(h.lotNumber || '')}</td><td class="muted small">${h.source}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No doses on record.</td></tr>'}</tbody></table>
      ${p.claims.length ? `<h2 style="margin-top:10px">Claims</h2><table><thead><tr><th>Date</th><th>Vaccine</th><th class="right">Expected</th><th>Status</th></tr></thead><tbody>${p.claims.map(c => `<tr><td class="mono">${c.serviceDate}</td><td>${esc(c.short)}</td><td class="right mono">${money(c.expectedAmount)}</td><td>${claimBadge(c.status)}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>
  </div>`;
}

// ---------- Audit ----------
views.audit = async () => {
  const log = await api('/audit');
  main.innerHTML = `<div class="page-head"><div><h1>Audit log</h1><div class="subtitle">Every stock movement, eligibility check, order and claim event.</div></div></div>
  <div class="card flush"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead><tbody>${log.map(l => `<tr><td class="mono small">${new Date(l.at).toLocaleString()}</td><td>${esc(l.actor)}</td><td class="mono small">${esc(l.action)}</td><td class="small">${esc(l.detail)}</td></tr>`).join('')}</tbody></table></div>`;
};

// ---------- boot ----------
(async function boot() {
  [META, CATALOG] = await Promise.all([api('/meta'), api('/catalog')]);
  $('#practiceName').textContent = META.practice;
  $('#todayLabel').textContent = 'Today: ' + fmtDate(META.today, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const banner = $('#dataBanner'); banner.textContent = META.synthetic ? 'Synthetic demo data' : `Imported data (${META.source || 'import'})`; banner.className = 'small ' + (META.synthetic ? 'synthetic' : 'real');
  if (META.synthetic) $('#resetBtn').classList.remove('hidden');
  $('#resetBtn').onclick = () => { if (confirm('Reset all demo data?')) act(() => post('/reset').then(route), 'Demo data regenerated'); };
  route();
})();

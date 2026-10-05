// LS AI — the time-aware briefing shown when the bubble is opened. Pure code over the same queries the Reports screens use:
// no model, no OpenRouter call, no data leaves the Worker (so it works with or without a key or the data-access consent).
// Morning (before 12:00 IST) recaps YESTERDAY; afternoon and evening show TODAY so far.
const { queryOne, readBatch, istDateString, nowIST } = require('../db/schema');
const { getDailyReportData } = require('./dailyReport');
const E = require('./assistantEntities');
const ST = require('./assistantStats');

const n = (x) => Number(x || 0).toLocaleString('en-IN');
const plural = (k, w) => `${n(k)} ${w}${Number(k) === 1 ? '' : 's'}`;

function dayPart(hour) { return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'; }

// `role: 'user'` (staff) sees their OWN overdue tasks and no approvals count — same as what Home and Requests show them.
async function briefing({ role = 'admin', user = null } = {}) {
  const mine = role === 'user';
  const nowStr = nowIST(); const hour = Number(nowStr.slice(11, 13));
  const part = dayPart(hour); const today = istDateString();
  const day = part === 'morning' ? E.add(today, -1) : today;
  const dayLabel = part === 'morning' ? 'Yesterday' : 'Today';

  // statistics are a bonus: if one fails, the briefing still shows everything else
  const safe = (p) => p.catch(() => null);
  const [d, [overdue, watch], anomaly, rhythm, cover] = await Promise.all([
    getDailyReportData('all', day),
    readBatch([
      [`SELECT COUNT(*) AS n, COALESCE(SUM(due_date < ?), 0) AS overdue FROM crm_tasks WHERE status = 'open'${mine ? ' AND assigned_to = ?' : ''}`, mine ? [today, user] : [today]],
      ['SELECT COUNT(*) AS n FROM crm_contacts WHERE severity = 3', []],
    ]),
    safe(ST.weekdayAnomaly(day)),
    safe(ST.customerRhythm({ today })),
    safe(ST.stockCover({ store: 'all', today })),
  ]);
  const inReels = d.inward.reduce((a, r) => a + Number(r.reel_count), 0);
  const outReels = d.outward.reduce((a, r) => a + Number(r.reel_count), 0);
  const outQty = d.outward.reduce((a, r) => a + Number(r.total_qty), 0);
  const od = Number(overdue.rows[0].overdue), watchN = Number(watch.rows[0].n);
  const lowN = (d.lowStock || []).length, deadN = (d.deadStock || []).length, trN = (d.transfers || []).length;

  const items = [
    { label: `${dayLabel}: received`, value: `${n(inReels)} reels`, link: '/reports/daily' },
    { label: `${dayLabel}: shipped`, value: outReels ? `${n(outReels)} reels · ${n(outQty)} pcs` : '0 reels', link: '/reports/daily' },
    ...(trN ? [{ label: `${dayLabel}: transfers`, value: `${n(trN)}`, link: '/transfer' }] : []),
    ...(mine ? [] : [{ label: 'Approvals waiting', value: n(d.pendingApprovals), tone: d.pendingApprovals ? 'warn' : null, link: '/requests' }]),
    { label: mine ? 'Your overdue tasks' : 'Overdue tasks', value: n(od), tone: od ? 'warn' : null, link: '/' },
    { label: 'Low-stock items', value: n(lowN), tone: lowN ? 'warn' : null, link: '/reports/alerts' },
    ...(watchN ? [{ label: 'High-severity clients', value: n(watchN), tone: 'warn', link: '/clients' }] : []),
  ];
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${day}T00:00:00Z`).getUTCDay()];
  // a half-finished day can't be "unusually low", so only flag high volume for today-so-far
  if (anomaly && (anomaly.kind === 'high' || part === 'morning')) {
    items.splice(2, 0, { label: `${dayLabel}'s shipping vs a usual ${weekday}`, value: anomaly.kind === 'high' ? `${anomaly.ratio.toFixed(1)}× usual` : `only ${Math.round(anomaly.ratio * 100)}% of usual`, tone: 'warn', link: '/reports/daily' });
  }
  const quiet = (rhythm || []).filter((r) => r.status.startsWith('quiet')).length;
  const runOut = cover ? cover.rows.filter((x) => x.cover_days !== null && x.stock > 0 && x.cover_days <= 30 && x.orders >= 3).length : 0;
  if (quiet) items.push({ label: 'Customers gone quiet', value: n(quiet), tone: 'warn', link: '/notifications' });
  if (runOut) items.push({ label: 'Items to run out within 30 days', value: n(runOut), tone: 'warn', link: '/reports/alerts' });
  const bits = [`${plural(inReels, 'reel')} in, ${plural(outReels, 'reel')} out`];
  if (d.pendingApprovals && !mine) bits.push(`${plural(d.pendingApprovals, 'approval')} waiting`);
  if (od) bits.push(`${plural(od, 'task')} overdue`);
  if (anomaly && anomaly.kind === 'high') bits.push('shipping unusually high');
  return { part, day, dayLabel, headline: bits.join(' · '), items, deadStock: deadN };
}

module.exports = { briefing };

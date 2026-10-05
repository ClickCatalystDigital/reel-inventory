// routes/assistant.js — LS AI settings API (admin only; see the adminOnly guard in app.js).
// Part 1: settings, models, connection test. The chat endpoint is added in Part 2.
const express = require('express');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const A = require('../utils/assistant');

// The key is write-only: responses carry `hasKey` + the last 4 characters, never the key.
async function payload() {
  const s = await A.getSettings();
  const [balance, used] = await Promise.all([
    s.hasKey ? A.getKey().then(A.getBalance).catch(() => null) : null,
    A.usedToday(),
  ]);
  return { ...s, balance, usedToday: used, creditsUrl: A.CREDITS_URL };
}

router.get('/settings', ah(async (req, res) => res.json(await payload())));

router.put('/settings', ah(async (req, res) => {
  const user = req.user.username;
  const b = req.body || {};

  if (b.dataAccess) {
    const d = b.dataAccess;
    const prev = (await A.getSettings()).dataAccess;
    if (d.on) {
      const name = String(d.approver_name || '').trim().slice(0, 120);
      if (!name || d.confirmed !== true) return res.status(400).json({ error: 'Enter the name of the person who approved, and tick the confirmation.' });
      const record = { on: true, approver_name: name, approver_role: String(d.approver_role || '').trim().slice(0, 120), recorded_by: user, at: new Date().toISOString() };
      await A.setSettings(user, [['assistant_data_access', JSON.stringify(record)]]);
      await A.audit(user, 'data_access_on', record);
    } else {
      await A.setSettings(user, [['assistant_data_access', JSON.stringify({ on: false, turned_off_by: user, turned_off_at: new Date().toISOString(), last_approval: prev?.on ? prev : prev?.last_approval })]]);
      await A.audit(user, 'data_access_off', {});
    }
    return res.json(await payload());
  }

  if (b.cap !== undefined) {
    const cap = Number(b.cap);
    if (!Number.isInteger(cap) || cap < 1 || cap > 10000) return res.status(400).json({ error: 'Daily limit must be a whole number from 1 to 10000.' });
    await A.setSettings(user, [['assistant_cap', String(cap)]]);
    await A.audit(user, 'cap', { cap });
    return res.json(await payload());
  }

  const entries = [];
  const detail = {};
  if (b.model !== undefined) {
    const model = String(b.model).trim();
    if (!model || model.length > 120) return res.status(400).json({ error: 'Pick a model.' });
    entries.push(['assistant_model', model]); detail.model = model;
  }
  if (b.mode !== undefined) {
    if (!A.MODES.includes(b.mode)) return res.status(400).json({ error: 'Unknown answer mode.' });
    entries.push(['assistant_mode', b.mode]); detail.mode = b.mode;
  }
  if (entries.length) await A.setSettings(user, entries);

  if (b.key !== undefined) {
    const key = String(b.key).trim();
    if (key && !/^sk-or-\S{8,}$/.test(key)) return res.status(400).json({ error: "That doesn't look like an OpenRouter key (it starts with sk-or-)." });
    try { await A.saveKey(user, key); } catch (e) {
      return res.status(400).json({ error: e.message.includes('SETTINGS_ENC_KEY') ? 'The encryption key is not configured on the server, so the key cannot be saved.' : 'Could not save the key.' });
    }
    detail.key_changed = key ? 'set' : 'removed'; // never the key itself
  }
  if (Object.keys(detail).length) await A.audit(user, 'settings', detail);
  res.json(await payload());
}));

router.get('/models', ah(async (req, res) => {
  try { res.json(await A.listModels()); } catch (e) { res.status(502).json({ error: e.message }); }
}));

// Proves the stored key works: reads the credit balance and makes one trivial Jev decision.
router.post('/test', ah(async (req, res) => {
  const key = await A.getKey().catch(() => null);
  if (!key) return res.status(400).json({ error: 'Save an OpenRouter key first.' });
  const t0 = Date.now();
  try {
    const { answers, cost } = await A.jevDecide(key, 'How many reels of BLDC CARD are in stock?', {
      kind: { type: 'choice', instructions: 'What kind of question is this?', criteria: { data: 'Asks for numbers or records from the business data.', other: 'Anything else.' } },
    });
    const kind = answers?.kind?.choice;
    if (!kind) return res.status(502).json({ error: 'Jev answered, but not in the expected format.' });
    const balance = await A.getBalance(key);
    res.json({ ok: true, jevModel: A.JEV_MODEL, answered: kind, ms: Date.now() - t0, cost, balance });
  } catch (e) {
    const up = e.upstream || { status: 502, error: e.message };
    res.status(up.status === 402 || up.status === 401 || up.status === 429 ? up.status : 502).json({ error: up.error, link: up.link, linkLabel: up.linkLabel });
  }
}));

// One chat turn. Admin only (guard in app.js). History lives in the browser; only the last messages are sent.
router.post('/chat', ah(async (req, res) => {
  const { messages, path, dry, context } = req.body || {};
  const out = await require('../utils/assistantChat').turn({ user: req.user.username, messages, path, dry: dry === true, context });
  res.status(out.status).json(out.body);
}));

// Time-aware briefing (deterministic; nothing is sent to OpenRouter).
router.get('/briefing', ah(async (req, res) => res.json(await require('../utils/assistantBriefing').briefing())));

// Thumbs up/down on an answer. Stored as a log row (kind 'feedback') — no new table. A thumbs-down also drops the question from "your usual".
router.post('/feedback', ah(async (req, res) => {
  const { question, tool, good } = req.body || {};
  if (typeof question !== 'string' || !question.trim() || typeof good !== 'boolean') return res.status(400).json({ error: 'Bad request.' });
  await require('../utils/assistant').logAsk(req.user.username, question.trim().slice(0, 600), 'feedback', typeof tool === 'string' ? tool.slice(0, 40) : null, good, 0, 0);
  res.json({ ok: true });
}));

// Questions the assistant could not answer (unclear, no look-up, said "the data doesn't have that") or that were thumbed down — the to-do list for improving it.
router.get('/misses', ah(async (req, res) => {
  const { queryAll } = require('../db/schema');
  const since = new Date(Date.now() + 5.5 * 3600e3 - 30 * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
  const rows = await queryAll(
    `SELECT MIN(question) AS question, kind, COALESCE(tool, '') AS tool, COUNT(*) AS n, MAX(at) AS last_at FROM assistant_log
     WHERE ok = 0 AND at >= ? AND (kind IN ('unclear', 'data', 'feedback')) GROUP BY LOWER(TRIM(question)), kind ORDER BY n DESC, last_at DESC LIMIT 30`, [since]);
  res.json(rows.map((r) => ({ question: r.question, why: r.kind === 'feedback' ? 'thumbs down' : r.tool.startsWith('unsupported') ? `not in the data (${r.tool.slice(12)})` : r.kind === 'unclear' ? 'not understood' : 'no look-up matched', times: Number(r.n), last: String(r.last_at).slice(0, 10) })));
}));

// Starter chips: this admin's own most-asked questions (last 60 days, asked at least twice) first, then the defaults.
router.get('/starters', ah(async (req, res) => {
  const { queryAll } = require('../db/schema');
  const rows = await queryAll(
    `SELECT MIN(question) AS q, COUNT(*) AS n FROM assistant_log WHERE asked_by = ? AND kind = 'data' AND tool IS NOT NULL AND ok = 1 AND at >= ?
       AND LOWER(TRIM(question)) NOT IN (SELECT LOWER(TRIM(question)) FROM assistant_log WHERE asked_by = ? AND kind = 'feedback' AND ok = 0)
     GROUP BY LOWER(TRIM(question)) HAVING COUNT(*) >= 2 ORDER BY n DESC, MAX(at) DESC LIMIT 3`,
    [req.user.username, new Date(Date.now() + 5.5 * 3600e3 - 60 * 86400e3).toISOString().replace('T', ' ').slice(0, 19), req.user.username]
  );
  res.json({ usual: rows.map((r) => r.q), defaults: require('../utils/assistantChat').STARTERS });
}));

module.exports = router;

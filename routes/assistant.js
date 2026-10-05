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

module.exports = router;

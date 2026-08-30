// routes/inward.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, getNextReelNumber, getNextBoxNumber, nowIST } = require('../db/schema');
const { executeInward } = require('../utils/inventory');
const { isGateApprovedToday } = require('../utils/dailyGate');

// Roles that bypass approval
const APPROVER_ROLES = ['admin', 'manager', 'gelco_manager'];
const GELCO_ROLES = ['gelco_manager', 'gelco_worker'];

// Extracted so both direct-approve and request-approve paths use same logic - handled by inventory.js
// async function executeInward(item_code, num_reels, num_boxes, notes) {
//   const item = await queryOne('SELECT * FROM items WHERE item_code = ?', [item_code]);
//   if (!item) throw new Error(`Item "${item_code}" not found in catalog`);

//   const totalReels = parseInt(num_reels);
//   const totalBoxes = Number(num_boxes) > 0 ? Number(num_boxes) : 0;

//   const createdBoxes = [];
//   const createdReels = [];

//   if (totalBoxes === 0) {
//     for (let r = 0; r < totalReels; r++) {
//       const reelNumber = await getNextReelNumber();
//       await execute('INSERT INTO reels (reel_number, item_code, box_number, quantity, notes, inward_date) VALUES (?, ?, ?, ?, ?, ?)',
//         [reelNumber, item_code, null, item.default_spq, notes || null, nowIST()]);
//       createdReels.push({ reel_number: reelNumber, item_code, quantity: item.default_spq, box_number: null });
//     }
//   } else {
//     const reelsPerBox = Math.floor(totalReels / totalBoxes);
//     const remainder = totalReels % totalBoxes;

//     for (let b = 0; b < totalBoxes; b++) {
//       const boxNumber = await getNextBoxNumber();
//       const reelsInThisBox = reelsPerBox + (b < remainder ? 1 : 0);

//       await execute('INSERT INTO boxes (box_number, item_code, reel_count, created_at) VALUES (?, ?, ?, ?)',
//         [boxNumber, item_code, reelsInThisBox, nowIST()]);

//       const boxReels = [];
//       for (let r = 0; r < reelsInThisBox; r++) {
//         const reelNumber = await getNextReelNumber();
//         await execute('INSERT INTO reels (reel_number, item_code, box_number, quantity, notes, inward_date) VALUES (?, ?, ?, ?, ?, ?)',
//           [reelNumber, item_code, boxNumber, item.default_spq, notes || null, nowIST()]);
//         boxReels.push({ reel_number: reelNumber, item_code, quantity: item.default_spq });
//         createdReels.push({ reel_number: reelNumber, item_code, quantity: item.default_spq, box_number: boxNumber });
//       }

//       createdBoxes.push({ box_number: boxNumber, item_code, reel_count: reelsInThisBox, reels: boxReels });
//     }
//   }

//   return { boxes: createdBoxes, reels: createdReels };
// }

router.post('/', async (req, res) => {
  const { item_code, num_reels, num_boxes, notes, store_code } = req.body;
  if (!item_code || !num_reels || num_reels < 1) {
    return res.status(400).json({ error: 'item_code and num_reels (>= 1) are required' });
  }

  const item = await queryOne('SELECT * FROM items WHERE item_code = ?', [item_code]);
  if (!item) return res.status(404).json({ error: `Item "${item_code}" not found in catalog` });

  const userRole = req.user?.role;
  const username = req.user?.username;
  const storeCode = GELCO_ROLES.includes(userRole) ? 'secondary' : (store_code || 'primary');

  if (GELCO_ROLES.includes(userRole) && !(await isGateApprovedToday('secondary'))) {
    return res.status(403).json({ error: "Today's Gelco outward summary must be approved before making changes" });
  }

  // Managers and admins bypass approval
  if (APPROVER_ROLES.includes(userRole)) {
    try {
      const result = await executeInward(item_code, num_reels, num_boxes, notes, storeCode);
      const totalBoxes = Number(num_boxes) > 0 ? Number(num_boxes) : 0;
      return res.json({
        success: true,
        approved: true,
        message: totalBoxes === 0
          ? `${result.reels.length} reel(s) inwarded for ${item_code} (no box)`
          : `${result.reels.length} reel(s) in ${result.boxes.length} box(es) inwarded for ${item_code}`,
        boxes: result.boxes,
        reels: result.reels
      });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Duplicate reel number detected. Please try again.' });
      }
      return res.status(500).json({ error: err.message });
    }
  }

  // Staff: save as pending request
  try {
    const payload = JSON.stringify({ item_code, num_reels, num_boxes: num_boxes || 0, notes: notes || null, store_code: storeCode });
    await execute(
      'INSERT INTO requests (type, status, created_by, created_at, payload) VALUES (?, ?, ?, ?, ?)',
      ['inward', 'pending', username, nowIST(), payload]
    );
    return res.json({
      success: true,
      approved: false,
      pending: true,
      message: `Inward request submitted for approval`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/recent', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const store = GELCO_ROLES.includes(req.user?.role) ? 'secondary' : req.query.store;
  const params = [];
  let where = '';
  if (store && store !== 'all') {
    where = 'WHERE r.store_code = ?';
    params.push(store);
  }
  params.push(limit, offset);
  const reels = await queryAll(`
    SELECT r.*, i.description
    FROM reels r
    JOIN items i ON r.item_code = i.item_code
    ${where}
    ORDER BY r.inward_date DESC
    LIMIT ? OFFSET ?
  `, params);
  res.json(reels);
});

router.post('/undo', async (req, res) => {
  const { reel_numbers, password } = req.body;

  if (password !== 'admin123') {
    return res.status(403).json({ error: 'Incorrect password' });
  }

  if (!reel_numbers || !reel_numbers.length) {
    return res.status(400).json({ error: 'reel_numbers required' });
  }

  const boxNumbers = new Set();
  let undone = 0;
  let skipped = 0;

  for (const rn of reel_numbers) {
    const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [rn]);
    if (!reel) { skipped++; continue; }
    if (reel.status === 'Outwarded') { skipped++; continue; }
    if (reel.box_number) boxNumbers.add(reel.box_number);

    await execute("UPDATE reels SET status = 'Deleted', quantity = 0 WHERE reel_number = ?", [rn]);
    undone++;
  }

  // Clean up any box whose reels are now all Deleted
  for (const bn of boxNumbers) {
    const remaining = await queryOne(
      "SELECT COUNT(*) as count FROM reels WHERE box_number = ? AND status != 'Deleted'",
      [bn]
    );
    if (remaining && remaining.count === 0) {
      await execute('DELETE FROM boxes WHERE box_number = ?', [bn]);
    }
  }

  res.json({
    success: true,
    message: `${undone} reel(s) undone${skipped ? `, ${skipped} skipped (outwarded or not found)` : ''}`
  });
});

module.exports = router;
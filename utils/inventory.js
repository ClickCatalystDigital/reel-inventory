const { queryAll, queryOne, execute, withTransaction, getNextReelNumber, getNextBoxNumber, nowIST } = require('../db/schema');

async function executeInward(item_code, num_reels, num_boxes, notes, store_code = 'primary') {
  const item = await queryOne('SELECT * FROM items WHERE item_code = ?', [item_code]);
  if (!item) throw new Error(`Item "${item_code}" not found in catalog`);
  if (item.status === 'Deleted') throw new Error(`Item "${item_code}" has been archived and cannot receive stock`);

  const totalReels = parseInt(num_reels);
  const totalBoxes = Number(num_boxes) > 0 ? Number(num_boxes) : 0;
  const createdBoxes = [];
  const createdReels = [];

  if (totalBoxes === 0) {
    for (let r = 0; r < totalReels; r++) {
      const reelNumber = await getNextReelNumber();
      await execute(
        'INSERT INTO reels (reel_number, item_code, box_number, quantity, notes, inward_date, store_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [reelNumber, item_code, null, item.default_spq, notes || null, nowIST(), store_code]
      );
      createdReels.push({ reel_number: reelNumber, item_code, quantity: item.default_spq, box_number: null });
    }
  } else {
    const reelsPerBox = Math.floor(totalReels / totalBoxes);
    const remainder = totalReels % totalBoxes;
    for (let b = 0; b < totalBoxes; b++) {
      const boxNumber = await getNextBoxNumber();
      const reelsInThisBox = reelsPerBox + (b < remainder ? 1 : 0);
      await execute(
        'INSERT INTO boxes (box_number, item_code, reel_count, created_at, store_code) VALUES (?, ?, ?, ?, ?)',
        [boxNumber, item_code, reelsInThisBox, nowIST(), store_code]
      );
      const boxReels = [];
      for (let r = 0; r < reelsInThisBox; r++) {
        const reelNumber = await getNextReelNumber();
        await execute(
          'INSERT INTO reels (reel_number, item_code, box_number, quantity, notes, inward_date, store_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [reelNumber, item_code, boxNumber, item.default_spq, notes || null, nowIST(), store_code]
        );
        boxReels.push({ reel_number: reelNumber, item_code, quantity: item.default_spq });
        createdReels.push({ reel_number: reelNumber, item_code, quantity: item.default_spq, box_number: boxNumber });
      }
      createdBoxes.push({ box_number: boxNumber, item_code, reel_count: reelsInThisBox, reels: boxReels });
    }
  }

  return { boxes: createdBoxes, reels: createdReels };
}

// store_code is deliberately NOT a caller-settable parameter — it's always the
// reel's own current store_code, read fresh below. Letting a caller override it
// (the pre-fix behavior) let an outward's recorded store silently disagree with
// where the reel physically was, since nothing outside the Gelco-role path ever
// checked the two matched — see SYSTEM.md's outward.js notes for the incident
// this caused in production.
async function executeOutwardReel(reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes, company_id, po_id) {
  const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [reel_number]);
  if (!reel) throw new Error(`Reel ${reel_number} not found`);
  if (reel.status === 'Outwarded') throw new Error(`Reel ${reel_number} already outwarded`);

  const type = outward_type || 'Full';
  let qtyShipped;

  if (type === 'Partial') {
    qtyShipped = parseInt(quantity_shipped);
    if (!qtyShipped || qtyShipped <= 0 || qtyShipped >= reel.quantity) {
      throw new Error(`Partial quantity must be between 1 and ${reel.quantity - 1}`);
    }
  } else {
    qtyShipped = reel.quantity;
  }

  await execute(
    `INSERT INTO outwards (reel_number, customer_name, invoice_number, quantity_shipped, outward_type, notes, outward_date, company_id, po_id, store_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [reel_number, customer_name.trim(), invoice_number.trim(), qtyShipped, type, notes || null, nowIST(), company_id || null, po_id || null, reel.store_code]
  );

  if (type === 'Full') {
    await execute('UPDATE reels SET quantity = 0, status = ? WHERE reel_number = ?', ['Outwarded', reel_number]);
  } else {
    await execute('UPDATE reels SET quantity = ? WHERE reel_number = ?', [reel.quantity - qtyShipped, reel_number]);
  }

  return { qtyShipped, remaining: type === 'Full' ? 0 : reel.quantity - qtyShipped };
}

// Moves one reel and logs its own stock_transfers row — shared by both the
// single-reel path and the box path below, so every reel ever moved (whether
// alone or as part of a box batch) gets independently identifiable, precisely
// undoable history. `exec` is either the module-level execute (non-transactional,
// single-reel path) or a withTransaction-bound execute (box path, see below) —
// both share the (sql, params) => {changes} signature, so this needs no branching.
// The UPDATE is a compare-and-swap (WHERE store_code = the value just read): if
// another request already moved this reel between the read and this write,
// `changes` comes back 0 and we throw instead of silently double-logging a move
// that only half-happened. This is the concurrency guarantee — not the SELECT.
async function transferOneReel(exec, reel, to_store, transferred_by, notes, box_number = null) {
  const result = await exec(
    'UPDATE reels SET store_code = ? WHERE reel_number = ? AND store_code = ?',
    [to_store, reel.reel_number, reel.store_code]
  );
  if (result.changes === 0) {
    throw new Error(`Reel ${reel.reel_number} was already moved by another transfer — refresh and try again`);
  }
  await exec(
    `INSERT INTO stock_transfers (reel_number, box_number, from_store, to_store, quantity, transferred_by, transferred_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [reel.reel_number, box_number, reel.store_code, to_store, reel.quantity, transferred_by, nowIST(), notes || null]
  );
}

async function executeStockTransfer(kind, number, to_store, notes, transferred_by) {
  if (kind === 'reel') {
    const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [number]);
    if (!reel) throw new Error(`Reel ${number} not found`);
    if (reel.status === 'Outwarded') throw new Error(`Reel ${number} already outwarded`);
    if (reel.status === 'Deleted') throw new Error(`Reel ${number} has been deleted`);
    const from_store = reel.store_code;
    if (to_store === from_store) throw new Error('Source and destination store cannot be the same');

    // A reel that belongs to a box can move on its own now (business rule change —
    // see SYSTEM.md) — its box_number is preserved as display/history context on
    // the log row, not as a constraint. Reels in the same box are explicitly
    // allowed to end up in different stores as a result.
    await transferOneReel(execute, reel, to_store, transferred_by, notes, reel.box_number || null);
    return { from_store, to_store, quantity: reel.quantity };
  }

  if (kind === 'box') {
    const box = await queryOne('SELECT * FROM boxes WHERE box_number = ?', [number]);
    if (!box) throw new Error(`Box ${number} not found`);

    // boxes.store_code is no longer trusted as authoritative for eligibility —
    // only reels.store_code is, read fresh here. Only In Stock reels count:
    // Outwarded/Deleted reels aren't meaningfully "transferable" and don't block
    // or participate in the move (same "only in-stock is actionable" precedent
    // Outward already uses for its own box scans).
    const activeReels = await queryAll(
      "SELECT * FROM reels WHERE box_number = ? AND status = 'In Stock'",
      [number]
    );
    if (activeReels.length === 0) {
      throw new Error(`Box ${number} has no in-stock reels to transfer`);
    }

    const stores = new Set(activeReels.map((r) => r.store_code));
    if (stores.size > 1) {
      const breakdown = [...stores]
        .map((s) => `${s}: ${activeReels.filter((r) => r.store_code === s).length}`)
        .join(', ');
      throw new Error(`Box ${number}'s reels are split across stores (${breakdown}) — transfer eligible reels individually instead`);
    }
    const from_store = [...stores][0];
    if (to_store === from_store) throw new Error('Source and destination store cannot be the same');

    const quantity = activeReels.reduce((sum, r) => sum + r.quantity, 0);

    // Real transaction — the one place in this codebase that needs genuine
    // all-or-nothing atomicity (a "box transfer" that only moved 3 of 5 reels
    // before failing would be exactly the kind of corruption "atomic" rules out).
    // Every reel's own CAS-protected move, plus the box's own store_code, commit
    // together or not at all.
    await withTransaction(async (tx) => {
      for (const reel of activeReels) {
        await transferOneReel(tx, reel, to_store, transferred_by, notes, number);
      }
      const boxResult = await tx(
        'UPDATE boxes SET store_code = ? WHERE box_number = ? AND store_code = ?',
        [to_store, number, from_store]
      );
      if (boxResult.changes === 0) {
        throw new Error(`Box ${number} was already moved by another transfer — refresh and try again`);
      }
    });

    return { from_store, to_store, quantity, reelCount: activeReels.length };
  }

  throw new Error(`Unknown transfer kind "${kind}"`);
}

module.exports = { executeInward, executeOutwardReel, executeStockTransfer };
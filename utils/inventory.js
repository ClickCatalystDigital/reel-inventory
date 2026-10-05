const { queryAll, queryOne, execute, withTransaction, batch, reserveNumbers, healCounters, nowIST } = require('../db/schema');

// Rows per multi-row INSERT / IN() list — keeps bound variables far below SQLite's limit.
const CHUNK = 400;
const chunk = (arr, n = CHUNK) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
const marks = (n) => Array(n).fill('?').join(',');

async function executeInward(item_code, num_reels, num_boxes, notes, store_code = 'primary') {
  const item = await queryOne('SELECT * FROM items WHERE item_code = ?', [item_code]);
  if (!item) throw new Error(`Item "${item_code}" not found in catalog`);
  if (item.status === 'Deleted') throw new Error(`Item "${item_code}" has been archived and cannot receive stock`);

  const totalReels = parseInt(num_reels);
  const totalBoxes = Number(num_boxes) > 0 ? Number(num_boxes) : 0;
  // Reels per box: even split, remainder to the first boxes. No boxes = standalone reels.
  const perBox = Array.from({ length: totalBoxes }, (_, b) =>
    Math.floor(totalReels / totalBoxes) + (b < totalReels % totalBoxes ? 1 : 0));

  // Everything is reserved and written in a fixed handful of queries (any size), not several per reel.
  // If a reserved number collides with an existing one the counter fell behind: heal once, retry once.
  for (let attempt = 1; ; attempt++) {
    const reelStart = totalReels > 0 ? await reserveNumbers('reel', totalReels) : 0;
    const boxStart = totalBoxes > 0 ? await reserveNumbers('box', totalBoxes) : 0;
    const now = nowIST();
    const createdBoxes = [];
    const createdReels = [];
    let next = reelStart;

    if (totalBoxes === 0) {
      for (let r = 0; r < totalReels; r++) {
        createdReels.push({ reel_number: `REEL-${next++}`, item_code, quantity: item.default_spq, box_number: null });
      }
    } else {
      perBox.forEach((count, b) => {
        const box_number = `BOX-${boxStart + b}`;
        const reels = [];
        for (let r = 0; r < count; r++) {
          const reel_number = `REEL-${next++}`;
          reels.push({ reel_number, item_code, quantity: item.default_spq });
          createdReels.push({ reel_number, item_code, quantity: item.default_spq, box_number });
        }
        createdBoxes.push({ box_number, item_code, reel_count: count, reels });
      });
    }

    const statements = [];
    for (const rows of chunk(createdBoxes)) {
      statements.push([
        `INSERT INTO boxes (box_number, item_code, reel_count, created_at, store_code) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
        rows.flatMap((b) => [b.box_number, item_code, b.reel_count, now, store_code]),
      ]);
    }
    for (const rows of chunk(createdReels)) {
      statements.push([
        `INSERT INTO reels (reel_number, item_code, box_number, quantity, notes, inward_date, store_code) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        rows.flatMap((r) => [r.reel_number, item_code, r.box_number, item.default_spq, notes || null, now, store_code]),
      ]);
    }

    try {
      await batch(statements);
      return { boxes: createdBoxes, reels: createdReels };
    } catch (err) {
      if (attempt === 1 && /UNIQUE|constraint/i.test(err.message)) { await healCounters(); continue; }
      throw err;
    }
  }
}

// store_code is deliberately NOT a caller-settable parameter — it's always the
// reel's own current store_code, read fresh below. Letting a caller override it
// (the pre-fix behavior) let an outward's recorded store silently disagree with
// where the reel physically was, since nothing outside the Gelco-role path ever
// checked the two matched — see SYSTEM.md's outward.js notes for the incident
// this caused in production.
// Validates one reel and returns the statements that ship it (insert outward row + update reel),
// without running them — so a whole cart can go out in one batch (see executeOutwardMany).
function planOutward(reel, reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes, company_id, po_id) {
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

  const statements = [
    [`INSERT INTO outwards (reel_number, customer_name, invoice_number, quantity_shipped, outward_type, notes, outward_date, company_id, po_id, store_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reel_number, customer_name.trim(), invoice_number.trim(), qtyShipped, type, notes || null, nowIST(), company_id || null, po_id || null, reel.store_code]],
    type === 'Full'
      ? ['UPDATE reels SET quantity = 0, status = ? WHERE reel_number = ?', ['Outwarded', reel_number]]
      : ['UPDATE reels SET quantity = ? WHERE reel_number = ?', [reel.quantity - qtyShipped, reel_number]],
  ];
  return { qtyShipped, remaining: type === 'Full' ? 0 : reel.quantity - qtyShipped, statements };
}

// Ships many reels with ONE read and ONE write round trip (was ~3 queries per reel — a 20-reel
// cart blew past Workers' per-request subrequest cap). Per-reel failures are collected, the rest
// still ship; the shipped ones are written atomically.
async function executeOutwardMany(reel_numbers, customer_name, invoice_number, outward_type, quantity_shipped, notes, company_id, po_id) {
  const reels = new Map();
  for (const part of chunk([...new Set(reel_numbers)])) {
    const rows = await queryAll(`SELECT * FROM reels WHERE reel_number IN (${marks(part.length)})`, part);
    rows.forEach((r) => reels.set(r.reel_number, r));
  }
  const errors = [];
  const statements = [];
  const seen = new Set();
  for (const reel_number of reel_numbers) {
    try {
      // A reel listed twice: the second one would have found it already outwarded.
      if (seen.has(reel_number)) throw new Error(`Reel ${reel_number} already outwarded`);
      const plan = planOutward(reels.get(reel_number), reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes, company_id, po_id);
      seen.add(reel_number);
      statements.push(...plan.statements);
    } catch (err) {
      errors.push(`${reel_number}: ${err.message}`);
    }
  }
  await batch(statements);
  return { errors };
}

async function executeOutwardReel(reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes, company_id, po_id) {
  const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [reel_number]);
  const { qtyShipped, remaining, statements } = planOutward(reel, reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes, company_id, po_id);
  await batch(statements);
  return { qtyShipped, remaining };
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
    // Three statements regardless of box size (was two per reel — each a network round trip).
    // The UPDATE is the compare-and-swap for the whole box: every in-stock reel was just read at
    // from_store, so if any was moved by someone else meanwhile, fewer rows change and we roll back.
    await withTransaction(async (tx) => {
      const nums = activeReels.map((r) => r.reel_number);
      for (const part of chunk(nums)) {
        const moved = await tx(
          `UPDATE reels SET store_code = ? WHERE reel_number IN (${marks(part.length)}) AND store_code = ?`,
          [to_store, ...part, from_store]
        );
        if (moved.changes !== part.length) {
          throw new Error(`Box ${number} had reels moved by another transfer — refresh and try again`);
        }
      }
      const now = nowIST();
      for (const rows of chunk(activeReels)) {
        await tx(
          `INSERT INTO stock_transfers (reel_number, box_number, from_store, to_store, quantity, transferred_by, transferred_at, notes)
           VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          rows.flatMap((r) => [r.reel_number, number, r.store_code, to_store, r.quantity, transferred_by, now, notes || null])
        );
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

module.exports = { executeInward, executeOutwardReel, executeOutwardMany, executeStockTransfer };
const { queryAll, queryOne, execute, getNextReelNumber, getNextBoxNumber, nowIST } = require('../db/schema');

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

async function executeOutwardReel(reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes, company_id, po_id, store_code) {
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
    [reel_number, customer_name.trim(), invoice_number.trim(), qtyShipped, type, notes || null, nowIST(), company_id || null, po_id || null, store_code || reel.store_code]
  );

  if (type === 'Full') {
    await execute('UPDATE reels SET quantity = 0, status = ? WHERE reel_number = ?', ['Outwarded', reel_number]);
  } else {
    await execute('UPDATE reels SET quantity = ? WHERE reel_number = ?', [reel.quantity - qtyShipped, reel_number]);
  }

  return { qtyShipped, remaining: type === 'Full' ? 0 : reel.quantity - qtyShipped };
}

async function executeStockTransfer(kind, number, to_store, notes, transferred_by) {
  if (kind === 'reel') {
    const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [number]);
    if (!reel) throw new Error(`Reel ${number} not found`);
    if (reel.status === 'Outwarded') throw new Error(`Reel ${number} already outwarded`);
    if (reel.status === 'Deleted') throw new Error(`Reel ${number} has been deleted`);
    if (reel.box_number) throw new Error(`Reel ${number} belongs to box ${reel.box_number} — transfer the whole box instead`);
    const from_store = reel.store_code;
    if (to_store === from_store) throw new Error('Source and destination store cannot be the same');

    await execute('UPDATE reels SET store_code = ? WHERE reel_number = ?', [to_store, number]);
    await execute(
      `INSERT INTO stock_transfers (reel_number, from_store, to_store, quantity, transferred_by, transferred_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [number, from_store, to_store, reel.quantity, transferred_by, nowIST(), notes || null]
    );
    return { from_store, to_store, quantity: reel.quantity };
  }

  if (kind === 'box') {
    const box = await queryOne('SELECT * FROM boxes WHERE box_number = ?', [number]);
    if (!box) throw new Error(`Box ${number} not found`);
    const from_store = box.store_code;
    if (to_store === from_store) throw new Error('Source and destination store cannot be the same');

    const reels = await queryAll(
      "SELECT * FROM reels WHERE box_number = ? AND status != 'Deleted'",
      [number]
    );
    const quantity = reels.reduce((sum, r) => sum + r.quantity, 0);

    await execute('UPDATE boxes SET store_code = ? WHERE box_number = ?', [to_store, number]);
    await execute('UPDATE reels SET store_code = ? WHERE box_number = ?', [to_store, number]);
    await execute(
      `INSERT INTO stock_transfers (box_number, from_store, to_store, quantity, transferred_by, transferred_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [number, from_store, to_store, quantity, transferred_by, nowIST(), notes || null]
    );
    return { from_store, to_store, quantity };
  }

  throw new Error(`Unknown transfer kind "${kind}"`);
}

module.exports = { executeInward, executeOutwardReel, executeStockTransfer };
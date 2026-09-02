// utils/pdf.js
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { generateQRBuffer } = require('./qr');
const { queryAll, queryOne, istDateString } = require('../db/schema');
const ah = require('./asyncHandler');
const { getDailyReportData } = require('./dailyReport');

const mm = (v) => v * 2.83465;

const LABEL_W = mm(85);
const LABEL_H = mm(24);
const HALF_W = LABEL_W / 2;
const QR_SIZE = mm(21);   // Slightly smaller to allow top/bottom breathing room
const PAD = mm(3);        // Increased padding for better top/bottom margins

function fitFontSize(doc, text, font, maxWidth, startSize, minSize = 6) {
  let size = startSize;
  doc.font(font).fontSize(size);
  while (size > minSize && doc.widthOfString(text) > maxWidth) {
    size -= 0.5;
    doc.fontSize(size);
  }
  return size;
}

router.post('/generate', ah(async (req, res) => {
  const { reel_numbers } = req.body;

  if (!reel_numbers || !reel_numbers.length) {
    return res.status(400).json({ error: 'reel_numbers array is required' });
  }

  const placeholders = reel_numbers.map(() => '?').join(',');
  const reels = await queryAll(`
    SELECT r.reel_number, r.item_code, r.quantity, r.inward_date, r.notes, i.description
    FROM reels r
    JOIN items i ON r.item_code = i.item_code
    WHERE r.reel_number IN (${placeholders})
  `, reel_numbers);

  if (!reels.length) return res.status(404).json({ error: 'No reels found' });

  const doc = new PDFDocument({
    size: [LABEL_W, LABEL_H],
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=labels_${Date.now()}.pdf`);
  doc.pipe(res);

  const qrY = (LABEL_H - QR_SIZE) / 2; // vertically center QR

  // for (let i = 0; i < reels.length; i += 2) {
  //   if (i > 0) doc.addPage();

  //   const pair = [reels[i], reels[i + 1]].filter(Boolean);

  //   for (let s = 0; s < pair.length; s++) {
  //     const reel = pair[s];
  //     const xOffset = s * HALF_W;

  //     const qrBuffer = await generateQRBuffer(reel.reel_number);

  // Generate all QR buffers in parallel — critical for large inwards
  const qrBuffers = await Promise.all(reels.map(r => generateQRBuffer(r.reel_number)));

  for (let i = 0; i < reels.length; i += 2) {
    if (i > 0) doc.addPage();

    const pair = [reels[i], reels[i + 1]].filter(Boolean);

    for (let s = 0; s < pair.length; s++) {
      const reel = pair[s];
      const xOffset = s * HALF_W;

      const qrBuffer = qrBuffers[i + s];

      // const dateStr = reel.inward_date
      //   ? new Date(reel.inward_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      //   : '—';
      // const timeStr = reel.inward_date
      //   ? new Date(reel.inward_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      //   : '';

      // QR code - vertically centered
      doc.image(qrBuffer, xOffset + PAD, qrY, { width: QR_SIZE, height: QR_SIZE });

      // Text area - starts aligned with top of QR
      const textX = xOffset + PAD + QR_SIZE + mm(2);
      // const textW = HALF_W - QR_SIZE - PAD * 2 - mm(2);
      const textW = HALF_W - QR_SIZE - PAD - mm(2) - mm(1);
      // PAD protects outer edge, mm(2) is QR-to-text gap, mm(1) is inner buffer
      // gives 42.5 - 21 - 3 - 2 - 1 = 15.5mm — workable
      // Distribute 4 lines evenly across QR height
      // Fixed positions relative to qrY — tuned visually for 20mm QR on 24mm label
      // doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000');
      // doc.text(reel.reel_number.replace('REEL-', ''), textX, qrY + mm(1), { width: textW, lineBreak: false });

      // doc.fontSize(8).font('Helvetica-Bold').fillColor('#222222');
      // doc.text(reel.item_code, textX, qrY + mm(5.5), { width: textW, lineBreak: false });

      // doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#333333');
      // doc.text(`Qty: ${reel.quantity.toLocaleString()}`, textX, qrY + mm(10), { width: textW, lineBreak: false });

      fitFontSize(doc, reel.reel_number.replace('REEL-', ''), 'Helvetica-Bold', textW, 11);
      doc.fillColor('#000000');
      doc.text(reel.reel_number.replace('REEL-', ''), textX, qrY + mm(1), { width: textW, lineBreak: false });

      fitFontSize(doc, reel.item_code, 'Helvetica-Bold', textW, 8);
      doc.fillColor('#222222');
      doc.text(reel.item_code, textX, qrY + mm(5.5), { width: textW, lineBreak: false });

      fitFontSize(doc, `Qty: ${reel.quantity.toLocaleString()}`, 'Helvetica-Bold', textW, 8.5);
      doc.fillColor('#333333');
      doc.text(`Qty: ${reel.quantity.toLocaleString()}`, textX, qrY + mm(10), { width: textW, lineBreak: false });
      if (reel.notes) {
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#555555');
        doc.text(`Batch: ${reel.notes}`, textX, qrY + mm(17.5), { width: textW, lineBreak: false, ellipsis: true });
      }
    }

    // Center divider
    doc.moveTo(HALF_W, mm(1)).lineTo(HALF_W, LABEL_H - mm(1)).stroke('#cccccc');
  }

  doc.end();
}));

// POST generate box labels (1 box per label page)
router.post('/generate-box', ah(async (req, res) => {
  const { box_numbers } = req.body;

  if (!box_numbers || !box_numbers.length) {
    return res.status(400).json({ error: 'box_numbers array is required' });
  }

  const boxes = [];
  for (const bn of box_numbers) {
    const box = await queryAll(`
      SELECT b.box_number, b.item_code, b.reel_count, i.description,
        GROUP_CONCAT(r.reel_number) as reel_list
      FROM boxes b
      JOIN items i ON b.item_code = i.item_code
      LEFT JOIN reels r ON r.box_number = b.box_number
      WHERE b.box_number = ?
      GROUP BY b.box_number
    `, [bn]);
    if (box.length) boxes.push(box[0]);
  }

  if (!boxes.length) return res.status(404).json({ error: 'No boxes found' });

  const doc = new PDFDocument({
    size: [LABEL_W, LABEL_H],
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=box_labels_${Date.now()}.pdf`);
  doc.pipe(res);

  const qrY = (LABEL_H - QR_SIZE) / 2;

  for (let i = 0; i < boxes.length; i++) {
    if (i > 0) doc.addPage();
    const box = boxes[i];

    const qrBuffer = await generateQRBuffer(box.box_number);

    doc.image(qrBuffer, PAD, qrY, { width: QR_SIZE, height: QR_SIZE });

    const textX = PAD + QR_SIZE + mm(2);
    const textW = LABEL_W - QR_SIZE - PAD * 2 - mm(2);
    const textTopY = qrY + mm(0.5);

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
    doc.text(box.box_number.replace('BOX-', 'BOX '), textX, textTopY, { width: textW, lineBreak: false });

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#222222');
    doc.text(`${box.item_code}  (${box.reel_count} reels)`, textX, textTopY + mm(4.5), { width: textW, lineBreak: false });

    doc.fontSize(5.5).font('Helvetica').fillColor('#444444');
    const reelNums = box.reel_list ? box.reel_list.replace(/REEL-/g, '').split(',').join(', ') : '';
    doc.text(`Reels: ${reelNums}`, textX, textTopY + mm(9), { width: textW, lineBreak: false });

    doc.fontSize(5).font('Helvetica').fillColor('#666666');
    doc.text(box.description || '', textX, textTopY + mm(13), { width: textW, lineBreak: false });
  }

  doc.end();
}));


// POST generate A4 landscape packing list PDF — grouped by item
router.post('/packing-list', ah(async (req, res) => {
  const { customer_name, invoice_number, reels } = req.body;

  if (!customer_name || !invoice_number || !reels || !reels.length) {
    return res.status(400).json({ error: 'customer_name, invoice_number, and reels array required' });
  }

  // A4 landscape dimensions
  const PAGE_W = 841.89;
  const PAGE_H = 595.28;
  const MARGIN = 35;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=packing_list_${invoice_number}_${Date.now()}.pdf`);
  doc.pipe(res);

  // --- Group reels by item_code ---
  const grouped = {};
  for (const r of reels) {
    const key = r.item_code;
    if (!grouped[key]) {
      grouped[key] = {
        item_code: r.item_code,
        description: r.description || '',
        spq: r.spq || r.default_spq || '—',
        reels: []
      };
    }
    grouped[key].reels.push(r);
  }

  // Fetch SPQ from DB for each item (frontend cart may not always carry it)
  const itemCodes = Object.keys(grouped);
  const placeholders = itemCodes.map(() => '?').join(',');
  const items = await queryAll(
    `SELECT item_code, description, default_spq FROM items WHERE item_code IN (${placeholders})`,
    itemCodes
  );
  for (const item of items) {
    if (grouped[item.item_code]) {
      grouped[item.item_code].spq = item.default_spq;
      if (!grouped[item.item_code].description) {
        grouped[item.item_code].description = item.description;
      }
    }
  }

  const rows = Object.values(grouped);

  // --- Column layout (landscape) ---
  // Sr | Item | Description | SPQ | Reel Qty | Total Item Qty | Reel Numbers
  // Define widths first, positions calculated from them
  const COL_WIDTHS = {
    sn:       30,
    item:     110,
    desc:     200,
    spq:      55,
    reelQty:  80,
    totalQty: 85,
    reelNums: CONTENT_W - 30 - 110 - 200 - 55 - 80 - 85,
  };
  const col = {
    sn:       MARGIN,
    item:     MARGIN + COL_WIDTHS.sn,
    desc:     MARGIN + COL_WIDTHS.sn + COL_WIDTHS.item,
    spq:      MARGIN + COL_WIDTHS.sn + COL_WIDTHS.item + COL_WIDTHS.desc,
    reelQty:  MARGIN + COL_WIDTHS.sn + COL_WIDTHS.item + COL_WIDTHS.desc + COL_WIDTHS.spq,
    totalQty: MARGIN + COL_WIDTHS.sn + COL_WIDTHS.item + COL_WIDTHS.desc + COL_WIDTHS.spq + COL_WIDTHS.reelQty,
    reelNums: MARGIN + COL_WIDTHS.sn + COL_WIDTHS.item + COL_WIDTHS.desc + COL_WIDTHS.spq + COL_WIDTHS.reelQty + COL_WIDTHS.totalQty,
  };

  function drawTableHeader(doc, y) {
    doc.rect(MARGIN, y, CONTENT_W, 20).fill('#1a1a18');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('#', col.sn + 10, y + 6, { width: COL_WIDTHS.sn, lineBreak: false });
    doc.text('ITEM CODE',     col.item,     y + 6, { width: COL_WIDTHS.item,     lineBreak: false });
    doc.text('DESCRIPTION',   col.desc,     y + 6, { width: COL_WIDTHS.desc,     lineBreak: false });
    doc.text('SPQ',           col.spq,      y + 6, { width: COL_WIDTHS.spq,      lineBreak: false });
    doc.text('NO. OF REELS',  col.reelQty,  y + 6, { width: COL_WIDTHS.reelQty,  lineBreak: false });
    doc.text('TOTAL QTY',     col.totalQty, y + 6, { width: COL_WIDTHS.totalQty, lineBreak: false });
    doc.text('REEL NUMBERS',  col.reelNums, y + 6, { width: COL_WIDTHS.reelNums, lineBreak: false });
    return y + 22;
  }

  // --- Header ---
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#000000');
  doc.text('PACKING LIST', MARGIN, MARGIN, { width: CONTENT_W, align: 'center' });

  doc.moveTo(MARGIN, MARGIN + 26).lineTo(MARGIN + CONTENT_W, MARGIN + 26).lineWidth(2).stroke('#000000');

  // Meta info row
  const metaY = MARGIN + 34;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333');
  doc.text('Customer:',  MARGIN,       metaY);
  doc.font('Helvetica').text(customer_name, MARGIN + 65, metaY);

  doc.font('Helvetica-Bold').text('Invoice:',   MARGIN + 280, metaY);
  doc.font('Helvetica').text(invoice_number,    MARGIN + 330, metaY);

  doc.font('Helvetica-Bold').text('Date:',      MARGIN + 530, metaY);
  doc.font('Helvetica').text(
    new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    MARGIN + 558, metaY
  );

  doc.font('Helvetica-Bold').text('Total Reels:', MARGIN + 650, metaY);
  doc.font('Helvetica').text(String(reels.length), MARGIN + 718, metaY);

  // --- Table ---
  let y = metaY + 22;
  y = drawTableHeader(doc, y);

  let grandTotalQty = 0;
  let grandTotalReels = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const reelQtys = row.reels.map(r => r.quantity);
    const totalItemQty = reelQtys.reduce((s, q) => s + (q || 0), 0);
    const reelNumbers = row.reels.map(r => r.reel_number.replace('REEL-', '')).join(', ');

    // Reel Qty = number of reels for this item
    const reelQtyDisplay = row.reels.length.toString();

    grandTotalQty += totalItemQty;
    grandTotalReels += row.reels.length;

    // Estimate row height — reel numbers may wrap
    const reelNumsWidth = COL_WIDTHS.reelNums;
    const estimatedLines = Math.ceil((reelNumbers.length * 5.5) / reelNumsWidth) + 1;
    const rowH = Math.max(20, estimatedLines * 11 + 8);

    // New page if needed
    if (y + rowH > PAGE_H - MARGIN - 40) {
      doc.addPage({ size: 'A4', layout: 'landscape' });
      y = MARGIN;
      y = drawTableHeader(doc, y);
    }

    // Alternate row shading
    if (i % 2 === 0) {
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill('#f8f8f5');
    }

    doc.fontSize(8).fillColor('#333333');

    doc.font('Helvetica').text(String(i + 1), col.sn + 10, y + 6, { width: COL_WIDTHS.sn, lineBreak: false });
    doc.font('Helvetica-Bold').text(row.item_code,     col.item,     y + 6, { width: COL_WIDTHS.item,     lineBreak: false });
    doc.font('Helvetica').text(row.description,        col.desc,     y + 6, { width: COL_WIDTHS.desc,     lineBreak: false });
    doc.text(String(row.spq),                          col.spq,      y + 6, { width: COL_WIDTHS.spq,      lineBreak: false });
    doc.text(reelQtyDisplay,                           col.reelQty,  y + 6, { width: COL_WIDTHS.reelQty,  lineBreak: false });
    doc.font('Helvetica-Bold').text(totalItemQty.toLocaleString(), col.totalQty, y + 6, { width: COL_WIDTHS.totalQty, lineBreak: false });
    doc.font('Helvetica').fontSize(7).text(reelNumbers, col.reelNums, y + 6, { width: COL_WIDTHS.reelNums, lineBreak: true });

    // Row bottom border
    doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + CONTENT_W, y + rowH).lineWidth(0.5).stroke('#dddddd');

    y += rowH;
  }

  // --- Totals row ---
  y += 4;
  doc.rect(MARGIN, y, CONTENT_W, 22).fill('#f0f0ec');
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
  doc.text('TOTAL',                          col.desc,     y + 6, { width: COL_WIDTHS.desc,     lineBreak: false });
  doc.text(`${grandTotalReels} reels`,       col.reelQty,  y + 6, { width: COL_WIDTHS.reelQty,  lineBreak: false });
  doc.text(grandTotalQty.toLocaleString(),   col.totalQty, y + 6, { width: COL_WIDTHS.totalQty, lineBreak: false });

  // --- Footer ---
  y += 36;
  if (y + 50 > PAGE_H - MARGIN) {
    doc.addPage({ size: 'A4', layout: 'landscape' });
    y = MARGIN;
  }

  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).dash(2, { space: 2 }).lineWidth(0.5).stroke('#cccccc');
  doc.undash();
  y += 14;

  doc.fontSize(8).font('Helvetica').fillColor('#999999');
  doc.text('Receiver Signature: ________________________', MARGIN, y);
  doc.text('Date: ________________________', MARGIN + 320, y);
  y += 24;
  doc.text('Checked by: ________________________', MARGIN, y);
  doc.text('Remarks: ________________________', MARGIN + 320, y);

  doc.end();
}));

// GET Daily Report PDF — today's (IST) inward/outward-by-item, dead/low stock, pending approvals.
// /api/labels has no mount-wide role guard (label/packing-list generation must stay open
// to Gelco roles for Outward) — this handler must block them itself, since Daily Report
// carries the same cross-store business data routes/dashboard.js's block exists to protect.
router.get('/daily-report', ah(async (req, res) => {
  if (['gelco_manager', 'gelco_worker'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const data = await getDailyReportData(req.query.store, req.query.date);

  const PAGE_W = 841.89;
  const PAGE_H = 595.28;
  const MARGIN = 35;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=daily_report_${data.date}.pdf`);
  doc.pipe(res);

  const COL_WIDTHS = {
    item: 150,
    inReels: 150,
    inQty: 150,
    outReels: 150,
    outQty: CONTENT_W - 150 * 4,
  };
  const col = {
    item: MARGIN,
    inReels: MARGIN + COL_WIDTHS.item,
    inQty: MARGIN + COL_WIDTHS.item + COL_WIDTHS.inReels,
    outReels: MARGIN + COL_WIDTHS.item + COL_WIDTHS.inReels + COL_WIDTHS.inQty,
    outQty: MARGIN + COL_WIDTHS.item + COL_WIDTHS.inReels + COL_WIDTHS.inQty + COL_WIDTHS.outReels,
  };

  function drawTableHeader(doc, y) {
    doc.rect(MARGIN, y, CONTENT_W, 20).fill('#1a1a18');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('ITEM CODE', col.item, y + 6, { width: COL_WIDTHS.item, lineBreak: false });
    doc.text('REELS IN', col.inReels, y + 6, { width: COL_WIDTHS.inReels, lineBreak: false });
    doc.text('QTY IN', col.inQty, y + 6, { width: COL_WIDTHS.inQty, lineBreak: false });
    doc.text('REELS OUT', col.outReels, y + 6, { width: COL_WIDTHS.outReels, lineBreak: false });
    doc.text('QTY OUT', col.outQty, y + 6, { width: COL_WIDTHS.outQty, lineBreak: false });
    return y + 22;
  }

  doc.fontSize(20).font('Helvetica-Bold').fillColor('#000000');
  doc.text('DAILY REPORT', MARGIN, MARGIN, { width: CONTENT_W, align: 'center' });
  doc.moveTo(MARGIN, MARGIN + 26).lineTo(MARGIN + CONTENT_W, MARGIN + 26).lineWidth(2).stroke('#000000');

  const metaY = MARGIN + 34;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333');
  doc.text('Date:', MARGIN, metaY);
  doc.font('Helvetica').text(data.date, MARGIN + 40, metaY);
  doc.font('Helvetica-Bold').text('Pending Approvals:', MARGIN + 500, metaY);
  doc.font('Helvetica').text(String(data.pendingApprovals), MARGIN + 620, metaY);

  // Merge inward/outward by item_code into one row set
  const byItem = {};
  for (const r of data.inward) byItem[r.item_code] = { item_code: r.item_code, inReels: r.reel_count, inQty: r.total_qty, outReels: 0, outQty: 0 };
  for (const r of data.outward) {
    if (!byItem[r.item_code]) byItem[r.item_code] = { item_code: r.item_code, inReels: 0, inQty: 0, outReels: 0, outQty: 0 };
    byItem[r.item_code].outReels = r.reel_count;
    byItem[r.item_code].outQty = r.total_qty;
  }
  const rows = Object.values(byItem);

  let y = metaY + 22;
  y = drawTableHeader(doc, y);

  if (!rows.length) {
    doc.fontSize(9).font('Helvetica').fillColor('#666666');
    doc.text('No inward or outward activity today.', MARGIN, y + 6);
    y += 22;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowH = 20;
    if (y + rowH > PAGE_H - MARGIN - 40) {
      doc.addPage({ size: 'A4', layout: 'landscape' });
      y = MARGIN;
      y = drawTableHeader(doc, y);
    }
    if (i % 2 === 0) doc.rect(MARGIN, y, CONTENT_W, rowH).fill('#f8f8f5');

    doc.fontSize(8).fillColor('#333333');
    doc.font('Helvetica-Bold').text(row.item_code, col.item, y + 6, { width: COL_WIDTHS.item, lineBreak: false });
    doc.font('Helvetica').text(String(row.inReels || 0), col.inReels, y + 6, { width: COL_WIDTHS.inReels, lineBreak: false });
    doc.text((row.inQty || 0).toLocaleString(), col.inQty, y + 6, { width: COL_WIDTHS.inQty, lineBreak: false });
    doc.text(String(row.outReels || 0), col.outReels, y + 6, { width: COL_WIDTHS.outReels, lineBreak: false });
    doc.text((row.outQty || 0).toLocaleString(), col.outQty, y + 6, { width: COL_WIDTHS.outQty, lineBreak: false });

    doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + CONTENT_W, y + rowH).lineWidth(0.5).stroke('#dddddd');
    y += rowH;
  }

  // --- Transfers Today table ---
  y += 14;
  if (y + 40 > PAGE_H - MARGIN) {
    doc.addPage({ size: 'A4', layout: 'landscape' });
    y = MARGIN;
  }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000');
  doc.text(`Transfers Today (${data.transfers.length})`, MARGIN, y);
  y += 18;

  const TCOL_WIDTHS = { item: 110, from: 130, to: 130, qty: 90, by: 140, at: CONTENT_W - 110 - 130 - 130 - 90 - 140 };
  const tcol = {
    item: MARGIN,
    from: MARGIN + TCOL_WIDTHS.item,
    to: MARGIN + TCOL_WIDTHS.item + TCOL_WIDTHS.from,
    qty: MARGIN + TCOL_WIDTHS.item + TCOL_WIDTHS.from + TCOL_WIDTHS.to,
    by: MARGIN + TCOL_WIDTHS.item + TCOL_WIDTHS.from + TCOL_WIDTHS.to + TCOL_WIDTHS.qty,
    at: MARGIN + TCOL_WIDTHS.item + TCOL_WIDTHS.from + TCOL_WIDTHS.to + TCOL_WIDTHS.qty + TCOL_WIDTHS.by,
  };

  function drawTransferTableHeader(doc, y) {
    doc.rect(MARGIN, y, CONTENT_W, 20).fill('#1a1a18');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('ITEM', tcol.item, y + 6, { width: TCOL_WIDTHS.item, lineBreak: false });
    doc.text('FROM', tcol.from, y + 6, { width: TCOL_WIDTHS.from, lineBreak: false });
    doc.text('TO', tcol.to, y + 6, { width: TCOL_WIDTHS.to, lineBreak: false });
    doc.text('QTY', tcol.qty, y + 6, { width: TCOL_WIDTHS.qty, lineBreak: false });
    doc.text('BY', tcol.by, y + 6, { width: TCOL_WIDTHS.by, lineBreak: false });
    doc.text('AT', tcol.at, y + 6, { width: TCOL_WIDTHS.at, lineBreak: false });
    return y + 22;
  }

  y = drawTransferTableHeader(doc, y);

  if (!data.transfers.length) {
    doc.fontSize(9).font('Helvetica').fillColor('#666666');
    doc.text('No transfers today.', MARGIN, y + 6);
    y += 22;
  }

  for (let i = 0; i < data.transfers.length; i++) {
    const t = data.transfers[i];
    const rowH = 20;
    if (y + rowH > PAGE_H - MARGIN - 40) {
      doc.addPage({ size: 'A4', layout: 'landscape' });
      y = MARGIN;
      y = drawTransferTableHeader(doc, y);
    }
    if (i % 2 === 0) doc.rect(MARGIN, y, CONTENT_W, rowH).fill('#f8f8f5');

    doc.fontSize(8).fillColor('#333333');
    doc.font('Helvetica-Bold').text(t.reel_number || t.box_number || '-', tcol.item, y + 6, { width: TCOL_WIDTHS.item, lineBreak: false });
    doc.font('Helvetica').text(t.from_store_name || t.from_store, tcol.from, y + 6, { width: TCOL_WIDTHS.from, lineBreak: false });
    doc.text(t.to_store_name || t.to_store, tcol.to, y + 6, { width: TCOL_WIDTHS.to, lineBreak: false });
    doc.text(String(t.quantity ?? 0), tcol.qty, y + 6, { width: TCOL_WIDTHS.qty, lineBreak: false });
    doc.text(t.transferred_by || '-', tcol.by, y + 6, { width: TCOL_WIDTHS.by, lineBreak: false });
    doc.text((t.transferred_at || '').slice(0, 16), tcol.at, y + 6, { width: TCOL_WIDTHS.at, lineBreak: false });

    doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + CONTENT_W, y + rowH).lineWidth(0.5).stroke('#dddddd');
    y += rowH;
  }

  // --- Alerts summary ---
  y += 14;
  if (y + 40 > PAGE_H - MARGIN) {
    doc.addPage({ size: 'A4', layout: 'landscape' });
    y = MARGIN;
  }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000');
  doc.text(`Dead Stock (30+ days no movement): ${data.deadStock.length} item(s)`, MARGIN, y);
  y += 16;
  doc.text(`Low Stock (below 5 reels): ${data.lowStock.length} item(s)`, MARGIN, y);

  doc.end();
}));

// GET Stock Transfer report PDF — mirrors the Transfer page's Recent Transfers filters
// (store/date_from/date_to) exactly, so "download PDF" always matches what's on screen.
// Not blocked for Gelco roles outright (unlike /daily-report) — GET /api/transfer/recent
// already scopes them to their own store rather than refusing them, so this matches that.
router.get('/transfer-report', ah(async (req, res) => {
  const GELCO_ROLES = ['gelco_manager', 'gelco_worker'];
  const store = GELCO_ROLES.includes(req.user?.role) ? 'secondary' : req.query.store;
  const { date_from, date_to } = req.query;

  const conditions = [];
  const params = [];
  if (store && store !== 'all') {
    conditions.push('(st.from_store = ? OR st.to_store = ?)');
    params.push(store, store);
  }
  if (date_from) { conditions.push('st.transferred_at >= ?'); params.push(date_from + ' 00:00:00'); }
  if (date_to) { conditions.push('st.transferred_at <= ?'); params.push(date_to + ' 23:59:59'); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = await queryAll(`
    SELECT st.reel_number, st.box_number, st.from_store, st.to_store, st.quantity,
      st.transferred_by, st.transferred_at, st.notes,
      fs.name as from_store_name, ts.name as to_store_name
    FROM stock_transfers st
    LEFT JOIN stores fs ON fs.code = st.from_store
    LEFT JOIN stores ts ON ts.code = st.to_store
    ${where}
    ORDER BY st.transferred_at DESC
  `, params);

  const PAGE_W = 841.89;
  const PAGE_H = 595.28;
  const MARGIN = 35;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }
  });

  const rangeLabel = date_from || date_to ? `${date_from || 'start'}_to_${date_to || istDateString()}` : istDateString();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=transfer_report_${rangeLabel}.pdf`);
  doc.pipe(res);

  const COL_WIDTHS = { item: 85, box: 85, from: 105, to: 105, qty: 65, by: 110, at: 105, notes: CONTENT_W - 85 - 85 - 105 - 105 - 65 - 110 - 105 };
  const col = {
    item: MARGIN,
    box: MARGIN + COL_WIDTHS.item,
    from: MARGIN + COL_WIDTHS.item + COL_WIDTHS.box,
    to: MARGIN + COL_WIDTHS.item + COL_WIDTHS.box + COL_WIDTHS.from,
    qty: MARGIN + COL_WIDTHS.item + COL_WIDTHS.box + COL_WIDTHS.from + COL_WIDTHS.to,
    by: MARGIN + COL_WIDTHS.item + COL_WIDTHS.box + COL_WIDTHS.from + COL_WIDTHS.to + COL_WIDTHS.qty,
    at: MARGIN + COL_WIDTHS.item + COL_WIDTHS.box + COL_WIDTHS.from + COL_WIDTHS.to + COL_WIDTHS.qty + COL_WIDTHS.by,
    notes: MARGIN + COL_WIDTHS.item + COL_WIDTHS.box + COL_WIDTHS.from + COL_WIDTHS.to + COL_WIDTHS.qty + COL_WIDTHS.by + COL_WIDTHS.at,
  };

  function drawTableHeader(doc, y) {
    doc.rect(MARGIN, y, CONTENT_W, 20).fill('#1a1a18');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('ITEM', col.item, y + 6, { width: COL_WIDTHS.item, lineBreak: false });
    doc.text('BOX', col.box, y + 6, { width: COL_WIDTHS.box, lineBreak: false });
    doc.text('FROM', col.from, y + 6, { width: COL_WIDTHS.from, lineBreak: false });
    doc.text('TO', col.to, y + 6, { width: COL_WIDTHS.to, lineBreak: false });
    doc.text('QTY', col.qty, y + 6, { width: COL_WIDTHS.qty, lineBreak: false });
    doc.text('BY', col.by, y + 6, { width: COL_WIDTHS.by, lineBreak: false });
    doc.text('DATE & TIME', col.at, y + 6, { width: COL_WIDTHS.at, lineBreak: false });
    doc.text('NOTES', col.notes, y + 6, { width: COL_WIDTHS.notes, lineBreak: false });
    return y + 22;
  }

  // --- Header ---
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#000000');
  doc.text('STOCK TRANSFER REPORT', MARGIN, MARGIN, { width: CONTENT_W, align: 'center' });
  doc.moveTo(MARGIN, MARGIN + 26).lineTo(MARGIN + CONTENT_W, MARGIN + 26).lineWidth(2).stroke('#000000');

  const metaY = MARGIN + 34;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333');
  doc.text('Period:', MARGIN, metaY);
  doc.font('Helvetica').text(date_from || date_to ? `${date_from || 'Start'} to ${date_to || 'Today'}` : 'All Time', MARGIN + 45, metaY);

  let storeLabel = 'All Stores';
  if (store && store !== 'all') {
    const storeRow = await queryOne('SELECT name FROM stores WHERE code = ?', [store]);
    storeLabel = storeRow?.name || store;
  }
  doc.font('Helvetica-Bold').text('Store:', MARGIN + 260, metaY);
  doc.font('Helvetica').text(storeLabel, MARGIN + 300, metaY);

  doc.font('Helvetica-Bold').text('Generated:', MARGIN + 500, metaY);
  doc.font('Helvetica').text(
    new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    MARGIN + 560, metaY
  );
  doc.font('Helvetica-Bold').text('Total Transfers:', MARGIN + 650, metaY);
  doc.font('Helvetica').text(String(rows.length), MARGIN + 745, metaY);

  // --- Table ---
  let y = metaY + 22;
  y = drawTableHeader(doc, y);

  if (!rows.length) {
    doc.fontSize(9).font('Helvetica').fillColor('#666666');
    doc.text('No transfers found for this filter.', MARGIN, y + 6);
    y += 22;
  }

  let totalQty = 0;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    totalQty += t.quantity || 0;
    const rowH = 20;
    if (y + rowH > PAGE_H - MARGIN - 40) {
      doc.addPage({ size: 'A4', layout: 'landscape' });
      y = MARGIN;
      y = drawTableHeader(doc, y);
    }
    if (i % 2 === 0) doc.rect(MARGIN, y, CONTENT_W, rowH).fill('#f8f8f5');

    doc.fontSize(8).fillColor('#333333');
    doc.font('Helvetica-Bold').text(t.reel_number || t.box_number || '-', col.item, y + 6, { width: COL_WIDTHS.item, lineBreak: false });
    doc.font('Helvetica').text(t.reel_number ? (t.box_number || '—') : '—', col.box, y + 6, { width: COL_WIDTHS.box, lineBreak: false });
    doc.text(t.from_store_name || t.from_store, col.from, y + 6, { width: COL_WIDTHS.from, lineBreak: false });
    doc.text(t.to_store_name || t.to_store, col.to, y + 6, { width: COL_WIDTHS.to, lineBreak: false });
    doc.text(formatQtyStr(t.quantity), col.qty, y + 6, { width: COL_WIDTHS.qty, lineBreak: false });
    doc.text(t.transferred_by || '-', col.by, y + 6, { width: COL_WIDTHS.by, lineBreak: false });
    doc.text((t.transferred_at || '').slice(0, 16), col.at, y + 6, { width: COL_WIDTHS.at, lineBreak: false });
    doc.fontSize(7).text(t.notes || '—', col.notes, y + 6, { width: COL_WIDTHS.notes, lineBreak: false });

    doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + CONTENT_W, y + rowH).lineWidth(0.5).stroke('#dddddd');
    y += rowH;
  }

  // --- Totals row ---
  if (rows.length) {
    y += 4;
    if (y + 22 > PAGE_H - MARGIN) {
      doc.addPage({ size: 'A4', layout: 'landscape' });
      y = MARGIN;
    }
    doc.rect(MARGIN, y, CONTENT_W, 22).fill('#f0f0ec');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
    doc.text('TOTAL', col.to, y + 6, { width: COL_WIDTHS.to, lineBreak: false });
    doc.text(`${rows.length} transfer${rows.length !== 1 ? 's' : ''}`, col.qty, y + 6, { width: COL_WIDTHS.qty + COL_WIDTHS.by, lineBreak: false });
    doc.text(formatQtyStr(totalQty) + ' units', col.at, y + 6, { width: COL_WIDTHS.at + COL_WIDTHS.notes, lineBreak: false });
  }

  doc.end();
}));

function formatQtyStr(n) {
  return (n || 0).toLocaleString('en-IN');
}

module.exports = router;
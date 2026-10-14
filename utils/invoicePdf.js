// Gelco tax invoice PDF — the layout of Tally's own invoice (Sales_10023): A4 landscape, seller/buyer and a
// reference grid on top, item table with CGST/SGST per line, totals, amount in words, tax summary by rate,
// bank details, declaration. Helvetica has no ₹ glyph, so amounts print as "Rs.".
const { seller, buyer } = require('./invoiceParties');

const W = 841.89, H = 595.28, M = 22, CW = W - 2 * M;
const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => `${fmt(n)} pcs`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tallyDate = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-'); return `${Number(day)}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`; };

// Indian numbering: 31,648 → "Thirty One Thousand Six Hundred Forty Eight".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function threeDigits(n) { const h = Math.floor(n / 100), r = n % 100; return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' '); }
function words(n) {
  if (!n) return 'Zero';
  const parts = [];
  for (const [div, name] of [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']]) {
    const v = Math.floor(n / div);
    if (v) { parts.push(`${div === 1e7 ? words(v) : twoDigits(v)} ${name}`); n %= div; }
  }
  if (n) parts.push(threeDigits(n));
  return parts.join(' ');
}
function rupeesInWords(amount) {
  const r = Math.floor(amount + 1e-6), p = Math.round((amount - r) * 100);
  return `INR ${words(r)}${p ? ` and ${twoDigits(p)} paise` : ''} Only`;
}

// Item table columns (x, width, align).
const COLS = (() => {
  const spec = [['sl', 22, 'center'], ['desc', 196, 'left'], ['hsn', 52, 'left'], ['part', 46, 'left'], ['qty', 70, 'right'], ['rate', 40, 'right'], ['per', 24, 'center'],
    ['amount', 62, 'right'], ['taxable', 58, 'right'], ['cr', 26, 'center'], ['ca', 50, 'right'], ['sr', 26, 'center'], ['sa', 50, 'right'], ['total', 0, 'right']];
  const used = spec.reduce((s, c) => s + c[1], 0);
  spec[spec.length - 1][1] = CW - used;
  let x = M;
  return Object.fromEntries(spec.map(([k, w, a]) => { const c = { x, w, a }; x += w; return [k, c]; }));
})();

module.exports = function buildInvoicePdf(inv, res) {
  const PDFDocument = require('pdfkit'); // lazy: pdfkit is large, only load it when a PDF is asked for
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => res.end(Buffer.concat(chunks)));
  doc.lineWidth(0.5).strokeColor('#000');

  const txt = (s, x, y, w, opts = {}) => doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 7.5).fillColor('#000')
    .text(String(s ?? ''), x + 3, y, { width: w - 6, align: opts.align || 'left', lineBreak: opts.wrap ?? false, ellipsis: !opts.wrap });
  const rect = (x, y, w, h) => doc.rect(x, y, w, h).stroke();
  const cell = (k, s, y, opts) => txt(s, COLS[k].x, y, COLS[k].w, { align: COLS[k].a, ...opts });

  // ── Header ──────────────────────────────────────────────────────────────
  txt('Tax Invoice', M, M - 12, CW, { bold: true, size: 10, align: 'center' });
  if (inv.missing_rates) txt(`DRAFT — ${inv.missing_rates} item(s) have no rate yet`, M, M - 12, CW, { bold: true, align: 'right', size: 8 });
  const top = M + 2, leftW = 380, rightW = CW - leftW, rowH = 22;
  // Seller
  let y = top + 3;
  txt(seller.name, M, y, leftW, { bold: true, size: 8.5 }); y += 11;
  for (const l of seller.lines) { txt(l, M, y, leftW); y += 9.5; }
  txt(`GSTIN/UIN: ${seller.gstin}`, M, y, leftW); y += 9.5;
  txt(`State Name : ${seller.state}, Code : ${seller.stateCode}`, M, y, leftW); y += 9.5;
  txt(`E-Mail : ${seller.email}`, M, y, leftW); y += 11;
  doc.moveTo(M, y).lineTo(M + leftW, y).stroke();
  // Buyer
  y += 3;
  txt('Buyer (Bill to)', M, y, leftW); y += 10;
  txt(buyer.name, M, y, leftW, { bold: true, size: 8.5 }); y += 11;
  for (const l of buyer.lines) { txt(l, M, y, leftW); y += 9.5; }
  txt(`GSTIN/UIN              : ${buyer.gstin}`, M, y, leftW); y += 9.5;
  txt(`State Name             : ${buyer.state}, Code : ${buyer.stateCode}`, M, y, leftW); y += 9.5;
  // Reference grid
  const grid = [['Invoice No.', inv.invoice_no, 'Dated', tallyDate(inv.invoice_date)], ['Delivery Note', '', 'Mode/Terms of Payment', ''], ['Reference No. & Date.', '', 'Other References', ''],
    ["Buyer's Order No.", '', 'Dated', ''], ['Dispatch Doc No.', '', 'Delivery Note Date', ''], ['Dispatched through', '', 'Destination', '']];
  const gx = M + leftW, half = rightW / 2;
  grid.forEach(([l1, v1, l2, v2], i) => {
    const gy = top + i * rowH;
    rect(gx, gy, half, rowH); rect(gx + half, gy, half, rowH);
    txt(l1, gx, gy + 2, half); txt(v1, gx, gy + 11, half, { bold: true });
    txt(l2, gx + half, gy + 2, half); txt(v2, gx + half, gy + 11, half, { bold: true });
  });
  const headBottom = Math.max(y + 4, top + grid.length * rowH + 40);
  rect(gx, top + grid.length * rowH, rightW, headBottom - (top + grid.length * rowH));
  txt('Terms of Delivery', gx, top + grid.length * rowH + 2, rightW);
  rect(M, top, leftW, headBottom - top);

  // ── Item table ──────────────────────────────────────────────────────────
  const tableHead = (ty) => {
    rect(M, ty, CW, 24);
    // Rate|Amount dividers under CGST and SGST/UTGST start below their shared heading.
    for (const k of Object.keys(COLS)) if (k !== 'sl') doc.moveTo(COLS[k].x, k === 'ca' || k === 'sa' ? ty + 12 : ty).lineTo(COLS[k].x, ty + 24).stroke();
    const two = (k, a, b) => { cell(k, a, ty + 3, { bold: true }); cell(k, b, ty + 13, { bold: true }); };
    two('sl', 'Sl', 'No.'); cell('desc', 'Description of Goods', ty + 8, { bold: true, align: 'center' }); cell('hsn', 'HSN/SAC', ty + 8, { bold: true });
    cell('part', 'Part No.', ty + 8, { bold: true }); cell('qty', 'Quantity', ty + 8, { bold: true, align: 'center' }); cell('rate', 'Rate', ty + 8, { bold: true, align: 'center' });
    cell('per', 'per', ty + 8, { bold: true }); cell('amount', 'Amount', ty + 8, { bold: true, align: 'center' }); two('taxable', 'Taxable', 'Value');
    txt('CGST', COLS.cr.x, ty + 3, COLS.cr.w + COLS.ca.w, { bold: true, align: 'center' }); txt('SGST/UTGST', COLS.sr.x, ty + 3, COLS.sr.w + COLS.sa.w, { bold: true, align: 'center' });
    doc.moveTo(COLS.cr.x, ty + 12).lineTo(COLS.total.x, ty + 12).stroke();
    cell('cr', 'Rate', ty + 14, { bold: true }); cell('ca', 'Amount', ty + 14, { bold: true, align: 'center' }); cell('sr', 'Rate', ty + 14, { bold: true }); cell('sa', 'Amount', ty + 14, { bold: true, align: 'center' });
    two('total', 'Total', 'Amount');
    return ty + 24;
  };
  const colLines = (y0, y1) => { for (const k of Object.keys(COLS)) if (k !== 'sl') doc.moveTo(COLS[k].x, y0).lineTo(COLS[k].x, y1).stroke(); doc.moveTo(M, y0).lineTo(M, y1).stroke(); doc.moveTo(M + CW, y0).lineTo(M + CW, y1).stroke(); };

  y = tableHead(headBottom);
  let bodyTop = y + 4;
  function nextPage() {
    colLines(bodyTop - 4, y + 2);
    doc.moveTo(M, y + 2).lineTo(M + CW, y + 2).stroke();
    txt('continued…', M, y + 5, CW, { align: 'right' });
    doc.addPage();
    txt(`Tax Invoice — Invoice No. ${inv.invoice_no} (continued)`, M, M - 12, CW, { bold: true, size: 9, align: 'center' });
    y = tableHead(M) + 4;
    bodyTop = y;
  }
  const LINE = 11, FOOTER_H = 190; // space the totals + summary + bank block need on the last page
  inv.lines.forEach((l, i) => {
    if (y + LINE > H - M - 20) nextPage();
    y += i === 0 ? 4 : 0;
    const g = l.gst_rate ?? 18;
    cell('sl', i + 1, y); cell('desc', l.description, y, { bold: true }); cell('hsn', l.hsn_code || '', y); cell('qty', qtyFmt(l.qty), y, { bold: true });
    cell('rate', l.rate ? fmt(l.rate) : '', y); cell('per', 'pcs', y); cell('amount', fmt(l.amount), y, { bold: true }); cell('taxable', fmt(l.amount), y);
    cell('cr', `${g / 2}%`, y); cell('ca', fmt(l.cgst), y); cell('sr', `${g / 2}%`, y); cell('sa', fmt(l.sgst), y); cell('total', fmt(l.total), y);
    y += LINE;
  });
  if (y + FOOTER_H > H - M) nextPage();
  // Subtotal + tax rows, as Tally prints them under the Amount column.
  y += 4; doc.moveTo(COLS.amount.x, y).lineTo(COLS.amount.x + COLS.amount.w, y).stroke(); y += 2;
  cell('amount', fmt(inv.taxable), y); y += LINE + 2;
  for (const [label, v] of [['CGST', inv.cgst], ['SGST', inv.sgst], ['Round Off', inv.round_off]]) { cell('desc', label, y, { bold: true, align: 'right' }); cell('amount', fmt(v), y, { bold: true }); y += LINE; }
  y += 2; colLines(bodyTop - 4, y);
  rect(M, y, CW, 13);
  colLines(y, y + 13);
  cell('desc', 'Total', y + 3, { align: 'right' }); cell('qty', qtyFmt(inv.qty), y + 3, { bold: true }); cell('amount', `Rs. ${fmt(inv.total)}`, y + 3, { bold: true });
  cell('taxable', fmt(inv.taxable), y + 3, { bold: true }); cell('ca', fmt(inv.cgst), y + 3, { bold: true }); cell('sa', fmt(inv.sgst), y + 3, { bold: true });
  y += 13;

  // ── Words + tax summary by rate ─────────────────────────────────────────
  rect(M, y, CW, 13);
  txt(`Amount Chargeable (in words)    ${rupeesInWords(inv.total)}`, M, y + 3, CW - 60, { bold: true });
  txt('E. & O.E', M, y + 3, CW, { align: 'right' });
  y += 13;
  const byRate = {};
  for (const l of inv.lines) { const g = l.gst_rate ?? 18; const b = (byRate[g] ||= { taxable: 0, cgst: 0, sgst: 0 }); b.taxable += l.amount; b.cgst += l.cgst; b.sgst += l.sgst; }
  const sx = COLS.amount.x - 50, sw = M + CW - sx;
  const scol = [[sx, 75], [sx + 75, 30], [sx + 105, 70], [sx + 175, 30], [sx + 205, 70], [sx + 275, sw - 275]];
  const sRow = (vals, yy, bold) => vals.forEach((v, i) => txt(v, scol[i][0], yy, scol[i][1], { bold, align: i === 1 || i === 3 ? 'center' : 'right' }));
  const rows = Object.entries(byRate);
  const sh = 24 + (rows.length + 1) * LINE + 4;
  rect(M, y, CW, sh);
  doc.moveTo(sx, y).lineTo(sx, y + sh).stroke();
  txt('Taxable', scol[0][0], y + 3, scol[0][1], { align: 'center' }); txt('Value', scol[0][0], y + 12, scol[0][1], { align: 'center' });
  txt('CGST', scol[1][0], y + 3, 100, { align: 'center' }); txt('SGST/UTGST', scol[3][0], y + 3, 100, { align: 'center' });
  txt('Rate', scol[1][0], y + 13, 30, { align: 'center' }); txt('Amount', scol[2][0], y + 13, 70, { align: 'center' }); txt('Rate', scol[3][0], y + 13, 30, { align: 'center' }); txt('Amount', scol[4][0], y + 13, 70, { align: 'center' });
  txt('Total', scol[5][0], y + 3, scol[5][1], { align: 'center' }); txt('Tax Amount', scol[5][0], y + 12, scol[5][1], { align: 'center' });
  doc.moveTo(sx, y + 23).lineTo(M + CW, y + 23).stroke();
  let yy = y + 26;
  for (const [g, b] of rows) { sRow([fmt(b.taxable), `${g / 2}%`, fmt(b.cgst), `${g / 2}%`, fmt(b.sgst), fmt(b.cgst + b.sgst)], yy); yy += LINE; }
  txt('Total:', sx - 60, yy, 60, { bold: true, align: 'right' });
  sRow([fmt(inv.taxable), '', fmt(inv.cgst), '', fmt(inv.sgst), fmt(inv.cgst + inv.sgst)], yy, true);
  y += sh;

  // ── Tax in words, bank, declaration, signature ──────────────────────────
  const fh = 78;
  rect(M, y, CW, fh);
  txt(`Tax Amount (in words) :   ${rupeesInWords(inv.cgst + inv.sgst)}`, M, y + 4, CW / 2, { bold: true });
  const bx = M + CW / 2;
  txt("Company's Bank Details", bx, y + 16, CW / 2);
  [['Bank Name', seller.bank.name], ['A/c No.', seller.bank.account], ['Branch & IFS Code', seller.bank.branch]].forEach(([k, v], i) => {
    txt(k, bx, y + 26 + i * 9, 110); txt(`:  ${v}`, bx + 110, y + 26 + i * 9, 200, { bold: true });
  });
  txt('Declaration', M, y + fh - 26, CW / 2);
  txt('We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', M, y + fh - 17, CW / 2 - 10, { wrap: true, size: 7 });
  txt(`for ${seller.name}`, bx, y + fh - 26, CW / 2, { bold: true, align: 'right' });
  txt('Authorised Signatory', bx, y + fh - 10, CW / 2, { align: 'right' });
  txt('This is a Computer Generated Invoice', M, y + fh + 4, CW, { align: 'center' });
  doc.end();
};
module.exports.rupeesInWords = rupeesInWords;

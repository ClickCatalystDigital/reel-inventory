// utils/qr.js
const QRCode = require('qrcode');

// Strip REEL- prefix so QR encodes just the number
function stripPrefix(text) {
  return text.replace('REEL-', '').replace('BOX-', '');
}

// Draw the QR straight into the PDF as filled squares (one rect per horizontal run of dark modules).
// Replaces rendering a 200px PNG per label and having pdfkit decode/re-compress it: that cost ~3 ms CPU
// per label (a 150-reel batch blew the Workers CPU limit); this is a few hundred rects, ~0.1 ms.
// Keeps the old look: 1-module quiet zone inside `size`.
function drawQR(doc, text, x, y, size) {
  const m = QRCode.create(stripPrefix(text)).modules;
  const n = m.size;
  const cell = size / (n + 2);
  for (let r = 0; r < n; r++) {
    let start = -1;
    for (let c = 0; c <= n; c++) {
      const dark = c < n && m.get(r, c);
      if (dark && start < 0) start = c;
      else if (!dark && start >= 0) {
        doc.rect(x + (start + 1) * cell, y + (r + 1) * cell, (c - start) * cell, cell);
        start = -1;
      }
    }
  }
  doc.fillColor('#000000').fill();
}

module.exports = { drawQR };

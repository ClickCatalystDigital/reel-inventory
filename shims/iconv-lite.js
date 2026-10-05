// body-parser -> raw-body -> iconv-lite breaks when bundled for Workers, and every request
// body this API receives is UTF-8 anyway. Wired in via "alias" in wrangler.jsonc.
const utf8 = (e) => !e || /^utf-?8$/i.test(e);
module.exports = {
  encodingExists: utf8,
  decode: (buf) => new TextDecoder().decode(buf),
  getDecoder() {
    const d = new TextDecoder();
    return { write: (b) => d.decode(b, { stream: true }), end: () => d.decode() };
  },
};

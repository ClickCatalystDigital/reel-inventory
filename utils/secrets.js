// Secret-at-rest encryption with WebCrypto AES-256-GCM (available in Workers and Node). The key is the
// Worker secret SETTINGS_ENC_KEY (32 random bytes, base64), so a database leak alone exposes nothing.
// Stored format: base64( iv(12) | ciphertext+tag ). Fails closed: never falls back to plaintext.
const toB64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function getKey() {
  const raw = process.env.SETTINGS_ENC_KEY;
  if (!raw) throw new Error('SETTINGS_ENC_KEY is not set');
  const bytes = fromB64(raw);
  if (bytes.length !== 32) throw new Error('SETTINGS_ENC_KEY must be 32 bytes, base64-encoded');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptSecret(plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return toB64(out);
}

async function decryptSecret(encoded) {
  const all = fromB64(encoded);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await getKey(), all.slice(12));
  return new TextDecoder().decode(pt);
}

module.exports = { encryptSecret, decryptSecret };

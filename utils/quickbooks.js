// utils/quickbooks.js — QuickBooks Online connection for the North American public demo only (OAuth 2.0
// authorization code, token refresh, revoke, read calls). Pure parts: utils/quickbooks-core.js. Routes: routes/quickbooks.js.
// Ported from structonova-ops (lib/quickbooks.js), cut down to the demo: one connection per demo site, kept in the demo's
// R2 bucket (DEMO_FILES, key quickbooks/<site host>/connection.json) because the demo database is rebuilt nightly and
// Intuit hands back a new refresh token on every refresh. A conditional put (etag) keeps two refreshes from overwriting
// each other. Tokens are encrypted with utils/secrets.js (SETTINGS_ENC_KEY).
//
// Turned on only with QBO_CLIENT_ID + QBO_CLIENT_SECRET set, DEMO_MODE=1 and MARKET=NA.
// ponytail: demo-only; a live deployment would need a table instead of R2.
const { encryptSecret, decryptSecret } = require('./secrets');
const { NA } = require('./market');
const { QBO_TOKEN_URL, QBO_REVOKE_URL, QBO_API_BASE, QBO_MINOR_VERSION, tokenTimes, needsRefresh } = require('./quickbooks-core');

function qboConfig() {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret || !NA || process.env.DEMO_MODE !== '1') return null;
  return { clientId, clientSecret, environment: process.env.QBO_ENV === 'production' ? 'production' : 'sandbox' };
}

// `site` = the request's host (req.get('host')); passed down rather than kept in a global, since requests overlap.
const redirectUri = (site) => process.env.QBO_REDIRECT_URI || `https://${site}/api/quickbooks/callback`;

// ---------- storage ----------
function bucket() {
  if (!globalThis.DEMO_FILES) throw new Error('Demo storage is not set up');
  return globalThis.DEMO_FILES;
}
// Every demo shares one bucket: the site's host keeps their records apart.
const key = (site, file = 'connection') => `quickbooks/${site}/${file}.json`;

async function loadRecord(site, file) {
  const obj = await bucket().get(key(site, file));
  return obj ? { data: JSON.parse(await obj.text()), version: obj.etag } : null;
}
// Saves only if nobody changed the record since `version` was read (falsy = overwrite).
async function saveRecord(site, data, version, file) {
  const opts = { httpMetadata: { contentType: 'application/json' } };
  if (version) opts.onlyIf = { etagMatches: version };
  return !!(await bucket().put(key(site, file), JSON.stringify(data), opts));
}
// The send history (utils/quickbooks-sync.js): one JSON document per site beside the connection, in R2 so it
// survives the nightly reset (seeded invoices must not be sent again). null when nothing was sent yet.
const loadSyncDoc = (site) => loadRecord(site, 'sync');
// false = someone saved since `version` (read-modify-write again).
const saveSyncDoc = (site, data, version) => saveRecord(site, data, version, 'sync');

// ---------- Intuit token endpoint ----------
async function tokenCall(url, body, cfg) {
  const revoke = url === QBO_REVOKE_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
      Accept: 'application/json',
      'Content-Type': revoke ? 'application/json' : 'application/x-www-form-urlencoded',
    },
    body: revoke ? JSON.stringify(body) : new URLSearchParams(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* revoke returns an empty body */ }
  if (!res.ok) throw Object.assign(new Error(json?.error_description || json?.error || `QuickBooks returned ${res.status}`), { code: json?.error });
  return json;
}

const tokenFields = async resp => ({
  access_token_enc: await encryptSecret(resp.access_token),
  refresh_token_enc: await encryptSecret(resp.refresh_token),
  ...tokenTimes(resp),
});

async function completeConnection({ site, code, realmId, user }) {
  const cfg = qboConfig();
  if (!cfg) throw new Error('QuickBooks is not set up on this server');
  const existing = await loadRecord(site);
  if (existing?.data?.status === 'connected' && existing.data.realm_id !== String(realmId)) {
    throw new Error('Already connected to a different QuickBooks company. Disconnect it first.');
  }
  const resp = await tokenCall(QBO_TOKEN_URL, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(site) }, cfg);
  await saveRecord(site, {
    realm_id: String(realmId), environment: cfg.environment, status: 'connected', ...(await tokenFields(resp)),
    connected_by: user.username, connected_at: new Date().toISOString(), last_error: null,
    account_map: existing?.data?.realm_id === String(realmId) ? existing.data.account_map || {} : {},
  });
}

// Public view of the record: never tokens.
async function connectionStatus(site) {
  const rec = await loadRecord(site);
  if (!rec) return { status: 'not_connected' };
  const { status, realm_id, environment, connected_by, connected_at, refresh_expires_at, last_error, account_map } = rec.data;
  return { status, realm_id, environment, connected_by, connected_at, refresh_expires_at, last_error, account_map: account_map || {} };
}

// A valid access token, refreshing it first when it is close to expiry; the new refresh token is saved in the same write.
async function accessToken(site) {
  const cfg = qboConfig();
  if (!cfg) throw new Error('QuickBooks is not set up on this server');
  for (let attempt = 0; attempt < 3; attempt++) {
    const rec = await loadRecord(site);
    if (!rec || rec.data.status !== 'connected') throw new Error('QuickBooks is not connected');
    if (!needsRefresh(rec.data)) return { token: await decryptSecret(rec.data.access_token_enc), conn: rec.data };
    let resp;
    try {
      resp = await tokenCall(QBO_TOKEN_URL, { grant_type: 'refresh_token', refresh_token: await decryptSecret(rec.data.refresh_token_enc) }, cfg);
    } catch (err) {
      if (err.code !== 'invalid_grant') throw err;
      // Someone else may have refreshed with this token a moment ago; only give up if the record is unchanged.
      if ((await loadRecord(site))?.version !== rec.version) continue;
      await saveRecord(site, { ...rec.data, status: 'disconnected', access_token_enc: null, refresh_token_enc: null,
        last_error: 'QuickBooks refused the saved sign-in (revoked or expired). Reconnect.' }, rec.version);
      throw new Error('QuickBooks connection was revoked or expired. Reconnect it from Settings > Integrations.');
    }
    const data = { ...rec.data, ...(await tokenFields(resp)), last_error: null };
    if (await saveRecord(site, data, rec.version)) return { token: resp.access_token, conn: data };
  }
  throw new Error('Could not refresh the QuickBooks connection; try again');
}

// Call the Accounting API (GET, or POST with a JSON body). 401 → one forced refresh and retry.
async function qboCall(site, method, path, { params = {}, body } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { token, conn } = await accessToken(site);
    const q = new URLSearchParams({ ...params, minorversion: QBO_MINOR_VERSION });
    const res = await fetch(`${QBO_API_BASE[conn.environment]}/v3/company/${conn.realm_id}${path}?${q}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      const rec = await loadRecord(site);
      if (rec) await saveRecord(site, { ...rec.data, access_expires_at: null }, rec.version);
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const fault = json?.Fault?.Error?.[0];
      throw new Error(fault ? `${fault.Message}${fault.Detail ? `: ${fault.Detail}` : ''}` : `QuickBooks returned ${res.status}`);
    }
    return json;
  }
  throw new Error('QuickBooks rejected the connection');
}
const qboGet = (site, path, params = {}) => qboCall(site, 'GET', path, { params });

const qboAccounts = (site) => qboGet(site, '/query', { query: 'select * from Account where Active = true maxresults 1000' });

async function saveAccountMap(site, rows) {
  const rec = await loadRecord(site);
  if (!rec || rec.data.status !== 'connected') throw new Error('QuickBooks is not connected');
  const map = { ...(rec.data.account_map || {}) };
  for (const r of rows) { if (r.qbo_account_id) map[r.code] = r.qbo_account_id; else delete map[r.code]; }
  if (!(await saveRecord(site, { ...rec.data, account_map: map }, rec.version))) throw new Error('Someone else changed the connection; reload and try again');
  return map;
}

// Revoke at Intuit (best-effort: it may already be disconnected on QuickBooks' side), then forget the record.
async function disconnect(site) {
  const cfg = qboConfig();
  const rec = await loadRecord(site);
  if (!rec) return;
  if (cfg && rec.data.refresh_token_enc) {
    try { await tokenCall(QBO_REVOKE_URL, { token: await decryptSecret(rec.data.refresh_token_enc) }, cfg); } catch { /* already revoked */ }
  }
  await bucket().delete(key(site));
}

module.exports = { qboConfig, redirectUri, completeConnection, connectionStatus, qboCall, qboGet, qboAccounts, saveAccountMap, disconnect, loadSyncDoc, saveSyncDoc };

// Copied from shanti-ops. Deploy workflow: waits until <base>/api/version reports <commit>, then checks <path> answers.
//   node scripts/wait-for-commit.mjs https://example.com <sha> /login
const [base, sha, path = '/'] = process.argv.slice(2);
if (!base || !sha) throw new Error('usage: wait-for-commit.mjs <base-url> <commit> [path]');
const deadline = Date.now() + 25 * 60 * 1000; // generous: Cloudflare usually serves a new version within a minute
let last = '', blocked = 0;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(60000) });
    // ponytail: lstechnologies.in's Cloudflare security answers GitHub's runners with 403. wrangler deploy has already
    // confirmed the new version is active, so after 3 straight 403s pass with a warning instead of waiting 25 minutes.
    blocked = r.status === 403 ? blocked + 1 : 0;
    if (blocked >= 3) { console.log(`::warning::${base} answers this runner with 403 (site firewall); trusting wrangler deploy`); process.exit(0); }
    const v = r.ok ? (await r.json()).commit : `HTTP ${r.status}`;
    if (v === sha) {
      const page = await fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
      if (page.status >= 400) throw new Error(`${base}${path} answered ${page.status}`);
      console.log(`${base} serves ${sha.slice(0, 7)}; ${path} answered ${page.status}`);
      process.exit(0);
    }
    if (v !== last) console.log(`${base} serves ${v || 'unknown'}, waiting for ${sha.slice(0, 7)}`);
    last = v;
  } catch (e) {
    if (String(e.message).includes('answered')) throw e;
    console.log(`${base}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
throw new Error(`${base} did not serve ${sha} within 25 minutes`);

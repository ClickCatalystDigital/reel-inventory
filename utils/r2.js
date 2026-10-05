// R2 bucket binding (routes/gelco-docs.js uploads, routes/settings.js storage usage).
// worker.mjs copies env.BUCKET onto globalThis — a binding, not request state — because
// CommonJS modules here can't import 'cloudflare:workers' themselves.
module.exports = () => {
  if (!globalThis.R2_BUCKET) throw new Error('R2 bucket binding (BUCKET) is not configured');
  return globalThis.R2_BUCKET;
};

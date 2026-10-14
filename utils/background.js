// Keep work running after the response is sent (AI extraction, Telegram replies). On Workers that needs
// waitUntil — worker.mjs puts the request-scoped one from 'cloudflare:workers' on globalThis, since these
// CommonJS modules can't import it. In plain Node (scripts, tests) the promise just runs.
// ponytail: waitUntil allows ~30 s after the response; move to Queues if extractions start timing out.
module.exports = (promise) => {
  const p = Promise.resolve(promise).catch((err) => console.error('Background task failed:', err));
  if (globalThis.WAIT_UNTIL) globalThis.WAIT_UNTIL(p);
  return p;
};

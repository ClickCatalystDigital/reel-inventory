import { httpServerHandler } from 'cloudflare:node';
import { env, waitUntil } from 'cloudflare:workers';
import app from './app.js';
import auth from './utils/auth.js';

const { userFromHeaders, ROLE_PAGE_ALLOWLIST } = auth;

// Binding, not request state — see utils/r2.js.
globalThis.R2_BUCKET = env.BUCKET;
// Request-scoped (it finds the current request itself) — see utils/background.js.
globalThis.WAIT_UNTIL = waitUntil;

app.listen(8080); // the port is only a routing id for httpServerHandler
const api = httpServerHandler({ port: 8080 });

const json = (status, error) => Response.json({ error }, { status });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // www.<domain> is only an alias: send visitors (and any links) to the main address, keeping the path.
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    // Public: which commit this server runs (the deploy workflow checks it after each deploy; BUILD_COMMIT is
    // passed with --var at deploy time).
    if (pathname === '/api/version') return Response.json({ commit: env.BUILD_COMMIT || null });

    if (pathname.startsWith('/api/')) {
      // The demo has no password logins: everyone enters through /api/demo/enter.
      if (env.DEMO_MODE === '1' && pathname === '/api/login') return json(404, 'Not found');
      // Cap password guessing before spending CPU on bcrypt.
      if (pathname === '/api/login' && request.method === 'POST') {
        const key = request.headers.get('cf-connecting-ip') || 'unknown';
        if (!(await env.LOGIN_LIMITER.limit({ key })).success) {
          return json(429, 'Too many login attempts, try again in a minute');
        }
      }
      return api.fetch(request, env, ctx);
    }

    // Public demo (DEMO_MODE=1): visitors enter through /demo (lead form + role picker), never /login.
    const demo = env.DEMO_MODE === '1';
    const isDemoPage = demo && /^\/demo(\.txt|\/.*)?$/.test(pathname);
    if (demo && pathname === '/login') return Response.redirect(new URL('/demo', request.url), 302);
    // The staff guide names the real company and partner store; the demo must not serve it.
    if (demo && pathname === '/ls-tech-guide.html') return new Response('Not found', { status: 404 });

    // Pages are static files, but still gated here: the login page and favicon are
    // public, everything else needs a valid session and a page the role may open.
    if (pathname !== '/login' && pathname !== '/favicon.ico' && !isDemoPage) {
      const user = userFromHeaders((h) => request.headers.get(h));
      if (!user) return Response.redirect(new URL(demo ? '/demo' : '/login', request.url), 302);
      const rule = ROLE_PAGE_ALLOWLIST[user.role];
      // Next's client-side navigation fetches RSC payloads ('/stocks.txt', '/stocks/__next._tree.txt');
      // gate them as the page they belong to, or allowlisted roles get redirected mid-navigation.
      const page = pathname
        .replace(/\/__next\.[^/]*$/, '')
        .replace(/\.txt$/, '')
        .replace(/(.)\/$/, '$1') || '/'; // '/outward/' -> '/outward'
      if (rule && !rule.pages.includes(page)) {
        return Response.redirect(new URL(rule.redirectTo, request.url), 302);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

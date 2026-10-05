import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import app from './app.js';
import auth from './utils/auth.js';

const { userFromHeaders, ROLE_PAGE_ALLOWLIST } = auth;

// Binding, not request state — see utils/r2.js.
globalThis.R2_BUCKET = env.BUCKET;

app.listen(8080); // the port is only a routing id for httpServerHandler
const api = httpServerHandler({ port: 8080 });

const json = (status, error) => Response.json({ error }, { status });

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/api/')) {
      // Cap password guessing before spending CPU on bcrypt.
      if (pathname === '/api/login' && request.method === 'POST') {
        const key = request.headers.get('cf-connecting-ip') || 'unknown';
        if (!(await env.LOGIN_LIMITER.limit({ key })).success) {
          return json(429, 'Too many login attempts, try again in a minute');
        }
      }
      return api.fetch(request, env, ctx);
    }

    // Pages are static files, but still gated here: the login page and favicon are
    // public, everything else needs a valid session and a page the role may open.
    if (pathname !== '/login' && pathname !== '/favicon.ico') {
      const user = userFromHeaders((h) => request.headers.get(h));
      if (!user) return Response.redirect(new URL('/login', request.url), 302);
      const rule = ROLE_PAGE_ALLOWLIST[user.role];
      const page = pathname.replace(/(.)\/$/, '$1'); // '/outward/' -> '/outward'
      if (rule && !rule.pages.includes(page)) {
        return Response.redirect(new URL(rule.redirectTo, request.url), 302);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

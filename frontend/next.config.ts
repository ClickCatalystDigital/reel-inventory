import type { NextConfig } from "next";

// In production, Express is the only origin the browser ever talks to — it proxies
// specific page routes to this Next.js process, but /api/* always stays on Express
// and never reaches here. This rewrite only matters when running `next dev`
// standalone (its own port), so relative /api/* fetches from pages have somewhere
// to go without wiring up the full Express proxy first.
const EXPRESS_ORIGIN = process.env.EXPRESS_ORIGIN || "http://localhost:3000";

const nextConfig: NextConfig = {
  // frontend/ is an intentionally separate npm tree from the repo root (no
  // monorepo tooling — see the plan's non-goals) but both carry a lockfile,
  // which Next's root-inference otherwise warns about.
  turbopack: { root: __dirname },
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [{ source: "/api/:path*", destination: `${EXPRESS_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;

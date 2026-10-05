import type { NextConfig } from "next";

// Production is a static export served by the Cloudflare Worker (see ../wrangler.jsonc);
// /api/* is handled by the same Worker, so no rewrite is needed there. The rewrite below
// only matters for `next dev` on its own port, so relative /api/* fetches have somewhere to go.
const isProd = process.env.NODE_ENV === "production";
const API_ORIGIN = process.env.EXPRESS_ORIGIN || "http://localhost:8787"; // `wrangler dev`

const nextConfig: NextConfig = {
  // frontend/ is an intentionally separate npm tree from the repo root (no
  // monorepo tooling) but both carry a lockfile, which Next's root-inference
  // otherwise warns about.
  turbopack: { root: __dirname },
  ...(isProd && { output: "export" as const }),
  ...(!isProd && {
    async rewrites() {
      return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
    },
  }),
};

export default nextConfig;

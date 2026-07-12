const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 15: moved out of experimental.
  serverExternalPackages: ["better-sqlite3", "bcryptjs", "playwright", "pdfjs-dist", "mammoth", "epub2", "archiver"],
  // Pin the workspace root so Next doesn't pick up the stray ~/package-lock.json.
  outputFileTracingRoot: path.join(__dirname),
  // Middleware runs on the Node runtime via `runtime: "nodejs"` in
  // src/middleware.ts — needed so process.env is read at request time (the
  // edge runtime inlines env vars at build, which broke JWT verification in
  // CI). Node middleware is STABLE in Next 15.5: no experimental flag. The
  // old `experimental.nodeMiddleware` key now only triggers an "Unrecognized
  // key" warning — verified live (evil-Host 401 test) that enforcement is
  // identical without it. Don't re-add it.
  webpack: (config) => {
    config.externals.push({ "better-sqlite3": "commonjs better-sqlite3" });
    return config;
  },
  async redirects() {
    // v2 IA collapse: routes that no longer have a dedicated home in the new
    // five-destination rail forward to their new container. Detail pages
    // (e.g. /audit, /permissions, /mcp, /models) keep their URLs — they're
    // reached from the Settings/Fleet hubs or the ⌘K palette.
    return [
      { source: "/today",  destination: "/",                     permanent: false },
      { source: "/memory", destination: "/knowledge?tab=memory", permanent: false },
    ];
  },
  async headers() {
    if (process.env.NODE_ENV === "production") return [];
    // Development only: prevent the preview pane from serving stale cached
    // HTML pages, while leaving Next.js static chunks (/_next/static/*) to be
    // cached normally so styles/scripts load reliably inside the preview iframe.
    return [
      {
        source: "/((?!_next/static).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};
module.exports = nextConfig;

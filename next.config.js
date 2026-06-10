const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 15: moved out of experimental.
  serverExternalPackages: ["better-sqlite3", "bcryptjs", "playwright", "pdfjs-dist", "mammoth", "epub2", "archiver"],
  // Pin the workspace root so Next doesn't pick up the stray ~/package-lock.json.
  outputFileTracingRoot: path.join(__dirname),
  // Run middleware on the Node runtime so it can read process.env at request
  // time and use better-sqlite3-backed helpers if it ever needs them. The
  // edge runtime inlines env vars at build time, which made LOCALMIND_JWT_SECRET
  // unreadable in production builds where the build env didn't match the
  // runtime env — the symptom was every token failing to verify in CI.
  experimental: {
    nodeMiddleware: true,
  },
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

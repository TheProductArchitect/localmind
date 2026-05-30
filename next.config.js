/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "bcryptjs", "playwright", "pdfjs-dist", "mammoth", "epub2", "archiver"],
    instrumentationHook: true,
  },
  webpack: (config) => {
    config.externals.push({ "better-sqlite3": "commonjs better-sqlite3" });
    return config;
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

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
    // Development only: prevent the preview pane from serving stale cached pages.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};
module.exports = nextConfig;

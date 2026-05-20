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
};
module.exports = nextConfig;

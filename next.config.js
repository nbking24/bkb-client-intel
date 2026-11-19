/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Load these from node_modules at runtime instead of bundling them. The
    // HEIC decoder ships a WebAssembly build that bundling can break.
    serverComponentsExternalPackages: ['heic-convert', 'heic-decode', 'libheif-js', 'exceljs'],
  },
};
module.exports = nextConfig;

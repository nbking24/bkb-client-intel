/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
          serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    },
};
module.exports = nextConfig;

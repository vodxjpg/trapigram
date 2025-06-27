/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 👇 All Route Handlers will deploy as Node-js lambdas
    runtime: 'nodejs',
  },

  // --- whatever you already have -----------------
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;

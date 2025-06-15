/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Match all API routes
        source: '/api/:path*',
        headers: [
          // Only allow your exact front-end origins
          { key: 'Access-Control-Allow-Origin',      value: 'https://trapyfy.com' },
          { key: 'Access-Control-Allow-Methods',     value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers',     value: 'Content-Type,Authorization' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Max-Age',           value: '86400' },  // cache preflight for 24h
        ],
      },
    ]
  },
    eslint: {
      ignoreDuringBuilds: true, // Already set for --no-lint
    },
    typescript: {
      ignoreBuildErrors: true, // Ignore all TypeScript errors during build
    },
  };
  
  module.exports = nextConfig;
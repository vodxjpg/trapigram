/** @type {import('next').NextConfig} */
const nextConfig = {
    eslint: {
      ignoreDuringBuilds: true, // Already set for --no-lint
    },
    typescript: {
      ignoreBuildErrors: true, // Ignore all TypeScript errors during build
    },
  };
  
  module.exports = nextConfig;
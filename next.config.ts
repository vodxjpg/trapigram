/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // All Route Handlers deploy as Node-js lambdas
    runtime: "nodejs",
  },

  /* Image optimisation — allow Vercel Blob URLs */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
        pathname: "/**",
      },
    ],
  },

  /* ── unchanged build settings ─────────────────── */
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;

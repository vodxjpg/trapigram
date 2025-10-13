// next.config.mjs

// Normalize WORDPRESS_URL once so rewrites/images don't crash if you forget the scheme.
const RAW_WP_URL = process.env.WORDPRESS_URL ?? '';
const NORMALIZED_WP_URL = RAW_WP_URL
  ? (RAW_WP_URL.startsWith('http') ? RAW_WP_URL : `https://${RAW_WP_URL}`)
  : '';
const WP_HOST = NORMALIZED_WP_URL ? new URL(NORMALIZED_WP_URL).hostname : null;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ❌ Removed experimental.runtime — use per-route `export const runtime = 'nodejs'`
  //    in files that need Node (e.g., anything importing rate-limiter-flexible).

  /* Image optimisation — allow Vercel Blob URLs (+ WP media if configured) */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.public.blob.vercel-storage.com',
        pathname: '/**',
      },
      // Add WP media only when WORDPRESS_URL is present
      ...(WP_HOST
        ? [{
            protocol: 'https',
            hostname: WP_HOST,
            pathname: '/wp-content/**',
          }]
        : []),
    ],
  },

  /* Optional convenience: proxy WP API & media through your own origin */
  async rewrites() {
    if (!NORMALIZED_WP_URL) return [];
    return [
      { source: '/wp-json/:path*', destination: `${NORMALIZED_WP_URL}/wp-json/:path*` },
      { source: '/media/:path*',   destination: `${NORMALIZED_WP_URL}/wp-content/:path*` },
    ];
  },

  /* ── unchanged build settings ─────────────────── */
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;

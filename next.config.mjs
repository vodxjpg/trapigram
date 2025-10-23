// next.config.mjs

// Normalize WORDPRESS_URL once so rewrites/images don't crash if you forget the scheme.
const RAW_WP_URL = process.env.WORDPRESS_URL ?? "";
const NORMALIZED_WP_URL = RAW_WP_URL
  ? (RAW_WP_URL.startsWith("http") ? RAW_WP_URL : `https://${RAW_WP_URL}`)
  : "";
const WP_HOST = NORMALIZED_WP_URL ? new URL(NORMALIZED_WP_URL).hostname : null;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Put experimental flags you actually need here
  experimental: {
    // Ensure your CA bundle is traced into the serverless output for routes that need it
    outputFileTracingIncludes: {
      "/(dashboard)/niftipay/webhook/route": ["./certs/prod-ca-2021.crt"],
      "/(dashboard)/**": ["./certs/prod-ca-2021.crt"],
      "/api/**": ["./certs/prod-ca-2021.crt"],
      // add other segments if needed, e.g. "/(auth)/**": ["./certs/prod-ca-2021.crt"],
    },
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
        pathname: "/**",
      },
      ...(WP_HOST
        ? [
            {
              protocol: "https",
              hostname: WP_HOST,
              pathname: "/wp-content/**",
            },
          ]
        : []),
    ],
  },

  async rewrites() {
    if (!NORMALIZED_WP_URL) return [];
    return [
      { source: "/wp-json/:path*", destination: `${NORMALIZED_WP_URL}/wp-json/:path*` },
      { source: "/media/:path*", destination: `${NORMALIZED_WP_URL}/wp-content/:path*` },
    ];
  },

  // These two are what make the build not fail on lint/type errors:
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;

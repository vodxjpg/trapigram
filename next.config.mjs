// next.config.mjs

// Normalize WORDPRESS_URL once so rewrites/images don't crash if you forget the scheme.
const RAW_WP_URL = process.env.WORDPRESS_URL ?? "";
const NORMALIZED_WP_URL = RAW_WP_URL
  ? (RAW_WP_URL.startsWith("http") ? RAW_WP_URL : `https://${RAW_WP_URL}`)
  : "";
const WP_HOST = NORMALIZED_WP_URL ? new URL(NORMALIZED_WP_URL).hostname : null;

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // your tracing include (kept)
    outputFileTracingIncludes: {
      "/(dashboard)/niftipay/webhook/route": ["./certs/prod-ca-2021.crt"],
      "/(dashboard)/**": ["./certs/prod-ca-2021.crt"],
      "/api/**": ["./certs/prod-ca-2021.crt"],
      // "/(auth)/**": ["./certs/prod-ca-2021.crt"], // add more segments if needed
    },

    // requested experimental flags:
    browserDebugInfoInTerminal: true,
    devtoolSegmentExplorer: true,
    globalNotFound: true,
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

  // allow deploys to proceed despite lint/TS errors while you fix files
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;

// app/robots.ts
import type { MetadataRoute } from 'next';

function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * Robots are per-host. This file controls robots for www.trapyfy.com (your Next.js site).
 * It allows ONLY:
 *   • "/"
 *   • "/blog"
 *   • "/blog/*"
 * Everything else is disallowed.
 *
 * In non-production (Preview/Dev) we still disallow everything as a safety net.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://www.trapyfy.com'
  const isProd =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  if (!isProd) {
    // Disallow all on non-prod deployments
    return {
      rules: { userAgent: '*', disallow: '/' },
      sitemap: `${baseUrl}/sitemap.xml`,
      host: baseUrl,
    };
  }

  // Production: default Disallow all, then explicitly Allow only home + blog
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',                       // deny everything by default
        allow: [
          '/$',
          '/robots.txt',                         // ONLY the exact landing page "/"
          '/blog$',                          // the "/blog" index (no trailing slash)
          '/blog/',                          // "/blog/" and deeper
          '/blog/*',                         // any descendants under /blog/
          '/sitemap$',                          // the "/sitemap" index (no trailing slash)
          '/sitemap/',                          // "/sitemap/" and deeper
          '/sitemap/*',                         // any descendants under /blog/
          
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}

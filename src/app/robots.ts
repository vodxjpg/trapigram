// /home/zodx/Desktop/trapigram/src/app/robots.ts
import type { MetadataRoute } from 'next';
import { siteDetails } from '@/data/siteDetails';

/**
 * Robots policy:
 * - Block everything by default.
 * - Allow ONLY:
 *    • Homepage: "/"
 *    • Contact page: "/contact-us"
 *    • About page:   "/about-us"
 *    • Blog section: "/blog" and all children (e.g., "/blog/...").
 *
 * Notes:
 * - We use "Allow: /$" so only the root URL is allowed (Google/Bing support "$").
 * - If you later change page slugs, update the allow-list accordingly.
 * - Ensure your sitemap (if enabled) only lists allowed URLs.
 */
export default function robots(): MetadataRoute.Robots {
  const base =
    typeof siteDetails?.siteUrl === 'string'
      ? siteDetails.siteUrl.replace(/\/+$/, '')
      : '';

  return {
    rules: [
      {
        userAgent: '*',
        // Block everything first...
        disallow: ['/'],
        // ...then carve out the only allowed paths.
        // "/$" allows exactly the homepage, not every path starting with "/".
        allow: ['/$', '/contact-us', '/about-us', '/blog'],
      },
    ],
    sitemap: base ? `${base}/sitemap.xml` : undefined,
    host: base || undefined,
  };
}

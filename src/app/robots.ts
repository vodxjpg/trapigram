// /home/zodx/Desktop/trapigram/src/app/robots.ts
import type { MetadataRoute } from 'next';

/**
 * Robots policy:
 * - Disallow everything, then explicitly allow:
 *    • "/" (homepage only)
 *    • "/contact-us"
 *    • "/about-us"
 *    • "/blog" (and all descendants)
 *
 * Notes:
 * - Using "Allow: /$" restricts to exactly the root path.
 * - Keep this file PURE-STATIC (no imports/env) to avoid runtime build issues.
 * - If you want a sitemap, add the absolute URL once you have it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: ['/'],
        allow: ['/$', '/contact-us', '/about-us', '/blog'],
      },
    ],
    // Example (uncomment and set your absolute URL if desired):
    // sitemap: 'https://your-domain.com/sitemap.xml',
    // host: 'https://your-domain.com',
  };
}

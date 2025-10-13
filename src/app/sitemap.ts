// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { getLatestPostsSafe } from '@/lib/wp';

/**
 * Sitemap must include ONLY:
 *   • "/" (landing)
 *   • "/blog/:slug" (posts)
 * Note: XML `<loc>` entries are the URLs crawlers use; there are no <a> tags in XML sitemaps.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.trapyfy.com').replace(/\/+$/, '');

  // 1) landing page
  const entries: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: new Date() },
  ];

  // 2) blog posts (safe fetch – never throws)
  const posts = await getLatestPostsSafe(200);
  for (const p of posts) {
    entries.push({
      url: `${baseUrl}/blog/${p.slug}`,
      lastModified: new Date(p.date),
    });
  }

  return entries;
}

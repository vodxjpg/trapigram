// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { getLatestPostsSafe } from '@/lib/wp';

/**
 * Sitemap must contain ONLY:
 *   • "/" (landing)
 *   • "/blog/:slug" (posts)
 * XML sitemaps don't have clickable <a> tags; the <loc> URL is what crawlers read.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com').replace(/\/+$/, '');

  // Always include the landing page
  const entries: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: new Date() },
  ];

  // Add latest posts; if WP has an issue, we still return a valid sitemap
  const posts = await getLatestPostsSafe(200);
  for (const p of posts) {
    entries.push({
      url: `${baseUrl}/blog/${p.slug}`,
      lastModified: new Date(p.date),
    });
  }

  return entries;
}

// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { getLatestPostsSafe } from '@/lib/wp';

/**
 * Sitemap must only include:
 *   • "/" (landing)
 *   • "/blog/:slug" (each post)
 * Note: XML sitemaps don't support "clickable" <a> links—<loc> is the URL.
 * Browsers often make them clickable automatically.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl =
    (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.trapyfy.com').replace(/\/+$/, '');

  // Always include just the landing page
  const entries: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: new Date() },
  ];

  // Add blog posts (safe – never throws)
  const posts = await getLatestPostsSafe(200);
  for (const p of posts) {
    entries.push({
      url: `${baseUrl}/blog/${p.slug}`,
      lastModified: new Date(p.date),
    });
  }

  return entries;
}

// app/sitemap.xml/route.ts
import { getLatestPostsSafe } from '@/lib/wp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';    // don't prerender at build
export const revalidate = 0;               // runtime; we control caching via headers

function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export async function GET() {
  const baseUrl = getBaseUrl();

  const staticUrls = [
    { loc: `${baseUrl}/`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/blog`, lastmod: new Date().toISOString() },
  ];

  const posts = await getLatestPostsSafe(50);
  const postUrls = posts.map((p) => ({
    loc: `${baseUrl}/blog/${p.slug}`,
    lastmod: new Date(p.date).toISOString(),
  }));

  const urls = [...staticUrls, ...postUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Cache at the edge for an hour; allow stale for a day
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

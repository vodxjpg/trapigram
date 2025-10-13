// app/sitemap.xml/route.ts
import { getLatestPosts } from '@/lib/wp';

export const runtime = 'nodejs'; // ensure Node, avoid Edge limitations

function getBaseUrl(): string {
  // Prefer explicit, then Vercel-provided, then local dev.
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export async function GET() {
  const baseUrl = getBaseUrl();

  // Add your static routes here if needed
  const staticUrls = [
    { loc: `${baseUrl}/`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/blog`, lastmod: new Date().toISOString() },
  ];

  const posts = await getLatestPosts(50);
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
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}

// src/app/sitemap.xml/route.ts

import { getLatestPostsSafe } from "@/lib/wp";

export const revalidate = 600; // 10m

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Derive canonical base (protocol + host) from the incoming request to prevent
// host/env mismatches that can make the sitemap "not indexable/crawlable".
function getBaseFromRequest(req: Request) {
  const url = new URL(req.url);
  return url.origin.replace(/\/+$/, "");
}

function sitemapHeaders() {
  return {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
  };
}

export async function GET(req: Request) {
  const base = getBaseFromRequest(req);

  const rows: string[] = [];
  rows.push(
    `<url>
  <loc>${esc(`${base}/`)}</loc>
  <lastmod>${new Date().toISOString()}</lastmod>
</url>`
  );
  rows.push(
    `<url>
  <loc>${esc(`${base}/blog`)}</loc>
  <lastmod>${new Date().toISOString()}</lastmod>
</url>`
  );

  const posts = await getLatestPostsSafe(200);
  for (const p of posts) {
    const d = p?.date ? new Date(p.date) : new Date();
    const lastmod = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

    rows.push(
      `<url>
  <loc>${esc(`${base}/blog/${p.slug}`)}</loc>
  <lastmod>${esc(lastmod)}</lastmod>
</url>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join("\n")}
</urlset>`;

  return new Response(xml, { headers: sitemapHeaders() });
}

// Serve HEAD with identical headers (some crawlers request HEAD first)
export async function HEAD(req: Request) {
  // We don't need body; only headers matter for HEAD.
  return new Response(null, { headers: sitemapHeaders() });
}

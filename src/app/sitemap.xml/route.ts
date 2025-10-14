import { getLatestPostsSafe } from "@/lib/wp";

// Rebuild the sitemap every 10 minutes (literal number required)
export const revalidate = 600;

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.trapyfy.com")
    .replace(/\/+$/, "");

  const items: { loc: string; lastmod?: string }[] = [];

  // Landing
  items.push({ loc: `${baseUrl}/`, lastmod: new Date().toISOString() });

  // Blog index (optional — include if you want)
  items.push({ loc: `${baseUrl}/blog`, lastmod: new Date().toISOString() });

  // Posts
  const posts = await getLatestPostsSafe(200);
  for (const p of posts) {
    items.push({
      loc: `${baseUrl}/blog/${p.slug}`,
      lastmod: new Date(p.date).toISOString(),
    });
  }

  const urlsXml = items
    .map(
      (u) =>
        `<url>
  <loc>${escapeXml(u.loc)}</loc>${
    u.lastmod ? `\n  <lastmod>${escapeXml(u.lastmod)}</lastmod>` : ""
  }
</url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Cache at the edge; stale-while-revalidate is friendly for crawlers
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}

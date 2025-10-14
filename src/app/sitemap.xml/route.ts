import { getLatestPostsSafe } from "@/lib/wp";

export const revalidate = 600; // 10m

function esc(s: string) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

export async function GET() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.trapyfy.com").replace(/\/+$/,"");

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
    rows.push(
`<url>
  <loc>${esc(`${base}/blog/${p.slug}`)}</loc>
  <lastmod>${esc(new Date(p.date).toISOString())}</lastmod>
</url>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join("\n")}
</urlset>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}

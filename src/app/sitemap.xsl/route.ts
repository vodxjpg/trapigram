// src/app/sitemap.xsl/route.ts

export const dynamic = "force-static";
export const revalidate = 600;

function xslHeaders() {
  return {
    "Content-Type": "text/xsl; charset=utf-8", // important for some browsers
    "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
  };
}

export async function GET() {
  const xsl = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9">
  <xsl:output method="html" indent="yes" encoding="UTF-8"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <title>XML Sitemap</title>
        <style type="text/css"><![CDATA[
          body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; color:#111; background:#fff; margin:2rem; }
          .wrap { max-width: 980px; margin: 0 auto; }
          h1 { font-size: 1.875rem; margin: 0 0 0.75rem; }
          p  { margin: 0.5rem 0 1rem; color:#444; }
          table { width:100%; border-collapse: collapse; margin-top: 1rem; }
          th, td { border: 1px solid #e5e5e5; padding: 0.6rem 0.75rem; font-size: 0.95rem; }
          th { text-align:left; background:#fafafa; }
          tr:nth-child(even) td { background:#fcfcfc; }
          a { color:#2563eb; text-decoration:none; }
          a:hover { text-decoration:underline; }
          .count { font-weight:600; }
        ]]></style>
      </head>
      <body>
        <div class="wrap">
          <h1>XML Sitemap</h1>
          <p>This XML Sitemap lists your site's discoverable URLs.</p>
          <p><span class="count">Number of URLs in this XML Sitemap: </span>
            <xsl:value-of select="count(/s:urlset/s:url)"/>
          </p>
          <table>
            <thead>
              <tr><th>URL</th><th>Last Modified</th></tr>
            </thead>
            <tbody>
              <xsl:for-each select="/s:urlset/s:url">
                <tr>
                  <td>
                    <a>
                      <xsl:attribute name="href"><xsl:value-of select="s:loc"/></xsl:attribute>
                      <xsl:value-of select="s:loc"/>
                    </a>
                  </td>
                  <td><xsl:value-of select="s:lastmod"/></td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`;
  return new Response(xsl, { headers: xslHeaders() });
}

// Serve HEAD with the same headers
export async function HEAD() {
  return new Response(null, { headers: xslHeaders() });
}

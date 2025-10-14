// lib/wp.ts
import "server-only";

/**
 * Normalize WORDPRESS_URL:
 * - add https:// if missing
 * - preserve any sub-path (e.g. https://cms.trapyfy.com/blog)
 * - strip trailing slashes
 */
const RAW = process.env.WORDPRESS_URL;
if (!RAW) throw new Error("Missing WORDPRESS_URL (e.g. https://cms.trapyfy.com)");
const WP_BASE = (RAW.startsWith("http") ? RAW : `https://${RAW}`).replace(/\/+$/, "");

/** General revalidate (ISR) used by WP REST fetches */
const REVALIDATE_SECONDS = Number(process.env.WP_DEFAULT_REVALIDATE ?? 300);
/** Shorter cache just for Rank Math head so SEO changes reflect quickly */
const RANKMATH_REVALIDATE = Number(process.env.RANKMATH_REVALIDATE ?? 60);

type WpRawPost = {
  id: number;
  slug: string;
  date: string;
  link: string; // (WP permalink, e.g. https://cms.trapyfy.com/2025/10/my-post/)
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
  _embedded?: Record<string, any>;
};

export type Post = {
  id: number;
  slug: string;
  date: string;
  title: string;
  excerptHtml: string;
  contentHtml: string;
  featuredImageUrl?: string;
  authorName?: string;
  wpUrl: string; // ← add this to carry the WordPress permalink
};
function pickFeaturedImage(raw: WpRawPost): string | undefined {
  const media = raw?._embedded?.["wp:featuredmedia"]?.[0];
  return media?.source_url || media?.media_details?.sizes?.large?.source_url || undefined;
}
function pickAuthorName(raw: WpRawPost): string | undefined {
  const author = raw?._embedded?.author?.[0];
  return author?.name || undefined;
}
function mapPost(raw: WpRawPost): Post {
  return {
    id: raw.id,
    slug: raw.slug,
    date: raw.date,
    title: raw.title?.rendered ?? "",
    excerptHtml: raw.excerpt?.rendered ?? "",
    contentHtml: raw.content?.rendered ?? "",
    featuredImageUrl: pickFeaturedImage(raw),
    authorName: pickAuthorName(raw),
    wpUrl: raw.link, // ← map it
  };
}
/** Join against FULL base (origin + optional sub-path). Always pass a relative path. */
function wpJoin(relPath: string): string {
  const rel = relPath.replace(/^\/+/, ""); // preserve sub-path
  return `${WP_BASE}/${rel}`;
}

/** Generic fetch with optional per-call revalidate override */
async function wpFetch<T>(
  relPath: string,
  init?: RequestInit,
  revalidateSeconds: number = REVALIDATE_SECONDS
): Promise<{ data: T; headers: Headers }> {
  const url = wpJoin(relPath);
  const res = await fetch(url, {
    next: { revalidate: revalidateSeconds },
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP fetch failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as T;
  return { data, headers: res.headers };
}

/* ---------------------------- Posts (REST) ---------------------------- */

export async function getPosts(page = 1, perPage = 10): Promise<{
  posts: Post[];
  total: number;
  totalPages: number;
}> {
  const query = new URLSearchParams({
    _embed: "1",
    per_page: String(Math.min(20, Math.max(1, perPage))),
    page: String(Math.max(1, page)),
    orderby: "date",
    order: "desc",
  });
  const { data, headers } = await wpFetch<WpRawPost[]>(
    `wp-json/wp/v2/posts?${query.toString()}`
  );
  const total = Number(headers.get("X-WP-Total") ?? "0");
  const totalPages = Number(headers.get("X-WP-TotalPages") ?? "0");
  return { posts: data.map(mapPost), total, totalPages };
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const { data } = await wpFetch<WpRawPost[]>(
    `wp-json/wp/v2/posts?_embed=1&slug=${encodeURIComponent(slug)}`
  );
  if (!data.length) return null;
  return mapPost(data[0]);
}

/** Latest posts (for lists/sitemap). */
export async function getLatestPosts(limit = 50): Promise<Post[]> {
  const perPage = Math.min(100, Math.max(1, limit));
  const { data } = await wpFetch<WpRawPost[]>(
    `wp-json/wp/v2/posts?_embed=1&per_page=${perPage}&page=1&orderby=date&order=desc`
  );
  return data.map(mapPost);
}

/** Safe variant for sitemap: never throws, returns [] on any error. */
export async function getLatestPostsSafe(limit = 50): Promise<Post[]> {
  try {
    return await getLatestPosts(limit);
  } catch (err) {
    console.error("getLatestPostsSafe(): ignoring WP error in sitemap", err);
    return [];
  }
}

/* ----------------------- Rank Math (Headless) ------------------------ */
/**
 * Prefer OBJECT-BASED endpoint so Rank Math doesn't need to guess from your Next URL:
 *   GET /wp-json/rankmath/v1/getHead?objectID={id}&context=post
 * This reliably returns the post's meta title, description, and JSON-LD.
 */

export async function getRankMathHeadForWpUrl(wpUrl: string): Promise<string | null> {
  try {
    const { data } = await wpFetch<{ success: boolean; head?: string }>(
      `wp-json/rankmath/v1/getHead?url=${encodeURIComponent(wpUrl)}`,
      { headers: { Accept: "application/json" } },
      RANKMATH_REVALIDATE
    );
    return data?.head || null;
  } catch (e) {
    console.error("Rank Math getHead (wpUrl) failed:", e);
    return null;
  }
}

export async function getRankMathHeadByObjectId(
  objectId: number,
  context: "post" | "page" | "term" | "user" = "post"
): Promise<string | null> {
  try {
    const { data } = await wpFetch<{ success: boolean; head?: string }>(
      `wp-json/rankmath/v1/getHead?objectID=${objectId}&context=${context}`,
      { headers: { Accept: "application/json" } },
      RANKMATH_REVALIDATE
    );
    return data?.head || null;
  } catch (e) {
    console.error("Rank Math getHead by objectID failed:", e);
    return null;
  }
}

/**
 * URL-based fallback (works if Rank Math is configured to recognize your frontend URLs).
 */
export async function getRankMathHeadForSlug(slug: string): Promise<string | null> {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  if (!site) return null;
  try {
    const { data } = await wpFetch<{ success: boolean; head?: string }>(
      `wp-json/rankmath/v1/getHead?url=${encodeURIComponent(`${site}/blog/${slug}`)}`,
      { headers: { Accept: "application/json" } },
      RANKMATH_REVALIDATE
    );
    return data?.head || null;
  } catch (e) {
    console.error("Rank Math getHead by url (slug) failed:", e);
    return null;
  }
}

/** Extract title, description, and JSON-LD from Rank Math head HTML.
 * Falls back to og:/twitter: metas and finally JSON-LD graph.
 */
export function parseRankMathHead(headHtml: string | null): {
  title?: string;
  description?: string;
  jsonLd: string[];
} {
  if (!headHtml) return { jsonLd: [] };

  const getMeta = (nameOrProp: string, attr: "name" | "property" = "name") => {
    // Match either order of attributes: attr then content, or content then attr
    const re = new RegExp(
      `<meta\\s+[^>]*${attr}=["']${nameOrProp}["'][^>]*content=["']([^"']*)["'][^>]*>|` +
        `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${nameOrProp}["'][^>]*>`,
      "i"
    );
    const m = headHtml.match(re);
    return (m?.[1] || m?.[2] || "").trim() || undefined;
  };

  // Primary: <title>, Fallbacks: og:title → twitter:title → JSON-LD
  let title =
    headHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ||
    getMeta("og:title", "property") ||
    getMeta("twitter:title", "name");

  // Primary: <meta name="description">, Fallbacks: og:description → twitter:description → JSON-LD
  let description =
    getMeta("description", "name") ||
    getMeta("og:description", "property") ||
    getMeta("twitter:description", "name");

  // Collect JSON-LD (raw strings)
  const jsonLd: string[] = [];
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRegex.exec(headHtml)) !== null) {
    const raw = sm[1].trim();
    if (raw) jsonLd.push(raw);
  }

  // Final fallback: try to read headline/name/description from JSON-LD graph
  if ((!title || !description) && jsonLd.length) {
    for (const raw of jsonLd) {
      try {
        const node = JSON.parse(raw);
        const objs: any[] = Array.isArray(node)
          ? node
          : node["@graph"]
          ? node["@graph"]
          : [node];

        for (const o of objs) {
          if (!title && (o?.headline || o?.name)) title = (o.headline || o.name).toString();
          if (!description && o?.description) description = String(o.description);
        }
      } catch {
        /* ignore malformed JSON-LD */
      }
      if (title && description) break;
    }
  }

  return { title, description, jsonLd };
}

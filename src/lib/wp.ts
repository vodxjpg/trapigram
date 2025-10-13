// lib/wp.ts
import 'server-only';

const RAW = process.env.WORDPRESS_URL;
if (!RAW) throw new Error('Missing WORDPRESS_URL (e.g. https://cms.trapyfy.com)');

// Keep protocol and any sub-path (e.g. https://cms.trapyfy.com/blog)
const WP_BASE = (RAW.startsWith('http') ? RAW : `https://${RAW}`).replace(/\/+$/, '');
const REVALIDATE_SECONDS = Number(process.env.WP_DEFAULT_REVALIDATE ?? 300);

type WpRawPost = {
  id: number;
  slug: string;
  date: string;
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
};

function pickFeaturedImage(raw: WpRawPost): string | undefined {
  const media = raw?._embedded?.['wp:featuredmedia']?.[0];
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
    title: raw.title?.rendered ?? '',
    excerptHtml: raw.excerpt?.rendered ?? '',
    contentHtml: raw.content?.rendered ?? '',
    featuredImageUrl: pickFeaturedImage(raw),
    authorName: pickAuthorName(raw),
  };
}

async function wpFetch<T>(
  relPath: string,
  init?: RequestInit
): Promise<{ data: T; headers: Headers }> {
  // RELATIVE join (no leading slash) so sub-path bases are preserved
  const rel = relPath.replace(/^\/+/, '');
  const url = new URL(rel, WP_BASE + '/').toString();

  const res = await fetch(url, {
    next: { revalidate: REVALIDATE_SECONDS },
    ...init,
    headers: {
      Accept: 'application/json',
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
    _embed: '1',
    per_page: String(Math.min(20, Math.max(1, perPage))),
    page: String(Math.max(1, page)),
    orderby: 'date',
    order: 'desc',
  });
  const { data, headers } = await wpFetch<WpRawPost[]>(
    `wp-json/wp/v2/posts?${query.toString()}`
  );
  const total = Number(headers.get('X-WP-Total') ?? '0');
  const totalPages = Number(headers.get('X-WP-TotalPages') ?? '0');
  return { posts: data.map(mapPost), total, totalPages };
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const { data } = await wpFetch<WpRawPost[]>(
    `wp-json/wp/v2/posts?_embed=1&slug=${encodeURIComponent(slug)}`
  );
  if (!data.length) return null;
  return mapPost(data[0]);
}

/** For sitemap: fetch up to `limit` latest posts. */
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
    console.error('getLatestPostsSafe(): ignoring WP error in sitemap', err);
    return [];
  }
}

/* ----------------------- Rank Math (Headless) ------------------------ */
/**
 * Rank Math exposes an endpoint that returns the full <head> HTML
 * (title, meta description, JSON-LD, etc.) for a given URL when
 * “Headless CMS Support” is enabled.
 *   GET {WP_BASE}/wp-json/rankmath/v1/getHead?url={absolute-url}
 * Docs: https://rankmath.com/kb/headless-cms-support/
 */
export async function getRankMathHeadForSlug(slug: string): Promise<string | null> {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  if (!site) return null;
  const targetUrl = `${site}/blog/${encodeURIComponent(slug)}`;
  try {
    const { data } = await wpFetch<{ success: boolean; head?: string }>(
      `wp-json/rankmath/v1/getHead?url=${encodeURIComponent(targetUrl)}`,
      { headers: { Accept: 'application/json' } }
    );
    return data?.head || null;
  } catch (e) {
    console.error('Rank Math getHead failed:', e);
    return null;
  }
}

/** Extracts <title>, <meta name="description">, and JSON-LD scripts from Rank Math head HTML. */
export function parseRankMathHead(headHtml: string | null): {
  title?: string;
  description?: string;
  jsonLd: string[]; // raw JSON strings
} {
  if (!headHtml) return { jsonLd: [] };
  const titleMatch = headHtml.match(/<title>([\s\S]*?)<\/title>/i);
  const descMatch = headHtml.match(
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i
  );
  const jsonLd: string[] = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRegex.exec(headHtml)) !== null) {
    const raw = m[1].trim();
    if (raw) jsonLd.push(raw);
  }
  return {
    title: titleMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
    jsonLd,
  };
}

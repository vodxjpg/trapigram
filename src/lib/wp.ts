// lib/wp.ts
import 'server-only';

const RAW_WP_URL = process.env.WORDPRESS_URL;
if (!RAW_WP_URL) {
  throw new Error('Missing WORDPRESS_URL env (e.g. https://cms.trapyfy.com)');
}

// Always ensure protocol and strip any path to keep an origin-only base
const NORMALIZED_WP = RAW_WP_URL.startsWith('http')
  ? RAW_WP_URL
  : `https://${RAW_WP_URL}`;
const WP_ORIGIN = new URL(NORMALIZED_WP).origin;

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

async function wpFetch<T>(path: string, init?: RequestInit): Promise<{ data: T; headers: Headers }> {
  // Accept both absolute paths ("/wp-json/...") and relative ones
  const url = new URL(path, WP_ORIGIN).toString();
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
  const { data, headers } = await wpFetch<WpRawPost[]>(`/wp-json/wp/v2/posts?${query.toString()}`);
  const total = Number(headers.get('X-WP-Total') ?? '0');
  const totalPages = Number(headers.get('X-WP-TotalPages') ?? '0');
  return { posts: data.map(mapPost), total, totalPages };
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const { data } = await wpFetch<WpRawPost[]>(`/wp-json/wp/v2/posts?_embed=1&slug=${encodeURIComponent(slug)}`);
  if (!data.length) return null;
  return mapPost(data[0]);
}

export async function getLatestPosts(limit = 50): Promise<Post[]> {
  const perPage = Math.min(100, Math.max(1, limit));
  const { data } = await wpFetch<WpRawPost[]>(
    `/wp-json/wp/v2/posts?_embed=1&per_page=${perPage}&page=1&orderby=date&order=desc`
  );
  return data.map(mapPost);
}

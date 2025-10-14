// app/(landing)/blog/[slug]/page.tsx
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getPostBySlug,
  getRankMathHeadForWpUrl,
  getRankMathHeadForSlug,
  parseRankMathHead,
} from "@/lib/wp";
import Toc from "./toc";

type Props = { params: { slug: string } };

export const dynamic = "force-static"; // ISR via fetch caching

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);
  if (!post) return {};

  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.trapyfy.com").replace(/\/+$/, "");
  const canonicalFrontend = `${site}/blog/${post.slug}`;

  const headHtml =
    (await getRankMathHeadForWpUrl(post.wpUrl)) ??
    (await getRankMathHeadForSlug(params.slug));

  const parsed = parseRankMathHead(headHtml);

  const title = parsed.title ?? stripHtml(post.title);
  const description =
    parsed.description ?? summarize(stripHtml(post.excerptHtml || post.title));

  // Prefer RM og image if present, else featured image
  const ogImageUrl = parsed.og?.image?.url || post.featuredImageUrl;
  const ogImages = ogImageUrl
    ? [
        {
          url: ogImageUrl,
          width: parsed.og?.image?.width,
          height: parsed.og?.image?.height,
          alt: parsed.og?.image?.alt,
        },
      ]
    : undefined;

  // Build "other" metas to include robots exactly as Rank Math provided
  const other: Record<string, string> = {};
  if (parsed.robots) other["robots"] = parsed.robots;

  return {
    title,
    description,
    alternates: { canonical: canonicalFrontend }, // keep canonical on the frontend domain
    openGraph: {
      title: parsed.og?.title || title,
      description: parsed.og?.description || description,
      url: canonicalFrontend,
      type: parsed.og?.type || "article",
      siteName: parsed.og?.siteName,
      publishedTime: parsed.og?.publishedTime || post.date,
      modifiedTime: parsed.og?.modifiedTime,
      images: ogImages,
    },
    twitter: {
      card: (parsed.twitter?.card as any) || "summary_large_image",
      title: parsed.twitter?.title || title,
      description: parsed.twitter?.description || description,
      images: ogImageUrl ? [ogImageUrl] : undefined,
    },
    other,
  };
}

export default async function PostPage({ params }: Props) {
  const post = await getPostBySlug(params.slug);
  if (!post) notFound();

  const headHtml =
    (await getRankMathHeadForWpUrl(post.wpUrl)) ??
    (await getRankMathHeadForSlug(params.slug));
  const parsed = parseRankMathHead(headHtml);

  // add ids to h2/h3 and collect ToC
  const enhanced = buildTocAndHtml(post.contentHtml);

  return (
    <article
      className="mx-auto max-w-6xl px-4 py-10"
      itemScope
      itemType="https://schema.org/Article"
    >
      <header className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold" itemProp="headline">
          {stripHtml(post.title)}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          <time dateTime={new Date(post.date).toISOString()} itemProp="datePublished">
            {formatDate(post.date)}
          </time>
          {post.authorName ? (
            <>
              {" · "}
              <span itemProp="author" itemScope itemType="https://schema.org/Person">
                <span itemProp="name">{post.authorName}</span>
              </span>
            </>
          ) : null}
        </p>

        {post.featuredImageUrl && (
          <figure className="mt-6">
            <img
              src={post.featuredImageUrl}
              alt=""
              className="w-full rounded-lg"
              loading="lazy"
              itemProp="image"
            />
          </figure>
        )}
      </header>

      {/* Inject ALL Rank Math JSON-LD schemas */}
      {parsed.jsonLd.map((json, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      ))}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main
          id="main-content"
          className="article-body max-w-none"
          itemProp="articleBody"
          dangerouslySetInnerHTML={{ __html: enhanced.html }}
        />
        <aside className="hidden lg:block">
          <Toc items={enhanced.toc} />
        </aside>
      </div>
    </article>
  );
}

/* ───────────────────── TOC builder + utils ───────────────────── */
type TocItem = { id: string; text: string; level: 2 | 3 };

function buildTocAndHtml(html: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const used = new Map<string, number>();
  const headingRe = /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi;

  const transformed = html.replace(headingRe, (m, levelStr, rawAttrs, inner) => {
    const level = Number(levelStr) as 2 | 3;
    const idMatch = rawAttrs.match(/\sid=["']([^"']+)["']/i);
    let id = idMatch?.[1];
    const text = stripHtml(inner).trim();

    if (!id) {
      const base = slugify(text);
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      id = count === 0 ? base : `${base}-${count + 1}`;
      rawAttrs = (rawAttrs || "").trim();
      rawAttrs = rawAttrs ? ` id="${id}" ${rawAttrs}` : ` id="${id}"`;
    }

    if (text) toc.push({ id, text, level });
    return `<h${level}${rawAttrs}>${inner}</h${level}>`;
  });

  return { html: transformed, toc };
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}
function summarize(text: string, max = 160): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// app/blog/[slug]/page.tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getPostBySlug,
  getRankMathHeadForSlug,
  parseRankMathHead,
} from '@/lib/wp';

type Props = { params: { slug: string } };

export const dynamic = 'force-static'; // use ISR via fetch() revalidate

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [post, headHtml] = await Promise.all([
    getPostBySlug(params.slug),
    getRankMathHeadForSlug(params.slug),
  ]);
  if (!post) return {};

  const parsed = parseRankMathHead(headHtml);
  const title = parsed.title ?? stripHtml(post.title);
  const description = parsed.description ?? summarize(stripHtml(post.excerptHtml || post.title));

  return {
    title,
    description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title,
      description,
      type: 'article',
      publishedTime: post.date,
      images: post.featuredImageUrl ? [{ url: post.featuredImageUrl }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: post.featuredImageUrl ? [post.featuredImageUrl] : undefined,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const [post, headHtml] = await Promise.all([
    getPostBySlug(params.slug),
    getRankMathHeadForSlug(params.slug),
  ]);
  if (!post) notFound();

  const parsed = parseRankMathHead(headHtml);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{stripHtml(post.title)}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {new Date(post.date).toLocaleDateString()}
          {post.authorName ? ` · ${post.authorName}` : ''}
        </p>
        {post.featuredImageUrl && (
          <img
            src={post.featuredImageUrl}
            alt=""
            className="mt-6 w-full rounded-lg"
            loading="lazy"
          />
        )}
      </header>

      {/* Inject Rank Math JSON-LD schema (safe to be in body) */}
      {parsed.jsonLd.map((json, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: json }}
        />
      ))}

      <div
        className="prose"
        dangerouslySetInnerHTML={{ __html: post.contentHtml }}
      />
    </article>
  );
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}
function summarize(text: string, max = 160): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

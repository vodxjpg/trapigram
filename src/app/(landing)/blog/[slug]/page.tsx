// app/blog/[slug]/page.tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPostBySlug } from '@/lib/wp';

type Props = { params: { slug: string } };

export const dynamic = 'force-static'; // we rely on ISR from fetch

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);
  if (!post) return {};
  const plainTitle = stripHtml(post.title);
  const description = summarize(stripHtml(post.excerptHtml || plainTitle));
  return {
    title: `${plainTitle} | Blog`,
    description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: plainTitle,
      description,
      type: 'article',
      publishedTime: post.date,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const post = await getPostBySlug(params.slug);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{stripHtml(post.title)}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {new Date(post.date).toLocaleDateString()}
          {post.authorName ? ` · ${post.authorName}` : ''}
        </p>
        {post.featuredImageUrl && (
          // Use <img> to avoid remotePatterns config; switch to <Image> later if you prefer
          <img
            src={post.featuredImageUrl}
            alt=""
            className="mt-6 w-full rounded-lg"
            loading="lazy"
          />
        )}
      </header>

      <div
        className="prose"
        // Consider sanitizing in production if your WP isn't fully trusted
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

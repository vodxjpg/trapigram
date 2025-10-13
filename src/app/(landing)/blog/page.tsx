// app/blog/page.tsx
import Link from 'next/link';
import { getPosts } from '@/lib/wp';

type Props = {
  searchParams?: { page?: string };
};

export const dynamic = 'force-static'; // with revalidate on fetch (ISR)

export default async function BlogIndex({ searchParams }: Props) {
  const currentPage = Number(searchParams?.page ?? '1') || 1;
  const { posts, totalPages } = await getPosts(currentPage, 10);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-8 text-3xl font-bold">Blog</h1>

      <ul className="space-y-8">
        {posts.map((post) => (
          <li key={post.id} className="border-b pb-6">
            <h2 className="text-2xl font-semibold">
              <Link href={`/blog/${post.slug}`} className="hover:underline">
                {/* title is HTML-escaped by WP already, but we treat as text here */}
                {stripHtml(post.title)}
              </Link>
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {new Date(post.date).toLocaleDateString()}
              {post.authorName ? ` · ${post.authorName}` : ''}
            </p>
            <div
              className="prose mt-4"
              dangerouslySetInnerHTML={{ __html: post.excerptHtml }}
            />
            <div className="mt-3">
              <Link href={`/blog/${post.slug}`} className="text-blue-600 hover:underline">
                Read more →
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-between">
          <PaginationLink
            disabled={currentPage <= 1}
            href={`/blog?page=${currentPage - 1}`}
            label="← Newer"
          />
          <span className="text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </span>
          <PaginationLink
            disabled={currentPage >= totalPages}
            href={`/blog?page=${currentPage + 1}`}
            label="Older →"
          />
        </nav>
      )}
    </main>
  );
}

function PaginationLink({ disabled, href, label }: { disabled: boolean; href: string; label: string }) {
  if (disabled) return <span className="text-gray-400">{label}</span>;
  return (
    <Link href={href} className="text-blue-600 hover:underline">
      {label}
    </Link>
  );
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

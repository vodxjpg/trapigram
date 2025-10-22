// app/(landing)/blog/page.tsx
import Link from "next/link";
import { getPosts } from "@/lib/wp";

type SearchParams = Promise<{ page?: string }>;

export const dynamic = "force-static"; // rely on fetch revalidate (ISR)

const PER_PAGE = 10;

export default async function BlogIndex({
  searchParams,
}: { searchParams?: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const currentPage = Math.max(1, Number(sp.page ?? "1") || 1);

  const { posts, totalPages } = await getPosts(currentPage, PER_PAGE);

  const [hero1, hero2, ...rest] = posts;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Blog</h1>

      {(hero1 || hero2) && (
        <section className="grid gap-4 md:grid-cols-2">
          {hero1 && <HeroTile key={hero1.id} post={hero1} priority />}
          {hero2 && <HeroTile key={hero2.id} post={hero2} />}
        </section>
      )}

      {rest.length > 0 && (
        <section className="mt-8">
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {rest.map((post) => (
              <li key={post.id}>
                <CardTile post={post} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hero1 && (
        <p className="mt-6 text-sm text-gray-500">No posts published yet.</p>
      )}

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-10 flex items-center justify-between"
        >
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

/* ───────────────────── Components ───────────────────── */

function HeroTile({
  post,
  priority = false,
}: {
  post: {
    id: number;
    slug: string;
    title: string;
    date: string;
    authorName?: string;
    featuredImageUrl?: string;
    excerptHtml: string;
  };
  priority?: boolean;
}) {
  const title = stripHtml(post.title);
  const alt = title || "Blog post";
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group relative block overflow-hidden rounded-2xl"
    >
      {post.featuredImageUrl ? (
        <img
          src={post.featuredImageUrl}
          alt={alt}
          className="h-64 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] md:h-80"
          loading={priority ? "eager" : "lazy"}
        />
      ) : (
        <div className="flex h-64 w-full items-end bg-gradient-to-br from-gray-900 to-gray-700 md:h-80">
          <div className="sr-only">{alt}</div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <h2 className="line-clamp-2 text-2xl font-semibold md:text-3xl">
          {title}
        </h2>
        <p className="mt-2 text-xs text-white/80">
          {formatDate(post.date)}
          {post.authorName ? ` · ${post.authorName}` : ""}
        </p>
      </div>
    </Link>
  );
}

function CardTile({
  post,
}: {
  post: {
    slug: string;
    title: string;
    date: string;
    authorName?: string;
    featuredImageUrl?: string;
    excerptHtml: string;
  };
}) {
  const title = stripHtml(post.title);
  const excerpt = truncate(stripHtml(post.excerptHtml || ""), 140);
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group block overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-md dark:border-white/10 dark:bg-neutral-900"
    >
      <div className="aspect-[16/9] w-full overflow-hidden">
        {post.featuredImageUrl ? (
          <img
            src={post.featuredImageUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full bg-neutral-200 dark:bg-neutral-800" />
        )}
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 text-lg font-semibold leading-snug">
          {title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">
          {excerpt}
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          {formatDate(post.date)}
          {post.authorName ? ` · ${post.authorName}` : ""}
        </p>
      </div>
    </Link>
  );
}

function PaginationLink({
  disabled,
  href,
  label,
}: {
  disabled: boolean;
  href: string;
  label: string;
}) {
  if (disabled)
    return (
      <span className="rounded-md border px-3 py-1.5 text-sm text-gray-400 dark:border-white/10">
        {label}
      </span>
    );
  return (
    <Link
      href={href}
      className="rounded-md border px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 dark:border-white/10 dark:hover:bg-white/5"
    >
      {label}
    </Link>
  );
}

/* ───────────────────── Utils ───────────────────── */

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function truncate(text: string, max = 160): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

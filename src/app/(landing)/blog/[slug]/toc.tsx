"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type TocItem = { id: string; text: string; level: 2 | 3 };

export default function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const headingIds = useMemo(() => items.map((i) => i.id), [items]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!headingIds.length) return;

    const opts: IntersectionObserverInit = {
      // Trigger when heading is ~20% from top
      root: null,
      rootMargin: "0px 0px -80% 0px",
      threshold: [0, 1],
    };

    const cb: IntersectionObserverCallback = (entries) => {
      // Pick the entry closest to the top that is intersecting
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.boundingClientRect.top - a.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    };

    const obs = new IntersectionObserver(cb, opts);
    observerRef.current = obs;

    for (const id of headingIds) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [headingIds]);

  if (!items.length) return null;

  return (
    <nav aria-label="Table of contents" className="sticky top-24">
      <p className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
        On this page
      </p>
      <ul className="space-y-1 text-sm">
        {items.map((item) => (
          <li
            key={item.id}
            className={item.level === 3 ? "ml-4" : ""}
          >
            <TocLink id={item.id} active={active === item.id}>
              {item.text}
            </TocLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TocLink({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`#${id}`}
      className={[
        "block rounded px-2 py-1 transition-colors",
        active
          ? "bg-blue-50 text-blue-700 dark:bg-white/10 dark:text-white"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/5",
      ].join(" ")}
      onClick={(e) => {
        // Smooth scroll without changing focus
        e.preventDefault();
        const el = document.getElementById(id);
        if (el) {
          window.history.replaceState(null, "", `#${id}`);
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }}
    >
      {children}
    </Link>
  );
}

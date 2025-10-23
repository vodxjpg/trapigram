// src/app/(dashboard)/affiliates/levels/[id]/page.tsx
import { notFound } from "next/navigation";
import { ClientEditLevelPage } from "./page-client";

export const metadata = { title: "Edit Affiliate Level" };

export default async function EditLevelPage({
  // Next 15 expects a Promise here
  params,
}: {
  params?: Promise<{ id?: string }>;
}) {
  const p = (params ? await params : {}) as { id?: string };
  if (!p.id) return notFound();

  return <ClientEditLevelPage id={p.id} />;
}

// src/app/(dashboard)/affiliates/levels/[id]/page.tsx
import { ClientEditLevelPage } from "./page-client";

export const metadata = { title: "Edit Affiliate Level" };

export default function EditLevelPage({ params }: { params: { id: string } }) {
  return <ClientEditLevelPage id={params.id} />;
}

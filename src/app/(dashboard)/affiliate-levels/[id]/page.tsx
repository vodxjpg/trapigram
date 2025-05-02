// src/app/(dashboard)/affiliate-levels/[id]/page.tsx
import { LevelForm } from "../level-form";

export const metadata = { title: "Edit Affiliate Level" };

export default function EditLevelPage({ params }: { params: { id: string } }) {
  return (
    <div className="container mx-auto py-6">
      <LevelForm id={params.id} />
    </div>
  );
}

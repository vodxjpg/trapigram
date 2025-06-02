// src/app/(dashboard)/notification-templates/[id]/edit/page.tsx
import { NotificationTemplateForm } from "@/app/(dashboard)/notification-templates/components/notification-templates-form";
import { use } from "react";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";

export default async function EditTemplatePage({ params }: { params: { id: string } }) {
  /* server component fetch */
  const tpl = await db
    .selectFrom("notificationTemplates")
    .selectAll()
    .where("id", "=", params.id)
    .executeTakeFirst();

  if (!tpl) throw new Error("Template not found");

  return (
    <div className="p-6">
      {/* client form */}
      <NotificationTemplateForm id={params.id} initial={tpl} />
    </div>
  );
}

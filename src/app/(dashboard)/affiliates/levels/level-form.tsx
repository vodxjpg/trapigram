// src/app/(dashboard)/affiliates/levels/level-form.tsx
"use client";

import { useId, useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormControl,
} from "@/components/ui/form";

/* --------- Quill (client-only) ----------------------------------- */
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

/* --------- validation ------------------------------------------- */
const schema = z.object({
  name: z.string().min(1),
  image: z.string().nullable().optional(),
  levelUpMessage: z.string().nullable().optional(),
  levelUpMessageGroup: z.string().nullable().optional(),
  requiredPoints: z.coerce.number().int().positive(),
});
type FormVals = z.infer<typeof schema>;

type Props = { id?: string };

/* ---------------- helper that renders Quill’s default toolbar ----- */
function QuillToolbar({ id }: { id: string }) {
  return (
    <div
      id={id}
      className="flex flex-wrap items-center gap-1 rounded-t border border-b-0 border-input bg-muted p-2"
    >
      <select className="ql-header" defaultValue="">
        <option value="1">H1</option>
        <option value="2">H2</option>
        <option value="">Normal</option>
      </select>

      <button className="ql-bold" />
      <button className="ql-italic" />
      <button className="ql-underline" />

      <button className="ql-list" value="ordered" />
      <button className="ql-list" value="bullet" />

      <button className="ql-link" />
      <button className="ql-clean" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function LevelForm({ id }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", requiredPoints: 0 },
  });

  /* ---------- preload data when editing -------------------------- */
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await fetch(`/api/affiliate/levels/${id}`, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
          },
        });
        if (!r.ok) throw new Error((await r.json()).error || "Fetch failed");
        form.reset(await r.json());
      } catch (e: any) {
        toast.error(e.message);
      }
    })();
  }, [id, form]);

  /* ---------- file upload helper --------------------------------- */
  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
        body: fd,
      });
      if (!r.ok) throw new Error((await r.json()).error || "Upload failed");
      const { filePath } = await r.json();
      form.setValue("image", filePath, { shouldValidate: true });
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  /* ---------- submit --------------------------------------------- */
  const onSubmit = async (vals: FormVals) => {
    setSubmitting(true);
    try {
      const r = await fetch(
        id ? `/api/affiliate/levels/${id}` : "/api/affiliate/levels",
        {
          method: id ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
          },
          body: JSON.stringify(vals),
        }
      );
      if (!r.ok) throw new Error((await r.json()).error || "Request failed");
      toast.success(id ? "Level updated" : "Level created");
      router.push("/affiliates/levels");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- Quill editors config (no hooks-in-loop) ------------ */
  const quillBaseId = useId();
  const editors = [
    { name: "levelUpMessage", label: "Level-up Message (DM)" },
    { name: "levelUpMessageGroup", label: "Level-up Message (Group)" },
  ] as const;

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <Link href="/affiliates/levels">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* ------------ Name ------------------------------------ */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ------------ Image ----------------------------------- */}
            <FormField
              control={form.control}
              name="image"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Image *</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-4">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFile(e.target.files?.[0])}
                      />
                      {field.value && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={field.value}
                          alt="preview"
                          className="h-12 w-12 rounded object-cover"
                        />
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ------------ Required points ------------------------ */}
            <FormField
              control={form.control}
              name="requiredPoints"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Required Points *</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ------------ Quill editors -------------------------- */}
            {editors.map(({ name, label }, idx) => {
              const toolbarId = `${name}-toolbar-${quillBaseId}-${idx}`;
              // Build modules object inline (no hooks in map)
              const modules = {
                toolbar: {
                  container: `#${toolbarId}`,
                  handlers: {},
                },
              };

              return (
                <FormField
                  key={name}
                  name={name}
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <div className="">
                        <span className="text-xs">{`{user}`} - Output user's name or username</span>
                        &nbsp;<br />
                        <span className="text-xs">
                          {`{mention}`} - Mention the user in a group (only for when the
                          bot is within the same tele group as the user)
                        </span>
                        &nbsp;<br />
                        <span className="text-xs">
                          {`{level_name}`} - Output user's level name
                        </span>
                        &nbsp;<br />
                      </div>

                      {/* Toolbar */}
                      <QuillToolbar id={toolbarId} />

                      {/* Editor */}
                      <FormControl>
                        <ReactQuill
                          theme="snow"
                          modules={modules}
                          value={(field.value ?? "") as string} // ensure string
                          onChange={(v) => field.onChange(v)}
                          className="h-56 rounded-b border border-input"
                        />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />
              );
            })}

            <Button
              className="mt-10"
              type="submit"
              disabled={submitting || uploading}
            >
              {submitting ? "Saving…" : id ? "Update Level" : "Save Level"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

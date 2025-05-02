// src/app/(dashboard)/affiliate-levels/level-form.tsx  ⟵ full file with fixed schema
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

/* fixed schema */
const schema = z.object({
  name: z.string().min(1),
  image: z.string().optional().nullable(),          // ← removed .url()
  levelUpMessage: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  requiredPoints: z.coerce.number().int().positive(),
});
type FormVals = z.infer<typeof schema>;
type Props = { id?: string };

export function LevelForm({ id }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", requiredPoints: 0 },
  });

  /* preload if editing */
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await fetch(`/api/affiliate/levels/${id}`, {
          headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
        });
        if (!r.ok) throw new Error((await r.json()).error || "Fetch failed");
        form.reset(await r.json());
      } catch (e: any) {
        toast.error(e.message);
      }
    })();
  }, [id, form]);

  /* upload */
  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", {
        method: "POST",
        headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
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

  /* submit */
  const onSubmit = async (vals: FormVals) => {
    setSubmitting(true);
    try {
      const r = await fetch(id ? `/api/affiliate/levels/${id}` : "/api/affiliate/levels", {
        method: id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
        body: JSON.stringify(vals),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Request failed");
      toast.success(id ? "Level updated" : "Level created");
      router.push("/affiliate-levels");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const quillModules = {
    toolbar: [
      [{ header: [1, 2, false] }],
      ["bold", "italic", "underline"],
      [{ list: "ordered" }, { list: "bullet" }],
      ["link"],
      ["clean"],
    ],
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <Link href="/affiliate-levels">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Name */}
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

            {/* Image upload */}
            <FormField
              control={form.control}
              name="image"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Image *</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-4">
                      <Input type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0])} />
                      {field.value && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={field.value} alt="preview" className="h-12 w-12 rounded" />
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Points */}
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

            {/* Quill fields */}
            {["levelUpMessage", "description"].map((name) => (
              <FormField
                key={name}
                control={form.control}
                name={name as "levelUpMessage" | "description"}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{name === "levelUpMessage" ? "Level‑up Message" : "Description"}</FormLabel>
                    <FormControl>
                      <ReactQuill theme="snow" modules={quillModules} value={field.value || ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}

            <Button type="submit" disabled={submitting || uploading}>
              {submitting ? "Saving…" : id ? "Update Level" : "Save Level"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

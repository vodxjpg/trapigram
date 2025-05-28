// File: src/app/(dashboard)/sections/components/section-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import dynamic from "next/dynamic";
import {
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { placeholderDefs } from "@/lib/placeholder-meta";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link"],
    ["clean"],
  ],
};
const quillFormats = ["header", "bold", "italic", "underline", "list", "link"];

const schema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  videoUrl: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .refine(
      (v) =>
        v === null ||
        /^\/uploads\/.+/.test(v) ||
        /^https?:\/\/.+/.test(v),
      { message: "Invalid video file URL" }
    ),
  parentSectionId: z.string().uuid().nullable().optional(),
});
type Values = z.infer<typeof schema>;

type Opt = { id: string; title: string; parentSectionId: string | null };
type Props = { initial?: Partial<Values> & { id?: string }; sections?: Opt[] };

export function SectionForm({ initial, sections = [] }: Props) {
  const router = useRouter();
  const [isSubmitting, setSubmitting] = useState(false);

  // Derive initial fileName from initial.videoUrl if present
  const initialFileName =
    initial?.videoUrl?.split("/").pop() ?? null;
  const [fileName, setFileName] = useState<string | null>(initialFileName);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      title: initial?.title ?? "",
      content: initial?.content ?? "",
      videoUrl: initial?.videoUrl ?? null,
      parentSectionId: initial?.parentSectionId ?? null,
    },
  });
  const selfId = initial?.id;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // show name immediately
    setFileName(f.name);
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      toast.error("Upload failed");
      setFileName(initialFileName);
      return;
    }
    const { filePath } = await res.json();
    form.setValue("videoUrl", filePath as any);
  };

  const onSubmit = async (raw: Values) => {
    setSubmitting(true);
    try {
      const url = selfId ? `/api/sections/${selfId}` : "/api/sections";
      const method = selfId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Request failed");
      toast.success(`Section ${selfId ? "updated" : "created"}`);
      router.push("/sections");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const optionSections = sections.filter((s) => s.id !== selfId);
  const label = (s: Opt) => {
    let depth = 0;
    let p = s.parentSectionId;
    while (p) {
      const parent = optionSections.find((x) => x.id === p);
      if (!parent) break;
      depth += 1;
      p = parent.parentSectionId;
    }
    return `${"—".repeat(depth)} ${s.title}`;
  };

  const PlaceholderHint = () => (
    <div className="rounded-md bg-muted p-4 text-sm space-y-1">
      <p className="font-medium">Available placeholders:</p>
      <ul className="list-disc pl-4 space-y-1">
        {placeholderDefs.map((p) => (
          <li key={p.key}>
            <code className="px-1 py-0.5 bg-gray-100 rounded">
              {`{${p.key}}`}
            </code>{" "}
            – {p.description}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>{selfId ? "Edit Section" : "Create Section"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <FormItem>
                <FormLabel>Name (slug)</FormLabel>
                <FormControl>
                  <Input placeholder="address" {...form.register("name")} />
                </FormControl>
                <FormMessage />
              </FormItem>
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input placeholder="📍 Provide Your Address" {...form.register("title")} />
                </FormControl>
                <FormMessage />
              </FormItem>
              <FormItem>
                <FormLabel>Parent Section</FormLabel>
                <Select
                  onValueChange={(v) =>
                    form.setValue("parentSectionId", v === "none" ? null : v)
                  }
                  value={form.watch("parentSectionId") ?? "none"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">None (top-level)</SelectItem>
                    {optionSections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {label(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
              <FormItem>
                <FormLabel>Video File</FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <input
                      id="video-upl"
                      type="file"
                      accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo,video/mpeg"
                      className="hidden"
                      onChange={handleUpload}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      document.getElementById("video-upl")?.click()
                    }
                  >
                    <Upload className="h-4 w-4" /> Upload
                  </Button>
                  {form.watch("videoUrl") && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        form.setValue("videoUrl", null);
                        setFileName(null);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {fileName && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Selected file: {fileName}
                  </p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  Max 150 MB. Formats: MP4, WebM, Ogg, QuickTime, AVI, MPEG
                </p>
                <FormMessage />
              </FormItem>
            </div>

            <PlaceholderHint />
            {/* Quill */}
            <FormItem>
              <FormLabel>Content</FormLabel>
              <FormControl>
                <ReactQuill
                  theme="snow"
                  modules={quillModules}
                  formats={quillFormats}
                  value={form.watch("content")}
                  onChange={(v) => form.setValue("content", v)}
                  className="h-80 min-h-[300px]"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" onClick={() => router.push("/sections")}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : selfId ? "Update Section" : "Create Section"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

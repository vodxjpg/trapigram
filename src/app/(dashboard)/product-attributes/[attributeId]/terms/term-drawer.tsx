// /home/zodx/Desktop/trapigram/src/app/(dashboard)/product-attributes/[attributeId]/terms/term-drawer.tsx
"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

type Term = {
  id: string;
  name: string;
  slug: string;
};

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
});

type FormValues = z.infer<typeof formSchema>;

interface TermDrawerProps {
  open: boolean;
  onClose: (refreshData?: boolean) => void;
  term: Term | null;
  attributeId: string;
}

export function TermDrawer({ open, onClose, term, attributeId }: TermDrawerProps) {
  const isMobile = useIsMobile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugExists, setSlugExists] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", slug: "" },
  });

  // Reset form and slug state every time the drawer opens
  useEffect(() => {
    if (!open) return;

    if (term) {
      form.reset({ name: term.name, slug: term.slug });
    } else {
      form.reset({ name: "", slug: "" });
    }
    setSlugExists(false);
    setSlugChecking(false);
  }, [open, term, form]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    form.setValue("name", name);
    const generatedSlug = slugify(name);
    form.setValue("slug", generatedSlug);
    checkSlugExists(generatedSlug);
  };

  const checkSlugExists = async (slug: string) => {
    if (!slug) return;

    setSlugChecking(true);
    try {
      const url = new URL(`/api/product-attributes/${attributeId}/terms/check-slug`, window.location.origin);
      url.searchParams.append("slug", slug);
      if (term) url.searchParams.append("termId", term.id);

      const response = await fetch(url.toString(), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to check slug");
      const data = await response.json();
      setSlugExists(data.exists);
    } catch (error) {
      console.error("Error checking slug:", error);
      toast.error("Failed to check slug availability");
    } finally {
      setSlugChecking(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (slugExists) {
      form.setError("slug", { message: "This slug already exists" });
      return;
    }

    setIsSubmitting(true);
    try {
      const url = term
        ? `/api/product-attributes/${attributeId}/terms/${term.id}`
        : `/api/product-attributes/${attributeId}/terms`;
      const method = term ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "include",
      });

      if (!response.ok) throw new Error("Failed to save term");
      toast.success(term ? "Term updated" : "Term created");

      // Optional immediate reset so drawer reopens blank even if parent keeps it open
      form.reset({ name: "", slug: "" });
      onClose(true);
    } catch (error) {
      console.error("Error saving term:", error);
      toast.error("Failed to save term");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction={isMobile ? "bottom" : "right"}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{term ? "Edit Term" : "Add Term"}</DrawerTitle>
          <DrawerDescription>
            {term ? "Update term details." : "Create a new term for this attribute."}
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 overflow-y-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} onChange={handleNameChange} placeholder="e.g., Nike" />
                    </FormControl>
                    <FormDescription>The display name for this term.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Slug</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          onChange={(e) => {
                            const newSlug = slugify(e.target.value);
                            field.onChange(newSlug);
                            checkSlugExists(newSlug);
                          }}
                          placeholder="e.g., nike"
                        />
                        {slugChecking && (
                          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </FormControl>
                    <FormDescription>
                      {slugChecking ? (
                        <span className="text-muted-foreground">Checking...</span>
                      ) : slugExists ? (
                        <span className="text-destructive">This slug already exists.</span>
                      ) : field.value ? (
                        <span className="text-green-600">This slug is available.</span>
                      ) : (
                        "The URL-friendly identifier."
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DrawerFooter className="px-0">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {term ? "Update Term" : "Create Term"}
                </Button>
                <DrawerClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DrawerClose>
              </DrawerFooter>
            </form>
          </Form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2, Upload, X, ImageIcon } from "lucide-react"
import Image from "next/image"

import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { slugify } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"

type Category = {
  id: string
  name: string
  slug: string
  image: string | null
  order: number
  parentId: string | null
}

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
  image: z.string().nullable().optional(),
  order: z.coerce.number().int().default(0),
  parentId: z.string().nullable().optional(),
})

type FormValues = z.infer<typeof formSchema>

interface CategoryDrawerProps {
  open: boolean
  onClose: (refreshData?: boolean) => void
  category: Category | null
}

export function CategoryDrawer({ open, onClose, category }: CategoryDrawerProps) {
  const isMobile = useIsMobile()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [slugChecking, setSlugChecking] = useState(false)
  const [slugExists, setSlugExists] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      slug: "",
      image: null,
      order: 0,
      parentId: null,
    },
  })

  // Fetch categories for parent selection
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await fetch("/api/product-categories?pageSize=100")
        if (!response.ok) {
          throw new Error("Failed to fetch categories")
        }
        const data = await response.json()
        // Filter out the current category to prevent circular references
        const filteredCategories = category
          ? data.categories.filter((cat: Category) => cat.id !== category.id)
          : data.categories
        setCategories(filteredCategories)
      } catch (error) {
        console.error("Error fetching categories:", error)
        toast.error("Failed to load parent categories")
      }
    }

    if (open) {
      fetchCategories()
    }
  }, [open, category])

  // Set form values when editing
  useEffect(() => {
    if (category) {
      form.reset({
        name: category.name,
        slug: category.slug,
        image: category.image,
        order: category.order,
        parentId: category.parentId,
      })
      setSlugTouched(true)
      setImagePreview(category.image)
    } else {
      form.reset({
        name: "",
        slug: "",
        image: null,
        order: 0,
        parentId: null,
      })
      setSlugTouched(false)
      setImagePreview(null)
      setImageFile(null)
    }
  }, [category, form])

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value
    form.setValue("name", name)

    if (!slugTouched) {
      const generatedSlug = slugify(name)
      form.setValue("slug", generatedSlug)
      checkSlugExists(generatedSlug)
    }
  }

  // Check if slug exists
  const checkSlugExists = async (slug: string) => {
    if (!slug) return

    setSlugChecking(true)
    try {
      const url = new URL("/api/product-categories/check-slug", window.location.origin)
      url.searchParams.append("slug", slug)
      if (category) {
        url.searchParams.append("categoryId", category.id)
      }

      const response = await fetch(url.toString())
      if (!response.ok) {
        throw new Error("Failed to check slug")
      }

      const data = await response.json()
      setSlugExists(data.exists)
    } catch (error) {
      console.error("Error checking slug:", error)
    } finally {
      setSlugChecking(false)
    }
  }

  // Handle slug change
  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugTouched(true)
    const slug = e.target.value
    form.setValue("slug", slugify(slug))
    checkSlugExists(slugify(slug))
  }

  // Handle image selection
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if (!validTypes.includes(file.type)) {
      toast.error("Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.")
      return
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 5MB.")
      return
    }

    setImageFile(file)

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  // Handle image removal
  const handleRemoveImage = () => {
    setImageFile(null)
    setImagePreview(null)
    form.setValue("image", null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  // Upload image
  const uploadImage = async (): Promise<string | null> => {
    if (!imageFile) return form.getValues("image")

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", imageFile)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to upload image")
      }

      const data = await response.json()
      return data.filePath
    } catch (error) {
      console.error("Error uploading image:", error)
      toast.error("Failed to upload image")
      return null
    } finally {
      setIsUploading(false)
    }
  }

  // Handle form submission
  const onSubmit = async (values: FormValues) => {
    if (slugExists) {
      form.setError("slug", {
        type: "manual",
        message: "This slug already exists. Please choose another one.",
      })
      return
    }

    setIsSubmitting(true)
    try {
      // Upload image if selected
      const imagePath = await uploadImage()

      const url = category ? `/api/product-categories/${category.id}` : "/api/product-categories"

      const method = category ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...values,
          image: imagePath,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to save category")
      }

      toast.success(category ? "Category updated successfully" : "Category created successfully")
      onClose(true)
    } catch (error) {
      console.error("Error saving category:", error)
      toast.error(error instanceof Error ? error.message : "Failed to save category")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(open) => !open && onClose()} direction={isMobile ? "bottom" : "right"}>
      <DrawerContent className="max-h">
        <DrawerHeader>
          <DrawerTitle>{category ? "Edit Category" : "Add Category"}</DrawerTitle>
          <DrawerDescription>
            {category ? "Update your product category details." : "Create a new product category for your store."}
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
                      <Input {...field} onChange={handleNameChange} placeholder="Category name" />
                    </FormControl>
                    <FormDescription>The display name for this category.</FormDescription>
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
                        <Input {...field} onChange={handleSlugChange} placeholder="category-slug" />
                        {slugChecking && (
                          <div className="absolute right-3 top-3">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormDescription>
                      The URL-friendly identifier for this category.
                      {slugExists && <span className="text-destructive ml-1">This slug already exists.</span>}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent Category</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                      value={field.value || "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a parent category (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Optionally nest this category under a parent.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="order"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Order</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} placeholder="0" />
                    </FormControl>
                    <FormDescription>Controls the display order (lower numbers appear first).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="image"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category Image</FormLabel>
                    <FormControl>
                      <div className="space-y-4">
                        {/* Image preview */}
                        {imagePreview ? (
                          <div className="relative w-40 h-40 rounded-md overflow-hidden border">
                            <Image
                              src={imagePreview || "/placeholder.svg"}
                              alt="Category preview"
                              fill
                              className="object-cover"
                            />
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="absolute top-2 right-2 h-6 w-6"
                              onClick={handleRemoveImage}
                            >
                              <X className="h-4 w-4" />
                              <span className="sr-only">Remove image</span>
                            </Button>
                          </div>
                        ) : (
                          <div
                            className="flex flex-col items-center justify-center w-40 h-40 rounded-md border border-dashed border-muted-foreground/50 cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <ImageIcon className="h-10 w-10 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground mt-2">Click to upload</p>
                          </div>
                        )}

                        {/* Hidden file input */}
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          onChange={handleImageChange}
                        />

                        {/* Upload button */}
                        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                          <Upload className="h-4 w-4 mr-2" />
                          {imagePreview ? "Change Image" : "Upload Image"}
                        </Button>
                      </div>
                    </FormControl>
                    <FormDescription>Upload an image for this category (optional).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DrawerFooter className="px-0">
                <Button type="submit" disabled={isSubmitting || isUploading}>
                  {(isSubmitting || isUploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {category ? "Update Category" : "Create Category"}
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
  )
}


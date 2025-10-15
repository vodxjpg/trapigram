"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CategoryNavProps = {
  categories: Array<{ id: string; name: string }>
  selectedCategoryId: string | null // null => All
  onSelect: (id: string | null) => void
}

export function CategoryNav({ categories, selectedCategoryId, onSelect }: CategoryNavProps) {
  return (
    <div className="border-b bg-card px-6 py-3">
      <div className="flex gap-2 overflow-x-auto">
        <Button
          key="__all__"
          variant={selectedCategoryId === null ? "default" : "outline"}
          onClick={() => onSelect(null)}
          className={cn("rounded-lg", selectedCategoryId === null && "bg-primary text-primary-foreground")}
        >
          All
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            variant={selectedCategoryId === c.id ? "default" : "outline"}
            onClick={() => onSelect(c.id)}
            className={cn("rounded-lg", selectedCategoryId === c.id && "bg-primary text-primary-foreground")}
          >
            {c.name}
          </Button>
        ))}
      </div>
    </div>
  )
}

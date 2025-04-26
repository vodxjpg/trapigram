import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/&/g, "-and-") // Replace & with 'and'
    .replace(/[^\w-]+/g, "") // Remove all non-word characters
    .replace(/--+/g, "-") // Replace multiple - with single -
}

export function getInitials(name: string): string {
  if (!name) return ""

  const words = name.trim().split(/\s+/)

  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase()
  }

  return (words[0][0] + words[1][0]).toUpperCase()
}
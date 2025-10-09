// src/app/(dashboard)/organizations/organization-table.tsx
"use client"

import type React from "react"
import {
  useState,
  useEffect,
  startTransition,
  useMemo,
} from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Edit,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { OrganizationDrawer } from "./organization-drawer"
import { Badge } from "@/components/ui/badge"
import { useDebounce } from "@/hooks/use-debounce"

// NEW: TanStack + standardized table
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { StandardDataTable } from "@/components/data-table/data-table"

/* -------------------------------------------------------------------- */
/*  Types                                                               */
/* -------------------------------------------------------------------- */

type Organization = {
  id: string
  name: string
  slug: string
  logo?: string | null
  memberCount: number
  userRole: string
}

/* -------------------------------------------------------------------- */
/*  Component                                                           */
/* -------------------------------------------------------------------- */

export function OrganizationTable() {
  /* --------------- state ------------------------------------------- */
  const router = useRouter()

  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)

  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // search & debounce
  const [searchQuery, setSearchQuery] = useState("")
  const debounced = useDebounce(searchQuery, 300)

  // in-memory sort
  const [sortColumn, setSortColumn] = useState<"name" | "members">("name")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

  // drawer
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingOrganization, setEditingOrganization] = useState<Organization | null>(null)

  /* --------------- data fetch -------------------------------------- */
  const fetchOrganizations = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/organizations", {
        credentials: "include",
      })
      if (!response.ok) throw new Error(`Failed to fetch organizations: ${response.statusText}`)

      const { organizations: fetchedOrgs } = await response.json()

      // search (client-side) against debounced value
      const filtered = debounced
        ? fetchedOrgs.filter(
          (org: Organization) =>
            org.name.toLowerCase().includes(debounced.toLowerCase()) ||
            org.slug.toLowerCase().includes(debounced.toLowerCase()),
        )
        : fetchedOrgs

      setOrganizations(filtered)
      /* note: totalPages depends on *filtered* length */
      setTotalPages(Math.max(1, Math.ceil(filtered.length / pageSize)))
    } catch (error) {
      console.error("Error fetching organizations:", error)
      toast.error("Failed to load organizations")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrganizations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debounced])

  /* --------------- utils ------------------------------------------- */
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setCurrentPage(1)          // reset pagination
  }

  const handleSort = (column: "name" | "members") => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortColumn(column)
      setSortDirection("asc")
    }
  }

  // sort (client-side, stable)
  const sortedOrganizations = useMemo(() => {
    const arr = [...organizations]
    if (sortColumn === "name") {
      arr.sort((a, b) =>
        sortDirection === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name)
      )
    } else if (sortColumn === "members") {
      arr.sort((a, b) =>
        sortDirection === "asc"
          ? a.memberCount - b.memberCount
          : b.memberCount - a.memberCount
      )
    }
    return arr
  }, [organizations, sortColumn, sortDirection])

  // paginate (client-side)
  const paginatedOrganizations = useMemo(() => {
    return sortedOrganizations.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize,
    )
  }, [sortedOrganizations, currentPage, pageSize])

  /* --------------- CRUD ------------------------------------------- */
  const handleDelete = async (id: string) => {
    if (organizations.length <= 1) {
      toast.error("You must belong to at least one organization.")
      return
    }
    if (!confirm("Are you sure you want to delete this organization?")) return
    try {
      await authClient.organization.delete({ organizationId: id })
      toast.success("Organization deleted successfully")
      fetchOrganizations()
    } catch (error) {
      console.error("Error deleting organization:", error)
      toast.error("Failed to delete organization")
    }
  }

  const handleEdit = (org: Organization) => {
    setEditingOrganization(org)
    setDrawerOpen(true)
  }

  const handleAdd = () => {
    setEditingOrganization(null)
    setDrawerOpen(true)
  }

  const handleDrawerClose = (refreshData = false) => {
    setDrawerOpen(false)
    setEditingOrganization(null)
    if (refreshData) fetchOrganizations()
  }

  const navigateToOrganization = (slug: string) => {
    router.push(`/organizations/${slug}`)
  }

  /* -------------------- Columns for StandardDataTable -------------------- */
  const columns: ColumnDef<Organization>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: () => (
          <button
            type="button"
            className="cursor-pointer select-none"
            onClick={() => handleSort("name")}
            aria-label="Sort by name"
          >
            Name {sortColumn === "name" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
        ),
        cell: ({ row }) => (
          <span
            className="font-medium cursor-pointer hover:underline"
            onClick={() => navigateToOrganization(row.original.slug)}
          >
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        cell: ({ row }) => row.original.slug,
      },
      {
        id: "members",
        header: () => (
          <button
            type="button"
            className="cursor-pointer select-none"
            onClick={() => handleSort("members")}
            aria-label="Sort by members"
          >
            Members {sortColumn === "members" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
        ),
        cell: ({ row }) => (
          <Badge variant="outline" className="flex items-center gap-1 w-fit">
            <Users className="h-3 w-3" /> {row.original.memberCount}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const org = row.original
          const roles = (org.userRole ?? "")
            .toLowerCase()
            .split(",")
            .map((r) => r.trim())
          const canManage = roles.includes("owner") || roles.includes("admin")
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canManage && (
                    <>
                      <DropdownMenuItem onClick={() => handleEdit(org)}>
                        <Edit className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(org.id)}
                        disabled={organizations.length <= 1}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    // dependencies ensure headers update their arrows and delete disables correctly
    [sortColumn, sortDirection, organizations.length]
  )

  /* -------------------- TanStack table instance -------------------- */
  const table = useReactTable({
    data: paginatedOrganizations, // keep your manual pagination and sorting
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  /* -------------------------------------------------------------------- */
  /*  Render                                                              */
  /* -------------------------------------------------------------------- */

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="flex w-full sm:w-auto gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search organizations…"
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) => {
                const txt = e.target.value
                startTransition(() => {
                  setSearchQuery(txt)
                  setCurrentPage(1)   // reset page instantly without blocking paint
                })
              }}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>

        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add Organization
        </Button>
      </div>

      {/* Standardized Table */}
      <StandardDataTable<Organization>
        table={table}
        columns={columns}
        isLoading={loading}
        emptyMessage="No organizations found."
        skeletonRows={5}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {currentPage} of {totalPages}
        </div>

        <div className="flex items-center space-x-2">
          {/* Page-size */}
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={pageSize.toString()}
              onValueChange={(v) => {
                setPageSize(Number(v))
                setCurrentPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[5, 10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={n.toString()}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Nav buttons */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
          >
            <ChevronsLeft className="h-4 w-4" />
            <span className="sr-only">First page</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Previous page</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">Next page</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
          >
            <ChevronsRight className="h-4 w-4" />
            <span className="sr-only">Last page</span>
          </Button>
        </div>
      </div>

      {/* Drawer */}
      <OrganizationDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        organization={editingOrganization}
      />
    </div>
  )
}

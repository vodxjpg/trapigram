// /home/zodx/Desktop/trapigram/src/app/(dashboard)/organizations/organization-table.tsx
"use client"

import type React from "react"
import { useState, useEffect } from "react"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OrganizationDrawer } from "./organization-drawer"
import { Badge } from "@/components/ui/badge"

// Define the shape of an organization

type Organization = {
  id: string
  name: string
  slug: string
  logo?: string | null
  memberCount: number
  userRole: string
}

export function OrganizationTable() {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState("")
  const [pageSize, setPageSize] = useState(10)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingOrganization, setEditingOrganization] = useState<Organization | null>(null)
  const [sortColumn, setSortColumn] = useState<string>("name")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

  // Fetch organizations from our API
  const fetchOrganizations = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/organizations", {
        credentials: "include",
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch organizations: ${response.statusText}`)
      }
    
      
      if (!response.ok) {
        throw new Error(`Failed to fetch organizations: ${response.statusText}`)
      }
      const { organizations: fetchedOrgs } = await response.json()

      // Apply our search filter
      const filtered = searchQuery
        ? fetchedOrgs.filter(
            (org: Organization) =>
              org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              org.slug.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : fetchedOrgs

      setOrganizations(filtered)
      setTotalPages(Math.ceil(filtered.length / pageSize))
    } catch (error) {
      console.error("Error fetching organizations:", error)
      toast.error("Failed to load organizations")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrganizations()
  }, [currentPage, pageSize, searchQuery])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setCurrentPage(1)
    fetchOrganizations()
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortColumn(column)
      setSortDirection("asc")
    }
  }

  // Sort in-memory
  const sortedOrganizations = [...organizations].sort((a, b) => {
    if (sortColumn === "name") {
      return sortDirection === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    } else if (sortColumn === "members") {
      return sortDirection === "asc"
        ? a.memberCount - b.memberCount
        : b.memberCount - a.memberCount
    }
    return 0
  })

  // Paginate in-memory
  const paginatedOrganizations = sortedOrganizations.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

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

  const handleEdit = (organization: Organization) => {
    setEditingOrganization(organization)
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form onSubmit={handleSearch} className="flex w-full sm:w-auto gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search organizations..."
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Organization
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("name")}
              >
                Name {sortColumn === "name" && (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead>Slug</TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("members")}
              >
                Members {sortColumn === "members" && (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : paginatedOrganizations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No organizations found.
                </TableCell>
              </TableRow>
            ) : (
              paginatedOrganizations.map((org) => {
                // Derive roles array from comma-separated userRole
                const roles = (org.userRole ?? "")
                  .toLowerCase()
                  .split(",")
                  .map((r) => r.trim())
                const canManage = roles.includes("owner") || roles.includes("admin")

                return (
                  <TableRow key={org.id}>
                    <TableCell
                      className="font-medium cursor-pointer hover:underline"
                      onClick={() => navigateToOrganization(org.slug)}
                    >
                      {org.name}
                    </TableCell>
                    <TableCell>{org.slug}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        <Users className="h-3 w-3" /> {org.memberCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
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
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => {
                setPageSize(Number(value))
                setCurrentPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[5, 10, 20, 50, 100].map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="icon" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
              <ChevronsLeft className="h-4 w-4" />
              <span className="sr-only">First page</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="sr-only">Previous page</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(currentPage + 1)}
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
      </div>

      <OrganizationDrawer open={drawerOpen} onClose={handleDrawerClose} organization={editingOrganization} />
    </div>
  )
}

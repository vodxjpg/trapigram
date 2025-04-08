"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Search,
  Trash2,
  Edit,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

type Client = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string; // we'll use this field for phone in the table display
  referredBy: string | null;
};

export function ClientTable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [sortColumn, setSortColumn] = useState<string>("username");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Function to fetch clients from your API endpoint.
  const fetchClients = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/clients?page=${currentPage}&pageSize=${pageSize}&search=${searchQuery}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch clients");
      }

      const data = await response.json();
      // Transform the response to use camelCase keys
      const transformedClients = data.clients.map((client: any) => ({
        id: client.id,
        username: client.username,
        firstName: client.first_name, // Converted from "first_name"
        lastName: client.last_name, // Converted from "last_name"
        email: client.email,
        phone: client.phone_number, // Converted from "phone_number"
        referredBy: client.referred_by, // Converted from "referred_by"
      }));

      // Set the transformed data in state
      setClients(transformedClients);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
    } catch (error) {
      console.error("Error fetching clients:", error);
      toast.error("Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, searchQuery]);

  // Sorting logic for table columns.
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const sortedClients = [...clients].sort((a, b) => {
    const aValue = a[sortColumn as keyof Client];
    const bValue = b[sortColumn as keyof Client];
    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortDirection === "asc"
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }
    return 0;
  });

  // Delete handler remains unchanged.
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this client?")) {
      return;
    }

    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete client");
      }

      toast.success("Client deleted successfully");
      fetchClients();
    } catch (error) {
      console.error("Error deleting client:", error);
      toast.error("Failed to delete client");
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setDrawerOpen(true);
  };

  // --- Edit Form Logic ---

  // Define the Zod schema for client editing.
  const editClientSchema = z.object({
    username: z
      .string()
      .min(3, { message: "Username must be at least 3 characters." }),
    firstName: z.string().min(1, { message: "First name is required." }),
    lastName: z.string().min(1, { message: "Last name is required." }),
    email: z.string().email({ message: "Please enter a valid email address." }),
    phoneNumber: z
      .string()
      .min(10, { message: "Please enter a valid phone number." }),
    referredBy: z.string().optional(),
  });

  // Create a form instance for editing.
  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    reset: resetEdit,
    formState: { errors: editErrors },
  } = useForm({
    resolver: zodResolver(editClientSchema),
    defaultValues: editingClient
      ? {
          username: editingClient.username,
          firstName: editingClient.firstName,
          lastName: editingClient.lastName,
          email: editingClient.email,
          phoneNumber: editingClient.phone,
          referredBy: editingClient.referredBy || "",
        }
      : {},
  });

  // When editingClient changes, update the default values.
  useEffect(() => {
    if (editingClient) {
      resetEdit({
        username: editingClient.username,
        firstName: editingClient.firstName,
        lastName: editingClient.lastName,
        email: editingClient.email,
        phoneNumber: editingClient.phone, // Using the transformed "phone" field
        referredBy: editingClient.referredBy || "",
      });
    }
  }, [editingClient, resetEdit]);

  // Handler for submitting the edit form.
  const handleEditSubmit = async (data: any) => {
    try {
      const response = await fetch(`/api/clients/${editingClient?.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update client");
      }

      toast.success("Client updated successfully");
      // Close the modal
      setDrawerOpen(false);
      // Reload the current page to show the updated client list.
      //router.refresh();
      // Alternatively, you can use:
      window.location.reload();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  return (
    <div className="w-full mx-auto">
      {/* Table displaying client information */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("username")}
              >
                Username{" "}
                {sortColumn === "username" &&
                  (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("firstName")}
              >
                First Name{" "}
                {sortColumn === "firstName" &&
                  (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("lastName")}
              >
                Last Name{" "}
                {sortColumn === "lastName" &&
                  (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("email")}
              >
                Email{" "}
                {sortColumn === "email" &&
                  (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Referred By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : sortedClients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  No clients found.
                </TableCell>
              </TableRow>
            ) : (
              sortedClients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>{client.username}</TableCell>
                  <TableCell>{client.firstName}</TableCell>
                  <TableCell>{client.lastName}</TableCell>
                  <TableCell>{client.email}</TableCell>
                  <TableCell>{client.phone}</TableCell>
                  <TableCell>{client.referredBy || "-"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(client)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDelete(client.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-muted-foreground">
          Showing page {currentPage} of {totalPages}
        </div>
        {/* Pagination buttons can be added here */}
      </div>

      {/* Edit Modal */}
      {drawerOpen && editingClient && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-lg">
            <h2 className="text-2xl font-bold mb-4">Edit Client</h2>
            <form
              onSubmit={handleSubmitEdit(handleEditSubmit)}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">
                  Username *
                </label>
                <Input {...registerEdit("username")} placeholder="johndoe" />
                {editErrors.username && (
                  <p className="text-red-500 text-sm mt-1">
                    {editErrors.username.message}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Email *
                </label>
                <Input
                  {...registerEdit("email")}
                  type="email"
                  placeholder="john.doe@example.com"
                />
                {editErrors.email && (
                  <p className="text-red-500 text-sm mt-1">
                    {editErrors.email.message}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    First Name *
                  </label>
                  <Input {...registerEdit("firstName")} placeholder="John" />
                  {editErrors.firstName && (
                    <p className="text-red-500 text-sm mt-1">
                      {editErrors.firstName.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Last Name *
                  </label>
                  <Input {...registerEdit("lastName")} placeholder="Doe" />
                  {editErrors.lastName && (
                    <p className="text-red-500 text-sm mt-1">
                      {editErrors.lastName.message}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Phone Number *
                </label>
                <Input
                  {...registerEdit("phoneNumber")}
                  placeholder="(123) 456-7890"
                />
                {editErrors.phoneNumber && (
                  <p className="text-red-500 text-sm mt-1">
                    {editErrors.phoneNumber.message}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Referred By
                </label>
                <Input {...registerEdit("referredBy")} placeholder="Optional" />
                {editErrors.referredBy && (
                  <p className="text-red-500 text-sm mt-1">
                    {editErrors.referredBy.message}
                  </p>
                )}
              </div>
              <div className="flex justify-end space-x-2">
                <Button type="button" onClick={() => setDrawerOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

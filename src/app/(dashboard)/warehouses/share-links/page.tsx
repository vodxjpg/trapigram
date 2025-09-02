// src/app/(dashboard)/warehouses/share-links/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Edit, Trash2, ArrowLeft, Copy } from "lucide-react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

type ShareLink = {
  shareLinkId: string;
  warehouseId: string;
  warehouseName: string;
  token: string;
  status: string;
  recipients: { userId: string; email: string; name: string | null }[];
  products: {
    productId: string;
    variationId: string | null;
    title: string;
    cost: Record<string, number>;
  }[];
  createdAt: string;
};

export default function ShareLinksPage() {
  const router = useRouter();

  // active organization → permission hook
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const {
    hasPermission: canShareLinks,
    isLoading:     shareLoading,
  } = useHasPermission(organizationId, { warehouses: ["sharing"] });

  // redirect away if no "sharing" permission
  useEffect(() => {
    if (!shareLoading && !canShareLinks) {
      router.replace("/warehouses");
    }
  }, [shareLoading, canShareLinks, router]);

  if (shareLoading || !canShareLinks) return null;

  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // load share links on mount
    (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/users/me/share-links");
        if (!response.ok) throw new Error("Failed to fetch share links");
        const data = await response.json();
        setShareLinks(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error fetching share links:", error);
        toast.error("Failed to load share links");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDelete = async (shareLinkId: string) => {
    if (!confirm("Are you sure you want to delete this share link?")) return;
    try {
      const response = await fetch("/api/users/me/share-links", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareLinkId }),
      });
      if (!response.ok) throw new Error("Failed to delete share link");
      toast.success("Share link deleted successfully");
      // refresh list
      setShareLinks((prev) => prev.filter((s) => s.shareLinkId !== shareLinkId));
    } catch (error) {
      console.error("Error deleting share link:", error);
      toast.error("Failed to delete share link");
    }
  };

  const handleCopyLink = async (token: string) => {
    const shareLinkUrl = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(shareLinkUrl);
      toast.success("Share link copied to clipboard!");
    } catch (error) {
      console.error("Error copying share link:", error);
      toast.error("Failed to copy share link");
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => router.push("/warehouses")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Warehouses
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Share Links</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manage Share Links</CardTitle>
          <p className="text-muted-foreground">
            View and manage the share links you have created for your warehouses.
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : shareLinks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No share links found.
                    </TableCell>
                  </TableRow>
                ) : (
                  shareLinks.map((link) => {
                    const products = Array.isArray(link.products)
                      ? link.products
                      : [];
                    const visible = products.slice(0, 3);

                    return (
                      <TableRow key={link.shareLinkId}>
                        <TableCell className="font-medium">
                          {link.warehouseName}
                        </TableCell>
                        <TableCell>
                          {link.recipients.map((r) => (
                            <Badge
                              key={r.userId}
                              variant="outline"
                              className="mr-1"
                            >
                              {r.name || r.email}
                            </Badge>
                          ))}
                        </TableCell>
                        <TableCell>
                          {visible.map((p) => (
                            <Badge
                              key={`${p.productId}-${p.variationId ?? "none"}`}
                              variant="outline"
                              className="mr-1"
                            >
                              {p.title}
                            </Badge>
                          ))}
                          {products.length > 3 && (
                            <Badge variant="outline" className="mr-1">
                              …
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {new Date(link.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCopyLink(link.token)}
                            >
                              <Copy className="h-4 w-4 mr-1" />
                              Copy Link
                            </Button>
                            <Button variant="outline" size="sm" asChild>
                              <Link
                                href={`/warehouses/share-links/${link.shareLinkId}`}
                              >
                                <Edit className="h-4 w-4 mr-1" />
                                Edit
                              </Link>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(link.shareLinkId)}
                              className="text-destructive border-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

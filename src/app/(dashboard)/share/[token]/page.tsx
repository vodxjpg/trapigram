"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Select from "react-select";
import { ArrowLeft } from "lucide-react";

type SharedProduct = {
  productId: string;
  variationId: string | null;
  title: string;
  cost: Record<string, number>;
};

type ShareLink = {
  id: string;
  token: string;
  warehouse: {
    id: string;
    name: string;
    countries: string[];
  };
  creator: {
    id: string;
    email: string;
    name: string | null;
  };
  products: SharedProduct[];
};

type Warehouse = {
  id: string;
  name: string;
};

const formSchema = z.object({
  warehouseId: z.string().min(1, "Please select a warehouse"),
});

type FormValues = z.infer<typeof formSchema>;

export default function ShareLinkPage() {
  const router = useRouter();
  const params = useParams<{ token?: string | string[] }>();
  const token =
    Array.isArray(params?.token) ? params?.token?.[0] ?? "" : params?.token ?? "";
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      warehouseId: "",
    },
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch share link details
        const shareResponse = await fetch(`/api/share-links/${token}`);
        if (!shareResponse.ok) {
          const errorData = await shareResponse.json();
          throw new Error(errorData.error || "Failed to load share link");
        }
        const data = await shareResponse.json();
        setShareLink(data.shareLink);

        // Fetch user's warehouses
        const warehouseResponse = await fetch("/api/warehouses");
        if (!warehouseResponse.ok) {
          throw new Error("Failed to load warehouses");
        }
        const warehouseData = await warehouseResponse.json();
        setWarehouses(warehouseData.warehouses);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
        toast.error(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
}, [token]);

  const onSubmit = async (values: FormValues) => {
    try {
      const response = await fetch("/api/warehouses/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shareLinkId: shareLink?.id,
          warehouseId: values.warehouseId,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to sync warehouse");
      }
      toast.success("Warehouse synced successfully");
      router.push("/warehouses");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    }
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (error || !shareLink) {
    return (
      <div className="p-6">
        <Button variant="outline" onClick={() => router.push("/warehouses")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Warehouses
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive">{error || "Share link not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Button variant="outline" onClick={() => router.push("/warehouses")} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Warehouses
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Shared Warehouse: {shareLink.warehouse.name}</CardTitle>
          <p className="text-muted-foreground">
            Shared by {shareLink.creator.name || shareLink.creator.email}
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">Products</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Costs by Country</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shareLink.products.map((product) => (
                    <TableRow key={`${product.productId}-${product.variationId || "none"}`}>
                      <TableCell>{product.title}</TableCell>
                      <TableCell>
                        {Object.entries(product.cost).map(([country, cost]) => (
                          <div key={country}>
                            {country}: {cost}
                          </div>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="warehouseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Select Warehouse to Sync</FormLabel>
                      <FormControl>
                        <Select
                          options={warehouses.map((w) => ({
                            value: w.id,
                            label: w.name,
                          }))}
                          value={
                            field.value
                              ? { value: field.value, label: warehouses.find((w) => w.id === field.value)?.name }
                              : null
                          }
                          onChange={(option) => field.onChange(option?.value || "")}
                          placeholder="Select a warehouse"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit">Sync to Warehouse</Button>
              </form>
            </Form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
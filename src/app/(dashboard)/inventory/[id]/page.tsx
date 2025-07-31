"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

type InventoryData = {
  id: string;
  reference: string;
  name: string;
  countType: "all" | "specific";
  createdAt: string;
};

interface Product {
  id: string;
  name: string;
  sku: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  country: string; // <- importante
}

export default function InventoryDetailPage() {
  const { id } = useParams();
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[]>([]);

  // Product table state
  const [currentPage, setCurrentPage] = useState(1);
  const [countedValues, setCountedValues] = useState<Record<string, string>>(
    {}
  );
  const [products, setProducts] = useState<Product[]>([]);
  const itemsPerPage = 10;

  const parsePostgresArray = (str: string): string[] => {
    return str
      .replace(/[{}"]/g, "")
      .split(",")
      .map((c) => c.trim());
  };

  useEffect(() => {
    async function fetchInventory() {
      try {
        const response = await fetch(`/api/inventory/${id}`);
        if (!response.ok) throw new Error("Inventory not found");
        const data = await response.json();
        const { inventory, countProduct } = data;

        setInventory(inventory);

        const parsedCountries = parsePostgresArray(inventory.countries);
        setCountries(parsedCountries);

        const parsedProducts: Product[] = countProduct.map((p, index) => ({
          id: `${p.sku}-${p.country}-${index}`, // unique id
          name: p.title,
          sku: p.sku,
          expectedQuantity: p.expectedQuantity,
          countedQuantity: null,
          country: p.country,
        }));

        setProducts(parsedProducts);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    if (id) fetchInventory();
  }, [id]);

  const handleCountedChange = (productId: string, value: string) => {
    setCountedValues((prev) => ({ ...prev, [productId]: value }));
  };

  const handleSave = (productId: string) => {
    const value = countedValues[productId];
    if (value) {
      setProducts((prev) =>
        prev.map((product) =>
          product.id === productId
            ? { ...product, countedQuantity: Number.parseInt(value) }
            : product
        )
      );
      setCountedValues((prev) => {
        const newValues = { ...prev };
        delete newValues[productId];
        return newValues;
      });
    }
  };

  const getFilteredProducts = (
    country: string,
    status: "to-be-counted" | "counted"
  ) => {
    return products.filter((product) => {
      return (
        product.country === country &&
        (status === "to-be-counted"
          ? product.countedQuantity === null
          : product.countedQuantity !== null)
      );
    });
  };

  const ProductTable = ({
    country,
    status,
  }: {
    country: string;
    status: "to-be-counted" | "counted";
  }) => {
    const filteredProducts = getFilteredProducts(country, status);
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const paginatedProducts = filteredProducts.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );

    return (
      <div className="space-y-4">
        <div className="text-sm text-gray-600 mb-4">
          Showing products for {country} -{" "}
          {status === "to-be-counted" ? "To be counted" : "Counted"}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Expected Quantity</TableHead>
              <TableHead>Counted Quantity</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedProducts.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell>{product.sku}</TableCell>
                <TableCell>{product.expectedQuantity}</TableCell>
                <TableCell>
                  {status === "counted" ? (
                    <span className="text-gray-900">
                      {product.countedQuantity}
                    </span>
                  ) : (
                    <Input
                      type="number"
                      placeholder="0"
                      value={countedValues[product.id] || ""}
                      onChange={(e) =>
                        handleCountedChange(product.id, e.target.value)
                      }
                      className="w-20"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {status === "to-be-counted" && (
                    <Button
                      size="sm"
                      onClick={() => handleSave(product.id)}
                      disabled={!countedValues[product.id]}
                    >
                      Save
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(currentPage * itemsPerPage, filteredProducts.length)} of{" "}
            {filteredProducts.length} products
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((prev) => Math.min(prev + 1, totalPages))
              }
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <p className="p-4 text-sm">Loading...</p>;
  if (error) return <p className="p-4 text-sm text-red-500">{error}</p>;
  if (!inventory) return <p className="p-4 text-sm">Inventory not found.</p>;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">
        Inventory Count Details
      </h1>

      {/* First Card - Count Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium text-black">
            Count info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Warehouse
                </span>
                <span className="text-sm text-gray-600">{inventory.name}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Reference
                </span>
                <span className="text-sm text-gray-600">
                  {inventory.reference}
                </span>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Count type
                </span>
                <span className="text-sm text-gray-600">
                  {inventory.countType}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Count started on
                </span>
                <span className="text-sm text-gray-600">
                  {new Date(inventory.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-6 space-y-2">
            <Label
              htmlFor="notes"
              className="text-sm font-medium text-gray-900"
            >
              Additional Notes
            </Label>
            <Textarea
              id="notes"
              placeholder="Enter additional notes..."
              className="min-h-[100px] resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Second Card - Products */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium text-black">
            Inventory Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="to-be-counted" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="to-be-counted">To be counted</TabsTrigger>
              <TabsTrigger value="counted">Counted</TabsTrigger>
            </TabsList>

            <TabsContent value="to-be-counted" className="mt-4">
              <Tabs defaultValue={countries[0] || ""} className="w-full">
                <TabsList
                  className={`grid w-full grid-cols-${countries.length}`}
                >
                  {countries.map((country) => (
                    <TabsTrigger key={country} value={country}>
                      {country}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {countries.map((country) => (
                  <TabsContent key={country} value={country} className="mt-4">
                    <ProductTable country={country} status="to-be-counted" />
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>

            <TabsContent value="counted" className="mt-4">
              <Tabs defaultValue="GB" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="GB">GB</TabsTrigger>
                  <TabsTrigger value="US">US</TabsTrigger>
                  <TabsTrigger value="ES">ES</TabsTrigger>
                </TabsList>

                {countries.map((country) => (
                  <TabsContent key={country} value={country} className="mt-4">
                    <ProductTable country={country} status="counted" />
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

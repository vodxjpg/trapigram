// components/InventoryItems.tsx
"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface Product {
    id: string;
    productId: string;
    name: string;
    sku: string;
    expectedQuantity: number;
    countedQuantity: number | null;
    country: string;
    variationId: string | null;
    isCounted: boolean;
    discrepancyReason: string;
}

export interface InventoryItemsProps {
    products: Product[];
    countriesToBeCounted: string[];
    countriesCounted: string[];
    itemsPerPage: number;
    currentPage: number;
    setCurrentPage: (n: number) => void;

    countedValues: Record<string, string>;
    handleCountedChange: (productId: string, value: string) => void;

    canUpdate: boolean;
    savingRows: Record<string, boolean>;
    handleSave: (rowId: string) => void | Promise<void>;
}

export default function InventoryItems(props: InventoryItemsProps) {
    const {
        products,
        countriesToBeCounted,
        countriesCounted,
        itemsPerPage,
        currentPage,
        setCurrentPage,
        countedValues,
        handleCountedChange,
        canUpdate,
        savingRows,
        handleSave,
    } = props;

    const getFilteredProducts = useMemo(() => {
        return (country: string, status: "to-be-counted" | "counted") =>
            products.filter((product) => {
                return (
                    product.country === country &&
                    (status === "to-be-counted" ? product.isCounted === false : product.isCounted === true)
                );
            });
    }, [products]);

    function ProductTable({
        country,
        status,
    }: {
        country: string;
        status: "to-be-counted" | "counted";
    }) {
        const filteredProducts = getFilteredProducts(country, status);
        const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
        const page = Math.min(currentPage, totalPages);
        const paginatedProducts = filteredProducts.slice(
            (page - 1) * itemsPerPage,
            page * itemsPerPage
        );
        const isCountedView = status === "counted";

        return (
            <div className="space-y-4">
                <div className="text-sm text-gray-600 mb-4">
                    Showing products for {country} - {isCountedView ? "Counted" : "To be counted"}
                </div>

                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead>Expected Quantity</TableHead>
                            <TableHead>Counted Quantity</TableHead>
                            {isCountedView ? <TableHead>Discrepancy Reason</TableHead> : <TableHead>Action</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {paginatedProducts.map((product) => (
                            <TableRow key={product.id}>
                                <TableCell className="font-medium">{product.name}</TableCell>
                                <TableCell>{product.sku}</TableCell>
                                <TableCell>{product.expectedQuantity}</TableCell>
                                <TableCell>
                                    {isCountedView ? (
                                        <span className="text-gray-900">{product.countedQuantity}</span>
                                    ) : (
                                        <Input
                                            type="number"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            min={0}
                                            step={1}
                                            placeholder="0"
                                            value={countedValues[product.id] ?? ""}
                                            onChange={(e) => handleCountedChange(product.id, e.target.value)}
                                            className="w-20"
                                            disabled={!canUpdate || !!savingRows[product.id]}
                                        />
                                    )}
                                </TableCell>

                                {isCountedView ? (
                                    <TableCell>
                                        {product.discrepancyReason?.trim() ? product.discrepancyReason : "-"}
                                    </TableCell>
                                ) : (
                                    <TableCell>
                                        <Button
                                            size="sm"
                                            onClick={() => handleSave(product.id)}
                                            disabled={
                                                countedValues[product.id] === undefined ||
                                                countedValues[product.id] === "" ||
                                                !canUpdate ||
                                                !!savingRows[product.id]
                                            }
                                        >
                                            Save
                                        </Button>
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                {/* Pagination */}
                <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                        Showing {(page - 1) * itemsPerPage + 1} to{" "}
                        {Math.min(page * itemsPerPage, filteredProducts.length)} of {filteredProducts.length} products
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(Math.max(page - 1, 1))}
                            disabled={page === 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                        </Button>
                        <span className="text-sm">
                            Page {page} of {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(Math.min(page + 1, totalPages))}
                            disabled={page === totalPages}
                        >
                            Next
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-medium text-black">Inventory Items</CardTitle>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="to-be-counted" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="to-be-counted">To be counted</TabsTrigger>
                        <TabsTrigger value="counted">Counted</TabsTrigger>
                    </TabsList>

                    <TabsContent value="to-be-counted" className="mt-4">
                        <Tabs defaultValue={countriesToBeCounted[0] || ""} className="w-full">
                            <TabsList className="flex flex-wrap gap-2 w-full">
                                {countriesToBeCounted.map((country) => (
                                    <TabsTrigger key={country} value={country}>
                                        {country}
                                    </TabsTrigger>
                                ))}
                            </TabsList>

                            {countriesToBeCounted.map((country) => (
                                <TabsContent key={country} value={country} className="mt-4">
                                    <ProductTable country={country} status="to-be-counted" />
                                </TabsContent>
                            ))}
                        </Tabs>
                    </TabsContent>

                    <TabsContent value="counted" className="mt-4">
                        <Tabs defaultValue={countriesCounted[0] || ""} className="w-full">
                            <TabsList className="flex flex-wrap gap-2 w-full">
                                {countriesCounted.map((country) => (
                                    <TabsTrigger key={country} value={country}>
                                        {country}
                                    </TabsTrigger>
                                ))}
                            </TabsList>

                            {countriesCounted.map((country) => (
                                <TabsContent key={country} value={country} className="mt-4">
                                    <ProductTable country={country} status="counted" />
                                </TabsContent>
                            ))}
                        </Tabs>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}

"use client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, DollarSign, Package, Tag, Truck, User } from "lucide-react";
import { useOrderCreate } from "./use-order-create";
import { ClientSelect } from "./components/ClientSelect";
import { ProductSelect } from "./components/ProductSelect";
import { CartItemsList } from "./components/CartItemsList";
import { CouponForm } from "./components/CouponForm";
import { AddressSection } from "./components/AddressSection";
import { ShippingSelector } from "./components/ShippingSelector";
import { PaymentSelector } from "./components/PaymentSelector";
import { SummaryCard } from "./components/SummaryCard";
import { tokenOf, stockForCountry, inCartQty } from "./utils";

export default function OrderCreatePage() {
  const s = useOrderCreate();

  // helpers used by ProductSelect UI
  const categoryLabel = (id?: string) => (id ? (s as any).categoryMap?.[id] || id : "Uncategorized");
  const groupByCategory = (arr: any[]) => {
    const buckets: Record<string, any[]> = {};
    for (const p of arr) {
      if (p.isAffiliate) continue;
      const firstCat = p.categories?.[0];
      const label = categoryLabel(firstCat);
      if (!buckets[label]) buckets[label] = [];
      buckets[label].push(p);
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, items]) => [label, items.sort((x: any, y: any) => x.title.localeCompare(y.title))]) as Array<[string, any[]]>;
  };
  const stockLeft = (p: any) => {
    const hasFinite = Object.keys(p.stockData || {}).length > 0;
    const remaining = hasFinite
      ? Math.max(0, stockForCountry(p, s.clientCountry) - inCartQty(p.id, p.variationId ?? null, s.orderItems))
      : Infinity;
    const disabled = hasFinite ? remaining === 0 && !p.allowBackorders : false;
    return { remaining, hasFinite, disabled };
  };

  const clientEmail = [...s.filteredClients, ...s.searchResults].find(c => c.id === s.selectedClient)?.email;

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Create New Order</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT */}
        <div className="lg:col-span-2 space-y-6">

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Client Selection</CardTitle></CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <ClientSelect
                  disabled={s.orderGenerated}
                  clientsLoading={s.clientsLoading}
                  filteredClients={s.filteredClients}
                  searchResults={s.searchResults}
                  searching={s.searching}
                  searchTerm={s.searchTerm}
                  setSearchTerm={s.setSearchTerm}
                  selectedClient={s.selectedClient}
                  pickClient={s.pickClient}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={s.generateOrder} disabled={!s.selectedClient || s.orderGenerated}>Generate Order</Button>
              </div>
            </CardContent>
          </Card>

          <Card className={!s.orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Product Selection</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {s.orderItems.length > 0 && (
                <CartItemsList
                  items={s.orderItems}
                  clientCountry={s.clientCountry}
                  onUpdate={s.updateQuantity}
                  onRemove={s.removeProduct}
                />
              )}
              <ProductSelect
                disabled={!s.orderGenerated}
                products={s.products}
                productsLoading={s.productsLoading}
                clientCountry={s.clientCountry}
                orderItems={s.orderItems}
                selectedProduct={s.selectedProduct}
                setSelectedProduct={s.setSelectedProduct}
                quantityText={s.quantityText}
                setQuantityText={s.setQuantityText}
                addProduct={s.addProduct}
                groupByCategory={groupByCategory}
                stockLeft={stockLeft}
              />
            </CardContent>
          </Card>

          <Card className={!s.orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader><CardTitle className="flex items-center gap-2"><Tag className="h-5 w-5" /> Discount Coupon</CardTitle></CardHeader>
            <CardContent>
              <CouponForm
                country={s.clientCountry}
                couponCode={s.couponCode}
                setCouponCode={s.setCouponCode}
                appliedCodes={s.appliedCodes}
                discountTotal={s.discountTotal}
                breakdown={s.couponBreakdown}
                onApply={s.applyCoupon}
              />
            </CardContent>
          </Card>

          {s.orderGenerated && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Shipping Address</CardTitle></CardHeader>
              <CardContent>
                <AddressSection
                  addresses={s.addresses}
                  selectedAddressId={s.selectedAddressId}
                  setSelectedAddressId={s.setSelectedAddressId}
                  newAddress={s.newAddress}
                  setNewAddress={s.setNewAddress}
                  onAddAddress={s.addAddress}
                />
              </CardContent>
            </Card>
          )}

          <Card className={!s.orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader><CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Shipping</CardTitle></CardHeader>
            <CardContent>
              <ShippingSelector
                loading={s.shippingLoading}
                totalBefore={s.totalBefore}
                methods={s.shippingMethods}
                companies={s.shippingCompanies}
                selectedMethod={s.selectedShippingMethod}
                setSelectedMethod={s.setSelectedShippingMethod}
                selectedCompany={s.selectedShippingCompany}
                setSelectedCompany={s.setSelectedShippingCompany}
              />
            </CardContent>
          </Card>

          <Card className={!s.orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Payment Method</CardTitle></CardHeader>
            <CardContent>
              <PaymentSelector
                disabled={!s.orderGenerated}
                methods={s.paymentMethods}
                selected={s.selectedPaymentMethod}
                setSelected={s.setSelectedPaymentMethod}
                niftipayNetworks={s.niftipayNetworks}
                niftipayLoading={s.niftipayLoading}
                selectedNifti={s.selectedNiftipay}
                setSelectedNifti={s.setSelectedNiftipay}
              />
            </CardContent>
          </Card>
        </div>

        {/* RIGHT */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" /> Order Summary</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {s.orderGenerated ? (
                <SummaryCard
                  clientEmail={clientEmail}
                  itemsCount={s.orderItems.length}
                  discountTotal={s.discountTotal}
                  shippingCost={s.shippingCost}
                  itemsSubtotal={s.itemsSubtotal}
                  totalBefore={s.totalBefore}
                  total={s.total}
                  country={s.clientCountry}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Generate a cart to see the summary</p>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={s.cancelOrder}>Cancel</Button>
                <Button onClick={async () => { const id = await s.createOrder(); if (id) window.location.assign(`/orders/${id}`); }} disabled={!s.orderGenerated}>
                  Create Order
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

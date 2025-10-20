"use client";

import * as React from "react";

export function useCustomerDisplay(registerId: string | null) {
  const push = React.useCallback(async (payload: any) => {
    if (!registerId) return;
    try {
      await fetch(`/api/pos/registers/${registerId}/customer-display/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {/* ignore */}
  }, [registerId]);

  // helper to push a "cart" snapshot
  const pushCart = React.useCallback(
    (args: {
      cartId: string;
      lines: Array<{ title: string; quantity: number; unitPrice: number; sku?: string | null }>;
      subtotal: number; discount: number; shipping: number; total: number;
    }) => push({ type: "cart", ...args }),
    [push]
  );

  // helper to push a niftipay invoice
  const pushNiftipay = React.useCallback(
    (args: { asset: string; network: string; amount: number; address: string; qr?: string }) =>
      push({ type: "niftipay", ...args }),
    [push]
  );

  return { push, pushCart, pushNiftipay };
}

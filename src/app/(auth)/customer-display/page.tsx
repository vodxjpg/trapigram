// src/app/customer-display/page.tsx
"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import Pusher from "pusher-js";

type CartLine = {
  title: string; quantity: number; unitPrice: number; sku?: string | null;
  subtotal: number; image?: string | null;
};

type EventPayload =
  | { type: "hello" | "ping" }
  | { type: "cart"; cartId: string; lines: CartLine[]; subtotal: number; discount: number; shipping: number; total: number; notes?: string }
  | { type: "niftipay"; asset: string; network: string; amount: number; address: string; qr?: string }
  | { type: "idle" };

function Money({ n }: { n: number }) { return <span>${n.toFixed(2)}</span>; }

function Inner() {
  const _sp = useSearchParams(); // can also use ?transport=sse|poll
  const [stage, setStage] = React.useState<"pair"|"live">("pair");
  const [pairCode, setPairCode] = React.useState("");
  const [registerId, setRegisterId] = React.useState("");
  const [sessionId, setSessionId] = React.useState("");
  const [last, setLast] = React.useState<EventPayload | null>(null);
  const [connectedVia, setConnectedVia] = React.useState<"pusher"|"sse"|"poll" | null>(null);

  const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  const FORCE_SSE = process.env.NEXT_PUBLIC_CD_FORCE_SSE === "1";

  async function pair() {
    const r = await fetch("/api/pos/display/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairCode.trim() }),
    });
    if (!r.ok) { alert("Invalid code"); return; }
    const j = await r.json();
    setRegisterId(j.registerId);
    setSessionId(j.sessionId);
    setStage("live");
  }

  React.useEffect(() => {
    if (stage !== "live" || !registerId || !sessionId) return;

    // warm start from Upstash (last event)
    (async () => {
      try {
        const r = await fetch(`/api/pos/registers/${registerId}/customer-display/recent?limit=1`, { cache: "no-store" });
        const j = await r.json();
        if (Array.isArray(j.events) && j.events[0]) setLast(j.events[0]);
      } catch {}
    })();

    const spTransport = _sp.get("transport"); // "sse" | "poll" | null
    const wantPoll = spTransport === "poll";
    const wantSse = spTransport === "sse" || FORCE_SSE || !PUSHER_KEY || !PUSHER_CLUSTER;

    let cleanup: (() => void) | undefined;
    let pollTimer: any;

    function startPolling() {
      setConnectedVia("poll");
      pollTimer = setInterval(async () => {
        try {
          const r = await fetch(`/api/pos/registers/${registerId}/customer-display/recent?limit=1`, { cache: "no-store" });
          const j = await r.json();
          const ev = Array.isArray(j.events) ? j.events[0] : null;
          if (ev && JSON.stringify(ev) !== JSON.stringify(last)) setLast(ev);
        } catch {}
      }, 1500);
      cleanup = () => clearInterval(pollTimer);
    }

    if (wantPoll) {
      startPolling();
      return () => cleanup?.();
    }

    if (wantSse) {
      const url = `/api/pos/registers/${registerId}/customer-display/stream?sessionId=${encodeURIComponent(sessionId)}`;
      const es = new EventSource(url);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data?.type !== "ping" && data?.type !== "hello") setLast(data);
        } catch {}
      };
      es.onerror = () => {
        // network/serverless hiccup? fallback to polling
        es.close();
        startPolling();
      };
      setConnectedVia("sse");
      cleanup = () => es.close();
      return () => cleanup?.();
    }

    // fallback to Pusher only if keys exist and not forcing SSE
    const p = new Pusher(PUSHER_KEY!, {
      cluster: PUSHER_CLUSTER!,
      authEndpoint: "/api/pos/display/pusher-auth",
      auth: { params: { registerId, sessionId } },
    });
    const chName = `private-cd.${registerId}.${sessionId}`;
    const ch = p.subscribe(chName);
    const handler = (data: any) => {
      if (data?.type !== "ping" && data?.type !== "hello") setLast(data);
    };
    ch.bind("event", handler);
    setConnectedVia("pusher");
    cleanup = () => { ch.unbind("event", handler); p.unsubscribe(chName); p.disconnect(); };
    return () => cleanup?.();

  }, [stage, registerId, sessionId, PUSHER_KEY, PUSHER_CLUSTER, _sp, FORCE_SSE, last]);

  return (
    <div className="min-h-screen bg-muted/30 grid place-items-center p-6">
      {stage === "pair" ? (
        <Card className="w-full max-w-xl p-6 space-y-4 text-center">
          <h1 className="text-3xl font-bold">Customer Display</h1>
          <p className="text-muted-foreground">Enter the 6-digit code shown on the POS register.</p>
          <div className="grid grid-cols-5 gap-2">
            <div className="col-span-4">
              <Label>6-digit pairing code</Label>
              <Input
                inputMode="numeric"
                maxLength={6}
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-2xl text-center tracking-widest font-mono"
                placeholder="••••••"
              />
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={pair} disabled={pairCode.length !== 6}>Pair</Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="w-full grid grid-cols-12 gap-6">
          <Card className="col-span-4 p-6 flex flex-col items-center justify-between">
            <div className="text-center">
              <div className="text-xs tracking-widest text-muted-foreground mb-2">GET YOUR RECEIPT</div>
              <Input placeholder="Enter email address" />
              <Button className="mt-3 w-full">Add details</Button>
            </div>
            <div className="opacity-80 text-[11px]">
              {connectedVia ? `Connected via ${connectedVia.toUpperCase()}` : "Connecting…"}
            </div>
          </Card>

          <Card className="col-span-8 p-6">
            {!last || last.type === "idle" ? (
              <div className="h-[520px] grid place-items-center text-muted-foreground">
                <div className="text-center">
                  <div className="text-xl font-medium">Waiting for cart…</div>
                  <div>Start a sale on the POS register.</div>
                </div>
              </div>
            ) : last.type === "cart" ? (
              <div className="flex flex-col h-[520px]">
                <div className="flex-1 overflow-auto pr-2 space-y-3">
                  {(last.lines || []).map((l, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate">{l.quantity} × {l.title}</div>
                        {l.sku && <div className="text-xs text-muted-foreground">SKU: {l.sku}</div>}
                      </div>
                      <div className="font-medium"><Money n={l.subtotal} /></div>
                    </div>
                  ))}
                </div>
                <Separator className="my-3" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><Money n={last.subtotal} /></div>
                  <div className="flex justify-between"><span>Discount</span><Money n={last.discount} /></div>
                  <div className="flex justify-between"><span>Shipping</span><Money n={last.shipping} /></div>
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span><Money n={last.total} />
                  </div>
                </div>
              </div>
            ) : last.type === "niftipay" ? (
              <div className="h-[520px] grid place-items-center">
                <div className="text-center space-y-3">
                  <div className="text-lg font-semibold">Pay with Crypto</div>
                  <div className="text-sm text-muted-foreground">
                    Send {last.amount} {last.asset} on {last.network}
                  </div>
                  {last.qr ? (<img alt="QR" src={last.qr} className="h-44 w-44 mx-auto" />) : null}
                  <div className="font-mono text-xs break-all">{last.address}</div>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center p-8">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}

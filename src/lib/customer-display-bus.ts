// Unified bus: Pusher (fanout) + Upstash (short replay) + local fallback

import { pusher } from "@/lib/pusher-server";
import { lpushRecent } from "@/lib/pubsub";
import { EventEmitter } from "events";

const hasPusher =
  !!process.env.PUSHER_APP_ID &&
  !!process.env.PUSHER_KEY &&
  !!process.env.PUSHER_SECRET &&
  !!process.env.PUSHER_CLUSTER;

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

const local = (() => {
  const _g = globalThis as any;
  return (_g.__cd_local_bus ||= new EventEmitter());
})();

export type DisplayEvent =
  | { type: "hello" | "ping" | "idle" }
  | {
      type: "cart";
      cartId: string;
      lines: Array<{
        title: string;
        quantity: number;
        unitPrice: number;
        sku?: string | null;
        subtotal: number;
        image?: string | null;
      }>;
      subtotal: number;
      discount: number;
      shipping: number;
      total: number;
      notes?: string;
    }
  | {
      type: "niftipay";
      asset: string;
      network: string;
      amount: number;
      address: string;
      qr?: string; // data:URL if available
    };

export function channelName(registerId: string, sessionId: string) {
  // Pusher requires "private-" prefix for private channels
  return `private-cd.${registerId}.${sessionId}`;
}
export function replayKey(registerId: string) {
  return `cd:recent:${registerId}`;
}

/** Fanout + cache (called by POS) */
export async function publishDisplayEvent(
  registerId: string,
  sessionId: string,
  evt: DisplayEvent
) {
  // 1) Pusher fanout
  if (hasPusher) {
    try {
      await pusher.trigger(channelName(registerId, sessionId), "event", evt);
    } catch (e) {
      console.error("[cd-bus] pusher.trigger failed", e);
    }
  } else {
    // local dev bus
    local.emit(channelName(registerId, sessionId), evt);
  }

  // 2) Short replay buffer (optional)
  if (hasUpstash) {
    try {
      // keep last 50 per register (session-agnostic)
      await lpushRecent(replayKey(registerId), evt, 50, 7 * 24 * 3600);
    } catch (e) {
      console.error("[cd-bus] upstash lpushRecent failed", e);
    }
  }
}

/** Local fallback subscribe for dev (SSE kept working if no Pusher) */
export function subscribeLocal(
  registerId: string,
  sessionId: string,
  cb: (e: DisplayEvent) => void
) {
  const ch = channelName(registerId, sessionId);
  const h = (e: DisplayEvent) => cb(e);
  local.on(ch, h);
  return () => local.off(ch, h);
}

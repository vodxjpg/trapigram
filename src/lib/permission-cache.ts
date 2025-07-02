/* -------------------------------------------------------------------------- */
/*  src/lib/permission-cache.ts                                               */
/* -------------------------------------------------------------------------- */
"use client";

/* augment window for TS – has zero runtime impact on the server */
declare global {
  interface Window {
    __permissionGeneration__?: number;
  }
}

/* all runtime work happens only in the browser */
if (typeof window !== "undefined") {
  window.addEventListener("better-auth:invalidate-cache", () => {
    window.__permissionGeneration__ =
      (window.__permissionGeneration__ || 0) + 1;
  });
}

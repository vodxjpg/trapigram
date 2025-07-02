/* -------------------------------------------------------------------------- */
/*  src/lib/permission-cache.ts                                               */
/* -------------------------------------------------------------------------- */

/* augment window for TS – has zero runtime impact on the server */
declare global {
    interface Window { __permissionGeneration__?: number }
  }
  
  // runtime – guarded
  if (typeof window !== "undefined") {
    window.addEventListener("better-auth:invalidate-cache", () => {
      window.__permissionGeneration__ = (window.__permissionGeneration__ || 0) + 1;
    });
  }
  
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
declare global {
    interface Window { __permissionGeneration__?: number }
  }
  
  window.addEventListener("better-auth:invalidate-cache", () => {
    window.__permissionGeneration__ = (window.__permissionGeneration__ || 0) + 1;
  });
  
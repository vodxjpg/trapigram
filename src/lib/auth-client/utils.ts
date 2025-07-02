/* -------------------------------------------------------------------
 * src/lib/auth-client/utils.ts
 * -------------------------------------------------------------------
 * Small utilities shared by the in-browser auth client helpers
 * (get-member, set-active-org, etc.).
 * ------------------------------------------------------------------- */

/**
 * A thin wrapper around fetch that
 *   • always sends cookies (credentials: "include")
 *   • applies sensible JSON defaults
 *   • throws if the response is not ok (status 200–299)
 *
 * Usage:
 *   const json = await authFetch("/api/…");          // GET
 *   const json = await authFetch("/api/…", {         // POST
 *     method: "POST",
 *     body: JSON.stringify({ … }),
 *   });
 */
export async function authFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) {
    // --- default options ------------------------------------------------------
    const defaults: RequestInit = {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };
  
    // deep-merge headers while respecting caller overrides
    const headers = {
      ...(defaults.headers as Record<string, string>),
      ...(init.headers as Record<string, string> | undefined),
    };
  
    const res = await fetch(input, { ...defaults, ...init, headers });
  
    if (!res.ok) {
      // Preserve statusCode for callers who need finer error handling
      const error = new Error(res.statusText);
      (error as any).status = res.status;
      throw error;
    }
  
    // Some endpoints may legitimately return 204 No-Content
    if (res.status === 204) return null;
  
    return res.json();
  }
  
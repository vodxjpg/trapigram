'use server';
import 'server-only';

/**
 * Wrapper for server-to-server calls.
 * Automatically injects the INTERNAL_API_SECRET header so that
 * client code never sees it.
 */
export async function internalFetch(
  input: RequestInfo,
  init: RequestInit = {},
) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET is not configured.');
  }

  const headers = new Headers(init.headers);
  headers.set('x-internal-secret', secret);

  return fetch(input, { ...init, headers, credentials: 'include' });
}

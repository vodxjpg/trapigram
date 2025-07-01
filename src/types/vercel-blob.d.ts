// src/types/vercel-blob.d.ts  ← NEW (silences TS in local dev)
declare module "@vercel/blob" {
    export interface PutOptions {
      access?: "public" | "private";
      contentType?: string;
    }
    export function put(
      pathname: string,
      data: ArrayBuffer | Uint8Array | Buffer,
      opts?: PutOptions,
    ): Promise<{ url: string }>;
  }
  
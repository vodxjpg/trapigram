// src/lib/readKey.ts
import fs from "fs";
import path from "path";

const isProd = process.env.NODE_ENV === "production";

/** Load a PEM key from ENV value or file path.
 *  - If the input starts with "-----BEGIN", treat it as an inline PEM.
 *  - Otherwise treat it as a path relative to project root.
 *  - In dev, do NOT hard-fail if the file isn't present.
 */
export function loadKey(src?: string): string {
  if (!src) return "";

  // Inline PEM support (also handles ENV with literal \n)
  if (src.startsWith("-----BEGIN")) {
    return src.replace(/\\n/g, "\n").trim();
  }

  // If you passed an ENV var value here, prefer it:
  const inlineFromEnv =
    process.env.JWT_PUBLIC_KEY ?? process.env.JWT_PUBLIC_KEY_DEV;
  if (inlineFromEnv?.trim().startsWith("-----BEGIN")) {
    return inlineFromEnv.replace(/\\n/g, "\n").trim();
  }

  // Path on disk
  const abs = path.resolve(process.cwd(), src);

  // In dev: avoid ENOENT. Use inline dev key if present; otherwise return "" and let caller decide.
  if (!isProd && !fs.existsSync(abs)) {
    const dev = process.env.JWT_PUBLIC_KEY_DEV ?? process.env.JWT_PUBLIC_KEY;
    if (dev?.trim()) return dev.replace(/\\n/g, "\n").trim();
    return ""; // no crash during local build
  }

  // Prod (or dev with file present)
  return fs.readFileSync(abs, "utf8").trim();
}

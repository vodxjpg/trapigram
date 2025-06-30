import fs from "fs";
import path from "path";

/** Load a PEM key from ENV or file-path.  
 *  – If the value starts with “-----BEGIN” it is assumed to be the key itself  
 *    (inline ENV) and any  “\\n”  sequences are replaced with real line-breaks.  
 *  – Otherwise it is treated as a path relative to project root. */
export function loadKey(srcEnv?: string) {
  if (!srcEnv) return "";

  if (srcEnv.startsWith("-----BEGIN")) {
    // convert literal \n → real LF
    return srcEnv.replace(/\\n/g, "\n").trim();
  }

  const abs = path.resolve(process.cwd(), srcEnv);
  return fs.readFileSync(abs, "utf8").trim();
}

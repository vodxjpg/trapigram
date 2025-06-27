import fs from "fs";
import path from "path";

export function loadKey(srcEnv?: string) {
  if (!srcEnv) return "";
  if (srcEnv.startsWith("-----BEGIN")) return srcEnv.trim();   // inline PEM
  return fs.readFileSync(path.resolve(process.cwd(), srcEnv), "utf8").trim();
}

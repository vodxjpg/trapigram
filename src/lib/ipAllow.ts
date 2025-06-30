/* src/lib/ipAllow.ts  ── NEW shared helper */
import { isIP } from "net";
import { CIDR } from "ip-cidr";          //  yarn add ip-cidr

const LIST =
  process.env.SERVICE_ALLOWED_CIDRS?.split(",").filter(Boolean) ?? [];

export function ipAllowed(ip: string): boolean {
  if (ip === "::1")      ip = "127.0.0.1";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (!isIP(ip))         return false;
  return LIST.some((c) => {
    try   { return new CIDR(c).contains(ip); }
    catch { return false; }                 // ignore malformed CIDRs
  });
}

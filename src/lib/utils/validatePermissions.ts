import { z } from "zod";
import { statements } from "@/lib/permissions";

/*───────────────────────────────────────────────────────────────────
  Allowed keys come straight from your access-control definition
───────────────────────────────────────────────────────────────────*/
const allowedResources = Object.keys(statements);

const actionMap = Object.fromEntries(
  allowedResources.map((r) => [r, statements[r]]),
);

/* zod schema built dynamically from statements -------------------------------- */
const PermSchema = z
  .record(
    z.enum(allowedResources as [string, ...string[]]),
    z
      .array(z.string())
      .nonempty()
      .max(20, "Too many actions for a single resource"),
  )
  .refine(
    (obj) =>
      Object.entries(obj).every(([res, acts]) =>
        acts.every((a) => actionMap[res]!.includes(a)),
      ),
    { message: "Unknown action for resource" },
  );

/* Normaliser: removes duplicates & trims whitespace ---------------------------- */
export function validatePermissions(input: unknown) {
  const perms = PermSchema.parse(input) as Record<string, string[]>;

  return Object.fromEntries(
    Object.entries(perms).map(([res, acts]) => [
      res,
      Array.from(new Set(acts.map((a) => a.trim()))),
    ]),
  );
}

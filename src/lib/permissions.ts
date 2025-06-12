// src/lib/permissions.ts
import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access";

/* ─────────────── extra resources your app understands ─────────────── */
const domainStatements /*  ← NO  “as const” here!  */ = {
  ticket : ["view", "update"],
  order  : ["view_pricing", "view_no_pricing", "update_tracking"],
  chat   : ["view"],
  stock  : ["update"],
  coupon : ["register", "manage"],
  revenue: ["view"],
  payment: ["manage"],
  invitation  : ["create", "cancel"],      // ← add this
  member      : ["delete", "update_role"], 
  platformKey: ["view","create","update","delete"],
};

/* merge Better-Auth defaults with your own resources */
export const statements: Record<string, string[]> = {
  // spread-copy because defaultStatements’ arrays are readonly
  ...Object.fromEntries(
    Object.entries(defaultStatements).map(([k, v]) => [k, [...v]])
  ),
  ...domainStatements,
};

/* access-control engine */
export const ac = createAccessControl(statements);

/* the **only built-in** role we keep */
export const owner = ac.newRole({
  ...ownerAc.statements,
  ...domainStatements,      // full power on every custom resource
});

/* helper for the settings / roles UI */
export const builtinRoles = { owner };

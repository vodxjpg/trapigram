// src/lib/permissions.ts  — centralised role & ACL definition
// -----------------------------------------------------------------------------
// 1.  All resources & actions that exist in the product live in `statements`.
// 2.  An access‑control engine (`ac`) is created once and exported.
// 3.  Built‑in roles (owner / admin / member) are defined **here** so that both
//     the server plugin *and* the react client can import the exact same object.
// 4.  Custom roles that an Owner creates at runtime are persisted in the DB.
//     They are registered with `ac` at boot time via `registerDynamicRoles()`
//     and merged with the built‑ins before being passed into the plugin.
// -----------------------------------------------------------------------------

import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access";

/* -------------------------------------------------------------------------- */
/*  Domain‑specific resources & actions                                        */
/* -------------------------------------------------------------------------- */
export const domainStatements = {
  member:            ["delete", "update_role"],
  invitation:        ["create", "cancel"],
  platformKey:       ["view", "create", "update", "delete"],
  customer:          ["view", "create", "update", "delete"],
  ticket:            ["view", "update"],
  order:             [
    "view",
    "update",
    "update_status",
    "view_pricing",
    "update_tracking",
  ],
  orderChat:         ["view"], // sub‑resource of order
  product:           ["view", "create", "update", "delete"],
  productCategories: ["view", "create", "update", "delete"],
  productAttributes: ["view", "create", "update", "delete"],
  warehouses:        [
    "view",
    "create",
    "update",
    "delete",
    "sharing",
    "synchronize",
  ],
  tierPricing:       ["view", "create", "update", "delete"],
  stockManagement:   ["view", "update"],
  coupon:            ["view", "create", "update", "delete"],
  announcements:     ["view", "create", "update", "delete"],
  affiliates:        ["view", "points", "settings", "products", "logs"],
  revenue:           ["view", "export"],
  sections:          ["view", "create", "update", "delete"],
  payment:           ["view", "create", "update", "delete"],
  shipping:          ["view", "create", "update", "delete"],
  notifications:     ["view", "create", "update", "delete"],
} as const;

type DomainStatements = typeof domainStatements;

/* -------------------------------------------------------------------------- */
/*  Merge default + domain statements                                          */
/* -------------------------------------------------------------------------- */
const filteredDefaults = Object.fromEntries(
  Object.entries(defaultStatements).filter(([resource]) => resource !== "team"),
) as typeof defaultStatements;

export const statements = {
  ...filteredDefaults,
  ...domainStatements,
} as const;

type StatementShape = typeof statements;

/* -------------------------------------------------------------------------- */
/*  Access‑control engine                                                      */
/* -------------------------------------------------------------------------- */
export const ac = createAccessControl(statements);

/* -------------------------------------------------------------------------- */
/*  Built‑in roles                                                             */
/* -------------------------------------------------------------------------- */
// Owner gets FULL access to every resource/action we declared above.
const { team: _omit, ...ownerDefaults } = ownerAc.statements;
export const owner = ac.newRole({
  ...ownerDefaults,     // default owner rights (minus team)
  ...domainStatements,  // plus every domain resource
});

// Admin – powerful but cannot delete the organisation itself.
export const admin = ac.newRole({
  ...owner,             // start from owner rights …
  organization: ["update"], // …but drop destructive actions;
});

// Member – limited, mostly read‑only + create/update on content they own.
export const member = ac.newRole({
  order:   ["view"],
  product: ["view"],
  ticket:  ["view", "update"],
});

export const builtinRoles = { owner, admin, member } as const;

/* -------------------------------------------------------------------------- */
/*  Dynamic (custom) roles                                                     */
/* -------------------------------------------------------------------------- */
export type DynamicRoleRecord = {
  name: string;                                    // slug the UI stores
  permissions: Partial<Record<keyof StatementShape, string[]>>;
};

/**
 * Creates role objects for every record fetched from the DB at start‑up.
 * Call this *before* you hand the roles into `organization({... roles })`.
 */
export function registerDynamicRoles(records: DynamicRoleRecord[]) {
  return Object.fromEntries(
    records.map((r) => [r.name, ac.newRole(r.permissions as any)]),
  );
}

/**
 * Helper that merges built‑ins with dynamic roles for the plugin.
 *
 * ```ts
 * const dynamic = await loadRolesFromDb();
 * export const roles = buildRoles(dynamic);
 *
 * // In auth.ts / auth‑client.ts
 * organization({ ac, roles })
 * ```
 */
export function buildRoles(dynamic: Record<string, ReturnType<typeof ac.newRole>>) {
  return { ...builtinRoles, ...dynamic } as const;
}

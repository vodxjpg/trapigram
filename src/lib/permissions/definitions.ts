// src/lib/permissions/definitions.ts (NEW FILE)

import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

export const domainStatements = {
  // ... (keep your existing domainStatements object here)
  member: ["delete", "update_role"],
  invitation: ["create", "cancel"],
  platformKey: ["view", "create", "update", "delete"],
  customer: ["view", "create", "update", "delete"],
  ticket: ["view", "update"],
  order: ["view", "update", "update_status", "view_pricing", "update_tracking"],
  orderChat: ["view"],
  product: ["view", "create", "update", "delete"],
  productCategories: ["view", "create", "update", "delete"],
  productAttributes: ["view", "create", "update", "delete"],
  warehouses: ["view", "create", "update", "delete", "sharing", "synchronize"],
  tierPricing: ["view", "create", "update", "delete"],
  stockManagement: ["view", "update"],
  coupon: ["view", "create", "update", "delete"],
  announcements: ["view", "create", "update", "delete"],
  affiliates: ["view", "points", "settings", "products", "logs"],
  revenue: ["view", "export"],
  sections: ["view", "create", "update", "delete"],
  payment: ["view", "create", "update", "delete"],
  shipping: ["view", "create", "update", "delete"],
  notifications: ["view", "create", "update", "delete"],
} as const;

const filteredDefaults = Object.fromEntries(
  Object.entries(defaultStatements).filter(([resource]) => resource !== "team"),
) as typeof defaultStatements;

export const statements = {
  ...filteredDefaults,
  ...domainStatements,
} as const;

export type Permission = {
  [K in keyof typeof statements]?: (typeof statements[K][number])[];
};

export const ac = createAccessControl(statements);

const { team: _omit, ...ownerDefaults } = ownerAc.statements;
export const owner = ac.newRole({
  ...ownerDefaults,
  ...domainStatements,
});

export const admin = ac.newRole({
  ...owner,
  organization: ["update"],
});

export const member = ac.newRole({
  order:   ["view"],
  product: ["view"],
  ticket:  ["view", "update"],
});

export const builtinRoles = { owner, admin, member } as const;

export type DynamicRoleRecord = {
  name: string;
  permissions: Partial<Record<keyof typeof statements, string[]>>;
};

export function registerDynamicRoles(records: DynamicRoleRecord[]) {
  return Object.fromEntries(
    records.map((r) => [r.name, ac.newRole(r.permissions as any)]),
  );
}

export function buildRoles(dynamic: Record<string, ReturnType<typeof ac.newRole>>) {
  return { ...builtinRoles, ...dynamic } as const;
}

// NOTICE: NO DATABASE IMPORTS OR DATABASE-ACCESSING FUNCTIONS ARE IN THIS FILE.
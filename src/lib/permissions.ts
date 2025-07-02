// src/lib/permissions.ts
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

/** The extra, _only_ resources we actually care about in our app */
const domainStatements: Record<string, string[]> = {
  member: ["delete", "update_role"],
  invitation: ["create", "cancel"],
  platformKey: ["view", "create", "update", "delete"],
  customer: ["view", "create", "update", "delete"],
  ticket: ["view", "update"],
  order: [
    "view",
    "update",
    "update_status",
    "view_pricing",
    "update_tracking",
  ],
  // Chat within orders
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
  
};

// 1) Filter out “team” (or any other you don’t want) from defaultStatements
const filteredDefaults: Record<string, string[]> = Object.fromEntries(
  Object.entries(defaultStatements)
    .filter(([resource]) => resource !== "team")    // <-- drop “team”
    .map(([resource, perms]) => [resource, [...perms]])
);

// 2) Build your statements by merging filtered defaults + your domain
export const statements: Record<string, string[]> = {
  ...filteredDefaults,
  ...domainStatements,
};

// 3) Build your access-control engine
export const ac = createAccessControl(statements);

// 4) Make your owner role grant *all* of your wanted statements,
//    but filter out “team” from ownerAc as well:
const { team: _dropped, ...ownerDefaults } = ownerAc.statements;

export const owner = ac.newRole({
  ...ownerDefaults,      // everything except “team”
  ...domainStatements,   // plus full power on your own resources
});

export const builtinRoles = { owner };

// src/lib/roles.ts
import { db } from "@/lib/db";
import { registerDynamicRoles, buildRoles, DynamicRoleRecord } from "@/lib/permissions";

const dynamicRoleRows = await db
  .selectFrom("orgRole")
  .select(["name", "permissions"])
  .execute();

const parsedRows: DynamicRoleRecord[] = dynamicRoleRows.map((row) => ({
  name: row.name,
  permissions: typeof row.permissions === "string" ? JSON.parse(row.permissions) : row.permissions,
}));

console.log("Raw permissions for support:", parsedRows.find((row) => row.name === "support")?.permissions);

const dynamicRoles = registerDynamicRoles(parsedRows);
export const roles = buildRoles(dynamicRoles);

console.log("Dynamic roles fetched:", parsedRows);
console.log("Registered dynamic roles:", dynamicRoles);
console.log("Final roles object:", roles);

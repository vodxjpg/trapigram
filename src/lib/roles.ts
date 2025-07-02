import { db } from "@/lib/db";
import { registerDynamicRoles, buildRoles } from "@/lib/permissions";

const dynamicRoleRows = await db
  .selectFrom("orgRole")
  .select(["name", "permissions"])
  .execute();

  console.log(
    "Raw permissions for support:",
    dynamicRoleRows.find((row) => row.name === "support")?.permissions
  );

const dynamicRoles = registerDynamicRoles(dynamicRoleRows);
export const roles = buildRoles(dynamicRoles);

console.log("Dynamic roles fetched:", dynamicRoleRows);
console.log("Registered dynamic roles:", dynamicRoles);
console.log("Final roles object:", roles);
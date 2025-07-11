// src/lib/permissions/server.ts (NEW FILE)

import { db } from "@/lib/db";
import {
  ac,
  registerDynamicRoles,
  DynamicRoleRecord
} from "./definitions";

/**
 * Fetches all dynamic roles for a specific organization from the database.
 * @param organizationId The ID of the organization to fetch roles for.
 */
export async function getDynamicRolesForOrg(organizationId: string): Promise<Record<string, ReturnType<typeof ac.newRole>>> {
  try {
    const dynamicRoleRows = await db
      .selectFrom("orgRole")
      .select(["name", "permissions"])
      .where("organizationId", "=", organizationId)
      .execute();

    const parsedRows: DynamicRoleRecord[] = dynamicRoleRows.map((row) => ({
      name: row.name,
      permissions: typeof row.permissions === "string" ? JSON.parse(row.permissions) : row.permissions,
    }));

    return registerDynamicRoles(parsedRows);
  } catch (error) {
    console.error(`[getDynamicRolesForOrg] Failed to fetch roles for org ${organizationId}:`, error);
    return {}; // Return empty object on failure
  }
}
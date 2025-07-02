// src/app/api/me/has-permission/route.ts — (NEW FILE)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
// Import from BOTH new files
import { ac, buildRoles } from "@/lib/permissions/definitions"; 
import { getDynamicRolesForOrg } from "@/lib/permissions/server";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession(req);
  if (!session?.user?.id || !session.activeOrganizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { permissions: requestedPermission } = await req.json();
  if (!requestedPermission) {
    return NextResponse.json({ error: "Permission object is required." }, { status: 400 });
  }

  try {
    // 1. Get the current user's member info to find their role
    const member = await db
      .selectFrom("member")
      .select("role")
      .where("userId", "=", session.user.id)
      .where("organizationId", "=", session.activeOrganizationId)
      .executeTakeFirst();

    if (!member) {
      return NextResponse.json({ hasPermission: false, reason: "Not a member of the active organization." });
    }

    const userRole = member.role;

    // 2. Load ALL roles for the organization (built-in + dynamic)
    const dynamicRoles = await getDynamicRolesForOrg(session.activeOrganizationId);
    const allRolesForOrg = buildRoles(dynamicRoles); // Your helper merges built-ins with dynamic

    // 3. Perform the check
    const roleDefinition = allRolesForOrg[userRole as keyof typeof allRolesForOrg];

    if (!roleDefinition) {
      console.warn(`Role "${userRole}" not found in defined roles for org ${session.activeOrganizationId}.`);
      return NextResponse.json({ hasPermission: false, reason: `Role "${userRole}" is not defined.` });
    }
    
    // The actual permission check using the access control instance
    const hasPermission = roleDefinition.can(requestedPermission);

    return NextResponse.json({ hasPermission });

  } catch (error) {
    console.error("[api/me/has-permission] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
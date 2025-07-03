// src/app/api/debug/role/route.ts
import { NextResponse } from "next/server";
import { getContext }   from "@/lib/context";
import { resolveRole }  from "@/lib/auth/role-resolver";  // ← already written

export async function GET(request: Request) {
  const ctx = await getContext(request);
  if (ctx instanceof NextResponse) return ctx;

  // resolveRole returns the actual Role object the server will use
  // for the currently-logged-in member ↓↓↓
  const role = resolveRole({
    organizationId: ctx.organizationId,
    role:           ctx.memberRole,       // “support”, “owner”, …
  });

  return NextResponse.json({ permissions: role.statements });
}

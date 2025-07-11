// src/app/api/organizations/[identifier]/platform-keys/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";

// helper to check if the caller is the org owner
async function isOwner(organizationId: string, userId: string) {
  const row = await db
    .selectFrom("member")
    .select("id")
    .where("organizationId", "=", organizationId)
    .where("userId", "=", userId)
    .where("role", "=", "owner")
    .executeTakeFirst();

  return !!row;
}

export async function GET(req: NextRequest, { params }) {
  // no guard on view
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const keys = await db
    .selectFrom("organizationPlatformKey")
    .select(["id", "platform", "apiKey", "createdAt", "updatedAt"])
    .where("organizationId", "=", organizationId)
    .execute();

  return NextResponse.json({ platformKeys: keys });
}

export async function POST(req: NextRequest, { params }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  const { platform, apiKey } = await req.json();
  if (!platform || !apiKey) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // ←── DUPLICATE CHECK ──→
  const existing = await db
    .selectFrom("organizationPlatformKey")
    .select("id")
    .where("organizationId", "=", organizationId)
    .where("platform", "=", platform)
    .executeTakeFirst();

  if (existing) {
    return NextResponse.json(
      { error: `A ${platform} key already exists` },
      { status: 409 }
    );
  }

  const [newKey] = await db
    .insertInto("organizationPlatformKey")
    .values({
      id: crypto.randomUUID(),
      organizationId,
      platform,
      apiKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning(["id", "platform", "apiKey", "createdAt", "updatedAt"])
    .execute();

  return NextResponse.json({ platformKey: newKey }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;



  const { id, platform, apiKey } = await req.json();
  if (!id || (!platform && !apiKey)) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // ←── DUPLICATE CHECK WHEN CHANGING PLATFORM ──→
  if (platform) {
    const clash = await db
      .selectFrom("organizationPlatformKey")
      .select("id")
      .where("organizationId", "=", organizationId)
      .where("platform", "=", platform)
      .where("id", "!=", id)      // ignore the record we're editing
      .executeTakeFirst();

    if (clash) {
      return NextResponse.json(
        { error: `A ${platform} key already exists` },
        { status: 409 }
      );
    }
  }

  const updated = await db
    .updateTable("organizationPlatformKey")
    .set({ platform, apiKey, updatedAt: new Date() })
    .where("organizationId", "=", organizationId)
    .where("id", "=", id)
    .returning(["id", "platform", "apiKey", "createdAt", "updatedAt"])
    .executeTakeFirst();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ platformKey: updated });
}


export async function DELETE(req: NextRequest, { params }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { numDeleted } = await db
    .deleteFrom("organizationPlatformKey")
    .where("organizationId", "=", organizationId)
    .where("id", "=", id)
    .executeTakeFirst();

  if (numDeleted === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

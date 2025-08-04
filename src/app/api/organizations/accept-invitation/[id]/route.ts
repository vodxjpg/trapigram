// src/app/api/organizations/accept-invitation/[id]/route.ts
export const runtime  = "nodejs";        // If Node is available, use it
export const dynamic  = "force-dynamic"; // Disable edge-cache for safety

import { NextRequest, NextResponse } from "next/server";
import { auth }   from "@/lib/auth";
import { db }     from "@/lib/db";
import crypto     from "crypto";

/* helper – works with Edge (Promise params) or Node (plain object) */
async function extractId(
  params: { id: string } | Promise<{ id: string }>
): Promise<string | null> {
  const p: any = params;
  if (typeof p?.then === "function") {
    const { id } = await p;
    return id ?? null;
  }
  return (p as any)?.id ?? null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> },
) {
  const invitationId = await extractId(ctx.params);
  if (!invitationId) {
    return NextResponse.json(
      { error: "Invitation ID is required" },
      { status: 400 },
    );
  }

  /* ────────────────────────────────────────────────────────────────
     1 — Load invitation
     ──────────────────────────────────────────────────────────────── */
  const invite = await db
    .selectFrom("invitation")
    .selectAll()
    .where("id", "=", invitationId)
    .executeTakeFirst();

  if (!invite) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  /* 1a – reject only *invalid* states; allow idempotent “accepted” */
  if (invite.status !== "pending" && invite.status !== "accepted") {
    return NextResponse.json(
      { error: `Invitation status is ${invite.status}` },
      { status: 400 },
    );
  }

  /* ────────────────────────────────────────────────────────────────
     2 — If the caller is already signed-in …
     ──────────────────────────────────────────────────────────────── */
  const session = await auth.api.getSession({ headers: req.headers });

  if (session) {
    if (session.user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      return NextResponse.json(
        {
          error: `Logged-in as ${session.user.email}, but invite is for ${invite.email}`,
        },
        { status: 403 },
      );
    }

    await db.transaction().execute(async (trx) => {
      /* 2a – mark accepted once (harmless if already accepted) */
      if (invite.status === "pending") {
        await trx
          .updateTable("invitation")
          .set({ status: "accepted" })
          .where("id", "=", invitationId)
          .executeTakeFirst();
      }

      /* 2b – ensure membership */
      const exists = await trx
        .selectFrom("member")
        .select("id")
        .where("userId", "=", session.user.id)
        .where("organizationId", "=", invite.organizationId!)
        .executeTakeFirst();

      if (!exists) {
        await trx
          .insertInto("member")
          .values({
            id: crypto.randomUUID(),
            userId: session.user.id,
            organizationId: invite.organizationId!,
            role: invite.role,
            createdAt: new Date(),
          })
          .execute();
      }
    });

    /* 2c – ensure activeOrganizationId */
    if (!session.session.activeOrganizationId) {
      await db
        .updateTable("session")
        .set({ activeOrganizationId: invite.organizationId! })
        .where("id", "=", session.session.id)
        .executeTakeFirst();
    }

    /* ──────────────── REDIRECT LOGIC (FIX) ─────────────────
       • Guests without a credential password → set-password
       • Everyone else                           → dashboard  */
    const needsPassword =
      (session.user as any).is_guest === true &&
      session.user.hasPassword === false;

    const redirect = needsPassword
      ? `/set-password?invitationId=${invitationId}`
      : "/dashboard";

    return NextResponse.json({ success: true, redirect });
  }

  /* ────────────────────────────────────────────────────────────────
     3 — Guest / first-time user
     ──────────────────────────────────────────────────────────────── */
  const existingUser = await db
    .selectFrom("user")
    .selectAll()
    .where("email", "=", invite.email)
    .executeTakeFirst();

  const userId = existingUser
    ? existingUser.id
    : (
        await (await auth.$context).internalAdapter.createUser({
          name: invite.email.split("@")[0] ?? "User",
          email: invite.email,
          emailVerified: false,
          phone: null,
          country: null,
          is_guest: true,
        })
      ).id;

  /* membership – ignore duplicate-key errors gracefully */
  try {
    await db
      .insertInto("member")
      .values({
        id: crypto.randomUUID(),
        userId,
        organizationId: invite.organizationId!,
        role: invite.role,
        createdAt: new Date(),
      })
      .execute();
  } catch (e: any) {
    if (e?.code !== "23505") throw e; // silence only “duplicate key”
  }

  /* mark accepted (idempotent) */
  if (invite.status === "pending") {
    await db
      .updateTable("invitation")
      .set({ status: "accepted" })
      .where("id", "=", invitationId)
      .executeTakeFirst();
  }

  /* send magic link */
  const callbackURL =
    `${process.env.NEXT_PUBLIC_APP_URL}` +
    `/accept-invitation/${invitationId}?invitationId=${invitationId}`;

  const ml = await auth.api.signInMagicLink({
    headers: req.headers,
    body: { email: invite.email, callbackURL },
  });

  if (ml.error) {
    console.error("Magic link error:", ml.error.message);
    return NextResponse.json({ error: ml.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, redirect: "/check-email" });
}

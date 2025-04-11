// /home/zodx/Desktop/trapigram/src/app/api/organizations/accept-invitation/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";



export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: invitationId } = await context.params;
  if (!invitationId) {
    return NextResponse.json({ error: "Invitation ID is required" }, { status: 400 });
  }

  try {
    // 1) Check if there's a session
    const session = await auth.api.getSession({ headers: request.headers });

    // 2) Retrieve invitation from DB
    const invitation = await db
      .selectFrom("invitation")
      .selectAll()
      .where("id", "=", invitationId)
      .executeTakeFirst();

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }
    if (invitation.status !== "pending") {
      return NextResponse.json(
        { error: `Invitation status is ${invitation.status}` },
        { status: 400 }
      );
    }

    // 3) If user *is* logged in => manually accept
    if (session) {
      // Make sure the session's email matches the invitation email
      const sessionEmail = session.user.email?.toLowerCase();
      const inviteEmail = invitation.email.toLowerCase();
      if (sessionEmail !== inviteEmail) {
        // They are logged in under a different email => they can't accept
        return NextResponse.json({
          error: `You're logged in as ${sessionEmail}, but invite is for ${inviteEmail}`
        }, { status: 403 });
      }

      // Mark invitation as accepted
      await db
        .updateTable("invitation")
        .set({ status: "accepted" })
        .where("id", "=", invitationId)
        .executeTakeFirst();

      // Insert a row into 'member' if not already present
      const existingMember = await db
        .selectFrom("member")
        .select(["id"])
        .where("userId", "=", session.user.id)
        .where("organizationId", "=", invitation.organizationId!)
        .executeTakeFirst();

      if (!existingMember) {
        await db.insertInto("member").values({
          id: session.user.id,
          userId: session.user.id,
          organizationId: invitation.organizationId!,
          role: invitation.role,   // e.g. "manager" or "employee"
          createdAt: new Date(),
        }).execute();
      }

      // Decide final redirect (like before)
      const redirect = session.user.hasPassword ? "/dashboard" : "/set-password";
      return NextResponse.json({ success: true, redirect });
    }

    // 4) No session => check if user already exist by invitation's email
    const existingUser = await db
      .selectFrom("user")
      .select(["id"])
      .where("email", "=", invitation.email)
      .executeTakeFirst();
    if (existingUser) {
      // If user already exists => redirect to /login
      const loginUrl = new URL("/login", process.env.NEXT_PUBLIC_APP_URL);
      loginUrl.searchParams.set("invitationId", invitationId);
      return NextResponse.json({ success: true, redirect: loginUrl.toString() });
    }

    // 5) If user doesn't exist => create them w/ is_guest= true (no password) so they can do magic link
    const ctx = await auth.$context;
    const defaultName = invitation.email.split("@")[0] || "NewUser";

    await ctx.internalAdapter.createUser({
      // no id => let system generate
      name: defaultName,
      email: invitation.email,
      emailVerified: false,
      phone: null,
      country: null,
      is_guest: true,
    });

    // 6) Send a magic link so they can log in => callback /accept-invitation again
    const magicLinkResp = await auth.api.signInMagicLink({
      headers: request.headers,
      body: {
        email: invitation.email,
        callbackURL: `/accept-invitation/${invitationId}`,
      },
    });
    if (magicLinkResp.error) {
      console.error("Error sending magic link:", magicLinkResp.error.message);
      return NextResponse.json({ error: magicLinkResp.error.message }, { status: 500 });
    }

    // 7) Prompt user to check their email
    return NextResponse.json({ success: true, redirect: "/check-email" });
  } catch (error) {
    console.error("Error processing invitation:", error);
    return NextResponse.json({ error: "Failed to process invitation" }, { status: 500 });
  }
}

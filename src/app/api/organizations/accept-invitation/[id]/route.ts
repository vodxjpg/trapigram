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
    return NextResponse.json(
      { error: "Invitation ID is required" },
      { status: 400 }
    );
  }

  try {
    // 1) Retrieve the invitation from DB
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

    // 2) Try to get a session (if the user is logged in)
    const session = await auth.api.getSession({ headers: request.headers });

    // 3) If session exists AND the email matches => normal acceptance
    if (session) {
      const sessionEmail = session.user.email?.toLowerCase();
      const inviteEmail = invitation.email.toLowerCase();

      if (sessionEmail === inviteEmail) {
        // Mark invitation as accepted
        await db
          .updateTable("invitation")
          .set({ status: "accepted" })
          .where("id", "=", invitationId)
          .executeTakeFirst();

        // Create the "member" row if it doesn't exist
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
            role: invitation.role,
            createdAt: new Date(),
          }).execute();
        }

        // Optionally set activeOrganizationId if not already set
        if (!session.session.activeOrganizationId) {
          await db
            .updateTable("session")
            .set({ activeOrganizationId: invitation.organizationId! })
            .where("id", "=", session.session.id)
            .executeTakeFirst();
        }

        // Decide redirect based on whether the user has a password
        // If the user has no password, redirect to the set-password page WITH the invitationId parameter
        const redirect = session.user.hasPassword
          ? "/dashboard"
          : `/set-password?invitationId=${invitationId}`;

        return NextResponse.json({ success: true, redirect });
      }

      return NextResponse.json(
        {
          error: `You are logged in as ${session.user.email}, but this invite is for ${invitation.email}`
        },
        { status: 403 }
      );
    }

    // 4) No session => Manual Acceptance Flow (bypass auth requirement)
    // 4a) Check if user exists by that email
    const existingUser = await db
      .selectFrom("user")
      .selectAll()
      .where("email", "=", invitation.email)
      .executeTakeFirst();

    let userId: string;
    if (!existingUser) {
      // 4b) Create user as a guest
      const ctx = await auth.$context;
      const defaultName = invitation.email.split("@")[0] || "NewUser";
      const newUser = await ctx.internalAdapter.createUser({
        name: defaultName,
        email: invitation.email,
        emailVerified: false,
        phone: null,
        country: null,
        is_guest: true,
      });
      userId = newUser.id;
    } else {
      userId = existingUser.id;
    }

    // 4c) Create membership if needed
    const existingMember = await db
      .selectFrom("member")
      .select(["id"])
      .where("userId", "=", userId)
      .where("organizationId", "=", invitation.organizationId!)
      .executeTakeFirst();

    if (!existingMember) {
      await db.insertInto("member").values({
        id: userId,
        userId: userId,
        organizationId: invitation.organizationId!,
        role: invitation.role,
        createdAt: new Date(),
      }).execute();
    }

    // 4d) Mark the invitation as accepted
    await db
      .updateTable("invitation")
      .set({ status: "accepted" })
      .where("id", "=", invitationId)
      .executeTakeFirst();

    // 4e) For non‑existing users, send them a magic link before redirecting to check-email.
    // Append the invitationId as a query parameter to the callback URL.
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invitation/${invitationId}?invitationId=${invitationId}`;

    const magicLinkResp = await auth.api.signInMagicLink({
      headers: request.headers,
      body: {
        email: invitation.email,
        callbackURL: callbackUrl,
      },
    });

    if (magicLinkResp.error) {
      console.error("Error sending magic link:", magicLinkResp.error.message);
      return NextResponse.json(
        { error: magicLinkResp.error.message },
        { status: 500 }
      );
    }

    // 4f) Redirect them to /check-email so they know to check their inbox
    return NextResponse.json({ success: true, redirect: "/check-email" });
  } catch (error) {
    console.error("Error processing invitation:", error);
    return NextResponse.json(
      { error: "Failed to process invitation" },
      { status: 500 }
    );
  }
}

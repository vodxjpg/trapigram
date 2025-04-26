// /home/zodx/Desktop/trapigram/src/app/api/internal/set-password/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { password } = await req.json();
    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    // 1) Actually set the password with Better Auth
    const setResp = await auth.api.setPassword({
      headers: req.headers, 
      body: { newPassword: password },
    });
    if (setResp.error) {
      console.error("Set password error:", setResp.error.message);
      return NextResponse.json({ error: setResp.error.message }, { status: 500 });
    }

    // 2) Mark user as NOT a guest
    const ctx = await auth.$context;
    await ctx.internalAdapter.updateUser(session.user.id, { is_guest: true });

    // 3) DO NOT sign out – we want to keep the user logged in
    // await auth.api.signOut({ headers: req.headers }); // remove this line

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error setting password:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

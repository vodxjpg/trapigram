import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { auth } from "@/lib/auth";
import { headers } from 'next/headers';

// Define the expected JSON structure from the request
interface ChangePasswordRequest {
  email: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * POST /api/auth/change-password/
 *
 * This endpoint handles changing the user's password.
 * It performs the following steps:
 * 1. Parses the JSON body from the request.
 * 2. Validates that all required fields are provided and that the new password matches its confirmation.
 * 3. Retrieves the user and associated account (where the password is stored).
 * 4. Uses bcrypt to verify that the provided current password is correct.
 * 5. Hashes the new password and updates it in the database.
 * 6. Returns a success or error message.
 */
export async function POST(request: NextRequest) {

  const session = await auth.api.getSession({
    headers: await headers() // you need to pass the headers object.
  })
  const email = session?.user.email
  try {
    const body: ChangePasswordRequest = await request.json();
    body.email = email;

    // Validate required fields
    if (!body.currentPassword || !body.newPassword || !body.confirmPassword) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Ensure the new password and confirmation match
    if (body.newPassword !== body.confirmPassword) {
      return NextResponse.json({ error: 'New password and confirmation do not match' }, { status: 400 });
    }

    // Retrieve the user by email from the "user" table
    const user = await db
      .selectFrom('user')
      .select(['id'])
      .where('email', '=', body.email)
      .executeTakeFirst();
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Retrieve the account record associated with the user
    const account = await db
      .selectFrom('account')
      .select(['id', 'password'])
      .where('userId', '=', user.id)
      .executeTakeFirst();

    if (!account || !account.password) {
      return NextResponse.json({ error: 'Account or password not found' }, { status: 404 });
    }

    const ctx = await auth.$context
    //Verify the provided current password against the stored hashed password
    const isPasswordValid = await ctx.password.verify({ password: body.currentPassword, hash: account.password })
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Hash the new password
    const hash = await ctx.password.hash(body.newPassword);

    await ctx.internalAdapter.updatePassword(user.id, hash)

    return NextResponse.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error in change password endpoint:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

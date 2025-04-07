// src/app/api/clients/routes.ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { Pool } from "pg"
import { auth } from "@/lib/auth"
import { v4 as uuidv4, v4 } from "uuid"

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
})

// Define the client schema using Zod to validate incoming data.
const clientSchema = z.object({
    username: z.string().min(3, { message: "Username must be at least 3 characters." }),
    firstName: z.string().min(1, { message: "First name is required." }),
    lastName: z.string().min(1, { message: "Last name is required." }),
    email: z.string().email({ message: "Please enter a valid email address." }),
    phoneNumber: z.string().min(10, { message: "Please enter a valid phone number." }),
    referredBy: z.string().optional(),
});

// This function handles POST requests to create a new client.
export async function POST(req: Request) {
    // Use Better Auth to check if the user is authenticated.
    // The requireAuth method verifies the user's session.
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
        return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    try {
        // Parse the JSON data sent in the request.
        const body = await req.json();

        // Validate the data against our Zod schema.
        const parsedClient = clientSchema.parse(body);

        // Destructure the validated data.
        const { username, firstName, lastName, email, phoneNumber, referredBy } = parsedClient;
        const clientId = uuidv4()

        // Insert the new client into the database.
        // The 'created_by' field is assumed to record the ID of the authenticated user.
        const insertQuery = `
      INSERT INTO clients("id", "organizationId", "username", "first_name", "last_name", "email", "phone_number", "referred_by")
      VALUES($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
        const values = [clientId, organizationId, username, firstName, lastName, email, phoneNumber, referredBy];

        const result = await pool.query(insertQuery, values);

        // Return the newly created client data as JSON with a 201 Created status.
        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (error: any) {
        // If validation or any other error occurs, return a 400 Bad Request with the error message.
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}

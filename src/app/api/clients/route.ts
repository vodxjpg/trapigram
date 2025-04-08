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

export async function GET(req: Request) {
    // Authenticate the request using your auth system.
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
        return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    // Extract query parameters from the URL.
    const { searchParams } = new URL(req.url)
    const page = Number(searchParams.get("page")) || 1
    const pageSize = Number(searchParams.get("pageSize")) || 10
    const search = searchParams.get("search") || ""

    // Build the query for counting total clients (for pagination purposes).
    let countQuery = `
      SELECT COUNT(*) FROM clients
      WHERE "organizationId" = $1
    `
    const countValues: any[] = [organizationId]
    if (search) {
        countQuery += ` AND (username ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2)`
        countValues.push(`%${search}%`)
    }

    // Build the query to fetch clients data with pagination.
    let query = `
      SELECT * FROM clients
      WHERE "organizationId" = $1
    `
    const values: any[] = [organizationId]
    if (search) {
        query += ` AND (username ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2)`
        values.push(`%${search}%`)
    }
    // Order by creation date descending (adjust as needed).
    query += ` ORDER BY created_at DESC`

    // Add pagination (LIMIT and OFFSET).
    const offset = (page - 1) * pageSize
    query += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`
    values.push(pageSize, offset)

    try {
        // Execute the count query to determine total number of rows.
        const countResult = await pool.query(countQuery, countValues)        
        const totalRows = Number(countResult.rows[0].count)
        const totalPages = Math.ceil(totalRows / pageSize)        

        // Execute the query to fetch paginated clients.
        const result = await pool.query(query, values)        
        const clients = result.rows

        // Return the data along with pagination info.
        return NextResponse.json({
            clients,
            totalPages,
            currentPage: page,
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 400 })
    }
}

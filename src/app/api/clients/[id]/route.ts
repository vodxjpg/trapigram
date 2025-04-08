// src/app/api/clients/[id]/route.ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { Pool } from "pg"
import { auth } from "@/lib/auth"  // Adjust the import if your auth file is in a different location

// Create the PostgreSQL connection pool.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Define the schema for editing a client.
const editClientSchema = z.object({
  username: z.string().min(3, { message: "Username must be at least 3 characters." }),
  firstName: z.string().min(1, { message: "First name is required." }),
  lastName: z.string().min(1, { message: "Last name is required." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  phoneNumber: z.string().min(10, { message: "Please enter a valid phone number." }),
  referredBy: z.string().optional(),
})

// PATCH endpoint to edit a client's details.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // Check if the user is authenticated.
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const organizationId = session.session.activeOrganizationId
  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 })
  }

  try {
    // Parse and validate the incoming JSON data.
    const body = await req.json()
    const parsedClient = editClientSchema.parse(body)
    const { username, firstName, lastName, email, phoneNumber, referredBy } = parsedClient

    // Update the client in the database
    const updateQuery = `
      UPDATE clients
      SET username = $1,
          first_name = $2,
          last_name = $3,
          email = $4,
          phone_number = $5,
          referred_by = $6
      WHERE id = $7 AND "organizationId" = $8
      RETURNING *
    `
    const values = [username, firstName, lastName, email, phoneNumber, referredBy || null, params.id, organizationId]
    const result = await pool.query(updateQuery, values)

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Client not found or update failed" }, { status: 404 })
    }

    // On successful update, redirect to the client creation page.
    return NextResponse.redirect(new URL("/dashboard/clients", req.url))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

// DELETE endpoint for deleting a client by id
export async function DELETE(
    req: Request,
    { params }: { params: { id: string } }
  ) {
    // Authenticate the request using your auth utility.
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }
  
    try {
      // Retrieve the client id from the route parameters.
      const clientId = params.id
  
      // Delete the client only if it belongs to the active organization.
      const deleteQuery = `
        DELETE FROM clients
        WHERE id = $1 AND "organizationId" = $2
        RETURNING *
      `
      const values = [clientId, organizationId]
      const result = await pool.query(deleteQuery, values)
  
      // If no rows were affected, the client was not found or does not belong to this organization.
      if (result.rowCount === 0) {
        return NextResponse.json(
          { error: "Client not found or unauthorized" },
          { status: 404 }
        )
      }
  
      // Respond with a success message.
      return NextResponse.json({ message: "Client deleted successfully" })
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
  }

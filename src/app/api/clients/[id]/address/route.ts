// app/api/clients/[id]/address/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto"

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || ""
const ENC_IV_B64 = process.env.ENCRYPTION_IV || ""

function getEncryptionKeyAndIv(): { key: Buffer, iv: Buffer } {
    const key = Buffer.from(ENC_KEY_B64, "base64") // decode base64 -> bytes
    const iv = Buffer.from(ENC_IV_B64, "base64")
    // For AES-256, key should be 32 bytes; iv typically 16 bytes
    // Added validation to ensure correct lengths
    if (!ENC_KEY_B64 || !ENC_IV_B64) {
        throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set in environment")
    }
    if (key.length !== 32) {
        throw new Error(`Invalid ENCRYPTION_KEY: must decode to 32 bytes, got ${key.length}`)
    }
    if (iv.length !== 16) {
        throw new Error(`Invalid ENCRYPTION_IV: must decode to 16 bytes, got ${iv.length}`)
    }
    return { key, iv }
}

// Simple AES encryption using Node’s crypto library in CBC or GCM:
function encryptSecretNode(plain: string): string {
    const { key, iv } = getEncryptionKeyAndIv()
    // For demo: using AES-256-CBC. You can choose GCM or CTR if you wish.
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv)
    let encrypted = cipher.update(plain, "utf8", "base64")
    encrypted += cipher.final("base64")
    return encrypted
}

function decryptSecretNode(encryptedB64: string): string {
    const { key, iv } = getEncryptionKeyAndIv();
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encryptedB64, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

// --- validation schema for creating an address ---
const addressCreateSchema = z.object({
    clientId: z.string().uuid(),
    address: z.string().min(1, "Address is required"),
    postalCode: z.string().min(1, "Postal code is required"),
    phone: z.string().min(1, "Phone number is required"),
});

export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    // --- authentication boilerplate (same as your coupons endpoint) ---
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;
    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    // Case 1: session-based
    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json(
                { error: "No active organization in session" },
                { status: 400 }
            );
        }
    }
    // Case 2: API key
    else if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json(
                { error: error?.message || "Invalid API key" },
                { status: 401 }
            );
        }
        organizationId = explicitOrgId || "";
        if (!organizationId) {
            return NextResponse.json(
                { error: "Organization ID required in query params" },
                { status: 400 }
            );
        }
    }
    // Case 3: internal secret
    else if (internalSecret === INTERNAL_API_SECRET) {
        const internalSession = await auth.api.getSession({ headers: req.headers });
        if (!internalSession) {
            return NextResponse.json(
                { error: "Unauthorized session" },
                { status: 401 }
            );
        }
        organizationId =
            explicitOrgId || internalSession.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json(
                { error: "No active organization in session" },
                { status: 400 }
            );
        }
    } else {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 403 }
        );
    }

    try {
        const clientId = params.id;
        const result = await pool.query(
            `SELECT id, "clientId", address, "postalCode", phone
       FROM "clientAddresses"
       WHERE "clientId" = $1`,
            [clientId]
        );
        const decryptedAddress = decryptSecretNode(result.rows[0].address)
        result.rows[0].address = decryptedAddress
        return NextResponse.json({ addresses: result.rows });
    } catch (error: any) {
        console.error("[GET /api/clients/[id]/address] error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    // --- same auth logic as above ---
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;
    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json(
                { error: "No active organization in session" },
                { status: 400 }
            );
        }
    } else if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json(
                { error: error?.message || "Invalid API key" },
                { status: 401 }
            );
        }
        organizationId = explicitOrgId || "";
        if (!organizationId) {
            return NextResponse.json(
                { error: "Organization ID required in query params" },
                { status: 400 }
            );
        }
    } else if (internalSecret === INTERNAL_API_SECRET) {
        const internalSession = await auth.api.getSession({ headers: req.headers });
        if (!internalSession) {
            return NextResponse.json(
                { error: "Unauthorized session" },
                { status: 401 }
            );
        }
        organizationId =
            explicitOrgId || internalSession.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json(
                { error: "No active organization in session" },
                { status: 400 }
            );
        }
    } else {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 403 }
        );
    }

    try {
        const clientId = params.id;
        const body = await req.json();

        const parsed = addressCreateSchema.parse({
            ...body,
            clientId,
        });

        const encryptedAddress = encryptSecretNode(parsed.address)

        const addressId = uuidv4();

        // insert
        const insertQ = `
      INSERT INTO "clientAddresses" (id, "clientId", address, "postalCode", phone)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, "clientId", address, "postalCode", phone
    `;
        const values = [
            addressId,
            parsed.clientId,
            encryptedAddress,
            parsed.postalCode,
            parsed.phone,
        ];
        const result = await pool.query(insertQ, values);
        const newAddress = result.rows[0];

        return NextResponse.json(newAddress, { status: 201 });
    } catch (error: any) {
        console.error("[POST /api/clients/[id]/address] error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

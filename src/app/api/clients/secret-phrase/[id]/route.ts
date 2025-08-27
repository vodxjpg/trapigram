import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import crypto from "crypto";

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
    const key = Buffer.from(ENC_KEY_B64, "base64");
    const iv = Buffer.from(ENC_IV_B64, "base64");
    if (!ENC_KEY_B64 || !ENC_IV_B64) {
        throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set in environment");
    }
    if (key.length !== 32) {
        throw new Error(
            `Invalid ENCRYPTION_KEY: must decode to 32 bytes, got ${key.length}`
        );
    }
    if (iv.length !== 16) {
        throw new Error(
            `Invalid ENCRYPTION_IV: must decode to 16 bytes, got ${iv.length}`
        );
    }
    return { key, iv };
}

function encryptSecretNode(plain: string): string {
    const { key, iv } = getEncryptionKeyAndIv();
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(plain, "utf8", "base64");
    encrypted += cipher.final("base64");
    return encrypted;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { id } = await params;
        const { phrase } = await req.json();

        const clientQuery = `SELECT id FROM clients WHERE "userId" = '${id}' AND "organizationId" = '${organizationId}'`
        const clientResult = await pool.query(clientQuery)
        const clientId = clientResult.rows[0].id

        const secretPhraseId = uuidv4()
        const encryptedPhrase = encryptSecretNode(phrase)

        const phraseQuery = `INSERT INTO "clientSecretPhrase" 
            (id, "clientId", phrase, "createdAt", "updatedAt") 
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING *`
        const phraseResult = await pool.query(phraseQuery, [secretPhraseId, clientId, encryptedPhrase])
        const result = phraseResult.rows[0]

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        console.error("[POST /api/clients/secret-phrase/[id]] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { id } = await params;
        const { phrase } = await req.json();

        const clientQuery = `SELECT * FROM clients WHERE "userId" = '${id}' AND "organizationId" = '${organizationId}'`
        const clientResult = await pool.query(clientQuery)
        const client = clientResult.rows

        if (client.length > 0) {
            const clientId = client[0].id
            const encryptedPhrase = encryptSecretNode(phrase)

            const phraseQuery = `UPDATE "clientSecretPhrase" 
            SET phrase = '${encryptedPhrase}', "updatedAt" = NOW()
            WHERE "clientId" = '${clientId}'
            RETURNING *`
            const phraseResult = await pool.query(phraseQuery)
            const result = phraseResult.rows[0]

            return NextResponse.json(result, { status: 201 });
        } else {
            const result = {
                error: "client doesn't exist"
            }
            return NextResponse.json(result, { status: 201 });
        }
    } catch (error) {
        console.error("[PATCH /api/clients/secret-phrase/[id]] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
}
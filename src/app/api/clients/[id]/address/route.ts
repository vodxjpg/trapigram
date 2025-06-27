// src/app/api/clients/[id]/address/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";


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

function decryptSecretNode(encryptedB64: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedB64, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const addressCreateSchema = z.object({
  clientId: z.string().uuid(),
  address: z.string().min(1, "Address is required"),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id: clientId } = await params;
    const result = await pool.query(
      `SELECT id, "clientId", address
       FROM "clientAddresses"
       WHERE "clientId" = $1`,
      [clientId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ addresses: [] });
    }

    const addresses = result.rows.map((row) => ({
      ...row,
      address: decryptSecretNode(row.address),
    }));

    return NextResponse.json({ addresses });
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
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id: clientId } = await params;
    const body = await req.json();

    const parsed = addressCreateSchema.parse({
      ...body,
      clientId,
    });

    const encryptedAddress = encryptSecretNode(parsed.address);
    const addressId = uuidv4();

    const insertQ = `
      INSERT INTO "clientAddresses" 
        (id, "clientId", address)
      VALUES ($1, $2, $3)
      RETURNING id, "clientId", address
    `;
    const values = [addressId, parsed.clientId, encryptedAddress];
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

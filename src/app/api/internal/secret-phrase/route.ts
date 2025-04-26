import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { auth } from "@/lib/auth"
import { Pool } from "pg"
import crypto from "crypto" // IMPORTANT: Node's built-in crypto

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string

// (1) We'll read the ENCRYPTION_KEY and ENCRYPTION_IV from env (not on the client).
// They must be base64-encoded. We'll parse them into raw bytes for Node crypto.
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || ""
const ENC_IV_B64  = process.env.ENCRYPTION_IV  || ""

function getEncryptionKeyAndIv(): { key: Buffer, iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64") // decode base64 -> bytes
  const iv  = Buffer.from(ENC_IV_B64,  "base64")
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

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-internal-secret")
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // Check user session
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // parse body
    // CHANGED: Now we expect { organizationId, secretPhrase } in plain text from client
    // We'll do the encryption here on the server
    const { organizationId, secretPhrase } = await req.json() as {
      organizationId: string
      secretPhrase: string
    }

    if (!organizationId || !secretPhrase) {
      return NextResponse.json({ error: "Missing orgId or secretPhrase" }, { status: 400 })
    }

    // (2) We do the encryption server-side
    const encryptedSecret = encryptSecretNode(secretPhrase)

    // (3) update the organization's encryptedSecret column
    await db
      .updateTable("organization")
      .set({ encryptedSecret }) // referencing the newly added column
      .where("id", "=", organizationId)
      .execute()

    return NextResponse.json({ message: "Secret phrase stored successfully" }, { status: 200 })
  } catch (error) {
    console.error("Error storing secret phrase:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
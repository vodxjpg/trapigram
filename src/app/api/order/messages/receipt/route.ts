import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { z } from "zod";
import { getContext } from "@/lib/context";

const schema = z.object({
  messageIds: z.array(z.string().min(1)).nonempty(),
  clientId:   z.string().min(1),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { messageIds, clientId } = schema.parse(await req.json());

    await pool.query(
      `INSERT INTO "orderMessageReceipts" ("messageId","clientId")
         SELECT id, $2 FROM unnest($1::text[]) AS id
         ON CONFLICT DO NOTHING`,
      [messageIds, clientId],
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

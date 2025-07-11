/* /src/app/api/affiliate/group-members/route.ts */
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/*──────── POST payload ────────*/
const joinSchema = z.object({
  groupId: z.string().min(1),      // Telegram @handle or numeric ID
  userId: z.string().min(1),
  clientId: z.string().uuid(),
  joinedAt: z.coerce.date().optional(),
});

/*──────── GET query params ────────*/
const querySchema = z.object({
  groupId: z.string().optional(),         // telegram handle
  affiliateGroupId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/*───────────────────────────────────────────────────────────*/
/*  GET – list members by groupId, affiliateGroupId or clientId */
/*───────────────────────────────────────────────────────────*/
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { groupId, affiliateGroupId, clientId, page, pageSize } =
    querySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));

  if (!groupId && !affiliateGroupId && !clientId) {
    return NextResponse.json(
      { error: "Provide groupId or affiliateGroupId or clientId query parameter" },
      { status: 400 },
    );
  }

  // figure out which affiliateGroupId to use if not filtering by clientId
  let agId: string | null = affiliateGroupId ?? null;
  if (!clientId && !agId) {
    const gRow = await db
      .selectFrom("affiliateGroups")
      .select("id")
      .where("organizationId", "=", ctx.organizationId)
      .where("groupId", "=", groupId!)
      .executeTakeFirst();

    if (!gRow) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    agId = gRow.id;
  }

  // 1) total count
  let countQ = db
    .selectFrom("affiliateGroupMembers")
    .select(db.fn.count("id").as("cnt"))
    .where("organizationId", "=", ctx.organizationId);

  if (clientId) {
    countQ = countQ.where("clientId", "=", clientId);
  } else {
    countQ = countQ.where("affiliateGroupId", "=", agId!);
  }

  const countRow = await countQ.executeTakeFirst();
  const total = Number(countRow?.cnt ?? 0);

  // 2) fetch paginated rows
  let fetchQ = db
    .selectFrom("affiliateGroupMembers")
    .select(["id", "userId", "clientId", "groupId", "joinedAt", "createdAt"])
    .where("organizationId", "=", ctx.organizationId);

  if (clientId) {
    fetchQ = fetchQ.where("clientId", "=", clientId);
  } else {
    fetchQ = fetchQ.where("affiliateGroupId", "=", agId!);
  }

  const members = await fetchQ
    .orderBy("joinedAt", "desc")
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();

  return NextResponse.json({
    members,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

/*───────────────────────────────────────────────────────────*/
/*  POST – bot registers a join                              */
/*───────────────────────────────────────────────────────────*/
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: z.infer<typeof joinSchema>;
  try {
    body = joinSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const grp = await db
    .selectFrom("affiliateGroups")
    .select("id")
    .where("organizationId", "=", ctx.organizationId)
    .where("groupId", "=", body.groupId)
    .executeTakeFirst();

  if (!grp) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  await db.transaction().execute(async (trx) => {
    const dupe = await trx
      .selectFrom("affiliateGroupMembers")
      .select("id")
      .where("affiliateGroupId", "=", grp.id)
      .where("clientId", "=", body.clientId)
      .executeTakeFirst();
    if (dupe) return;

    const now = new Date();
    await trx
      .insertInto("affiliateGroupMembers")
      .values({
        id: uuidv4(),
        organizationId: ctx.organizationId,
        affiliateGroupId: grp.id,
        groupId: body.groupId,
        userId: body.userId,
        clientId: body.clientId,
        joinedAt: body.joinedAt ?? now,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  });

  return NextResponse.json({ success: true });
}

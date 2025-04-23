import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;

    // Fetch share links
    const shareLinks = await db
      .selectFrom("warehouseShareLink")
      .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
      .select([
        "warehouseShareLink.id as shareLinkId",
        "warehouseShareLink.warehouseId",
        "warehouseShareLink.token",
        "warehouseShareLink.status",
        "warehouseShareLink.createdAt",
        "warehouse.name as warehouseName",
      ])
      .where("warehouseShareLink.creatorUserId", "=", userId)
      .execute();

    // Fetch recipients and products for each link
    const result = await Promise.all(
      shareLinks.map(async (link) => {
        const recipients = await db
          .selectFrom("warehouseShareRecipient")
          .select("recipientUserId")
          .where("shareLinkId", "=", link.shareLinkId)
          .execute();

        const products = await db
          .selectFrom("sharedProduct")
          .select(["productId", "variationId", "cost"])
          .where("shareLinkId", "=", link.shareLinkId)
          .execute();

        return {
          shareLinkId: link.shareLinkId,
          warehouseId: link.warehouseId,
          warehouseName: link.warehouseName,
          token: link.token,
          status: link.status,
          recipients: recipients.map((r) => r.recipientUserId),
          products,
          createdAt: link.createdAt,
        };
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[GET /api/users/me/share-links] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
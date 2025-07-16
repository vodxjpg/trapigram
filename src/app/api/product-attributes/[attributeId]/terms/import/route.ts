import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { pgPool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";

function capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function POST(req: Request, { params }: { params: Promise<{ attributeId: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    const { attributeId } = await params;

    const rowErrors: Array<{ row: number; error: string }> = [];
    let successCount = 0;
    let editCount = 0
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
        return NextResponse.json({ error: "No file provided under key 'file'" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "buffer" });

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // 1) Grab everything as an array of arrays (header:1)
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",       // empty cells as ""
        blankrows: false, // skip blank lines
    });

    // 2) Pull off the header row, skip the second row, collect the rest
    const [headerRow, /* skip */, ...dataRows] = rows;

    // 3) Rebuild an array of objects, mapping each dataRow back to headerRow
    const data = dataRows.map((row) => {
        const obj: Record<string, any> = {};
        headerRow.forEach((colName: string, idx: number) => {
            let cell = row[idx];
            if (colName === "id" && (!cell || cell === "")) {
                cell = "no-id";
            }
            obj[colName] = cell;
        });
        return obj;
    });

    if (!data) {
        return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    try {
        for (let i = 0; i < data.length; i++) {

            let id = ""
            const term = data[i]
            const rowNumber = i + 3;
            const hasId = term.id && term.id !== "no-id";
            if (hasId) id = term.id

            const findQuery = `SELECT * FROM "productAttributeTerms" WHERE id = $1`
            const result = await pgPool.query(findQuery, [id]);
            const res = result.rows

            if (res.length === 0) {

                console.log("CREATING")

                const name = capitalizeFirstLetter(term.name)

                await db.insertInto("productAttributeTerms")
                    .values({
                        id: uuidv4(),
                        attributeId,
                        name,
                        slug: term.name,
                        organizationId: organizationId,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }).execute()

                successCount++
            }

            if (res.length > 0) {
                const existing = res[0];
                // start with the timestamp
                const updatePayload: Record<string, any> = {
                    updatedAt: new Date(),
                };

                if (term.name && term.name.trim() !== "") {
                    const name = capitalizeFirstLetter(term.name)
                    updatePayload.slug = term.slug
                    updatePayload.name = name
                }

                // now run the update
                try {
                    await db
                        .updateTable("productAttributeTerms")
                        .set(updatePayload)
                        .where("id", "=", existing.id)
                        .execute();
                } catch (opErr: any) {
                    rowErrors.push({
                        row: rowNumber,
                        error: `Failed to update product ${existing.name}: ${opErr.message}`,
                    });
                    // skip further operations on this row
                    throw opErr;
                }

                editCount++
            }
        }
        return NextResponse.json({ rowCount: data.length, successCount, editCount }, { status: 201 });
    } catch (err: any) {
        console.error("Import XLSX error:", err);
        return NextResponse.json({ rowErrors }, { status: 500 });
    }
}
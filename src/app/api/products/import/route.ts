// app/api/product/import/route.ts
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

// Run this route in Node.js so that Buffer, FormData.arrayBuffer(), etc. work
export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided under key 'file'" }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "buffer" });

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convert sheet to JSON objects using first row as keys
        const data = XLSX.utils.sheet_to_json(worksheet, {
            defval: "",     // fill empty cells with ""
            blankrows: false, // skip entirely blank rows
        });

        console.log(data)

        return NextResponse.json({
            sheetName: firstSheetName,
            rows: data,
            rowCount: data.length,
        });
    } catch (err: any) {
        console.error("Import XLSX error:", err);
        return NextResponse.json({ error: err.message || err.toString() }, { status: 500 });
    }
}

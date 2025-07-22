import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { pgPool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";

/**
 * Pad a number to two digits.
 */
const pad2 = (n: number) => n.toString().padStart(2, "0");

/**
 * Given a Date, format it as "YYYY-MM-DD HH:mm:ss±HH"
 */
function formatWithOffset(date: Date): string {
    const YYYY = date.getFullYear();
    const MM = pad2(date.getMonth() + 1);
    const DD = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const mm = pad2(date.getMinutes());
    const ss = pad2(date.getSeconds());

    // getTimezoneOffset returns minutes behind UTC, so invert sign:
    const offsetMinutes = -date.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const offsetHours = pad2(Math.floor(Math.abs(offsetMinutes) / 60));

    return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}${offsetSign}${offsetHours}`;
}

/**
 * Parse "DD/MM/YYYY" into a local-midnight Date,
 * then format it with offset.
 */
function dmyToTimestampWithOffset(dmy: string): string {
    const [dayStr, monthStr, yearStr] = dmy.split("/");
    const day = parseInt(dayStr, 10);
    const month = parseInt(monthStr, 10) - 1;
    const year = parseInt(yearStr, 10);

    const date = new Date(year, month, day, 0, 0, 0, 0);
    return formatWithOffset(date);
}

export async function POST(req: Request) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

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
            const coupon = data[i]
            const rowNumber = i + 3;
            const hasId = coupon.id && coupon.id !== "no-id";
            if (hasId) id = coupon.id

            const findQuery = `SELECT * FROM "coupons" WHERE id = $1`
            const result = await pgPool.query(findQuery, [id]);
            const res = result.rows

            if (res.length === 0) {

                console.log("CREATING")
                const couponName = coupon.code.toUpperCase()
                const countries = coupon.countries
                const countryArray = countries
                    .split(",")
                    .map(s => s.trim());

                if (coupon.discountType !== "percentage" && coupon.discountType !== "fixed") {
                    coupon.discountType = "percentage"
                }

                // treat "0" or numeric 0 as null, otherwise parse DD/MM/YYYY
                const rawStart = coupon.startDate;
                const from =
                    rawStart !== undefined && rawStart !== 0 && String(rawStart).trim() !== ""
                        ? dmyToTimestampWithOffset(String(rawStart).trim())
                        : null;
                const rawExp = coupon.expirationDate;
                const to =
                    rawExp !== undefined && rawExp !== 0 && String(rawExp).trim() !== ""
                        ? dmyToTimestampWithOffset(String(rawExp).trim())
                        : null;
                console.log("startDate:", from, "expirationDate:", to);

                await db.insertInto("coupons")
                    .values({
                        id: uuidv4(),
                        organizationId,
                        name: coupon.name,
                        code: couponName,
                        description: coupon.description,
                        discountAmount: coupon.discountAmount,
                        discountType: coupon.discountType,
                        startDate: from,
                        expirationDate: to,
                        limitPerUser: coupon.limitPerUser,
                        usagePerUser: coupon.usagePerUser,
                        usageLimit: coupon.usageLimit,
                        expendingMinimum: coupon.expendingMin,
                        expendingLimit: coupon.expendingLimit,
                        countries: JSON.stringify(countryArray),
                        visibility: coupon.visibility = 1 ? true : false,
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

                if (coupon.name && coupon.name.trim() !== "") {
                    updatePayload.name = coupon.name
                }

                if (coupon.code && coupon.code.trim() !== "") {
                    const couponName = coupon.code.toUpperCase()
                    updatePayload.code = couponName
                }

                if (coupon.description && coupon.description.trim() !== "") {
                    updatePayload.description = coupon.description
                }

                if (coupon.discountAmount && coupon.discountAmount.trim() !== "") {
                    updatePayload.discountAmount = coupon.discountAmount
                }

                if (coupon.discountType && coupon.discountType.trim() !== "") {
                    updatePayload.discountType = coupon.discountType
                }

                const rs = coupon.startDate;
                if (rs !== undefined && rs !== 0 && String(rs).trim() !== "") {
                    updatePayload.startDate = dmyToTimestampWithOffset(String(rs).trim());
                }
                const re = coupon.expirationDate;
                if (re !== undefined && re !== 0 && String(re).trim() !== "") {
                    updatePayload.expirationDate = dmyToTimestampWithOffset(String(re).trim());
                }

                const lpu = coupon.limitPerUser.toString()
                console.log(coupon.limitPerUser, coupon.usagePerUser)
                if (lpu && lpu.trim() !== "") {
                    updatePayload.limitPerUser = coupon.limitPerUser
                }

                const upu = coupon.usagePerUser.toString()
                if (upu && upu.trim() !== "") {
                    updatePayload.usagePerUser = coupon.usagePerUser
                }

                const uspu = coupon.usageLimit.toString()
                if (uspu && uspu.trim() !== "") {
                    updatePayload.usageLimit = coupon.usageLimit
                }

                const emin = coupon.expendingMinimum.toString()
                if (emin && emin.trim() !== "") {
                    updatePayload.expendingMinimum = coupon.expendingMinimum
                }

                const emax = coupon.expendingLimit.toString()
                if (emax && emax.trim() !== "") {
                    updatePayload.expendingLimit = coupon.expendingLimit
                }

                if (coupon.countries && coupon.countries.trim() !== "") {
                    const countries = coupon.countries
                    const countryArray = countries
                        .split(",")
                        .map(s => s.trim());
                    updatePayload.countries = JSON.stringify(countryArray)
                }

                const vis = coupon.visibility.toString()
                if (vis && vis.trim() !== "") {
                    updatePayload.visibility = coupon.visibility = 1 ? true : false
                }

                // now run the update
                try {
                    await db
                        .updateTable("coupons")
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
            return NextResponse.json({ rowCount: data.length, successCount, editCount }, { status: 201 });
        }
    } catch (err: any) {
        console.error("Import XLSX error:", err);
        return NextResponse.json({ rowErrors }, { status: 500 });
    }
}
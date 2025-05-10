// src/app/api/placeholders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { placeholderDefs } from "@/lib/placeholder-meta";


export function GET(_req: NextRequest) {
  return NextResponse.json({ placeholders: placeholderDefs });
}

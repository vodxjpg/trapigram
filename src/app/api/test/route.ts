import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
    console.log("Probando")
    let a = 1
    let b = 0
    while (a <= 5) {
        console.log(b + a)
        a++
        b++
        console.log(a, b)
        b = -5
    }
}
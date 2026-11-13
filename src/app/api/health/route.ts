import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "asistencia-escolar", version: "2.0.0" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

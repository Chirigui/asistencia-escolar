import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
export async function GET() {
  try {
    const { count, error } = await createAdminClient()
      .from("academic_periods")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .abortSignal(AbortSignal.timeout(4000));
    if (error || count !== 1) return NextResponse.json({ status: "degraded" }, { status: 503 });
    return NextResponse.json(
      { status: "ready" },
      { headers: { "Cache-Control": "public, s-maxage=30, max-age=0" } },
    );
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}

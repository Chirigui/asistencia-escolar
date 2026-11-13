import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/validation";
import { decodeCursor, encodeCursor, cursorFilter } from "@/lib/pagination";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id))
    return NextResponse.json({ success: false, message: "Sesión inválida." }, { status: 404 });
  try {
    const cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));
    let query = auth.ctx.supabase
      .from("audit_events")
      .select(
        "id,occurred_at,actor_id,action,before_value,after_value,request_id,actor:profiles(full_name)",
      )
      .eq("session_id", id)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(101);
    if (cursor) query = query.or(cursorFilter("occurred_at", cursor));
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []).slice(0, 100);
    const last = rows.at(-1);
    return NextResponse.json({
      success: true,
      events: rows,
      nextCursor:
        (data?.length || 0) > 100 && last
          ? encodeCursor({ timestamp: last.occurred_at, id: last.id })
          : null,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "No fue posible consultar el historial." },
      { status: 400 },
    );
  }
}

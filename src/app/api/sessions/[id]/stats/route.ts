import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeGroupText } from "@/lib/utils";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const db = createAdminClient();
    const { data: session, error } = await db.from("sessions").select("id, teacher_id, group_name").eq("id", params.id).single();
    if (error || !session) return NextResponse.json({ success: false, message: "Sesión no encontrada." }, { status: 404 });
    if (auth.user.role !== "admin" && session.teacher_id !== auth.user.id) {
      return NextResponse.json({ success: false, message: "No tienes permiso para consultar esta sesión." }, { status: 403 });
    }

    const [{ count, error: attendanceError }, { data: groupCounts, error: groupsError }] = await Promise.all([
      db.from("attendances").select("id", { count: "exact", head: true }).eq("session_id", session.id),
      db.rpc("get_active_student_counts_by_group"),
    ]);
    if (attendanceError || groupsError) throw attendanceError || groupsError;
    const total = Number(groupCounts?.find((g: { group_name: string }) => normalizeGroupText(g.group_name) === normalizeGroupText(session.group_name))?.student_count || 0);
    const presentsCount = count || 0;
    return NextResponse.json({ success: true, stats: { total, presentsCount, absentsCount: Math.max(0, total - presentsCount) } });
  } catch (error) {
    console.error("Error cargando estadísticas de sesión:", error);
    return NextResponse.json({ success: false, message: "No se pudieron cargar las estadísticas." }, { status: 500 });
  }
}

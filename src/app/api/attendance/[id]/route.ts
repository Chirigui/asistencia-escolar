import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { attendanceUpdateSchema, readJson } from "@/lib/validation";

async function getAttendanceAndAuthorize(id: string, user: { id: string; role: string }): Promise<
  { ok: false; response: NextResponse } | { ok: true; db: ReturnType<typeof createAdminClient>; attendance: any }
> {
  const db = createAdminClient();
  const { data: attendance, error } = await db.from("attendances")
    .select("id, session_id, student_id, status, notes, session:sessions!inner(teacher_id)")
    .eq("id", id).single();
  if (error || !attendance) return { ok: false, response: NextResponse.json({ success: false, message: "Asistencia no encontrada." }, { status: 404 }) };
  const session = Array.isArray(attendance.session) ? attendance.session[0] : attendance.session;
  if (user.role !== "admin" && session?.teacher_id !== user.id) {
    return { ok: false, response: NextResponse.json({ success: false, message: "No tienes permiso para modificar esta asistencia." }, { status: 403 }) };
  }
  return { ok: true, db, attendance };
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const parsed = await readJson(request, attendanceUpdateSchema);
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: "Estado o nota inválidos." }, { status: 400 });
    }
    const body = parsed.data;
    const access = await getAttendanceAndAuthorize(params.id, auth.user);
    if (!access.ok) return access.response;
    const { data, error } = await access.db.rpc("update_attendance_with_audit", {
      p_attendance_id: params.id,
      p_status: body.status,
      p_notes: body.notes?.trim() || null,
      p_actor_id: auth.user.id,
    });
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, message: "Asistencia no encontrada." }, { status: 404 });
    return NextResponse.json({ success: true, attendance: data });
  } catch (error) {
    console.error("Error corrigiendo asistencia:", error);
    return NextResponse.json({ success: false, message: "No se pudo actualizar la asistencia." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const access = await getAttendanceAndAuthorize(params.id, auth.user);
    if (!access.ok) return access.response;
    const { data, error } = await access.db.rpc("undo_attendance_with_audit", {
      p_attendance_id: params.id,
      p_actor_id: auth.user.id,
    });
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, message: "Asistencia no encontrada." }, { status: 404 });
    return NextResponse.json({ success: true, message: "Marcación deshecha." });
  } catch (error) {
    console.error("Error deshaciendo asistencia:", error);
    return NextResponse.json({ success: false, message: "No se pudo deshacer la marcación." }, { status: 500 });
  }
}

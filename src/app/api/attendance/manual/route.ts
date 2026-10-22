import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDocument, normalizeGroupText } from "@/lib/utils";
import { manualAttendanceSchema, readJson } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const auth = await requireUser();
    if (auth.response) return auth.response;

    const parsed = await readJson(request, manualAttendanceSchema);
    if (!parsed.success) return NextResponse.json({ success: false, message: "Datos de marcación inválidos." }, { status: 400 });
    const { sessionId, document, status, notes } = parsed.data;

    const docNorm = normalizeDocument(document);
    const adminDb = createAdminClient();
    const { data: session } = await adminDb.from("sessions").select("id, teacher_id, group_name").eq("id", sessionId).single();
    if (!session) return NextResponse.json({ success: false, message: "Sesión no encontrada." }, { status: 404 });
    if (auth.user.role !== "admin" && session.teacher_id !== auth.user.id) return NextResponse.json({ success: false, message: "No tienes permiso para modificar esta sesión." }, { status: 403 });

    // 1. Buscar estudiante
    const { data: student, error: stError } = await adminDb
      .from("students")
      .select("id, full_name, grade, group_name")
      .eq("document_normalized", docNorm)
      .single();

    if (stError || !student) {
      return NextResponse.json(
        { success: false, message: "Estudiante no encontrado en el padrón escolar." },
        { status: 404 }
      );
    }
    if (normalizeGroupText(student.group_name) !== normalizeGroupText(session.group_name)) {
      return NextResponse.json({ success: false, message: "El estudiante no pertenece al grupo de esta sesión." }, { status: 400 });
    }

    // 2. Insertar asistencia manual
    const { data: attendance, error: attError } = await adminDb.rpc("mark_attendance_manual", {
      p_session_id: sessionId,
      p_student_id: student.id,
      p_status: status,
      p_notes: typeof notes === "string" ? notes.trim() || null : "Marcado manual por profesor",
      p_actor_id: auth.user.id,
    });

    if (attError) {
      if (attError.code === "23505") {
        return NextResponse.json(
          { success: false, message: "El estudiante ya figuraba como registrado en esta sesión." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, message: "Error al registrar: " + attError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Asistencia de ${student.full_name} registrada con éxito.`,
      attendance,
    });
  } catch (err: any) {
    console.error("Error registrando asistencia manual:", err);
    return NextResponse.json({ success: false, message: "No se pudo registrar la asistencia manual." }, { status: 500 });
  }
}

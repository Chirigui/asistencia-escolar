import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateQrDataUrl } from "@/lib/qr";
import { normalizeGroupText } from "@/lib/utils";
import { readJson, sessionUpdateSchema } from "@/lib/validation";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser();
    if (auth.response) return auth.response;

    const sessionId = params.id;
    const adminDb = createAdminClient();

    // 1. Obtener datos de la sesión
    const { data: session, error: sesError } = await adminDb
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sesError || !session) {
      return NextResponse.json({ success: false, message: "Sesión no encontrada." }, { status: 404 });
    }
    if (auth.user.role !== "admin" && session.teacher_id !== auth.user.id) {
      return NextResponse.json({ success: false, message: "No tienes permiso para consultar esta sesión." }, { status: 403 });
    }

    // 2. Obtener asistencias registradas
    const { data: attendances } = await adminDb
      .from("attendances")
      .select(`
        id,
        registered_at,
        status,
        method,
        notes,
        marked_by,
        marker:profiles!attendances_marked_by_fkey(full_name),
        student:students (
          id,
          document,
          document_normalized,
          full_name,
          grade,
          group_name
        )
      `)
      .eq("session_id", sessionId)
      .order("registered_at", { ascending: false });

    const presentMap = new Set<string>();
    const presents = (attendances || []).map((att: any) => {
      const student = att.student;
      if (student?.document_normalized) {
        presentMap.add(student.document_normalized);
      }
      return {
        attendanceId: att.id,
        registeredAt: att.registered_at,
        status: att.status,
        method: att.method,
        notes: att.notes,
        markedBy: Array.isArray(att.marker) ? att.marker[0]?.full_name || null : att.marker?.full_name || null,
        document: student?.document || "",
        fullName: student?.full_name || "",
        grade: student?.grade || "",
        groupName: student?.group_name || "",
      };
    });

    // 3. Obtener todos los estudiantes activos de este grupo para calcular ausentes
    const { data: groupVariants } = await adminDb.rpc("get_group_name_variants", { p_group_name: normalizeGroupText(session.group_name) });
    const names = (groupVariants || []).map((row: { group_name: string }) => row.group_name);
    const { data: groupStudents } = await adminDb
      .from("students")
      .select("id, document, document_normalized, full_name, grade, group_name")
      .eq("status", "ACTIVO")
      .in("group_name", names.length ? names : [session.group_name]);

    const absents: any[] = [];
    (groupStudents || []).forEach((st) => {
      if (!presentMap.has(st.document_normalized)) {
        absents.push({
          id: st.id,
          document: st.document,
          fullName: st.full_name,
          grade: st.grade,
          groupName: st.group_name,
        });
      }
    });

    absents.sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const sessionUrl = `${baseUrl}/asistencia?sesion=${session.code}`;
    const qrDataUrl = await generateQrDataUrl(sessionUrl);

    return NextResponse.json({
      success: true,
      session,
      sessionUrl,
      qrDataUrl,
      stats: {
        total: presents.length + absents.length,
        presentsCount: presents.length,
        absentsCount: absents.length,
      },
      presents,
      absents,
    });
  } catch (err: any) {
    console.error("Error consultando sesión:", err);
    return NextResponse.json({ success: false, message: "No se pudo cargar la sesión." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser();
    if (auth.response) return auth.response;

    const sessionId = params.id;
    const parsed = await readJson(request, sessionUpdateSchema);
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: "Estado de sesión inválido." }, { status: 400 });
    }
    const { status } = parsed.data;

    const adminDb = createAdminClient();
    const { data: ownedSession } = await adminDb.from("sessions").select("teacher_id").eq("id", sessionId).single();
    if (!ownedSession) return NextResponse.json({ success: false, message: "Sesión no encontrada." }, { status: 404 });
    if (auth.user.role !== "admin" && ownedSession.teacher_id !== auth.user.id) return NextResponse.json({ success: false, message: "No tienes permiso para modificar esta sesión." }, { status: 403 });
    const { data: updated, error } = await adminDb
      .from("sessions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .select()
      .single();

    if (error) {
      console.error("Error actualizando sesión:", error);
      return NextResponse.json({ success: false, message: "No se pudo actualizar la sesión." }, { status: 500 });
    }

    return NextResponse.json({ success: true, session: updated });
  } catch (err: any) {
    console.error("Error actualizando sesión:", err);
    return NextResponse.json({ success: false, message: "No se pudo actualizar la sesión." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateQrDataUrl } from "@/lib/qr";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 });
    }

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

    // 2. Obtener asistencias registradas
    const { data: attendances } = await adminDb
      .from("attendances")
      .select(`
        id,
        registered_at,
        status,
        method,
        notes,
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
        document: student?.document || "",
        fullName: student?.full_name || "",
        grade: student?.grade || "",
        groupName: student?.group_name || "",
      };
    });

    // 3. Obtener todos los estudiantes activos de este grupo para calcular ausentes
    const { data: groupStudents } = await adminDb
      .from("students")
      .select("id, document, document_normalized, full_name, grade, group_name")
      .eq("status", "ACTIVO")
      .eq("group_name", session.group_name);

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
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 });
    }

    const sessionId = params.id;
    const body = await request.json();
    const { status } = body;

    if (!["ABIERTA", "CERRADA", "FINALIZADA"].includes(status)) {
      return NextResponse.json({ success: false, message: "Estado de sesión inválido." }, { status: 400 });
    }

    const adminDb = createAdminClient();
    const { data: updated, error } = await adminDb
      .from("sessions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, session: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

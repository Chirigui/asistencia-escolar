import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { generateQrDataUrl } from "@/lib/qr";
import { normalizeGroupText } from "@/lib/utils";
import { getAppBaseUrl, isUuid, readJsonObject } from "@/lib/validation";

const SESSION_STATUSES = ["ABIERTA", "CERRADA", "FINALIZADA"] as const;

interface AttendanceRecord {
  id: string;
  registered_at: string;
  status: string;
  method: string;
  notes: string | null;
  student?: {
    id?: string;
    document?: string;
    document_normalized?: string;
    full_name?: string;
    grade?: string;
    group_name?: string;
  } | null;
}

interface StudentRecord {
  id: string;
  document: string;
  document_normalized: string;
  full_name: string;
  grade: string;
  group_name: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  if (!isUuid(id)) {
    return NextResponse.json(
      { success: false, message: "Sesión no encontrada." },
      { status: 404 }
    );
  }

  try {
    const { supabase } = auth.ctx;

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    // RLS oculta las sesiones de otros docentes: para ellos también es 404.
    if (sessionError || !session) {
      return NextResponse.json(
        { success: false, message: "Sesión no encontrada." },
        { status: 404 }
      );
    }

    const { data: attendances, error: attendancesError } = await supabase
      .from("attendances")
      .select(
        `
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
      `
      )
      .eq("session_id", session.id)
      .order("registered_at", { ascending: false });

    if (attendancesError) {
      console.error("Error cargando asistencias:", attendancesError);
      return NextResponse.json(
        { success: false, message: "No fue posible cargar las asistencias." },
        { status: 500 }
      );
    }

    const presentStudentIds = new Set<string>();
    const presentDocuments = new Set<string>();
    const presents = (attendances as AttendanceRecord[] | null || []).map((attendance) => {
      const student = attendance.student;
      if (student?.id) presentStudentIds.add(student.id);
      if (student?.document_normalized) {
        presentDocuments.add(student.document_normalized);
      }

      return {
        attendanceId: attendance.id,
        registeredAt: attendance.registered_at,
        status: attendance.status,
        method: attendance.method,
        notes: attendance.notes,
        document: student?.document || "",
        fullName: student?.full_name || "",
        grade: student?.grade || "",
        groupName: student?.group_name || "",
      };
    });

    let groupStudents: StudentRecord[] | null = null;
    const exactGroup = await supabase
      .from("students")
      .select("id, document, document_normalized, full_name, grade, group_name")
      .eq("status", "ACTIVO")
      .eq("group_name", session.group_name);

    if (exactGroup.error) {
      console.error("Error cargando estudiantes del grupo:", exactGroup.error);
    } else {
      groupStudents = exactGroup.data;
    }

    // Compatibilidad con sesiones antiguas que guardaban "10-A" en vez de "10A".
    if (!groupStudents || groupStudents.length === 0) {
      const { data: activeStudents, error: fallbackError } = await supabase
        .from("students")
        .select("id, document, document_normalized, full_name, grade, group_name")
        .eq("status", "ACTIVO")
        .limit(2000);

      if (!fallbackError) {
        const targetGroup = normalizeGroupText(session.group_name);
        groupStudents = (activeStudents || []).filter(
          (student: { group_name: string | null }) =>
            normalizeGroupText(student.group_name || "") === targetGroup
        );
      }
    }

    const absents = (groupStudents || [])
      .filter(
        (student) =>
          !presentStudentIds.has(student.id) &&
          !presentDocuments.has(student.document_normalized)
      )
      .map((student) => ({
        id: student.id,
        document: student.document,
        fullName: student.full_name,
        grade: student.grade,
        groupName: student.group_name,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));

    const sessionUrl = `${getAppBaseUrl(request)}/asistencia?sesion=${encodeURIComponent(
      session.code
    )}`;
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
  } catch (error) {
    console.error("Error inesperado en GET /api/sessions/[id]:", error);
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  if (!isUuid(id)) {
    return NextResponse.json(
      { success: false, message: "Sesión no encontrada." },
      { status: 404 }
    );
  }

  const body = await readJsonObject(request);
  const status = body?.status;

  if (
    typeof status !== "string" ||
    !SESSION_STATUSES.includes(status as (typeof SESSION_STATUSES)[number])
  ) {
    return NextResponse.json(
      { success: false, message: "Estado de sesión inválido." },
      { status: 400 }
    );
  }

  try {
    const { supabase } = auth.ctx;
    const { data: updated, error } = await supabase
      .from("sessions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("Error actualizando sesión:", error);
      return NextResponse.json(
        { success: false, message: "No fue posible actualizar la sesión." },
        { status: 500 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        { success: false, message: "Sesión no encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, session: updated });
  } catch (error) {
    console.error("Error inesperado en PATCH /api/sessions/[id]:", error);
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { normalizeDocument, normalizeGroupText } from "@/lib/utils";
import { cleanString, isUuid, readJsonObject } from "@/lib/validation";

const ATTENDANCE_STATUSES = ["PRESENTE", "TARDE", "JUSTIFICADO"] as const;

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      { success: false, message: "Cuerpo de solicitud inválido." },
      { status: 400 }
    );
  }

  const sessionId = body.sessionId;
  const rawDocument = cleanString(body.document, 40);
  const document = normalizeDocument(rawDocument);
  const requestedStatus = cleanString(body.status, 20).toUpperCase() || "PRESENTE";
  const notes = cleanString(body.notes, 500);

  if (!isUuid(sessionId) || !document) {
    return NextResponse.json(
      { success: false, message: "ID de sesión y documento requeridos." },
      { status: 400 }
    );
  }

  if (document.length < 4 || document.length > 30) {
    return NextResponse.json(
      { success: false, message: "Documento de estudiante inválido." },
      { status: 400 }
    );
  }

  if (
    !ATTENDANCE_STATUSES.includes(
      requestedStatus as (typeof ATTENDANCE_STATUSES)[number]
    )
  ) {
    return NextResponse.json(
      { success: false, message: "Estado de asistencia inválido." },
      { status: 400 }
    );
  }

  try {
    const { supabase } = auth.ctx;

    // RLS garantiza que el docente sólo puede leer sesiones propias.
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, status, group_name, date")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json(
        { success: false, message: "Sesión no encontrada o sin permisos." },
        { status: 404 }
      );
    }

    if (session.status !== "ABIERTA") {
      return NextResponse.json(
        {
          success: false,
          message: "La sesión está cerrada. Reábrela antes de registrar asistencia manual.",
        },
        { status: 409 }
      );
    }

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id, full_name, grade, group_name, status")
      .ilike("document_normalized", document)
      .maybeSingle();

    if (studentError || !student) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Estudiante no encontrado en el padrón o no pertenece al grupo de esta sesión.",
        },
        { status: 404 }
      );
    }

    if (student.status !== "ACTIVO") {
      return NextResponse.json(
        { success: false, message: "El estudiante no está activo en el sistema." },
        { status: 409 }
      );
    }

    if (
      normalizeGroupText(student.group_name) !==
      normalizeGroupText(session.group_name)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "El estudiante no pertenece al grupo de esta sesión.",
        },
        { status: 409 }
      );
    }

    const { data: attendance, error: attendanceError } = await supabase
      .from("attendances")
      .insert({
        session_id: sessionId,
        student_id: student.id,
        status: requestedStatus,
        method: "MANUAL",
        notes: notes || "Marcado manual por profesor",
      })
      .select()
      .single();

    if (attendanceError) {
      if (attendanceError.code === "23505") {
        return NextResponse.json(
          {
            success: false,
            message: "El estudiante ya figuraba como registrado en esta sesión.",
          },
          { status: 409 }
        );
      }

      console.error("Error registrando asistencia manual:", attendanceError);
      return NextResponse.json(
        { success: false, message: "No fue posible registrar la asistencia." },
        { status: 500 }
      );
    }

    // La incidencia es auditoría secundaria: si falla, la asistencia ya quedó
    // registrada y no se debe reportar un error al docente.
    const { error: incidentError } = await supabase.from("incidents").insert({
      session_id: sessionId,
      student_id: student.id,
      document_attempted: document,
      incident_type: "REGISTRO_MANUAL_DOCENTE",
      details: notes ? `Motivo: ${notes}` : "Marcado manual en panel docente",
    });

    if (incidentError) {
      console.error("No se pudo registrar la incidencia de auditoría:", incidentError);
    }

    return NextResponse.json({
      success: true,
      message: `Asistencia de ${student.full_name} registrada con éxito.`,
      attendance,
    });
  } catch (error) {
    console.error("Error inesperado en POST /api/attendance/manual:", error);
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

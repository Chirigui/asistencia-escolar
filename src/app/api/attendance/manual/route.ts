import { logError } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { normalizeDocument } from "@/lib/utils";
import { cleanString, isUuid, readJsonObject } from "@/lib/validation";

const ATTENDANCE_STATUSES = ["PRESENTE", "TARDE", "JUSTIFICADO"] as const;

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      { success: false, message: "Cuerpo de solicitud inválido." },
      { status: 400 },
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
      { status: 400 },
    );
  }

  if (document.length < 4 || document.length > 30) {
    return NextResponse.json(
      { success: false, message: "Documento de estudiante inválido." },
      { status: 400 },
    );
  }

  if (!ATTENDANCE_STATUSES.includes(requestedStatus as (typeof ATTENDANCE_STATUSES)[number])) {
    return NextResponse.json(
      { success: false, message: "Estado de asistencia inválido." },
      { status: 400 },
    );
  }

  try {
    const { supabase } = auth.ctx;

    const { data, error } = await supabase.rpc("record_manual_attendance", {
      p_session_id: sessionId,
      p_document: document,
      p_status: requestedStatus,
      p_notes: notes || "Marcado manual docente",
    });
    if (error)
      return NextResponse.json(
        {
          success: false,
          message: "No fue posible registrar: verifica sesión abierta, matrícula y permisos.",
        },
        { status: error.code === "42501" ? 403 : error.code === "23514" ? 409 : 500 },
      );
    return NextResponse.json(
      {
        ...data,
        message: data?.success ? "Asistencia registrada." : "El estudiante ya estaba registrado.",
      },
      { status: data?.success ? 200 : 409 },
    );
  } catch (error) {
    logError("src/app/api/attendance/manual", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 },
    );
  }
}

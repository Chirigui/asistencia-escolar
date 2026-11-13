import { logError } from "@/lib/observability";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDocument } from "@/lib/utils";
import { checkDistributedLimit } from "@/lib/distributed-limit";
import { verifyQrToken } from "@/lib/qr-token";
import { cleanString, getClientIp, readJsonObject } from "@/lib/validation";

const SESSION_CODE_RE = /^[A-Z0-9-]{1,32}$/;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = await checkDistributedLimit("attendance-global", ip, "", 3000);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: "Demasiados intentos desde esta conexión. Espera un minuto.",
      },
      {
        status: limit.unavailable ? 503 : 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      { success: false, message: "Cuerpo de solicitud inválido." },
      { status: 400 },
    );
  }

  const sessionCode = cleanString(body.sessionCode, 32).toUpperCase();
  const rawDocument = cleanString(body.document, 40);
  const document = normalizeDocument(rawDocument);

  if (!sessionCode || !rawDocument) {
    return NextResponse.json(
      { success: false, message: "Código de sesión y documento son requeridos." },
      { status: 400 },
    );
  }

  if (!SESSION_CODE_RE.test(sessionCode)) {
    return NextResponse.json(
      { success: false, message: "El código de sesión no es válido." },
      { status: 400 },
    );
  }

  if (document.length < 4 || document.length > 30) {
    return NextResponse.json(
      { success: false, message: "Por favor ingresa un documento de identidad válido." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();

    const pairLimit = await checkDistributedLimit(
      "attendance-document",
      ip,
      sessionCode + ":" + document,
      10,
    );
    if (!pairLimit.allowed)
      return NextResponse.json(
        { success: false, message: "Espera un minuto antes de volver a intentar." },
        {
          status: pairLimit.unavailable ? 503 : 429,
          headers: { "Retry-After": String(pairLimit.retryAfterSeconds) },
        },
      );
    const token = cleanString(body.token, 100);
    if (!verifyQrToken(sessionCode, token, process.env.SUPABASE_SERVICE_ROLE_KEY!)) {
      const { data: session } = await supabase
        .from("sessions")
        .select("qr_token_required")
        .eq("code", sessionCode)
        .maybeSingle();
      if (!session || session.qr_token_required)
        return NextResponse.json(
          {
            success: false,
            message: "El QR venció o no es válido. Escanea el código actualizado del profesor.",
          },
          { status: 410 },
        );
    }
    // Función transaccional: valida sesión, fecha, horario, grupo y duplicados.
    const { data, error } = await supabase.rpc("register_student_attendance", {
      p_session_code: sessionCode,
      p_document_normalized: document,
      p_ip: null,
      p_user_agent: null,
    });

    if (error) {
      logError("src/app/api/attendance/register", error, request.headers.get("x-request-id"));
      return NextResponse.json(
        { success: false, message: "Error al procesar el registro en la base de datos." },
        { status: 500 },
      );
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      logError("src/app/api/attendance/register", data, request.headers.get("x-request-id"));
      return NextResponse.json(
        { success: false, message: "Error al procesar el registro." },
        { status: 500 },
      );
    }

    const result = data as {
      success: boolean;
      code: string;
      message: string;
      data?: unknown;
    };

    const status = result.success
      ? 200
      : result.code === "ALREADY_REGISTERED" || result.code === "SESSION_CLOSED"
        ? 409
        : 400;

    return NextResponse.json(result, { status });
  } catch (error) {
    logError("src/app/api/attendance/register", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      { success: false, message: "Error en el servidor al registrar asistencia." },
      { status: 500 },
    );
  }
}

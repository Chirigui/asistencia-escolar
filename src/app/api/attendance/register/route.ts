import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDocument } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  cleanString,
  getClientIp,
  readJsonObject,
} from "@/lib/validation";

const SESSION_CODE_RE = /^[A-Z0-9-]{1,32}$/;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`attendance-register:${ip}`, 60, 60_000);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: "Demasiados intentos desde esta conexión. Espera un minuto.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      { success: false, message: "Cuerpo de solicitud inválido." },
      { status: 400 }
    );
  }

  const sessionCode = cleanString(body.sessionCode, 32).toUpperCase();
  const rawDocument = cleanString(body.document, 40);
  const document = normalizeDocument(rawDocument);

  if (!sessionCode || !rawDocument) {
    return NextResponse.json(
      { success: false, message: "Código de sesión y documento son requeridos." },
      { status: 400 }
    );
  }

  if (!SESSION_CODE_RE.test(sessionCode)) {
    return NextResponse.json(
      { success: false, message: "El código de sesión no es válido." },
      { status: 400 }
    );
  }

  if (document.length < 4 || document.length > 30) {
    return NextResponse.json(
      { success: false, message: "Por favor ingresa un documento de identidad válido." },
      { status: 400 }
    );
  }

  const userAgent = cleanString(
    request.headers.get("user-agent") ?? "desconocido",
    300
  );

  try {
    const supabase = createAdminClient();

    // Función transaccional: valida sesión, fecha, horario, grupo y duplicados.
    const { data, error } = await supabase.rpc("register_student_attendance", {
      p_session_code: sessionCode,
      p_document_normalized: document,
      p_ip: ip,
      p_user_agent: userAgent,
    });

    if (error) {
      console.error("Error ejecutando register_student_attendance:", error);
      return NextResponse.json(
        { success: false, message: "Error al procesar el registro en la base de datos." },
        { status: 500 }
      );
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.error("Respuesta inesperada de register_student_attendance:", data);
      return NextResponse.json(
        { success: false, message: "Error al procesar el registro." },
        { status: 500 }
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
    console.error("Error inesperado en /api/attendance/register:", error);
    return NextResponse.json(
      { success: false, message: "Error en el servidor al registrar asistencia." },
      { status: 500 }
    );
  }
}

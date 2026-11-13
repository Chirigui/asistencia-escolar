import { logError } from "@/lib/observability";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDistributedLimit } from "@/lib/distributed-limit";
import { verifyQrToken } from "@/lib/qr-token";
import { getClientIp } from "@/lib/validation";

const SESSION_CODE_RE = /^[A-Z0-9-]{1,32}$/;

function todayInAppTimeZone(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const limit = await checkDistributedLimit("session-info", ip, "", 3000);

  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, message: "Demasiadas consultas. Intenta de nuevo en un minuto." },
      {
        status: limit.unavailable ? 503 : 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") ?? "").trim().toUpperCase();

  if (!code) {
    return NextResponse.json(
      { success: false, message: "Código de sesión no proporcionado." },
      { status: 400 },
    );
  }

  if (!SESSION_CODE_RE.test(code)) {
    return NextResponse.json(
      { success: false, message: "El código de sesión no es válido." },
      { status: 400 },
    );
  }

  try {
    // El cliente administrativo permite consultar el estado aunque la sesión
    // esté cerrada, sin exponer teacher_id ni permisos de escritura.
    const supabase = createAdminClient();

    const { data: session, error } = await supabase
      .from("sessions")
      .select(
        "code, subject, group_name, date, start_time, end_time, status, qr_token_required,registration_opens_at,registration_closes_at",
      )
      .eq("code", code)
      .maybeSingle();

    if (error) {
      logError("src/app/api/sessions/info", error, request.headers.get("x-request-id"));
      return NextResponse.json(
        { success: false, message: "Error interno del servidor." },
        { status: 500 },
      );
    }

    if (!session) {
      return NextResponse.json(
        { success: false, message: "La sesión no existe o ya caducó." },
        { status: 404 },
      );
    }

    if (
      session.qr_token_required &&
      !verifyQrToken(code, searchParams.get("token") || "", process.env.SUPABASE_SERVICE_ROLE_KEY!)
    )
      return NextResponse.json(
        {
          success: false,
          message: "El QR venció o no es válido. Pide al profesor actualizar el código.",
        },
        { status: 410 },
      );
    if (session.status !== "ABIERTA") {
      return NextResponse.json(
        {
          success: false,
          message: "El profesor ha cerrado la toma de asistencia para esta clase.",
        },
        { status: 409 },
      );
    }

    const now = Date.now();
    if (
      session.registration_opens_at &&
      session.registration_closes_at &&
      (now < Date.parse(session.registration_opens_at) ||
        now >= Date.parse(session.registration_closes_at))
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "La ventana de registro no está abierta. Sólo puedes registrar asistencia dentro del horario indicado.",
        },
        { status: 409 },
      );
    }
    if (!session.registration_opens_at && session.date !== todayInAppTimeZone()) {
      return NextResponse.json(
        {
          success: false,
          message: "La sesión no corresponde a la fecha de hoy.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      session,
      message: "Sesión disponible para registro.",
    });
  } catch (error) {
    logError("src/app/api/sessions/info", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 },
    );
  }
}

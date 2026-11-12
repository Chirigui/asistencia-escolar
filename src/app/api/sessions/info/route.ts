import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
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
  const limit = checkRateLimit(`session-info:${ip}`, 60, 60_000);

  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, message: "Demasiadas consultas. Intenta de nuevo en un minuto." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") ?? "").trim().toUpperCase();

  if (!code) {
    return NextResponse.json(
      { success: false, message: "Código de sesión no proporcionado." },
      { status: 400 }
    );
  }

  if (!SESSION_CODE_RE.test(code)) {
    return NextResponse.json(
      { success: false, message: "El código de sesión no es válido." },
      { status: 400 }
    );
  }

  try {
    // El cliente administrativo permite consultar el estado aunque la sesión
    // esté cerrada, sin exponer teacher_id ni permisos de escritura.
    const supabase = createAdminClient();

    const { data: session, error } = await supabase
      .from("sessions")
      .select("code, subject, group_name, date, start_time, end_time, status")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      console.error("Error consultando sesión pública:", error);
      return NextResponse.json(
        { success: false, message: "Error interno del servidor." },
        { status: 500 }
      );
    }

    if (!session) {
      return NextResponse.json(
        { success: false, message: "La sesión no existe o ya caducó." },
        { status: 404 }
      );
    }

    if (session.status !== "ABIERTA") {
      return NextResponse.json(
        {
          success: false,
          message: "El profesor ha cerrado la toma de asistencia para esta clase.",
        },
        { status: 409 }
      );
    }

    if (session.date !== todayInAppTimeZone()) {
      return NextResponse.json(
        {
          success: false,
          message: "La sesión no corresponde a la fecha de hoy.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      session,
      message: "Sesión disponible para registro.",
    });
  } catch (error) {
    console.error("Error inesperado en GET /api/sessions/info:", error);
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

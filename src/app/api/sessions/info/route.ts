import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      { success: false, message: "Código de sesión no proporcionado." },
      { status: 400 }
    );
  }

  try {
    const supabase = createAdminClient();

    const { data: session, error } = await supabase
      .from("sessions")
      .select("code, subject, group_name, date, start_time, end_time, status")
      .eq("code", code.toUpperCase().trim())
      .single();

    if (error || !session) {
      return NextResponse.json(
        { success: false, message: `La sesión ${code} no existe o ya caducó.` },
        { status: 404 }
      );
    }

    if (session.status !== "ABIERTA") {
      return NextResponse.json({
        success: false,
        session,
        message: "El profesor ha cerrado la toma de asistencia para esta clase.",
      });
    }

    return NextResponse.json({
      success: true,
      session,
      message: "Sesión disponible para registro.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

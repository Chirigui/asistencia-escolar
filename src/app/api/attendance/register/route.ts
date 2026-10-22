import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDocument } from "@/lib/utils";
import { readJson, registerAttendanceSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const parsed = await readJson(request, registerAttendanceSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "Código de sesión o documento inválidos." },
        { status: 400 }
      );
    }
    const { sessionCode, document } = parsed.data;

    const docNorm = normalizeDocument(document);
    const codeNorm = String(sessionCode).trim().toUpperCase();

    if (docNorm.length < 4) {
      return NextResponse.json(
        { success: false, message: "Por favor ingresa un documento de identidad válido." },
        { status: 400 }
      );
    }

    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(/, /)[0] : "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "desconocido";

    const supabase = createAdminClient();

    // Invocamos la función almacenada PostgreSQL para ejecución transaccional atómica
    const { data, error } = await supabase.rpc("register_student_attendance", {
      p_session_code: codeNorm,
      p_document_normalized: docNorm,
      p_ip: ip,
      p_user_agent: userAgent,
    });

    if (error) {
      console.error("Error ejecutando register_student_attendance RPC:", error);
      return NextResponse.json(
        { success: false, message: "Error al procesar el registro en la base de datos." },
        { status: 500 }
      );
    }

    const result = data as {
      success: boolean;
      code: string;
      message: string;
      data?: any;
      student?: any;
    };

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (err: any) {
    console.error("Error en /api/attendance/register:", err);
    return NextResponse.json(
      { success: false, message: "Error en el servidor al registrar asistencia." },
      { status: 500 }
    );
  }
}

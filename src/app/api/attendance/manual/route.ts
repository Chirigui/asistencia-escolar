import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDocument } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, document, status = "PRESENTE", notes } = body;

    if (!sessionId || !document) {
      return NextResponse.json(
        { success: false, message: "ID de sesión y documento requeridos." },
        { status: 400 }
      );
    }

    const docNorm = normalizeDocument(document);
    const adminDb = createAdminClient();

    // 1. Buscar estudiante
    const { data: student, error: stError } = await adminDb
      .from("students")
      .select("id, full_name, grade, group_name")
      .eq("document_normalized", docNorm)
      .single();

    if (stError || !student) {
      return NextResponse.json(
        { success: false, message: "Estudiante no encontrado en el padrón escolar." },
        { status: 404 }
      );
    }

    // 2. Insertar asistencia manual
    const { data: attendance, error: attError } = await adminDb
      .from("attendances")
      .insert({
        session_id: sessionId,
        student_id: student.id,
        status: status,
        method: "MANUAL",
        notes: notes || "Marcado manual por profesor",
      })
      .select()
      .single();

    if (attError) {
      if (attError.code === "23505") {
        return NextResponse.json(
          { success: false, message: "El estudiante ya figuraba como registrado en esta sesión." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, message: "Error al registrar: " + attError.message },
        { status: 500 }
      );
    }

    // Registrar incidencia de auditoría
    await adminDb.from("incidents").insert({
      session_id: sessionId,
      student_id: student.id,
      document_attempted: docNorm,
      incident_type: "REGISTRO_MANUAL_DOCENTE",
      details: notes ? `Motivo: ${notes}` : "Marcado manual en panel docente",
    });

    return NextResponse.json({
      success: true,
      message: `Asistencia de ${student.full_name} registrada con éxito.`,
      attendance,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

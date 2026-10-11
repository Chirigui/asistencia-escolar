import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateQrDataUrl } from "@/lib/qr";

export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 });
    }

    const adminDb = createAdminClient();

    // Obtener sesiones con conteo de presentes
    const { data: sessions, error } = await adminDb
      .from("sessions")
      .select(`
        id,
        code,
        subject,
        group_name,
        date,
        start_time,
        end_time,
        status,
        created_at,
        attendances (count)
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }

    // Obtener número de estudiantes activos por grupo
    const { data: students } = await adminDb
      .from("students")
      .select("group_name")
      .eq("status", "ACTIVO");

    const countByGroup: Record<string, number> = {};
    students?.forEach((st) => {
      const g = (st.group_name || "").trim().toUpperCase();
      countByGroup[g] = (countByGroup[g] || 0) + 1;
    });

    const formattedSessions = (sessions || []).map((s: any) => {
      const grp = (s.group_name || "").trim().toUpperCase();
      const presentsCount = s.attendances?.[0]?.count || 0;
      const totalGroup = countByGroup[grp] || 0;

      return {
        id: s.id,
        code: s.code,
        subject: s.subject,
        groupName: s.group_name,
        date: s.date,
        startTime: s.start_time,
        endTime: s.end_time,
        status: s.status,
        presents: presentsCount,
        total: totalGroup,
      };
    });

    return NextResponse.json({ success: true, sessions: formattedSessions });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 });
    }

    const body = await request.json();
    const { subject, groupName, date, startTime, endTime } = body;

    if (!subject || !groupName || !date || !startTime || !endTime) {
      return NextResponse.json(
        { success: false, message: "Todos los campos de la sesión son obligatorios." },
        { status: 400 }
      );
    }

    const adminDb = createAdminClient();

    // Generar nuevo código consecutivo: S001, S002, etc.
    const { data: latestSession } = await adminDb
      .from("sessions")
      .select("code")
      .order("created_at", { ascending: false })
      .limit(1);

    let nextCode = "S001";
    if (latestSession && latestSession.length > 0) {
      const lastCode = latestSession[0].code;
      const match = lastCode.match(/^S(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10) + 1;
        nextCode = "S" + String(num).padStart(3, "0");
      }
    }

    const { data: newSession, error: insertError } = await adminDb
      .from("sessions")
      .insert({
        code: nextCode,
        teacher_id: user.id,
        subject: subject.trim(),
        group_name: groupName.trim(),
        date,
        start_time: startTime,
        end_time: endTime,
        status: "ABIERTA",
      })
      .select()
      .single();

    if (insertError || !newSession) {
      return NextResponse.json(
        { success: false, message: "Error al crear la sesión: " + insertError?.message },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const sessionUrl = `${baseUrl}/asistencia?sesion=${newSession.code}`;
    const qrDataUrl = await generateQrDataUrl(sessionUrl);

    return NextResponse.json({
      success: true,
      session: newSession,
      qrDataUrl,
      sessionUrl,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}

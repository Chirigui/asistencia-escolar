import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateQrDataUrl } from "@/lib/qr";
import { normalizeGroupText } from "@/lib/utils";
import { readJson, sessionCreateSchema } from "@/lib/validation";

export async function GET() {
  try {
    const auth = await requireUser();
    if (auth.response) return auth.response;

    const adminDb = createAdminClient();

    // Obtener sesiones con conteo de presentes
    let sessionsQuery = adminDb
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
      .order("created_at", { ascending: false })
      .limit(100);
    if (auth.user.role !== "admin") sessionsQuery = sessionsQuery.eq("teacher_id", auth.user.id);
    const { data: sessions, error } = await sessionsQuery;

    if (error) {
      console.error("Error consultando sesiones:", error);
      return NextResponse.json({ success: false, message: "No se pudieron cargar las sesiones." }, { status: 500 });
    }

    const countByGroup: Record<string, number> = {};
    const { data: groupCounts, error: groupCountError } = await adminDb.rpc("get_active_student_counts_by_group");
    if (groupCountError) return NextResponse.json({ success: false, message: "No se pudieron cargar los conteos por grupo." }, { status: 500 });
    groupCounts?.forEach((row: { group_name: string; student_count: number }) => {
      countByGroup[normalizeGroupText(row.group_name)] = Number(row.student_count);
    });

    const formattedSessions = (sessions || []).map((s: any) => {
      const grp = normalizeGroupText(s.group_name || "");
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

    return NextResponse.json({ success: true, sessions: formattedSessions, hasMore: (sessions || []).length === 100 });
  } catch (err: any) {
    console.error("Error listando sesiones:", err);
    return NextResponse.json({ success: false, message: "No se pudieron cargar las sesiones." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser();
    if (auth.response) return auth.response;
    const user = auth.user;

    const parsed = await readJson(request, sessionCreateSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "Los datos de la sesión son inválidos." },
        { status: 400 }
      );
    }
    const { subject, groupName, date, startTime, endTime } = parsed.data;

    const adminDb = createAdminClient();
    const normalizedGroup = normalizeGroupText(groupName);

    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let newSession: any = null;
    let insertError: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const random = new Uint8Array(7);
      crypto.getRandomValues(random);
      const code = Array.from(random, (byte) => alphabet[byte % alphabet.length]).join("");
      const result = await adminDb.from("sessions").insert({
        code, teacher_id: user.id, subject: subject.trim(), group_name: normalizedGroup,
        date, start_time: startTime, end_time: endTime, status: "ABIERTA",
      }).select().single();
      newSession = result.data;
      insertError = result.error;
      if (newSession || insertError?.code !== "23505") break;
    }

    if (insertError || !newSession) {
      return NextResponse.json(
        { success: false, message: "No se pudo crear la sesión." },
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
      { success: false, message: "No se pudo crear la sesión." },
      { status: 500 }
    );
  }
}

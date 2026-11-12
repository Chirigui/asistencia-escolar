import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { generateQrDataUrl } from "@/lib/qr";
import { generateSessionCode } from "@/lib/session-code";
import { normalizeGroupText } from "@/lib/utils";
import {
  cleanString,
  getAppBaseUrl,
  isValidDateString,
  normalizeTimeString,
  readJsonObject,
} from "@/lib/validation";

interface SessionRecord {
  id: string;
  code: string;
  subject: string;
  group_name: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  created_at: string;
  attendances?: Array<{ count: number }> | null;
}

interface NewSessionRecord extends SessionRecord {
  teacher_id: string | null;
  updated_at: string;
}

export async function GET() {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  try {
    // Cliente con la sesión del usuario: RLS limita docentes a sus propias
    // sesiones y permite a los administradores ver todas.
    const { supabase } = auth.ctx;

    const { data: sessions, error } = await supabase
      .from("sessions")
      .select(
        `
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
      `
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error listando sesiones:", error);
      return NextResponse.json(
        { success: false, message: "No fue posible cargar las sesiones." },
        { status: 500 }
      );
    }

    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select("group_name")
      .eq("status", "ACTIVO");

    if (studentsError) {
      console.error("Error contando estudiantes por grupo:", studentsError);
    }

    const countByGroup: Record<string, number> = {};
    students?.forEach((student: { group_name: string | null }) => {
      const group = normalizeGroupText(student.group_name || "");
      countByGroup[group] = (countByGroup[group] || 0) + 1;
    });

    const formattedSessions = (sessions as SessionRecord[] | null || []).map((session) => {
      const group = normalizeGroupText(session.group_name);
      const presentsCount = session.attendances?.[0]?.count || 0;

      return {
        id: session.id,
        code: session.code,
        subject: session.subject,
        groupName: session.group_name,
        date: session.date,
        startTime: session.start_time,
        endTime: session.end_time,
        status: session.status,
        presents: presentsCount,
        total: countByGroup[group] || 0,
      };
    });

    return NextResponse.json({ success: true, sessions: formattedSessions });
  } catch (error) {
    console.error("Error inesperado en GET /api/sessions:", error);
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      { success: false, message: "Cuerpo de solicitud inválido." },
      { status: 400 }
    );
  }

  const subject = cleanString(body.subject, 120);
  const groupName = normalizeGroupText(cleanString(body.groupName, 20));
  const date = cleanString(body.date, 10);
  const startTime = normalizeTimeString(body.startTime);
  const endTime = normalizeTimeString(body.endTime);

  if (!subject || !groupName || !date || !startTime || !endTime) {
    return NextResponse.json(
      { success: false, message: "Todos los campos de la sesión son obligatorios." },
      { status: 400 }
    );
  }

  if (!isValidDateString(date)) {
    return NextResponse.json(
      { success: false, message: "La fecha de la sesión no es válida." },
      { status: 400 }
    );
  }

  if (endTime <= startTime) {
    return NextResponse.json(
      { success: false, message: "La hora de fin debe ser posterior a la hora de inicio." },
      { status: 400 }
    );
  }

  try {
    const { supabase, userId } = auth.ctx;
    let newSession: NewSessionRecord | null = null;
    let lastError: unknown = null;

    // Código aleatorio + reintento ante la (muy improbable) colisión UNIQUE.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await supabase
        .from("sessions")
        .insert({
          code: generateSessionCode(),
          teacher_id: userId,
          subject,
          group_name: groupName,
          date,
          start_time: startTime,
          end_time: endTime,
          status: "ABIERTA",
        })
        .select()
        .single();

      if (!error) {
        newSession = data;
        break;
      }

      lastError = error;
      if (error.code !== "23505") break;
    }

    if (!newSession) {
      console.error("Error creando sesión:", lastError);
      return NextResponse.json(
        { success: false, message: "No fue posible crear la sesión." },
        { status: 500 }
      );
    }

    const sessionUrl = `${getAppBaseUrl(request)}/asistencia?sesion=${encodeURIComponent(
      newSession.code
    )}`;
    const qrDataUrl = await generateQrDataUrl(sessionUrl);

    return NextResponse.json({
      success: true,
      session: newSession,
      qrDataUrl,
      sessionUrl,
    });
  } catch (error) {
    console.error("Error inesperado en POST /api/sessions:", error);
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

import { logError } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { generateQrDataUrl } from "@/lib/qr";
import { generateSessionCode } from "@/lib/session-code";
import { sessionUrl } from "@/lib/session-url";
import { decodeCursor, encodeCursor, cursorFilter } from "@/lib/pagination";
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

export async function GET(request: Request) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  try {
    const cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));
    let query = auth.ctx.supabase
      .from("sessions")
      .select("id,code,subject,group_name,date,start_time,end_time,status,created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (cursor) query = query.or(cursorFilter("created_at", cursor));
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []).slice(0, 50) as SessionRecord[];
    const { data: counts, error: countError } = await auth.ctx.supabase.rpc("session_counts", {
      p_ids: rows.map((r) => r.id),
    });
    if (countError) throw countError;
    const byId = new Map<string, { total: number; presents: number }>(
      (counts || []).map((r: { session_id: string; total: number; presents: number }) => [
        r.session_id,
        r,
      ]),
    );
    const last = rows.at(-1);
    return NextResponse.json({
      success: true,
      sessions: rows.map((r) => ({
        id: r.id,
        code: r.code,
        subject: r.subject,
        groupName: r.group_name,
        date: r.date,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        presents: Number(byId.get(r.id)?.presents || 0),
        total: Number(byId.get(r.id)?.total || 0),
      })),
      nextCursor:
        (data?.length || 0) > 50 && last
          ? encodeCursor({ timestamp: last.created_at, id: last.id })
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error && error.message === "Invalid cursor"
            ? "Cursor inválido."
            : "No fue posible cargar las sesiones.",
      },
      { status: error instanceof Error && error.message === "Invalid cursor" ? 400 : 500 },
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
      { status: 400 },
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
      { status: 400 },
    );
  }

  if (!isValidDateString(date)) {
    return NextResponse.json(
      { success: false, message: "La fecha de la sesión no es válida." },
      { status: 400 },
    );
  }

  if (endTime <= startTime) {
    return NextResponse.json(
      { success: false, message: "La hora de fin debe ser posterior a la hora de inicio." },
      { status: 400 },
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
          qr_token_required: true,
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
      logError("src/app/api/sessions", lastError, request.headers.get("x-request-id"));
      return NextResponse.json(
        { success: false, message: "No fue posible crear la sesión." },
        { status: 500 },
      );
    }

    const link = sessionUrl(getAppBaseUrl(request), newSession.code, true);
    const qrDataUrl = await generateQrDataUrl(link);

    return NextResponse.json({
      success: true,
      session: newSession,
      qrDataUrl,
      sessionUrl: link,
    });
  } catch (error) {
    logError("src/app/api/sessions", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 },
    );
  }
}

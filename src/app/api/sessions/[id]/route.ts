import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { generateQrDataUrl } from "@/lib/qr";
import { sessionUrl } from "@/lib/session-url";
import { getAppBaseUrl, isUuid, readJsonObject } from "@/lib/validation";
import { logError } from "@/lib/observability";
interface RosterRow {
  student_id: string;
  document: string;
  document_normalized: string;
  full_name: string;
  grade: string;
  group_name: string;
  source: string;
}
interface AttendanceRow {
  id: string;
  student_id: string;
  registered_at: string;
  status: string;
  method: string;
  notes: string | null;
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id))
    return NextResponse.json({ success: false, message: "Sesión no encontrada." }, { status: 404 });
  try {
    const { supabase } = auth.ctx;
    const { data: session, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!session)
      return NextResponse.json(
        { success: false, message: "Sesión no encontrada." },
        { status: 404 },
      );
    const readRoster = async () => {
      const rows: RosterRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("session_roster")
          .select("student_id,document,document_normalized,full_name,grade,group_name,source")
          .eq("session_id", id)
          .order("student_id")
          .range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data || []));
        if ((data?.length || 0) < 500) return rows;
      }
    };
    const readAttendance = async () => {
      const rows: AttendanceRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("attendances")
          .select("id,student_id,registered_at,status,method,notes")
          .eq("session_id", id)
          .order("registered_at", { ascending: false })
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data || []));
        if ((data?.length || 0) < 500) return rows;
      }
    };
    const [roster, attendance] = await Promise.all([readRoster(), readAttendance()]);
    const byStudent = new Map(roster.map((s) => [s.student_id, s]));
    const presentIds = new Set(attendance.map((a) => a.student_id));
    const presents = attendance.map((a) => {
      const s = byStudent.get(a.student_id);
      return {
        attendanceId: a.id,
        registeredAt: a.registered_at,
        status: a.status,
        method: a.method,
        notes: a.notes,
        document: s?.document || "",
        fullName: s?.full_name || "",
        grade: s?.grade || "",
        groupName: s?.group_name || "",
      };
    });
    const absents = roster
      .filter((s) => !presentIds.has(s.student_id))
      .map((s) => ({
        id: s.student_id,
        document: s.document,
        fullName: s.full_name,
        grade: s.grade,
        groupName: s.group_name,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));
    const link = sessionUrl(getAppBaseUrl(request), session.code, session.qr_token_required);
    const qrDataUrl = await generateQrDataUrl(link);
    return NextResponse.json({
      success: true,
      session,
      sessionUrl: link,
      qrDataUrl,
      qrExpiresInSeconds: session.qr_token_required ? 900 : null,
      rosterReconstructed: roster.some((r) => r.source === "BACKFILL"),
      stats: { total: roster.length, presentsCount: presents.length, absentsCount: absents.length },
      presents,
      absents,
    });
  } catch (error) {
    const requestId = logError("session.detail", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      { success: false, message: "No fue posible cargar la sesión.", requestId },
      { status: 500 },
    );
  }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await readJsonObject(request);
  if (!isUuid(id) || !["ABIERTA", "CERRADA", "FINALIZADA"].includes(String(body?.status)))
    return NextResponse.json(
      { success: false, message: "Estado o sesión inválida." },
      { status: 400 },
    );
  const { data, error } = await auth.ctx.supabase
    .from("sessions")
    .update({ status: body!.status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error)
    return NextResponse.json(
      {
        success: false,
        message:
          error.code === "23514"
            ? "Una sesión finalizada no puede reabrirse."
            : "No fue posible actualizar la sesión.",
      },
      { status: error.code === "23514" ? 409 : 500 },
    );
  if (!data)
    return NextResponse.json({ success: false, message: "Sesión no encontrada." }, { status: 404 });
  return NextResponse.json({ success: true, session: data });
}

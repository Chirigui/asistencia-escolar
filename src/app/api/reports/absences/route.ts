import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDocument, normalizeGroupText } from "@/lib/utils";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const from = params.get("dateFrom") || null;
    const to = params.get("dateTo") || null;
    const group = params.get("groupName") ? normalizeGroupText(params.get("groupName")!) : null;
    const document = params.get("document") ? normalizeDocument(params.get("document")!) : null;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(500, Math.max(1, Number(params.get("pageSize") || 100)));
    const teacherId = auth.user.role === "admin" ? null : auth.user.id;
    const db = createAdminClient();
    const args = { p_date_from: from, p_date_to: to, p_group_name: group, p_document: document, p_teacher_id: teacherId };
    const [{ data: count, error: countError }, { data, error }] = await Promise.all([
      db.rpc("get_absence_report_count", args),
      db.rpc("get_absence_report", { ...args, p_limit: pageSize, p_offset: (page - 1) * pageSize }),
    ]);
    if (countError || error) throw countError || error;
    const rows = (data || []).map((row: any) => ({
      id: `${row.session_code}-${row.document}`,
      sessionCode: row.session_code,
      subject: row.subject,
      sessionGroup: row.session_group,
      date: row.date,
      registeredAt: null,
      document: row.document,
      studentName: row.full_name,
      grade: row.grade,
      group: row.group_name,
      status: "AUSENTE",
      method: "—",
    }));
    const totalRecords = Number(count || 0);
    return NextResponse.json({ success: true, stats: { totalRecords }, page, pageSize, hasMore: page * pageSize < totalRecords, rows });
  } catch (error) {
    console.error("Error consultando inasistencias:", error);
    return NextResponse.json({ success: false, message: "No se pudo cargar el reporte de inasistencias." }, { status: 500 });
  }
}

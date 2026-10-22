import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDocument, normalizeGroupText } from "@/lib/utils";
import { formatBogotaTime, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const from = params.get("dateFrom");
    const to = params.get("dateTo");
    const subject = params.get("subject");
    const document = params.get("document");
    const groupName = params.get("groupName");
    const mode = params.get("mode") === "absences" ? "absences" : "attendance";
    const db = createAdminClient();
    let records: any[] = [];

    if (mode === "absences") {
      const normalizedGroup = groupName ? normalizeGroupText(groupName) : null;
      const normalizedDocument = document ? normalizeDocument(document) : null;
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.rpc("get_absence_report", {
          p_date_from: from || null, p_date_to: to || null, p_group_name: normalizedGroup,
          p_document: normalizedDocument, p_teacher_id: auth.user.role === "admin" ? null : auth.user.id,
          p_limit: 1000, p_offset: offset,
        });
        if (error) throw error;
        records.push(...(data || []));
        if ((data || []).length < 1000) break;
      }
    } else {
      const rows: any[] = [];
      const { data: variants } = groupName
        ? await db.rpc("get_group_name_variants", { p_group_name: normalizeGroupText(groupName) })
        : { data: null };
      const groupNames = (variants || []).map((row: { group_name: string }) => row.group_name);
      for (let offset = 0; ; offset += 1000) {
        let query = db.from("attendances").select(`
          registered_at, status, method,
          student:students!inner(document, full_name, grade, group_name, document_normalized),
          session:sessions!inner(code, subject, group_name, date, teacher_id)
        `).order("registered_at", { ascending: false });
        if (from) query = query.gte("session.date", from);
        if (to) query = query.lte("session.date", to);
        if (subject) query = query.ilike("session.subject", `%${subject}%`);
        if (auth.user.role !== "admin") query = query.eq("session.teacher_id", auth.user.id);
        if (groupName) {
          query = groupNames.length ? query.in("session.group_name", groupNames) : query.eq("session.group_name", normalizeGroupText(groupName));
        }
        if (document) query = query.eq("student.document_normalized", normalizeDocument(document));
        const { data, error } = await query.range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if ((data || []).length < 1000) break;
      }
      records = rows.map((row) => ({
        session_code: row.session?.code, date: row.session?.date, registered_at: row.registered_at,
        document: row.student?.document, full_name: row.student?.full_name, grade: row.student?.grade,
        group_name: row.student?.group_name, subject: row.session?.subject, status: row.status, method: row.method,
      }));
    }

    const header = ["Sesión", "Fecha", "Hora", "Documento", "Estudiante", "Grado", "Grupo", "Materia", "Estado", "Método"];
    const body = records.map((row) => [row.session_code, row.date, row.registered_at ? formatBogotaTime(row.registered_at) : "", row.document, row.full_name, row.grade, row.group_name, row.subject, mode === "absences" ? "AUSENTE" : row.status, mode === "absences" ? "—" : row.method]);
    const csv = toCsv([header, ...body]);
    return new Response(csv, { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reporte_${mode}.csv"`,
      "cache-control": "no-store",
    }});
  } catch (error) {
    console.error("Error exportando reporte CSV:", error);
    return NextResponse.json({ success: false, message: "No se pudo generar el reporte." }, { status: 500 });
  }
}

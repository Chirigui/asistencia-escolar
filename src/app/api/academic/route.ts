import { NextResponse } from "next/server";
import { requireStaff, requireAdmin } from "@/lib/auth";
import { cleanString, isValidDateString, isUuid, readJsonObject } from "@/lib/validation";
import { normalizeDocument, normalizeGroupText } from "@/lib/utils";
import { logError } from "@/lib/observability";
export async function GET() {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const { supabase, role, email } = auth.ctx;
  const [periods, assignments, teachers] = await Promise.all([
    supabase
      .from("academic_periods")
      .select("id,name,starts_on,ends_on,active")
      .order("starts_on", { ascending: false }),
    supabase
      .from("teaching_assignments")
      .select("id,teacher_id,period_id,group:school_groups(id,name)")
      .order("id"),
    role === "admin"
      ? supabase.from("profiles").select("id,full_name,email").order("full_name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (periods.error || assignments.error || teachers.error)
    return NextResponse.json(
      { success: false, message: "No fue posible cargar la organización académica." },
      { status: 500 },
    );
  return NextResponse.json({
    success: true,
    role,
    email,
    periods: periods.data,
    assignments: assignments.data,
    teachers: teachers.data,
  });
}
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(request);
  if (!body)
    return NextResponse.json({ success: false, message: "Solicitud inválida." }, { status: 400 });
  const { supabase } = auth.ctx;
  try {
    if (body.action === "period") {
      const name = cleanString(body.name, 60),
        start = String(body.start || ""),
        end = String(body.end || "");
      if (!name || !isValidDateString(start) || !isValidDateString(end) || end < start)
        throw new Error("INVALID");
      const { error } = await supabase.rpc("activate_academic_period", {
        p_name: name,
        p_start: start,
        p_end: end,
        p_copy_assignments: body.copyAssignments === true,
      });
      if (error) throw error;
    } else {
      const group = normalizeGroupText(cleanString(body.groupName, 20));
      if (!group) throw new Error("INVALID");
      if (body.action === "assignment") {
        if (!isUuid(String(body.teacherId))) throw new Error("INVALID");
        const { data: period, error: periodError } = await supabase
          .from("academic_periods")
          .select("id")
          .eq("active", true)
          .single();
        if (periodError) throw periodError;
        const { data: g, error: groupError } = await supabase
          .from("school_groups")
          .upsert({ name: group }, { onConflict: "normalized_name" })
          .select("id")
          .single();
        if (groupError) throw groupError;
        const { error } = await supabase
          .from("teaching_assignments")
          .upsert(
            { period_id: period.id, teacher_id: body.teacherId, group_id: g.id },
            { onConflict: "period_id,teacher_id,group_id" },
          );
        if (error) throw error;
      } else if (body.action === "student") {
        const document = normalizeDocument(cleanString(body.document, 40));
        const status = String(body.status || "ACTIVO");
        if (!document || !["ACTIVO", "INACTIVO", "RETIRADO"].includes(status))
          throw new Error("INVALID");
        const { data, error } = await supabase
          .from("students")
          .update({ group_name: group, status, updated_at: new Date().toISOString() })
          .eq("document_normalized", document)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data)
          return NextResponse.json(
            { success: false, message: "No se encontró el estudiante." },
            { status: 404 },
          );
      } else throw new Error("INVALID");
    }
    return NextResponse.json({ success: true, message: "Organización académica actualizada." });
  } catch (error) {
    const requestId = logError("academic.update", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      {
        success: false,
        message:
          "No fue posible guardar. Revisa los datos y cierra las sesiones antes de cambiar de período.",
        requestId,
      },
      { status: 409 },
    );
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeGroupText } from "@/lib/utils";

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const { data, error } = await createAdminClient().rpc("get_active_student_counts_by_group");
    if (error) throw error;
    const groups = Array.from(new Set((data || []).map((row: { group_name: string }) => normalizeGroupText(row.group_name)))).sort();
    return NextResponse.json({ success: true, groups });
  } catch (error) {
    console.error("Error cargando grupos:", error);
    return NextResponse.json({ success: false, message: "No se pudieron cargar los grupos." }, { status: 500 });
  }
}

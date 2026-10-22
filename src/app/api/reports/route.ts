import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeGroupText } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const auth = await requireUser();
    if (auth.response) return auth.response;

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const groupName = searchParams.get("groupName");
    const subject = searchParams.get("subject");
    const document = searchParams.get("document");
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(500, Math.max(1, Number(searchParams.get("pageSize") || 100)));

    const adminDb = createAdminClient();

    let query = adminDb
      .from("attendances")
      .select(`
        id,
        registered_at,
        status,
        method,
        notes,
        student:students!inner (
          id,
          document,
          document_normalized,
          full_name,
          grade,
          group_name
        ),
        session:sessions!inner (
          id,
          code,
          subject,
          group_name,
          date
        )
      `, { count: "exact" })
      .order("registered_at", { ascending: false });

    if (dateFrom) {
      query = query.gte("session.date", dateFrom);
    }
    if (auth.user.role !== "admin") query = query.eq("session.teacher_id", auth.user.id);
    if (dateTo) {
      query = query.lte("session.date", dateTo);
    }
    if (groupName) {
      const normalizedGroup = normalizeGroupText(groupName);
      const { data: variants } = await adminDb.rpc("get_group_name_variants", { p_group_name: normalizedGroup });
      const names = (variants || []).map((row: { group_name: string }) => row.group_name);
      query = names.length ? query.in("session.group_name", names) : query.eq("session.group_name", normalizedGroup);
    }
    if (subject) {
      query = query.ilike("session.subject", `%${subject.trim()}%`);
    }
    if (document) {
      query = query.eq("student.document_normalized", document.trim());
    }

    const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);

    if (error) {
      console.error("Error consultando reportes:", error);
      return NextResponse.json({ success: false, message: "No se pudieron cargar los reportes." }, { status: 500 });
    }

    const uniqueStudents = new Set<string>();
    const uniqueSessions = new Set<string>();

    const rows = (data || []).map((item: any) => {
      uniqueStudents.add(item.student?.document_normalized);
      uniqueSessions.add(item.session?.code);

      return {
        id: item.id,
        sessionCode: item.session?.code,
        subject: item.session?.subject,
        sessionGroup: item.session?.group_name,
        date: item.session?.date,
        registeredAt: item.registered_at,
        document: item.student?.document,
        studentName: item.student?.full_name,
        grade: item.student?.grade,
        group: item.student?.group_name,
        status: item.status,
        method: item.method,
      };
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalRecords: count ?? 0,
        uniqueStudents: uniqueStudents.size,
        uniqueSessions: uniqueSessions.size,
      },
      page,
      pageSize,
      hasMore: page * pageSize < (count ?? 0),
      rows,
    });
  } catch (err: any) {
    console.error("Error consultando reportes:", err);
    return NextResponse.json({ success: false, message: "No se pudieron cargar los reportes." }, { status: 500 });
  }
}

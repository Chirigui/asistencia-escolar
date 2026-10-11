import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const groupName = searchParams.get("groupName");
    const subject = searchParams.get("subject");
    const document = searchParams.get("document");

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
      `)
      .order("registered_at", { ascending: false });

    if (dateFrom) {
      query = query.gte("session.date", dateFrom);
    }
    if (dateTo) {
      query = query.lte("session.date", dateTo);
    }
    if (groupName) {
      query = query.eq("session.group_name", groupName.trim());
    }
    if (subject) {
      query = query.ilike("session.subject", `%${subject.trim()}%`);
    }
    if (document) {
      query = query.eq("student.document_normalized", document.trim());
    }

    const { data, error } = await query.limit(1000);

    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
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
        totalRecords: rows.length,
        uniqueStudents: uniqueStudents.size,
        uniqueSessions: uniqueSessions.size,
      },
      rows,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

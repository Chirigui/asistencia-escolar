import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { normalizeDocument, normalizeGroupText } from "@/lib/utils";
import { cleanString, isValidDateString } from "@/lib/validation";

const PAGE_SIZE = 1000;
const MAX_ROWS = 10_000;

interface ReportRow {
  id: string;
  registered_at: string;
  status: string;
  method: string;
  notes: string | null;
  student?: {
    id?: string;
    document?: string;
    document_normalized?: string;
    full_name?: string;
    grade?: string;
    group_name?: string;
  } | null;
  session?: {
    id?: string;
    code?: string;
    subject?: string;
    group_name?: string;
    date?: string;
  } | null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const dateFrom = cleanString(searchParams.get("dateFrom"), 10);
  const dateTo = cleanString(searchParams.get("dateTo"), 10);
  const groupName = normalizeGroupText(
    cleanString(searchParams.get("groupName"), 20)
  );
  const subject = cleanString(searchParams.get("subject"), 120);
  const rawDocument = cleanString(searchParams.get("document"), 40);
  const document = normalizeDocument(rawDocument);

  if (dateFrom && !isValidDateString(dateFrom)) {
    return NextResponse.json(
      { success: false, message: "La fecha inicial no es válida." },
      { status: 400 }
    );
  }

  if (dateTo && !isValidDateString(dateTo)) {
    return NextResponse.json(
      { success: false, message: "La fecha final no es válida." },
      { status: 400 }
    );
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json(
      { success: false, message: "El rango de fechas está invertido." },
      { status: 400 }
    );
  }

  if (rawDocument && (document.length < 4 || document.length > 30)) {
    return NextResponse.json(
      { success: false, message: "El documento de búsqueda no es válido." },
      { status: 400 }
    );
  }

  try {
    const { supabase } = auth.ctx;

    const buildQuery = () => {
      let query = supabase
        .from("attendances")
        .select(
          `
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
        `
        )
        .order("registered_at", { ascending: false });

      if (dateFrom) query = query.gte("session.date", dateFrom);
      if (dateTo) query = query.lte("session.date", dateTo);
      if (groupName) query = query.eq("session.group_name", groupName);
      if (subject) {
        query = query.ilike("session.subject", `%${escapeLikePattern(subject)}%`);
      }
      if (document) {
        query = query.ilike("student.document_normalized", document);
      }

      return query;
    };

    const allRows: ReportRow[] = [];
    let truncated = false;

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await buildQuery().range(
        offset,
        Math.min(offset + PAGE_SIZE - 1, MAX_ROWS - 1)
      );

      if (error) {
        console.error("Error consultando reportes:", error);
        return NextResponse.json(
          { success: false, message: "No fue posible generar el reporte." },
          { status: 500 }
        );
      }

      const page = (data || []) as unknown as ReportRow[];
      allRows.push(...page);

      if (page.length < PAGE_SIZE) break;
      if (offset + PAGE_SIZE >= MAX_ROWS) {
        truncated = true;
        break;
      }
    }

    const uniqueStudents = new Set<string>();
    const uniqueSessions = new Set<string>();

    const rows = allRows.map((item) => {
      if (item.student?.document_normalized) {
        uniqueStudents.add(item.student.document_normalized);
      }
      if (item.session?.code) {
        uniqueSessions.add(item.session.code);
      }

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
      truncated,
      stats: {
        totalRecords: rows.length,
        uniqueStudents: uniqueStudents.size,
        uniqueSessions: uniqueSessions.size,
      },
      rows,
    });
  } catch (error) {
    console.error("Error inesperado en GET /api/reports:", error);
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

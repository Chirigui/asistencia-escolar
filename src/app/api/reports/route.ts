import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { decodeCursor, encodeCursor } from "@/lib/pagination";
import { parseReportFilters, reportQuery, reportRow, type RawReport } from "@/lib/report-data";
import { logError } from "@/lib/observability";
export async function GET(request: Request) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  try {
    const filters = parseReportFilters(params);
    const cursor = decodeCursor(params.get("cursor"));
    const { data, error } = await reportQuery(auth.ctx.supabase, filters, cursor).limit(201);
    if (error) throw error;
    const page = (data || []).slice(0, 200) as unknown as RawReport[];
    const last = page.at(-1);
    return NextResponse.json({
      success: true,
      rows: page.map(reportRow),
      nextCursor:
        (data?.length || 0) > 200 && last
          ? encodeCursor({ timestamp: last.registered_at, id: last.id })
          : null,
      pageSize: 200,
    });
  } catch (error) {
    const bad =
      error instanceof Error && ["INVALID_FILTERS", "Invalid cursor"].includes(error.message);
    const requestId = bad
      ? undefined
      : logError("reports.list", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      {
        success: false,
        message: bad ? "Filtros o cursor inválidos." : "No fue posible cargar los reportes.",
        requestId,
      },
      { status: bad ? 400 : 500 },
    );
  }
}

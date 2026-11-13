import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { parseReportFilters, reportQuery, reportRow, type RawReport } from "@/lib/report-data";
import { escapeCsvCell } from "@/lib/csv";
import type { Cursor } from "@/lib/pagination";
import { logError } from "@/lib/observability";
export async function GET(request: Request) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  try {
    const filters = parseReportFilters(new URL(request.url).searchParams);
    if (
      !filters.dateFrom ||
      !filters.dateTo ||
      Date.parse(filters.dateTo) - Date.parse(filters.dateFrom) > 366 * 86400000
    )
      return NextResponse.json(
        { success: false, message: "Para exportar elige un rango de hasta 366 días." },
        { status: 400 },
      );
    const asOf = new Date().toISOString();
    const count = await reportQuery(auth.ctx.supabase, filters, null, true, asOf);
    if (count.error) throw count.error;
    if ((count.count || 0) > 100000)
      return NextResponse.json(
        { success: false, message: "El reporte supera 100.000 registros. Reduce el rango." },
        { status: 413 },
      );
    const encoder = new TextEncoder();
    let cursor: Cursor | null = null;
    let sent = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          if (sent === 0)
            controller.enqueue(
              encoder.encode(
                "\uFEFFSesion,Fecha,Hora,Documento,Estudiante,Grado,Grupo,Materia,Metodo,Estado\r\n",
              ),
            );
          const { data, error } = await reportQuery(
            auth.ctx.supabase,
            filters,
            cursor,
            false,
            asOf,
          ).limit(500);
          if (error) throw error;
          const rows = (data || []) as unknown as RawReport[];
          if (sent + rows.length > 100000) throw new Error("Export row limit");
          const text = rows
            .map((raw) => {
              const r = reportRow(raw);
              return [
                r.sessionCode,
                r.date,
                new Date(r.registeredAt).toLocaleTimeString("es-CO", {
                  timeZone: "America/Bogota",
                  hour12: false,
                }),
                r.document,
                r.studentName,
                r.grade,
                r.group,
                r.subject,
                r.method,
                r.status,
              ]
                .map(escapeCsvCell)
                .join(",");
            })
            .join("\r\n");
          if (text) controller.enqueue(encoder.encode(text + "\r\n"));
          sent += rows.length;
          const last = rows.at(-1);
          if (rows.length < 500 || !last) controller.close();
          else cursor = { timestamp: last.registered_at, id: last.id };
        } catch (error) {
          logError("reports.export", error, request.headers.get("x-request-id"));
          controller.error(new Error("Export interrupted"));
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="asistencia.csv"',
        "Cache-Control": "private, no-store",
        "X-Report-As-Of": asOf,
      },
    });
  } catch (error) {
    const requestId = logError(
      "reports.export.prepare",
      error,
      request.headers.get("x-request-id"),
    );
    return NextResponse.json(
      {
        success: false,
        message: "No fue posible preparar la exportación. Revisa el rango de fechas.",
        requestId,
      },
      { status: 400 },
    );
  }
}

import { Workbook } from "exceljs";
import { requireAdmin } from "@/lib/auth";
import { readRegister, markNames, termLabel } from "@/lib/semester";
import { school } from "@/lib/school";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ group: string; term: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { group, term } = await params;
  const list = await readRegister(auth.ctx, group, term);
  if (!list) return new Response(null, { status: 404 });
  const book = new Workbook();
  const sheet = book.addWorksheet("Asistencia", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:4",
    },
  });
  sheet.addRow([school.name + " · " + list.groupName]);
  sheet.mergeCells("A1:F1");
  sheet.addRow([
    termLabel(term) +
      " · Corte " +
      new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }),
  ]);
  sheet.mergeCells("A2:F2");
  sheet.addRow([
    list.historical
      ? "Incluye padrones históricos reconstruidos."
      : "Asistió incluye las llegadas tarde.",
  ]);
  sheet.mergeCells("A3:F3");
  const header = sheet.addRow([
    "Estudiante",
    "Reuniones",
    "Asistió",
    "Faltó",
    "Justificadas",
    "Asistencia",
    ...list.classes.map((c) => [c.date, c.time, c.subject, c.code].join("\n")),
  ]);
  sheet.getColumn(1).width = 32;
  for (let i = 2; i <= header.cellCount; i++) sheet.getColumn(i).width = i > 6 ? 19 : 14;
  header.height = list.classes.length ? 70 : 24;
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14554D" } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { wrapText: true, vertical: "middle" };
  });
  for (const s of list.students) {
    const row = sheet.addRow([
      s.name,
      s.total,
      s.attended,
      s.absent,
      s.excused,
      s.total ? s.attended / s.total : null,
      ...list.classes.map((c) => markNames[s.marks[c.id]] ?? "Sin matrícula"),
    ]);
    row.getCell(6).numFmt = "0.0%";
  }
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: header.cellCount } };
  sheet.getCell("A1").font = { size: 16, bold: true };
  sheet.getRow(1).height = 28;
  const fileName =
    "Asistencia-" + list.groupName.replace(/[^a-zA-Z0-9_-]/g, "_") + "-" + term + ".xlsx";
  return new Response(new Uint8Array(await book.xlsx.writeBuffer()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

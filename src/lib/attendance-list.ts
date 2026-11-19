import { escapeCsvCell } from "./csv.ts";
import type { ReportRow } from "../types/teacher";

const clock = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const methods: Record<string, string> = { QR: "QR", MANUAL: "Manual", ADMIN: "Administración" };
const statuses: Record<string, string> = {
  PRESENTE: "Presente",
  TARDE: "Tarde",
  JUSTIFICADO: "Justificado",
};

export const listHeaders = [
  "N.º",
  "Estudiante",
  "Documento",
  "Grado",
  "Grupo",
  "Materia",
  "Fecha de clase",
  "Estado",
  "Hora de registro",
  "Método",
  "Código de sesión",
];
export const listLine = (values: unknown[]) => values.map(escapeCsvCell).join(";");

export function attendanceListWriter() {
  let lastSession = "";
  let number = 0;
  return (r: ReportRow) => {
    if (r.sessionCode !== lastSession) {
      lastSession = r.sessionCode;
      number = 0;
    }
    return listLine([
      ++number,
      r.studentName,
      r.document,
      r.grade,
      r.group,
      r.subject,
      r.date,
      statuses[r.status] ?? r.status,
      clock.format(new Date(r.registeredAt)),
      methods[r.method] ?? r.method,
      r.sessionCode,
    ]);
  };
}

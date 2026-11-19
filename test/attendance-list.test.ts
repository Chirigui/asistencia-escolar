import test from "node:test";
import assert from "node:assert/strict";
import { attendanceListWriter, listHeaders, listLine } from "../src/lib/attendance-list.ts";
import { parseDelimited } from "../src/lib/csv.ts";

test("la lista conserva sus columnas, protege las celdas y numera cada sesión", () => {
  const row = {
    id: "1",
    sessionCode: "S01",
    sessionGroup: "6A",
    group: "6A",
    grade: "6",
    subject: "Ciencias; laboratorio",
    date: "2026-11-18",
    registeredAt: "2026-11-18T13:03:05Z",
    document: "001234",
    studentName: 'Ana "María", Díaz',
    status: "PRESENTE",
    method: "MANUAL",
  };
  const write = attendanceListWriter();
  const csv = [
    listLine(listHeaders),
    write(row),
    write({ ...row, studentName: "=prueba" }),
    write({ ...row, sessionCode: "S02" }),
  ].join("\r\n");
  const records = parseDelimited(csv, ";");
  assert.deepEqual(records[0], listHeaders);
  assert.deepEqual(records[1], [
    "1",
    row.studentName,
    "001234",
    "6",
    "6A",
    row.subject,
    row.date,
    "Presente",
    "08:03:05",
    "Manual",
    "S01",
  ]);
  assert.deepEqual(
    records.map((r) => r[0]),
    ["N.º", "1", "2", "1"],
  );
  assert.equal(records[2][1], "'=prueba");
});

import test from "node:test";
import assert from "node:assert/strict";
import { getSchoolDate, normalizeDocument, normalizeGroupText } from "../src/lib/utils.ts";
import { escapeCsvCell, formatBogotaTime, toCsv } from "../src/lib/csv.ts";
import { validateStudentImportRows } from "../src/lib/student-import.ts";

test("Normalización de Documentos de Identidad", async (t) => {
  await t.test("debe eliminar espacios, puntos y guiones", () => {
    assert.strictEqual(normalizeDocument(" 1.000.000-001 "), "1000000001");
    assert.strictEqual(normalizeDocument("TI 1020304050"), "TI1020304050");
    assert.strictEqual(normalizeDocument("  998877   "), "998877");
  });

  await t.test("debe manejar números o valores vacíos", () => {
    assert.strictEqual(normalizeDocument(1000000001), "1000000001");
    assert.strictEqual(normalizeDocument(""), "");
  });
});

test("Normalización de Grados y Grupos", async (t) => {
  await t.test("debe convertir a mayúsculas y limpiar caracteres separadores", () => {
    assert.strictEqual(normalizeGroupText("10 - a"), "10A");
    assert.strictEqual(normalizeGroupText("11_b"), "11B");
    assert.strictEqual(normalizeGroupText("  9 c "), "9C");
  });
});

test("La fecha escolar usa America/Bogota", () => {
  assert.strictEqual(getSchoolDate(new Date("2026-10-23T02:00:00.000Z")), "2026-10-22");
});

test("CSV escapa comillas y neutraliza fórmulas", () => {
  assert.strictEqual(escapeCsvCell('"Ana"'), '"""Ana"""');
  assert.strictEqual(escapeCsvCell("=1+1"), "\"'=1+1\"");
  assert.ok(toCsv([["Nombre"], ['Ana "Ríos"']]).includes('"Ana ""Ríos"""'));
});

test("Hora de registro se formatea en hora de Bogotá", () => {
  assert.strictEqual(formatBogotaTime("2026-10-22T12:05:00.000Z"), "07:05");
});

test("La importación valida usando la misma lógica del endpoint", () => {
  const rows = [
    { document: "ABC-12345", fullName: "", grade: "10", groupName: "10-A" },
    { document: "ABC12345", fullName: "Ana Ríos", grade: "10", groupName: "10-A" },
    { document: "1000000001", fullName: "Estudiante existente", grade: "10", groupName: "10A" },
  ];
  const result = validateStudentImportRows(rows, new Set(["1000000001"]));
  assert.equal(result.rows[0].valid, false);
  assert.equal(result.rows[1].valid, true, "una fila inválida no debe reservar el documento");
  assert.equal(result.rows[2].errors.includes("Ya existe en el sistema escolar"), true);
  assert.equal(result.validCount, 1);
});

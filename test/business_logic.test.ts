import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDocument, normalizeGroupText } from "../src/lib/utils.ts";

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

test("Validación de Detección de Duplicados en Importación", async (t) => {
  const existingDocs = new Set(["1000000001", "1000000002"]);
  const incomingRows = [
    { document: "1.000.000.001", name: "Estudiante 1", grade: "10", group: "10A" },
    { document: "1000000003", name: "Estudiante 3", grade: "10", group: "10A" },
    { document: "1000000003", name: "Estudiante 3 Repetido", grade: "10", group: "10A" },
  ];

  const seenInBatch = new Set<string>();
  const results = incomingRows.map((row) => {
    const docNorm = normalizeDocument(row.document);
    let duplicate = false;
    if (existingDocs.has(docNorm) || seenInBatch.has(docNorm)) {
      duplicate = true;
    }
    seenInBatch.add(docNorm);
    return { docNorm, duplicate };
  });

  assert.strictEqual(results[0].duplicate, true, "El estudiante existente en BD debe marcarse como duplicado");
  assert.strictEqual(results[1].duplicate, false, "El nuevo estudiante debe aceptarse como válido");
  assert.strictEqual(results[2].duplicate, true, "El estudiante duplicado en el mismo lote debe marcarse como duplicado");
});

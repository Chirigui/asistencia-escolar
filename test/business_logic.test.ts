import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDocument, normalizeGroupText } from "../src/lib/utils.ts";
import { buildCsv, escapeCsvCell, isImportHeaderRow, parseDelimited } from "../src/lib/csv.ts";

test("Normalización de Documentos de Identidad", async (t) => {
  await t.test("debe eliminar espacios, puntos y guiones", () => {
    assert.strictEqual(normalizeDocument(" 1.000.000-001 "), "1000000001");
    assert.strictEqual(normalizeDocument("TI 1020304050"), "TI1020304050");
    assert.strictEqual(normalizeDocument("ti 1020304050"), "TI1020304050");
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

test("Validación de Detección de Duplicados en Importación", () => {
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

  assert.strictEqual(
    results[0].duplicate,
    true,
    "El estudiante existente en BD debe marcarse como duplicado",
  );
  assert.strictEqual(results[1].duplicate, false, "El nuevo estudiante debe aceptarse como válido");
  assert.strictEqual(
    results[2].duplicate,
    true,
    "El estudiante duplicado en el mismo lote debe marcarse como duplicado",
  );
});

test("Parser de importación CSV/TSV", async (t) => {
  await t.test("debe respetar comas y comillas dentro de campos entrecomillados", () => {
    const rows = parseDelimited(
      '1001,"Mendoza, Carlos","10","10A","ACTIVO"\n1002,"Ana ""La Jefa"" Ruiz",10,10B,ACTIVO',
    );

    assert.deepStrictEqual(rows[0], ["1001", "Mendoza, Carlos", "10", "10A", "ACTIVO"]);
    assert.deepStrictEqual(rows[1], ["1002", 'Ana "La Jefa" Ruiz', "10", "10B", "ACTIVO"]);
  });

  await t.test("debe detectar tabulaciones y omitir líneas vacías", () => {
    const rows = parseDelimited(
      "Documento\tNombre\tGrado\tGrupo\tEstado\n\n1003\tAna\t10\t10A\tACTIVO\n",
    );

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(isImportHeaderRow(rows[0]), true);
    assert.deepStrictEqual(rows[1], ["1003", "Ana", "10", "10A", "ACTIVO"]);
  });

  await t.test("debe eliminar el BOM inicial", () => {
    const rows = parseDelimited("\uFEFF1004,Ana,10,10A,ACTIVO");
    assert.strictEqual(rows[0][0], "1004");
  });
});

test("Exportación CSV segura", async (t) => {
  await t.test("debe escapar comillas y comas", () => {
    assert.strictEqual(escapeCsvCell('Mendoza, "Carlos"'), '"Mendoza, ""Carlos"""');
  });

  await t.test("debe neutralizar fórmulas de Excel", () => {
    assert.strictEqual(escapeCsvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    assert.strictEqual(escapeCsvCell("@SUM(A1)"), `"'@SUM(A1)"`);
  });

  await t.test("debe construir un CSV con BOM y saltos CRLF", () => {
    const csv = buildCsv(["Documento", "Nombre"], [["1001", "Ana"]]);
    assert.strictEqual(csv.startsWith("\uFEFF"), true);
    assert.strictEqual(csv.includes("\r\n"), true);
    assert.strictEqual(csv.includes('"1001","Ana"'), true);
  });
});

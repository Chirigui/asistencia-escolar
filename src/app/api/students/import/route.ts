import { logError } from "@/lib/observability";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { normalizeDocument, normalizeGroupText } from "@/lib/utils";
import { cleanString, readJsonObject } from "@/lib/validation";

const MAX_IMPORT_ROWS = 2_000;
const EXISTING_LOOKUP_CHUNK = 500;
const STUDENT_STATUSES = ["ACTIVO", "INACTIVO", "RETIRADO"] as const;

interface StudentImportRow {
  document?: unknown;
  fullName?: unknown;
  grade?: unknown;
  groupName?: unknown;
  status?: unknown;
}

interface ValidatedImportRow {
  row: number;
  document: string;
  fullName: string;
  grade: string;
  groupName: string;
  status: string;
  valid: boolean;
  errors: string[];
}

interface StudentInsertRow {
  document: string;
  document_normalized: string;
  full_name: string;
  grade: string;
  group_name: string;
  status: string;
}

export async function POST(request: Request) {
  // La política SQL permite modificar students sólo a administradores.
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      { success: false, message: "Cuerpo de solicitud inválido." },
      { status: 400 },
    );
  }

  const { rows, dryRun = false } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { success: false, message: "No se proporcionaron filas para procesar." },
      { status: 400 },
    );
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      {
        success: false,
        message: `La importación admite como máximo ${MAX_IMPORT_ROWS} filas por lote.`,
      },
      { status: 413 },
    );
  }

  try {
    const { supabase } = auth.ctx;

    // Consulta sólo los documentos entrantes, en bloques, en vez de descargar
    // todo el padrón en cada importación.
    const incomingDocs = new Set<string>();
    rows.forEach((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return;
      const docNorm = normalizeDocument(cleanString((row as StudentImportRow).document, 40));
      if (docNorm) incomingDocs.add(docNorm);
    });

    const existingDocs = new Set<string>();
    // Se consultan variantes en mayúsculas/minúsculas para no duplicar datos
    // históricos que se hayan guardado con otra capitalización.
    const docs = Array.from(
      new Set(Array.from(incomingDocs).flatMap((doc) => [doc, doc.toLowerCase()])),
    );

    for (let i = 0; i < docs.length; i += EXISTING_LOOKUP_CHUNK) {
      const chunk = docs.slice(i, i + EXISTING_LOOKUP_CHUNK);
      const { data, error } = await supabase
        .from("students")
        .select("document_normalized")
        .in("document_normalized", chunk);

      if (error) {
        logError("src/app/api/students/import", error, request.headers.get("x-request-id"));
        return NextResponse.json(
          { success: false, message: "No fue posible validar la matrícula existente." },
          { status: 500 },
        );
      }

      (data || []).forEach((student: { document_normalized: string }) =>
        existingDocs.add(normalizeDocument(student.document_normalized)),
      );
    }

    const fileDocs = new Set<string>();

    let validCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;

    const validatedRows: ValidatedImportRow[] = [];
    const validStudentsToInsert: StudentInsertRow[] = [];

    rows.forEach((rawRow, index) => {
      const row =
        rawRow && typeof rawRow === "object" && !Array.isArray(rawRow)
          ? (rawRow as StudentImportRow)
          : {};

      const docRaw = cleanString(row.document, 40);
      const docNorm = normalizeDocument(docRaw);
      const name = cleanString(row.fullName, 120);
      const grade = cleanString(row.grade, 20).toUpperCase();
      const group = normalizeGroupText(cleanString(row.groupName, 20));
      const status = cleanString(row.status, 20).toUpperCase() || "ACTIVO";

      const errors: string[] = [];

      if (!docNorm) errors.push("Documento vacío");
      else if (docNorm.length < 5 || docNorm.length > 30) {
        errors.push("Documento inválido (entre 5 y 30 caracteres)");
      }

      if (!name) errors.push("Nombre vacío");
      if (!grade) errors.push("Grado vacío");
      if (!group) errors.push("Grupo vacío");

      if (!STUDENT_STATUSES.includes(status as (typeof STUDENT_STATUSES)[number])) {
        errors.push("Estado inválido (usa ACTIVO, INACTIVO o RETIRADO)");
      }

      if (docNorm && fileDocs.has(docNorm)) {
        errors.push("Duplicado en el mismo archivo");
      }
      if (docNorm && existingDocs.has(docNorm)) {
        errors.push("Ya existe en el sistema escolar");
      }

      if (docNorm) fileDocs.add(docNorm);

      const isValid = errors.length === 0;

      if (isValid) {
        validCount += 1;
        validStudentsToInsert.push({
          document: docRaw,
          document_normalized: docNorm,
          full_name: name,
          grade,
          group_name: group,
          status,
        });
      } else if (errors.some((error) => error.includes("existe") || error.includes("Duplicado"))) {
        duplicateCount += 1;
      } else {
        invalidCount += 1;
      }

      validatedRows.push({
        row: index + 1,
        document: docRaw,
        fullName: name,
        grade,
        groupName: group,
        status,
        valid: isValid,
        errors,
      });
    });

    if (dryRun !== true && validStudentsToInsert.length > 0) {
      const { error: insertError } = await supabase.from("students").insert(validStudentsToInsert);

      if (insertError) {
        if (insertError.code === "23505") {
          return NextResponse.json(
            {
              success: false,
              message:
                "La matrícula cambió mientras se validaba (documento duplicado). Vuelve a previsualizar.",
            },
            { status: 409 },
          );
        }

        logError("src/app/api/students/import", insertError, request.headers.get("x-request-id"));
        return NextResponse.json(
          { success: false, message: "No fue posible guardar los estudiantes." },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      dryRun: dryRun === true,
      summary: {
        total: rows.length,
        valid: validCount,
        duplicates: duplicateCount,
        invalid: invalidCount,
        inserted: dryRun === true ? 0 : validStudentsToInsert.length,
      },
      preview: validatedRows.slice(0, 50),
    });
  } catch (error) {
    logError("src/app/api/students/import", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      { success: false, message: "Error interno del servidor." },
      { status: 500 },
    );
  }
}

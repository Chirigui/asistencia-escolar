import { normalizeDocument, normalizeGroupText } from "./utils.ts";

export interface StudentImportRow {
  document?: string;
  fullName?: string;
  grade?: string;
  groupName?: string;
  status?: string;
}

export function validateStudentImportRows(rows: StudentImportRow[], existingDocuments: Set<string>) {
  const fileDocuments = new Set<string>();
  const results = rows.map((row, index) => {
    const document = String(row.document || "").trim();
    const documentNormalized = normalizeDocument(document);
    const fullName = String(row.fullName || "").trim();
    const grade = String(row.grade || "").trim().toUpperCase();
    const groupName = normalizeGroupText(String(row.groupName || ""));
    const status = (String(row.status || "ACTIVO").trim().toUpperCase() || "ACTIVO");
    const errors: string[] = [];

    if (!documentNormalized) errors.push("Documento vacío");
    else if (documentNormalized.length < 5) errors.push("Documento demasiado corto (mín. 5 caracteres)");
    if (!fullName) errors.push("Nombre vacío");
    if (!grade) errors.push("Grado vacío");
    if (!groupName) errors.push("Grupo vacío");
    if (documentNormalized && existingDocuments.has(documentNormalized)) errors.push("Ya existe en el sistema escolar");
    if (documentNormalized && fileDocuments.has(documentNormalized)) errors.push("Duplicado en el mismo archivo");
    const valid = errors.length === 0;
    if (valid) fileDocuments.add(documentNormalized);

    return {
      row: index + 1, document, documentNormalized, fullName, grade, groupName, status,
      valid, errors,
      student: valid ? {
        document,
        document_normalized: documentNormalized,
        full_name: fullName,
        grade,
        group_name: groupName,
        status: ["ACTIVO", "INACTIVO", "RETIRADO"].includes(status) ? status : "ACTIVO",
      } : null,
    };
  });
  return {
    rows: results,
    validCount: results.filter((row) => row.valid).length,
    duplicateCount: results.filter((row) => row.errors.some((error) => error.includes("existe") || error.includes("Duplicado"))).length,
    invalidCount: results.filter((row) => !row.valid && !row.errors.some((error) => error.includes("existe") || error.includes("Duplicado"))).length,
  };
}

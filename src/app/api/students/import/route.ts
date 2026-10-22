import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJson, studentImportSchema } from "@/lib/validation";
import { validateStudentImportRows } from "@/lib/student-import";
import { normalizeDocument } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (auth.response) return auth.response;

    const parsed = await readJson(request, studentImportSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "El archivo de importación no tiene un formato válido." },
        { status: 400 }
      );
    }
    const { rows, dryRun } = parsed.data;

    const adminDb = createAdminClient();

    const candidateDocuments = Array.from(new Set(rows
      .map((row) => normalizeDocument(row.document || ""))
      .filter((doc) => doc.length >= 5)));

    // Consultar únicamente documentos presentes en este archivo.
    const { data: existingStudents } = candidateDocuments.length
      ? await adminDb.from("students").select("document_normalized").in("document_normalized", candidateDocuments)
      : { data: [] };

    const existingDocs = new Set(existingStudents?.map((s) => s.document_normalized) || []);
    const validation = validateStudentImportRows(rows, existingDocs);
    const validatedRows = validation.rows;
    const validStudentsToInsert = validatedRows.flatMap((row) => row.student ? [row.student] : []);
    let insertedCount = 0;

    // 2. Si no es dryRun (previsualización), insertar las filas válidas
    if (!dryRun && validStudentsToInsert.length > 0) {
      let inserted = 0;
      for (let offset = 0; offset < validStudentsToInsert.length; offset += 500) {
        const batch = validStudentsToInsert.slice(offset, offset + 500);
        const { data: insertedRows, error: insertError } = await adminDb
          .from("students")
          .upsert(batch, { onConflict: "document_normalized", ignoreDuplicates: true })
          .select("id");
        if (insertError) {
          console.error("Error guardando lote de estudiantes:", insertError);
          return NextResponse.json({ success: false, message: "Error al guardar estudiantes." }, { status: 500 });
        }
        inserted += insertedRows?.length || 0;
      }
      insertedCount = inserted;
    }

    return NextResponse.json({
      success: true,
      dryRun,
      summary: {
        total: rows.length,
        valid: validation.validCount,
        duplicates: validation.duplicateCount,
        invalid: validation.invalidCount,
        inserted: insertedCount,
      },
      preview: validatedRows.slice(0, 50).map(({ student: _student, ...row }) => row),
      errors: validatedRows.filter((row) => !row.valid),
    });
  } catch (err: any) {
    console.error("Error importando estudiantes:", err);
    return NextResponse.json({ success: false, message: "No se pudo procesar la importación." }, { status: 500 });
  }
}

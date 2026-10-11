import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDocument } from "@/lib/utils";

interface StudentImportRow {
  document: string;
  fullName: string;
  grade: string;
  groupName: string;
  status?: string;
}

export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 });
    }

    const body = await request.json();
    const { rows, dryRun = false } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "No se proporcionaron filas para procesar." },
        { status: 400 }
      );
    }

    const adminDb = createAdminClient();

    // 1. Obtener documentos ya registrados en la base de datos
    const { data: existingStudents } = await adminDb
      .from("students")
      .select("document_normalized");

    const existingDocs = new Set(existingStudents?.map((s) => s.document_normalized) || []);
    const fileDocs = new Set<string>();

    let validCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;

    const validatedRows: any[] = [];
    const validStudentsToInsert: any[] = [];

    rows.forEach((row: StudentImportRow, index: number) => {
      const docRaw = String(row.document || "").trim();
      const docNorm = normalizeDocument(docRaw);
      const name = String(row.fullName || "").trim();
      const grade = String(row.grade || "").trim().toUpperCase();
      const group = String(row.groupName || "").trim().toUpperCase();
      const status = (String(row.status || "ACTIVO").trim().toUpperCase() as any) || "ACTIVO";

      const errors: string[] = [];

      if (!docNorm) errors.push("Documento vacío");
      else if (docNorm.length < 5) errors.push("Documento demasiado corto (mín. 5 dígitos)");

      if (!name) errors.push("Nombre vacío");
      if (!grade) errors.push("Grado vacío");
      if (!group) errors.push("Grupo vacío");

      if (docNorm && fileDocs.has(docNorm)) errors.push("Duplicado en el mismo archivo");
      if (docNorm && existingDocs.has(docNorm)) errors.push("Ya existe en el sistema escolar");

      if (docNorm) fileDocs.add(docNorm);

      const isValid = errors.length === 0;

      if (isValid) {
        validCount++;
        validStudentsToInsert.push({
          document: docRaw,
          document_normalized: docNorm,
          full_name: name,
          grade,
          group_name: group,
          status: ["ACTIVO", "INACTIVO", "RETIRADO"].includes(status) ? status : "ACTIVO",
        });
      } else {
        if (errors.some((e) => e.includes("existe") || e.includes("Duplicado"))) {
          duplicateCount++;
        } else {
          invalidCount++;
        }
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

    // 2. Si no es dryRun (previsualización), insertar las filas válidas
    if (!dryRun && validStudentsToInsert.length > 0) {
      const { error: insertError } = await adminDb
        .from("students")
        .insert(validStudentsToInsert);

      if (insertError) {
        return NextResponse.json(
          { success: false, message: "Error al guardar estudiantes: " + insertError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      summary: {
        total: rows.length,
        valid: validCount,
        duplicates: duplicateCount,
        invalid: invalidCount,
        inserted: dryRun ? 0 : validStudentsToInsert.length,
      },
      preview: validatedRows.slice(0, 50), // Primeras 50 para vista previa rápida
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

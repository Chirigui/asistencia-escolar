import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJsonObject } from "@/lib/validation";
import { logError } from "@/lib/observability";
import { isSameOriginRequest } from "@/lib/request-origin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const tables = ["sessions", "attendances", "incidents"] as const;
  const results = await Promise.all(
    tables.map((table) =>
      auth.ctx.supabase.from(table).select("id", { count: "exact", head: true }),
    ),
  );
  if (results.some((r) => r.error))
    return NextResponse.json(
      { success: false, message: "No se pudieron cargar los recuentos." },
      { status: 500 },
    );
  return NextResponse.json({
    success: true,
    enabled: process.env.ENABLE_TEST_CLEANUP === "true",
    counts: Object.fromEntries(tables.map((table, i) => [table, results[i].count || 0])),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isSameOriginRequest(request))
    return NextResponse.json({ success: false, message: "Origen no permitido." }, { status: 403 });
  const body = await readJsonObject(request);
  if (body?.action === "cache")
    return NextResponse.json(
      { success: true, message: "Se solicitó limpiar la caché de este sitio en este navegador." },
      { headers: { "Clear-Site-Data": '"cache"' } },
    );
  if (process.env.ENABLE_TEST_CLEANUP !== "true")
    return NextResponse.json(
      { success: false, message: "La limpieza de pruebas está deshabilitada en el servidor." },
      { status: 403 },
    );
  if (body?.action !== "clear" || body.confirmation !== "BORRAR SESIONES DE PRUEBA")
    return NextResponse.json(
      { success: false, message: "Escribe exactamente la frase de confirmación." },
      { status: 400 },
    );
  try {
    const { data, error } = await createAdminClient().rpc("clear_test_activity", {
      p_actor: auth.ctx.userId,
      p_confirmation: body.confirmation,
    });
    if (error) throw error;
    return NextResponse.json(
      {
        success: true,
        counts: data,
        message:
          "Sesiones, asistencias e incidencias eliminadas. Estudiantes y configuración conservados.",
      },
      { headers: { "Clear-Site-Data": '"cache"' } },
    );
  } catch (error) {
    const requestId = logError("maintenance.clear", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      {
        success: false,
        message: "No se pudo completar la limpieza. No se aplicaron cambios parciales.",
        requestId,
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkDistributedLimit } from "@/lib/distributed-limit";
import { getClientIp, readJsonObject } from "@/lib/validation";
import { logError } from "@/lib/observability";
import { isSameOriginRequest } from "@/lib/request-origin";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return NextResponse.json({ success: false, message: "Origen no permitido." }, { status: 403 });
  const body = await readJsonObject(request);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || email.length > 254 || !password || password.length > 4096)
    return NextResponse.json(
      { success: false, message: "Ingresa tu correo y contraseña." },
      { status: 400 },
    );
  const limit = await checkDistributedLimit(
    "staff-login",
    getClientIp(request),
    email.toLowerCase(),
    10,
  );
  if (!limit.allowed)
    return NextResponse.json(
      {
        success: false,
        message: limit.unavailable
          ? "No se pudo validar el acceso. Intenta de nuevo en un momento."
          : "Demasiados intentos. Espera un minuto.",
      },
      {
        status: limit.unavailable ? 503 : 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user || !data.session)
      return NextResponse.json(
        {
          success: false,
          message: "No fue posible iniciar sesión. Verifica el correo y la contraseña.",
        },
        { status: 401 },
      );
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError || !profile || !["teacher", "admin"].includes(profile.role)) {
      await supabase.auth.signOut({ scope: "local" });
      return NextResponse.json(
        { success: false, message: "Esta cuenta no tiene un perfil docente habilitado." },
        { status: 403 },
      );
    }
    // Cookies are committed in this response before the browser navigates.
    return NextResponse.json({ success: true });
  } catch (error) {
    const requestId = logError("auth.login", error, request.headers.get("x-request-id"));
    return NextResponse.json(
      {
        success: false,
        message: "No se pudo conectar con el servicio de acceso. Intenta de nuevo.",
        requestId,
      },
      { status: 503 },
    );
  }
}

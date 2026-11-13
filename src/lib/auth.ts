import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type StaffRole = "teacher" | "admin";

export interface StaffContext {
  supabase: ServerClient;
  userId: string;
  email?: string;
  role: StaffRole;
}

type AuthResult = { ok: true; ctx: StaffContext } | { ok: false; response: NextResponse };

/**
 * Obtiene el usuario autenticado y su perfil profesional.
 *
 * La autorización por recurso no se delega sólo al proxy: cada Route Handler
 * administrativo valida aquí la sesión y el rol. Las consultas posteriores deben
 * usar `ctx.supabase` (cliente con la sesión del usuario) para que RLS aplique.
 */
export async function requireStaff(): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || (profile.role !== "teacher" && profile.role !== "admin")) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Acceso restringido al personal docente." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      supabase,
      userId: user.id,
      email: user.email ?? undefined,
      role: profile.role,
    },
  };
}

export async function requireAdmin(): Promise<AuthResult> {
  const result = await requireStaff();
  if (!result.ok) return result;

  if (result.ctx.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Esta operación requiere rol de administrador." },
        { status: 403 },
      ),
    };
  }

  return result;
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "teacher" | "admin";
export type AuthorizedUser = { id: string; email?: string; role: AppRole };

export async function requireUser(): Promise<
  { user: AuthorizedUser; response?: never } | { user?: never; response: NextResponse }
> {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { response: NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 }) };
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profileError || !profile || !["teacher", "admin"].includes(profile.role)) {
    return { response: NextResponse.json({ success: false, message: "No autorizado." }, { status: 401 }) };
  }
  return { user: { id: user.id, email: user.email, role: profile.role as AppRole } };
}

export async function requireRole(roles: AppRole[]) {
  const result = await requireUser();
  if (result.response) return result;
  if (!roles.includes(result.user.role)) {
    return { response: NextResponse.json({ success: false, message: "No tienes permiso para realizar esta acción." }, { status: 403 }) };
  }
  return result;
}

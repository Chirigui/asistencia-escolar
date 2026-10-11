import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con permisos de administración (service_role).
 * Únicamente debe ejecutarse en el entorno de servidor (Route Handlers / Server Actions).
 * NUNCA exponer la variable SUPABASE_SERVICE_ROLE_KEY al cliente.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Credenciales de Supabase incompletas en variables de entorno de servidor.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

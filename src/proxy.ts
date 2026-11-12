import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pathname = request.nextUrl.pathname;

  // Fail-closed: sin configuración no se puede validar la sesión, así que no
  // se debe dejar pasar el panel docente.
  if (!supabaseUrl || !supabaseKey) {
    if (pathname.startsWith("/profesor")) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
        headers?: Record<string, string>
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
        // Evita que CDNs/proxies cacheados sirvan cookies de sesión a otro usuario.
        Object.entries(headers ?? {}).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Proteger rutas de panel docente (/profesor)
  if (pathname.startsWith("/profesor")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // Defensa en profundidad: un usuario autenticado sin perfil docente/admin
    // (por ejemplo, un registro público) no debe ver el panel.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (
      !profile ||
      (profile.role !== "teacher" && profile.role !== "admin")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/asistencia";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // Si el usuario ya está autenticado e intenta ir al login, enviarlo al panel
  if (pathname === "/login" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/profesor";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/profesor/:path*", "/login"],
};

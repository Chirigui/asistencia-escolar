import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json({ success: false }, { status: 403 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error)
    return NextResponse.json(
      { success: false, message: "No fue posible cerrar la sesión. Intenta de nuevo." },
      { status: 503 },
    );
  return NextResponse.json({ success: true });
}

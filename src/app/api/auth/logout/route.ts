import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error)
    return NextResponse.json(
      { success: false, message: "No fue posible cerrar la sesión. Intenta de nuevo." },
      { status: 503 },
    );
  return NextResponse.json({ success: true });
}

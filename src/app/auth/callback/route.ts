import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Intercambia el código de los enlaces de correo (recuperación, invitación) por una sesión
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";
  if (code) {
    const sb = await supabaseServer();
    await sb.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/dashboard", url.origin));
}

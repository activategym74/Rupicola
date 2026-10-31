import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rutas públicas: menú QR, tienda en línea, seguimiento, autenticación, webhooks
const PUBLIC = [/^\/$/, /^\/login/, /^\/recuperar/, /^\/restablecer/, /^\/m\//, /^\/tienda/, /^\/pedido\//, /^\/api\/(payments|notifications)\//, /^\/auth\//];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return res;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  if (!user && !PUBLIC.some((r) => r.test(path))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|brand/|.*\\.(?:png|jpg|svg|glb|gltf|webp)$).*)"],
};

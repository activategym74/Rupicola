import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

const Body = z.object({ business_id: z.string().uuid(), email: z.string().email(), full_name: z.string().min(2), role_id: z.string().uuid(), phone: z.string().optional() });

/** Invita a un usuario por correo y lo vincula al establecimiento con un rol. Requiere users.manage. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const b = parsed.data;
  const sb = await supabaseServer();
  const { data: allowed } = await sb.rpc("has_perm", { b: b.business_id, perm: "users.manage" });
  if (!allowed) return NextResponse.json({ error: "Permiso requerido: users.manage" }, { status: 403 });

  const admin = supabaseAdmin();
  const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  let userId: string | undefined;
  const inv = await admin.auth.admin.inviteUserByEmail(b.email, { redirectTo: `${site}/auth/callback?next=/restablecer`, data: { full_name: b.full_name } });
  if (inv.error) {
    // Ya existe: se busca para vincularlo
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = list?.users.find((u) => u.email?.toLowerCase() === b.email.toLowerCase())?.id;
    if (!userId) return NextResponse.json({ error: inv.error.message }, { status: 400 });
  } else userId = inv.data.user?.id;

  // Inserción con la sesión del administrador: la política RLS vuelve a validar el permiso y queda auditada
  const { error } = await sb.from("members").insert({ business_id: b.business_id, user_id: userId, role_id: b.role_id, full_name: b.full_name, phone: b.phone ?? null });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "El usuario ya pertenece al establecimiento" : error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

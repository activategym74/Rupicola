"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/auth/auth-frame";
import { errMsg } from "@/lib/format";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email: String(f.get("email")).trim(), password: String(f.get("password")) });
    if (error) {
      setBusy(false);
      setError(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos" : errMsg(error));
      return;
    }
    // Registro de inicio de sesión en cada establecimiento del usuario
    const { data } = await sb.rpc("my_context");
    for (const m of (data ?? []) as { business: { id: string } }[]) {
      await sb.rpc("log_activity", { b: m.business.id, p_action: "login", p_data: { user_agent: navigator.userAgent } });
    }
    router.replace(params.get("next") || "/dashboard");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div><label className="label" htmlFor="email">Correo</label><input id="email" name="email" type="email" required autoComplete="email" className="input" /></div>
      <div><label className="label" htmlFor="password">Contraseña</label><input id="password" name="password" type="password" required autoComplete="current-password" className="input" /></div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</button>
      <Link href="/recuperar" className="block text-center text-sm text-burgundy hover:underline">¿Olvidó su contraseña?</Link>
    </form>
  );
}

export default function LoginPage() {
  return <AuthFrame title="Iniciar sesión" subtitle="Ingrese con su cuenta de RUPÍCOLA"><Suspense><LoginForm /></Suspense></AuthFrame>;
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/auth/auth-frame";
import { errMsg } from "@/lib/format";

export default function RecoverPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const email = String(new FormData(e.currentTarget).get("email")).trim();
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/restablecer`,
    });
    setBusy(false);
    if (error) setError(errMsg(error)); else setSent(true);
  }
  return (
    <AuthFrame title="Recuperar contraseña" subtitle="Le enviaremos un enlace a su correo">
      {sent ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Si el correo está registrado, recibirá un enlace para crear una nueva contraseña.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div><label className="label" htmlFor="email">Correo</label><input id="email" name="email" type="email" required className="input" /></div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>Enviar enlace</button>
        </form>
      )}
      <Link href="/login" className="mt-4 block text-center text-sm text-burgundy hover:underline">Volver a iniciar sesión</Link>
    </AuthFrame>
  );
}

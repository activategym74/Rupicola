"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/auth/auth-frame";
import { errMsg } from "@/lib/format";

export default function ResetPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p1 = String(f.get("p1")), p2 = String(f.get("p2"));
    if (p1.length < 8) return setError("Mínimo 8 caracteres");
    if (p1 !== p2) return setError("Las contraseñas no coinciden");
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) setError(errMsg(error)); else router.replace("/dashboard");
  }
  return (
    <AuthFrame title="Nueva contraseña">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="p1">Contraseña</label><input id="p1" name="p1" type="password" required minLength={8} className="input" autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="p2">Confirmar contraseña</label><input id="p2" name="p2" type="password" required className="input" autoComplete="new-password" /></div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>Guardar</button>
      </form>
    </AuthFrame>
  );
}

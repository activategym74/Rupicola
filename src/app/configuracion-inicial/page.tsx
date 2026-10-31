"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/auth/auth-frame";
import { errMsg } from "@/lib/format";

// Primer arranque: crea el establecimiento con unidades, estaciones, roles,
// métodos de pago y categorías iniciales. El usuario queda como Administrador general.
export default function SetupPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const { error } = await supabaseBrowser().rpc("bootstrap_business", {
      p_name: String(f.get("name")).trim(), p_slug: String(f.get("slug")).trim().toLowerCase(), p_admin_name: String(f.get("admin")).trim(),
    });
    setBusy(false);
    if (error) setError(errMsg(error)); else router.replace("/dashboard");
  }
  return (
    <AuthFrame title="Configuración inicial" subtitle="Cree el establecimiento. Podrá ajustar todo después en Configuración.">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label">Nombre del establecimiento</label><input name="name" defaultValue="RUPÍCOLA" required className="input" /></div>
        <div><label className="label">Identificador para enlaces públicos</label><input name="slug" defaultValue="rupicola" pattern="[a-z0-9-]{3,40}" required className="input" />
          <p className="mt-1 text-xs text-charcoal/50">Su tienda quedará en /tienda/<b>identificador</b></p></div>
        <div><label className="label">Su nombre</label><input name="admin" required className="input" /></div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creando…" : "Crear establecimiento"}</button>
      </form>
    </AuthFrame>
  );
}

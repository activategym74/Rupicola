"use client";
import { useCallback, useEffect, useState } from "react";
import { Search, Plus, Pencil, Star } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, dateTime, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, StatusBadge } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type C = { id: string; full_name: string; document: string | null; phone: string | null; email: string | null; preferences: string | null; notes: string | null; points: number; total_spent: number; orders_count: number; created_at: string };

export default function CustomersPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, can } = useApp();
  const [q, setQ] = useState("");
  const [list, setList] = useState<C[] | null>(null);
  const [sel, setSel] = useState<C | "new" | null>(null);
  const [hist, setHist] = useState<{ orders: { id: string; number: number; channel: string; status: string; total: number; created_at: string }[]; addresses: { address: string; details: string | null }[] } | null>(null);

  const load = useCallback(async () => {
    let qy = sb.from("customers").select("*").eq("business_id", businessId).order("total_spent", { ascending: false }).limit(200);
    const s = q.trim().replace(/[%,]/g, "");
    if (s) qy = qy.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,document.ilike.%${s}%,email.ilike.%${s}%`);
    const { data } = await qy; setList((data ?? []) as C[]);
  }, [sb, businessId, q]);
  useEffect(() => { if (businessId) { const t = setTimeout(load, 250); return () => clearTimeout(t); } }, [businessId, load]);
  useEffect(() => {
    if (!sel || sel === "new") { setHist(null); return; }
    Promise.all([
      sb.from("orders").select("id, number, channel, status, total, created_at").eq("customer_id", sel.id).order("created_at", { ascending: false }).limit(50),
      sb.from("customer_addresses").select("address, details").eq("customer_id", sel.id),
    ]).then(([o, a]) => setHist({ orders: o.data ?? [], addresses: a.data ?? [] }));
  }, [sb, sel]);

  if (!list) return <PageLoader />;
  return (
    <div className="animate-fade-in">
      <PageHeader title="Clientes" subtitle="Base centralizada: compras presenciales y domicilios"
        actions={can("customers.manage") && <button className="btn-primary" onClick={() => setSel("new")}><Plus size={16} /> Cliente</button>} />
      <div className="relative mb-4 max-w-md"><Search size={16} className="absolute top-2.5 left-3 text-charcoal/40" /><input className="input !pl-9" placeholder="Buscar por nombre, teléfono, documento o correo" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="card overflow-x-auto"><table className="table-base">
        <thead><tr><th>Cliente</th><th>Teléfono</th><th>Correo</th><th className="text-right">Pedidos</th><th className="text-right">Total comprado</th><th className="text-right">Puntos</th><th>Registro</th><th></th></tr></thead>
        <tbody>{list.map((c) => <tr key={c.id}><td className="font-medium">{c.full_name}</td><td>{c.phone}</td><td>{c.email}</td><td className="text-right">{c.orders_count}</td>
          <td className="text-right">{money(c.total_spent)}</td><td className="text-right">{Number(c.points) > 0 && <><Star size={12} className="inline text-burgundy" /> {Number(c.points)}</>}</td>
          <td>{c.created_at.slice(0, 10)}</td><td><button className="btn-ghost !p-1.5" onClick={() => setSel(c)}><Pencil size={16} /></button></td></tr>)}</tbody></table></div>

      {sel && (
        <Modal open wide onClose={() => setSel(null)} title={sel === "new" ? "Nuevo cliente" : sel.full_name} footer={can("customers.manage") && <button form="cf" className="btn-primary">Guardar</button>}>
          <form id="cf" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            const row = { business_id: businessId, full_name: f.full_name, document: f.document || null, phone: f.phone || null, email: f.email || null, preferences: f.preferences || null, notes: f.notes || null };
            const { error } = sel === "new" ? await sb.from("customers").insert(row) : await sb.from("customers").update(row).eq("id", sel.id);
            if (error) toast("error", error.code === "23505" ? "Ya existe un cliente con ese teléfono" : errMsg(error)); else { toast("success", "Cliente guardado"); setSel(null); load(); }
          }}>
            {([["full_name", "Nombre"], ["document", "Documento (opcional)"], ["phone", "Teléfono"], ["email", "Correo"], ["preferences", "Preferencias"], ["notes", "Observaciones"]] as const).map(([k, l]) =>
              <div key={k}><label className="label">{l}</label><input name={k} required={k === "full_name"} defaultValue={sel === "new" ? "" : (sel[k] ?? "")} className="input" disabled={!can("customers.manage")} /></div>)}
          </form>
          {hist && (
            <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <div><div className="label">Historial de compras</div>
                <table className="table-base"><tbody>{hist.orders.map((o) => <tr key={o.id}><td>#{o.number}</td><td>{o.channel === "delivery" ? "Domicilio" : o.channel === "pickup" ? "Recoge" : "Presencial"}</td>
                  <td><StatusBadge status={o.status} /></td><td>{dateTime(o.created_at)}</td><td className="text-right">{money(o.total)}</td></tr>)}</tbody></table></div>
              <div><div className="label">Direcciones</div>{hist.addresses.map((a, i) => <div key={i} className="mb-2 text-sm">{a.address}<div className="text-xs text-charcoal/50">{a.details}</div></div>)}</div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

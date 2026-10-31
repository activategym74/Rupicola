"use client";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { dateTime, daysAgo, today } from "@/lib/format";
import { PageHeader, PageLoader } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";

type A = { id: number; entity: string; entity_id: string | null; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; reason: string | null; created_at: string; order_id: string | null; members: { full_name: string } | null };
const ENT: Record<string, string> = { orders: "Pedido", order_items: "Producto de pedido", payments: "Pago", products: "Producto", product_variants: "Variante", categories: "Categoría", ingredients: "Ingrediente", members: "Usuario", roles: "Rol",
  customers: "Cliente", cash_sessions: "Caja", expenses: "Gasto", purchases: "Compra", deliveries: "Domicilio", session: "Sesión", dining_tables: "Mesa", payment_methods: "Método de pago", businesses: "Configuración", recipe_items: "Receta", suppliers: "Proveedor", delivery_zones: "Zona" };
const ACT: Record<string, string> = { insert: "Creó", update: "Modificó", delete: "Eliminó", void: "Anuló", discount: "Descuento", login: "Inició sesión", logout: "Cerró sesión" };

/** Historial de acciones por usuario, con valor anterior y nuevo */
export default function AuditPage() {
  const sb = supabaseBrowser();
  const { businessId } = useApp();
  const [from, setFrom] = useState(daysAgo(7)), [to, setTo] = useState(today());
  const [entity, setEntity] = useState("");
  const [user, setUser] = useState("");
  const [members, setMembers] = useState<{ id: string; full_name: string }[]>([]);
  const [rows, setRows] = useState<A[] | null>(null);
  const [sel, setSel] = useState<A | null>(null);

  const load = useCallback(async () => {
    let q = sb.from("audit_log").select("id, entity, entity_id, action, old_data, new_data, reason, created_at, order_id, members(full_name)").eq("business_id", businessId)
      .gte("created_at", from).lt("created_at", `${to}T23:59:59`).order("created_at", { ascending: false }).limit(500);
    if (entity) q = q.eq("entity", entity);
    if (user) q = q.eq("member_id", user);
    const { data } = await q; setRows((data ?? []) as unknown as A[]);
  }, [sb, businessId, from, to, entity, user]);
  useEffect(() => { if (businessId) { load(); sb.from("members").select("id, full_name").eq("business_id", businessId).then(({ data }: { data: { id: string; full_name: string }[] | null }) => setMembers(data ?? [])); } }, [businessId, load, sb]);

  if (!rows) return <PageLoader />;
  const diff = (a: A) => {
    if (!a.old_data || !a.new_data) return null;
    return Object.keys(a.new_data).filter((k) => JSON.stringify(a.old_data![k]) !== JSON.stringify(a.new_data![k]) && !["updated_at"].includes(k));
  };
  return (
    <div className="animate-fade-in">
      <PageHeader title="Auditoría" subtitle="Toda operación importante queda registrada: quién, cuándo, qué cambió y por qué" />
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="input !w-auto" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="">Todo</option>{Object.entries(ENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input !w-auto" value={user} onChange={(e) => setUser(e.target.value)}><option value="">Todos los usuarios</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select>
      </div>
      <div className="card overflow-x-auto"><table className="table-base">
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Cambios</th><th>Motivo</th></tr></thead>
        <tbody>{rows.map((a) => { const d = diff(a); return (
          <tr key={a.id} className="cursor-pointer" onClick={() => setSel(a)}><td className="whitespace-nowrap">{dateTime(a.created_at)}</td><td>{a.members?.full_name ?? "Sistema / cliente"}</td>
            <td>{ACT[a.action] ?? a.action}</td><td>{ENT[a.entity] ?? a.entity}</td>
            <td className="max-w-xs truncate text-xs text-charcoal/60">{d ? d.map((k) => `${k}: ${JSON.stringify(a.old_data![k])} → ${JSON.stringify(a.new_data![k])}`).join("; ") : ""}</td>
            <td className="text-xs">{a.reason}</td></tr>); })}</tbody></table></div>
      {sel && (
        <Modal open wide onClose={() => setSel(null)} title={`${ACT[sel.action] ?? sel.action} · ${ENT[sel.entity] ?? sel.entity}`}>
          <div className="grid gap-4 md:grid-cols-2 text-xs">
            <div><div className="label">Valor anterior</div><pre className="max-h-96 overflow-auto rounded-lg bg-sand-50 p-3">{JSON.stringify(sel.old_data, null, 2)}</pre></div>
            <div><div className="label">Valor nuevo</div><pre className="max-h-96 overflow-auto rounded-lg bg-sand-50 p-3">{JSON.stringify(sel.new_data, null, 2)}</pre></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

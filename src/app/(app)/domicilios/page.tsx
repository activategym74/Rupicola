"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Bike, Phone, MapPin, Check, UserPlus, Ban, ExternalLink, Store } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useRealtime } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, minutesSince, time, dateTime, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, StatusBadge, Empty } from "@/components/ui/bits";
import { Modal, ReasonModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type D = {
  id: string; status: string; address: string; details: string | null; lat: number | null; lng: number | null; fee: number; cash_to_collect: number; cash_change_for: number | null;
  courier_id: string | null; created_at: string; incident_notes: string | null; proof_url: string | null; picked_up_at: string | null; delivered_at: string | null;
  orders: { id: string; number: number; channel: string; customer_name: string; customer_phone: string; total: number; paid_total: number; notes: string | null; status: string;
    order_items: { name: string; variant_label: string | null; qty: number; line_total: number; modifiers: { name: string }[]; notes: string | null; status: string }[] };
  payment_methods: { name: string } | null; members: { full_name: string } | null;
  delivery_events: { to_status: string; from_status: string | null; note: string | null; created_at: string }[];
};
const TABS = [
  { key: "pending", label: "Pendientes", st: ["received"] }, { key: "prep", label: "En preparación", st: ["confirmed", "preparing"] },
  { key: "ready", label: "Listos para despacho", st: ["ready_for_dispatch", "courier_assigned"] }, { key: "route", label: "En camino", st: ["picked_up", "on_the_way"] },
  { key: "done", label: "Entregados", st: ["delivered"] }, { key: "cancelled", label: "Cancelados", st: ["cancelled"] },
];

export default function DeliveriesPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId } = useApp();
  const [list, setList] = useState<D[] | null>(null);
  const [tab, setTab] = useState("pending");
  const [sel, setSel] = useState<string | null>(null);
  const [couriers, setCouriers] = useState<{ id: string; full_name: string }[]>([]);
  const [cancel, setCancel] = useState<D | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 86400000).toISOString();
    const { data, error } = await sb.from("deliveries")
      .select("*, orders(id, number, channel, customer_name, customer_phone, total, paid_total, notes, status, order_items(name, variant_label, qty, line_total, modifiers, notes, status)), payment_methods(name), members(full_name), delivery_events(to_status, from_status, note, created_at)")
      .eq("business_id", businessId).or(`status.not.in.(delivered,cancelled),created_at.gte.${since}`).order("created_at", { ascending: false });
    if (error) toast("error", errMsg(error)); else setList((data ?? []) as unknown as D[]);
  }, [sb, businessId, toast]);
  useEffect(() => {
    if (!businessId) return;
    load();
    sb.from("members").select("id, full_name, roles(role_permissions(permission))").eq("business_id", businessId).eq("active", true)
      .then(({ data }: { data: { id: string; full_name: string; roles: { role_permissions: { permission: string }[] } | null }[] | null }) =>
        setCouriers((data ?? []).filter((m) => m.roles?.role_permissions.some((p) => p.permission === "delivery.courier"))));
  }, [sb, businessId, load]);
  useRealtime(businessId, ["deliveries", "orders"], load);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, (list ?? []).filter((d) => t.st.includes(d.status)).length])), [list]);
  if (!list) return <PageLoader />;
  const shown = list.filter((d) => TABS.find((t) => t.key === tab)!.st.includes(d.status));
  const d = list.find((x) => x.id === sel);

  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await sb.rpc(fn, args);
    if (error) toast("error", errMsg(error)); else { toast("success", ok); load(); }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Domicilios" subtitle="Pedidos desde casa: a domicilio y para recoger" />
      <div className="scrollbar-thin mb-4 flex gap-2 overflow-x-auto">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={clsx("chip shrink-0 border !px-3 !py-1.5", tab === t.key ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>
          {t.label} <span className="opacity-70">{counts[t.key]}</span></button>)}
      </div>
      {shown.length === 0 ? <Empty icon={<Bike size={36} />} title="No hay pedidos en este estado" /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((x) => (
            <button key={x.id} onClick={() => setSel(x.id)} className="card p-4 text-left transition hover:shadow-md">
              <div className="flex items-start justify-between">
                <div><div className="font-semibold">#{x.orders.number} · {x.orders.customer_name}</div>
                  <div className="flex items-center gap-1 text-xs text-charcoal/60">{x.orders.channel === "pickup" ? <><Store size={12} /> Recoge en el local</> : <><MapPin size={12} /> {x.address}</>}</div></div>
                <StatusBadge status={x.status} />
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-charcoal/60">{time(x.created_at)} · hace {minutesSince(x.created_at)} min</span>
                <span className="font-semibold">{money(x.orders.total)}</span>
              </div>
              {x.members && <div className="mt-1 text-xs text-violet-800">Domiciliario: {x.members.full_name}</div>}
            </button>
          ))}
        </div>
      )}

      {d && (
        <Modal open wide onClose={() => setSel(null)} title={<span className="flex items-center gap-2">Pedido #{d.orders.number} <StatusBadge status={d.status} /></span>}
          footer={<>
            {!["delivered", "cancelled", "picked_up", "on_the_way"].includes(d.status) && Number(d.orders.paid_total) === 0 &&
              <button className="btn-secondary text-red-700" onClick={() => setCancel(d)}><Ban size={16} /> Cancelar</button>}
            {d.status === "received" && <button className="btn-primary" onClick={() => {
              const fee = d.orders.channel === "delivery" ? prompt("Costo del domicilio (deje igual para mantener):", String(d.fee)) : null;
              call("delivery_confirm", { p_delivery: d.id, p_fee: fee !== null && fee !== "" ? Number(fee) : null }, "Pedido confirmado y enviado a preparación");
            }}><Check size={16} /> Confirmar pedido</button>}
            {d.orders.channel === "pickup" && d.status === "ready_for_dispatch" &&
              <button className="btn-primary" onClick={() => location.assign(`/pos?order=${d.orders.id}`)}>Cobrar y entregar en POS</button>}
          </>}>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3 text-sm">
              <div><div className="label">Cliente</div><div className="font-medium">{d.orders.customer_name}</div>
                <a className="flex items-center gap-1 text-burgundy" href={`tel:${d.orders.customer_phone}`}><Phone size={14} /> {d.orders.customer_phone}</a></div>
              {d.orders.channel === "delivery" && <div><div className="label">Dirección</div><div>{d.address}</div>{d.details && <div className="text-charcoal/60">{d.details}</div>}
                {d.lat != null && <a target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-burgundy" href={`https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`}>Ver en mapa <ExternalLink size={12} /></a>}</div>}
              <div><div className="label">Pago</div>{d.payment_methods?.name} {Number(d.orders.paid_total) > 0 ? <span className="text-emerald-700">· pagado {money(d.orders.paid_total)}</span> : <span>· por cobrar {money(Number(d.orders.total) - Number(d.orders.paid_total))}</span>}
                {d.cash_change_for && <div className="text-xs text-charcoal/60">Paga con {money(d.cash_change_for)}</div>}</div>
              {d.orders.notes && <div><div className="label">Observaciones</div>{d.orders.notes}</div>}
              {d.orders.channel === "delivery" && !["delivered", "cancelled", "picked_up", "on_the_way"].includes(d.status) && (
                <div><div className="label">Domiciliario</div>
                  <div className="flex gap-2">
                    <select className="input" defaultValue={d.courier_id ?? ""} id="courier">
                      <option value="">Seleccione…</option>{couriers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                    </select>
                    <button className="btn-secondary" onClick={() => { const v = (document.getElementById("courier") as HTMLSelectElement).value; if (v) call("delivery_assign", { p_delivery: d.id, p_courier: v }, "Domiciliario asignado"); }}><UserPlus size={16} /> Asignar</button>
                  </div>
                  {couriers.length === 0 && <p className="mt-1 text-xs text-charcoal/50">Cree usuarios con el rol Domiciliario en Usuarios y roles.</p>}
                </div>
              )}
              {d.incident_notes && <div><div className="label">Novedades</div><pre className="font-sans whitespace-pre-wrap text-amber-800">{d.incident_notes}</pre></div>}
              {d.proof_url && <div><div className="label">Evidencia de entrega</div><ProofLink path={d.proof_url} /></div>}
            </div>
            <div>
              <div className="label">Productos</div>
              {d.orders.order_items.filter((i) => i.status === "active").map((i, k) => (
                <div key={k} className="border-b border-stone-line py-1.5 text-sm"><div className="flex justify-between"><span>{Number(i.qty)} × {i.name}</span><span>{money(i.line_total)}</span></div>
                  <div className="text-xs text-charcoal/60">{[i.variant_label, i.modifiers?.map((m) => m.name).join(", "), i.notes].filter(Boolean).join(" · ")}</div></div>
              ))}
              <div className="flex justify-between py-1.5 text-sm"><span>Domicilio</span><span>{money(d.fee)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total</span><span>{money(d.orders.total)}</span></div>
              <div className="label mt-4">Historial</div>
              <ol className="space-y-1 text-xs">{[...d.delivery_events].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((e, k) => (
                <li key={k} className="flex justify-between gap-2"><span>{e.from_status === e.to_status ? e.note : <StatusBadge status={e.to_status} />}</span><span className="text-charcoal/50">{dateTime(e.created_at)}</span></li>))}</ol>
            </div>
          </div>
        </Modal>
      )}
      <ReasonModal open={!!cancel} title="Cancelar pedido" onClose={() => setCancel(null)} confirmLabel="Cancelar pedido"
        onConfirm={async (r) => { await call("order_cancel", { p_order: cancel!.orders.id, p_reason: r }, "Pedido cancelado"); setCancel(null); setSel(null); }} />
    </div>
  );
}

function ProofLink({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { supabaseBrowser().storage.from("delivery-proofs").createSignedUrl(path, 600).then(({ data }: { data: { signedUrl: string } | null }) => setUrl(data?.signedUrl ?? null)); }, [path]);
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Evidencia" className="h-32 rounded-lg object-cover" /></a> : null;
}

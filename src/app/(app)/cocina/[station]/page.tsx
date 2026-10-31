"use client";
import { use, useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Clock, Check, X, Flame, Bike, Utensils, ShoppingBag, Maximize } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useRealtime } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { minutesSince, time, errMsg } from "@/lib/format";
import { PageLoader } from "@/components/ui/bits";
import { ReasonModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Ticket = {
  id: string; status: string; received_at: string; accepted_at: string | null; started_at: string | null; ready_at: string | null;
  orders: { number: number; channel: string; customer_name: string | null; notes: string | null; dining_tables: { number: number } | null };
  order_items: { id: string; name: string; variant_label: string | null; qty: number; modifiers: { name: string }[]; notes: string | null; status: string }[];
};

const COLS: { key: string; title: string }[] = [
  { key: "received", title: "Recibidos" }, { key: "accepted", title: "Confirmados" },
  { key: "preparing", title: "En preparación" }, { key: "ready", title: "Listos" },
];

export default function KDS({ params }: { params: Promise<{ station: string }> }) {
  const { station } = use(params);
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, can } = useApp();
  const [st, setSt] = useState<{ id: string; name: string } | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!businessId) return;
    sb.from("stations").select("id, name").eq("business_id", businessId).eq("code", station).single()
      .then(({ data }: { data: { id: string; name: string } | null }) => setSt(data));
  }, [sb, businessId, station]);

  const load = useCallback(async () => {
    if (!st) return;
    const { data } = await sb.from("kds_tickets")
      .select("id, status, received_at, accepted_at, started_at, ready_at, orders(number, channel, customer_name, notes, dining_tables!orders_table_id_fkey(number)), order_items(id, name, variant_label, qty, modifiers, notes, status)")
      .eq("station_id", st.id).in("status", ["received", "accepted", "preparing", "ready"]).order("received_at");
    setTickets((data ?? []) as unknown as Ticket[]);
  }, [sb, st]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(i); }, []);
  const onRt = useCallback(() => load(), [load]);
  useRealtime(businessId, ["kds_tickets", "order_items"], onRt);

  async function move(id: string, status: string, reason?: string) {
    const { error } = await sb.rpc("kds_update_ticket", { p_ticket: id, p_status: status, p_reason: reason ?? null });
    if (error) toast("error", errMsg(error)); else load();
  }

  if (!can(`kds.${station}`)) return <p className="text-sm text-red-700">No tiene acceso a esta estación.</p>;
  if (!tickets || !st) return <PageLoader />;

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100vh-3.5rem)] bg-charcoal p-4 text-ivory sm:-mx-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold text-sand">{st.name}</h1>
        <div className="flex items-center gap-3 text-sm text-ivory/60">
          <span>{tickets.filter((t) => t.status !== "ready").length} en curso</span>
          <button className="btn-ghost !text-ivory/70 hover:!bg-white/10" onClick={() => document.documentElement.requestFullscreen?.()} title="Pantalla completa"><Maximize size={18} /></button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLS.map((c) => (
          <div key={c.key}>
            <div className="mb-2 text-xs font-semibold tracking-[0.2em] text-sand/70 uppercase">{c.title} · {tickets.filter((t) => t.status === c.key).length}</div>
            <div className="space-y-3">
              {tickets.filter((t) => t.status === c.key).map((t) => {
                const mins = minutesSince(t.received_at);
                const late = c.key !== "ready" && mins >= 20, warn = c.key !== "ready" && mins >= 12;
                const o = t.orders;
                return (
                  <div key={t.id} className={clsx("animate-slide-up rounded-2xl bg-white text-charcoal shadow-lg ring-4",
                    late ? "ring-red-500" : warn ? "ring-amber-400" : c.key === "ready" ? "ring-emerald-500" : "ring-transparent")}>
                    <div className="flex items-center justify-between rounded-t-2xl bg-sand-50 px-4 py-2.5">
                      <div>
                        <div className="text-lg font-bold">#{o.number}</div>
                        <div className="flex items-center gap-1 text-xs text-charcoal/70">
                          {o.dining_tables ? <><Utensils size={12} /> Mesa {o.dining_tables.number}</> : o.channel === "delivery" ? <><Bike size={12} /> Domicilio</> : <><ShoppingBag size={12} /> {o.channel === "pickup" ? "Para llevar" : "Mostrador"}</>}
                          {o.customer_name && <> · {o.customer_name}</>}
                        </div>
                      </div>
                      <div className={clsx("text-right text-sm font-semibold", late ? "text-red-600" : warn ? "text-amber-600" : "")}>
                        <Clock size={14} className="mr-1 inline" />{mins} min<div className="text-[10px] font-normal text-charcoal/50">recibido {time(t.received_at)}</div>
                      </div>
                    </div>
                    <ul className="space-y-2 px-4 py-3">
                      {t.order_items.filter((i) => i.status === "active").map((i) => (
                        <li key={i.id}>
                          <div className="flex gap-2 text-base"><b className="text-burgundy">{Number(i.qty)}×</b><span className="font-medium">{i.name}</span></div>
                          {i.variant_label && <div className="pl-7 text-sm text-charcoal/70">{i.variant_label}</div>}
                          {i.modifiers?.length > 0 && <div className="pl-7 text-sm font-medium text-burgundy">{i.modifiers.map((m) => m.name).join(" · ")}</div>}
                          {i.notes && <div className="ml-7 rounded bg-amber-50 px-2 py-0.5 text-sm text-amber-900">“{i.notes}”</div>}
                        </li>
                      ))}
                      {o.notes && <li className="rounded bg-sand-50 px-2 py-1 text-xs">Nota del pedido: {o.notes}</li>}
                    </ul>
                    <div className="flex gap-2 border-t border-stone-line p-3">
                      {c.key === "received" && <>
                        <button className="btn-secondary flex-1 !py-2.5" onClick={() => setRejecting(t.id)}><X size={16} /> Rechazar</button>
                        <button className="btn-primary flex-1 !py-2.5" onClick={() => move(t.id, "accepted")}><Check size={16} /> Aceptar</button>
                      </>}
                      {c.key === "accepted" && <button className="btn-primary flex-1 !py-2.5" onClick={() => move(t.id, "preparing")}><Flame size={16} /> Preparar</button>}
                      {c.key === "preparing" && <button className="btn flex-1 bg-emerald-600 !py-2.5 text-white hover:bg-emerald-700" onClick={() => move(t.id, "ready")}><Check size={16} /> Listo</button>}
                      {c.key === "ready" && <div className="flex-1 text-center text-xs text-charcoal/60">Listo {time(t.ready_at)} · esperando entrega</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <ReasonModal open={!!rejecting} title="Rechazar pedido" confirmLabel="Rechazar" onClose={() => setRejecting(null)}
        onConfirm={(r) => { move(rejecting!, "rejected", r); setRejecting(null); }} />
    </div>
  );
}

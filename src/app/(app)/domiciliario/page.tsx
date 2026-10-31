"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Navigation, PackageCheck, Truck, CheckCircle2, AlertTriangle, Camera, MapPin, History } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useRealtime } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, time, dateTime, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, StatusBadge, Empty } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type D = { id: string; status: string; address: string; details: string | null; lat: number | null; lng: number | null; fee: number; cash_change_for: number | null;
  location_consent: boolean; picked_up_at: string | null; delivered_at: string | null; created_at: string;
  orders: { number: number; customer_name: string; customer_phone: string; total: number; tip: number; paid_total: number; notes: string | null; order_items: { name: string; qty: number; status: string }[] } };

/** Interfaz móvil del domiciliario */
export default function CourierPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, current } = useApp();
  const [list, setList] = useState<D[] | null>(null);
  const [history, setHistory] = useState(false);
  const [deliver, setDeliver] = useState<D | null>(null);
  const watchers = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    const { data } = await sb.from("deliveries").select("*, orders(number, customer_name, customer_phone, total, tip, paid_total, notes, order_items(name, qty, status))")
      .eq("business_id", businessId).eq("courier_id", current?.member.id ?? "")
      .order("created_at", { ascending: false }).limit(history ? 100 : 30);
    setList((data ?? []) as unknown as D[]);
  }, [sb, businessId, current, history]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  useRealtime(businessId, ["deliveries"], load);

  // Ubicación en vivo solo si el domiciliario dio consentimiento y el pedido va en ruta
  useEffect(() => {
    const active = (list ?? []).filter((d) => d.location_consent && ["picked_up", "on_the_way"].includes(d.status));
    for (const d of active) {
      if (watchers.current[d.id] || !navigator.geolocation) continue;
      let last = 0;
      watchers.current[d.id] = navigator.geolocation.watchPosition((p) => {
        if (Date.now() - last < 20000) return; last = Date.now();
        sb.rpc("courier_push_location", { p_delivery: d.id, p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_accuracy: p.coords.accuracy });
      }, undefined, { enableHighAccuracy: true });
    }
    for (const id of Object.keys(watchers.current)) {
      if (!active.some((d) => d.id === id)) { navigator.geolocation.clearWatch(watchers.current[id]); delete watchers.current[id]; }
    }
  }, [list, sb]);

  async function update(d: D, status: string, extra: Record<string, unknown> = {}) {
    const { error } = await sb.rpc("courier_update", { p_delivery: d.id, p_status: status, p_note: null, p_proof_url: null, p_cash_received: null, ...extra });
    if (error) { toast("error", errMsg(error)); return false; }
    toast("success", "Estado actualizado"); load(); return true;
  }
  async function incident(d: D) {
    const note = prompt("Describa la novedad (cliente no responde, dirección errada, etc.)");
    if (!note || note.trim().length < 3) return;
    const { error } = await sb.rpc("courier_report_incident", { p_delivery: d.id, p_note: note.trim() });
    if (error) toast("error", errMsg(error)); else toast("success", "Novedad registrada");
  }
  async function consent(d: D, v: boolean) {
    if (v && navigator.geolocation) navigator.geolocation.getCurrentPosition(() => {}, () => toast("error", "Permita el acceso a la ubicación en su navegador"));
    const { error } = await sb.rpc("courier_set_consent", { p_delivery: d.id, p_consent: v });
    if (error) toast("error", errMsg(error)); else load();
  }

  if (!list) return <PageLoader />;
  const active = list.filter((d) => !["delivered", "cancelled"].includes(d.status));
  const done = list.filter((d) => d.status === "delivered");

  return (
    <div className="mx-auto max-w-lg animate-fade-in">
      <PageHeader title="Mis entregas" subtitle={`${active.length} asignadas`} actions={<button className="btn-secondary" onClick={() => setHistory(!history)}><History size={16} /> {history ? "Ocultar historial" : "Historial"}</button>} />
      {active.length === 0 && <Empty icon={<Truck size={36} />} title="No tienes domicilios asignados" text="Te avisaremos cuando te asignen uno." />}
      <div className="space-y-4">
        {active.map((d) => {
          const due = Number(d.orders.total) + Number(d.orders.tip) - Number(d.orders.paid_total);
          const nav = d.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d.address)}`;
          return (
            <div key={d.id} className="card overflow-hidden">
              <div className="flex items-center justify-between bg-sand-50 px-4 py-3"><b>#{d.orders.number} · {d.orders.customer_name}</b><StatusBadge status={d.status} /></div>
              <div className="space-y-3 p-4 text-sm">
                <div className="flex items-start gap-2"><MapPin size={16} className="mt-0.5 text-burgundy" /><div><div className="font-medium">{d.address}</div>{d.details && <div className="text-charcoal/60">{d.details}</div>}</div></div>
                <div className="text-xs text-charcoal/60">{d.orders.order_items.filter((i) => i.status === "active").map((i) => `${Number(i.qty)}× ${i.name}`).join(", ")}</div>
                {d.orders.notes && <div className="rounded bg-amber-50 px-2 py-1 text-xs">{d.orders.notes}</div>}
                <div className="flex items-center justify-between rounded-xl bg-charcoal px-4 py-3 text-white">
                  <span>{due > 0 ? "Cobrar en efectivo" : "Pagado"}</span><span className="text-lg font-semibold">{money(Math.max(due, 0))}</span>
                </div>
                {d.cash_change_for && due > 0 && <p className="text-xs">El cliente paga con {money(d.cash_change_for)} · llevar cambio de {money(Number(d.cash_change_for) - due)}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <a href={`tel:${d.orders.customer_phone}`} className="btn-secondary"><Phone size={16} /> Llamar</a>
                  <a href={nav} target="_blank" rel="noreferrer" className="btn-secondary"><Navigation size={16} /> Navegar</a>
                </div>
                <label className="flex items-center gap-2 text-xs text-charcoal/70">
                  <input type="checkbox" checked={d.location_consent} onChange={(e) => consent(d, e.target.checked)} />
                  Compartir mi ubicación con el cliente mientras entrego este pedido
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {["courier_assigned", "ready_for_dispatch"].includes(d.status) && <button className="btn-primary col-span-2" onClick={() => update(d, "picked_up")}><PackageCheck size={16} /> Recogí el pedido</button>}
                  {d.status === "picked_up" && <button className="btn-primary col-span-2" onClick={() => update(d, "on_the_way")}><Truck size={16} /> Voy en camino</button>}
                  {["picked_up", "on_the_way"].includes(d.status) && <button className="btn col-span-2 bg-emerald-600 text-white" onClick={() => setDeliver(d)}><CheckCircle2 size={16} /> Entregado</button>}
                  <button className="btn-ghost col-span-2 text-amber-800" onClick={() => incident(d)}><AlertTriangle size={16} /> Registrar novedad</button>
                </div>
                {d.picked_up_at && <p className="text-xs text-charcoal/50">Recogido {time(d.picked_up_at)}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {history && (
        <div className="mt-8"><h2 className="mb-2 font-display text-xl">Historial</h2>
          <table className="table-base card overflow-hidden"><thead><tr><th>Pedido</th><th>Entregado</th><th className="text-right">Valor</th></tr></thead>
            <tbody>{done.map((d) => <tr key={d.id}><td>#{d.orders.number} {d.orders.customer_name}</td><td>{dateTime(d.delivered_at)}</td><td className="text-right">{money(d.orders.total)}</td></tr>)}</tbody></table></div>
      )}
      {deliver && <DeliverModal d={deliver} businessId={businessId} onClose={() => setDeliver(null)} onDone={async (cash, proof) => {
        if (await update(deliver, "delivered", { p_cash_received: cash, p_proof_url: proof })) setDeliver(null);
      }} />}
    </div>
  );
}

function DeliverModal({ d, businessId, onClose, onDone }: { d: D; businessId: string; onClose: () => void; onDone: (cash: number | null, proof: string | null) => void }) {
  const due = Number(d.orders.total) + Number(d.orders.tip) - Number(d.orders.paid_total);
  const [cash, setCash] = useState(due > 0 ? String(due) : "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit() {
    setBusy(true);
    let path: string | null = null;
    if (file) {
      path = `${businessId}/${d.id}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
      const { error } = await supabaseBrowser().storage.from("delivery-proofs").upload(path, file);
      if (error) { setBusy(false); toast("error", "No se pudo subir la evidencia: " + errMsg(error)); return; }
    }
    await onDone(due > 0 ? Number(cash) : null, path);
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title="Confirmar entrega" footer={<button className="btn-primary w-full" disabled={busy || (due > 0 && Number(cash) < due)} onClick={submit}>Confirmar entrega</button>}>
      {due > 0 && <><label className="label">Efectivo recibido</label><input className="input text-lg" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^0-9]/g, ""))} />
        <p className="mt-1 text-xs text-charcoal/60">Por cobrar {money(due)}{Number(cash) > due && ` · cambio ${money(Number(cash) - due)}`}</p></>}
      <label className="label mt-4">Evidencia de entrega (opcional)</label>
      <label className="btn-secondary w-full cursor-pointer"><Camera size={16} /> {file ? file.name : "Tomar foto"}<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
    </Modal>
  );
}

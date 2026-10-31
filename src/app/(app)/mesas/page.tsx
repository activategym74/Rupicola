"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import QRCode from "qrcode";
import { BellRing, Receipt, Plus, ArrowRightLeft, QrCode, HandPlatter, CheckCheck, Users } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useRealtime } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, minutesSince, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, StatusBadge, Empty } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type T = { id: string; number: number; name: string | null; zone: string; seats: number; pos_x: number; pos_y: number; shape: string; status: string; status_changed_at: string; qr_token: string };
type Req = { id: string; table_id: string; kind: string; note: string | null; created_at: string };
type O = { id: string; number: number; table_id: string; total: number; paid_total: number; status: string; customer_name: string | null;
  kds_tickets: { id: string; status: string; stations: { name: string } | null }[] };

const REQ: Record<string, string> = { call_waiter: "Llama al mesero", supplies: "Pide servilletas / elementos", assistance: "Solicita asistencia", bill: "Pide la cuenta" };
const TONE: Record<string, string> = {
  available: "border-emerald-200 bg-emerald-50/60", occupied: "border-sand bg-sand-50", pending_order: "border-blue-200 bg-blue-50",
  preparing: "border-amber-200 bg-amber-50", order_ready: "border-emerald-400 bg-emerald-100", needs_attention: "border-amber-400 bg-amber-100 animate-pulse",
  requesting_bill: "border-burgundy bg-burgundy text-white",
};

export default function TablesPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, can } = useApp();
  const [tables, setTables] = useState<T[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [orders, setOrders] = useState<O[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [qr, setQr] = useState<{ t: T; url: string; img: string } | null>(null);
  const [moving, setMoving] = useState<O | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const [t, r, o] = await Promise.all([
      sb.from("dining_tables").select("*").eq("business_id", businessId).eq("active", true).order("number"),
      sb.from("service_requests").select("*").eq("business_id", businessId).eq("status", "open").order("created_at"),
      sb.from("orders").select("id, number, table_id, total, paid_total, status, customer_name, kds_tickets(id, status, stations(name))")
        .eq("business_id", businessId).not("table_id", "is", null).eq("finalized", false).neq("status", "cancelled"),
    ]);
    setTables((t.data ?? []) as T[]); setReqs((r.data ?? []) as Req[]); setOrders((o.data ?? []) as unknown as O[]);
  }, [sb, businessId]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(i); }, []);
  useRealtime(businessId, ["dining_tables", "service_requests", "orders", "kds_tickets"], load);

  const zones = useMemo(() => [...new Set((tables ?? []).map((t) => t.zone))], [tables]);
  if (!tables) return <PageLoader />;
  const table = tables.find((t) => t.id === sel);
  const tOrders = orders.filter((o) => o.table_id === sel);
  const tReqs = reqs.filter((r) => r.table_id === sel);

  async function attend(id: string) {
    const { error } = await sb.rpc("service_request_attend", { p_request: id });
    if (error) toast("error", errMsg(error)); else { toast("success", "Solicitud atendida"); load(); }
  }
  async function delivered(ticket: string) {
    const { error } = await sb.rpc("kds_update_ticket", { p_ticket: ticket, p_status: "delivered" });
    if (error) toast("error", errMsg(error)); else load();
  }
  async function showQr(t: T) {
    const url = `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/m/${t.qr_token}`;
    setQr({ t, url, img: await QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: "#292524", light: "#FFFFFF" } }) });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Mesas" subtitle="Estado en tiempo real del salón"
        actions={<div className="flex flex-wrap gap-1.5 text-xs">{["available", "occupied", "pending_order", "preparing", "order_ready", "needs_attention", "requesting_bill"].map((s) => <StatusBadge key={s} status={s} />)}</div>} />

      {reqs.length > 0 && (
        <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {reqs.map((r) => {
            const t = tables.find((x) => x.id === r.table_id);
            return (
              <div key={r.id} className="card flex animate-slide-up items-center gap-3 !border-amber-300 p-3">
                <BellRing className="text-amber-600" size={20} />
                <div className="flex-1 text-sm"><b>Mesa {t?.number}</b> · {REQ[r.kind]}{r.note && <span className="text-charcoal/60"> — {r.note}</span>}
                  <div className="text-xs text-charcoal/50">hace {minutesSince(r.created_at)} min</div></div>
                {can("tables.manage") && <button className="btn-secondary !py-1.5" onClick={() => attend(r.id)}><CheckCheck size={16} /> Atendida</button>}
              </div>
            );
          })}
        </div>
      )}

      {tables.length === 0 ? <Empty icon={<Users size={36} />} title="Aún no hay mesas" text="Créelas en Configuración → Mesas. Cada una tendrá su código QR." /> :
        zones.map((z) => {
          const zt = tables.filter((t) => t.zone === z);
          const cols = Math.max(4, ...zt.map((t) => t.pos_x + 1));
          return (
            <section key={z} className="mb-6">
              <h2 className="mb-2 text-sm font-medium text-charcoal/60">{z}</h2>
              <div className="card grid gap-3 p-4" style={{ gridTemplateColumns: `repeat(${Math.min(cols, 8)}, minmax(0, 1fr))` }}>
                {zt.map((t) => {
                  const o = orders.filter((x) => x.table_id === t.id);
                  const total = o.reduce((s, x) => s + Number(x.total), 0);
                  return (
                    <button key={t.id} onClick={() => setSel(t.id)}
                      style={t.pos_x || t.pos_y ? { gridColumnStart: Math.min(t.pos_x + 1, 8), gridRowStart: t.pos_y + 1 } : undefined}
                      className={clsx("flex aspect-square flex-col items-center justify-center border-2 p-2 text-center transition hover:scale-[1.03]",
                        t.shape === "round" ? "rounded-full" : "rounded-2xl", TONE[t.status] ?? "border-stone-line bg-white")}>
                      <span className="font-display text-2xl font-semibold">{t.number}</span>
                      <span className="text-[10px] leading-tight opacity-80">{t.name ?? `${t.seats} puestos`}</span>
                      {t.status !== "available" && <span className="mt-1 text-[11px] font-medium">{money(total)}</span>}
                      {t.status !== "available" && <span className="text-[10px] opacity-70">{minutesSince(t.status_changed_at)} min</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

      {table && (
        <Modal open onClose={() => setSel(null)} title={<span className="flex items-center gap-2">Mesa {table.number} <StatusBadge status={table.status} /></span>}
          footer={<>
            <button className="btn-secondary" onClick={() => showQr(table)}><QrCode size={16} /> QR</button>
            {can("pos.sell") && <Link href={tOrders[0] ? `/pos?order=${tOrders[0].id}` : `/pos?table=${table.id}`} className="btn-primary"><Plus size={16} /> {tOrders.length ? "Agregar productos" : "Abrir mesa"}</Link>}
          </>}>
          {tReqs.map((r) => (
            <div key={r.id} className="mb-2 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm">
              <span><BellRing size={14} className="mr-1 inline" />{REQ[r.kind]}</span>
              {can("tables.manage") && <button className="text-xs font-medium text-burgundy" onClick={() => attend(r.id)}>Marcar atendida</button>}
            </div>
          ))}
          {tOrders.length === 0 ? <p className="text-sm text-charcoal/60">Mesa disponible.</p> : tOrders.map((o) => (
            <div key={o.id} className="mb-3 rounded-xl border border-stone-line p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">Cuenta #{o.number} {o.customer_name && <span className="text-charcoal/60">· {o.customer_name}</span>}</div>
                <div className="font-semibold">{money(o.total)}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {o.kds_tickets.filter((k) => k.status !== "rejected").map((k) => (
                  <span key={k.id} className="flex items-center gap-1 text-xs">
                    {k.stations?.name}: <StatusBadge status={k.status} />
                    {k.status === "ready" && can("tables.manage") && <button className="chip bg-charcoal text-white" onClick={() => delivered(k.id)}><HandPlatter size={12} /> Entregar</button>}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/pos?order=${o.id}`} className="btn-secondary !py-1.5 text-xs"><Receipt size={14} /> Ver cuenta / cobrar</Link>
                {can("tables.manage") && <button className="btn-secondary !py-1.5 text-xs" onClick={() => setMoving(o)}><ArrowRightLeft size={14} /> Cambiar de mesa</button>}
              </div>
            </div>
          ))}
        </Modal>
      )}

      {moving && (
        <Modal open onClose={() => setMoving(null)} title={`Mover cuenta #${moving.number}`}>
          <div className="grid grid-cols-4 gap-2">
            {tables.filter((t) => t.id !== moving.table_id).map((t) => (
              <button key={t.id} className={clsx("btn-secondary", t.status !== "available" && "opacity-60")} onClick={async () => {
                const { error } = await sb.rpc("pos_transfer_table", { p_order: moving.id, p_table: t.id });
                if (error) toast("error", errMsg(error)); else { toast("success", `Cuenta movida a la mesa ${t.number}`); setMoving(null); setSel(null); load(); }
              }}>{t.number}</button>
            ))}
          </div>
        </Modal>
      )}

      {qr && (
        <Modal open onClose={() => setQr(null)} title={`QR · Mesa ${qr.t.number}`}
          footer={<a className="btn-primary" href={qr.img} download={`mesa-${qr.t.number}-qr.png`}>Descargar PNG</a>}>
          <div className="flex flex-col items-center text-center">
            <img src={qr.img} alt={`Código QR mesa ${qr.t.number}`} className="w-64" />
            <p className="mt-2 font-display text-xl">Escanea y pide desde tu celular</p>
            <p className="mt-1 break-all text-xs text-charcoal/50">{qr.url}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

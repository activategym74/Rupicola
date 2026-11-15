"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, BellRing, CheckCheck, HandPlatter, Minus, Plus, Receipt, Search, Send, Store, Trash2, Users, Utensils } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useCatalog, useRealtime } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, minutesSince, errMsg } from "@/lib/format";
import { type CartLine, type Product, variantLabel } from "@/lib/types";
import { ProductOptions, type PickResult } from "@/components/pos/product-options";
import { Empty, PageLoader, StatusBadge } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type T = { id: string; number: number; name: string | null; zone: string; seats: number; status: string; status_changed_at: string };
type Req = { id: string; table_id: string; kind: string; note: string | null; created_at: string };
type Item = { id: string; name: string; qty: number; line_total: number; status: string; variant_label: string | null; notes: string | null; ticket_id: string | null; modifiers: { name: string }[] | null };
type Ticket = { id: string; status: string; stations: { name: string } | null };
type O = { id: string; number: number; table_id: string; total: number; status: string; customer_name: string | null; kds_tickets: Ticket[]; order_items: Item[] };

const REQ: Record<string, string> = { call_waiter: "Llama al mesero", supplies: "Pide servilletas / elementos", assistance: "Solicita asistencia", bill: "Pide la cuenta" };
const TONE: Record<string, string> = {
  available: "border-emerald-200 bg-emerald-50/60", occupied: "border-sand bg-sand-50", pending_order: "border-blue-200 bg-blue-50",
  preparing: "border-amber-200 bg-amber-50", order_ready: "border-emerald-400 bg-emerald-100", needs_attention: "border-amber-400 bg-amber-100 animate-pulse",
  requesting_bill: "border-burgundy bg-burgundy text-white",
};

/**
 * Modo mesero: pantalla pensada para el celular o la tablet del mesero.
 * Elige la mesa, toma el pedido en la mesa y lo envía a cocina, bar o café.
 */
export default function WaiterPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, units, can } = useApp();
  const { categories, products, loading } = useCatalog(businessId);
  const [tables, setTables] = useState<T[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [orders, setOrders] = useState<O[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"order" | "bill">("order");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const [t, r, o] = await Promise.all([
      sb.from("dining_tables").select("id, number, name, zone, seats, status, status_changed_at").eq("business_id", businessId).eq("active", true).order("number"),
      sb.from("service_requests").select("*").eq("business_id", businessId).eq("status", "open").order("created_at"),
      sb.from("orders").select("id, number, table_id, total, status, customer_name, created_at, kds_tickets(id, status, stations(name)), order_items(id, name, qty, line_total, status, variant_label, notes, ticket_id, modifiers)")
        .eq("business_id", businessId).not("table_id", "is", null).eq("finalized", false).neq("status", "cancelled").order("created_at"),
    ]);
    setTables((t.data ?? []) as T[]); setReqs((r.data ?? []) as Req[]); setOrders((o.data ?? []) as unknown as O[]);
  }, [sb, businessId]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(i); }, []);
  useRealtime(businessId, ["dining_tables", "service_requests", "orders", "kds_tickets"], load);

  const unitKind = useCallback((unitId: string) => units.find((u) => u.id === unitId)?.kind ?? "gastronomy", [units]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products.filter((p) => (!cat || p.category_id === cat) && (!t || p.name.toLowerCase().includes(t) || p.sku?.toLowerCase().includes(t)));
  }, [products, cat, q]);

  if (!tables || loading) return <PageLoader />;
  const table = tables.find((t) => t.id === sel);
  const tOrders = orders.filter((o) => o.table_id === sel);
  const tReqs = reqs.filter((r) => r.table_id === sel);
  const ready = orders.flatMap((o) => o.kds_tickets.filter((k) => k.status === "ready").map((k) => ({ ...k, table: tables.find((t) => t.id === o.table_id)?.number })));
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cart.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const billTotal = tOrders.reduce((s, o) => s + Number(o.total), 0);

  async function attend(id: string) {
    const { error } = await sb.rpc("service_request_attend", { p_request: id });
    if (error) toast("error", errMsg(error)); else { toast("success", "Solicitud atendida"); load(); }
  }
  async function deliver(ticket: string) {
    const { error } = await sb.rpc("kds_update_ticket", { p_ticket: ticket, p_status: "delivered" });
    if (error) toast("error", errMsg(error)); else { toast("success", "Entregado"); load(); }
  }

  function addLine(p: Product, r: PickResult) {
    const price = Number(r.variant?.price ?? p.price) + r.price_delta;
    const key = [p.id, r.variant?.id, ...r.option_ids.sort(), r.notes].join("|");
    setCart((s) => {
      const ex = s.find((l) => l.key === key);
      if (ex) return s.map((l) => (l.key === key ? { ...l, qty: l.qty + r.qty } : l));
      return [...s, { key, product_id: p.id, variant_id: r.variant?.id, name: p.name, variant_label: r.variant ? variantLabel(r.variant) : undefined,
        qty: r.qty, unit_price: price, option_ids: r.option_ids, option_names: r.option_names, notes: r.notes || undefined, unit_kind: unitKind(p.business_unit_id) }];
    });
    setPicking(null);
    toast("success", `${p.name} agregado`);
  }
  function tap(p: Product) {
    if (!p.is_available) return toast("info", `${p.name} no está disponible`);
    const hasOptions = (p.product_variants?.filter((v) => v.active).length ?? 0) > 0 || (p.modifier_groups?.length ?? 0) > 0;
    if (hasOptions) setPicking(p);
    else addLine(p, { qty: 1, option_ids: [], option_names: [], price_delta: 0, notes: "" });
  }

  async function send() {
    if (!table || cart.length === 0) return;
    setBusy(true);
    const items = cart.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, qty: l.qty, option_ids: l.option_ids, notes: l.notes }));
    const open = tOrders[0];
    const { error } = open
      ? await sb.rpc("pos_add_items", { p_order: open.id, p_items: items, p_send: true })
      : await sb.rpc("pos_create_order", { p_business: businessId, p_channel: "table", p_items: items, p_table: table.id, p_customer: null, p_customer_name: null, p_send: true });
    setBusy(false);
    if (error) return toast("error", errMsg(error));
    setCart([]); setReview(false); setTab("bill"); load();
    toast("success", `Pedido de la mesa ${table.number} enviado a preparación`);
  }

  function leave() {
    if (cart.length > 0 && !confirm("Hay productos sin enviar. ¿Salir y descartarlos?")) return;
    setCart([]); setSel(null); setQ(""); setCat(""); setTab("order");
  }

  /* ---------- Vista 1: elegir mesa ---------- */
  if (!table) {
    const zones = [...new Set(tables.map((t) => t.zone))];
    return (
      <div className="mx-auto max-w-3xl animate-fade-in">
        <h1 className="mb-1 font-display text-3xl font-semibold">Modo mesero</h1>
        <p className="mb-4 text-sm text-charcoal/60">Toque una mesa para tomar el pedido.</p>

        {reqs.length > 0 && (
          <div className="mb-4 space-y-2">
            {reqs.map((r) => (
              <div key={r.id} className="card flex items-center gap-3 !border-amber-300 p-3">
                <BellRing className="shrink-0 text-amber-600" size={22} />
                <div className="flex-1 text-sm"><b>Mesa {tables.find((x) => x.id === r.table_id)?.number}</b> · {REQ[r.kind]}
                  <div className="text-xs text-charcoal/50">hace {minutesSince(r.created_at)} min</div></div>
                <button className="btn-secondary !px-3 !py-2" onClick={() => attend(r.id)}><CheckCheck size={18} /></button>
              </div>
            ))}
          </div>
        )}
        {ready.length > 0 && (
          <div className="mb-4 space-y-2">
            {ready.map((k) => (
              <div key={k.id} className="card flex items-center gap-3 !border-emerald-300 bg-emerald-50 p-3">
                <HandPlatter className="shrink-0 text-emerald-700" size={22} />
                <div className="flex-1 text-sm"><b>Mesa {k.table}</b> · listo en {k.stations?.name}</div>
                <button className="btn-primary !px-3 !py-2 text-sm" onClick={() => deliver(k.id)}>Entregar</button>
              </div>
            ))}
          </div>
        )}

        {tables.length === 0 ? <Empty icon={<Users size={36} />} title="Aún no hay mesas" text="Créelas en Configuración → Mesas." /> :
          zones.map((z) => (
            <section key={z} className="mb-5">
              <h2 className="mb-2 text-sm font-medium text-charcoal/60">{z}</h2>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {tables.filter((t) => t.zone === z).map((t) => {
                  const total = orders.filter((o) => o.table_id === t.id).reduce((s, o) => s + Number(o.total), 0);
                  const bell = reqs.some((r) => r.table_id === t.id);
                  return (
                    <button key={t.id} onClick={() => { setSel(t.id); setTab(orders.some((o) => o.table_id === t.id) ? "bill" : "order"); }}
                      className={clsx("relative flex aspect-square flex-col items-center justify-center rounded-2xl border-2 p-2 text-center transition active:scale-95", TONE[t.status] ?? "border-stone-line bg-white")}>
                      {bell && <BellRing size={16} className="absolute top-2 right-2 text-amber-600" />}
                      <span className="font-display text-3xl font-semibold">{t.number}</span>
                      <span className="text-[11px] leading-tight opacity-80">{t.status === "available" ? "Libre" : money(total)}</span>
                      {t.status !== "available" && <span className="text-[10px] opacity-70">{minutesSince(t.status_changed_at)} min</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
      </div>
    );
  }

  /* ---------- Vista 2: tomar el pedido de una mesa ---------- */
  return (
    <div className="mx-auto max-w-3xl animate-fade-in pb-28">
      <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center gap-2 border-b border-stone-line bg-ivory/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <button className="btn-ghost !p-2" onClick={leave} aria-label="Volver a las mesas"><ArrowLeft size={22} /></button>
        <div className="flex-1">
          <div className="font-display text-2xl font-semibold leading-tight">Mesa {table.number}</div>
          <StatusBadge status={table.status} />
        </div>
        <div className="flex overflow-hidden rounded-full border border-stone-line bg-white text-sm">
          <button className={clsx("px-3 py-1.5", tab === "order" && "bg-burgundy text-white")} onClick={() => setTab("order")}>Pedir</button>
          <button className={clsx("px-3 py-1.5", tab === "bill" && "bg-burgundy text-white")} onClick={() => setTab("bill")}>Cuenta{tOrders.length > 0 && ` · ${money(billTotal)}`}</button>
        </div>
      </div>

      {tReqs.map((r) => (
        <div key={r.id} className="mb-2 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm">
          <span><BellRing size={14} className="mr-1 inline" />{REQ[r.kind]}</span>
          <button className="text-sm font-medium text-burgundy" onClick={() => attend(r.id)}>Atendida</button>
        </div>
      ))}

      {tab === "order" ? (
        <>
          <div className="relative mb-2">
            <Search className="absolute top-3 left-3 text-charcoal/40" size={18} />
            <input className="input !py-2.5 !pl-10" placeholder="Buscar plato o bebida…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="scrollbar-thin -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
            <button onClick={() => setCat("")} className={clsx("chip shrink-0 border !px-3 !py-2 text-sm", !cat ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>Todo</button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={clsx("chip shrink-0 border !px-3 !py-2 text-sm", cat === c.id ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{c.name}</button>
            ))}
          </div>
          <div className="divide-y divide-stone-line overflow-hidden rounded-2xl border border-stone-line bg-white">
            {filtered.map((p) => {
              const inCart = cart.filter((l) => l.product_id === p.id).reduce((s, l) => s + l.qty, 0);
              return (
                <button key={p.id} onClick={() => tap(p)} disabled={!p.is_available}
                  className={clsx("flex w-full items-center gap-3 px-3 py-3 text-left active:bg-sand-50", !p.is_available && "opacity-50")}>
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-sand-50">
                    {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> :
                      <div className="flex h-full items-center justify-center text-sand">{unitKind(p.business_unit_id) === "shop" ? <Store size={20} /> : <Utensils size={20} />}</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-sm font-semibold text-burgundy">{money(p.price)}{!p.is_available && <span className="ml-2 text-xs font-normal text-red-700">Agotado</span>}</div>
                  </div>
                  {inCart > 0 && <span className="chip bg-burgundy text-white">{inCart}</span>}
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-burgundy text-white"><Plus size={20} /></span>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="py-10 text-center text-sm text-charcoal/50">Sin resultados</p>}
          </div>
        </>
      ) : (
        <div>
          {tOrders.length === 0 ? <Empty icon={<Receipt size={32} />} title="Mesa sin pedido" text="Toque Pedir para tomar el pedido." /> : tOrders.map((o) => (
            <div key={o.id} className="card mb-3 p-3">
              <div className="mb-2 flex items-center justify-between"><b>Cuenta #{o.number}</b><StatusBadge status={o.status} /></div>
              {o.order_items.filter((i) => i.status === "active").map((i) => (
                <div key={i.id} className="flex justify-between gap-2 border-b border-stone-line py-2 text-sm">
                  <span><b>{Number(i.qty)}</b> × {i.name}
                    <span className="block text-xs text-charcoal/55">{[i.variant_label, i.modifiers?.map((m) => m.name).join(", "), i.notes].filter(Boolean).join(" · ")}</span></span>
                  <span>{money(i.line_total)}</span>
                </div>
              ))}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {o.kds_tickets.filter((k) => k.status !== "rejected").map((k) => (
                  <span key={k.id} className="flex items-center gap-1 text-xs">{k.stations?.name}: <StatusBadge status={k.status} />
                    {k.status === "ready" && <button className="chip bg-charcoal text-white" onClick={() => deliver(k.id)}><HandPlatter size={12} /> Entregar</button>}</span>
                ))}
              </div>
              <div className="mt-2 text-right text-lg font-semibold">{money(o.total)}</div>
              {can("pos.charge") && <Link href={`/pos?order=${o.id}`} className="btn-secondary mt-2 w-full"><Receipt size={16} /> Cobrar en caja</Link>}
            </div>
          ))}
          <button className="btn-primary w-full" onClick={() => setTab("order")}><Plus size={16} /> Agregar productos</button>
        </div>
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-line bg-white/95 p-3 backdrop-blur lg:left-64">
          <button className="btn-primary mx-auto flex w-full max-w-3xl justify-between !py-3 text-base" onClick={() => setReview(true)}>
            <span>Ver pedido · {cartCount} {cartCount === 1 ? "producto" : "productos"}</span><span>{money(cartTotal)}</span>
          </button>
        </div>
      )}

      <Modal open={review} onClose={() => setReview(false)} title={`Pedido · Mesa ${table.number}`}
        footer={<button className="btn-primary w-full !py-3 text-base" disabled={busy || cart.length === 0 || !can("pos.sell")} onClick={send}>
          <Send size={18} /> {busy ? "Enviando…" : `Enviar a cocina · ${money(cartTotal)}`}</button>}>
        {cart.map((l) => (
          <div key={l.key} className="flex items-center gap-2 border-b border-stone-line py-2 text-sm">
            <div className="flex-1">
              <div className="font-medium">{l.name}</div>
              <div className="text-xs text-charcoal/55">{[l.variant_label, l.option_names.join(", "), l.notes].filter(Boolean).join(" · ")}{l.unit_kind === "shop" && " · Tienda (no va a cocina)"}</div>
              <div className="text-xs">{money(l.qty * l.unit_price)}</div>
            </div>
            <button className="btn-secondary !p-2" onClick={() => setCart((s) => s.map((x) => x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x))} aria-label="Menos"><Minus size={16} /></button>
            <span className="w-6 text-center font-semibold">{l.qty}</span>
            <button className="btn-secondary !p-2" onClick={() => setCart((s) => s.map((x) => x.key === l.key ? { ...x, qty: x.qty + 1 } : x))} aria-label="Más"><Plus size={16} /></button>
            <button className="btn-ghost !p-2 text-charcoal/40" onClick={() => setCart((s) => s.filter((x) => x.key !== l.key))} aria-label="Quitar"><Trash2 size={16} /></button>
          </div>
        ))}
        <p className="mt-3 text-xs text-charcoal/50">Cada producto llega a su estación: comida a cocina, bebidas al bar o al café.</p>
      </Modal>

      <ProductOptions product={picking} open={!!picking} onClose={() => setPicking(null)} onAdd={(r) => picking && addLine(picking, r)} />
    </div>
  );
}

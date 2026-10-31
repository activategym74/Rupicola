"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  Search, ScanBarcode, Minus, Plus, Trash2, Send, CreditCard, Percent, Ban, Split, Merge, UserRound, Receipt as ReceiptIcon,
  Store, Utensils, X, ListOrdered,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useCatalog, useOpenSessions, usePaymentMethods, useRealtime } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, errMsg, time } from "@/lib/format";
import { type CartLine, type Product, variantLabel } from "@/lib/types";
import { ProductOptions, type PickResult } from "@/components/pos/product-options";
import { PaymentModal } from "@/components/pos/payment-modal";
import { Receipt } from "@/components/pos/receipt";
import { ORDER_SELECT, type Order, type OrderItem } from "@/components/pos/types";
import { Modal, ReasonModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { PageLoader, StatusBadge } from "@/components/ui/bits";

type Table = { id: string; number: number; status: string };
type OpenOrder = { id: string; number: number; total: number; channel: string; status: string; created_at: string; customer_name: string | null; dining_tables: { number: number } | null };

function POS() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { businessId, units, can, current } = useApp();
  const { categories, products, loading } = useCatalog(businessId);
  const methods = usePaymentMethods(businessId);
  const { sessions } = useOpenSessions(businessId);

  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [orderId, setOrderId] = useState<string | null>(params.get("order"));
  const [order, setOrder] = useState<Order | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [tableId, setTableId] = useState<string>(params.get("table") ?? "");
  const [channel, setChannel] = useState<"counter" | "pickup">("counter");
  const [customer, setCustomer] = useState<{ id: string; full_name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | "pay" | "receipt" | "split" | "merge" | "discount" | "customer" | "orders">(null);
  const [voidItem, setVoidItem] = useState<OrderItem | null>(null);
  const [lastChange, setLastChange] = useState(0);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const unitKind = useCallback((unitId: string) => units.find((u) => u.id === unitId)?.kind ?? "gastronomy", [units]);

  const loadOrder = useCallback(async (id: string | null) => {
    if (!id) { setOrder(null); return; }
    const { data, error } = await sb.from("orders").select(ORDER_SELECT).eq("id", id).single();
    if (error) { toast("error", errMsg(error)); return; }
    setOrder(data as Order);
    setTableId((data as Order).table_id ?? "");
  }, [sb, toast]);

  const loadOpen = useCallback(async () => {
    const { data } = await sb.from("orders").select("id, number, total, channel, status, created_at, customer_name, dining_tables!orders_table_id_fkey(number)")
      .eq("business_id", businessId).eq("finalized", false).neq("status", "cancelled").order("created_at", { ascending: false }).limit(60);
    setOpenOrders((data ?? []) as unknown as OpenOrder[]);
  }, [sb, businessId]);

  useEffect(() => { loadOrder(orderId); }, [orderId, loadOrder]);
  useEffect(() => {
    if (!businessId) return;
    sb.from("dining_tables").select("id, number, status").eq("business_id", businessId).eq("active", true).order("number")
      .then(({ data }: { data: Table[] | null }) => setTables(data ?? []));
    loadOpen();
  }, [sb, businessId, loadOpen]);
  const onRt = useCallback(() => { loadOpen(); if (orderId) loadOrder(orderId); }, [loadOpen, loadOrder, orderId]);
  useRealtime(businessId, ["orders", "kds_tickets"], onRt);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products.filter((p) => (!cat || p.category_id === cat) && (!t ||
      p.name.toLowerCase().includes(t) || p.sku?.toLowerCase().includes(t) || p.barcode === t ||
      p.product_variants?.some((v) => v.sku?.toLowerCase() === t || v.barcode === t)));
  }, [products, cat, q]);

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
  }

  function tapProduct(p: Product) {
    if (!p.is_available) return toast("info", `${p.name} no está disponible`);
    const hasOptions = (p.product_variants?.filter((v) => v.active).length ?? 0) > 0 || (p.modifier_groups?.length ?? 0) > 0;
    if (hasOptions) setPicking(p);
    else addLine(p, { qty: 1, option_ids: [], option_names: [], price_delta: 0, notes: "" });
  }

  // Lector de código de barras: escribe el código y presiona Enter
  function onSearchEnter() {
    const code = q.trim();
    if (!code) return;
    for (const p of products) {
      const v = p.product_variants?.find((x) => x.barcode === code || x.sku === code);
      if (v) { addLine(p, { variant: v, qty: 1, option_ids: [], option_names: [], price_delta: 0, notes: "" }); setQ(""); return; }
      if (p.barcode === code || p.sku === code) { tapProduct(p); setQ(""); return; }
    }
    if (filtered.length === 1) { tapProduct(filtered[0]); setQ(""); }
  }

  const cartTotal = cart.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const items = order?.order_items.filter((i) => i.status === "active") ?? [];
  const voided = order?.order_items.filter((i) => i.status === "voided") ?? [];

  const payload = () => cart.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, qty: l.qty, option_ids: l.option_ids, notes: l.notes }));

  /** Guarda el carrito (crea el pedido o agrega a uno existente) y envía a estaciones */
  async function save(send = true): Promise<string | null> {
    if (cart.length === 0) return orderId;
    setBusy(true);
    let id = orderId;
    if (!id) {
      const { data, error } = await sb.rpc("pos_create_order", {
        p_business: businessId, p_channel: tableId ? "table" : channel, p_items: payload(), p_table: tableId || null,
        p_customer: customer?.id ?? null, p_customer_name: customer?.full_name ?? null, p_send: send,
      });
      if (error) { setBusy(false); toast("error", errMsg(error)); return null; }
      id = data as string;
      setOrderId(id);
      router.replace(`/pos?order=${id}`);
    } else {
      const { error } = await sb.rpc("pos_add_items", { p_order: id, p_items: payload(), p_send: send });
      if (error) { setBusy(false); toast("error", errMsg(error)); return null; }
    }
    setCart([]);
    await loadOrder(id);
    setBusy(false);
    const kitchen = cart.some((l) => l.unit_kind === "gastronomy");
    toast("success", kitchen && send ? "Pedido enviado a preparación" : "Pedido guardado");
    return id;
  }

  async function charge() {
    const id = await save(true);
    if (!id) return;
    await loadOrder(id);
    setModal("pay");
  }

  function newSale() {
    setCart([]); setOrderId(null); setOrder(null); setCustomer(null); setTableId(""); router.replace("/pos");
    searchRef.current?.focus();
  }

  async function rpc(fn: string, args: Record<string, unknown>, ok?: string) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) { toast("error", errMsg(error)); return null; }
    if (ok) toast("success", ok);
    await loadOrder(orderId);
    return data ?? true;
  }

  if (loading) return <PageLoader />;
  const due = order ? Number(order.total) + Number(order.tip) - Number(order.paid_total) : 0;

  return (
    <div className="-mx-4 -my-6 grid h-[calc(100vh-3.5rem)] grid-cols-1 overflow-hidden sm:-mx-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* Catálogo */}
      <section className="flex min-h-0 flex-col border-r border-stone-line">
        <div className="space-y-3 border-b border-stone-line bg-white/60 p-4">
          <div className="relative">
            <Search className="absolute top-2.5 left-3 text-charcoal/40" size={18} />
            <input ref={searchRef} className="input !pl-10 !pr-10" placeholder="Buscar por nombre, código o escanear código de barras…" value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSearchEnter()} autoFocus />
            <ScanBarcode className="absolute top-2.5 right-3 text-charcoal/40" size={18} />
          </div>
          <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setCat("")} className={clsx("chip shrink-0 border !px-3 !py-1.5", !cat ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>Todo</button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)}
                className={clsx("chip shrink-0 border !px-3 !py-1.5", cat === c.id ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>
                {unitKind(c.business_unit_id) === "shop" ? <Store size={12} /> : <Utensils size={12} />}{c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtered.map((p) => {
            const shop = unitKind(p.business_unit_id) === "shop";
            const stock = p.stock_mode === "variant" ? (p.product_variants ?? []).reduce((s, v) => s + Number(v.stock), 0) : null;
            return (
              <button key={p.id} onClick={() => tapProduct(p)}
                className={clsx("card group flex flex-col overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-md", !p.is_available && "opacity-50")}>
                <div className="relative aspect-[4/3] bg-sand-50">
                  {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> :
                    <div className="flex h-full items-center justify-center text-sand">{shop ? <Store size={28} /> : <Utensils size={28} />}</div>}
                  <span className={clsx("chip absolute top-2 left-2", shop ? "bg-charcoal text-sand" : "bg-burgundy text-white")}>{shop ? "Tienda" : "Gastronomía"}</span>
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                  <span className="mt-auto pt-1 text-sm font-semibold text-burgundy">{money(p.price)}</span>
                  {stock !== null && <span className={clsx("text-xs", stock <= 0 ? "text-red-700" : "text-charcoal/50")}>{stock} en existencia</span>}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && <p className="col-span-full py-10 text-center text-sm text-charcoal/50">
            {products.length === 0 ? "Aún no hay productos. Créelos en Catálogo." : "Sin resultados"}</p>}
        </div>
      </section>

      {/* Cuenta */}
      <aside className="flex min-h-0 flex-col bg-white">
        <div className="flex items-center gap-2 border-b border-stone-line p-3">
          <div className="flex-1">
            <div className="font-display text-xl font-semibold">{order ? `Pedido #${order.number}` : "Nueva venta"}</div>
            {order && <div className="flex items-center gap-2 text-xs text-charcoal/60"><StatusBadge status={order.status} /> {time(order.created_at)}</div>}
          </div>
          <button className="btn-ghost !p-2" title="Pedidos abiertos" onClick={() => setModal("orders")}><ListOrdered size={18} /><span className="text-xs">{openOrders.length}</span></button>
          {order && <button className="btn-ghost !p-2" title="Nueva venta" onClick={newSale}><X size={18} /></button>}
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-stone-line p-3">
          <select className="input" value={tableId} disabled={!!order} onChange={(e) => setTableId(e.target.value)} aria-label="Mesa">
            <option value="">{channel === "pickup" ? "Para llevar" : "Mostrador"}</option>
            {tables.map((t) => <option key={t.id} value={t.id}>Mesa {t.number}{t.status !== "available" ? " · ocupada" : ""}</option>)}
          </select>
          {!order && !tableId ? (
            <select className="input" value={channel} onChange={(e) => setChannel(e.target.value as "counter" | "pickup")} aria-label="Tipo">
              <option value="counter">Consumo en mostrador</option><option value="pickup">Para llevar</option>
            </select>
          ) : <div />}
          <button className="btn-secondary col-span-2 justify-start" onClick={() => setModal("customer")} disabled={!!order}>
            <UserRound size={16} /> {customer?.full_name ?? order?.customer_name ?? "Asociar cliente (opcional)"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length > 0 && (
            <div className="border-b border-stone-line">
              <div className="px-3 pt-3 text-[10px] font-semibold tracking-[0.2em] text-charcoal/50 uppercase">En la cuenta</div>
              {items.map((i) => (
                <div key={i.id} className="flex gap-2 px-3 py-2 text-sm">
                  <span className="w-6 text-right font-medium">{Number(i.qty)}</span>
                  <div className="flex-1">
                    <div className="flex justify-between gap-2"><span>{i.name}</span><span>{money(i.line_total)}</span></div>
                    <div className="text-xs text-charcoal/55">
                      {[i.variant_label, i.modifiers?.map((m) => m.name).join(", "), i.notes].filter(Boolean).join(" · ")}
                      {Number(i.discount) > 0 && <span className="text-burgundy"> · desc. {money(i.discount)}</span>}
                      {unitKind(i.business_unit_id) === "shop" ? <span> · Tienda</span> : i.ticket_id ? <span> · enviado</span> : <span className="text-amber-700"> · sin enviar</span>}
                    </div>
                  </div>
                  {!order?.finalized && (
                    <div className="flex flex-col gap-1">
                      <button className="text-charcoal/40 hover:text-red-700" title="Anular" onClick={() => setVoidItem(i)}><Ban size={15} /></button>
                      {can("pos.discount") && <button className="text-charcoal/40 hover:text-burgundy" title="Descuento" onClick={async () => {
                        const v = prompt("Descuento para esta línea (valor en pesos o porcentaje con %):", "10%");
                        if (!v) return;
                        const reason = prompt("Motivo o promoción:") ?? "";
                        const pct = v.trim().endsWith("%") ? Number(v.replace("%", "")) : null;
                        await rpc("pos_discount_item", { p_item: i.id, p_amount: pct === null ? Number(v) : null, p_pct: pct, p_reason: reason || "Descuento", p_promotion: null }, "Descuento aplicado");
                      }}><Percent size={15} /></button>}
                    </div>
                  )}
                </div>
              ))}
              {voided.length > 0 && <details className="px-3 pb-2 text-xs text-charcoal/50"><summary>{voided.length} anulados</summary>
                {voided.map((i) => <div key={i.id} className="line-through">{Number(i.qty)} × {i.name} — {i.void_reason}</div>)}</details>}
            </div>
          )}

          {cart.length > 0 && <div className="px-3 pt-3 text-[10px] font-semibold tracking-[0.2em] text-burgundy uppercase">Por agregar</div>}
          {cart.map((l) => (
            <div key={l.key} className="flex items-start gap-2 px-3 py-2 text-sm animate-fade-in">
              <div className="flex-1">
                <div className="flex justify-between gap-2"><span>{l.name}</span><span>{money(l.qty * l.unit_price)}</span></div>
                <div className="text-xs text-charcoal/55">{[l.variant_label, l.option_names.join(", "), l.notes].filter(Boolean).join(" · ")}
                  {l.unit_kind === "shop" && " · Tienda (no va a cocina)"}</div>
              </div>
              <div className="flex items-center gap-1">
                <button className="btn-secondary !p-1" onClick={() => setCart((s) => s.map((x) => x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}><Minus size={14} /></button>
                <span className="w-6 text-center">{l.qty}</span>
                <button className="btn-secondary !p-1" onClick={() => setCart((s) => s.map((x) => x.key === l.key ? { ...x, qty: x.qty + 1 } : x))}><Plus size={14} /></button>
                <button className="btn-ghost !p-1 text-charcoal/40" onClick={() => setCart((s) => s.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {cart.length === 0 && items.length === 0 && <p className="px-6 py-16 text-center text-sm text-charcoal/50">Agregue productos de gastronomía y de tienda a la misma cuenta.</p>}
        </div>

        <div className="space-y-2 border-t border-stone-line p-3">
          {order && <div className="flex justify-between text-sm"><span>Cuenta</span><span>{money(order.total)}</span></div>}
          {order && Number(order.paid_total) > 0 && <div className="flex justify-between text-sm text-emerald-700"><span>Abonado</span><span>{money(order.paid_total)}</span></div>}
          {cart.length > 0 && <div className="flex justify-between text-sm text-burgundy"><span>Por agregar</span><span>{money(cartTotal)}</span></div>}
          <div className="flex justify-between text-lg font-semibold"><span>Total</span><span>{money((order ? due : 0) + cartTotal)}</span></div>

          {order && !order.finalized && (
            <div className="flex flex-wrap gap-1">
              {can("pos.discount") && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setModal("discount")}><Percent size={14} /> Descuento</button>}
              <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setModal("split")} disabled={items.length < 2 || Number(order.paid_total) > 0}><Split size={14} /> Dividir</button>
              {can("pos.merge") && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setModal("merge")}><Merge size={14} /> Unificar</button>}
              {can("pos.cancel") && Number(order.paid_total) === 0 && <button className="btn-ghost !px-2 !py-1 text-xs text-red-700" onClick={() => setVoidItem({ id: "__order__" } as OrderItem)}><Ban size={14} /> Anular pedido</button>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary" disabled={busy || cart.length === 0} onClick={() => save(true)}><Send size={16} /> {order ? "Agregar" : "Guardar"}</button>
            {order?.finalized ? (
              <button className="btn-primary" onClick={() => setModal("receipt")}><ReceiptIcon size={16} /> Comprobante</button>
            ) : (
              <button className="btn-primary" disabled={busy || !can("pos.charge") || (cart.length === 0 && !order)} onClick={charge}><CreditCard size={16} /> Cobrar</button>
            )}
          </div>
          {order?.finalized && <button className="btn-ghost w-full" onClick={newSale}>Nueva venta</button>}
        </div>
      </aside>

      <ProductOptions product={picking} open={!!picking} onClose={() => setPicking(null)} onAdd={(r) => picking && addLine(picking, r)} />

      {order && modal === "pay" && (
        <PaymentModal order={order} open onClose={() => setModal(null)} methods={methods} sessions={sessions} units={units} canTip
          onDone={async (fin, change) => {
            setLastChange(change); await loadOrder(order.id); loadOpen();
            if (fin) { toast("success", "Pago registrado. Ingresos distribuidos por unidad."); setModal("receipt"); }
            else { toast("success", "Abono registrado"); setModal(null); }
          }} />
      )}
      {order && modal === "receipt" && <Receipt order={order} open onClose={() => setModal(null)} business={current!.business} units={units} change={lastChange} />}

      {order && modal === "split" && <SplitModal order={order} onClose={() => setModal(null)} onSplit={async (ids) => {
        const newId = await rpc("pos_split_order", { p_order: order.id, p_items: ids }, "Cuenta dividida");
        setModal(null);
        if (newId && confirm("¿Abrir la nueva cuenta para cobrarla?")) { setOrderId(newId as string); router.replace(`/pos?order=${newId}`); }
      }} />}
      {order && modal === "merge" && (
        <Modal open onClose={() => setModal(null)} title="Unificar con otra cuenta">
          <p className="mb-3 text-sm text-charcoal/60">Los productos de la cuenta seleccionada pasarán a la cuenta #{order.number}. Solo cuentas sin pagos.</p>
          <div className="space-y-2">{openOrders.filter((o) => o.id !== order.id).map((o) => (
            <button key={o.id} className="btn-secondary w-full justify-between" onClick={async () => { await rpc("pos_merge_orders", { p_target: order.id, p_source: o.id }, "Cuentas unificadas"); setModal(null); loadOpen(); }}>
              <span>#{o.number} {o.dining_tables ? `· Mesa ${o.dining_tables.number}` : ""} {o.customer_name ?? ""}</span><span>{money(o.total)}</span>
            </button>))}</div>
        </Modal>
      )}
      {order && modal === "discount" && (
        <Modal open onClose={() => setModal(null)} title="Descuento a toda la cuenta">
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
            await rpc("pos_discount_order", { p_order: order.id, p_pct: Number(f.get("pct")), p_reason: String(f.get("reason")) }, "Descuento aplicado"); setModal(null); }}>
            <div><label className="label">Porcentaje</label><input name="pct" type="number" min={0} max={100} step="0.5" required className="input" /></div>
            <div><label className="label">Motivo o promoción</label><input name="reason" required minLength={3} className="input" /></div>
            <p className="text-xs text-charcoal/50">El descuento se aplica por línea, así se descuenta correctamente de cada unidad de negocio.</p>
            <button className="btn-primary w-full">Aplicar</button>
          </form>
        </Modal>
      )}
      {modal === "customer" && <CustomerPicker businessId={businessId} onClose={() => setModal(null)} onPick={(c) => { setCustomer(c); setModal(null); }} />}
      {modal === "orders" && (
        <Modal open onClose={() => setModal(null)} title="Pedidos abiertos">
          {openOrders.length === 0 ? <p className="text-sm text-charcoal/50">No hay pedidos abiertos</p> :
            <div className="space-y-2">{openOrders.map((o) => (
              <button key={o.id} className="btn-secondary w-full justify-between" onClick={() => { setCart([]); setOrderId(o.id); router.replace(`/pos?order=${o.id}`); setModal(null); }}>
                <span className="flex items-center gap-2">#{o.number} <StatusBadge status={o.status} /> {o.dining_tables ? `Mesa ${o.dining_tables.number}` : o.channel === "delivery" ? "Domicilio" : o.channel === "pickup" ? "Para llevar" : "Mostrador"} {o.customer_name}</span>
                <span>{money(o.total)}</span>
              </button>))}</div>}
        </Modal>
      )}
      <ReasonModal open={!!voidItem} title={voidItem?.id === "__order__" ? "Anular pedido" : `Anular ${voidItem?.name ?? ""}`} onClose={() => setVoidItem(null)}
        onConfirm={async (reason) => {
          if (voidItem?.id === "__order__") { await rpc("order_cancel", { p_order: orderId, p_reason: reason }, "Pedido anulado"); loadOpen(); }
          else await rpc("pos_void_item", { p_item: voidItem!.id, p_reason: reason }, "Producto anulado");
          setVoidItem(null);
        }} />
    </div>
  );
}

function SplitModal({ order, onClose, onSplit }: { order: Order; onClose: () => void; onSplit: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const items = order.order_items.filter((i) => i.status === "active");
  const sum = items.filter((i) => sel.includes(i.id)).reduce((s, i) => s + Number(i.line_total), 0);
  return (
    <Modal open onClose={onClose} title="Dividir cuenta"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={sel.length === 0 || sel.length === items.length} onClick={() => onSplit(sel)}>Pasar a nueva cuenta · {money(sum)}</button></>}>
      <p className="mb-3 text-sm text-charcoal/60">Seleccione los productos que irán en una cuenta separada.</p>
      {items.map((i) => (
        <label key={i.id} className="flex items-center gap-3 border-b border-stone-line py-2 text-sm">
          <input type="checkbox" checked={sel.includes(i.id)} onChange={(e) => setSel((s) => e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id))} />
          <span className="flex-1">{Number(i.qty)} × {i.name}</span><span>{money(i.line_total)}</span>
        </label>
      ))}
    </Modal>
  );
}

function CustomerPicker({ businessId, onClose, onPick }: { businessId: string; onClose: () => void; onPick: (c: { id: string; full_name: string }) => void }) {
  const sb = supabaseBrowser();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [list, setList] = useState<{ id: string; full_name: string; phone: string | null }[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) return setList([]);
      const s = q.trim().replace(/[%,]/g, "");
      const { data } = await sb.from("customers").select("id, full_name, phone").eq("business_id", businessId)
        .or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,document.ilike.%${s}%`).limit(10);
      setList(data ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q, sb, businessId]);
  return (
    <Modal open onClose={onClose} title="Cliente">
      <input className="input" placeholder="Buscar por nombre, teléfono o documento" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="mt-2 space-y-1">{list.map((c) => <button key={c.id} className="btn-ghost w-full justify-between" onClick={() => onPick(c)}><span>{c.full_name}</span><span className="text-xs">{c.phone}</span></button>)}</div>
      <form className="mt-4 space-y-2 border-t border-stone-line pt-4" onSubmit={async (e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        const { data, error } = await sb.from("customers").insert({ business_id: businessId, full_name: String(f.get("name")).trim(), phone: String(f.get("phone")).trim() || null }).select("id, full_name").single();
        if (error) toast("error", error.code === "23505" ? "Ya existe un cliente con ese teléfono" : errMsg(error)); else onPick(data);
      }}>
        <div className="text-sm font-medium">Registrar cliente nuevo</div>
        <div className="grid grid-cols-2 gap-2"><input name="name" required className="input" placeholder="Nombre" /><input name="phone" className="input" placeholder="Teléfono" /></div>
        <button className="btn-secondary w-full">Registrar y asociar</button>
      </form>
    </Modal>
  );
}

export default function POSPage() {
  return <Suspense fallback={<PageLoader />}><POS /></Suspense>;
}

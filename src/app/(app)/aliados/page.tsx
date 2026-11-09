"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Store, Plus, Pencil, Truck, ShoppingBag, Undo2, Banknote, Ban } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePaymentMethods } from "@/lib/hooks";
import { money, num, dateTime, daysAgo, today, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, Stat, Empty, Spinner } from "@/components/ui/bits";
import { Modal, ReasonModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Outlet = {
  id: string; name: string; contact_name: string | null; phone: string | null; address: string | null; commission_pct: number; notes: string | null; active: boolean;
  delivered: number; sold: number; returned: number; on_hand: number; sales_total: number; receivable_total: number;
  sales_range: number; receivable_range: number; paid_total: number; balance: number;
};
type StockRow = { variant_id: string; product: string; variant: string; price: number; delivered: number; sold: number; returned: number; on_hand: number };
type Mov = { id: string; kind: "delivery" | "sale" | "return"; qty: number; unit_price: number; commission_pct: number; amount: number; receivable: number; note: string | null;
  status: string; void_reason: string | null; created_at: string; product: string; variant: string };
type Pay = { id: string; amount: number; reference: string | null; notes: string | null; status: string; void_reason: string | null; created_at: string; method: string | null };
type Detail = { outlet: Outlet; balance: number; stock: StockRow[]; movements: Mov[]; payments: Pay[] };
type Var = { id: string; label: string; price: number; stock: number };

const KIND: Record<Mov["kind"], string> = { delivery: "Entrega", sale: "Venta reportada", return: "Devolución" };
const tz = "T00:00:00-05:00";
const iso = (d: string, plusDay = false) => new Date(new Date(d + tz).getTime() + (plusDay ? 86400000 : 0)).toISOString();

export default function OutletsPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, can } = useApp();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Outlet[] | null>(null);
  const [edit, setEdit] = useState<Outlet | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const manage = can("inventory.manage");

  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("outlet_summary", { p_business: businessId, p_from: iso(from), p_to: iso(to, true) });
    if (error) { toast("error", errMsg(error)); setRows([]); } else setRows((data ?? []) as Outlet[]);
  }, [sb, businessId, from, to, toast]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  if (!rows) return <PageLoader />;
  const total = (k: keyof Outlet) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Establecimientos aliados" subtitle="Lo que se entrega a cada establecimiento, lo que vende y lo que debe pagar (menos su porcentaje)"
        actions={<div className="flex flex-wrap gap-2">
          <input type="date" className="input !w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
          <input type="date" className="input !w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
          {manage && <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={16} /> Establecimiento</button>}
        </div>} />
      {rows.length === 0 ? (
        <Empty icon={<Store size={40} />} title="Aún no hay establecimientos" text="Agregue los lugares a los que lleva sus productos (por ejemplo Rupícola o La Reserva) con el porcentaje que se queda cada uno."
          action={manage ? <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={16} /> Agregar establecimiento</button> : undefined} />
      ) : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat tone="burgundy" label="Por cobrar" value={money(total("balance"))} hint={`${rows.length} establecimientos`} icon={<Store size={18} />} />
          <Stat label="Ventas reportadas" value={money(total("sales_range"))} hint="En el período" />
          <Stat label="Le corresponde a la marca" value={money(total("receivable_range"))} hint="En el período, ya sin el %" />
          <Stat label="Unidades en establecimientos" value={num(total("on_hand"))} hint="Entregadas y sin vender" />
        </div>
        <div className="card mt-4 overflow-x-auto"><table className="table-base">
          <thead><tr><th>Establecimiento</th><th className="text-right">%</th><th className="text-right">Entregado</th><th className="text-right">Vendido</th><th className="text-right">Devuelto</th>
            <th className="text-right">Tiene</th><th className="text-right">Por cobrar total</th><th className="text-right">Abonado</th><th className="text-right">Saldo</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={clsx("cursor-pointer hover:bg-sand-50", !r.active && "opacity-60")} onClick={() => setOpen(r.id)}>
              <td className="font-medium">{r.name}{r.phone && <div className="text-xs font-normal text-charcoal/60">{r.contact_name ? `${r.contact_name} · ` : ""}{r.phone}</div>}</td>
              <td className="text-right">{num(r.commission_pct, 2)}</td><td className="text-right">{num(r.delivered)}</td><td className="text-right">{num(r.sold)}</td>
              <td className="text-right">{num(r.returned)}</td><td className="text-right font-medium">{num(r.on_hand)}</td><td className="text-right">{money(r.receivable_total)}</td>
              <td className="text-right">{money(r.paid_total)}</td><td className={clsx("text-right font-semibold", Number(r.balance) > 0 && "text-burgundy")}>{money(r.balance)}</td>
              <td className="flex gap-1">{manage && <button className="btn-ghost !p-1.5" title="Editar" onClick={(e) => { e.stopPropagation(); setEdit(r); }}><Pencil size={15} /></button>}</td></tr>))}</tbody>
        </table></div>
      </>)}

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit === "new" ? "Nuevo establecimiento" : `Editar ${edit.name}`} footer={<button form="olf" className="btn-primary">Guardar</button>}>
          <form id="olf" className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
            e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            const pct = Number(f.commission_pct || 0);
            if (pct < 0 || pct > 100) return toast("error", "El porcentaje debe estar entre 0 y 100");
            const row = { business_id: businessId, name: f.name.trim(), contact_name: f.contact_name || null, phone: f.phone || null, address: f.address || null,
              commission_pct: pct, notes: f.notes || null, active: f.active === "on" };
            const { error } = edit === "new" ? await sb.from("outlets").insert(row) : await sb.from("outlets").update(row).eq("id", edit.id);
            if (error) toast("error", errMsg(error).includes("duplicate") ? "Ya existe un establecimiento con ese nombre" : errMsg(error)); else { setEdit(null); load(); }
          }}>
            <div className="col-span-2"><label className="label">Nombre</label><input name="name" required defaultValue={edit === "new" ? "" : edit.name} className="input" placeholder="La Reserva" /></div>
            <div><label className="label">% que se queda el establecimiento</label><input name="commission_pct" type="number" step="0.01" min={0} max={100} required defaultValue={edit === "new" ? 10 : edit.commission_pct} className="input" /></div>
            <div><label className="label">Contacto</label><input name="contact_name" defaultValue={edit === "new" ? "" : edit.contact_name ?? ""} className="input" /></div>
            <div><label className="label">Teléfono</label><input name="phone" defaultValue={edit === "new" ? "" : edit.phone ?? ""} className="input" /></div>
            <div><label className="label">Dirección</label><input name="address" defaultValue={edit === "new" ? "" : edit.address ?? ""} className="input" /></div>
            <div className="col-span-2"><label className="label">Notas</label><input name="notes" defaultValue={edit === "new" ? "" : edit.notes ?? ""} className="input" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={edit === "new" ? true : edit.active} /> Activo</label>
            <p className="col-span-2 text-xs text-charcoal/60">El porcentaje se aplica a las ventas que se registren desde ahora; las ya registradas conservan el suyo.</p>
          </form>
        </Modal>
      )}
      {open && <OutletDetail id={open} manage={manage} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function OutletDetail({ id, manage, onClose, onChanged }: { id: string; manage: boolean; onClose: () => void; onChanged: () => void }) {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId } = useApp();
  const methods = usePaymentMethods(businessId);
  const [d, setD] = useState<Detail | null>(null);
  const [vars, setVars] = useState<Var[]>([]);
  const [tab, setTab] = useState<"stock" | "movements" | "payments">("stock");
  const [move, setMove] = useState<Mov["kind"] | null>(null);
  const [pay, setPay] = useState(false);
  const [voidMov, setVoidMov] = useState<Mov | null>(null);
  const [voidPay, setVoidPay] = useState<Pay | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("outlet_detail", { p_outlet: id });
    if (error) toast("error", errMsg(error)); else setD(data as Detail);
    const v = await sb.from("product_variants").select("id, size, color, design, price, stock, products!inner(name, price, active)")
      .eq("business_id", businessId).eq("active", true).eq("products.active", true);
    type V = { id: string; size: string | null; color: string | null; design: string | null; price: number | null; stock: number; products: { name: string; price: number } };
    setVars(((v.data ?? []) as unknown as V[]).map((x) => ({ id: x.id, label: [x.products.name, [x.size, x.color, x.design].filter(Boolean).join(" / ")].filter(Boolean).join(" · "),
      price: Number(x.price ?? x.products.price), stock: Number(x.stock) })).sort((a, b) => a.label.localeCompare(b.label)));
  }, [sb, id, businessId, toast]);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onChanged(); };
  const pct = Number(d?.outlet.commission_pct ?? 0);

  // Filas para el formulario de movimiento
  const lines: { id: string; label: string; price: number; avail: number }[] = !d || !move ? [] :
    move === "delivery" ? vars.map((v) => ({ id: v.id, label: v.label, price: v.price, avail: v.stock }))
      : d.stock.filter((s) => Number(s.on_hand) > 0).map((s) => ({ id: s.variant_id, label: [s.product, s.variant].filter(Boolean).join(" · "), price: Number(s.price), avail: Number(s.on_hand) }));

  return (
    <Modal open wide onClose={onClose} title={d ? `${d.outlet.name} · ${num(pct, 2)} %` : "Establecimiento"}
      footer={d && manage && <>
        <span className="mr-auto self-center text-sm">Por cobrar: <b className="text-burgundy">{money(d.balance)}</b></span>
        <button className="btn-secondary" onClick={() => setMove("delivery")}><Truck size={16} /> Entregar</button>
        <button className="btn-secondary" onClick={() => setMove("sale")} disabled={!d.stock.some((s) => Number(s.on_hand) > 0)}><ShoppingBag size={16} /> Venta</button>
        <button className="btn-secondary" onClick={() => setMove("return")} disabled={!d.stock.some((s) => Number(s.on_hand) > 0)}><Undo2 size={16} /> Devolución</button>
        <button className="btn-primary" onClick={() => setPay(true)} disabled={Number(d.balance) <= 0}><Banknote size={16} /> Abono</button>
      </>}>
      {!d ? <div className="flex h-40 items-center justify-center"><Spinner /></div> : (<>
        <div className="mb-3 flex gap-2">{([["stock", "Qué tiene"], ["movements", "Movimientos"], ["payments", "Abonos"]] as const).map(([k, l]) =>
          <button key={k} onClick={() => setTab(k)} className={clsx("chip border !px-3 !py-1.5", tab === k ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{l}</button>)}</div>
        {tab === "stock" && (d.stock.length === 0 ? <p className="py-6 text-center text-sm text-charcoal/60">Aún no se le ha entregado nada. Use “Entregar”.</p> : (
          <table className="table-base"><thead><tr><th>Producto</th><th className="text-right">Entregado</th><th className="text-right">Vendido</th><th className="text-right">Devuelto</th><th className="text-right">Tiene</th></tr></thead>
            <tbody>{d.stock.map((s) => <tr key={s.variant_id}><td>{s.product}{s.variant && <span className="text-charcoal/60"> · {s.variant}</span>}</td>
              <td className="text-right">{num(s.delivered)}</td><td className="text-right">{num(s.sold)}</td><td className="text-right">{num(s.returned)}</td><td className="text-right font-medium">{num(s.on_hand)}</td></tr>)}</tbody></table>))}
        {tab === "movements" && (d.movements.length === 0 ? <p className="py-6 text-center text-sm text-charcoal/60">Sin movimientos.</p> : (
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th className="text-right">Cant.</th><th className="text-right">Venta</th><th className="text-right">Por cobrar</th><th></th></tr></thead>
            <tbody>{d.movements.map((m) => <tr key={m.id} className={m.status === "voided" ? "opacity-60" : ""}>
              <td>{dateTime(m.created_at)}</td><td>{KIND[m.kind]}{m.status === "voided" && <div className="text-xs text-red-700">Anulado: {m.void_reason}</div>}{m.note && <div className="text-xs text-charcoal/60">{m.note}</div>}</td>
              <td>{m.product}{m.variant && ` · ${m.variant}`}</td><td className="text-right">{num(m.qty)}</td>
              <td className="text-right">{m.kind === "sale" ? money(m.amount) : "—"}</td><td className="text-right">{m.kind === "sale" ? <>{money(m.receivable)}<div className="text-[10px] text-charcoal/50">{num(m.commission_pct, 2)} % para el aliado</div></> : "—"}</td>
              <td>{manage && m.status === "active" && <button className="btn-ghost !p-1.5 text-red-700" title="Anular" onClick={() => setVoidMov(m)}><Ban size={15} /></button>}</td></tr>)}</tbody></table></div>))}
        {tab === "payments" && (d.payments.length === 0 ? <p className="py-6 text-center text-sm text-charcoal/60">Sin abonos.</p> : (
          <table className="table-base"><thead><tr><th>Fecha</th><th>Medio</th><th>Referencia</th><th className="text-right">Valor</th><th>Estado</th><th></th></tr></thead>
            <tbody>{d.payments.map((p) => <tr key={p.id} className={p.status === "voided" ? "opacity-60" : ""}><td>{dateTime(p.created_at)}</td><td>{p.method}</td>
              <td>{p.reference ?? "—"}{p.notes && <div className="text-xs text-charcoal/60">{p.notes}</div>}</td><td className="text-right">{money(p.amount)}</td>
              <td>{p.status === "voided" ? <span className="text-xs text-red-700">Anulado: {p.void_reason}</span> : "Activo"}</td>
              <td>{manage && p.status === "active" && <button className="btn-ghost !p-1.5 text-red-700" title="Anular" onClick={() => setVoidPay(p)}><Ban size={15} /></button>}</td></tr>)}</tbody></table>))}
      </>)}

      {d && move && (
        <Modal open wide onClose={() => setMove(null)} title={`${KIND[move]} · ${d.outlet.name}`}
          footer={<button form="omove" className="btn-primary">Registrar</button>}>
          <form id="omove" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const items = lines.map((l) => ({ variant_id: l.id, qty: Number(f.get(`q-${l.id}`) || 0), ...(move === "sale" ? { unit_price: Number(f.get(`p-${l.id}`) || l.price) } : {}) })).filter((x) => x.qty > 0);
            if (!items.length) return toast("error", "Indique al menos una cantidad");
            const { error } = await sb.rpc("outlet_move", { p_business: businessId, p_outlet: id, p_kind: move, p_items: items, p_note: f.get("note") || null });
            if (error) toast("error", errMsg(error)); else { toast("success", `${KIND[move]} registrada`); setMove(null); refresh(); }
          }}>
            <p className="text-xs text-charcoal/60">{move === "delivery" ? "Sale de su bodega y queda en el establecimiento." : move === "sale"
              ? `Lo que el establecimiento le reporta como vendido. Queda por cobrar el valor menos el ${num(pct, 2)} %.` : "Lo que el establecimiento le devuelve sin vender; vuelve a su bodega."}</p>
            <div className="max-h-[45vh] overflow-y-auto"><table className="table-base"><thead><tr><th>Producto</th><th className="text-right">{move === "delivery" ? "En bodega" : "Tiene"}</th>{move === "sale" && <th>Precio</th>}<th>Cantidad</th></tr></thead>
              <tbody>{lines.map((l) => <tr key={l.id}><td>{l.label}</td><td className="text-right">{num(l.avail)}</td>
                {move === "sale" && <td><input name={`p-${l.id}`} type="number" min={0} step="1" defaultValue={l.price} className="input !w-28 !py-1" /></td>}
                <td><input name={`q-${l.id}`} type="number" min={0} max={move === "delivery" ? undefined : l.avail} step="1" className="input !w-24 !py-1" /></td></tr>)}</tbody></table></div>
            <div><label className="label">Nota (opcional)</label><input name="note" className="input" placeholder={move === "sale" ? "Corte semanal, quién reportó…" : "Remisión, quién recibió…"} /></div>
          </form>
        </Modal>
      )}
      {d && pay && (
        <Modal open onClose={() => setPay(false)} title={`Abono de ${d.outlet.name}`} footer={<button form="opay" className="btn-primary">Registrar abono</button>}>
          <form id="opay" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { error } = await sb.rpc("outlet_payment_create", { p_business: businessId, p_outlet: id, p_amount: Number(f.get("amount")), p_method: f.get("method"),
              p_reference: f.get("ref") || null, p_notes: f.get("notes") || null });
            if (error) toast("error", errMsg(error)); else { toast("success", "Abono registrado"); setPay(false); refresh(); }
          }}>
            <div><label className="label">Valor (máximo {money(d.balance)})</label><input name="amount" type="number" min={1} max={Number(d.balance)} step="1" required defaultValue={Number(d.balance)} className="input" /></div>
            <div><label className="label">Medio de pago</label><select name="method" className="input">{methods.filter((m) => !m.gateway && m.code !== "points").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            <div><label className="label">Referencia</label><input name="ref" className="input" /></div>
            <div><label className="label">Notas</label><input name="notes" className="input" /></div>
          </form>
        </Modal>
      )}
      <ReasonModal open={!!voidMov} title={`Anular ${voidMov ? KIND[voidMov.kind].toLowerCase() : ""}`} onClose={() => setVoidMov(null)} onConfirm={async (r) => {
        const { error } = await sb.rpc("outlet_move_void", { p_movement: voidMov!.id, p_reason: r });
        if (error) toast("error", errMsg(error)); else { toast("success", "Movimiento anulado"); setVoidMov(null); refresh(); }
      }} />
      <ReasonModal open={!!voidPay} title="Anular abono" onClose={() => setVoidPay(null)} onConfirm={async (r) => {
        const { error } = await sb.rpc("outlet_payment_void", { p_payment: voidPay!.id, p_reason: r });
        if (error) toast("error", errMsg(error)); else { toast("success", "Abono anulado"); setVoidPay(null); refresh(); }
      }} />
    </Modal>
  );
}

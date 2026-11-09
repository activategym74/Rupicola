"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { HandCoins, PackagePlus, Undo2, Banknote, Ban } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePaymentMethods, useOpenSessions } from "@/lib/hooks";
import { money, num, dateTime, daysAgo, today, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, Stat, Empty, Spinner } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Row = {
  id: string; name: string; commission_pct: number; show_in_dashboard: boolean; active: boolean; phone: string | null; contact_name: string | null;
  received: number; returned: number; sold: number; pending_units: number; sales_total: number; owed_total: number; paid_total: number; balance: number;
  sales_range: number; commission_range: number; owed_range: number; sold_range: number;
};
type Item = { variant_id: string; category: string; product: string; variant: string; price: number; received: number; returned: number; sold: number; pending: number; sales: number; owed: number };
type Payment = { id: string; amount: number; reference: string | null; notes: string | null; status: string; void_reason: string | null; created_at: string; cash_session_id: string | null; method: string | null };
type Movement = { id: string; kind: string; qty: number; reason: string | null; created_at: string; product: string; variant: string };
type Detail = { supplier: { id: string; name: string; commission_pct: number }; balance: number; items: Item[]; payments: Payment[]; movements: Movement[] };

const tz = "T00:00:00-05:00";
const iso = (d: string, plusDay = false) => new Date(new Date(d + tz).getTime() + (plusDay ? 86400000 : 0)).toISOString();

export default function ConsignmentPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId } = useApp();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("consignment_summary", { p_business: businessId, p_from: iso(from), p_to: iso(to, true) });
    if (error) { toast("error", errMsg(error)); setRows([]); } else setRows((data ?? []) as Row[]);
  }, [sb, businessId, from, to, toast]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  if (!rows) return <PageLoader />;

  const total = (k: keyof Row) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return (
    <div className="animate-fade-in">
      <PageHeader title="Por pagar a proveedores" subtitle="Productos en consignación: se le paga a cada proveedor solo lo vendido, menos su porcentaje"
        actions={<div className="flex flex-wrap gap-2">
          <input type="date" className="input !w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
          <input type="date" className="input !w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
        </div>} />
      {rows.length === 0 ? (
        <Empty icon={<HandCoins size={40} />} title="Aún no hay proveedores en consignación"
          text="En Compras y proveedores, edite un proveedor, marque “Trabaja en consignación” y ponga su porcentaje. Luego asígnelo a sus productos en el Catálogo."
          action={<Link href="/compras" className="btn-primary">Ir a proveedores</Link>} />
      ) : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat tone="burgundy" label="Total por pagar" value={money(total("balance"))} hint={`${rows.length} proveedores`} icon={<HandCoins size={18} />} />
          <Stat label="Vendido en el período" value={money(total("sales_range"))} hint={`${num(total("sold_range"))} unidades`} />
          <Stat label="Comisión del negocio" value={money(total("commission_range"))} hint="En el período" />
          <Stat label="Unidades por vender" value={num(total("pending_units"))} hint="Recibidas y aún sin vender" />
        </div>
        <div className="card mt-4 overflow-x-auto"><table className="table-base">
          <thead><tr><th>Proveedor</th><th className="text-right">%</th><th className="text-right">Recibido</th><th className="text-right">Vendido</th><th className="text-right">Devuelto</th>
            <th className="text-right">Por vender</th><th className="text-right">Vendido período</th><th className="text-right">Le corresponde</th><th className="text-right">Pagado</th><th className="text-right">Saldo</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={clsx("cursor-pointer hover:bg-sand-50", !r.active && "opacity-60")} onClick={() => setOpen(r.id)}>
              <td className="font-medium">{r.name}{r.show_in_dashboard && <span className="chip ml-2 bg-sand-50 text-[10px]">Dashboard</span>}</td>
              <td className="text-right">{num(r.commission_pct, 2)}</td><td className="text-right">{num(r.received)}</td><td className="text-right">{num(r.sold)}</td>
              <td className="text-right">{num(r.returned)}</td><td className="text-right">{num(r.pending_units)}</td><td className="text-right">{money(r.sales_range)}</td>
              <td className="text-right">{money(r.owed_total)}</td><td className="text-right">{money(r.paid_total)}</td>
              <td className={clsx("text-right font-semibold", Number(r.balance) > 0 && "text-burgundy")}>{money(r.balance)}</td>
              <td><button className="btn-ghost !px-2 !py-1 text-xs">Ver</button></td></tr>))}</tbody>
        </table></div>
        <p className="mt-3 text-xs text-charcoal/50">“Le corresponde” es lo vendido desde siempre menos el % pactado en cada venta; “Saldo” resta lo ya pagado. Si cambia el % de un proveedor, aplica a las ventas nuevas.</p>
      </>)}
      {open && <SupplierDetail id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function SupplierDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId } = useApp();
  const methods = usePaymentMethods(businessId);
  const { sessions } = useOpenSessions(businessId);
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"items" | "payments" | "movements">("items");
  const [move, setMove] = useState<"receive" | "return" | null>(null);
  const [pay, setPay] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [voidSession, setVoidSession] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("consignment_detail", { p_supplier: id });
    if (error) toast("error", errMsg(error)); else setD(data as Detail);
  }, [sb, id, toast]);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onChanged(); };

  return (
    <Modal open wide onClose={onClose} title={d ? `${d.supplier.name} · ${num(d.supplier.commission_pct, 2)} %` : "Proveedor"}
      footer={d && <>
        <span className="mr-auto self-center text-sm">Saldo por pagar: <b className="text-burgundy">{money(d.balance)}</b></span>
        <button className="btn-secondary" onClick={() => setMove("receive")}><PackagePlus size={16} /> Recibir</button>
        <button className="btn-secondary" onClick={() => setMove("return")} disabled={!d.items.some((i) => Number(i.pending) > 0)}><Undo2 size={16} /> Devolver</button>
        <button className="btn-primary" onClick={() => setPay(true)} disabled={Number(d.balance) <= 0}><Banknote size={16} /> Registrar pago</button>
      </>}>
      {!d ? <div className="flex h-40 items-center justify-center"><Spinner /></div> : (<>
        <div className="mb-3 flex gap-2">{([["items", "Productos"], ["payments", "Pagos"], ["movements", "Entradas y devoluciones"]] as const).map(([k, l]) =>
          <button key={k} onClick={() => setTab(k)} className={clsx("chip border !px-3 !py-1.5", tab === k ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{l}</button>)}</div>
        {tab === "items" && (d.items.length === 0 ? <p className="py-6 text-center text-sm text-charcoal/60">Este proveedor no tiene productos asignados. Asígnelos en el Catálogo (campo “Proveedor en consignación”).</p> : (
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Categoría</th><th>Producto</th><th className="text-right">Recibido</th><th className="text-right">Vendido</th><th className="text-right">Devuelto</th><th className="text-right">Por vender</th><th className="text-right">Ventas</th><th className="text-right">Le corresponde</th></tr></thead>
            <tbody>{d.items.map((i) => <tr key={i.variant_id}><td>{i.category}</td><td>{i.product}{i.variant && <span className="text-charcoal/60"> · {i.variant}</span>}</td>
              <td className="text-right">{num(i.received)}</td><td className="text-right">{num(i.sold)}</td><td className="text-right">{num(i.returned)}</td>
              <td className="text-right font-medium">{num(i.pending)}</td><td className="text-right">{money(i.sales)}</td><td className="text-right">{money(i.owed)}</td></tr>)}</tbody></table></div>))}
        {tab === "payments" && (d.payments.length === 0 ? <p className="py-6 text-center text-sm text-charcoal/60">Sin pagos registrados.</p> : (
          <table className="table-base"><thead><tr><th>Fecha</th><th>Medio</th><th>Referencia</th><th className="text-right">Valor</th><th>Estado</th><th></th></tr></thead>
            <tbody>{d.payments.map((p) => <tr key={p.id} className={p.status === "voided" ? "opacity-60" : ""}><td>{dateTime(p.created_at)}</td><td>{p.method}{p.cash_session_id && " · caja"}</td>
              <td>{p.reference ?? "—"}{p.notes && <div className="text-xs text-charcoal/60">{p.notes}</div>}</td><td className="text-right">{money(p.amount)}</td>
              <td>{p.status === "voided" ? <span className="text-xs text-red-700">Anulado: {p.void_reason}</span> : "Activo"}</td>
              <td>{p.status === "active" && <button className="btn-ghost !p-1.5 text-red-700" title="Anular" onClick={() => { setVoidSession(sessions[0]?.id ?? ""); setVoiding(p); }}><Ban size={15} /></button>}</td></tr>)}</tbody></table>))}
        {tab === "movements" && (d.movements.length === 0 ? <p className="py-6 text-center text-sm text-charcoal/60">Sin movimientos.</p> : (
          <table className="table-base"><thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th className="text-right">Cantidad</th><th>Nota</th></tr></thead>
            <tbody>{d.movements.map((m) => <tr key={m.id}><td>{dateTime(m.created_at)}</td><td>{m.kind === "purchase" ? "Recibido" : "Devuelto"}</td>
              <td>{m.product}{m.variant && ` · ${m.variant}`}</td><td className="text-right">{num(Math.abs(Number(m.qty)))}</td><td className="text-xs text-charcoal/60">{m.reason}</td></tr>)}</tbody></table>))}
      </>)}

      {d && move && (
        <Modal open onClose={() => setMove(null)} title={move === "receive" ? `Recibir mercancía de ${d.supplier.name}` : `Devolver a ${d.supplier.name}`}
          footer={<button form="cmove" className="btn-primary">{move === "receive" ? "Registrar entrada" : "Registrar devolución"}</button>}>
          <form id="cmove" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const items = d.items.map((i) => ({ variant_id: i.variant_id, qty: Number(f.get(i.variant_id) || 0) })).filter((x) => x.qty > 0);
            if (!items.length) return toast("error", "Indique al menos una cantidad");
            const { error } = await sb.rpc("consignment_move", { p_business: businessId, p_supplier: id, p_kind: move, p_items: items, p_note: f.get("note") || null });
            if (error) toast("error", errMsg(error)); else { toast("success", move === "receive" ? "Mercancía recibida" : "Devolución registrada"); setMove(null); refresh(); }
          }}>
            <table className="table-base"><thead><tr><th>Producto</th><th className="text-right">Por vender</th><th>Cantidad</th></tr></thead>
              <tbody>{d.items.filter((i) => move === "receive" || Number(i.pending) > 0).map((i) => <tr key={i.variant_id}>
                <td>{i.product}{i.variant && <span className="text-charcoal/60"> · {i.variant}</span>}</td><td className="text-right">{num(i.pending)}</td>
                <td><input name={i.variant_id} type="number" min={0} max={move === "return" ? Number(i.pending) : undefined} step="1" className="input !w-24 !py-1" /></td></tr>)}</tbody></table>
            <div><label className="label">Nota (opcional)</label><input name="note" className="input" placeholder={move === "receive" ? "Remisión, quién entregó…" : "Motivo de la devolución"} /></div>
          </form>
        </Modal>
      )}
      {d && pay && (
        <Modal open onClose={() => setPay(false)} title={`Pagar a ${d.supplier.name}`} footer={<button form="spay" className="btn-primary">Registrar pago</button>}>
          <form id="spay" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { error } = await sb.rpc("supplier_payment_create", { p_business: businessId, p_supplier: id, p_amount: Number(f.get("amount")), p_method: f.get("method"),
              p_session: f.get("session") || null, p_reference: f.get("ref") || null, p_notes: f.get("notes") || null });
            if (error) toast("error", errMsg(error)); else { toast("success", "Pago registrado"); setPay(false); refresh(); }
          }}>
            <div><label className="label">Valor (máximo {money(d.balance)})</label><input name="amount" type="number" min={1} max={Number(d.balance)} step="1" required defaultValue={Number(d.balance)} className="input" /></div>
            <div><label className="label">Medio de pago</label><select name="method" className="input">{methods.filter((m) => !m.gateway && m.code !== "points").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            <div><label className="label">Referencia</label><input name="ref" className="input" /></div>
            <div><label className="label">Sale de caja (opcional)</label><select name="session" className="input"><option value="">No afecta caja</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.cash_registers.name}</option>)}</select></div>
            <div><label className="label">Notas</label><input name="notes" className="input" /></div>
          </form>
        </Modal>
      )}
      {voiding && (
        <Modal open onClose={() => setVoiding(null)} title="Anular pago al proveedor"
          footer={<><button className="btn-secondary" onClick={() => setVoiding(null)}>Cancelar</button><button className="btn-danger" form="spvoid">Anular pago</button></>}>
          <form id="spvoid" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { error } = await sb.rpc("supplier_payment_void", { p_payment: voiding.id, p_reason: String(f.get("reason") || "").trim(), p_session: voiding.cash_session_id ? (voidSession || null) : null });
            if (error) toast("error", errMsg(error)); else { toast("success", "Pago anulado"); setVoiding(null); refresh(); }
          }}>
            <div><label className="label">Motivo (queda registrado en auditoría)</label><textarea name="reason" required minLength={3} rows={3} className="input" autoFocus /></div>
            {voiding.cash_session_id && <div><label className="label">Este pago salió de caja: el dinero vuelve a</label>
              <select className="input" value={voidSession} onChange={(e) => setVoidSession(e.target.value)} required>
                <option value="">Seleccione una caja abierta</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.cash_registers.name}</option>)}</select></div>}
          </form>
        </Modal>
      )}
    </Modal>
  );
}

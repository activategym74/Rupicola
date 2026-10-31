"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, PackageCheck, Banknote, Trash2, Pencil } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePaymentMethods, useOpenSessions } from "@/lib/hooks";
import { money, num, errMsg } from "@/lib/format";
import { PageHeader, PageLoader } from "@/components/ui/bits";
import { Modal, ReasonModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Supplier = { id: string; name: string; tax_id: string | null; contact_name: string | null; phone: string | null; email: string | null; address: string | null; payment_terms_days: number; notes: string | null; active: boolean };
type PItem = { id: string; ingredient_id: string | null; variant_id: string | null; description: string | null; qty_ordered: number; qty_received: number; unit_cost: number;
  ingredients: { name: string; unit: string } | null; product_variants: { size: string | null; color: string | null; products: { name: string } } | null };
type Purchase = { id: string; status: string; invoice_number: string | null; invoice_date: string | null; due_date: string | null; total: number; paid_total: number; created_at: string;
  business_unit_id: string; suppliers: { name: string }; purchase_items: PItem[] };
const ST: Record<string, string> = { draft: "Borrador", ordered: "Ordenada", partially_received: "Recibida parcial", received: "Recibida", cancelled: "Anulada" };

export default function PurchasesPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, units } = useApp();
  const methods = usePaymentMethods(businessId);
  const { sessions } = useOpenSessions(businessId);
  const [tab, setTab] = useState<"purchases" | "payables" | "suppliers">("purchases");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [newP, setNewP] = useState(false);
  const [sup, setSup] = useState<Supplier | "new" | null>(null);
  const [receive, setReceive] = useState<Purchase | null>(null);
  const [pay, setPay] = useState<Purchase | null>(null);
  const [cancel, setCancel] = useState<Purchase | null>(null);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      sb.from("suppliers").select("*").eq("business_id", businessId).order("name"),
      sb.from("purchases").select("*, suppliers(name), purchase_items(*, ingredients(name, unit), product_variants(size, color, products(name)))").eq("business_id", businessId).order("created_at", { ascending: false }).limit(200),
    ]);
    setSuppliers((s.data ?? []) as Supplier[]); setPurchases((p.data ?? []) as unknown as Purchase[]);
  }, [sb, businessId]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  if (!purchases) return <PageLoader />;
  const unitName = (id: string) => units.find((u) => u.id === id)?.name;
  const payables = purchases.filter((p) => p.status !== "cancelled" && Number(p.total) - Number(p.paid_total) > 0);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Compras y proveedores" subtitle={`Cuentas por pagar: ${money(payables.reduce((s, p) => s + Number(p.total) - Number(p.paid_total), 0))}`}
        actions={tab === "suppliers" ? <button className="btn-primary" onClick={() => setSup("new")}><Plus size={16} /> Proveedor</button> : <button className="btn-primary" onClick={() => setNewP(true)} disabled={!suppliers.length}><Plus size={16} /> Nueva compra</button>} />
      <div className="mb-4 flex gap-2">{([["purchases", "Compras"], ["payables", "Cuentas por pagar"], ["suppliers", "Proveedores"]] as const).map(([k, l]) =>
        <button key={k} onClick={() => setTab(k)} className={clsx("chip border !px-3 !py-1.5", tab === k ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{l}</button>)}</div>

      {tab !== "suppliers" ? (
        <div className="card overflow-x-auto"><table className="table-base">
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Unidad</th><th>Factura</th><th>Estado</th><th className="text-right">Total</th><th className="text-right">Saldo</th><th>Vence</th><th></th></tr></thead>
          <tbody>{(tab === "payables" ? payables : purchases).map((p) => (
            <tr key={p.id}><td>{p.created_at.slice(0, 10)}</td><td className="font-medium">{p.suppliers.name}</td><td>{unitName(p.business_unit_id)}</td><td>{p.invoice_number ?? "—"}</td>
              <td><span className={clsx("chip", p.status === "received" ? "bg-emerald-50 text-emerald-800" : p.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-sand-50")}>{ST[p.status]}</span></td>
              <td className="text-right">{money(p.total)}</td><td className="text-right">{money(Number(p.total) - Number(p.paid_total))}</td>
              <td className={clsx(p.due_date && p.due_date < new Date().toISOString().slice(0, 10) && Number(p.total) > Number(p.paid_total) && "font-medium text-red-700")}>{p.due_date ?? "—"}</td>
              <td className="flex gap-1">
                {["ordered", "partially_received"].includes(p.status) && <button className="btn-ghost !p-1.5" title="Recibir" onClick={() => setReceive(p)}><PackageCheck size={16} /></button>}
                {p.status !== "cancelled" && Number(p.total) > Number(p.paid_total) && <button className="btn-ghost !p-1.5" title="Pagar" onClick={() => setPay(p)}><Banknote size={16} /></button>}
                {p.status === "ordered" && <button className="btn-ghost !p-1.5 text-red-700" title="Anular" onClick={() => setCancel(p)}><Trash2 size={16} /></button>}
              </td></tr>))}</tbody></table></div>
      ) : (
        <div className="card overflow-x-auto"><table className="table-base"><thead><tr><th>Proveedor</th><th>NIT</th><th>Contacto</th><th>Teléfono</th><th>Plazo</th><th></th></tr></thead>
          <tbody>{suppliers.map((s) => <tr key={s.id} className={!s.active ? "opacity-50" : ""}><td className="font-medium">{s.name}</td><td>{s.tax_id}</td><td>{s.contact_name}</td><td>{s.phone}</td><td>{s.payment_terms_days} días</td>
            <td><button className="btn-ghost !p-1.5" onClick={() => setSup(s)}><Pencil size={16} /></button></td></tr>)}</tbody></table></div>
      )}

      {newP && <NewPurchase suppliers={suppliers.filter((s) => s.active)} onClose={() => setNewP(false)} onSaved={() => { setNewP(false); load(); }} />}
      {sup && (
        <Modal open onClose={() => setSup(null)} title={sup === "new" ? "Nuevo proveedor" : "Editar proveedor"} footer={<button form="sup" className="btn-primary">Guardar</button>}>
          <form id="sup" className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
            e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            const row = { business_id: businessId, name: f.name, tax_id: f.tax_id || null, contact_name: f.contact_name || null, phone: f.phone || null, email: f.email || null, address: f.address || null, payment_terms_days: Number(f.terms || 0), notes: f.notes || null, active: f.active === "on" };
            const { error } = sup === "new" ? await sb.from("suppliers").insert(row) : await sb.from("suppliers").update(row).eq("id", sup.id);
            if (error) toast("error", errMsg(error)); else { setSup(null); load(); }
          }}>
            {([["name", "Nombre"], ["tax_id", "NIT"], ["contact_name", "Contacto"], ["phone", "Teléfono"], ["email", "Correo"], ["address", "Dirección"]] as const).map(([k, l]) =>
              <div key={k}><label className="label">{l}</label><input name={k} required={k === "name"} defaultValue={sup === "new" ? "" : (sup[k] ?? "")} className="input" /></div>)}
            <div><label className="label">Plazo de pago (días)</label><input name="terms" type="number" defaultValue={sup === "new" ? 0 : sup.payment_terms_days} className="input" /></div>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="active" defaultChecked={sup === "new" ? true : sup.active} /> Activo</label>
            <div className="col-span-2"><label className="label">Notas</label><input name="notes" defaultValue={sup === "new" ? "" : (sup.notes ?? "")} className="input" /></div>
          </form>
        </Modal>
      )}
      {receive && (
        <Modal open onClose={() => setReceive(null)} title={`Recibir · ${receive.suppliers.name}`} footer={<button form="rcv" className="btn-primary">Registrar recepción</button>}>
          <form id="rcv" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const receipts = receive.purchase_items.map((i) => ({ item_id: i.id, qty: Number(f.get(i.id) || 0) })).filter((r) => r.qty > 0);
            const { error } = await sb.rpc("purchase_receive", { p_purchase: receive.id, p_receipts: receipts });
            if (error) toast("error", errMsg(error)); else { toast("success", "Inventario actualizado"); setReceive(null); load(); }
          }}>
            <table className="table-base"><thead><tr><th>Artículo</th><th className="text-right">Pedido</th><th className="text-right">Recibido</th><th>Ahora</th></tr></thead>
              <tbody>{receive.purchase_items.map((i) => <tr key={i.id}><td>{i.ingredients?.name ?? `${i.product_variants?.products.name} ${[i.product_variants?.size, i.product_variants?.color].filter(Boolean).join("/")}`}</td>
                <td className="text-right">{num(i.qty_ordered, 3)}</td><td className="text-right">{num(i.qty_received, 3)}</td>
                <td><input name={i.id} type="number" step="0.001" min={0} max={i.qty_ordered - i.qty_received} defaultValue={i.qty_ordered - i.qty_received} className="input !w-24 !py-1" /></td></tr>)}</tbody></table>
          </form>
        </Modal>
      )}
      {pay && (
        <Modal open onClose={() => setPay(null)} title={`Pagar a ${pay.suppliers.name}`} footer={<button form="pay" className="btn-primary">Registrar pago</button>}>
          <form id="pay" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { error } = await sb.rpc("purchase_pay", { p_purchase: pay.id, p_amount: Number(f.get("amount")), p_method: f.get("method"), p_reference: f.get("ref") || null, p_session: f.get("session") || null });
            if (error) toast("error", errMsg(error)); else { toast("success", "Pago registrado"); setPay(null); load(); }
          }}>
            <div><label className="label">Valor</label><input name="amount" type="number" required defaultValue={Number(pay.total) - Number(pay.paid_total)} className="input" /></div>
            <div><label className="label">Método</label><select name="method" className="input">{methods.filter((m) => !m.gateway).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            <div><label className="label">Referencia</label><input name="ref" className="input" /></div>
            <div><label className="label">Sale de caja (opcional)</label><select name="session" className="input"><option value="">No afecta caja</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.cash_registers.name}</option>)}</select></div>
          </form>
        </Modal>
      )}
      <ReasonModal open={!!cancel} title="Anular compra" onClose={() => setCancel(null)} onConfirm={async (r) => {
        const { error } = await sb.rpc("purchase_cancel", { p_purchase: cancel!.id, p_reason: r });
        if (error) toast("error", errMsg(error)); else { setCancel(null); load(); }
      }} />
    </div>
  );
}

type Line = { type: "ingredient" | "variant"; id: string; qty: string; cost: string; expires: string };
function NewPurchase({ suppliers, onClose, onSaved }: { suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, units } = useApp();
  const [unit, setUnit] = useState(units[0]?.id ?? "");
  const [ings, setIngs] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [vars, setVars] = useState<{ id: string; label: string }[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const kind = units.find((u) => u.id === unit)?.kind;
  useEffect(() => {
    sb.from("ingredients").select("id, name, unit").eq("business_id", businessId).eq("active", true).order("name").then(({ data }: { data: { id: string; name: string; unit: string }[] | null }) => setIngs(data ?? []));
    sb.from("product_variants").select("id, size, color, design, products(name)").eq("business_id", businessId).eq("active", true)
      .then(({ data }: { data: { id: string; size: string | null; color: string | null; design: string | null; products: { name: string } }[] | null }) =>
        setVars((data ?? []).map((v) => ({ id: v.id, label: `${v.products.name} ${[v.size, v.color, v.design].filter(Boolean).join(" / ")}` }))));
  }, [sb, businessId]);
  useEffect(() => setLines([]), [unit]);
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.cost || 0), 0);
  return (
    <Modal open wide onClose={onClose} title="Nueva compra" footer={<><span className="mr-auto self-center font-semibold">{money(total)}</span><button form="np" className="btn-secondary" name="mode" value="order">Crear orden</button><button form="np" className="btn-primary" name="mode" value="receive">Registrar y recibir</button></>}>
      <form id="np" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const mode = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value;
        const f = new FormData(e.currentTarget);
        if (!lines.length) return toast("error", "Agregue artículos");
        const { error } = await sb.rpc("purchase_create", { p_business: businessId, p_unit: unit, p_supplier: f.get("supplier"),
          p_items: lines.map((l) => ({ [l.type === "ingredient" ? "ingredient_id" : "variant_id"]: l.id, qty: Number(l.qty), unit_cost: Number(l.cost), expires_on: l.expires || null })),
          p_invoice: f.get("invoice") || null, p_invoice_date: f.get("date") || null, p_due: f.get("due") || null, p_notes: f.get("notes") || null, p_receive_now: mode === "receive" });
        if (error) toast("error", errMsg(error)); else { toast("success", mode === "receive" ? "Compra registrada e inventario actualizado" : "Orden de compra creada"); onSaved(); }
      }}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div><label className="label">Proveedor</label><select name="supplier" className="input">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="label">Unidad de negocio</label><select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <div><label className="label">N.º factura</label><input name="invoice" className="input" /></div>
          <div><label className="label">Fecha factura</label><input name="date" type="date" className="input" /></div>
          <div><label className="label">Vencimiento</label><input name="due" type="date" className="input" /></div>
          <div><label className="label">Notas</label><input name="notes" className="input" /></div>
        </div>
        <table className="table-base"><thead><tr><th>Artículo</th><th>Cantidad</th><th>Costo unit.</th>{kind === "gastronomy" && <th>Vence</th>}<th></th></tr></thead>
          <tbody>{lines.map((l, i) => {
            const up = (p: Partial<Line>) => setLines((s) => s.map((x, j) => j === i ? { ...x, ...p } : x));
            return <tr key={i}>
              <td><select className="input !py-1" value={l.id} onChange={(e) => up({ id: e.target.value })}>{(kind === "gastronomy" ? ings.map((g) => ({ id: g.id, label: `${g.name} (${g.unit})` })) : vars).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></td>
              <td><input className="input !w-24 !py-1" type="number" step="0.001" value={l.qty} onChange={(e) => up({ qty: e.target.value })} required /></td>
              <td><input className="input !w-28 !py-1" type="number" step="0.01" value={l.cost} onChange={(e) => up({ cost: e.target.value })} required /></td>
              {kind === "gastronomy" && <td><input className="input !py-1" type="date" value={l.expires} onChange={(e) => up({ expires: e.target.value })} /></td>}
              <td><button type="button" className="btn-ghost !p-1" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td></tr>;
          })}</tbody></table>
        <button type="button" className="btn-ghost text-sm" onClick={() => setLines((s) => [...s, { type: kind === "gastronomy" ? "ingredient" : "variant", id: (kind === "gastronomy" ? ings[0]?.id : vars[0]?.id) ?? "", qty: "1", cost: "0", expires: "" }])}>
          <Plus size={14} /> Agregar artículo</button>
      </form>
    </Modal>
  );
}

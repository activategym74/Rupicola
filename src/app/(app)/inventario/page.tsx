"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, SlidersHorizontal, AlertTriangle, Pencil } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, num, dateTime, errMsg } from "@/lib/format";
import { PageHeader, PageLoader } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Ing = { id: string; name: string; kind: string; unit: string; stock: number; min_stock: number; cost_per_unit: number; active: boolean; business_unit_id: string };
type Var = { id: string; size: string | null; color: string | null; design: string | null; sku: string | null; stock: number; min_stock: number; cost: number; products: { name: string } };
type Mov = { id: string; kind: string; qty: number; unit_cost: number; reason: string | null; created_at: string; expires_on: string | null; ingredients: { name: string; unit: string } | null; product_variants: { size: string | null; color: string | null; products: { name: string } } | null };

const KINDS: Record<string, string> = { ingredient: "Ingrediente", food: "Alimento", beverage: "Bebida", liquor: "Licor", supply: "Insumo", finished: "Producto terminado" };
const MOV: Record<string, string> = { purchase: "Compra", sale: "Venta", adjustment: "Ajuste", waste: "Desperdicio", shrinkage: "Merma", expired: "Vencimiento", return: "Devolución", reversal: "Reverso", initial: "Inventario inicial" };

export default function InventoryPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, unitByKind, can } = useApp();
  const [tab, setTab] = useState<"gastro" | "shop" | "moves">("gastro");
  const [ings, setIngs] = useState<Ing[] | null>(null);
  const [vars, setVars] = useState<Var[]>([]);
  const [moves, setMoves] = useState<Mov[]>([]);
  const [expiring, setExpiring] = useState<Mov[]>([]);
  const [adjust, setAdjust] = useState<{ ingredient?: Ing; variant?: Var } | null>(null);
  const [editIng, setEditIng] = useState<Ing | "new" | null>(null);

  const load = useCallback(async () => {
    const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const [a, b, c, d] = await Promise.all([
      sb.from("ingredients").select("*").eq("business_id", businessId).order("name"),
      sb.from("product_variants").select("id, size, color, design, sku, stock, min_stock, cost, products(name)").eq("business_id", businessId).eq("active", true),
      sb.from("inventory_movements").select("id, kind, qty, unit_cost, reason, created_at, expires_on, ingredients(name, unit), product_variants(size, color, products(name))").eq("business_id", businessId).order("created_at", { ascending: false }).limit(200),
      sb.from("inventory_movements").select("id, kind, qty, unit_cost, reason, created_at, expires_on, ingredients(name, unit), product_variants(size, color, products(name))").eq("business_id", businessId).eq("kind", "purchase").not("expires_on", "is", null).lte("expires_on", soon).order("expires_on"),
    ]);
    setIngs((a.data ?? []) as Ing[]); setVars((b.data ?? []) as unknown as Var[]); setMoves((c.data ?? []) as unknown as Mov[]); setExpiring((d.data ?? []) as unknown as Mov[]);
  }, [sb, businessId]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);

  if (!ings) return <PageLoader />;
  const low = (s: number, m: number) => Number(s) <= Number(m);
  const valueG = ings.reduce((s, i) => s + Number(i.stock) * Number(i.cost_per_unit), 0);
  const valueS = vars.reduce((s, v) => s + Number(v.stock) * Number(v.cost), 0);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Inventario" subtitle={`Gastronomía ${money(valueG)} · Tienda ${money(valueS)} valorizado`}
        actions={can("inventory.manage") && tab === "gastro" ? <button className="btn-primary" onClick={() => setEditIng("new")}><Plus size={16} /> Nuevo ingrediente</button> : undefined} />
      {expiring.length > 0 && (
        <div className="card mb-4 !border-amber-300 p-3 text-sm"><b className="text-amber-800"><AlertTriangle size={14} className="inline" /> Lotes por vencer (7 días):</b>{" "}
          {expiring.map((m) => `${m.ingredients?.name ?? m.product_variants?.products.name} (${m.expires_on})`).join(" · ")}</div>
      )}
      <div className="mb-4 flex gap-2">
        {([["gastro", "Gastronomía"], ["shop", "Tienda"], ["moves", "Movimientos"]] as const).map(([k, l]) =>
          <button key={k} onClick={() => setTab(k)} className={clsx("chip border !px-3 !py-1.5", tab === k ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{l}</button>)}
      </div>

      {tab === "gastro" && (
        <div className="card overflow-x-auto"><table className="table-base">
          <thead><tr><th>Artículo</th><th>Tipo</th><th className="text-right">Existencia</th><th className="text-right">Mínimo</th><th className="text-right">Costo unit.</th><th className="text-right">Valor</th><th></th></tr></thead>
          <tbody>{ings.map((i) => (
            <tr key={i.id} className={clsx(!i.active && "opacity-50")}>
              <td className="font-medium">{i.name}</td><td>{KINDS[i.kind]}</td>
              <td className={clsx("text-right", low(i.stock, i.min_stock) && "font-semibold text-red-700")}>{num(i.stock, 3)} {i.unit}</td>
              <td className="text-right">{num(i.min_stock, 3)}</td><td className="text-right">{money(i.cost_per_unit)}</td><td className="text-right">{money(Number(i.stock) * Number(i.cost_per_unit))}</td>
              <td className="flex gap-1">
                {can("inventory.adjust") && <button className="btn-ghost !p-1.5" title="Movimiento" onClick={() => setAdjust({ ingredient: i })}><SlidersHorizontal size={16} /></button>}
                {can("inventory.manage") && <button className="btn-ghost !p-1.5" title="Editar" onClick={() => setEditIng(i)}><Pencil size={16} /></button>}
              </td>
            </tr>))}
            {ings.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-charcoal/50">Sin ingredientes registrados</td></tr>}</tbody></table></div>
      )}
      {tab === "shop" && (
        <div className="card overflow-x-auto"><table className="table-base">
          <thead><tr><th>Producto</th><th>Variante</th><th>Referencia</th><th className="text-right">Existencia</th><th className="text-right">Mínimo</th><th className="text-right">Costo</th><th></th></tr></thead>
          <tbody>{vars.map((v) => (
            <tr key={v.id}><td className="font-medium">{v.products.name}</td><td>{[v.size, v.color, v.design].filter(Boolean).join(" / ")}</td><td>{v.sku}</td>
              <td className={clsx("text-right", low(v.stock, v.min_stock) && "font-semibold text-red-700")}>{num(v.stock)}</td><td className="text-right">{num(v.min_stock)}</td><td className="text-right">{money(v.cost)}</td>
              <td>{can("inventory.adjust") && <button className="btn-ghost !p-1.5" onClick={() => setAdjust({ variant: v })}><SlidersHorizontal size={16} /></button>}</td></tr>))}
            {vars.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-charcoal/50">Cree productos de tienda con variantes en Catálogo</td></tr>}</tbody></table></div>
      )}
      {tab === "moves" && (
        <div className="card overflow-x-auto"><table className="table-base">
          <thead><tr><th>Fecha</th><th>Artículo</th><th>Tipo</th><th className="text-right">Cantidad</th><th>Motivo</th></tr></thead>
          <tbody>{moves.map((m) => (
            <tr key={m.id}><td className="whitespace-nowrap">{dateTime(m.created_at)}</td>
              <td>{m.ingredients?.name ?? `${m.product_variants?.products.name} ${[m.product_variants?.size, m.product_variants?.color].filter(Boolean).join(" / ")}`}</td>
              <td>{MOV[m.kind]}</td><td className={clsx("text-right font-medium", Number(m.qty) < 0 ? "text-red-700" : "text-emerald-700")}>{Number(m.qty) > 0 ? "+" : ""}{num(m.qty, 3)}</td>
              <td className="text-xs text-charcoal/60">{m.reason}</td></tr>))}</tbody></table></div>
      )}

      {adjust && (
        <Modal open onClose={() => setAdjust(null)} title={`Movimiento · ${adjust.ingredient?.name ?? adjust.variant?.products.name}`} footer={<button form="adj" className="btn-primary">Registrar</button>}>
          <form id="adj" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { error } = await sb.rpc("inventory_adjust", { p_business: businessId, p_ingredient: adjust.ingredient?.id ?? null, p_variant: adjust.variant?.id ?? null,
              p_kind: f.get("kind"), p_qty: Number(f.get("qty")), p_reason: String(f.get("reason")), p_unit_cost: Number(f.get("cost") || 0), p_expires: f.get("expires") || null });
            if (error) toast("error", errMsg(error)); else { toast("success", "Movimiento registrado"); setAdjust(null); load(); }
          }}>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Tipo</label><select name="kind" className="input">
                <option value="initial">Inventario inicial (entrada)</option><option value="adjustment">Ajuste (+ entra / − sale)</option><option value="waste">Desperdicio</option>
                <option value="shrinkage">Merma</option><option value="expired">Vencimiento</option><option value="return">Devolución (entrada)</option></select></div>
              <div><label className="label">Cantidad</label><input name="qty" type="number" step="0.001" required className="input" /></div>
              <div><label className="label">Costo unitario (entradas)</label><input name="cost" type="number" step="0.01" className="input" /></div>
              <div><label className="label">Vence</label><input name="expires" type="date" className="input" /></div>
            </div>
            <div><label className="label">Motivo</label><input name="reason" required minLength={3} className="input" /></div>
            <p className="text-xs text-charcoal/50">Existencia actual: {num(adjust.ingredient?.stock ?? adjust.variant?.stock, 3)}. Mermas, desperdicios y vencimientos siempre restan.</p>
          </form>
        </Modal>
      )}
      {editIng && (
        <Modal open onClose={() => setEditIng(null)} title={editIng === "new" ? "Nuevo ingrediente" : "Editar ingrediente"} footer={<button form="ing" className="btn-primary">Guardar</button>}>
          <form id="ing" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const row = { business_id: businessId, business_unit_id: unitByKind("gastronomy")!.id, name: String(f.get("name")).trim(), kind: f.get("kind"), unit: f.get("unit"),
              min_stock: Number(f.get("min")), cost_per_unit: Number(f.get("cost")), active: f.get("active") === "on" };
            const { error } = editIng === "new" ? await sb.from("ingredients").insert(row) : await sb.from("ingredients").update(row).eq("id", editIng.id);
            if (error) toast("error", errMsg(error)); else { toast("success", "Guardado"); setEditIng(null); load(); }
          }}>
            <div><label className="label">Nombre</label><input name="name" required defaultValue={editIng === "new" ? "" : editIng.name} className="input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Tipo</label><select name="kind" className="input" defaultValue={editIng === "new" ? "ingredient" : editIng.kind}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label className="label">Unidad de medida</label><select name="unit" className="input" defaultValue={editIng === "new" ? "und" : editIng.unit}>{["und", "g", "kg", "ml", "l", "porción", "tajada", "botella"].map((u) => <option key={u}>{u}</option>)}</select></div>
              <div><label className="label">Existencia mínima</label><input name="min" type="number" step="0.001" defaultValue={editIng === "new" ? 0 : editIng.min_stock} className="input" /></div>
              <div><label className="label">Costo por unidad</label><input name="cost" type="number" step="0.0001" defaultValue={editIng === "new" ? 0 : editIng.cost_per_unit} className="input" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={editIng === "new" ? true : editIng.active} /> Activo</label>
            <p className="text-xs text-charcoal/50">La existencia se carga con Compras o un movimiento de Inventario inicial. El costo se recalcula por promedio ponderado al recibir compras.</p>
          </form>
        </Modal>
      )}
    </div>
  );
}

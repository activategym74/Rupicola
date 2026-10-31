"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Ban } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useOpenSessions } from "@/lib/hooks";
import { money, daysAgo, today, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, Stat } from "@/components/ui/bits";
import { Modal, ReasonModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type E = { id: string; description: string; amount: number; expense_date: string; scope: string; status: string; gastronomy_pct: number | null; reference: string | null;
  expense_categories: { name: string }; expense_allocations: { amount: number; business_unit_id: string }[] };
type Result = { name: string; kind: string; revenue: number; product_cost: number; expenses: number; operating_result: number };
const SCOPE: Record<string, string> = { gastronomy: "Gastronomía", shop: "Tienda", shared: "Compartido" };

export default function ExpensesPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, units, can, unitByKind } = useApp();
  const { sessions } = useOpenSessions(businessId);
  const [from, setFrom] = useState(daysAgo(29)), [to, setTo] = useState(today());
  const [list, setList] = useState<E[] | null>(null);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [add, setAdd] = useState(false);
  const [scope, setScope] = useState("shared");
  const [voiding, setVoiding] = useState<E | null>(null);

  const load = useCallback(async () => {
    const [e, c, r] = await Promise.all([
      sb.from("expenses").select("*, expense_categories(name), expense_allocations(amount, business_unit_id)").eq("business_id", businessId).gte("expense_date", from).lte("expense_date", to).order("expense_date", { ascending: false }),
      sb.from("expense_categories").select("id, name").eq("business_id", businessId).order("name"),
      can("reports.finance") ? sb.rpc("unit_results", { p_business: businessId, p_from: from, p_to: to }) : Promise.resolve({ data: [] }),
    ]);
    setList((e.data ?? []) as unknown as E[]); setCats(c.data ?? []); setResults((r.data ?? []) as Result[]);
  }, [sb, businessId, from, to, can]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  if (!list) return <PageLoader />;
  const active = list.filter((e) => e.status === "active");
  const byUnit = (id?: string) => active.flatMap((e) => e.expense_allocations).filter((a) => a.business_unit_id === id).reduce((s, a) => s + Number(a.amount), 0);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Gastos y rentabilidad" subtitle="Gastos por unidad y reparto de gastos compartidos"
        actions={<><input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn-primary" onClick={() => setAdd(true)}><Plus size={16} /> Registrar gasto</button></>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Total gastos" value={money(active.reduce((s, e) => s + Number(e.amount), 0))} />
        <Stat label="Asignado a gastronomía" value={money(byUnit(unitByKind("gastronomy")?.id))} />
        <Stat label="Asignado a tienda" value={money(byUnit(unitByKind("shop")?.id))} />
      </div>
      {results.length > 0 && (
        <div className="card mb-4 overflow-x-auto p-4">
          <h3 className="mb-2 text-sm font-medium">Resultado operativo estimado</h3>
          <table className="table-base"><thead><tr><th>Unidad</th><th className="text-right">Ingresos</th><th className="text-right">Costo de productos</th><th className="text-right">Gastos asignados</th><th className="text-right">Resultado</th></tr></thead>
            <tbody>{results.map((r) => <tr key={r.name}><td className="font-medium">{r.name}</td><td className="text-right">{money(r.revenue)}</td><td className="text-right">{money(r.product_cost)}</td><td className="text-right">{money(r.expenses)}</td>
              <td className={`text-right font-semibold ${Number(r.operating_result) < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(r.operating_result)}</td></tr>)}</tbody></table>
          <p className="mt-2 text-xs text-charcoal/50">Ingresos − costo de productos − gastos asignados. Indicador administrativo; no es un estado financiero ni contabilidad oficial.</p>
        </div>
      )}
      <div className="card overflow-x-auto"><table className="table-base">
        <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Alcance</th><th>Reparto</th><th className="text-right">Valor</th><th></th></tr></thead>
        <tbody>{list.map((e) => <tr key={e.id} className={e.status === "voided" ? "opacity-50 line-through" : ""}><td>{e.expense_date}</td><td>{e.expense_categories.name}</td><td>{e.description}</td><td>{SCOPE[e.scope]}</td>
          <td className="text-xs">{e.expense_allocations.map((a) => `${units.find((u) => u.id === a.business_unit_id)?.name}: ${money(a.amount)}`).join(" · ")}</td>
          <td className="text-right font-medium">{money(e.amount)}</td>
          <td>{e.status === "active" && <button className="btn-ghost !p-1 text-red-700" onClick={() => setVoiding(e)}><Ban size={14} /></button>}</td></tr>)}</tbody></table></div>

      {add && (
        <Modal open onClose={() => setAdd(false)} title="Registrar gasto" footer={<button form="ex" className="btn-primary">Guardar</button>}>
          <form id="ex" className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { error } = await sb.rpc("expense_create", { p_business: businessId, p_category: f.get("cat"), p_scope: f.get("scope"), p_description: String(f.get("desc")), p_amount: Number(f.get("amount")),
              p_date: f.get("date"), p_gastro_pct: f.get("pct") ? Number(f.get("pct")) : null, p_session: f.get("session") || null, p_supplier: null, p_reference: f.get("ref") || null });
            if (error) toast("error", errMsg(error)); else { toast("success", "Gasto registrado"); setAdd(false); load(); }
          }}>
            <div><label className="label">Categoría</label><select name="cat" className="input">{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label">Fecha</label><input name="date" type="date" defaultValue={today()} className="input" /></div>
            <div className="col-span-2"><label className="label">Descripción</label><input name="desc" required className="input" /></div>
            <div><label className="label">Valor</label><input name="amount" type="number" min={1} required className="input" /></div>
            <div><label className="label">Clasificación</label><select name="scope" className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="gastronomy">Gastronomía</option><option value="shop">Tienda</option><option value="shared">Gasto compartido</option></select></div>
            {scope === "shared" && <div><label className="label">% a gastronomía</label><input name="pct" type="number" min={0} max={100} placeholder="Según configuración" className="input" /></div>}
            <div><label className="label">Referencia / soporte</label><input name="ref" className="input" /></div>
            <div className="col-span-2"><label className="label">Pagado desde caja (opcional)</label><select name="session" className="input"><option value="">No sale de caja</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.cash_registers.name}</option>)}</select></div>
          </form>
        </Modal>
      )}
      <ReasonModal open={!!voiding} title="Anular gasto" onClose={() => setVoiding(null)} onConfirm={async (r) => {
        const { error } = await sb.rpc("expense_void", { p_expense: voiding!.id, p_reason: r });
        if (error) toast("error", errMsg(error)); else { setVoiding(null); load(); }
      }} />
    </div>
  );
}

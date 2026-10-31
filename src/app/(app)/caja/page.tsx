"use client";
import { useCallback, useEffect, useState } from "react";
import { LockOpen, Lock, ArrowDownCircle, ArrowUpCircle, Undo2 } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePaymentMethods } from "@/lib/hooks";
import { money, dateTime, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, StatusBadge } from "@/components/ui/bits";
import { Modal, ReasonModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Reg = { id: string; name: string };
type Sess = { id: string; register_id: string; opening_amount: number; expected_cash: number | null; counted_cash: number | null; difference: number | null; opened_at: string; closed_at: string | null; notes: string | null;
  opener: { full_name: string } | null; closer: { full_name: string } | null };
type Mov = { id: string; kind: string; amount: number; description: string | null; created_at: string; payment_id: string | null; business_units: { name: string } | null; payment_methods: { name: string; is_cash: boolean } | null };
type Summary = { by_method: { method: string; is_cash: boolean; total: number }[]; by_unit: { unit: string; total: number }[]; expected_cash: number };
const KIND: Record<string, string> = { opening: "Apertura", sale: "Venta", income: "Ingreso", expense: "Egreso / gasto", withdrawal: "Retiro", refund: "Reverso", delivery_collection: "Cobro domicilio", closing_adjustment: "Ajuste" };

export default function CashPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, units, can } = useApp();
  const methods = usePaymentMethods(businessId);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [sessions, setSessions] = useState<Sess[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [moves, setMoves] = useState<Mov[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [modal, setModal] = useState<null | "open" | "move" | "close">(null);
  const [voidPay, setVoidPay] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([
      sb.from("cash_registers").select("id, name").eq("business_id", businessId).eq("active", true),
      sb.from("cash_sessions").select("*, opener:members!cash_sessions_opened_by_fkey(full_name), closer:members!cash_sessions_closed_by_fkey(full_name)").eq("business_id", businessId).order("opened_at", { ascending: false }).limit(30),
    ]);
    setRegs(r.data ?? []); const list = (s.data ?? []) as unknown as Sess[]; setSessions(list);
    setSel((cur) => cur ?? list.find((x) => !x.closed_at)?.id ?? list[0]?.id ?? null);
  }, [sb, businessId]);
  const loadSession = useCallback(async () => {
    if (!sel) return;
    const [m, s] = await Promise.all([
      sb.from("cash_movements").select("id, kind, amount, description, created_at, payment_id, business_units(name), payment_methods(name, is_cash)").eq("session_id", sel).order("created_at", { ascending: false }),
      sb.rpc("cash_session_summary", { p_session: sel }),
    ]);
    setMoves((m.data ?? []) as unknown as Mov[]); setSum(s.data as Summary);
  }, [sb, sel]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  useEffect(() => { loadSession(); }, [loadSession]);

  if (!sessions) return <PageLoader />;
  const s = sessions.find((x) => x.id === sel);
  const open = sessions.filter((x) => !x.closed_at);
  const freeRegs = regs.filter((r) => !open.some((o) => o.register_id === r.id));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Caja" subtitle="Apertura, movimientos, arqueo y cierre, separado por unidad de negocio"
        actions={<>{can("cash.open") && freeRegs.length > 0 && <button className="btn-primary" onClick={() => setModal("open")}><LockOpen size={16} /> Abrir caja</button>}</>} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="card max-h-[70vh] overflow-y-auto p-2">
          {sessions.map((x) => (
            <button key={x.id} onClick={() => setSel(x.id)} className={`w-full rounded-xl px-3 py-2 text-left text-sm ${sel === x.id ? "bg-sand-50" : "hover:bg-sand-50/50"}`}>
              <div className="flex justify-between font-medium"><span>{regs.find((r) => r.id === x.register_id)?.name ?? "Caja"}</span>{x.closed_at ? <span className="chip bg-stone-100">Cerrada</span> : <span className="chip bg-emerald-50 text-emerald-800">Abierta</span>}</div>
              <div className="text-xs text-charcoal/50">{dateTime(x.opened_at)} · {x.opener?.full_name}</div>
              {x.difference != null && Number(x.difference) !== 0 && <div className={`text-xs ${Number(x.difference) < 0 ? "text-red-700" : "text-emerald-700"}`}>Diferencia {money(x.difference)}</div>}
            </button>
          ))}
          {sessions.length === 0 && <p className="p-4 text-sm text-charcoal/50">Aún no se ha abierto ninguna caja.</p>}
        </div>
        {s && sum && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="card p-4"><div className="label">Saldo inicial</div><div className="text-xl font-semibold">{money(s.opening_amount)}</div></div>
              <div className="card p-4"><div className="label">Efectivo esperado</div><div className="text-xl font-semibold">{money(sum.expected_cash)}</div></div>
              <div className="card p-4"><div className="label">{s.closed_at ? "Contado / diferencia" : "Estado"}</div>
                <div className="text-xl font-semibold">{s.closed_at ? `${money(s.counted_cash)} · ${money(s.difference)}` : "Abierta"}</div></div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="card p-4"><div className="label">Por método de pago</div>{sum.by_method.map((m) => <div key={m.method} className="flex justify-between py-0.5 text-sm"><span>{m.method}</span><span>{money(m.total)}</span></div>)}</div>
              <div className="card p-4"><div className="label">Por unidad de negocio</div>{sum.by_unit.map((m) => <div key={m.unit} className="flex justify-between py-0.5 text-sm"><span>{m.unit}</span><span>{money(m.total)}</span></div>)}</div>
            </div>
            {!s.closed_at && (
              <div className="flex flex-wrap gap-2">
                {can("cash.move") && <button className="btn-secondary" onClick={() => setModal("move")}><ArrowDownCircle size={16} /> Ingreso / egreso / retiro</button>}
                {can("cash.close") && <button className="btn-primary" onClick={() => setModal("close")}><Lock size={16} /> Arqueo y cierre</button>}
              </div>
            )}
            <div className="card overflow-x-auto"><table className="table-base">
              <thead><tr><th>Hora</th><th>Tipo</th><th>Unidad</th><th>Método</th><th>Detalle</th><th className="text-right">Valor</th><th></th></tr></thead>
              <tbody>{moves.map((m) => <tr key={m.id}><td>{dateTime(m.created_at)}</td><td>{KIND[m.kind]}</td><td>{m.business_units?.name ?? "—"}</td><td>{m.payment_methods?.name}</td>
                <td className="text-xs text-charcoal/60">{m.description}</td>
                <td className={`text-right font-medium ${Number(m.amount) < 0 ? "text-red-700" : ""}`}>{Number(m.amount) < 0 ? <ArrowUpCircle size={12} className="mr-1 inline" /> : null}{money(m.amount)}</td>
                <td>{m.payment_id && m.kind !== "refund" && can("cash.void_payment") && !s.closed_at && <button className="btn-ghost !p-1" title="Reversar pago" onClick={() => setVoidPay(m.payment_id)}><Undo2 size={14} /></button>}</td></tr>)}</tbody></table></div>
          </div>
        )}
      </div>

      {modal === "open" && (
        <Modal open onClose={() => setModal(null)} title="Abrir caja" footer={<button form="op" className="btn-primary">Abrir</button>}>
          <form id="op" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { data, error } = await sb.rpc("cash_open", { p_register: f.get("reg"), p_amount: Number(f.get("amount")) });
            if (error) toast("error", errMsg(error)); else { toast("success", "Caja abierta"); setModal(null); setSel(data); load(); }
          }}>
            <div><label className="label">Caja</label><select name="reg" className="input">{freeRegs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <div><label className="label">Saldo inicial en efectivo</label><input name="amount" type="number" min={0} required className="input" /></div>
          </form>
        </Modal>
      )}
      {modal === "move" && s && (
        <Modal open onClose={() => setModal(null)} title="Movimiento de caja" footer={<button form="mv" className="btn-primary">Registrar</button>}>
          <form id="mv" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { error } = await sb.rpc("cash_add_movement", { p_session: s.id, p_kind: f.get("kind"), p_amount: Number(f.get("amount")), p_unit: f.get("unit") || null, p_description: String(f.get("desc")), p_method: f.get("method") || null });
            if (error) toast("error", errMsg(error)); else { toast("success", "Movimiento registrado"); setModal(null); loadSession(); }
          }}>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Tipo</label><select name="kind" className="input"><option value="income">Ingreso</option><option value="expense">Egreso</option><option value="withdrawal">Retiro</option></select></div>
              <div><label className="label">Valor</label><input name="amount" type="number" min={1} required className="input" /></div>
              <div><label className="label">Unidad</label><select name="unit" className="input"><option value="">Compartido</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
              <div><label className="label">Método</label><select name="method" className="input">{methods.filter((m) => !m.gateway).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            </div>
            <div><label className="label">Descripción</label><input name="desc" required minLength={3} className="input" /></div>
            <p className="text-xs text-charcoal/50">Para gastos que afectan la rentabilidad use el módulo Gastos (puede pagarlos desde esta caja).</p>
          </form>
        </Modal>
      )}
      {modal === "close" && s && (
        <Modal open onClose={() => setModal(null)} title="Arqueo y cierre de caja" footer={<button form="cl" className="btn-primary">Cerrar caja</button>}>
          <form id="cl" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const detail = Object.fromEntries(sum!.by_method.filter((m) => !m.is_cash).map((m) => [m.method, Number(f.get(`m-${m.method}`) || 0)]));
            const { data, error } = await sb.rpc("cash_close", { p_session: s.id, p_counted: Number(f.get("counted")), p_detail: detail, p_notes: f.get("notes") || null });
            if (error) toast("error", errMsg(error)); else { toast(Number(data.difference) === 0 ? "success" : "info", `Caja cerrada. Diferencia: ${money(data.difference)}`); setModal(null); load(); loadSession(); }
          }}>
            <div><label className="label">Efectivo contado</label><input name="counted" type="number" required className="input text-lg" /><p className="mt-1 text-xs text-charcoal/50">Esperado: {money(sum!.expected_cash)}</p></div>
            {sum!.by_method.filter((m) => !m.is_cash).map((m) => <div key={m.method}><label className="label">{m.method} (según datáfono / extracto)</label><input name={`m-${m.method}`} type="number" defaultValue={m.total} className="input" /></div>)}
            <div><label className="label">Observaciones</label><input name="notes" className="input" /></div>
          </form>
        </Modal>
      )}
      <ReasonModal open={!!voidPay} title="Reversar pago" confirmLabel="Reversar" onClose={() => setVoidPay(null)} onConfirm={async (r) => {
        const { error } = await sb.rpc("payment_void", { p_payment: voidPay, p_reason: r });
        if (error) toast("error", errMsg(error)); else { toast("success", "Pago reversado; la cuenta queda por cobrar"); setVoidPay(null); loadSession(); }
      }} />
      <span className="hidden"><StatusBadge status="paid" /></span>
    </div>
  );
}

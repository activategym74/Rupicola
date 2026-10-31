"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { money, errMsg } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { PaymentMethod, CashSession } from "@/lib/hooks";
import type { Order } from "./types";

type Line = { method_id: string; amount: string; received: string; reference: string };

/** Cobro con pagos mixtos. El reparto por unidad de negocio lo hace la base de datos. */
export function PaymentModal({ order, open, onClose, onDone, methods, sessions, units, suggestedTipPct = 10, canTip }: {
  order: Order; open: boolean; onClose: () => void; onDone: (finalized: boolean, change: number) => void;
  methods: PaymentMethod[]; sessions: CashSession[]; units: { id: string; name: string }[]; suggestedTipPct?: number; canTip: boolean;
}) {
  const toast = useToast();
  const manual = methods.filter((m) => !m.gateway);
  const [session, setSession] = useState(sessions[0]?.id ?? "");
  const [tip, setTip] = useState<string>(String(order.tip ?? 0));
  const due0 = Number(order.total) + Number(tip || 0) - Number(order.paid_total);
  const [lines, setLines] = useState<Line[]>([{ method_id: manual[0]?.id ?? "", amount: String(Math.max(due0, 0)), received: "", reference: "" }]);
  const [busy, setBusy] = useState(false);

  const due = Number(order.total) + Number(tip || 0) - Number(order.paid_total);
  const sum = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const remaining = due - sum;
  const byUnit = useMemo(() => {
    const m: Record<string, number> = {};
    order.order_items.filter((i) => i.status === "active").forEach((i) => { m[i.business_unit_id] = (m[i.business_unit_id] ?? 0) + Number(i.line_total); });
    return m;
  }, [order]);
  const change = lines.reduce((s, l) => {
    const m = methods.find((x) => x.id === l.method_id);
    return s + (m?.is_cash && l.received ? Math.max(Number(l.received) - Number(l.amount || 0), 0) : 0);
  }, 0);
  const needsSession = lines.some((l) => methods.find((m) => m.id === l.method_id)?.is_cash);

  const set = (i: number, patch: Partial<Line>) => setLines((s) => s.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function pay() {
    if (needsSession && !session) return toast("error", "Abra una caja para recibir efectivo (menú Caja).");
    if (sum <= 0) return toast("error", "Ingrese el valor a pagar");
    if (remaining < -0.5) return toast("error", "Los pagos superan el saldo");
    setBusy(true);
    const sb = supabaseBrowser();
    if (canTip && Number(tip || 0) !== Number(order.tip)) {
      const { error } = await sb.rpc("pos_set_tip", { p_order: order.id, p_tip: Number(tip || 0) });
      if (error) { setBusy(false); return toast("error", errMsg(error)); }
    }
    const { data, error } = await sb.rpc("pos_register_payments", {
      p_order: order.id, p_session: session || null,
      p_payments: lines.filter((l) => Number(l.amount) > 0).map((l) => ({
        method_id: l.method_id, amount: Number(l.amount), received_amount: l.received ? Number(l.received) : null, reference: l.reference || null,
      })),
    });
    setBusy(false);
    if (error) return toast("error", errMsg(error));
    onDone(data.finalized, Number(data.change));
  }

  return (
    <Modal open={open} onClose={onClose} title={`Cobrar pedido #${order.number}`} wide
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={pay} disabled={busy}>{busy ? "Registrando…" : remaining > 0.5 ? `Registrar abono de ${money(sum)}` : "Confirmar pago"}</button>
      </>}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-3">
          {lines.map((l, i) => {
            const m = methods.find((x) => x.id === l.method_id);
            return (
              <div key={i} className="rounded-xl border border-stone-line p-3">
                <div className="flex flex-wrap gap-2">
                  <select className="input !w-auto flex-1" value={l.method_id} onChange={(e) => set(i, { method_id: e.target.value })} aria-label="Método">
                    {manual.map((mm) => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
                  </select>
                  <input className="input !w-36" inputMode="numeric" value={l.amount} onChange={(e) => set(i, { amount: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Valor" />
                  {lines.length > 1 && <button className="btn-ghost !p-2" onClick={() => setLines((s) => s.filter((_, k) => k !== i))} aria-label="Quitar"><Trash2 size={16} /></button>}
                </div>
                {m?.is_cash && <input className="input mt-2" inputMode="numeric" placeholder="Efectivo recibido (para calcular vueltas)" value={l.received} onChange={(e) => set(i, { received: e.target.value.replace(/[^0-9.]/g, "") })} />}
                {m?.requires_reference && <input className="input mt-2" placeholder="Número de referencia / comprobante" value={l.reference} onChange={(e) => set(i, { reference: e.target.value })} />}
              </div>
            );
          })}
          <button className="btn-ghost" onClick={() => setLines((s) => [...s, { method_id: manual[1]?.id ?? manual[0]?.id ?? "", amount: String(Math.max(remaining, 0)), received: "", reference: "" }])}>
            <Plus size={16} /> Agregar otro medio de pago
          </button>
          {needsSession && (
            <div>
              <label className="label">Caja</label>
              {sessions.length === 0 ? <p className="text-sm text-red-700">No hay cajas abiertas.</p> :
                <select className="input" value={session} onChange={(e) => setSession(e.target.value)}>
                  {sessions.map((s) => <option key={s.id} value={s.id}>{s.cash_registers?.name}</option>)}
                </select>}
            </div>
          )}
        </div>
        <div className="space-y-2 rounded-xl bg-sand-50 p-4 text-sm">
          <Row k="Subtotal" v={money(order.subtotal)} />
          {Number(order.discount_total) > 0 && <Row k="Descuentos" v={`− ${money(order.discount_total)}`} />}
          {Number(order.delivery_fee) > 0 && <Row k="Domicilio" v={money(order.delivery_fee)} />}
          <Row k="Total" v={money(order.total)} strong />
          {canTip && (
            <div className="flex items-center justify-between gap-2">
              <span>Propina</span>
              <div className="flex items-center gap-1">
                <button className="chip border border-stone-line bg-white" onClick={() => setTip(String(Math.round(Number(order.total) * suggestedTipPct / 100)))}>{suggestedTipPct}%</button>
                <input className="input !w-24 !py-1 text-right" inputMode="numeric" value={tip} onChange={(e) => setTip(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Propina" />
              </div>
            </div>
          )}
          {Number(order.paid_total) > 0 && <Row k="Abonado" v={money(order.paid_total)} />}
          <div className="border-t border-stone-line pt-2"><Row k="Saldo" v={money(due)} strong /></div>
          <Row k="Pagos ingresados" v={money(sum)} />
          {remaining > 0.5 && <Row k="Quedaría pendiente" v={money(remaining)} />}
          {change > 0 && <div className="rounded-lg bg-charcoal px-3 py-2 text-white"><Row k="Vueltas" v={money(change)} strong /></div>}
          <div className="border-t border-stone-line pt-2 text-xs text-charcoal/60">
            Distribución interna:
            {Object.entries(byUnit).map(([u, v]) => <div key={u} className="flex justify-between"><span>{units.find((x) => x.id === u)?.name}</span><span>{money(v)}</span></div>)}
          </div>
        </div>
      </div>
    </Modal>
  );
}
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between ${strong ? "text-base font-semibold" : ""}`}><span>{k}</span><span>{v}</span></div>;
}

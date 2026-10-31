"use client";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { LogoMark } from "@/components/brand/logo";
import { money, dateTime } from "@/lib/format";
import type { Order } from "./types";

/** Comprobante de venta (no es factura electrónica DIAN). Imprimible en tirilla de 80 mm. */
export function Receipt({ order, open, onClose, business, units, change }: {
  order: Order; open: boolean; onClose: () => void; business: { name: string }; units: { id: string; name: string }[]; change?: number;
}) {
  const items = order.order_items.filter((i) => i.status === "active");
  const byUnit = units.map((u) => ({ name: u.name, total: items.filter((i) => i.business_unit_id === u.id).reduce((s, i) => s + Number(i.line_total), 0) })).filter((x) => x.total > 0);
  return (
    <Modal open={open} onClose={onClose} title="Comprobante de venta"
      footer={<><button className="btn-secondary" onClick={onClose}>Cerrar</button><button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Imprimir</button></>}>
      <div id="receipt" className="mx-auto max-w-[320px] font-mono text-xs">
        <div className="flex flex-col items-center text-center">
          <LogoMark size={56} />
          <div className="mt-2 font-display text-lg font-semibold tracking-[0.2em]">{business.name}</div>
          <div>Comprobante interno de venta</div>
          <div>Pedido #{order.number} · {dateTime(order.paid_at ?? order.created_at)}</div>
          {order.dining_tables && <div>Mesa {order.dining_tables.number}</div>}
          {order.customer_name && <div>Cliente: {order.customer_name}</div>}
        </div>
        <div className="my-2 border-t border-dashed border-charcoal/40" />
        {items.map((i) => (
          <div key={i.id} className="mb-1">
            <div className="flex justify-between"><span>{Number(i.qty)} × {i.name}</span><span>{money(i.line_total)}</span></div>
            {i.variant_label && <div className="pl-3 text-charcoal/60">{i.variant_label}</div>}
            {i.modifiers?.length > 0 && <div className="pl-3 text-charcoal/60">{i.modifiers.map((m) => m.name).join(", ")}</div>}
            {Number(i.discount) > 0 && <div className="pl-3 text-charcoal/60">Descuento −{money(i.discount)}</div>}
          </div>
        ))}
        <div className="my-2 border-t border-dashed border-charcoal/40" />
        {Number(order.delivery_fee) > 0 && <div className="flex justify-between"><span>Domicilio</span><span>{money(order.delivery_fee)}</span></div>}
        <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{money(order.total)}</span></div>
        {Number(order.tip) > 0 && <div className="flex justify-between"><span>Propina voluntaria</span><span>{money(order.tip)}</span></div>}
        <div className="my-2 border-t border-dashed border-charcoal/40" />
        {order.payments.filter((p) => p.status === "approved").map((p) => (
          <div key={p.id} className="flex justify-between"><span>{p.payment_methods?.name}{p.reference ? ` (${p.reference})` : ""}</span><span>{money(p.amount)}</span></div>
        ))}
        {!!change && change > 0 && <div className="flex justify-between"><span>Vueltas</span><span>{money(change)}</span></div>}
        {byUnit.length > 1 && (<>
          <div className="my-2 border-t border-dashed border-charcoal/40" />
          {byUnit.map((u) => <div key={u.name} className="flex justify-between text-charcoal/70"><span>{u.name}</span><span>{money(u.total)}</span></div>)}
        </>)}
        <p className="mt-3 text-center">¡Gracias por visitarnos!</p>
      </div>
      <style>{`@media print { body * { visibility: hidden } #receipt, #receipt * { visibility: visible } #receipt { position: fixed; left: 0; top: 0; width: 80mm } }`}</style>
    </Modal>
  );
}

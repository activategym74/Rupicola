import { Loader2 } from "lucide-react";
import clsx from "clsx";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin text-burgundy", className)} size={20} />;
}
export function PageLoader() {
  return <div className="flex h-64 items-center justify-center"><Spinner /></div>;
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-charcoal">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-charcoal/60">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
export function Empty({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-line px-6 py-12 text-center">
      {icon && <div className="mb-3 text-sand">{icon}</div>}
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-charcoal/60">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function Stat({ label, value, hint, icon, tone = "default" }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: "default" | "burgundy" | "warn";
}) {
  return (
    <div className={clsx("card flex flex-col gap-1 p-4", tone === "burgundy" && "!border-burgundy/20 !bg-burgundy text-white")}>
      <div className="flex items-center justify-between">
        <span className={clsx("text-xs font-medium tracking-wide uppercase", tone === "burgundy" ? "text-sand" : "text-charcoal/55")}>{label}</span>
        {icon && <span className={tone === "burgundy" ? "text-sand" : tone === "warn" ? "text-amber-600" : "text-burgundy/70"}>{icon}</span>}
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className={clsx("text-xs", tone === "burgundy" ? "text-white/70" : "text-charcoal/55")}>{hint}</div>}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  // pedidos
  open: ["Abierto", "bg-sand-50 text-charcoal"], confirmed: ["Confirmado", "bg-blue-50 text-blue-800"],
  in_progress: ["En preparación", "bg-amber-50 text-amber-800"], ready: ["Listo", "bg-emerald-50 text-emerald-800"],
  delivered: ["Entregado", "bg-stone-100 text-stone-700"], paid: ["Pagado", "bg-emerald-600 text-white"],
  cancelled: ["Anulado", "bg-red-50 text-red-700"],
  // tickets
  received: ["Recibido", "bg-blue-50 text-blue-800"], accepted: ["Confirmado", "bg-indigo-50 text-indigo-800"],
  preparing: ["Preparando", "bg-amber-50 text-amber-800"], rejected: ["Rechazado", "bg-red-50 text-red-700"],
  // domicilios
  ready_for_dispatch: ["Listo para despacho", "bg-emerald-50 text-emerald-800"], courier_assigned: ["Domiciliario asignado", "bg-violet-50 text-violet-800"],
  picked_up: ["Recogido", "bg-violet-100 text-violet-900"], on_the_way: ["En camino", "bg-burgundy-50 text-burgundy"],
  // mesas
  available: ["Disponible", "bg-emerald-50 text-emerald-800"], occupied: ["Ocupada", "bg-sand-200 text-charcoal"],
  pending_order: ["Pedido pendiente", "bg-blue-50 text-blue-800"], order_ready: ["Pedido listo", "bg-emerald-100 text-emerald-900"],
  needs_attention: ["Solicita atención", "bg-amber-100 text-amber-900"], requesting_bill: ["Pide la cuenta", "bg-burgundy text-white"],
  // pagos
  approved: ["Aprobado", "bg-emerald-50 text-emerald-800"], pending: ["Pendiente", "bg-amber-50 text-amber-800"], voided: ["Anulado", "bg-red-50 text-red-700"],
};
export const statusLabel = (s: string) => STATUS[s]?.[0] ?? s;
export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, "bg-stone-100 text-stone-700"];
  return <span className={clsx("chip", cls)}>{label}</span>;
}

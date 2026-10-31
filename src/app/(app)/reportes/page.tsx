"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { FileSpreadsheet, FileText } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { daysAgo, today, money, num, errMsg } from "@/lib/format";
import { toExcel, toPDF } from "@/lib/export";
import { PageHeader, Spinner } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";

const REPORTS: { key: string; label: string; finance?: boolean }[] = [
  { key: "sales_by_date", label: "Ventas por fecha" }, { key: "sales_by_product", label: "Ventas por producto" }, { key: "sales_by_category", label: "Ventas por categoría" },
  { key: "sales_by_employee", label: "Ventas por empleado" }, { key: "sales_by_channel", label: "Presencial vs. domicilio" }, { key: "payment_methods", label: "Métodos de pago" },
  { key: "results", label: "Utilidad estimada por unidad", finance: true }, { key: "expenses", label: "Gastos", finance: true },
  { key: "inventory", label: "Inventario valorizado" }, { key: "inventory_movements", label: "Movimientos de inventario" },
  { key: "purchases", label: "Compras", finance: true }, { key: "suppliers", label: "Proveedores", finance: true },
  { key: "couriers", label: "Rendimiento de domiciliarios" }, { key: "prep_times", label: "Tiempo de preparación" },
  { key: "delivery_times", label: "Tiempo de entrega" }, { key: "cancelled", label: "Pedidos cancelados" },
];
const MONEY = /ingresos|costo|ventas|total|valor|propinas|pagado|saldo|gastos|revenue|cost|expenses|result|por_pagar|ticket/i;

export default function ReportsPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, units, can } = useApp();
  const [kind, setKind] = useState("sales_by_date");
  const [from, setFrom] = useState(daysAgo(29)), [to, setTo] = useState(today());
  const [unit, setUnit] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const { data, error } = await sb.rpc("report_rows", { p_business: businessId, p_kind: kind, p_from: from, p_to: to, p_unit: unit || null });
    if (error) { toast("error", errMsg(error)); setRows([]); } else setRows((data ?? []) as Record<string, unknown>[]);
  }, [sb, businessId, kind, from, to, unit, toast]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);

  const label = REPORTS.find((r) => r.key === kind)!.label;
  const sub = `${from} a ${to}${unit ? ` · ${units.find((u) => u.id === unit)?.name}` : ""}`;
  const cols = Object.keys(rows?.[0] ?? {});
  const fmt = (k: string, v: unknown) => (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) ? (MONEY.test(k) ? money(v as number) : num(v as number, 2)) : String(v ?? ""));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Reportes" subtitle="Filtre por fecha y unidad de negocio; descargue en Excel o PDF"
        actions={<>
          <button className="btn-secondary" disabled={!rows?.length} onClick={() => toExcel(label, rows!, `rupicola-${kind}-${from}-${to}`, sub)}><FileSpreadsheet size={16} /> Excel</button>
          <button className="btn-secondary" disabled={!rows?.length} onClick={() => toPDF(label, rows!, `rupicola-${kind}-${from}-${to}`, sub)}><FileText size={16} /> PDF</button>
        </>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="input !w-auto" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas las unidades</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="card h-fit p-2">{REPORTS.filter((r) => !r.finance || can("reports.finance")).map((r) =>
          <button key={r.key} onClick={() => setKind(r.key)} className={clsx("w-full rounded-lg px-3 py-2 text-left text-sm", kind === r.key ? "bg-burgundy text-white" : "hover:bg-sand-50")}>{r.label}</button>)}</div>
        <div className="card overflow-x-auto">
          {!rows ? <div className="flex h-40 items-center justify-center"><Spinner /></div> : rows.length === 0 ? <p className="p-10 text-center text-sm text-charcoal/50">Sin datos para el período</p> : (
            <table className="table-base"><thead><tr>{cols.map((c) => <th key={c}>{c.replace(/_/g, " ")}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === "number" ? "text-right" : ""}>{fmt(c, r[c])}</td>)}</tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}

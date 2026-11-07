import { money } from "@/lib/format";

export type UnitMethodRow = { unit: string; method: string; is_cash: boolean; total: number };

/** Cuadro negocio × medio de pago (efectivo, transferencia, tarjeta…) con totales. */
export function UnitMethodTable({ rows, empty = "Sin movimientos" }: { rows: UnitMethodRow[]; empty?: string }) {
  const clean = rows.filter((r) => Number(r.total) !== 0);
  if (clean.length === 0) return <p className="text-sm text-charcoal/50">{empty}</p>;
  const methods = [...new Map(clean.map((r) => [r.method, r.is_cash])).entries()].sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0])).map(([m]) => m);
  const units = [...new Set(clean.map((r) => r.unit))];
  const val = (u: string, m: string) => clean.filter((r) => r.unit === u && r.method === m).reduce((s, r) => s + Number(r.total), 0);
  const rowTotal = (u: string) => methods.reduce((s, m) => s + val(u, m), 0);
  const colTotal = (m: string) => units.reduce((s, u) => s + val(u, m), 0);
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead><tr><th>Negocio</th>{methods.map((m) => <th key={m} className="text-right">{m}</th>)}<th className="text-right">Total</th></tr></thead>
        <tbody>
          {units.map((u) => <tr key={u}><td className="font-medium">{u}</td>{methods.map((m) => <td key={m} className="text-right">{money(val(u, m))}</td>)}<td className="text-right font-semibold">{money(rowTotal(u))}</td></tr>)}
          <tr className="border-t-2 border-stone-line"><td className="font-semibold">Total</td>{methods.map((m) => <td key={m} className="text-right font-semibold">{money(colTotal(m))}</td>)}
            <td className="text-right font-semibold">{money(units.reduce((s, u) => s + rowTotal(u), 0))}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

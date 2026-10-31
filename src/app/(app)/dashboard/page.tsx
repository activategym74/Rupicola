"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import { TrendingUp, Utensils, Shirt, Receipt, ClipboardList, ChefHat, Bike, LayoutGrid, AlertTriangle, Wallet } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, num, daysAgo, today, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, Stat, Empty } from "@/components/ui/bits";
import { C, SERIES } from "@/components/charts/palette";
import { LogoMark } from "@/components/brand/logo";
import { useToast } from "@/components/ui/toast";

type Dash = {
  sales_today: number; sales_month: number; sales_range: number; cost_range: number; gastronomy_range: number; shop_range: number;
  expenses_today: number; expenses_range: number; tips_range: number; active_orders: number; kitchen_pending: number;
  deliveries_active: number; tables_occupied: number; tables_total: number; low_stock: number;
  cash_open: { register: string; opened_at: string; expected_cash: number }[];
  daily: { day: string; gastronomy: number | null; shop: number | null; total: number }[];
  expenses_daily: { day: string; total: number }[];
  top_products: { name: string; qty: number; total: number }[];
  by_category: { name: string; revenue: number; cost: number; margin: number }[];
  by_method: { name: string; total: number }[];
  by_employee: { name: string; orders: number; total: number }[];
};

const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const tip = { contentStyle: { borderRadius: 12, border: "1px solid #E7E2D8", fontSize: 12 }, formatter: (v: unknown) => money(Number(v)) };

function weekKey(d: string) {
  const dt = new Date(d + "T12:00:00"); const day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day);
  return dt.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const { businessId, units, current } = useApp();
  const toast = useToast();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [unit, setUnit] = useState("");
  const [d, setD] = useState<Dash | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("dashboard_summary", { p_business: businessId, p_from: from, p_to: to, p_unit: unit || null });
    if (error) toast("error", errMsg(error)); else setD(data as Dash);
  }, [businessId, from, to, unit, toast]);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (!d) return <PageLoader />;
  const profit = d.sales_range - d.cost_range - d.expenses_range;
  const weekly = Object.values(d.daily.reduce<Record<string, { week: string; total: number }>>((acc, r) => {
    const k = weekKey(r.day); acc[k] = acc[k] ?? { week: k.slice(5), total: 0 }; acc[k].total += Number(r.total); return acc;
  }, {}));
  const monthly = Object.values(d.daily.reduce<Record<string, { month: string; total: number }>>((acc, r) => {
    const k = r.day.slice(0, 7); acc[k] = acc[k] ?? { month: k, total: 0 }; acc[k].total += Number(r.total); return acc;
  }, {}));
  const expMap = Object.fromEntries(d.expenses_daily.map((e) => [e.day, Number(e.total)]));
  const incomeVsExp = d.daily.map((r) => ({ day: r.day.slice(5), ingresos: Number(r.total), gastos: expMap[r.day] ?? 0 }));
  const dist = [{ name: "Gastronomía", value: Number(d.gastronomy_range) }, { name: "Tienda", value: Number(d.shop_range) }].filter((x) => x.value > 0);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" subtitle={`Resumen de ${current?.business.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="input !w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
            <input type="date" className="input !w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
            <select className="input !w-auto" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unidad de negocio">
              <option value="">Todas las unidades</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        } />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat tone="burgundy" label="Ventas del día" value={money(d.sales_today)} hint={`Mes: ${money(d.sales_month)}`} icon={<TrendingUp size={18} />} />
        <Stat label="Gastronomía" value={money(d.gastronomy_range)} hint="En el período" icon={<Utensils size={18} />} />
        <Stat label="Tienda" value={money(d.shop_range)} hint="En el período" icon={<Shirt size={18} />} />
        <Stat label="Resultado estimado" value={money(profit)} hint={`Gastos: ${money(d.expenses_range)} · hoy ${money(d.expenses_today)}`} icon={<Receipt size={18} />} />
        <Stat label="Pedidos activos" value={num(d.active_orders)} icon={<ClipboardList size={18} />} />
        <Stat label="Pendientes de cocina" value={num(d.kitchen_pending)} icon={<ChefHat size={18} />} />
        <Stat label="Domicilios en curso" value={num(d.deliveries_active)} icon={<Bike size={18} />} />
        <Stat label="Mesas ocupadas" value={`${d.tables_occupied} / ${d.tables_total}`} icon={<LayoutGrid size={18} />} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="card flex items-center gap-4 p-4">
          <Wallet className="text-burgundy" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Estado de caja</div>
            {d.cash_open.length === 0 ? <div className="text-charcoal/60">No hay cajas abiertas</div> :
              d.cash_open.map((c) => <div key={c.register} className="text-charcoal/70">{c.register}: abierta · efectivo esperado {money(c.expected_cash)}</div>)}
          </div>
        </div>
        <div className={`card flex items-center gap-4 p-4 ${d.low_stock > 0 ? "!border-amber-300" : ""}`}>
          <AlertTriangle className={d.low_stock > 0 ? "text-amber-600" : "text-charcoal/30"} />
          <div className="text-sm"><div className="font-medium">Inventario bajo</div>
            <div className="text-charcoal/60">{d.low_stock > 0 ? `${d.low_stock} artículos en o bajo el mínimo` : "Todo en niveles correctos"}</div></div>
        </div>
      </div>

      {d.daily.length === 0 ? (
        <div className="mt-6"><Empty icon={<LogoMark size={48} />} title="Aún no hay ventas en este período" text="Cuando se registren ventas pagadas, aquí verá los gráficos por unidad de negocio." /></div>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-3">
          <ChartCard title="Ventas diarias por unidad" className="xl:col-span-2">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={d.daily.map((r) => ({ ...r, day: r.day.slice(5) }))}>
                <CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={short} fontSize={11} tickLine={false} axisLine={false} width={40} /><Tooltip {...tip} /><Legend iconType="circle" />
                <Bar dataKey="gastronomy" name="Gastronomía" stackId="a" fill={C.burgundy} radius={[0, 0, 0, 0]} />
                <Bar dataKey="shop" name="Tienda" stackId="a" fill={C.sand} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Distribución de ingresos">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart><Pie data={dist} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                {dist.map((_, i) => <Cell key={i} fill={[C.burgundy, C.sand][i]} />)}</Pie><Tooltip {...tip} /><Legend iconType="circle" /></PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Ventas semanales">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekly}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="week" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={short} fontSize={11} width={40} tickLine={false} axisLine={false} /><Tooltip {...tip} /><Bar dataKey="total" name="Ventas" fill={C.burgundy} radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Ventas mensuales">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={short} fontSize={11} width={40} tickLine={false} axisLine={false} /><Tooltip {...tip} /><Bar dataKey="total" name="Ventas" fill={C.charcoal} radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Ingresos frente a gastos">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={incomeVsExp}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={short} fontSize={11} width={40} tickLine={false} axisLine={false} /><Tooltip {...tip} /><Legend iconType="circle" />
                <Area dataKey="ingresos" name="Ingresos" stroke={C.burgundy} fill={C.burgundy} fillOpacity={0.12} strokeWidth={2} />
                <Area dataKey="gastos" name="Gastos" stroke={C.muted} fill={C.muted} fillOpacity={0.1} strokeWidth={2} /></AreaChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Productos más vendidos">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={d.top_products} layout="vertical" margin={{ left: 10 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={120} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tip.contentStyle} formatter={(v: unknown) => num(Number(v))} /><Bar dataKey="qty" name="Unidades" fill={C.burgundy} radius={[0, 6, 6, 0]} /></BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Rentabilidad por categoría">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={d.by_category}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-20} height={50} textAnchor="end" />
                <YAxis tickFormatter={short} fontSize={11} width={40} tickLine={false} axisLine={false} /><Tooltip {...tip} /><Legend iconType="circle" />
                <Bar dataKey="cost" name="Costo" stackId="a" fill={C.sandLight} /><Bar dataKey="margin" name="Margen" stackId="a" fill={C.burgundy} radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Métodos de pago">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart><Pie data={d.by_method} dataKey="total" nameKey="name" outerRadius={90}>
                {d.by_method.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}</Pie><Tooltip {...tip} /><Legend iconType="circle" /></PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Rendimiento por empleado">
            <table className="table-base"><thead><tr><th>Empleado</th><th className="text-right">Pedidos</th><th className="text-right">Ventas</th></tr></thead>
              <tbody>{d.by_employee.length === 0 ? <tr><td colSpan={3} className="text-center text-charcoal/50">Sin datos</td></tr> :
                d.by_employee.map((e) => <tr key={e.name}><td>{e.name}</td><td className="text-right">{e.orders}</td><td className="text-right">{money(e.total)}</td></tr>)}</tbody></table>
          </ChartCard>
        </div>
      )}
      <p className="mt-6 text-xs text-charcoal/50">Indicadores administrativos estimados (ingresos − costo de productos − gastos asignados). No reemplazan los estados financieros ni la contabilidad oficial. Propinas del período: {money(d.tips_range)}.</p>
    </div>
  );
}

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return <div className={`card p-4 ${className ?? ""}`}><h3 className="mb-3 text-sm font-medium text-charcoal/80">{title}</h3>{children}</div>;
}

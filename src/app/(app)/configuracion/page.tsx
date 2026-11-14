"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, Trash2, Upload, ExternalLink, Copy } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, dateTime, errMsg } from "@/lib/format";
import { PageHeader, PageLoader } from "@/components/ui/bits";
import { LogoMark } from "@/components/brand/logo";
import { useToast } from "@/components/ui/toast";

type Biz = Record<string, unknown> & { id: string; name: string; slug: string; logo_url: string | null; opening_hours: Record<string, string>; brand_colors: Record<string, string> };
const TABS = [["general", "Establecimiento"], ["ops", "Operación"], ["tables", "Mesas"], ["stations", "Estaciones"], ["payments", "Métodos de pago"], ["zones", "Domicilios y cobertura"], ["notifications", "Notificaciones"], ["accounts", "Otros negocios"]] as const;
const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export default function SettingsPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, units, reload } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("general");
  const [biz, setBiz] = useState<Biz | null>(null);
  const [unitRows, setUnitRows] = useState<{ id: string; kind: string; name: string; shared_expense_pct: number }[]>([]);
  const gUnit = unitRows.find((u) => u.kind === "gastronomy"), sUnit = unitRows.find((u) => u.kind === "shop");

  const load = useCallback(async () => {
    const { data } = await sb.from("businesses").select("*").eq("id", businessId).single();
    setBiz(data as Biz);
    const { data: us } = await sb.from("business_units").select("id, kind, name, shared_expense_pct").eq("business_id", businessId);
    setUnitRows(us ?? []);
  }, [sb, businessId]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  if (!biz) return <PageLoader />;

  async function saveBiz(patch: Record<string, unknown>) {
    const { error } = await sb.from("businesses").update(patch).eq("id", businessId);
    if (error) toast("error", errMsg(error)); else { toast("success", "Configuración guardada"); load(); reload(); }
  }
  const site = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin) : "";

  return (
    <div className="animate-fade-in">
      <PageHeader title="Configuración" subtitle="Información, operación, mesas, estaciones, pagos, domicilios y notificaciones" />
      <div className="scrollbar-thin mb-4 flex gap-2 overflow-x-auto">{TABS.map(([k, l]) =>
        <button key={k} onClick={() => setTab(k)} className={clsx("chip shrink-0 border !px-3 !py-1.5", tab === k ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{l}</button>)}</div>

      {tab === "general" && (
        <form className="card grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_220px]" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          const hours = Object.fromEntries(DAYS.map((d) => [d, String(f.get(`h-${d}`) ?? "")]));
          saveBiz({ name: f.get("name"), legal_name: f.get("legal_name") || null, tax_id: f.get("tax_id") || null, phone: f.get("phone") || null, email: f.get("email") || null,
            address: f.get("address") || null, city: f.get("city") || null, opening_hours: hours, receipt_header: f.get("receipt_header") || null, receipt_footer: f.get("receipt_footer") || null,
            brand_colors: { primary: f.get("c1"), sand: f.get("c2"), ivory: f.get("c3"), charcoal: f.get("c4") } });
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["name", "Nombre comercial"], ["legal_name", "Razón social"], ["tax_id", "NIT"], ["phone", "Teléfono"], ["email", "Correo"], ["address", "Dirección"], ["city", "Ciudad"]] as const).map(([k, l]) =>
              <div key={k}><label className="label">{l}</label><input name={k} defaultValue={String(biz[k] ?? "")} required={k === "name"} className="input" /></div>)}
            <div className="sm:col-span-2"><label className="label">Horarios</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{DAYS.map((d) => <div key={d}><span className="text-xs text-charcoal/60">{d}</span><input name={`h-${d}`} defaultValue={biz.opening_hours?.[d] ?? ""} placeholder="12:00–22:00" className="input !py-1" /></div>)}</div></div>
            <div><label className="label">Encabezado del comprobante</label><input name="receipt_header" defaultValue={String(biz.receipt_header ?? "")} className="input" /></div>
            <div><label className="label">Pie del comprobante</label><input name="receipt_footer" defaultValue={String(biz.receipt_footer ?? "")} className="input" /></div>
            <div className="sm:col-span-2"><label className="label">Colores corporativos</label><div className="flex gap-3">
              {(["c1", "c2", "c3", "c4"] as const).map((c, i) => <input key={c} type="color" name={c} defaultValue={Object.values(biz.brand_colors ?? {})[i] ?? "#791522"} className="h-10 w-14 rounded-lg border border-stone-line" />)}</div></div>
          </div>
          <div className="space-y-3">
            <div className="label">Logo</div>
            <div className="flex aspect-square items-center justify-center rounded-2xl bg-ivory">{biz.logo_url ? <img src={biz.logo_url} alt="Logo" className="h-4/5 w-4/5 object-contain" /> : <LogoMark size={140} />}</div>
            <label className="btn-secondary w-full cursor-pointer"><Upload size={16} /> Cambiar logo<input type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              const path = `${businessId}/logo-${Date.now()}.${file.name.split(".").pop()}`;
              const { error } = await sb.storage.from("branding").upload(path, file);
              if (error) return toast("error", errMsg(error));
              saveBiz({ logo_url: sb.storage.from("branding").getPublicUrl(path).data.publicUrl });
            }} /></label>
            {biz.logo_url && <button type="button" className="text-xs text-charcoal/60" onClick={() => saveBiz({ logo_url: null })}>Usar logo original vectorizado</button>}
            <div className="rounded-xl bg-sand-50 p-3 text-xs">
              <div className="label">Enlaces públicos</div>
              <LinkRow label="Tienda / domicilios" url={`${site}/tienda/${biz.slug}`} />
            </div>
          </div>
          <div className="md:col-span-2"><button className="btn-primary">Guardar</button></div>
        </form>
      )}

      {tab === "ops" && (
        <form className="card grid gap-4 p-5 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          await saveBiz({ inventory_policy: f.get("policy"), tip_suggested_pct: Number(f.get("tip")), delivery_enabled: f.get("delivery") === "on", pickup_enabled: f.get("pickup") === "on",
            loyalty_enabled: f.get("loyalty") === "on", loyalty_points_per_1000: Number(f.get("points")),
            loyalty_point_value: Number(f.get("point_value")), loyalty_min_redeem: Number(f.get("min_redeem")) });
          const g = units.find((u) => u.kind === "gastronomy"), s = units.find((u) => u.kind === "shop");
          const pct = Number(f.get("split"));
          const r1 = await sb.from("business_units").update({ shared_expense_pct: pct, name: String(f.get("g_name") || g!.name).trim() }).eq("id", g!.id);
          const r2 = await sb.from("business_units").update({ shared_expense_pct: 100 - pct, name: String(f.get("s_name") || s!.name).trim() }).eq("id", s!.id);
          if (r1.error || r2.error) toast("error", errMsg(r1.error ?? r2.error)); else { load(); reload(); }
        }}>
          <div><label className="label">Nombre del negocio de comida</label><input name="g_name" defaultValue={gUnit?.name ?? ""} placeholder="Rupícola" className="input" /></div>
          <div><label className="label">Nombre de la tienda</label><input name="s_name" defaultValue={sUnit?.name ?? ""} placeholder="Tienda" className="input" />
            <p className="mt-1 text-xs text-charcoal/50">Aquí se venden los productos de proveedores en consignación. El % de cada proveedor se define en Compras y proveedores.</p></div>
          <div><label className="label">Descuento de inventario</label><select name="policy" defaultValue={String(biz.inventory_policy)} className="input">
            <option value="on_payment">Al pagar la venta</option><option value="on_confirm">Al confirmar / enviar el pedido</option></select></div>
          <div><label className="label">Propina sugerida %</label><input name="tip" type="number" step="0.5" defaultValue={Number(biz.tip_suggested_pct)} className="input" /></div>
          <div><label className="label">Gastos compartidos: % a {gUnit?.name ?? "gastronomía"}</label><input name="split" type="number" min={0} max={100} defaultValue={Number(gUnit?.shared_expense_pct ?? 100)} className="input" />
            <p className="mt-1 text-xs text-charcoal/50">El resto se asigna a {sUnit?.name ?? "la tienda"}. Si la marca no asume gastos, deje 100.</p></div>
          <div><label className="label">Puntos que gana el cliente por cada $1.000</label><input name="points" type="number" step="0.1" defaultValue={Number(biz.loyalty_points_per_1000)} className="input" /></div>
          <div><label className="label">Valor de cada punto al canjear ($)</label><input name="point_value" type="number" min={0} step="1" defaultValue={Number(biz.loyalty_point_value ?? 10)} className="input" />
            <p className="mt-1 text-xs text-charcoal/50">Ejemplo: con 1 punto por $1.000 y valor de $10, el cliente recupera el 1 % de lo que compra.</p></div>
          <div><label className="label">Mínimo de puntos para canjear</label><input name="min_redeem" type="number" min={1} step="1" defaultValue={Number(biz.loyalty_min_redeem ?? 100)} className="input" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="delivery" defaultChecked={!!biz.delivery_enabled} /> Recibir pedidos a domicilio</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pickup" defaultChecked={!!biz.pickup_enabled} /> Permitir recoger en el local</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="loyalty" defaultChecked={!!biz.loyalty_enabled} /> Activar programa de fidelización (puntos)</label>
          <div className="sm:col-span-2"><button className="btn-primary">Guardar</button></div>
        </form>
      )}

      {tab === "tables" && <Crud table="dining_tables" order="number" businessId={businessId}
        cols={[{ k: "number", l: "Número", type: "number" }, { k: "name", l: "Nombre" }, { k: "zone", l: "Zona" }, { k: "seats", l: "Puestos", type: "number" },
          { k: "pos_x", l: "Columna", type: "number" }, { k: "pos_y", l: "Fila", type: "number" }, { k: "shape", l: "Forma", options: [["square", "Cuadrada"], ["round", "Redonda"], ["bar", "Barra"]] }, { k: "active", l: "Activa", type: "bool" }]}
        blank={{ zone: "Salón", seats: 4, shape: "square", pos_x: 0, pos_y: 0, active: true }}
        note="El plano se dibuja con columna y fila. El código QR de cada mesa se descarga desde el módulo Mesas." />}
      {tab === "stations" && <Crud table="stations" order="name" businessId={businessId}
        cols={[{ k: "code", l: "Código (kitchen, bar, cafe…)" }, { k: "name", l: "Nombre" }, { k: "active", l: "Activa", type: "bool" }]} blank={{ active: true }}
        note="Para una estación nueva, cree también un permiso kds.<código> asignándolo a un rol (los códigos kitchen, bar y cafe ya existen)." />}
      {tab === "payments" && <Crud table="payment_methods" order="sort" businessId={businessId}
        cols={[{ k: "name", l: "Nombre" }, { k: "code", l: "Código" }, { k: "is_cash", l: "Efectivo", type: "bool" }, { k: "requires_reference", l: "Exige referencia", type: "bool" },
          { k: "available_online", l: "Tienda en línea", type: "bool" }, { k: "active", l: "Activo", type: "bool" }, { k: "sort", l: "Orden", type: "number" }]}
        blank={{ active: true, sort: 10 }}
        note="“Pago en línea” usa Wompi y requiere credenciales en el servidor; sin ellas no se ofrece al cliente. Los demás métodos se registran manualmente en caja." />}
      {tab === "zones" && <Crud table="delivery_zones" order="name" businessId={businessId}
        cols={[{ k: "name", l: "Zona" }, { k: "fee", l: "Costo envío", type: "number" }, { k: "min_order", l: "Pedido mínimo", type: "number" }, { k: "eta_minutes", l: "Minutos", type: "number" },
          { k: "center_lat", l: "Latitud centro", type: "number" }, { k: "center_lng", l: "Longitud centro", type: "number" }, { k: "radius_km", l: "Radio km", type: "number" }, { k: "active", l: "Activa", type: "bool" }]}
        blank={{ fee: 0, min_order: 0, eta_minutes: 45, active: true }}
        note="Cobertura por radio desde un punto (centro). Si no hay zonas, se acepta cualquier dirección y el costo se define al confirmar el pedido." />}
      {tab === "notifications" && <Notifications businessId={businessId} />}
      {tab === "accounts" && <ExtraBusiness />}
    </div>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return <div className="mt-1 flex items-center gap-1"><span className="flex-1 truncate">{label}: <a href={url} target="_blank" rel="noreferrer" className="text-burgundy">{url}</a></span>
    <button type="button" onClick={() => navigator.clipboard.writeText(url)} aria-label="Copiar"><Copy size={12} /></button><a href={url} target="_blank" rel="noreferrer"><ExternalLink size={12} /></a></div>;
}

type Col = { k: string; l: string; type?: "number" | "bool"; options?: [string, string][] };
/** Editor de tabla genérico para maestros de configuración (RLS: settings.manage) */
function Crud({ table, cols, blank, order, businessId, note }: { table: string; cols: Col[]; blank: Record<string, unknown>; order: string; businessId: string; note?: string }) {
  const sb = supabaseBrowser();
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const load = useCallback(async () => { const { data } = await sb.from(table).select("*").eq("business_id", businessId).order(order); setRows(data ?? []); }, [sb, table, businessId, order]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <PageLoader />;
  const up = (i: number, k: string, v: unknown) => setRows((s) => s!.map((r, j) => j === i ? { ...r, [k]: v, _dirty: true } : r));
  async function save() {
    for (const r of rows!.filter((x) => x._dirty)) {
      const clean = Object.fromEntries(Object.entries(r).filter(([k]) => cols.some((c) => c.k === k)).map(([k, v]) => [k, v === "" ? null : v]));
      const { error } = r.id ? await sb.from(table).update(clean).eq("id", r.id as string) : await sb.from(table).insert({ ...clean, business_id: businessId });
      if (error) { toast("error", `${errMsg(error)}`); return; }
    }
    toast("success", "Guardado"); load();
  }
  return (
    <div className="card p-4">
      {note && <p className="mb-3 text-xs text-charcoal/60">{note}</p>}
      <div className="overflow-x-auto"><table className="table-base"><thead><tr>{cols.map((c) => <th key={c.k}>{c.l}</th>)}<th></th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={(r.id as string) ?? `n${i}`}>{cols.map((c) => <td key={c.k}>
          {c.type === "bool" ? <input type="checkbox" checked={!!r[c.k]} onChange={(e) => up(i, c.k, e.target.checked)} /> :
            c.options ? <select className="input !py-1" value={String(r[c.k] ?? "")} onChange={(e) => up(i, c.k, e.target.value)}>{c.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> :
            <input className="input !min-w-20 !py-1" type={c.type === "number" ? "number" : "text"} step="any" value={String(r[c.k] ?? "")} onChange={(e) => up(i, c.k, c.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />}
        </td>)}<td>{!r.id && <button className="btn-ghost !p-1" onClick={() => setRows((s) => s!.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}</td></tr>)}</tbody></table></div>
      <div className="mt-3 flex gap-2"><button className="btn-secondary" onClick={() => setRows((s) => [...s!, { ...blank, _dirty: true }])}><Plus size={16} /> Agregar</button><button className="btn-primary" onClick={save}>Guardar cambios</button></div>
    </div>
  );
}

function Notifications({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<{ id: string; recipient: string; status: string; last_error: string | null; created_at: string; payload: { message?: string; order_number?: number } }[] | null>(null);
  useEffect(() => { supabaseBrowser().from("notification_outbox").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(100).then(({ data }: { data: typeof rows }) => setRows(data ?? [])); }, [businessId]);
  if (!rows) return <PageLoader />;
  return (
    <div className="card p-4">
      <p className="mb-3 text-sm text-charcoal/70">Los cambios de estado de domicilios se encolan como mensajes de WhatsApp al cliente. Se envían solo si el servidor tiene configurada la WhatsApp Business Platform
        (variables <code>WHATSAPP_TOKEN</code> y <code>WHATSAPP_PHONE_NUMBER_ID</code>) y una plantilla aprobada. Sin credenciales quedan como “omitido”, nunca como enviados.
        El personal recibe notificaciones web en tiempo real (campana superior).</p>
      <table className="table-base"><thead><tr><th>Fecha</th><th>Destino</th><th>Mensaje</th><th>Estado</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{dateTime(r.created_at)}</td><td>{r.recipient}</td><td className="text-xs">#{r.payload.order_number} {r.payload.message}</td>
          <td><span className={clsx("chip", r.status === "sent" ? "bg-emerald-50 text-emerald-800" : r.status === "failed" ? "bg-red-50 text-red-700" : "bg-sand-50")}>{({ pending: "Pendiente", sent: "Enviado", failed: "Fallido", skipped: "Omitido" } as Record<string, string>)[r.status]}</span>
            {r.last_error && <div className="text-[10px] text-charcoal/50">{r.last_error.slice(0, 80)}</div>}</td></tr>)}</tbody></table>
      <span className="hidden">{money(0)}</span>
    </div>
  );
}

/** Crea una cuenta separada (p. ej. Mi Tierra como marca) que se cambia desde el selector del menú */
function ExtraBusiness() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { memberships, reload, switchBusiness } = useApp();
  const [busy, setBusy] = useState(false);
  const slugify = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="card space-y-3 p-5" onSubmit={async (e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        const name = String(f.get("name") || "").trim(); if (!name) return;
        setBusy(true);
        const { data, error } = await sb.rpc("create_extra_business", { p_name: name, p_slug: slugify(String(f.get("slug") || name)), p_profile: String(f.get("profile")) });
        setBusy(false);
        if (error) return toast("error", errMsg(error).includes("duplicate") ? "Ya existe un negocio con ese enlace; cambie el identificador" : errMsg(error));
        toast("success", `${name} creado. Ya puede cambiar de negocio desde el menú.`);
        await reload(); switchBusiness(String(data));
      }}>
        <h3 className="font-medium">Crear otro negocio</h3>
        <p className="text-sm text-charcoal/60">Cada negocio lleva su propio inventario, gastos, caja y reportes, sin mezclarse con los demás. Usted queda como administrador y cambia entre ellos con el selector del menú.</p>
        <div><label className="label">Nombre</label><input name="name" required placeholder="Mi Tierra" className="input" /></div>
        <div><label className="label">Identificador del enlace</label><input name="slug" placeholder="mi-tierra" className="input" /></div>
        <div><label className="label">Tipo</label><select name="profile" className="input" defaultValue="brand">
          <option value="brand">Marca que lleva productos a establecimientos aliados</option>
          <option value="restaurant">Restaurante o local con tienda</option></select></div>
        <button className="btn-primary" disabled={busy}><Plus size={16} /> Crear negocio</button>
      </form>
      <div className="card p-5">
        <h3 className="mb-2 font-medium">Mis negocios</h3>
        <ul className="space-y-2 text-sm">{memberships.map((m) => <li key={m.business.id} className="flex justify-between rounded-lg bg-sand-50 px-3 py-2">
          <span>{m.business.name}</span><span className="text-charcoal/60">{m.business.profile === "brand" ? "Marca con aliados" : "Restaurante"} · {m.role.name}</span></li>)}</ul>
      </div>
    </div>
  );
}

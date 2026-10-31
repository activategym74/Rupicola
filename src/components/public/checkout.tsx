"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { LocateFixed, Bike, Store, MapPin } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, errMsg } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import type { PubMenu, PubLine } from "./types";

const MapPicker = dynamic(() => import("./map-picker"), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-sand-50" /> });

type Saved = { label: string; address: string; details: string; lat: number | null; lng: number | null };
const SAVED_KEY = "rupicola.addresses";
const PROFILE_KEY = "rupicola.profile";
const ONLINE_ENABLED = !!process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY;

function inZone(z: PubMenu["zones"][number], lat: number, lng: number) {
  if (z.radius_km && z.center_lat != null && z.center_lng != null) {
    const R = 6371, dLat = ((lat - z.center_lat) * Math.PI) / 180, dLng = ((lng - z.center_lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((z.center_lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a)) <= Number(z.radius_km);
  }
  if (!z.polygon || z.polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = z.polygon.length - 1; i < z.polygon.length; j = i++) {
    const [xi, yi] = z.polygon[i], [xj, yj] = z.polygon[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Datos del cliente, dirección con mapa, tipo de entrega y pago. */
export function Checkout({ menu, lines, total, payload, onDone }: { menu: PubMenu; lines: PubLine[]; total: number; payload: () => unknown; onDone: () => void }) {
  const sb = supabaseBrowser();
  const toast = useToast();
  const router = useRouter();
  const [mode, setMode] = useState<"delivery" | "pickup">(menu.business.delivery_enabled ? "delivery" : "pickup");
  const [profile, setProfile] = useState({ full_name: "", phone: "", email: "" });
  const [addr, setAddr] = useState<Saved>({ label: "Casa", address: "", details: "", lat: null, lng: null });
  const [saved, setSaved] = useState<Saved[]>([]);
  const methods = menu.payment_methods.filter((m) => !m.gateway || ONLINE_ENABLED);
  const [method, setMethod] = useState(methods[0]?.id ?? "");
  const [change, setChange] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]")); setProfile((p) => ({ ...p, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}") })); } catch {}
  }, []);

  const zone = useMemo(() => addr.lat != null ? menu.zones.filter((z) => inZone(z, addr.lat!, addr.lng!)).sort((a, b) => a.fee - b.fee)[0] : undefined, [addr, menu.zones]);
  const fee = mode === "delivery" ? Number(zone?.fee ?? 0) : 0;
  const center: [number, number] = menu.zones[0]?.center_lat ? [menu.zones[0].center_lat!, menu.zones[0].center_lng!] : [4.711, -74.0721];
  const outOfZone = mode === "delivery" && addr.lat != null && menu.zones.length > 0 && !zone;
  const pm = methods.find((m) => m.id === method);

  function locate() {
    if (!navigator.geolocation) return toast("error", "Su navegador no permite obtener la ubicación");
    navigator.geolocation.getCurrentPosition(
      (p) => setAddr((a) => ({ ...a, lat: p.coords.latitude, lng: p.coords.longitude })),
      () => toast("error", "No fue posible obtener su ubicación. Márquela en el mapa."), { enableHighAccuracy: true, timeout: 10000 });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "delivery" && menu.zones.length > 0 && addr.lat == null) return toast("error", "Marque su ubicación en el mapa");
    if (outOfZone) return toast("error", "La ubicación está fuera de la zona de cobertura");
    setBusy(true);
    const { data, error } = await sb.rpc("shop_place_order", { p_slug: menu.business.slug, p: {
      customer: profile, fulfillment: mode, payment_method_id: method, notes, cash_change_for: change || null, zone_id: zone?.id,
      address: mode === "delivery" ? { ...addr, save: true } : undefined, items: payload(),
    } });
    if (error) { setBusy(false); return toast("error", errMsg(error)); }
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      if (mode === "delivery" && !saved.some((s) => s.address === addr.address)) localStorage.setItem(SAVED_KEY, JSON.stringify([addr, ...saved].slice(0, 5)));
      const mine = JSON.parse(localStorage.getItem("rupicola.orders") ?? "[]");
      localStorage.setItem("rupicola.orders", JSON.stringify([{ token: data.tracking_token, number: data.number, at: Date.now() }, ...mine].slice(0, 10)));
    } catch {}
    onDone();
    if (data.requires_gateway) {
      const r = await fetch(`/api/payments/wompi/checkout?token=${data.tracking_token}`);
      const j = await r.json();
      if (j.url) { window.location.href = j.url; return; }
      toast("error", j.error ?? "La pasarela de pagos no está disponible");
    }
    router.push(`/pedido/${data.tracking_token}`);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {menu.business.delivery_enabled && <ModeBtn on={mode === "delivery"} onClick={() => setMode("delivery")} icon={<Bike size={18} />} label="Domicilio" />}
        {menu.business.pickup_enabled && <ModeBtn on={mode === "pickup"} onClick={() => setMode("pickup")} icon={<Store size={18} />} label="Recoger en el local" />}
      </div>
      <fieldset className="space-y-2">
        <legend className="label">Tus datos</legend>
        <input className="input" required placeholder="Nombre completo" value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} autoComplete="name" />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" required type="tel" placeholder="Celular" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} autoComplete="tel" />
          <input className="input" type="email" placeholder="Correo (opcional)" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} autoComplete="email" />
        </div>
      </fieldset>
      {mode === "delivery" && (
        <fieldset className="space-y-2">
          <legend className="label">Dirección de entrega</legend>
          {saved.length > 0 && <div className="flex flex-wrap gap-2">{saved.map((s, i) => (
            <button type="button" key={i} onClick={() => setAddr(s)} className="chip border border-stone-line bg-white !py-1"><MapPin size={12} /> {s.label || s.address}</button>))}</div>}
          <input className="input" required placeholder="Dirección (ej: Cra 7 # 12-34)" value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} autoComplete="street-address" />
          <input className="input" placeholder="Indicaciones: apto, torre, punto de referencia" value={addr.details} onChange={(e) => setAddr({ ...addr, details: e.target.value })} />
          <div className="flex items-center justify-between text-xs text-charcoal/60"><span>Toca el mapa para marcar tu ubicación exacta</span>
            <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={locate}><LocateFixed size={14} /> Usar mi ubicación</button></div>
          <MapPicker value={addr.lat != null ? { lat: addr.lat, lng: addr.lng! } : null} onChange={(lat, lng) => setAddr({ ...addr, lat, lng })} zones={menu.zones} center={center} />
          {zone && <p className="text-xs text-emerald-700">Zona {zone.name} · envío {money(zone.fee)} · ~{zone.eta_minutes} min</p>}
          {outOfZone && <p className="text-xs text-red-700">Lo sentimos, esta ubicación está fuera de nuestra zona de cobertura.</p>}
        </fieldset>
      )}
      <fieldset className="space-y-2">
        <legend className="label">Pago</legend>
        {methods.length === 0 && <p className="text-sm text-red-700">No hay métodos de pago en línea habilitados.</p>}
        {methods.map((m) => (
          <label key={m.id} className={clsx("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm", method === m.id ? "border-burgundy bg-burgundy-50" : "border-stone-line")}>
            <input type="radio" name="pm" checked={method === m.id} onChange={() => setMethod(m.id)} />
            {m.name}{m.is_cash && mode === "delivery" ? " contra entrega" : ""}
          </label>
        ))}
        {pm?.is_cash && mode === "delivery" && <input className="input" inputMode="numeric" placeholder="¿Con cuánto pagas? (para llevar el cambio)" value={change} onChange={(e) => setChange(e.target.value.replace(/[^0-9]/g, ""))} />}
      </fieldset>
      <textarea className="input" rows={2} maxLength={300} placeholder="Notas para el pedido (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="space-y-1 rounded-xl bg-sand-50 p-4 text-sm">
        <div className="flex justify-between"><span>Productos ({lines.reduce((s, l) => s + l.qty, 0)})</span><span>{money(total)}</span></div>
        {mode === "delivery" && <div className="flex justify-between"><span>Domicilio</span><span>{zone ? money(fee) : menu.zones.length ? "Marca tu ubicación" : "Por confirmar"}</span></div>}
        <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{money(total + fee)}</span></div>
      </div>
      <button className="btn-primary w-full !py-3" disabled={busy || lines.length === 0 || !method || outOfZone}>{busy ? "Enviando…" : "Confirmar pedido"}</button>
    </form>
  );
}
function ModeBtn({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button type="button" onClick={onClick} className={clsx("flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium", on ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{icon}{label}</button>;
}

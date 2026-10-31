"use client";
import { use, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { Check, Phone } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, time } from "@/lib/format";
import { Logo } from "@/components/brand/logo";
import { PageLoader } from "@/components/ui/bits";

const MapPicker = dynamic(() => import("@/components/public/map-picker"), { ssr: false });

type Track = {
  number: number; channel: string; status: string; created_at: string; customer_name: string; total: number; delivery_fee: number; paid_total: number;
  business: { name: string; phone: string | null };
  items: { name: string; variant: string | null; qty: number; line_total: number }[];
  delivery: { status: string; address: string; courier: string | null; events: { status: string; at: string }[] | null; location: { lat: number; lng: number; at: string } | null } | null;
};

const STEPS_DELIVERY = [
  { key: "received", label: "Pedido recibido" }, { key: "confirmed", label: "Pedido confirmado" }, { key: "preparing", label: "Preparando" },
  { key: "ready_for_dispatch", label: "Listo" }, { key: "on_the_way", label: "En camino" }, { key: "delivered", label: "Entregado" },
];
const ORDER = ["received", "confirmed", "preparing", "ready_for_dispatch", "courier_assigned", "picked_up", "on_the_way", "delivered"];

/** Seguimiento público del pedido, se actualiza solo. */
export default function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [t, setT] = useState<Track | null | undefined>(undefined);
  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("public_track", { p_token: token });
    setT((data as Track) ?? null);
  }, [token]);
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  if (t === undefined) return <PageLoader />;
  if (t === null) return <div className="p-10 text-center">Pedido no encontrado</div>;
  const ds = t.delivery?.status ?? "received";
  const steps = t.channel === "pickup" ? STEPS_DELIVERY.filter((s) => s.key !== "on_the_way").map((s) => s.key === "ready_for_dispatch" ? { ...s, label: "Listo para recoger" } : s) : STEPS_DELIVERY;
  const idx = ORDER.indexOf(ds);
  const at = (k: string) => t.delivery?.events?.find((e) => e.status === k)?.at;

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 py-6">
      <Logo size={44} />
      <div className="card mt-6 p-5">
        <div className="flex items-start justify-between">
          <div><div className="text-sm text-charcoal/60">Pedido</div><div className="font-display text-3xl font-semibold">#{t.number}</div></div>
          {ds === "cancelled" ? <span className="chip bg-red-50 text-red-700">Cancelado</span> : <span className="chip bg-burgundy text-white">{ds === "delivered" ? "Entregado" : "En curso"}</span>}
        </div>
        {ds !== "cancelled" && (
          <ol className="mt-6 space-y-0">
            {steps.map((s, i) => {
              const done = ORDER.indexOf(s.key) <= idx || (s.key === "on_the_way" && idx >= ORDER.indexOf("on_the_way"));
              const ts = at(s.key) ?? (s.key === "on_the_way" ? at("picked_up") : undefined);
              return (
                <li key={s.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={clsx("flex h-7 w-7 items-center justify-center rounded-full border-2 transition", done ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>
                      {done && <Check size={14} />}</div>
                    {i < steps.length - 1 && <div className={clsx("h-8 w-0.5", done ? "bg-burgundy" : "bg-stone-line")} />}
                  </div>
                  <div className="pt-1 text-sm"><div className={done ? "font-medium" : "text-charcoal/50"}>{s.label}</div>{ts && <div className="text-xs text-charcoal/50">{time(ts)}</div>}</div>
                </li>
              );
            })}
          </ol>
        )}
        {t.delivery?.courier && ["courier_assigned", "picked_up", "on_the_way"].includes(ds) && <p className="mt-4 rounded-xl bg-sand-50 px-3 py-2 text-sm">Tu domiciliario: <b>{t.delivery.courier}</b></p>}
        {t.delivery?.location && <div className="mt-4"><MapPicker value={t.delivery.location} onChange={() => {}} zones={[]} center={[t.delivery.location.lat, t.delivery.location.lng]} />
          <p className="mt-1 text-xs text-charcoal/50">Ubicación compartida por el domiciliario · {time(t.delivery.location.at)}</p></div>}
      </div>
      <div className="card mt-4 p-5 text-sm">
        {t.items?.map((i, k) => <div key={k} className="flex justify-between py-1"><span>{Number(i.qty)} × {i.name}{i.variant ? ` (${i.variant})` : ""}</span><span>{money(i.line_total)}</span></div>)}
        {Number(t.delivery_fee) > 0 && <div className="flex justify-between py-1"><span>Domicilio</span><span>{money(t.delivery_fee)}</span></div>}
        <div className="mt-2 flex justify-between border-t border-stone-line pt-2 font-semibold"><span>Total</span><span>{money(t.total)}</span></div>
        {Number(t.paid_total) > 0 && <div className="flex justify-between text-emerald-700"><span>Pagado</span><span>{money(t.paid_total)}</span></div>}
        {t.delivery && <p className="mt-3 text-xs text-charcoal/60">{t.delivery.address}</p>}
      </div>
      {t.business.phone && <a href={`tel:${t.business.phone}`} className="btn-secondary mt-4 w-full"><Phone size={16} /> Llamar a {t.business.name}</a>}
      <p className="mt-4 text-center text-xs text-charcoal/50">Esta página se actualiza automáticamente.</p>
    </div>
  );
}

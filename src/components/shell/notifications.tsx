"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/lib/app-context";
import { time } from "@/lib/format";
import Link from "next/link";

type N = { id: string; kind: string; title: string; body: string | null; data: Record<string, string>; read_at: string | null; created_at: string };

const LINK: Record<string, string> = {
  kds_new: "/cocina", order_ready: "/mesas", service_request: "/mesas", qr_order: "/mesas", kds_rejected: "/mesas",
  delivery_new: "/domicilios", delivery_incident: "/domicilios", payment_approved: "/domicilios", delivery_assigned: "/domiciliario",
};

export function NotificationBell() {
  const sb = supabaseBrowser();
  const { businessId } = useApp();
  const [items, setItems] = useState<N[]>([]);
  const [open, setOpen] = useState(false);
  const first = useRef(true);

  const load = useCallback(async () => {
    const { data } = await sb.from("notifications").select("*").eq("business_id", businessId)
      .is("read_at", null).order("created_at", { ascending: false }).limit(30);
    setItems((data ?? []) as N[]);
  }, [sb, businessId]);

  useEffect(() => {
    if (!businessId) return;
    load();
    const ch = sb.channel(`notif-${businessId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `business_id=eq.${businessId}` }, (p: { new: unknown }) => {
        const n = p.new as N;
        setItems((s) => [n, ...s]);
        if (!first.current && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          new Notification(n.title, { body: n.body ?? undefined, icon: "/brand/rupicola-mark.svg" });
        }
        try { new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=").play().catch(() => {}); } catch {}
      })
      .subscribe();
    first.current = false;
    return () => { sb.removeChannel(ch); };
  }, [sb, businessId, load]);

  const markAll = async () => {
    await sb.rpc("notification_mark_read", { p_ids: items.map((i) => i.id) });
    setItems([]);
  };
  const askPermission = () => { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); };

  return (
    <div className="relative">
      <button className="btn-ghost relative !p-2" aria-label="Notificaciones" onClick={() => { setOpen(!open); askPermission(); }}>
        <Bell size={20} />
        {items.length > 0 && <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-burgundy px-1 text-[10px] font-semibold text-white">{items.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(92vw,380px)] animate-slide-up card overflow-hidden">
          <div className="flex items-center justify-between border-b border-stone-line px-4 py-3">
            <span className="font-medium">Notificaciones</span>
            {items.length > 0 && <button onClick={markAll} className="flex items-center gap-1 text-xs text-burgundy"><Check size={14} /> Marcar leídas</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-charcoal/50">Sin notificaciones pendientes</p>}
            {items.map((n) => (
              <Link key={n.id} href={LINK[n.kind] ?? "#"} onClick={() => setOpen(false)} className="block border-b border-stone-line/70 px-4 py-3 hover:bg-sand-50">
                <div className="flex justify-between gap-2 text-sm font-medium"><span>{n.title}</span><span className="text-xs text-charcoal/50">{time(n.created_at)}</span></div>
                {n.body && <div className="text-xs text-charcoal/60">{n.body}</div>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

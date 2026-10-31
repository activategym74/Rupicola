"use client";
import { use, useCallback, useEffect, useState } from "react";
import { BellRing, Receipt, Sparkles, HelpCircle, ClipboardList } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, errMsg } from "@/lib/format";
import { Logo } from "@/components/brand/logo";
import { PublicMenu } from "@/components/public/menu";
import { useCart } from "@/components/public/cart";
import { CartBar, CartLines } from "@/components/public/cart-sheet";
import { Modal } from "@/components/ui/modal";
import { PageLoader, StatusBadge } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import type { PubMenu } from "@/components/public/types";

type Status = { table: number; orders: { number: number; status: string; total: number; items: { name: string; qty: number; line_total: number; status: string }[] }[]; open_requests: string[] };

/** Menú digital de la mesa (QR). La mesa se identifica por el token del código. */
export default function TableMenu({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const sb = supabaseBrowser();
  const toast = useToast();
  const [table, setTable] = useState<{ number: number; slug: string } | null | undefined>(undefined);
  const [menu, setMenu] = useState<PubMenu | null>(null);
  const cart = useCart(`rupicola.qr.${token}`);
  const [sheet, setSheet] = useState<null | "cart" | "status">(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sb.rpc("public_table", { p_token: token }).then(async ({ data }: { data: { number: number; slug: string } | null }) => {
      setTable(data ?? null);
      if (data) { const m = await sb.rpc("public_menu", { p_slug: data.slug }); setMenu(m.data as PubMenu); }
    });
    try { setName(localStorage.getItem("rupicola.name") ?? ""); } catch {}
  }, [sb, token]);

  const loadStatus = useCallback(async () => {
    const { data } = await sb.rpc("qr_table_status", { p_token: token });
    setStatus(data as Status);
  }, [sb, token]);
  useEffect(() => { if (sheet === "status") { loadStatus(); const i = setInterval(loadStatus, 10000); return () => clearInterval(i); } }, [sheet, loadStatus]);

  async function request(kind: string, label: string) {
    const { error } = await sb.rpc("qr_service_request", { p_token: token, p_kind: kind, p_note: null });
    if (error) toast("error", errMsg(error)); else toast("success", `${label}: el personal fue notificado`);
  }
  async function confirm() {
    setBusy(true);
    try { localStorage.setItem("rupicola.name", name); } catch {}
    const { error } = await sb.rpc("qr_place_order", { p_token: token, p_items: cart.payload(), p_customer_name: name || null, p_notes: null });
    setBusy(false);
    if (error) return toast("error", errMsg(error));
    cart.clear(); setSheet("status"); toast("success", "¡Pedido enviado! Ya lo estamos preparando.");
  }

  if (table === undefined || (table && !menu)) return <PageLoader />;
  if (table === null) return <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"><Logo size={48} /><p>Este código QR no es válido. Pide ayuda al personal.</p></div>;

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-28">
      <header className="flex items-center justify-between py-4">
        <Logo size={40} />
        <div className="rounded-full bg-burgundy px-3 py-1 text-sm font-medium text-white">Mesa {table.number}</div>
      </header>
      <div className="mb-4 grid grid-cols-4 gap-2 text-xs">
        <QuickBtn icon={<BellRing size={18} />} label="Llamar mesero" onClick={() => request("call_waiter", "Mesero")} />
        <QuickBtn icon={<Sparkles size={18} />} label="Servilletas / extras" onClick={() => request("supplies", "Solicitud")} />
        <QuickBtn icon={<HelpCircle size={18} />} label="Asistencia" onClick={() => request("assistance", "Asistencia")} />
        <QuickBtn icon={<Receipt size={18} />} label="Pedir la cuenta" onClick={() => request("bill", "Cuenta")} />
      </div>
      <button className="btn-secondary mb-4 w-full" onClick={() => setSheet("status")}><ClipboardList size={16} /> Estado de mi pedido</button>
      <PublicMenu menu={menu!} onAdd={(l) => { cart.add(l); toast("success", `${l.name} agregado`); }} />
      <CartBar count={cart.count} total={cart.total} onOpen={() => setSheet("cart")} />

      <Modal open={sheet === "cart"} onClose={() => setSheet(null)} title="Tu pedido"
        footer={<button className="btn-primary w-full" disabled={busy || cart.count === 0} onClick={confirm}>{busy ? "Enviando…" : `Confirmar pedido · ${money(cart.total)}`}</button>}>
        <CartLines lines={cart.lines} setQty={cart.setQty} />
        <label className="label mt-4">Tu nombre (opcional)</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <p className="mt-2 text-xs text-charcoal/50">El pedido llegará a la mesa {table.number}. Pagas al final con el personal.</p>
      </Modal>

      <Modal open={sheet === "status"} onClose={() => setSheet(null)} title={`Mesa ${table.number}`}>
        {!status ? <PageLoader /> : status.orders.length === 0 ? <p className="text-sm text-charcoal/60">Aún no hay pedidos en esta mesa.</p> :
          status.orders.map((o) => (
            <div key={o.number} className="mb-4">
              <div className="mb-2 flex items-center justify-between"><b>Pedido #{o.number}</b><StatusBadge status={o.status} /></div>
              {o.items.map((i, k) => (
                <div key={k} className="flex items-center justify-between border-b border-stone-line py-1.5 text-sm">
                  <span>{Number(i.qty)} × {i.name}</span>{i.status !== "n/a" ? <StatusBadge status={i.status} /> : <span className="text-xs text-charcoal/50">Tienda</span>}
                </div>
              ))}
              <div className="mt-2 text-right font-semibold">{money(o.total)}</div>
            </div>
          ))}
      </Modal>
    </div>
  );
}

function QuickBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="card flex flex-col items-center gap-1 p-2.5 text-center text-burgundy transition active:scale-95"><span>{icon}</span><span className="leading-tight text-charcoal">{label}</span></button>;
}

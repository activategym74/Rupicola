"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Phone, MapPin, Clock } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Logo } from "@/components/brand/logo";
import { PublicMenu } from "@/components/public/menu";
import { useCart } from "@/components/public/cart";
import { CartBar, CartLines } from "@/components/public/cart-sheet";
import { Checkout } from "@/components/public/checkout";
import { Modal } from "@/components/ui/modal";
import { PageLoader } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import type { PubMenu } from "@/components/public/types";

/** Tienda digital pública: pedidos a domicilio o para recoger, gastronomía y tienda en un mismo carrito. */
export default function Shop({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const toast = useToast();
  const [menu, setMenu] = useState<PubMenu | null | undefined>(undefined);
  const cart = useCart(`rupicola.shop.${slug}`);
  const [step, setStep] = useState<null | "cart" | "checkout">(null);
  const [recent, setRecent] = useState<{ token: string; number: number }[]>([]);

  useEffect(() => {
    supabaseBrowser().rpc("public_menu", { p_slug: slug }).then(({ data }: { data: PubMenu | null }) => setMenu(data ?? null));
    try { setRecent(JSON.parse(localStorage.getItem("rupicola.orders") ?? "[]").slice(0, 3)); } catch {}
  }, [slug]);

  if (menu === undefined) return <PageLoader />;
  if (menu === null) return <div className="p-10 text-center">Tienda no encontrada</div>;

  return (
    <div className="min-h-screen pb-28">
      <header className="bg-burgundy text-ivory">
        <div className="mx-auto max-w-2xl px-4 py-6">
          <Logo size={52} tone="light" tagline />
          <p className="mt-4 font-display text-2xl">Pide desde casa</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sand">
            {menu.business.phone && <span className="flex items-center gap-1"><Phone size={12} /> {menu.business.phone}</span>}
            {menu.business.address && <span className="flex items-center gap-1"><MapPin size={12} /> {menu.business.address}</span>}
            {menu.zones[0] && <span className="flex items-center gap-1"><Clock size={12} /> ~{menu.zones[0].eta_minutes} min</span>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-4">
        {recent.length > 0 && <div className="mb-3 flex flex-wrap gap-2 text-xs">{recent.map((r) => <Link key={r.token} href={`/pedido/${r.token}`} className="chip border border-stone-line bg-white !py-1">Seguir pedido #{r.number}</Link>)}</div>}
        <PublicMenu menu={menu} onAdd={(l) => { cart.add(l); toast("success", `${l.name} agregado`); }} />
      </main>
      <CartBar count={cart.count} total={cart.total} onOpen={() => setStep("cart")} />
      <Modal open={step === "cart"} onClose={() => setStep(null)} title="Tu carrito"
        footer={<button className="btn-primary w-full" disabled={!cart.count} onClick={() => setStep("checkout")}>Continuar</button>}>
        <CartLines lines={cart.lines} setQty={cart.setQty} />
      </Modal>
      <Modal open={step === "checkout"} onClose={() => setStep(null)} title="Finalizar pedido" wide>
        <Checkout menu={menu} lines={cart.lines} total={cart.total} payload={cart.payload} onDone={() => { cart.clear(); setStep(null); }} />
      </Modal>
    </div>
  );
}

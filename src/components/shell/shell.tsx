"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, X, ChevronsUpDown } from "lucide-react";
import clsx from "clsx";
import { useApp } from "@/lib/app-context";
import { NAV } from "@/lib/nav";
import { Logo, LogoMark } from "@/components/brand/logo";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageLoader } from "@/components/ui/bits";
import { NotificationBell } from "./notifications";

export function Shell({ children }: { children: React.ReactNode }) {
  const { loading, error, reload, current, memberships, switchBusiness, can, email, businessId } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (loading) return <div className="flex h-screen items-center justify-center"><LogoMark size={56} className="animate-pulse" /></div>;
  if (error) return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <LogoMark size={56} /><p className="max-w-sm text-sm text-charcoal/70">No fue posible cargar su información: {error}</p>
      <button className="btn-primary" onClick={() => reload()}>Reintentar</button>
    </div>
  );
  if (!current) return <PageLoader />;

  const allowed = (perm: string | string[]) => (Array.isArray(perm) ? perm.some(can) : can(perm));
  // Protección de rutas: un usuario solo abre los módulos que su rol permite
  const items = NAV.flatMap((s) => s.items);
  const route = items.find((i) => path === i.href || path.startsWith(i.href + "/"));
  const blocked = !!route && !allowed(route.perm);
  const home = items.find((i) => allowed(i.perm))?.href ?? null;
  const logout = async () => {
    await supabaseBrowser().rpc("log_activity", { b: businessId, p_action: "logout" });
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  };

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-5 pt-6 pb-4"><Logo size={38} tone="light" tagline /></div>
      {memberships.length > 1 && (
        <label className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-ivory">
          <select value={businessId} onChange={(e) => switchBusiness(e.target.value)} className="flex-1 bg-transparent outline-none">
            {memberships.map((m) => <option key={m.business.id} value={m.business.id} className="text-charcoal">{m.business.name}</option>)}
          </select>
          <ChevronsUpDown size={14} />
        </label>
      )}
      <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((sec) => {
          const items = sec.items.filter((i) => allowed(i.perm));
          if (!items.length) return null;
          return (
            <div key={sec.section}>
              <div className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.2em] text-sand/60 uppercase">{sec.section}</div>
              {items.map((i) => {
                const active = path === i.href || path.startsWith(i.href + "/");
                return (
                  <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
                    className={clsx("group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                      active ? "bg-sand text-burgundy font-medium" : "text-ivory/80 hover:bg-white/5 hover:text-ivory")}>
                    <i.icon size={18} />{i.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-4 text-ivory">
        <div className="text-sm font-medium">{current.member.full_name}</div>
        <div className="truncate text-xs text-sand/80">{current.role.name} · {email}</div>
        <button onClick={logout} className="mt-3 flex items-center gap-2 text-xs text-ivory/70 hover:text-ivory"><LogOut size={14} /> Cerrar sesión</button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 bg-charcoal lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-charcoal/50 animate-fade-in" />
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide-up bg-charcoal" onClick={(e) => e.stopPropagation()}>
            <button className="absolute top-5 right-4 text-ivory" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></button>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-stone-line bg-ivory/85 px-4 backdrop-blur sm:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button>
          <div className="lg:hidden"><LogoMark size={28} /></div>
          <div className="flex-1 truncate text-sm text-charcoal/60">{current.business.name}</div>
          <NotificationBell />
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6">{blocked ? <NoAccess home={home} silent={path === "/dashboard"} /> : children}</main>
      </div>
    </div>
  );
}

function NoAccess({ home, silent }: { home: string | null; silent: boolean }) {
  const router = useRouter();
  useEffect(() => { if (silent && home) router.replace(home); }, [silent, home, router]);
  if (silent && home) return <PageLoader />;
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="font-display text-2xl">Sin acceso a este módulo</p>
      <p className="max-w-sm text-sm text-charcoal/60">Su rol no tiene permiso para esta sección. Si lo necesita, pídalo al administrador.</p>
      {home && <Link href={home} className="btn-primary">Ir a mi inicio</Link>}
    </div>
  );
}

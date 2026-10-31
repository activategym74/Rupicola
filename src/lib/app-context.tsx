"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "./supabase/client";
import type { Membership, Unit } from "./types";

type Ctx = {
  loading: boolean;
  error: string | null;
  email: string | null;
  memberships: Membership[];
  current: Membership | null;
  businessId: string;
  units: Unit[];
  unitByKind: (k: "gastronomy" | "shop") => Unit | undefined;
  can: (perm: string) => boolean;
  switchBusiness: (id: string) => void;
  reload: () => Promise<void>;
};
const AppCtx = createContext<Ctx | null>(null);
const KEY = "rupicola.business";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { router.replace("/login"); return; }
    setEmail(user.email ?? null);
    const { data, error } = await sb.rpc("my_context");
    if (error) { setError(error.message || "No fue posible conectar con el servidor"); setLoading(false); return; }
    setError(null);
    const list = (data ?? []) as Membership[];
    setMemberships(list);
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    setSelected(list.find((m) => m.business.id === saved)?.business.id ?? list[0]?.business.id ?? null);
    setLoading(false);
    if (list.length === 0) router.replace("/configuracion-inicial");
  }, [sb, router]);

  useEffect(() => { reload(); }, [reload]);

  const current = memberships.find((m) => m.business.id === selected) ?? null;
  const value = useMemo<Ctx>(() => {
    const perms = new Set(current?.permissions ?? []);
    return {
      loading, error, email, memberships, current,
      businessId: current?.business.id ?? "",
      units: current?.units ?? [],
      unitByKind: (k) => current?.units.find((u) => u.kind === k),
      can: (p) => perms.has("*") || perms.has(p) || perms.has(p.split(".")[0] + ".*"),
      switchBusiness: (id) => { try { localStorage.setItem(KEY, id); } catch {} setSelected(id); },
      reload,
    };
  }, [loading, error, email, memberships, current, reload]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp fuera de AppProvider");
  return c;
}

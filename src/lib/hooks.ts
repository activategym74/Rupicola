"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "./supabase/client";
import type { Category, Product } from "./types";

export function useCatalog(businessId: string) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!businessId) return;
    const sb = supabaseBrowser();
    const [c, p] = await Promise.all([
      sb.from("categories").select("*").eq("business_id", businessId).eq("active", true).order("sort"),
      sb.from("products").select("*, product_variants(*), modifier_groups(*, modifier_options(*))")
        .eq("business_id", businessId).eq("active", true).order("sort").order("name"),
    ]);
    setCategories((c.data ?? []) as Category[]);
    setProducts((p.data ?? []) as Product[]);
    setLoading(false);
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  return { categories, products, loading, reload: load };
}

export type CashSession = { id: string; register_id: string; opened_at: string; cash_registers: { name: string } };
export function useOpenSessions(businessId: string) {
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const load = useCallback(async () => {
    if (!businessId) return;
    const { data } = await supabaseBrowser().from("cash_sessions").select("id, register_id, opened_at, cash_registers(name)")
      .eq("business_id", businessId).is("closed_at", null);
    setSessions((data ?? []) as unknown as CashSession[]);
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  return { sessions, reload: load };
}

export type PaymentMethod = { id: string; code: string; name: string; is_cash: boolean; requires_reference: boolean; gateway: string | null; available_online: boolean; active: boolean; sort: number };
export function usePaymentMethods(businessId: string) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  useEffect(() => {
    if (!businessId) return;
    supabaseBrowser().from("payment_methods").select("*").eq("business_id", businessId).eq("active", true).order("sort")
      .then(({ data }: { data: PaymentMethod[] | null }) => setMethods(data ?? []));
  }, [businessId]);
  return methods;
}

/** Suscripción Realtime a cambios de una o varias tablas del establecimiento */
export function useRealtime(businessId: string, tables: string[], onChange: () => void) {
  useEffect(() => {
    if (!businessId) return;
    const sb = supabaseBrowser();
    let ch = sb.channel(`rt-${tables.join("-")}-${businessId}-${Math.random().toString(36).slice(2)}`);
    for (const t of tables) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `business_id=eq.${businessId}` }, () => onChange());
    }
    ch.subscribe();
    return () => { sb.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, tables.join(","), onChange]);
}

"use client";
import { useEffect, useState } from "react";
import type { PubLine } from "./types";

/** Carrito persistido en el navegador del cliente */
export function useCart(key: string) {
  const [lines, setLines] = useState<PubLine[]>([]);
  useEffect(() => { try { setLines(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch {} }, [key]);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(lines)); } catch {} }, [key, lines]);
  const add = (l: PubLine) => setLines((s) => s.some((x) => x.key === l.key) ? s.map((x) => x.key === l.key ? { ...x, qty: x.qty + l.qty } : x) : [...s, l]);
  const setQty = (k: string, q: number) => setLines((s) => q <= 0 ? s.filter((x) => x.key !== k) : s.map((x) => x.key === k ? { ...x, qty: q } : x));
  const clear = () => setLines([]);
  const total = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const payload = () => lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, qty: l.qty, option_ids: l.option_ids, notes: l.notes }));
  return { lines, add, setQty, clear, total, count, payload };
}

"use client";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { money } from "@/lib/format";
import type { PubLine } from "./types";

export function CartBar({ count, total, onOpen }: { count: number; total: number; onOpen: () => void }) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 p-3 sm:p-4">
      <button onClick={onOpen} className="mx-auto flex w-full max-w-2xl animate-slide-up items-center justify-between rounded-2xl bg-burgundy px-5 py-4 text-white shadow-xl">
        <span className="flex items-center gap-2"><ShoppingBag size={18} /> {count} producto{count > 1 ? "s" : ""}</span>
        <span className="font-semibold">Ver pedido · {money(total)}</span>
      </button>
    </div>
  );
}

export function CartLines({ lines, setQty }: { lines: PubLine[]; setQty: (k: string, q: number) => void }) {
  return (
    <div className="divide-y divide-stone-line">
      {lines.map((l) => (
        <div key={l.key} className="flex items-center gap-3 py-3 text-sm">
          <div className="flex-1"><div className="font-medium">{l.name}</div>{l.detail && <div className="text-xs text-charcoal/60">{l.detail}</div>}
            <div className="text-xs text-burgundy">{money(l.unit_price * l.qty)}</div></div>
          <button className="btn-secondary !p-1" onClick={() => setQty(l.key, l.qty - 1)} aria-label="Menos"><Minus size={14} /></button>
          <span className="w-5 text-center">{l.qty}</span>
          <button className="btn-secondary !p-1" onClick={() => setQty(l.key, l.qty + 1)} aria-label="Más"><Plus size={14} /></button>
        </div>
      ))}
    </div>
  );
}

"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type Kind = "success" | "error" | "info";
type Toast = { id: number; kind: Kind; text: string };
const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {items.map((t) => (
          <div key={t.id} role="status"
            className={`pointer-events-auto flex max-w-md animate-slide-up items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg ${
              t.kind === "error" ? "bg-red-700 text-white" : t.kind === "success" ? "bg-charcoal text-white" : "bg-white text-charcoal border border-stone-line"}`}>
            {t.kind === "error" ? <AlertTriangle size={18} /> : t.kind === "success" ? <CheckCircle2 size={18} className="text-sand" /> : <Info size={18} />}
            <span className="flex-1">{t.text}</span>
            <button aria-label="Cerrar" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}><X size={16} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);

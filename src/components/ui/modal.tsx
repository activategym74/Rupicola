"use client";
import { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({ open, onClose, title, children, wide, footer }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/40 backdrop-blur-[2px] animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        className={`flex max-h-[92vh] w-full animate-slide-up flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-stone-line px-5 py-4">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-stone-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Pide un motivo obligatorio (anulaciones, rechazos, reversos) */
export function ReasonModal({ open, title, onClose, onConfirm, busy, confirmLabel = "Confirmar" }: {
  open: boolean; title: string; onClose: () => void; onConfirm: (reason: string) => void; busy?: boolean; confirmLabel?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-danger" disabled={busy} form="reason-form" type="submit">{confirmLabel}</button>
      </>}>
      <form id="reason-form" onSubmit={(e) => { e.preventDefault(); const r = new FormData(e.currentTarget).get("reason") as string; if (r.trim().length >= 3) onConfirm(r.trim()); }}>
        <label className="label" htmlFor="reason">Motivo (queda registrado en auditoría)</label>
        <textarea id="reason" name="reason" required minLength={3} rows={3} className="input" autoFocus />
      </form>
    </Modal>
  );
}

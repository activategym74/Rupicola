"use client";
import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import clsx from "clsx";
import { Modal } from "@/components/ui/modal";
import { money } from "@/lib/format";
import { variantLabel, type Product, type Variant } from "@/lib/types";

export type PickResult = { variant?: Variant; qty: number; option_ids: string[]; option_names: string[]; price_delta: number; notes: string };

/** Selector de talla/color/diseño, personalización (modificadores), cantidad y observaciones. */
export function ProductOptions({ product, open, onClose, onAdd, showStock = true }: {
  product: Product | null; open: boolean; onClose: () => void; onAdd: (r: PickResult) => void; showStock?: boolean;
}) {
  const [variantId, setVariantId] = useState<string>("");
  const [opts, setOpts] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const variants = (product?.product_variants ?? []).filter((v) => v.active);
  const groups = [...(product?.modifier_groups ?? [])].sort((a, b) => a.sort - b.sort);
  const allOptions = groups.flatMap((g) => g.modifier_options ?? []);
  const variant = variants.find((v) => v.id === variantId);
  const delta = useMemo(() => allOptions.filter((o) => opts.includes(o.id)).reduce((s, o) => s + Number(o.price_delta), 0), [opts, allOptions]);
  const base = Number(variant?.price ?? product?.price ?? 0);
  const groupError = groups.find((g) => {
    const n = (g.modifier_options ?? []).filter((o) => opts.includes(o.id)).length;
    return n < g.min_select || n > g.max_select;
  });
  const needsVariant = product?.stock_mode === "variant" && !variant;
  const stockError = variant && showStock && Number(variant.stock) < qty;

  const reset = () => { setVariantId(""); setOpts([]); setQty(1); setNotes(""); };
  const close = () => { reset(); onClose(); };
  if (!product) return null;

  return (
    <Modal open={open} onClose={close} title={product.name}
      footer={<>
        <button className="btn-secondary" onClick={close}>Cancelar</button>
        <button className="btn-primary" disabled={needsVariant || !!groupError || !!stockError}
          onClick={() => {
            onAdd({ variant, qty, option_ids: opts, option_names: allOptions.filter((o) => opts.includes(o.id)).map((o) => o.name), price_delta: delta, notes: notes.trim() });
            reset();
          }}>Agregar · {money((base + delta) * qty)}</button>
      </>}>
      {product.description && <p className="mb-4 text-sm text-charcoal/70">{product.description}</p>}
      {variants.length > 0 && (
        <div className="mb-5">
          <div className="label">Variante</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variants.map((v) => (
              <button key={v.id} type="button" disabled={showStock && Number(v.stock) <= 0} onClick={() => setVariantId(v.id)}
                className={clsx("rounded-xl border px-3 py-2 text-left text-sm transition disabled:opacity-40",
                  variantId === v.id ? "border-burgundy bg-burgundy-50" : "border-stone-line hover:border-sand")}>
                <div className="font-medium">{variantLabel(v) || "Única"}</div>
                <div className="text-xs text-charcoal/60">{money(v.price ?? product.price)}{showStock && ` · ${Number(v.stock)} disp.`}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.id} className="mb-5">
          <div className="label">{g.name} {g.min_select > 0 && <span className="text-burgundy">(obligatorio)</span>}</div>
          <div className="flex flex-wrap gap-2">
            {(g.modifier_options ?? []).sort((a, b) => a.sort - b.sort).map((o) => {
              const on = opts.includes(o.id);
              return (
                <button key={o.id} type="button"
                  onClick={() => setOpts((s) => {
                    if (on) return s.filter((x) => x !== o.id);
                    // en grupos de selección única, reemplaza
                    if (g.max_select === 1) return [...s.filter((x) => !(g.modifier_options ?? []).some((oo) => oo.id === x)), o.id];
                    return [...s, o.id];
                  })}
                  className={clsx("chip border !px-3 !py-1.5 text-sm", on ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>
                  {o.name}{Number(o.price_delta) !== 0 && ` +${money(o.price_delta)}`}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="mb-4">
        <label className="label" htmlFor="notes">Observaciones</label>
        <textarea id="notes" rows={2} maxLength={300} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: carne bien cocida, sin tomate" />
      </div>
      <div className="flex items-center gap-3">
        <span className="label !mb-0">Cantidad</span>
        <button className="btn-secondary !p-2" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Menos"><Minus size={16} /></button>
        <span className="w-8 text-center font-semibold">{qty}</span>
        <button className="btn-secondary !p-2" onClick={() => setQty(qty + 1)} aria-label="Más"><Plus size={16} /></button>
      </div>
      {groupError && <p className="mt-3 text-sm text-amber-700">Revise la selección de “{groupError.name}”.</p>}
      {stockError && <p className="mt-3 text-sm text-red-700">Solo hay {Number(variant!.stock)} unidades de esta variante.</p>}
    </Modal>
  );
}

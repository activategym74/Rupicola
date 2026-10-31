"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { Box, Image as ImageIcon, Minus, Plus, Star, Store, Utensils } from "lucide-react";
import { money } from "@/lib/format";
import { Modal } from "@/components/ui/modal";
import { Product3D } from "./model-viewer";
import type { PubMenu, PubProduct, PubLine } from "./types";

/** Catálogo público: categorías, destacados, detalle con fotos/3D, variantes y personalización. */
export function PublicMenu({ menu, onAdd }: { menu: PubMenu; onAdd: (l: PubLine) => void }) {
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<PubProduct | null>(null);
  const unitOf = (catId: string) => menu.categories.find((c) => c.id === catId)?.unit ?? "gastronomy";
  const featured = menu.products.filter((p) => p.is_featured && p.is_available);
  const shown = useMemo(() => menu.products.filter((p) => (!cat || p.category_id === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))), [menu, cat, q]);
  const cats = menu.categories.filter((c) => menu.products.some((p) => p.category_id === c.id));

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 bg-ivory/95 px-4 pt-2 pb-3 backdrop-blur">
        <input className="input mb-2" placeholder="Buscar en el menú…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="scrollbar-thin flex gap-2 overflow-x-auto">
          <button className={clsx("chip shrink-0 border !px-3 !py-1.5", !cat ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")} onClick={() => setCat("")}>Todo</button>
          {cats.map((c) => <button key={c.id} onClick={() => setCat(c.id)} className={clsx("chip shrink-0 border !px-3 !py-1.5", cat === c.id ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{c.name}</button>)}
        </div>
      </div>

      {!cat && !q && featured.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-1 font-display text-xl font-semibold"><Star size={16} className="text-burgundy" /> Destacados</h2>
          <div className="scrollbar-thin -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            {featured.map((p) => (
              <button key={p.id} onClick={() => setDetail(p)} className="card w-56 shrink-0 snap-start overflow-hidden text-left">
                <div className="aspect-[4/3] bg-sand-50">{p.image_url && <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />}</div>
                <div className="p-3"><div className="font-medium">{p.name}</div><div className="text-sm font-semibold text-burgundy">{money(p.price)}</div></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {(cat ? cats.filter((c) => c.id === cat) : cats).map((c) => {
        const list = shown.filter((p) => p.category_id === c.id);
        if (!list.length) return null;
        return (
          <section key={c.id} className="mb-6">
            <h2 className="mb-2 font-display text-xl font-semibold">{c.name}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((p) => (
                <button key={p.id} disabled={!p.is_available} onClick={() => setDetail(p)}
                  className={clsx("card flex gap-3 overflow-hidden p-2 text-left transition hover:shadow-md", !p.is_available && "opacity-55")}>
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-sand-50">
                    {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" /> :
                      <div className="flex h-full items-center justify-center text-sand">{unitOf(p.category_id) === "shop" ? <Store /> : <Utensils />}</div>}
                    {p.model_3d_url && <span className="chip absolute bottom-1 left-1 bg-charcoal/80 !text-[10px] text-white"><Box size={10} /> 3D</span>}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col py-1">
                    <div className="font-medium">{p.name} {p.is_recommended && <span className="chip ml-1 bg-sand-50 text-burgundy">Recomendado</span>}</div>
                    {p.description && <div className="line-clamp-2 text-xs text-charcoal/60">{p.description}</div>}
                    <div className="mt-auto flex items-center justify-between">
                      <span className="font-semibold text-burgundy">{money(p.price)}</span>
                      {!p.is_available && <span className="text-xs text-red-700">Agotado</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {detail && <ProductDetail product={detail} unit={unitOf(detail.category_id)} onClose={() => setDetail(null)} onAdd={(l) => { onAdd(l); setDetail(null); }} />}
    </div>
  );
}

function ProductDetail({ product: p, unit, onClose, onAdd }: { product: PubProduct; unit: "gastronomy" | "shop"; onClose: () => void; onAdd: (l: PubLine) => void }) {
  const [variantId, setVariantId] = useState(p.variants.find((v) => v.available)?.id ?? "");
  const [opts, setOpts] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [view, setView] = useState<"photo" | "3d">("photo");
  const v = p.variants.find((x) => x.id === variantId);
  const all = p.modifier_groups.flatMap((g) => g.options);
  const delta = all.filter((o) => opts.includes(o.id)).reduce((s, o) => s + Number(o.price_delta), 0);
  const price = Number(v?.price ?? p.price) + delta;
  const model = v?.model_3d_url ?? p.model_3d_url;
  const photo = v?.image_url ?? p.image_url;
  const invalid = p.modifier_groups.find((g) => { const n = g.options.filter((o) => opts.includes(o.id)).length; return n < g.min || n > g.max; });
  const needVariant = p.stock_mode === "variant" && !v;

  return (
    <Modal open onClose={onClose} title={p.name}
      footer={<button className="btn-primary w-full" disabled={!!invalid || needVariant}
        onClick={() => onAdd({ key: [p.id, variantId, ...opts.sort(), notes].join("|"), product_id: p.id, variant_id: v?.id, name: p.name,
          detail: [v && [v.size, v.color, v.design].filter(Boolean).join(" / "), all.filter((o) => opts.includes(o.id)).map((o) => o.name).join(", "), notes].filter(Boolean).join(" · "),
          qty, unit_price: price, option_ids: opts, notes: notes || undefined, unit })}>
        Agregar {qty} · {money(price * qty)}</button>}>
      <div className="relative -mx-5 -mt-4 mb-4 aspect-square max-h-80 w-[calc(100%+2.5rem)] overflow-hidden bg-sand-50">
        {view === "3d" && model ? <Product3D src={model} poster={photo} alt={p.name} /> : photo ? <img src={photo} alt={p.name} className="h-full w-full object-cover" /> :
          <div className="flex h-full items-center justify-center text-sand">{unit === "shop" ? <Store size={48} /> : <Utensils size={48} />}</div>}
        {model && (
          <div className="absolute right-3 bottom-3 flex overflow-hidden rounded-full bg-white shadow">
            <button className={clsx("px-3 py-1.5 text-xs", view === "photo" && "bg-charcoal text-white")} onClick={() => setView("photo")}><ImageIcon size={14} className="inline" /> Foto</button>
            <button className={clsx("px-3 py-1.5 text-xs", view === "3d" && "bg-charcoal text-white")} onClick={() => setView("3d")}><Box size={14} className="inline" /> Ver en 3D</button>
          </div>
        )}
      </div>
      {p.description && <p className="text-sm text-charcoal/75">{p.description}</p>}
      {p.ingredients_text && <p className="mt-2 text-xs text-charcoal/60"><b>Ingredientes:</b> {p.ingredients_text}</p>}
      {p.variants.length > 0 && (
        <div className="mt-4">
          <div className="label">Elige tu variante</div>
          <div className="flex flex-wrap gap-2">
            {p.variants.map((x) => (
              <button key={x.id} disabled={!x.available} onClick={() => setVariantId(x.id)}
                className={clsx("rounded-xl border px-3 py-2 text-sm disabled:opacity-40 disabled:line-through", variantId === x.id ? "border-burgundy bg-burgundy-50" : "border-stone-line")}>
                {[x.size, x.color, x.design].filter(Boolean).join(" / ") || "Única"}
              </button>
            ))}
          </div>
        </div>
      )}
      {p.modifier_groups.map((g) => (
        <div key={g.id} className="mt-4">
          <div className="label">{g.name}{g.min > 0 && " (obligatorio)"}</div>
          <div className="flex flex-wrap gap-2">
            {g.options.map((o) => {
              const on = opts.includes(o.id);
              return <button key={o.id} onClick={() => setOpts((s) => on ? s.filter((x) => x !== o.id) : g.max === 1 ? [...s.filter((x) => !g.options.some((oo) => oo.id === x)), o.id] : [...s, o.id])}
                className={clsx("chip border !px-3 !py-1.5 text-sm", on ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>
                {o.name}{Number(o.price_delta) > 0 && ` +${money(o.price_delta)}`}</button>;
            })}
          </div>
        </div>
      ))}
      {unit === "gastronomy" && <textarea className="input mt-4" rows={2} maxLength={300} placeholder="Observaciones (ej: sin cebolla, bien cocida)" value={notes} onChange={(e) => setNotes(e.target.value)} />}
      <div className="mt-4 flex items-center justify-center gap-4">
        <button className="btn-secondary !p-2" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Menos"><Minus size={16} /></button>
        <span className="text-lg font-semibold">{qty}</span>
        <button className="btn-secondary !p-2" onClick={() => setQty(qty + 1)} aria-label="Más"><Plus size={16} /></button>
      </div>
    </Modal>
  );
}

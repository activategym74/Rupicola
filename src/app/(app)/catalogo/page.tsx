"use client";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Plus, Pencil, Search, Store, Utensils, Trash2, Upload, Box } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useCatalog } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, errMsg } from "@/lib/format";
import { PageHeader, PageLoader, Empty } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { Category, Product, Variant, ModifierGroup } from "@/lib/types";

type Station = { id: string; name: string; code: string };
type Ingredient = { id: string; name: string; unit: string; cost_per_unit: number };

export default function CatalogPage() {
  const { businessId, units } = useApp();
  const { categories, products, loading, reload } = useCatalog(businessId);
  const [tab, setTab] = useState<"products" | "categories">("products");
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState("");
  const [edit, setEdit] = useState<Product | "new" | null>(null);
  const [editCat, setEditCat] = useState<Category | "new" | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [allCats, setAllCats] = useState<Category[]>([]);

  useEffect(() => {
    if (!businessId) return;
    const sb = supabaseBrowser();
    sb.from("stations").select("id, name, code").eq("business_id", businessId).then(({ data }: { data: Station[] | null }) => setStations(data ?? []));
    sb.from("categories").select("*").eq("business_id", businessId).order("sort").then(({ data }: { data: Category[] | null }) => setAllCats(data ?? []));
  }, [businessId, categories]);

  const list = useMemo(() => products.filter((p) => (!unit || p.business_unit_id === unit) && (!q || `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [products, unit, q]);
  if (loading) return <PageLoader />;
  const unitName = (id: string) => units.find((u) => u.id === id)?.name;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Catálogo" subtitle="Productos, precios, variantes, recetas y personalización"
        actions={tab === "products" ? <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={16} /> Nuevo producto</button>
          : <button className="btn-primary" onClick={() => setEditCat("new")}><Plus size={16} /> Nueva categoría</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["products", "categories"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={clsx("chip border !px-3 !py-1.5", tab === t ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{t === "products" ? "Productos" : "Categorías"}</button>)}
        <div className="flex-1" />
        {tab === "products" && <>
          <div className="relative"><Search size={16} className="absolute top-2.5 left-3 text-charcoal/40" /><input className="input !pl-9" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="input !w-auto" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas las unidades</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </>}
      </div>

      {tab === "products" ? (list.length === 0 ? <Empty icon={<Utensils size={36} />} title="Sin productos" text="Cree el primer producto con el botón Nuevo producto." /> : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead><tr><th></th><th>Producto</th><th>Categoría</th><th>Unidad</th><th>Inventario</th><th className="text-right">Precio</th><th>Estado</th><th></th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}>
                <td className="w-12">{p.image_url ? <img src={p.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="h-10 w-10 rounded-lg bg-sand-50" />}</td>
                <td><div className="font-medium">{p.name}</div><div className="text-xs text-charcoal/50">{p.sku}{p.model_3d_url && " · 3D"}</div></td>
                <td>{categories.find((c) => c.id === p.category_id)?.name}</td>
                <td>{unitName(p.business_unit_id)}</td>
                <td className="text-xs">{p.stock_mode === "variant" ? `${p.product_variants?.length ?? 0} variantes · ${(p.product_variants ?? []).reduce((s, v) => s + Number(v.stock), 0)} und` : p.stock_mode === "recipe" ? "Por receta" : "Sin control"}</td>
                <td className="text-right">{money(p.price)}</td>
                <td>{p.is_available ? <span className="chip bg-emerald-50 text-emerald-800">Disponible</span> : <span className="chip bg-red-50 text-red-700">No disponible</span>}</td>
                <td><button className="btn-ghost !p-1.5" onClick={() => setEdit(p)} aria-label="Editar"><Pencil size={16} /></button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )) : (
        <div className="card overflow-x-auto">
          <table className="table-base"><thead><tr><th>Orden</th><th>Categoría</th><th>Unidad</th><th>Estación</th><th>Menú</th><th></th></tr></thead>
            <tbody>{allCats.map((c) => (
              <tr key={c.id} className={!c.active ? "opacity-50" : ""}><td>{c.sort}</td><td className="font-medium">{c.name}</td><td>{unitName(c.business_unit_id)}</td>
                <td>{stations.find((s) => s.id === c.default_station_id)?.name ?? "—"}</td><td>{c.show_in_menu ? "Visible" : "Oculta"}</td>
                <td><button className="btn-ghost !p-1.5" onClick={() => setEditCat(c)}><Pencil size={16} /></button></td></tr>))}</tbody></table>
        </div>
      )}

      {edit && <ProductEditor product={edit === "new" ? null : edit} categories={allCats} stations={stations} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {editCat && <CategoryEditor cat={editCat === "new" ? null : editCat} stations={stations} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); reload(); }} />}
    </div>
  );
}

function CategoryEditor({ cat, stations, onClose, onSaved }: { cat: Category | null; stations: Station[]; onClose: () => void; onSaved: () => void }) {
  const { businessId, units } = useApp();
  const toast = useToast();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim();
    const row = { business_id: businessId, name, slug: name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      business_unit_id: String(f.get("unit")), default_station_id: String(f.get("station")) || null, sort: Number(f.get("sort")), show_in_menu: f.get("menu") === "on", active: f.get("active") === "on" };
    const sb = supabaseBrowser();
    const { error } = cat ? await sb.from("categories").update(row).eq("id", cat.id) : await sb.from("categories").insert(row);
    if (error) toast("error", errMsg(error)); else { toast("success", "Categoría guardada"); onSaved(); }
  }
  return (
    <Modal open onClose={onClose} title={cat ? "Editar categoría" : "Nueva categoría"} footer={<button form="catf" className="btn-primary">Guardar</button>}>
      <form id="catf" onSubmit={submit} className="space-y-3">
        <div><label className="label">Nombre</label><input name="name" required defaultValue={cat?.name} className="input" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Unidad de negocio</label><select name="unit" className="input" defaultValue={cat?.business_unit_id}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <div><label className="label">Estación por defecto</label><select name="station" className="input" defaultValue={cat?.default_station_id ?? ""}><option value="">Ninguna (tienda)</option>{stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="label">Orden</label><input name="sort" type="number" defaultValue={cat?.sort ?? 0} className="input" /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="menu" defaultChecked={cat?.show_in_menu ?? true} /> Visible en el menú digital y tienda</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={cat?.active ?? true} /> Activa</label>
      </form>
    </Modal>
  );
}

type VRow = Partial<Variant> & { _new?: boolean };
type RRow = { ingredient_id: string; qty: number };

function ProductEditor({ product, categories, stations, onClose, onSaved }: { product: Product | null; categories: Category[]; stations: Station[]; onClose: () => void; onSaved: () => void }) {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, units } = useApp();
  const [p, setP] = useState<Partial<Product>>(product ?? { name: "", price: 0, stock_mode: "none", is_available: true, is_featured: false, is_recommended: false, tax_rate: 0, sort: 0, category_id: categories[0]?.id });
  const [variants, setVariants] = useState<VRow[]>(product?.product_variants ?? []);
  const [recipe, setRecipe] = useState<RRow[]>([]);
  const [groups, setGroups] = useState<ModifierGroup[]>(product?.modifier_groups ?? []);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [busy, setBusy] = useState(false);
  const cat = categories.find((c) => c.id === p.category_id);
  const kind = units.find((u) => u.id === cat?.business_unit_id)?.kind ?? "gastronomy";

  useEffect(() => {
    sb.from("ingredients").select("id, name, unit, cost_per_unit").eq("business_id", businessId).eq("active", true).order("name")
      .then(({ data }: { data: Ingredient[] | null }) => setIngredients(data ?? []));
    if (product) sb.from("recipe_items").select("ingredient_id, qty").eq("product_id", product.id).then(({ data }: { data: RRow[] | null }) => setRecipe(data ?? []));
  }, [sb, businessId, product]);

  const recipeCost = recipe.reduce((s, r) => s + Number(r.qty) * Number(ingredients.find((i) => i.id === r.ingredient_id)?.cost_per_unit ?? 0), 0);
  const set = (k: keyof Product, v: unknown) => setP((s) => ({ ...s, [k]: v }));

  async function upload(file: File, field: "image_url" | "model_3d_url") {
    const path = `${businessId}/products/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const { error } = await sb.storage.from("catalog").upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) return toast("error", "No se pudo subir: " + errMsg(error));
    set(field, sb.storage.from("catalog").getPublicUrl(path).data.publicUrl);
  }

  async function save() {
    if (!p.name?.trim() || !p.category_id) return toast("error", "Nombre y categoría son obligatorios");
    if (kind === "shop" && variants.length === 0) return toast("error", "Los productos de tienda necesitan al menos una variante (talla/color)");
    setBusy(true);
    const row = {
      business_id: businessId, business_unit_id: cat!.business_unit_id, category_id: p.category_id, name: p.name.trim(), description: p.description || null,
      ingredients_text: p.ingredients_text || null, price: Number(p.price), tax_rate: Number(p.tax_rate ?? 0), sku: p.sku || null, barcode: p.barcode || null,
      image_url: p.image_url || null, model_3d_url: p.model_3d_url || null, is_featured: !!p.is_featured, is_recommended: !!p.is_recommended,
      is_available: !!p.is_available, active: p.active ?? true, sort: Number(p.sort ?? 0),
      station_id: kind === "shop" ? null : (p.station_id || null),
      stock_mode: kind === "shop" ? "variant" : recipe.length ? "recipe" : "none",
    };
    try {
      let id = product?.id;
      if (id) { const { error } = await sb.from("products").update(row).eq("id", id); if (error) throw error; }
      else { const { data, error } = await sb.from("products").insert(row).select("id").single(); if (error) throw error; id = data.id; }
      // Variantes (las existencias SOLO cambian por movimientos de inventario)
      for (const v of variants) {
        const vr = { business_id: businessId, product_id: id, sku: v.sku || null, barcode: v.barcode || null, size: v.size || null, color: v.color || null,
          design: v.design || null, price: v.price ? Number(v.price) : null, min_stock: Number(v.min_stock ?? 0), image_url: v.image_url || null, active: v.active ?? true };
        const { error } = v.id ? await sb.from("product_variants").update(vr).eq("id", v.id) : await sb.from("product_variants").insert({ ...vr, cost: Number(v.cost ?? 0) });
        if (error) throw error;
      }
      // Receta
      if (kind === "gastronomy") {
        await sb.from("recipe_items").delete().eq("product_id", id);
        if (recipe.length) { const { error } = await sb.from("recipe_items").insert(recipe.filter((r) => r.ingredient_id && r.qty > 0).map((r) => ({ business_id: businessId, product_id: id, ...r }))); if (error) throw error; }
      }
      // Personalización
      for (const g of groups) {
        const gr = { business_id: businessId, product_id: id, name: g.name, min_select: g.min_select, max_select: g.max_select, sort: g.sort };
        let gid = g.id;
        if (gid && !gid.startsWith("new")) { await sb.from("modifier_groups").update(gr).eq("id", gid); }
        else { const { data, error } = await sb.from("modifier_groups").insert(gr).select("id").single(); if (error) throw error; gid = data.id; }
        for (const o of g.modifier_options ?? []) {
          const or = { business_id: businessId, group_id: gid, name: o.name, price_delta: Number(o.price_delta), ingredient_id: o.ingredient_id || null, ingredient_qty: Number(o.ingredient_qty || 0), sort: o.sort };
          const { error } = o.id && !o.id.startsWith("new") ? await sb.from("modifier_options").update(or).eq("id", o.id) : await sb.from("modifier_options").insert(or);
          if (error) throw error;
        }
      }
      toast("success", "Producto guardado");
      onSaved();
    } catch (e) { toast("error", errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open wide onClose={onClose} title={product ? `Editar ${product.name}` : "Nuevo producto"}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button></>}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="space-y-3">
          <div><label className="label">Nombre</label><input className="input" value={p.name ?? ""} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Categoría</label><select className="input" value={p.category_id} onChange={(e) => set("category_id", e.target.value)}>
              {units.map((u) => <optgroup key={u.id} label={u.name}>{categories.filter((c) => c.business_unit_id === u.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}</select></div>
            <div><label className="label">Precio de venta</label><input className="input" type="number" min={0} value={p.price ?? 0} onChange={(e) => set("price", e.target.value)} /></div>
            <div><label className="label">Código / referencia</label><input className="input" value={p.sku ?? ""} onChange={(e) => set("sku", e.target.value)} /></div>
            <div><label className="label">Código de barras</label><input className="input" value={p.barcode ?? ""} onChange={(e) => set("barcode", e.target.value)} /></div>
            {kind === "gastronomy" && <div><label className="label">Estación de preparación</label><select className="input" value={p.station_id ?? ""} onChange={(e) => set("station_id", e.target.value)}>
              <option value="">La de la categoría</option>{stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
            <div><label className="label">Impuesto incluido %</label><input className="input" type="number" step="0.01" value={p.tax_rate ?? 0} onChange={(e) => set("tax_rate", e.target.value)} /></div>
          </div>
          <div><label className="label">Descripción</label><textarea className="input" rows={2} value={p.description ?? ""} onChange={(e) => set("description", e.target.value)} /></div>
          {kind === "gastronomy" && <div><label className="label">Ingredientes (visible al cliente)</label><input className="input" value={p.ingredients_text ?? ""} onChange={(e) => set("ingredients_text", e.target.value)} /></div>}
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!p.is_available} onChange={(e) => set("is_available", e.target.checked)} /> Disponible</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!p.is_featured} onChange={(e) => set("is_featured", e.target.checked)} /> Destacado</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!p.is_recommended} onChange={(e) => set("is_recommended", e.target.checked)} /> Recomendado</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.active ?? true} onChange={(e) => set("active", e.target.checked)} /> Activo</label>
          </div>
        </div>
        <div className="space-y-3">
          <div className="aspect-square overflow-hidden rounded-xl bg-sand-50">{p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> :
            <div className="flex h-full items-center justify-center text-sand">{kind === "shop" ? <Store size={36} /> : <Utensils size={36} />}</div>}</div>
          <label className="btn-secondary w-full cursor-pointer"><Upload size={16} /> Fotografía<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "image_url")} /></label>
          <label className="btn-secondary w-full cursor-pointer"><Box size={16} /> {p.model_3d_url ? "Cambiar modelo 3D" : "Modelo 3D (GLB)"}<input type="file" accept=".glb,.gltf,model/gltf-binary" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "model_3d_url")} /></label>
          {p.model_3d_url && <button className="text-xs text-red-700" onClick={() => set("model_3d_url", null)}>Quitar modelo 3D</button>}
        </div>
      </div>

      {kind === "shop" && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">Variantes (talla · color · diseño)</h3>
            <button className="btn-ghost !py-1 text-sm" onClick={() => setVariants((s) => [...s, { _new: true, active: true, stock: 0, min_stock: 0, cost: 0 }])}><Plus size={14} /> Variante</button></div>
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Talla</th><th>Color</th><th>Diseño</th><th>Referencia</th><th>Cód. barras</th><th>Precio</th><th>Mín.</th><th>Existencia</th></tr></thead>
            <tbody>{variants.map((v, i) => {
              const up = (k: keyof VRow, val: string) => setVariants((s) => s.map((x, j) => j === i ? { ...x, [k]: val } : x));
              return <tr key={v.id ?? i}>
                {(["size", "color", "design", "sku", "barcode"] as const).map((k) => <td key={k}><input className="input !px-2 !py-1" value={(v[k] as string) ?? ""} onChange={(e) => up(k, e.target.value)} /></td>)}
                <td><input className="input !w-24 !px-2 !py-1" type="number" placeholder={String(p.price)} value={v.price ?? ""} onChange={(e) => up("price", e.target.value)} /></td>
                <td><input className="input !w-16 !px-2 !py-1" type="number" value={v.min_stock ?? 0} onChange={(e) => up("min_stock", e.target.value)} /></td>
                <td className="text-center">{Number(v.stock ?? 0)}</td>
              </tr>;
            })}</tbody></table></div>
          <p className="mt-1 text-xs text-charcoal/50">Las existencias se cargan con Compras o ajustes de Inventario, para que todo movimiento quede registrado.</p>
        </section>
      )}

      {kind === "gastronomy" && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">Receta / ficha técnica <span className="text-xs font-normal text-charcoal/50">· costo {money(recipeCost)} · margen {p.price ? Math.round((1 - recipeCost / Number(p.price)) * 100) : 0}%</span></h3>
            <button className="btn-ghost !py-1 text-sm" onClick={() => setRecipe((s) => [...s, { ingredient_id: ingredients[0]?.id ?? "", qty: 1 }])} disabled={!ingredients.length}><Plus size={14} /> Ingrediente</button></div>
          {ingredients.length === 0 && <p className="text-xs text-charcoal/50">Cree ingredientes en Inventario para armar la receta.</p>}
          {recipe.map((r, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <select className="input" value={r.ingredient_id} onChange={(e) => setRecipe((s) => s.map((x, j) => j === i ? { ...x, ingredient_id: e.target.value } : x))}>
                {ingredients.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}</select>
              <input className="input !w-28" type="number" step="0.001" min={0} value={r.qty} onChange={(e) => setRecipe((s) => s.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
              <button className="btn-ghost !p-2" onClick={() => setRecipe((s) => s.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
        </section>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">Personalización</h3>
          <button className="btn-ghost !py-1 text-sm" onClick={() => setGroups((s) => [...s, { id: `new${Date.now()}`, product_id: "", name: "Personaliza tu pedido", min_select: 0, max_select: 10, sort: s.length, modifier_options: [] }])}><Plus size={14} /> Grupo</button></div>
        {groups.map((g, gi) => {
          const upG = (patch: Partial<ModifierGroup>) => setGroups((s) => s.map((x, j) => j === gi ? { ...x, ...patch } : x));
          return (
            <div key={g.id} className="mb-3 rounded-xl border border-stone-line p-3">
              <div className="mb-2 grid grid-cols-[minmax(0,1fr)_80px_80px] gap-2">
                <input className="input" value={g.name} onChange={(e) => upG({ name: e.target.value })} aria-label="Nombre del grupo" />
                <input className="input" type="number" min={0} value={g.min_select} onChange={(e) => upG({ min_select: Number(e.target.value) })} title="Mínimo" />
                <input className="input" type="number" min={1} value={g.max_select} onChange={(e) => upG({ max_select: Number(e.target.value) })} title="Máximo" />
              </div>
              {(g.modifier_options ?? []).map((o, oi) => {
                const upO = (patch: Record<string, unknown>) => upG({ modifier_options: (g.modifier_options ?? []).map((x, j) => j === oi ? { ...x, ...patch } : x) });
                return (
                  <div key={o.id} className="mb-1.5 grid grid-cols-[minmax(0,1fr)_100px_1fr_80px] gap-2">
                    <input className="input !py-1" value={o.name} placeholder="Ej: Extra queso" onChange={(e) => upO({ name: e.target.value })} />
                    <input className="input !py-1" type="number" value={o.price_delta} onChange={(e) => upO({ price_delta: e.target.value })} title="Valor adicional" />
                    <select className="input !py-1" value={o.ingredient_id ?? ""} onChange={(e) => upO({ ingredient_id: e.target.value || null })}><option value="">No afecta inventario</option>{ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                    <input className="input !py-1" type="number" step="0.001" value={o.ingredient_qty} onChange={(e) => upO({ ingredient_qty: e.target.value })} title="Cantidad (+ consume / − ahorra)" />
                  </div>
                );
              })}
              <button className="text-xs text-burgundy" onClick={() => upG({ modifier_options: [...(g.modifier_options ?? []), { id: `new${Date.now()}`, group_id: g.id, name: "", price_delta: 0, ingredient_id: null, ingredient_qty: 0, sort: (g.modifier_options ?? []).length }] })}>+ Opción</button>
            </div>
          );
        })}
      </section>
    </Modal>
  );
}

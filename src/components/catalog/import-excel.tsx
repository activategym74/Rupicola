"use client";
import { useEffect, useState } from "react";
import { FileSpreadsheet, Download, ImagePlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money, errMsg } from "@/lib/format";
import type { Category, Product, Unit } from "@/lib/types";

/** Fila leída del Excel, ya interpretada */
type Row = {
  line: number; name: string; category: string; unitId: string; price: number; sku: string; description: string;
  sizes: string[]; colors: string[]; design: string; track: boolean; photo: string; supplier: string; supplierId?: string | null;
  image?: { data: ArrayBuffer; ext: string }; file?: File; existing?: Product; problems: string[];
};

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const list = (s: unknown) => String(s ?? "").split(/[,;/|]/).map((x) => x.trim()).filter(Boolean);

/** Interpreta precios escritos al estilo colombiano: 55.000 · 55,000 · $ 55.000 · 55000 */
export function parseMoney(v: unknown): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[$\s]/g, "");
  if (!s) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  return Number(s);
}
const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text) return String(o.text);
    if (o.hyperlink) return o.hyperlink;
    if (o.result != null) return String(o.result);
  }
  return String(v);
};

const COLS: Record<string, string[]> = {
  name: ["nombre", "producto"], category: ["categoria"], unit: ["negocio", "unidad", "marca"], price: ["precio", "valor"],
  sku: ["codigo", "referencia", "sku"], description: ["descripcion"], sizes: ["talla"], colors: ["color"], design: ["diseno"],
  track: ["controlar", "existencia", "inventario"], photo: ["foto", "imagen"], supplier: ["proveedor"],
};

export function ImportExcel({ businessId, units, categories, products, onClose, onDone }: {
  businessId: string; units: Unit[]; categories: Category[]; products: Product[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const gastro = units.find((u) => u.kind === "gastronomy"), shop = units.find((u) => u.kind === "shop");
  const [sups, setSups] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    supabaseBrowser().from("suppliers").select("id, name").eq("business_id", businessId).eq("is_consignment", true)
      .then(({ data }: { data: { id: string; name: string }[] | null }) => setSups(data ?? []));
  }, [businessId]);

  async function template() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Productos");
    ws.columns = [
      { header: "Nombre", width: 28 }, { header: "Categoría", width: 20 }, { header: "Negocio", width: 14 }, { header: "Precio", width: 12 },
      { header: "Código", width: 12 }, { header: "Descripción", width: 36 }, { header: "Tallas", width: 14 }, { header: "Colores", width: 16 },
      { header: "Diseño", width: 14 }, { header: "Controlar existencias", width: 12 }, { header: "Foto", width: 22 }, { header: "Proveedor", width: 18 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF791522" } };
    ws.addRow(["(Ejemplo) Camisa bordada", "Camisas", shop?.name ?? "Tienda", 60000, "CAM-001", "Algodón", "S,M,L", "Blanco,Negro", "", "Sí", "camisa-001.jpg", "Mi Tierra"]);
    ws.addRow(["(Ejemplo) Limonada de coco", "Bebidas", gastro?.name ?? "Gastronomía", 9000, "", "", "", "", "", "", "", ""]);
    const help = wb.addWorksheet("Instrucciones");
    help.getColumn(1).width = 110;
    [
      "Borre las filas de ejemplo y escriba un producto por fila. Obligatorio: Nombre, Categoría y Precio.",
      `Negocio: escriba "${gastro?.name ?? "Gastronomía"}" o "${shop?.name ?? "Tienda"}". Si lo deja vacío se toma el de la categoría (o el restaurante si la categoría es nueva).`,
      "Categoría: si no existe, se crea automáticamente en ese negocio.",
      "Precio: puede escribirlo como 60000, 60.000 o $60.000.",
      "Tallas y colores: separados por coma. Se crea una variante por cada combinación (si los deja vacíos, talla “Única”). Solo aplica a camisas.",
      "Controlar existencias: Sí o No. Con No se vende aunque no haya inventario cargado.",
      "Foto: dos opciones. (1) Inserte la imagen en la misma fila con Insertar > Imágenes > “Colocar sobre las celdas”.",
      "   (2) Escriba el nombre del archivo (ej. camisa-001.jpg) y al importar seleccione también las fotos desde su computador o celular.",
      "Si el Código ya existe en el catálogo, el producto se actualiza (precio, descripción, foto) en lugar de duplicarse.",
      "Proveedor: nombre del proveedor en consignación (por ejemplo Mi Tierra). Debe existir en Compras y proveedores con “Trabaja en consignación”. Vacío = producto propio.",
    ].forEach((t) => help.addRow([t]));
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = "plantilla-productos.xlsx"; a.click(); URL.revokeObjectURL(a.href);
  }

  function resolveUnit(raw: string, catName: string): string {
    const n = norm(raw);
    if (n) {
      const byName = units.find((u) => norm(u.name) === n || n.includes(norm(u.name)) || norm(u.name).includes(n));
      if (byName) return byName.id;
      if (/tienda|camis|ropa|shop/.test(n) && shop) return shop.id;
      if (/gastro|restaur|comida|cocina|bar|cafe/.test(n) && gastro) return gastro.id;
    }
    const cat = categories.find((c) => norm(c.name) === norm(catName));
    return cat?.business_unit_id ?? gastro?.id ?? units[0]?.id ?? "";
  }

  async function read(file: File) {
    setBusy(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("El archivo no tiene hojas");
      // Columnas por encabezado
      const idx: Record<string, number> = {};
      ws.getRow(1).eachCell((c, col) => {
        const h = norm(cellText(c.value));
        for (const [k, keys] of Object.entries(COLS)) if (!idx[k] && keys.some((x) => h.includes(x))) idx[k] = col;
      });
      if (!idx.name || !idx.price) throw new Error("No se encontraron las columnas Nombre y Precio en la primera fila. Use la plantilla.");
      // Imágenes incrustadas, por fila
      const imgs: Record<number, { data: ArrayBuffer; ext: string }> = {};
      for (const im of ws.getImages()) {
        const r = Math.floor(Number(im.range.tl.nativeRow ?? im.range.tl.row)) + 1;
        const media = wb.getImage(Number(im.imageId)) as unknown as { buffer?: ArrayBuffer | Uint8Array; base64?: string; extension: string };
        let data: ArrayBuffer | null = null;
        if (media.buffer) { const u8 = new Uint8Array(media.buffer as ArrayBuffer); data = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer; }
        else if (media.base64) { const bin = atob(media.base64.replace(/^data:[^,]+,/, "")); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); data = u8.buffer; }
        if (data && !imgs[r]) imgs[r] = { data, ext: media.extension || "png" };
      }
      const out: Row[] = [];
      ws.eachRow((row, n) => {
        if (n === 1) return;
        const g = (k: string) => (idx[k] ? cellText(row.getCell(idx[k]).value).trim() : "");
        const name = g("name");
        if (!name || /^\(ejemplo\)/i.test(name)) return;
        const category = g("category");
        const unitId = resolveUnit(g("unit"), category);
        const isShop = unitId === shop?.id;
        const priceRaw = idx.price ? row.getCell(idx.price).value : "";
        const price = parseMoney(typeof priceRaw === "object" && priceRaw ? cellText(priceRaw) : priceRaw);
        const trackRaw = norm(g("track"));
        const sku = g("sku");
        const problems: string[] = [];
        if (!category) problems.push("Falta la categoría");
        if (!Number.isFinite(price) || price < 0) problems.push("Precio no válido");
        const supplier = g("supplier");
        const supplierId = supplier ? sups.find((s) => norm(s.name) === norm(supplier))?.id : null;
        if (supplier && !supplierId) problems.push(`Proveedor “${supplier}” no existe en consignación`);
        if (supplier && !isShop) problems.push("Los productos de proveedor van en la tienda");
        const existing = (sku && products.find((p) => norm(p.sku) === norm(sku))) || undefined;
        out.push({
          line: n, name, category, unitId, price, sku, description: g("description"),
          sizes: isShop ? list(g("sizes")) : [], colors: isShop ? list(g("colors")) : [], design: g("design"),
          track: trackRaw ? /^(s|si|yes|x|1|true)$/.test(trackRaw) : !isShop,
          photo: g("photo"), image: imgs[n], existing, problems, supplier, supplierId,
        });
      });
      if (out.length === 0) throw new Error("No se encontraron productos en el archivo");
      setRows(out);
    } catch (e) { toast("error", errMsg(e)); } finally { setBusy(false); }
  }

  const fileFor = (r: Row) => {
    if (!r.photo) return undefined;
    const p = norm(r.photo).replace(/\.[a-z0-9]+$/, "");
    return files.find((f) => norm(f.name) === norm(r.photo) || norm(f.name).replace(/\.[a-z0-9]+$/, "") === p);
  };
  const photoState = (r: Row) => r.image ? "En el Excel" : fileFor(r) ? "Archivo" : /^https?:\/\//i.test(r.photo) ? "Enlace" : r.photo ? "Falta el archivo" : "—";

  async function run() {
    if (!rows) return;
    const sb = supabaseBrowser();
    setBusy(true);
    const cats = [...categories];
    let ok = 0, fail = 0;
    const errors: string[] = [];
    for (const [i, r] of rows.entries()) {
      if (r.problems.length) { fail++; continue; }
      setProgress(`${i + 1} de ${rows.length}: ${r.name}`);
      try {
        // Categoría (se crea si no existe)
        let cat = cats.find((c) => norm(c.name) === norm(r.category));
        if (!cat) {
          const { data, error } = await sb.from("categories").insert({ business_id: businessId, business_unit_id: r.unitId, name: r.category.trim(), slug: slug(r.category) || `cat-${Date.now()}`,
            show_in_menu: true, active: true, sort: 0 }).select("*").single();
          if (error) throw error;
          cat = data as Category; cats.push(cat);
        }
        const isShop = cat.business_unit_id === shop?.id;
        // Foto
        let image_url: string | null = /^https?:\/\//i.test(r.photo) ? r.photo : null;
        const file = fileFor(r);
        if (r.image || file) {
          const ext = r.image ? r.image.ext : (file!.name.split(".").pop() || "jpg");
          const path = `${businessId}/products/${Date.now()}-${slug(r.name) || "producto"}.${ext}`;
          const body = r.image ? new Blob([r.image.data], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }) : file!;
          const { error } = await sb.storage.from("catalog").upload(path, body, { upsert: false, contentType: body.type || undefined });
          if (error) throw new Error("No se pudo subir la foto: " + errMsg(error));
          image_url = sb.storage.from("catalog").getPublicUrl(path).data.publicUrl;
        }
        const row: Record<string, unknown> = {
          business_id: businessId, business_unit_id: cat.business_unit_id, category_id: cat.id, name: r.name, price: r.price,
          description: r.description || null, sku: r.sku || null, track_stock: isShop ? r.track : true,
        };
        if (r.supplier) row.consignment_supplier_id = r.supplierId;
        if (image_url) row.image_url = image_url;
        let id = r.existing?.id;
        if (id) {
          const { error } = await sb.from("products").update(row).eq("id", id); if (error) throw error;
        } else {
          const { data, error } = await sb.from("products").insert({ ...row, stock_mode: isShop ? "variant" : "none", is_available: true, active: true, sort: 0 }).select("id").single();
          if (error) throw error; id = data.id;
        }
        if (isShop) {
          const sizes = r.sizes.length ? r.sizes : [r.colors.length ? null : "Única"];
          const colors = r.colors.length ? r.colors : [null];
          const have = r.existing?.product_variants ?? [];
          const fresh = sizes.flatMap((s) => colors.map((c) => ({ size: s, color: c })))
            .filter((v) => !have.some((h) => norm(h.size) === norm(v.size) && norm(h.color) === norm(v.color) && norm(h.design) === norm(r.design)))
            .map((v) => ({ business_id: businessId, product_id: id, size: v.size, color: v.color, design: r.design || null, active: true, min_stock: 0, cost: 0,
              sku: r.sku ? [r.sku, v.size, v.color].filter(Boolean).join("-").toUpperCase().replace(/\s+/g, "") : null }));
          if (fresh.length) { const { error } = await sb.from("product_variants").insert(fresh); if (error) throw error; }
        }
        ok++;
      } catch (e) { fail++; errors.push(`Fila ${r.line} (${r.name}): ${errMsg(e)}`); }
    }
    setBusy(false); setProgress("");
    if (errors.length) toast("error", errors.slice(0, 3).join(" · "));
    toast(fail ? "info" : "success", `Importados ${ok} productos${fail ? `, ${fail} con problemas` : ""}`);
    if (ok) onDone();
  }

  const missingFiles = rows?.some((r) => photoState(r) === "Falta el archivo");
  return (
    <Modal open wide onClose={onClose} title="Importar productos desde Excel"
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cerrar</button>
        {rows && <button className="btn-primary" disabled={busy || !rows.some((r) => !r.problems.length)} onClick={run}>{busy ? progress || "Importando…" : `Importar ${rows.filter((r) => !r.problems.length).length} productos`}</button>}
      </>}>
      {!rows ? (
        <div className="space-y-4 text-sm">
          <p>Cargue un archivo de Excel con un producto por fila. Puede pegar la foto de cada producto dentro de su fila, o escribir el nombre del archivo y seleccionar las fotos aparte.</p>
          <button className="btn-secondary" onClick={template}><Download size={16} /> Descargar plantilla</button>
          <label className="btn-primary w-fit cursor-pointer"><FileSpreadsheet size={16} /> {busy ? "Leyendo…" : "Seleccionar archivo .xlsx"}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} /></label>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="btn-secondary cursor-pointer"><ImagePlus size={16} /> {files.length ? `${files.length} fotos seleccionadas` : "Agregar fotos (opcional)"}
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
            {missingFiles && <span className="text-xs text-amber-700">Algunas filas nombran una foto que no ha seleccionado; se importarán sin foto.</span>}
          </div>
          <div className="max-h-[55vh] overflow-auto"><table className="table-base">
            <thead><tr><th>Fila</th><th>Producto</th><th>Categoría</th><th>Negocio</th><th className="text-right">Precio</th><th>Variantes</th><th>Existencias</th><th>Foto</th><th>Estado</th></tr></thead>
            <tbody>{rows.map((r) => {
              const isShop = r.unitId === shop?.id;
              return <tr key={r.line} className={r.problems.length ? "bg-red-50/60" : ""}>
                <td>{r.line}</td><td className="font-medium">{r.name}<div className="text-xs text-charcoal/50">{r.sku}</div></td><td>{r.category}</td>
                <td>{units.find((u) => u.id === r.unitId)?.name}{r.supplier && <div className="text-xs text-charcoal/50">Proveedor: {r.supplier}</div>}</td><td className="text-right">{Number.isFinite(r.price) ? money(r.price) : "—"}</td>
                <td className="text-xs">{isShop ? `${Math.max(r.sizes.length, 1) * Math.max(r.colors.length, 1)} (${[r.sizes.join(", ") || "Única", r.colors.join(", ")].filter(Boolean).join(" · ")})` : "—"}</td>
                <td className="text-xs">{isShop ? (r.track ? "Controla" : "Sin control") : "—"}</td>
                <td className="text-xs">{photoState(r)}</td>
                <td className="text-xs">{r.problems.length ? <span className="text-red-700">{r.problems.join(", ")}</span> : r.existing ? "Actualiza" : "Nuevo"}</td>
              </tr>;
            })}</tbody></table></div>
          <button className="text-xs text-burgundy" onClick={() => setRows(null)} disabled={busy}>Elegir otro archivo</button>
        </div>
      )}
    </Modal>
  );
}

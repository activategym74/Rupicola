export type UnitKind = "gastronomy" | "shop";
export type Unit = { id: string; kind: UnitKind; name: string };
export type Membership = {
  business: { id: string; name: string; slug: string; logo_url: string | null; timezone: string; currency: string };
  member: { id: string; full_name: string };
  role: { id: string; code: string; name: string };
  permissions: string[];
  units: Unit[];
};
export type Category = { id: string; name: string; slug: string; business_unit_id: string; default_station_id: string | null; sort: number; show_in_menu: boolean; active: boolean };
export type Variant = { id: string; product_id: string; sku: string | null; barcode: string | null; size: string | null; color: string | null; design: string | null; price: number | null; cost: number; stock: number; min_stock: number; image_url: string | null; model_3d_url: string | null; active: boolean };
export type ModifierOption = { id: string; group_id: string; name: string; price_delta: number; ingredient_id: string | null; ingredient_qty: number; sort: number };
export type ModifierGroup = { id: string; product_id: string; name: string; min_select: number; max_select: number; sort: number; modifier_options?: ModifierOption[] };
export type Product = {
  id: string; business_unit_id: string; category_id: string; station_id: string | null; sku: string | null; barcode: string | null;
  name: string; description: string | null; ingredients_text: string | null; price: number; tax_rate: number;
  image_url: string | null; model_3d_url: string | null; is_featured: boolean; is_recommended: boolean; is_available: boolean;
  stock_mode: "recipe" | "variant" | "none"; sort: number; active: boolean;
  product_variants?: Variant[]; modifier_groups?: ModifierGroup[];
};
export type CartLine = {
  key: string; product_id: string; variant_id?: string; name: string; variant_label?: string;
  qty: number; unit_price: number; option_ids: string[]; option_names: string[]; notes?: string; unit_kind: UnitKind;
};
export const variantLabel = (v: Pick<Variant, "size" | "color" | "design">) => [v.size, v.color, v.design].filter(Boolean).join(" / ");

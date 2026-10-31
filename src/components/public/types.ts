export type PubVariant = { id: string; size: string | null; color: string | null; design: string | null; price: number; available: boolean; image_url: string | null; model_3d_url: string | null };
export type PubOption = { id: string; name: string; price_delta: number };
export type PubGroup = { id: string; name: string; min: number; max: number; options: PubOption[] };
export type PubProduct = {
  id: string; category_id: string; name: string; description: string | null; ingredients_text: string | null; price: number;
  image_url: string | null; model_3d_url: string | null; is_featured: boolean; is_recommended: boolean; is_available: boolean;
  stock_mode: string; variants: PubVariant[]; modifier_groups: PubGroup[];
};
export type PubMenu = {
  business: { id: string; name: string; slug: string; logo_url: string | null; phone: string | null; address: string | null; delivery_enabled: boolean; pickup_enabled: boolean; tip_suggested_pct: number };
  categories: { id: string; name: string; slug: string; unit: "gastronomy" | "shop" }[];
  products: PubProduct[];
  payment_methods: { id: string; code: string; name: string; is_cash: boolean; gateway: string | null }[];
  zones: { id: string; name: string; fee: number; min_order: number; eta_minutes: number; polygon: [number, number][] | null; center_lat: number | null; center_lng: number | null; radius_km: number | null }[];
};
export type PubLine = { key: string; product_id: string; variant_id?: string; name: string; detail: string; qty: number; unit_price: number; option_ids: string[]; notes?: string; unit: "gastronomy" | "shop" };

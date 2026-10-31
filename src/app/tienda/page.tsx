import { redirect } from "next/navigation";
export default function ShopIndex() { redirect(`/tienda/${process.env.NEXT_PUBLIC_DEFAULT_SLUG || "rupicola"}`); }

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Genera el enlace al Web Checkout de Wompi para un pedido en línea.
 * REQUIERE CONEXIÓN EXTERNA: NEXT_PUBLIC_WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET.
 * El pago se confirma únicamente cuando llega el evento firmado al webhook.
 */
export async function GET(req: Request) {
  const pub = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY, secret = process.env.WOMPI_INTEGRITY_SECRET;
  if (!pub || !secret) return NextResponse.json({ error: "Pagos en línea no configurados (faltan credenciales de Wompi)" }, { status: 503 });
  const token = new URL(req.url).searchParams.get("token");
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });

  const { data: order } = await supabaseAdmin().from("orders").select("total, tip, paid_total, status").eq("tracking_token", token).single();
  if (!order || order.status === "cancelled") return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  const due = Number(order.total) + Number(order.tip) - Number(order.paid_total);
  if (due <= 0) return NextResponse.json({ error: "El pedido ya está pagado" }, { status: 400 });

  const amountInCents = Math.round(due * 100);
  const reference = `${token}-${Date.now()}`;
  const signature = createHash("sha256").update(`${reference}${amountInCents}COP${secret}`).digest("hex");
  const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const url = new URL("https://checkout.wompi.co/p/");
  url.searchParams.set("public-key", pub);
  url.searchParams.set("currency", "COP");
  url.searchParams.set("amount-in-cents", String(amountInCents));
  url.searchParams.set("reference", reference);
  url.searchParams.set("signature:integrity", signature);
  url.searchParams.set("redirect-url", `${site}/pedido/${token}`);
  return NextResponse.json({ url: url.toString() });
}

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

type WompiEvent = {
  event: string; timestamp: number;
  data: { transaction: { id: string; status: string; amount_in_cents: number; reference: string; payment_method_type?: string } & Record<string, unknown> };
  signature: { properties: string[]; checksum: string };
};

const get = (obj: unknown, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);

/**
 * Webhook de eventos de Wompi. Verifica la firma con WOMPI_EVENTS_SECRET
 * y solo entonces registra el pago (idempotente por referencia).
 */
export async function POST(req: Request) {
  const secret = process.env.WOMPI_EVENTS_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook no configurado" }, { status: 503 });
  const body = (await req.json()) as WompiEvent;
  const concat = body.signature.properties.map((p) => String(get(body.data, p))).join("") + body.timestamp + secret;
  const expected = createHash("sha256").update(concat).digest("hex");
  const given = String(body.signature.checksum).toLowerCase();
  if (expected.length !== given.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  if (body.event !== "transaction.updated") return NextResponse.json({ ok: true });

  const tx = body.data.transaction;
  const status = tx.status === "APPROVED" ? "approved" : tx.status === "PENDING" ? "pending" : "rejected";
  if (status === "pending") return NextResponse.json({ ok: true });
  const tracking = tx.reference.split("-")[0];
  const { error } = await supabaseAdmin().rpc("gateway_confirm_payment", {
    p_tracking: tracking, p_amount: tx.amount_in_cents / 100, p_reference: tx.id, p_gateway: "wompi", p_status: status, p_payload: body.data,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

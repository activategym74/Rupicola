import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Envía la cola de mensajes de WhatsApp (WhatsApp Business Platform · Cloud API).
 * Invocar con un cron (ej. cada minuto): Authorization: Bearer CRON_SECRET.
 * REQUIERE CONEXIÓN EXTERNA: WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID, y una
 * plantilla aprobada por Meta. Sin credenciales, los mensajes quedan "skipped":
 * nunca se marcan como enviados sin respuesta exitosa de la API.
 */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const sb = supabaseAdmin();
  const { data: queue } = await sb.from("notification_outbox").select("*").eq("status", "pending").lt("attempts", 5).order("created_at").limit(50);
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  let sent = 0, failed = 0, skipped = 0;

  for (const m of queue ?? []) {
    if (m.channel !== "whatsapp" || !token || !phoneId) {
      await sb.from("notification_outbox").update({ status: "skipped", last_error: "WhatsApp no configurado" }).eq("id", m.id);
      skipped++; continue;
    }
    // Números colombianos: 10 dígitos → prefijo 57
    const digits = String(m.recipient).replace(/\D/g, "");
    const to = digits.length === 10 ? `57${digits}` : digits;
    const p = m.payload as Record<string, string>;
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE_ORDER_STATUS || "order_status",
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "es_CO" },
          components: [{ type: "body", parameters: [
            { type: "text", text: p.customer_name ?? "" }, { type: "text", text: String(p.order_number) },
            { type: "text", text: p.message }, { type: "text", text: `${site}/pedido/${p.tracking_token}` },
          ] }],
        },
      }),
    });
    if (res.ok) { await sb.from("notification_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: m.attempts + 1 }).eq("id", m.id); sent++; }
    else {
      const err = await res.text();
      await sb.from("notification_outbox").update({ status: m.attempts + 1 >= 5 ? "failed" : "pending", attempts: m.attempts + 1, last_error: err.slice(0, 500) }).eq("id", m.id);
      failed++;
    }
  }
  return NextResponse.json({ sent, failed, skipped });
}

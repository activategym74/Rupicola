export type OrderItem = {
  id: string; order_id: string; product_id: string; variant_id: string | null; business_unit_id: string; station_id: string | null;
  ticket_id: string | null; name: string; variant_label: string | null; qty: number; unit_price: number; modifiers: { name: string }[];
  notes: string | null; discount: number; line_total: number; status: "active" | "voided"; void_reason: string | null; stock_applied: boolean;
};
export type Payment = { id: string; amount: number; status: string; reference: string | null; change_amount: number; received_amount: number | null; created_at: string; method_id: string; payment_methods: { name: string } | null };
export type Order = {
  id: string; number: number; channel: string; status: string; table_id: string | null; customer_id: string | null; customer_name: string | null;
  subtotal: number; discount_total: number; delivery_fee: number; total: number; tip: number; paid_total: number; finalized: boolean;
  created_at: string; paid_at: string | null; notes: string | null;
  order_items: OrderItem[]; payments: Payment[]; dining_tables: { number: number } | null;
};
export const ORDER_SELECT = "*, order_items(*), payments(*, payment_methods(name)), dining_tables!orders_table_id_fkey(number)";

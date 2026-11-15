-- Menú QR configurable: "solo para ver" o "ver y pedir".
-- Por defecto queda como estaba (los clientes pueden pedir desde el QR).

alter table businesses add column if not exists qr_ordering_enabled boolean not null default true;

-- El menú de la mesa necesita saber si se permite pedir
create or replace function public_table(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('table_id', t.id, 'number', t.number, 'name', t.name, 'slug', b.slug,
    'ordering', b.qr_ordering_enabled)
  from dining_tables t join businesses b on b.id = t.business_id
  where t.qr_token = p_token and t.active;
$$;

-- Pedido desde el QR de la mesa: llega directo al KDS (solo si el negocio lo permite)
create or replace function qr_place_order(p_token text, p_items jsonb, p_customer_name text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t dining_tables%rowtype; v_order uuid; v_new boolean := false;
begin
  select * into t from dining_tables where qr_token = p_token and active;
  if not found then raise exception 'Código QR no válido'; end if;
  if not (select qr_ordering_enabled from businesses where id = t.business_id) then
    raise exception 'Los pedidos desde el celular están desactivados. Llama al mesero para pedir.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) > 40 then raise exception 'Demasiados productos en un pedido'; end if;

  select id into v_order from orders
    where table_id = t.id and status not in ('paid', 'cancelled') and merged_into_id is null
    order by created_at limit 1 for update;
  if v_order is null then
    insert into orders (business_id, number, channel, table_id, customer_name, notes)
    values (t.business_id, next_order_number(t.business_id), 'qr', t.id, nullif(left(trim(p_customer_name), 80), ''), left(p_notes, 300))
    returning id into v_order;
    v_new := true;
    perform log_status(t.business_id, v_order, 'order', v_order, null, 'open', 'Pedido QR');
  end if;
  perform add_order_lines(v_order, p_items);
  perform route_order(v_order);
  perform notify(t.business_id, 'tables.manage', null, 'qr_order',
    'Pedido QR · Mesa ' || t.number, case when v_new then 'Nuevo pedido' else 'Productos adicionales' end,
    jsonb_build_object('order_id', v_order, 'table_id', t.id));
  return jsonb_build_object('order_id', v_order, 'tracking_token', (select tracking_token from orders where id = v_order));
end $$;

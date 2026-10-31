-- =====================================================================
-- RUPÍCOLA · 0005 · Motor de pedidos: POS, KDS, pagos mixtos, reparto por
-- unidad, descuento automático de inventario, caja y mesas.
-- Toda escritura operativa pasa por estas funciones (security definer),
-- que validan permisos y dejan trazabilidad.
-- =====================================================================

alter table order_items add column stock_applied boolean not null default false;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function next_order_number(b uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into order_counters (business_id, last_number) values (b, 1)
  on conflict (business_id) do update set last_number = order_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;

create or replace function log_status(b uuid, o uuid, ent text, ent_id uuid, f text, t text, note text default null)
returns void language sql security definer set search_path = public as $$
  insert into order_status_history (business_id, order_id, entity, entity_id, from_status, to_status, note, member_id)
  values (b, o, ent, ent_id, f, t, note, current_member_id(b));
$$;

create or replace function notify(b uuid, perm text, member uuid, k text, t text, bd text, d jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into notifications (business_id, target_perm, member_id, kind, title, body, data)
  values (b, perm, member, k, t, bd, d);
$$;

create or replace function unit_id(b uuid, k unit_kind) returns uuid
language sql stable security definer set search_path = public as $$
  select id from business_units where business_id = b and kind = k;
$$;

create or replace function recalc_order(o uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update orders set
    subtotal = coalesce((select sum(round(qty * unit_price, 2)) from order_items where order_id = o and status = 'active'), 0),
    discount_total = coalesce((select sum(discount) from order_items where order_id = o and status = 'active'), 0)
  where id = o;
  update orders set total = greatest(subtotal - discount_total + delivery_fee, 0) where id = o;
end $$;

-- Estado visual de la mesa a partir de pedidos y solicitudes abiertas
create or replace function refresh_table_status(t uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status table_status;
  v_order uuid;
begin
  if t is null then return; end if;
  select id into v_order from orders
    where table_id = t and status not in ('paid', 'cancelled') and merged_into_id is null
    order by created_at limit 1;

  if v_order is null then
    v_status := 'available';
  elsif exists (select 1 from service_requests where table_id = t and status = 'open' and kind = 'bill') then
    v_status := 'requesting_bill';
  elsif exists (select 1 from service_requests where table_id = t and status = 'open') then
    v_status := 'needs_attention';
  elsif exists (select 1 from kds_tickets k join orders o on o.id = k.order_id
                where o.table_id = t and o.status not in ('paid','cancelled') and k.status = 'ready') then
    v_status := 'order_ready';
  elsif exists (select 1 from kds_tickets k join orders o on o.id = k.order_id
                where o.table_id = t and o.status not in ('paid','cancelled') and k.status in ('accepted','preparing')) then
    v_status := 'preparing';
  elsif exists (select 1 from kds_tickets k join orders o on o.id = k.order_id
                where o.table_id = t and o.status not in ('paid','cancelled') and k.status = 'received') then
    v_status := 'pending_order';
  else
    v_status := 'occupied';
  end if;

  update dining_tables set
    status = v_status,
    current_order_id = v_order,
    status_changed_at = case when status <> v_status then now() else status_changed_at end
  where id = t;
end $$;

-- ---------------------------------------------------------------------
-- Construcción de líneas: valida producto, variante, existencias y
-- modificadores; toma precio y costo del catálogo (nunca del cliente).
-- items: [{product_id, variant_id?, qty, option_ids?: [], notes?}]
-- ---------------------------------------------------------------------
create or replace function add_order_lines(o uuid, items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  it jsonb;
  p products%rowtype;
  v product_variants%rowtype;
  v_qty numeric;
  v_price numeric;
  v_mods jsonb;
  v_delta numeric;
  v_station uuid;
  v_count int := 0;
begin
  select * into v_order from orders where id = o for update;
  if v_order.status in ('paid', 'cancelled') then raise exception 'El pedido ya está cerrado'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'El pedido no tiene productos';
  end if;

  for it in select * from jsonb_array_elements(items) loop
    v_qty := coalesce((it->>'qty')::numeric, 1);
    if v_qty <= 0 or v_qty > 999 then raise exception 'Cantidad inválida'; end if;

    select * into p from products where id = (it->>'product_id')::uuid and business_id = v_order.business_id and active;
    if not found then raise exception 'Producto no encontrado'; end if;
    if not p.is_available then raise exception '"%" no está disponible en este momento', p.name; end if;

    v := null;
    if p.stock_mode = 'variant' or it ? 'variant_id' and it->>'variant_id' is not null then
      select * into v from product_variants
        where id = (it->>'variant_id')::uuid and product_id = p.id and active;
      if not found then raise exception 'Seleccione talla / color para "%"', p.name; end if;
      if v.stock < v_qty then
        raise exception 'Sin existencias suficientes de "%" (%): disponibles %', p.name,
          concat_ws(' / ', v.size, v.color, v.design), v.stock;
      end if;
    end if;

    -- Modificadores válidos de este producto
    select coalesce(jsonb_agg(jsonb_build_object('option_id', mo.id, 'name', mo.name, 'price_delta', mo.price_delta, 'group', mg.name)), '[]'::jsonb),
           coalesce(sum(mo.price_delta), 0)
      into v_mods, v_delta
    from modifier_options mo join modifier_groups mg on mg.id = mo.group_id
    where mg.product_id = p.id
      and mo.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(it->'option_ids', '[]')) x);

    v_price := coalesce(v.price, p.price) + v_delta;
    v_station := coalesce(p.station_id, (select default_station_id from categories where id = p.category_id));
    if (select kind from business_units where id = p.business_unit_id) = 'shop' then
      v_station := null;   -- la tienda nunca va a cocina
    end if;

    insert into order_items (business_id, order_id, product_id, variant_id, business_unit_id, station_id,
                             name, variant_label, qty, unit_price, modifiers, notes, unit_cost)
    values (v_order.business_id, o, p.id, v.id, p.business_unit_id, v_station,
            p.name, case when v.id is not null then concat_ws(' / ', v.size, v.color, v.design) end,
            v_qty, v_price, v_mods, nullif(left(trim(it->>'notes'), 300), ''),
            product_unit_cost(p.id, v.id));
    v_count := v_count + 1;
  end loop;

  perform recalc_order(o);
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Inventario por pedido
-- ---------------------------------------------------------------------
create or replace function apply_order_stock(o uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  li order_items%rowtype;
  p products%rowtype;
  r record;
begin
  for li in select * from order_items where order_id = o and status = 'active' and not stock_applied for update loop
    select * into p from products where id = li.product_id;
    if li.variant_id is not null then
      insert into inventory_movements (business_id, business_unit_id, variant_id, kind, qty, unit_cost, order_id, order_item_id, reason)
      values (li.business_id, li.business_unit_id, li.variant_id, 'sale', -li.qty, li.unit_cost, o, li.id, 'Venta');
    elsif p.stock_mode = 'recipe' then
      -- Receta base + ajustes de modificadores (extra queso suma, "sin" resta)
      for r in
        select ingredient_id, sum(q) as q from (
          select ri.ingredient_id, ri.qty as q from recipe_items ri where ri.product_id = li.product_id
          union all
          select mo.ingredient_id, mo.ingredient_qty
          from modifier_options mo
          where mo.ingredient_id is not null
            and mo.id in (select (m->>'option_id')::uuid from jsonb_array_elements(li.modifiers) m)
        ) s group by ingredient_id
      loop
        if r.q > 0 then
          insert into inventory_movements (business_id, business_unit_id, ingredient_id, kind, qty, unit_cost, order_id, order_item_id, reason)
          select li.business_id, li.business_unit_id, r.ingredient_id, 'sale', -(r.q * li.qty), i.cost_per_unit, o, li.id, 'Consumo por receta'
          from ingredients i where i.id = r.ingredient_id;
        end if;
      end loop;
    end if;
    update order_items set stock_applied = true where id = li.id;
  end loop;
end $$;

-- Devuelve a inventario lo descontado por una línea (anulación antes de preparar)
create or replace function reverse_item_stock(item uuid, why text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into inventory_movements (business_id, business_unit_id, ingredient_id, variant_id, kind, qty, unit_cost, order_id, order_item_id, reverses_id, reason)
  select m.business_id, m.business_unit_id, m.ingredient_id, m.variant_id, 'reversal', -m.qty, m.unit_cost, m.order_id, m.order_item_id, m.id, why
  from inventory_movements m
  where m.order_item_id = item and m.kind = 'sale'
    and not exists (select 1 from inventory_movements r where r.reverses_id = m.id);
  update order_items set stock_applied = false where id = item;
end $$;

-- ---------------------------------------------------------------------
-- Envío a estaciones (KDS): un ticket por estación y por ronda
-- ---------------------------------------------------------------------
create or replace function route_order(o uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  s record;
  v_ticket uuid;
  n int := 0;
  v_label text;
begin
  select * into v_order from orders where id = o;
  for s in
    select oi.station_id, st.code, st.name from order_items oi join stations st on st.id = oi.station_id
    where oi.order_id = o and oi.status = 'active' and oi.ticket_id is null
    group by oi.station_id, st.code, st.name
  loop
    insert into kds_tickets (business_id, order_id, station_id) values (v_order.business_id, o, s.station_id)
    returning id into v_ticket;
    update order_items set ticket_id = v_ticket
      where order_id = o and station_id = s.station_id and ticket_id is null and status = 'active';
    perform log_status(v_order.business_id, o, 'ticket', v_ticket, null, 'received');
    v_label := case when v_order.table_id is not null
      then 'Mesa ' || (select number from dining_tables where id = v_order.table_id)
      else initcap(v_order.channel::text) end;
    perform notify(v_order.business_id, 'kds.' || s.code, null, 'kds_new',
      'Nuevo pedido #' || v_order.number, v_label, jsonb_build_object('order_id', o, 'ticket_id', v_ticket));
    n := n + 1;
  end loop;

  if v_order.status = 'open' then
    update orders set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()) where id = o;
    perform log_status(v_order.business_id, o, 'order', o, 'open', 'confirmed');
  end if;

  if (select inventory_policy from businesses where id = v_order.business_id) = 'on_confirm' then
    perform apply_order_stock(o);
  end if;

  perform refresh_table_status(v_order.table_id);
  return n;
end $$;

-- ---------------------------------------------------------------------
-- POS: crear pedido / agregar productos
-- ---------------------------------------------------------------------
create or replace function pos_create_order(
  p_business uuid, p_channel order_channel, p_items jsonb,
  p_table uuid default null, p_customer uuid default null, p_customer_name text default null,
  p_notes text default null, p_send boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_perm(p_business, 'pos.sell');
  if p_channel not in ('counter', 'table', 'pickup') then raise exception 'Canal no permitido en POS'; end if;
  if p_table is not null and not exists (select 1 from dining_tables where id = p_table and business_id = p_business and active) then
    raise exception 'Mesa no encontrada';
  end if;
  insert into orders (business_id, number, channel, table_id, customer_id, customer_name, waiter_id, notes)
  values (p_business, next_order_number(p_business),
          case when p_table is not null then 'table' else p_channel end,
          p_table, p_customer, p_customer_name, current_member_id(p_business), p_notes)
  returning id into v_id;
  perform log_status(p_business, v_id, 'order', v_id, null, 'open');
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    perform add_order_lines(v_id, p_items);
    if p_send then perform route_order(v_id); end if;
  end if;
  perform refresh_table_status(p_table);
  return v_id;
end $$;

create or replace function pos_add_items(p_order uuid, p_items jsonb, p_send boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare b uuid; n int;
begin
  select business_id into b from orders where id = p_order;
  perform require_perm(b, 'pos.sell');
  n := add_order_lines(p_order, p_items);
  if p_send then perform route_order(p_order); end if;
  return n;
end $$;

create or replace function pos_send_to_stations(p_order uuid) returns int
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  select business_id into b from orders where id = p_order;
  perform require_perm(b, 'pos.sell');
  return route_order(p_order);
end $$;

create or replace function pos_update_qty(p_item uuid, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
declare li order_items%rowtype;
begin
  select * into li from order_items where id = p_item for update;
  perform require_perm(li.business_id, 'pos.sell');
  if li.ticket_id is not null or li.stock_applied then
    raise exception 'La línea ya fue enviada; anule y agregue de nuevo';
  end if;
  if p_qty <= 0 then raise exception 'Cantidad inválida'; end if;
  update order_items set qty = p_qty where id = p_item;
  perform recalc_order(li.order_id);
end $$;

-- Anular una línea (con permiso y motivo). Nunca se borra.
create or replace function pos_void_item(p_item uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare li order_items%rowtype; v_ticket kds_tickets%rowtype; o orders%rowtype;
begin
  select * into li from order_items where id = p_item for update;
  select * into o from orders where id = li.order_id;
  -- Una línea aún no enviada la puede quitar quien vende; enviada requiere permiso
  if li.ticket_id is null and not li.stock_applied then
    perform require_perm(li.business_id, 'pos.sell');
  else
    perform require_perm(li.business_id, 'pos.void');
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Indique el motivo de la anulación'; end if;
  if li.status = 'voided' then return; end if;
  if o.finalized then raise exception 'El pedido ya fue pagado: use devolución'; end if;

  select * into v_ticket from kds_tickets where id = li.ticket_id;
  -- Si no se ha empezado a preparar, el inventario se devuelve
  if li.stock_applied and (v_ticket.id is null or v_ticket.status in ('received', 'accepted', 'rejected')) then
    perform reverse_item_stock(p_item, 'Anulación: ' || p_reason);
  end if;

  update order_items set status = 'voided', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
    where id = p_item;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, old_data, reason, order_id, business_unit_id)
  values (li.business_id, auth.uid(), current_member_id(li.business_id), 'order_items', p_item::text, 'void',
          to_jsonb(li), p_reason, li.order_id, li.business_unit_id);
  perform recalc_order(li.order_id);

  -- Si el ticket quedó vacío, se cierra
  if v_ticket.id is not null and not exists (select 1 from order_items where ticket_id = v_ticket.id and status = 'active') then
    update kds_tickets set status = 'rejected', rejected_reason = 'Productos anulados' where id = v_ticket.id;
  end if;
  perform refresh_table_status(o.table_id);
end $$;

-- Descuento sobre una línea (valor o %), con permiso y motivo
create or replace function pos_discount_item(p_item uuid, p_amount numeric, p_pct numeric, p_reason text, p_promotion text default null)
returns void language plpgsql security definer set search_path = public as $$
declare li order_items%rowtype; v_disc numeric;
begin
  select * into li from order_items where id = p_item for update;
  if p_promotion is null then perform require_perm(li.business_id, 'pos.discount');
  else perform require_perm(li.business_id, 'pos.sell'); end if;
  if (select finalized from orders where id = li.order_id) then raise exception 'Pedido cerrado'; end if;
  v_disc := coalesce(p_amount, round(li.qty * li.unit_price * coalesce(p_pct, 0) / 100, 2));
  if v_disc < 0 or v_disc > li.qty * li.unit_price then raise exception 'Descuento inválido'; end if;
  update order_items set discount = v_disc, promotion = coalesce(p_promotion, p_reason) where id = p_item;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, old_data, new_data, reason, order_id, business_unit_id)
  values (li.business_id, auth.uid(), current_member_id(li.business_id), 'order_items', p_item::text, 'discount',
          jsonb_build_object('discount', li.discount), jsonb_build_object('discount', v_disc), p_reason, li.order_id, li.business_unit_id);
  perform recalc_order(li.order_id);
end $$;

-- Descuento porcentual a toda la cuenta (se reparte por línea → por unidad)
create or replace function pos_discount_order(p_order uuid, p_pct numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare li record;
begin
  if p_pct < 0 or p_pct > 100 then raise exception 'Porcentaje inválido'; end if;
  for li in select id from order_items where order_id = p_order and status = 'active' loop
    perform pos_discount_item(li.id, null, p_pct, p_reason);
  end loop;
end $$;

create or replace function pos_set_tip(p_order uuid, p_tip numeric) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  perform require_perm(o.business_id, 'pos.charge');
  if o.finalized then raise exception 'Pedido cerrado'; end if;
  if p_tip < 0 then raise exception 'Propina inválida'; end if;
  if o.paid_total > o.total + p_tip then raise exception 'La propina no puede quedar por debajo de lo ya pagado'; end if;
  update orders set tip = p_tip where id = p_order;
end $$;

-- Dividir cuenta: mueve líneas a un nuevo pedido de la misma mesa
create or replace function pos_split_order(p_order uuid, p_items uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_new uuid;
begin
  select * into o from orders where id = p_order for update;
  perform require_perm(o.business_id, 'pos.sell');
  if o.paid_total > 0 then raise exception 'La cuenta tiene pagos; divida antes de cobrar'; end if;
  if (select count(*) from order_items where order_id = p_order and status = 'active' and not (id = any(p_items))) = 0 then
    raise exception 'Deje al menos un producto en la cuenta original';
  end if;
  insert into orders (business_id, number, channel, status, table_id, customer_id, customer_name, waiter_id, parent_order_id, confirmed_at)
  values (o.business_id, next_order_number(o.business_id), o.channel, o.status, o.table_id, o.customer_id, o.customer_name,
          o.waiter_id, o.id, o.confirmed_at)
  returning id into v_new;
  update order_items set order_id = v_new where order_id = p_order and id = any(p_items) and status = 'active';
  -- Los tickets acompañan a sus líneas (puede haber tickets compartidos; se referencian por línea)
  perform recalc_order(p_order); perform recalc_order(v_new);
  perform log_status(o.business_id, v_new, 'order', v_new, null, o.status::text, 'Dividida de #' || o.number);
  return v_new;
end $$;

-- Unificar cuentas autorizadas
create or replace function pos_merge_orders(p_target uuid, p_source uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t orders%rowtype; s orders%rowtype;
begin
  select * into t from orders where id = p_target for update;
  select * into s from orders where id = p_source for update;
  perform require_perm(t.business_id, 'pos.merge');
  if t.business_id <> s.business_id or t.id = s.id then raise exception 'Cuentas inválidas'; end if;
  if s.paid_total > 0 or t.finalized or s.finalized then raise exception 'Solo se unifican cuentas sin pagos'; end if;
  update order_items set order_id = p_target where order_id = p_source;
  update kds_tickets set order_id = p_target where order_id = p_source;
  update orders set status = 'cancelled', merged_into_id = p_target, cancel_reason = 'Unificada en #' || t.number, closed_at = now()
    where id = p_source;
  perform recalc_order(p_target);
  perform log_status(t.business_id, p_source, 'order', p_source, s.status::text, 'cancelled', 'Unificada en #' || t.number);
  perform refresh_table_status(s.table_id); perform refresh_table_status(t.table_id);
end $$;

-- Cambiar de mesa / transferir pedido
create or replace function pos_transfer_table(p_order uuid, p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  perform require_perm(o.business_id, 'tables.manage');
  if not exists (select 1 from dining_tables where id = p_table and business_id = o.business_id) then
    raise exception 'Mesa no encontrada';
  end if;
  update orders set table_id = p_table, channel = 'table' where id = p_order;
  update service_requests set table_id = p_table where order_id = p_order and status = 'open';
  perform log_status(o.business_id, p_order, 'order', p_order, 'mesa ' || coalesce((select number::text from dining_tables where id = o.table_id), '-'),
                     'mesa ' || (select number from dining_tables where id = p_table), 'Cambio de mesa');
  perform refresh_table_status(o.table_id); perform refresh_table_status(p_table);
end $$;

-- ---------------------------------------------------------------------
-- Pagos mixtos y reparto por unidad de negocio
-- ---------------------------------------------------------------------
-- Reparte un pago entre "bolsas" (unidades + domicilio + propina) de modo
-- que, acumulado, cada bolsa reciba exactamente su parte del total.
create or replace function allocate_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  pay payments%rowtype; o orders%rowtype;
  v_grand numeric; v_paid_after numeric; v_remaining numeric;
  bk record; v_target numeric; v_already numeric; v_amt numeric;
  v_gastro uuid;
begin
  select * into pay from payments where id = p_payment;
  select * into o from orders where id = pay.order_id;
  v_gastro := unit_id(o.business_id, 'gastronomy');
  v_grand := o.total + o.tip;
  v_paid_after := least((select coalesce(sum(amount), 0) from payments where order_id = o.id and status = 'approved'), v_grand);
  v_remaining := pay.amount;

  for bk in
    select unit, concept, sum(amt) as amt from (
      select business_unit_id as unit, 'sale'::text as concept, line_total as amt
        from order_items where order_id = o.id and status = 'active'
      union all select v_gastro, 'sale', o.delivery_fee where o.delivery_fee > 0
      union all select null, 'tip', o.tip where o.tip > 0
    ) s group by unit, concept
    order by concept, amt
  loop
    v_target := case when v_grand = 0 then 0 else round(bk.amt * v_paid_after / v_grand, 2) end;
    select coalesce(sum(amount), 0) into v_already from payment_allocations
      where order_id = o.id and concept = bk.concept and business_unit_id is not distinct from bk.unit;
    v_amt := least(greatest(v_target - v_already, 0), v_remaining);
    if v_amt > 0 then
      insert into payment_allocations (business_id, payment_id, order_id, business_unit_id, concept, amount)
      values (o.business_id, pay.id, o.id, bk.unit, bk.concept, v_amt);
      v_remaining := v_remaining - v_amt;
    end if;
  end loop;

  -- Centavos de redondeo: a la bolsa más grande
  if v_remaining > 0 then
    insert into payment_allocations (business_id, payment_id, order_id, business_unit_id, concept, amount)
    select o.business_id, pay.id, o.id, business_unit_id, 'sale', v_remaining
    from order_items where order_id = o.id and status = 'active'
    group by business_unit_id order by sum(line_total) desc limit 1;
  end if;

  -- Caja: un movimiento por unidad y método, para que el arqueo y los
  -- ingresos queden separados por unidad
  if pay.cash_session_id is not null then
    insert into cash_movements (business_id, session_id, business_unit_id, method_id, kind, amount, payment_id, order_id, description)
    select o.business_id, pay.cash_session_id, pa.business_unit_id, pay.method_id,
           case when o.channel = 'delivery' then 'delivery_collection'::cash_movement_kind else 'sale'::cash_movement_kind end,
           pa.amount, pay.id, o.id, 'Pedido #' || o.number || case when pa.concept = 'tip' then ' (propina)' else '' end
    from payment_allocations pa where pa.payment_id = pay.id;
  end if;
end $$;

-- Reconoce ingresos y costos por unidad cuando el pedido queda pagado
create or replace function finalize_order(o_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_gastro uuid; v_points numeric;
begin
  select * into o from orders where id = o_id for update;
  if o.finalized then return; end if;
  v_gastro := unit_id(o.business_id, 'gastronomy');

  perform apply_order_stock(o_id);

  insert into revenue_entries (business_id, business_unit_id, order_id, concept, amount, cost)
  select o.business_id, business_unit_id, o.id, 'sale', sum(line_total), round(sum(qty * unit_cost), 2)
  from order_items where order_id = o.id and status = 'active'
  group by business_unit_id;
  if o.delivery_fee > 0 then
    insert into revenue_entries (business_id, business_unit_id, order_id, concept, amount)
    values (o.business_id, v_gastro, o.id, 'delivery_fee', o.delivery_fee);
  end if;
  if o.tip > 0 then
    insert into revenue_entries (business_id, business_unit_id, order_id, concept, amount)
    values (o.business_id, null, o.id, 'tip', o.tip);
  end if;

  update orders set finalized = true, status = 'paid', paid_at = now(),
    closed_at = case when channel in ('delivery', 'pickup') then closed_at else now() end
  where id = o.id;
  perform log_status(o.business_id, o.id, 'order', o.id, o.status::text, 'paid');

  if o.customer_id is not null then
    select case when b.loyalty_enabled then floor(o.total / 1000) * b.loyalty_points_per_1000 else 0 end into v_points
    from businesses b where b.id = o.business_id;
    update customers set total_spent = total_spent + o.total, orders_count = orders_count + 1,
      points = points + coalesce(v_points, 0) where id = o.customer_id;
  end if;

  update service_requests set status = 'attended', attended_at = now()
    where order_id = o.id and kind = 'bill' and status = 'open';
  perform refresh_table_status(o.table_id);
end $$;

-- Registrar uno o varios pagos (efectivo, tarjeta, transferencia, ...)
-- p_payments: [{method_id, amount, received_amount?, reference?}]
create or replace function pos_register_payments(p_order uuid, p_payments jsonb, p_session uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype; pm payment_methods%rowtype; it jsonb;
  v_due numeric; v_amt numeric; v_recv numeric; v_pay uuid; v_change numeric := 0;
begin
  select * into o from orders where id = p_order for update;
  perform require_perm(o.business_id, 'pos.charge');
  if o.status = 'cancelled' then raise exception 'Pedido anulado'; end if;
  if o.finalized then raise exception 'El pedido ya está pagado'; end if;
  if p_session is not null and not exists (
    select 1 from cash_sessions where id = p_session and business_id = o.business_id and closed_at is null) then
    raise exception 'La caja seleccionada no está abierta';
  end if;

  for it in select * from jsonb_array_elements(p_payments) loop
    v_due := o.total + o.tip - (select coalesce(sum(amount), 0) from payments where order_id = o.id and status = 'approved');
    v_amt := round((it->>'amount')::numeric, 2);
    select * into pm from payment_methods where id = (it->>'method_id')::uuid and business_id = o.business_id and active;
    if not found then raise exception 'Método de pago no válido'; end if;
    if pm.gateway is not null then raise exception 'El método "%" se confirma únicamente por la pasarela', pm.name; end if;
    if v_amt is null or v_amt <= 0 then raise exception 'Valor de pago inválido'; end if;
    if pm.requires_reference and coalesce(trim(it->>'reference'), '') = '' then
      raise exception 'El pago con % requiere número de referencia', pm.name;
    end if;
    if pm.is_cash and p_session is null then raise exception 'Abra una caja para recibir efectivo'; end if;
    if v_amt > v_due then raise exception 'El pago (%) supera el saldo pendiente (%)', v_amt, v_due; end if;

    v_recv := nullif(it->>'received_amount', '')::numeric;
    if pm.is_cash and v_recv is not null then
      if v_recv < v_amt then raise exception 'El efectivo recibido es menor al valor'; end if;
      v_change := v_change + (v_recv - v_amt);
    end if;

    insert into payments (business_id, order_id, method_id, cash_session_id, amount, received_amount, change_amount, status, reference)
    values (o.business_id, o.id, pm.id, p_session, v_amt, v_recv,
            case when pm.is_cash and v_recv is not null then v_recv - v_amt else 0 end, 'approved', nullif(trim(it->>'reference'), ''))
    returning id into v_pay;
    perform allocate_payment(v_pay);
  end loop;

  update orders set paid_total = (select coalesce(sum(amount), 0) from payments where order_id = o.id and status = 'approved')
    where id = o.id returning * into o;
  if o.paid_total >= o.total + o.tip then perform finalize_order(o.id); end if;

  return jsonb_build_object('paid_total', o.paid_total, 'due', greatest(o.total + o.tip - o.paid_total, 0),
                            'change', v_change, 'finalized', o.paid_total >= o.total + o.tip);
end $$;

-- Anular un pago (reverso autorizado). Si el pedido estaba cerrado, se
-- reversan los ingresos reconocidos y la cuenta vuelve a quedar por cobrar.
create or replace function payment_void(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; o orders%rowtype; v_session uuid;
begin
  select * into pay from payments where id = p_payment for update;
  perform require_perm(pay.business_id, 'cash.void_payment');
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Indique el motivo'; end if;
  if pay.status <> 'approved' then raise exception 'El pago no está aprobado'; end if;
  select * into o from orders where id = pay.order_id for update;

  update payments set status = 'voided', void_reason = p_reason, voided_by = auth.uid() where id = p_payment;
  insert into payment_allocations (business_id, payment_id, order_id, business_unit_id, concept, amount)
  select business_id, payment_id, order_id, business_unit_id, concept, -amount
  from payment_allocations where payment_id = p_payment and amount > 0;

  v_session := coalesce(
    (select id from cash_sessions where id = pay.cash_session_id and closed_at is null),
    (select id from cash_sessions where business_id = pay.business_id and closed_at is null order by opened_at desc limit 1));
  if pay.cash_session_id is not null then
    insert into cash_movements (business_id, session_id, business_unit_id, method_id, kind, amount, payment_id, order_id, description)
    select pay.business_id, v_session, pa.business_unit_id, pay.method_id, 'refund', -pa.amount, pay.id, o.id,
           'Reverso pago pedido #' || o.number || ': ' || p_reason
    from payment_allocations pa where pa.payment_id = pay.id and pa.amount > 0;
  end if;

  if o.finalized then
    insert into revenue_entries (business_id, business_unit_id, order_id, concept, amount, cost)
    select business_id, business_unit_id, order_id, 'reversal', -sum(amount), -sum(cost)
    from revenue_entries where order_id = o.id group by business_id, business_unit_id, order_id
    having sum(amount) <> 0 or sum(cost) <> 0;
    if o.customer_id is not null then
      update customers set total_spent = total_spent - o.total, orders_count = greatest(orders_count - 1, 0) where id = o.customer_id;
    end if;
    update orders set finalized = false, status = 'delivered', paid_at = null, closed_at = null where id = o.id;
    perform log_status(o.business_id, o.id, 'order', o.id, 'paid', 'delivered', 'Pago reversado: ' || p_reason);
  end if;

  update orders set paid_total = (select coalesce(sum(amount), 0) from payments where order_id = o.id and status = 'approved')
    where id = o.id;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, old_data, reason, order_id)
  values (pay.business_id, auth.uid(), current_member_id(pay.business_id), 'payments', p_payment::text, 'void', to_jsonb(pay), p_reason, o.id);
  perform refresh_table_status(o.table_id);
end $$;

-- Anular un pedido completo (sin pagos aprobados)
create or replace function order_cancel(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; li record;
begin
  select * into o from orders where id = p_order for update;
  if not (has_perm(o.business_id, 'pos.cancel') or has_perm(o.business_id, 'delivery.manage') and o.channel in ('delivery', 'pickup')) then
    raise exception 'Permiso requerido: pos.cancel' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Indique el motivo'; end if;
  if exists (select 1 from payments where order_id = p_order and status = 'approved') then
    raise exception 'El pedido tiene pagos aprobados: reverse los pagos primero';
  end if;
  if o.status = 'cancelled' then return; end if;
  for li in select id from order_items where order_id = p_order and status = 'active' and stock_applied loop
    perform reverse_item_stock(li.id, 'Pedido anulado: ' || p_reason);
  end loop;
  update order_items set status = 'voided', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
    where order_id = p_order and status = 'active';
  update kds_tickets set status = 'rejected', rejected_reason = 'Pedido anulado: ' || p_reason
    where order_id = p_order and status not in ('delivered', 'rejected');
  update orders set status = 'cancelled', cancel_reason = p_reason, closed_at = now() where id = p_order;
  update deliveries set status = 'cancelled', cancel_reason = p_reason where order_id = p_order;
  perform log_status(o.business_id, p_order, 'order', p_order, o.status::text, 'cancelled', p_reason);
  perform refresh_table_status(o.table_id);
end $$;

-- ---------------------------------------------------------------------
-- KDS
-- ---------------------------------------------------------------------
create or replace function refresh_order_progress(o_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_new order_status; d deliveries%rowtype;
begin
  select * into o from orders where id = o_id for update;
  if o.status in ('paid', 'cancelled', 'open') then
    perform refresh_table_status(o.table_id); return;
  end if;
  select case
    when not exists (select 1 from kds_tickets where order_id = o_id and status <> 'rejected') then o.status
    when not exists (select 1 from kds_tickets where order_id = o_id and status not in ('delivered', 'rejected')) then 'delivered'
    when not exists (select 1 from kds_tickets where order_id = o_id and status not in ('ready', 'delivered', 'rejected')) then 'ready'
    when exists (select 1 from kds_tickets where order_id = o_id and status in ('preparing', 'ready', 'delivered')) then 'in_progress'
    else 'confirmed' end::order_status
  into v_new;
  if v_new <> o.status then
    update orders set status = v_new, ready_at = case when v_new = 'ready' then now() else ready_at end where id = o_id;
    perform log_status(o.business_id, o_id, 'order', o_id, o.status::text, v_new::text);
  end if;

  -- Sincroniza el domicilio
  select * into d from deliveries where order_id = o_id;
  if d.id is not null then
    if v_new = 'in_progress' and d.status = 'confirmed' then
      perform delivery_transition(d.id, 'preparing', null, true);
    elsif v_new in ('ready', 'delivered') and d.status in ('confirmed', 'preparing') then
      perform delivery_transition(d.id, case when d.courier_id is not null then 'courier_assigned' else 'ready_for_dispatch' end::delivery_status, null, true);
    end if;
  end if;
  perform refresh_table_status(o.table_id);
end $$;

create or replace function kds_update_ticket(p_ticket uuid, p_status ticket_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t kds_tickets%rowtype; st stations%rowtype; o orders%rowtype; li record;
begin
  select * into t from kds_tickets where id = p_ticket for update;
  select * into st from stations where id = t.station_id;
  select * into o from orders where id = t.order_id;
  if not (has_perm(t.business_id, 'kds.' || st.code)
          or (p_status = 'delivered' and has_perm(t.business_id, 'tables.manage'))
          or (p_status = 'delivered' and has_perm(t.business_id, 'delivery.manage'))) then
    raise exception 'Permiso requerido: kds.%', st.code using errcode = '42501';
  end if;

  if not (
    (t.status = 'received'  and p_status in ('accepted', 'rejected', 'preparing')) or
    (t.status = 'accepted'  and p_status in ('preparing', 'rejected')) or
    (t.status = 'preparing' and p_status = 'ready') or
    (t.status = 'ready'     and p_status = 'delivered')
  ) then
    raise exception 'Transición no permitida: % → %', t.status, p_status;
  end if;
  if p_status = 'rejected' and coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Debe justificar el rechazo';
  end if;

  update kds_tickets set status = p_status, updated_by = auth.uid(),
    accepted_at = case when p_status in ('accepted', 'preparing') then coalesce(accepted_at, now()) else accepted_at end,
    started_at = case when p_status = 'preparing' then now() else started_at end,
    ready_at = case when p_status = 'ready' then now() else ready_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    rejected_reason = case when p_status = 'rejected' then p_reason else rejected_reason end
  where id = p_ticket;
  perform log_status(t.business_id, t.order_id, 'ticket', p_ticket, t.status::text, p_status::text, p_reason);

  if p_status = 'rejected' then
    for li in select id from order_items where ticket_id = p_ticket and status = 'active' loop
      if (select stock_applied from order_items where id = li.id) then
        perform reverse_item_stock(li.id, 'Rechazado por ' || st.name || ': ' || p_reason);
      end if;
      update order_items set status = 'voided', void_reason = 'Rechazado por ' || st.name || ': ' || p_reason,
        voided_by = auth.uid(), voided_at = now() where id = li.id;
    end loop;
    perform recalc_order(t.order_id);
    perform notify(t.business_id, 'tables.manage', o.waiter_id, 'kds_rejected',
      'Pedido #' || o.number || ' rechazado por ' || st.name, p_reason, jsonb_build_object('order_id', o.id));
  elsif p_status = 'ready' then
    perform notify(t.business_id, case when o.channel in ('delivery','pickup') then 'delivery.manage' else 'tables.manage' end,
      o.waiter_id, 'order_ready', 'Pedido #' || o.number || ' listo en ' || st.name,
      coalesce('Mesa ' || (select number::text from dining_tables where id = o.table_id), o.customer_name, ''),
      jsonb_build_object('order_id', o.id, 'ticket_id', p_ticket));
  end if;
  perform refresh_order_progress(t.order_id);
end $$;

-- ---------------------------------------------------------------------
-- Domicilios
-- ---------------------------------------------------------------------
create or replace function delivery_transition(p_delivery uuid, p_status delivery_status, p_note text default null, p_system boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype; o orders%rowtype; v_label text;
begin
  select * into d from deliveries where id = p_delivery for update;
  if d.status = p_status then return; end if;
  if d.status in ('delivered', 'cancelled') then raise exception 'El domicilio ya está cerrado'; end if;
  select * into o from orders where id = d.order_id;

  update deliveries set status = p_status,
    assigned_at = case when p_status = 'courier_assigned' then coalesce(assigned_at, now()) else assigned_at end,
    picked_up_at = case when p_status = 'picked_up' then now() else picked_up_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_delivery;
  insert into delivery_events (business_id, delivery_id, from_status, to_status, note, member_id)
  values (d.business_id, p_delivery, d.status, p_status, p_note, current_member_id(d.business_id));
  perform log_status(d.business_id, d.order_id, 'delivery', p_delivery, d.status::text, p_status::text, p_note);

  v_label := case p_status
    when 'confirmed' then 'Tu pedido fue confirmado'
    when 'preparing' then 'Estamos preparando tu pedido'
    when 'ready_for_dispatch' then case when o.channel = 'pickup' then 'Tu pedido está listo para recoger' else 'Tu pedido está listo para despacho' end
    when 'courier_assigned' then 'Asignamos un domiciliario a tu pedido'
    when 'picked_up' then 'El domiciliario recogió tu pedido'
    when 'on_the_way' then 'Tu pedido va en camino'
    when 'delivered' then 'Tu pedido fue entregado'
    when 'cancelled' then 'Tu pedido fue cancelado'
    else null end;
  -- Mensaje al cliente: se encola y lo envía el worker solo si hay credenciales de WhatsApp
  if v_label is not null and o.customer_phone is not null then
    insert into notification_outbox (business_id, channel, recipient, template, payload, order_id)
    values (d.business_id, 'whatsapp', o.customer_phone, 'order_status',
            jsonb_build_object('order_number', o.number, 'status', p_status, 'message', v_label,
                               'tracking_token', o.tracking_token, 'customer_name', o.customer_name), o.id);
  end if;
end $$;

-- Confirmación por administración: envía a cocina
create or replace function delivery_confirm(p_delivery uuid, p_fee numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype; n int;
begin
  select * into d from deliveries where id = p_delivery for update;
  perform require_perm(d.business_id, 'delivery.manage');
  if d.status <> 'received' then raise exception 'El pedido ya fue confirmado'; end if;
  if p_fee is not null then
    if p_fee < 0 then raise exception 'Costo de domicilio inválido'; end if;
    update deliveries set fee = p_fee where id = p_delivery;
    update orders set delivery_fee = p_fee where id = d.order_id;
    perform recalc_order(d.order_id);
    update deliveries set cash_to_collect = case when cash_to_collect > 0 then (select total + tip - paid_total from orders where id = d.order_id) else 0 end
      where id = p_delivery;
  end if;
  perform delivery_transition(p_delivery, 'confirmed');
  n := route_order(d.order_id);
  if n = 0 then  -- solo productos de tienda: listo para despacho
    perform delivery_transition(p_delivery, 'ready_for_dispatch', null, true);
  end if;
end $$;

create or replace function delivery_assign(p_delivery uuid, p_courier uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype; o orders%rowtype;
begin
  select * into d from deliveries where id = p_delivery for update;
  perform require_perm(d.business_id, 'delivery.manage');
  if not exists (select 1 from members m join role_permissions rp on rp.role_id = m.role_id
                 where m.id = p_courier and m.business_id = d.business_id and m.active and rp.permission in ('delivery.courier', '*')) then
    raise exception 'El usuario seleccionado no es domiciliario';
  end if;
  if d.status in ('picked_up', 'on_the_way', 'delivered', 'cancelled') then raise exception 'El domicilio ya salió'; end if;
  select * into o from orders where id = d.order_id;
  update deliveries set courier_id = p_courier where id = p_delivery;
  insert into delivery_events (business_id, delivery_id, from_status, to_status, note, member_id)
  values (d.business_id, p_delivery, d.status, d.status, 'Domiciliario: ' || (select full_name from members where id = p_courier), current_member_id(d.business_id));
  if d.status = 'ready_for_dispatch' then
    perform delivery_transition(p_delivery, 'courier_assigned');
  end if;
  perform notify(d.business_id, null, p_courier, 'delivery_assigned', 'Domicilio asignado · pedido #' || o.number,
                 d.address, jsonb_build_object('delivery_id', p_delivery, 'order_id', o.id));
end $$;

-- Acciones del domiciliario
create or replace function courier_update(p_delivery uuid, p_status delivery_status, p_note text default null,
  p_proof_url text default null, p_cash_received numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype; o orders%rowtype; v_me uuid; v_due numeric; v_session uuid; v_pay uuid;
begin
  select * into d from deliveries where id = p_delivery for update;
  v_me := current_member_id(d.business_id);
  if not (d.courier_id = v_me and has_perm(d.business_id, 'delivery.courier')) and not has_perm(d.business_id, 'delivery.manage') then
    raise exception 'Este domicilio no está asignado a usted' using errcode = '42501';
  end if;
  if not (
    (d.status in ('courier_assigned', 'ready_for_dispatch') and p_status = 'picked_up') or
    (d.status = 'picked_up' and p_status = 'on_the_way') or
    (d.status in ('picked_up', 'on_the_way') and p_status = 'delivered')
  ) then raise exception 'Transición no permitida: % → %', d.status, p_status; end if;

  if p_proof_url is not null then update deliveries set proof_url = p_proof_url where id = p_delivery; end if;
  if p_note is not null then
    update deliveries set incident_notes = concat_ws(E'\n', incident_notes, to_char(now() at time zone 'America/Bogota', 'HH24:MI') || ' ' || p_note)
    where id = p_delivery;
  end if;

  if p_status = 'delivered' then
    select * into o from orders where id = d.order_id for update;
    v_due := o.total + o.tip - o.paid_total;
    if v_due > 0 then
      if p_cash_received is null or p_cash_received < v_due then
        raise exception 'Confirme el valor recibido en efectivo (por cobrar: %)', v_due;
      end if;
      v_session := (select id from cash_sessions where business_id = d.business_id and closed_at is null order by opened_at desc limit 1);
      insert into payments (business_id, order_id, method_id, cash_session_id, amount, received_amount, change_amount, status, reference)
      values (d.business_id, o.id,
              coalesce(d.payment_method_id, (select id from payment_methods where business_id = d.business_id and is_cash limit 1)),
              v_session, v_due, p_cash_received, p_cash_received - v_due, 'approved', 'Cobro domiciliario')
      returning id into v_pay;
      perform allocate_payment(v_pay);
      update orders set paid_total = paid_total + v_due where id = o.id;
    end if;
    -- Entregar tickets que estuvieran listos
    update kds_tickets set status = 'delivered', delivered_at = now() where order_id = d.order_id and status = 'ready';
    update orders set status = 'delivered', closed_at = now() where id = d.order_id and status <> 'paid';
    if (select paid_total >= total + tip from orders where id = d.order_id) then perform finalize_order(d.order_id); end if;
  end if;
  perform delivery_transition(p_delivery, p_status, p_note);
end $$;

create or replace function courier_report_incident(p_delivery uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype;
begin
  select * into d from deliveries where id = p_delivery;
  if not (d.courier_id = current_member_id(d.business_id) or has_perm(d.business_id, 'delivery.manage')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update deliveries set incident_notes = concat_ws(E'\n', incident_notes, to_char(now() at time zone 'America/Bogota', 'HH24:MI') || ' ' || p_note)
  where id = p_delivery;
  insert into delivery_events (business_id, delivery_id, from_status, to_status, note, member_id)
  values (d.business_id, p_delivery, d.status, d.status, 'Novedad: ' || p_note, current_member_id(d.business_id));
  perform notify(d.business_id, 'delivery.manage', null, 'delivery_incident', 'Novedad en domicilio', p_note,
                 jsonb_build_object('delivery_id', p_delivery));
end $$;

create or replace function courier_set_consent(p_delivery uuid, p_consent boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype;
begin
  select * into d from deliveries where id = p_delivery;
  if d.courier_id is distinct from current_member_id(d.business_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update deliveries set location_consent = p_consent where id = p_delivery;
end $$;

create or replace function courier_push_location(p_delivery uuid, p_lat double precision, p_lng double precision, p_accuracy numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype;
begin
  select * into d from deliveries where id = p_delivery;
  if d.courier_id is distinct from current_member_id(d.business_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if not d.location_consent then raise exception 'Sin consentimiento de ubicación'; end if;
  if d.status not in ('picked_up', 'on_the_way') then return; end if;
  insert into courier_locations (business_id, delivery_id, courier_id, lat, lng, accuracy_m)
  values (d.business_id, p_delivery, d.courier_id, p_lat, p_lng, p_accuracy);
end $$;

-- ---------------------------------------------------------------------
-- Mesas y solicitudes
-- ---------------------------------------------------------------------
create or replace function service_request_attend(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r service_requests%rowtype;
begin
  select * into r from service_requests where id = p_request for update;
  perform require_perm(r.business_id, 'tables.manage');
  update service_requests set status = 'attended', attended_by = current_member_id(r.business_id), attended_at = now()
    where id = p_request and status = 'open';
  perform refresh_table_status(r.table_id);
end $$;

create or replace function notification_mark_read(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update notifications n set read_at = now(), read_by = auth.uid()
  where n.id = any(p_ids) and n.read_at is null and is_member(n.business_id)
    and (n.member_id = current_member_id(n.business_id) or (n.target_perm is not null and has_perm(n.business_id, n.target_perm)));
$$;

-- ---------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------
create or replace function cash_open(p_register uuid, p_amount numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare r cash_registers%rowtype; v_id uuid;
begin
  select * into r from cash_registers where id = p_register and active;
  if not found then raise exception 'Caja no encontrada'; end if;
  perform require_perm(r.business_id, 'cash.open');
  if p_amount < 0 then raise exception 'Saldo inicial inválido'; end if;
  if exists (select 1 from cash_sessions where register_id = p_register and closed_at is null) then
    raise exception 'La caja ya está abierta';
  end if;
  insert into cash_sessions (business_id, register_id, opened_by, opening_amount)
  values (r.business_id, p_register, current_member_id(r.business_id), p_amount) returning id into v_id;
  insert into cash_movements (business_id, session_id, method_id, kind, amount, description)
  values (r.business_id, v_id, (select id from payment_methods where business_id = r.business_id and is_cash limit 1),
          'opening', p_amount, 'Apertura de caja');
  return v_id;
end $$;

-- Ingresos, egresos y retiros manuales
create or replace function cash_add_movement(p_session uuid, p_kind cash_movement_kind, p_amount numeric,
  p_unit uuid, p_description text, p_method uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s cash_sessions%rowtype; v_id uuid;
begin
  select * into s from cash_sessions where id = p_session;
  perform require_perm(s.business_id, 'cash.move');
  if s.closed_at is not null then raise exception 'La caja está cerrada'; end if;
  if p_kind not in ('income', 'expense', 'withdrawal') then raise exception 'Tipo no permitido'; end if;
  if p_amount <= 0 then raise exception 'Valor inválido'; end if;
  if coalesce(length(trim(p_description)), 0) < 3 then raise exception 'Describa el movimiento'; end if;
  insert into cash_movements (business_id, session_id, business_unit_id, method_id, kind, amount, description)
  values (s.business_id, p_session, p_unit,
          coalesce(p_method, (select id from payment_methods where business_id = s.business_id and is_cash limit 1)),
          p_kind, case when p_kind = 'income' then p_amount else -p_amount end, p_description)
  returning id into v_id;
  return v_id;
end $$;

create or replace function cash_session_summary(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s cash_sessions%rowtype; v jsonb;
begin
  select * into s from cash_sessions where id = p_session;
  if not (has_perm(s.business_id, 'cash.view') or has_perm(s.business_id, 'cash.close')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'session', to_jsonb(s),
    'by_method', coalesce((select jsonb_agg(x) from (
        select pm.name as method, pm.is_cash, sum(cm.amount) as total
        from cash_movements cm join payment_methods pm on pm.id = cm.method_id
        where cm.session_id = p_session group by pm.name, pm.is_cash order by pm.name) x), '[]'),
    'by_unit', coalesce((select jsonb_agg(x) from (
        select coalesce(bu.name, case when cm.kind = 'opening' then 'Apertura' else 'Propinas / sin unidad' end) as unit, sum(cm.amount) as total
        from cash_movements cm left join business_units bu on bu.id = cm.business_unit_id
        where cm.session_id = p_session group by 1 order by 1) x), '[]'),
    'by_kind', coalesce((select jsonb_agg(x) from (
        select kind, sum(amount) as total, count(*) as n from cash_movements where session_id = p_session group by kind) x), '[]'),
    'expected_cash', (select coalesce(sum(cm.amount), 0) from cash_movements cm join payment_methods pm on pm.id = cm.method_id
                      where cm.session_id = p_session and pm.is_cash)
  ) into v;
  return v;
end $$;

-- Cierre con arqueo
create or replace function cash_close(p_session uuid, p_counted numeric, p_detail jsonb default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s cash_sessions%rowtype; v_expected numeric;
begin
  select * into s from cash_sessions where id = p_session for update;
  perform require_perm(s.business_id, 'cash.close');
  if s.closed_at is not null then raise exception 'La caja ya está cerrada'; end if;
  select coalesce(sum(cm.amount), 0) into v_expected
  from cash_movements cm join payment_methods pm on pm.id = cm.method_id
  where cm.session_id = p_session and pm.is_cash;
  update cash_sessions set closed_at = now(), closed_by = current_member_id(s.business_id),
    expected_cash = v_expected, counted_cash = p_counted, difference = p_counted - v_expected,
    counted_detail = p_detail, notes = p_notes
  where id = p_session;
  return jsonb_build_object('expected', v_expected, 'counted', p_counted, 'difference', p_counted - v_expected);
end $$;

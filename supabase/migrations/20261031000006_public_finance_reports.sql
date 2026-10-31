-- =====================================================================
-- RUPÍCOLA · 0006 · Menú QR, tienda en línea, seguimiento, compras,
-- gastos, reportes, alta de establecimiento, RLS operativa y Realtime
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones públicas (clientes sin cuenta). Solo exponen lo necesario.
-- ---------------------------------------------------------------------
create or replace function public_menu(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'logo_url', b.logo_url, 'phone', b.phone,
       'address', b.address, 'opening_hours', b.opening_hours, 'delivery_enabled', b.delivery_enabled,
       'pickup_enabled', b.pickup_enabled, 'tip_suggested_pct', b.tip_suggested_pct),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
         'unit', bu.kind) order by c.sort, c.name)
       from categories c join business_units bu on bu.id = c.business_unit_id
       where c.business_id = b.id and c.active and c.show_in_menu), '[]'),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
         'id', p.id, 'category_id', p.category_id, 'name', p.name, 'description', p.description,
         'ingredients_text', p.ingredients_text, 'price', p.price, 'image_url', p.image_url,
         'model_3d_url', p.model_3d_url, 'is_featured', p.is_featured, 'is_recommended', p.is_recommended,
         'is_available', p.is_available and (p.stock_mode <> 'variant' or exists (
            select 1 from product_variants v where v.product_id = p.id and v.active and v.stock > 0)),
         'stock_mode', p.stock_mode,
         'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.size, 'color', v.color,
              'design', v.design, 'price', coalesce(v.price, p.price), 'available', v.stock > 0,
              'image_url', v.image_url, 'model_3d_url', v.model_3d_url) order by v.size, v.color)
            from product_variants v where v.product_id = p.id and v.active), '[]'),
         'modifier_groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
              'min', g.min_select, 'max', g.max_select,
              'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_delta', o.price_delta) order by o.sort), '[]')
                          from modifier_options o where o.group_id = g.id)) order by g.sort)
            from modifier_groups g where g.product_id = p.id), '[]')
       ) order by p.sort, p.name)
       from products p join categories c on c.id = p.category_id
       where p.business_id = b.id and p.active and c.active and c.show_in_menu), '[]'),
    'payment_methods', coalesce((select jsonb_agg(jsonb_build_object('id', pm.id, 'code', pm.code, 'name', pm.name,
         'is_cash', pm.is_cash, 'gateway', pm.gateway) order by pm.sort)
       from payment_methods pm where pm.business_id = b.id and pm.active and pm.available_online), '[]'),
    'zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'fee', z.fee,
         'min_order', z.min_order, 'eta_minutes', z.eta_minutes, 'polygon', z.polygon,
         'center_lat', z.center_lat, 'center_lng', z.center_lng, 'radius_km', z.radius_km))
       from delivery_zones z where z.business_id = b.id and z.active), '[]')
  )
  from businesses b where b.slug = p_slug;
$$;

create or replace function public_table(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('table_id', t.id, 'number', t.number, 'name', t.name, 'slug', b.slug)
  from dining_tables t join businesses b on b.id = t.business_id
  where t.qr_token = p_token and t.active;
$$;

-- Pedido desde el QR de la mesa: llega directo al KDS
create or replace function qr_place_order(p_token text, p_items jsonb, p_customer_name text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t dining_tables%rowtype; v_order uuid; v_new boolean := false;
begin
  select * into t from dining_tables where qr_token = p_token and active;
  if not found then raise exception 'Código QR no válido'; end if;
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

create or replace function qr_service_request(p_token text, p_kind text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t dining_tables%rowtype; v_order uuid;
begin
  select * into t from dining_tables where qr_token = p_token and active;
  if not found then raise exception 'Código QR no válido'; end if;
  -- Evita duplicados mientras haya una solicitud igual abierta
  if exists (select 1 from service_requests where table_id = t.id and kind = p_kind and status = 'open') then return; end if;
  select id into v_order from orders where table_id = t.id and status not in ('paid', 'cancelled') order by created_at limit 1;
  insert into service_requests (business_id, table_id, order_id, kind, note)
  values (t.business_id, t.id, v_order, p_kind, left(p_note, 200));
  perform notify(t.business_id, 'tables.manage', null, 'service_request',
    'Mesa ' || t.number || ': ' || case p_kind when 'call_waiter' then 'llamando al mesero' when 'supplies' then 'solicita elementos'
      when 'assistance' then 'solicita asistencia' when 'bill' then 'pide la cuenta' end,
    p_note, jsonb_build_object('table_id', t.id));
  perform refresh_table_status(t.id);
end $$;

create or replace function qr_table_status(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'table', t.number,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('number', o.number, 'status', o.status, 'total', o.total,
        'items', (select jsonb_agg(jsonb_build_object('name', oi.name, 'qty', oi.qty, 'line_total', oi.line_total,
                    'status', coalesce(k.status::text, 'n/a')) order by oi.created_at)
                  from order_items oi left join kds_tickets k on k.id = oi.ticket_id
                  where oi.order_id = o.id and oi.status = 'active')) order by o.created_at)
      from orders o where o.table_id = t.id and o.status not in ('paid', 'cancelled')), '[]'),
    'open_requests', coalesce((select jsonb_agg(kind) from service_requests where table_id = t.id and status = 'open'), '[]')
  )
  from dining_tables t where t.qr_token = p_token;
$$;

-- Punto dentro de polígono (ray casting) para zonas de cobertura
create or replace function point_in_zone(z delivery_zones, lat double precision, lng double precision) returns boolean
language plpgsql immutable as $$
declare
  pts jsonb := z.polygon; n int; i int; j int; inside boolean := false;
  xi double precision; yi double precision; xj double precision; yj double precision;
begin
  if lat is null or lng is null then return false; end if;
  if z.radius_km is not null and z.center_lat is not null then
    return 6371 * 2 * asin(sqrt(power(sin(radians(lat - z.center_lat) / 2), 2) +
           cos(radians(z.center_lat)) * cos(radians(lat)) * power(sin(radians(lng - z.center_lng) / 2), 2))) <= z.radius_km;
  end if;
  if pts is null or jsonb_array_length(pts) < 3 then return false; end if;
  n := jsonb_array_length(pts); j := n - 1;
  for i in 0..n-1 loop
    xi := (pts->i->>0)::float8; yi := (pts->i->>1)::float8;
    xj := (pts->j->>0)::float8; yj := (pts->j->>1)::float8;
    if ((yi > lat) <> (yj > lat)) and (lng < (xj - xi) * (lat - yi) / nullif(yj - yi, 0) + xi) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end $$;

-- Pedido desde casa (domicilio o recoger en el local)
-- p: {customer:{full_name, phone, email?}, fulfillment:'delivery'|'pickup',
--     address:{address, details?, neighborhood?, lat?, lng?, label?, save?:bool},
--     zone_id?, payment_method_id, cash_change_for?, notes?, items:[...]}
create or replace function shop_place_order(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b businesses%rowtype; v_customer uuid; v_addr uuid; v_order uuid; z delivery_zones%rowtype;
  pm payment_methods%rowtype; v_fulfillment text := coalesce(p->>'fulfillment', 'delivery');
  v_phone text := regexp_replace(coalesce(p->'customer'->>'phone', ''), '[^0-9+]', '', 'g');
  v_name text := left(trim(coalesce(p->'customer'->>'full_name', '')), 80);
  v_lat double precision := nullif(p->'address'->>'lat', '')::float8;
  v_lng double precision := nullif(p->'address'->>'lng', '')::float8;
  o orders%rowtype;
begin
  select * into b from businesses where slug = p_slug;
  if not found then raise exception 'Establecimiento no encontrado'; end if;
  if length(v_name) < 2 then raise exception 'Ingrese su nombre'; end if;
  if length(v_phone) < 7 then raise exception 'Ingrese un teléfono válido'; end if;
  if v_fulfillment not in ('delivery', 'pickup') then raise exception 'Tipo de entrega inválido'; end if;
  if v_fulfillment = 'delivery' and not b.delivery_enabled then raise exception 'Los domicilios no están disponibles'; end if;
  if v_fulfillment = 'pickup' and not b.pickup_enabled then raise exception 'La recogida en el local no está disponible'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 or jsonb_array_length(p->'items') > 40 then
    raise exception 'Revise los productos del carrito';
  end if;

  select * into pm from payment_methods where id = (p->>'payment_method_id')::uuid and business_id = b.id and active and available_online;
  if not found then raise exception 'Seleccione un método de pago'; end if;

  -- Cliente (por teléfono)
  insert into customers (business_id, full_name, phone, email)
  values (b.id, v_name, v_phone, nullif(trim(p->'customer'->>'email'), ''))
  on conflict (business_id, phone) do update set full_name = excluded.full_name,
    email = coalesce(excluded.email, customers.email)
  returning id into v_customer;

  insert into orders (business_id, number, channel, customer_id, customer_name, customer_phone, notes)
  values (b.id, next_order_number(b.id), v_fulfillment::order_channel, v_customer, v_name, v_phone, left(p->>'notes', 300))
  returning id into v_order;
  perform log_status(b.id, v_order, 'order', v_order, null, 'open', 'Pedido en línea');
  perform add_order_lines(v_order, p->'items');

  if v_fulfillment = 'delivery' then
    if coalesce(trim(p->'address'->>'address'), '') = '' then raise exception 'Ingrese la dirección de entrega'; end if;
    -- Zona: la que contenga el punto del mapa, o la seleccionada
    select * into z from delivery_zones dz where dz.business_id = b.id and dz.active and point_in_zone(dz, v_lat, v_lng)
      order by dz.fee limit 1;
    if z.id is null and p ? 'zone_id' then
      select * into z from delivery_zones where id = (p->>'zone_id')::uuid and business_id = b.id and active;
    end if;
    if z.id is null and exists (select 1 from delivery_zones where business_id = b.id and active) then
      raise exception 'La dirección está fuera de nuestra zona de cobertura';
    end if;
    select * into o from orders where id = v_order;
    if z.id is not null and o.total < z.min_order then
      raise exception 'El pedido mínimo para % es %', z.name, z.min_order;
    end if;
    if coalesce((p->'address'->>'save')::boolean, true) then
      insert into customer_addresses (business_id, customer_id, label, address, details, neighborhood, lat, lng)
      values (b.id, v_customer, left(p->'address'->>'label', 40), left(p->'address'->>'address', 200),
              left(p->'address'->>'details', 300), left(p->'address'->>'neighborhood', 80), v_lat, v_lng)
      returning id into v_addr;
    end if;
    update orders set delivery_fee = coalesce(z.fee, 0) where id = v_order;
    perform recalc_order(v_order);
  end if;
  select * into o from orders where id = v_order;

  insert into deliveries (business_id, order_id, customer_id, address_id, address, details, lat, lng, zone_id, fee,
                          payment_method_id, cash_to_collect, cash_change_for)
  values (b.id, v_order, v_customer, v_addr,
          case when v_fulfillment = 'delivery' then left(p->'address'->>'address', 200) else 'Recoge en el establecimiento' end,
          left(p->'address'->>'details', 300), v_lat, v_lng, z.id, o.delivery_fee, pm.id,
          case when pm.gateway is null then o.total else 0 end, nullif(p->>'cash_change_for', '')::numeric);
  insert into delivery_events (business_id, delivery_id, to_status, note)
  select b.id, id, 'received', 'Pedido recibido en línea' from deliveries where order_id = v_order;

  perform notify(b.id, 'delivery.manage', null, 'delivery_new',
    'Nuevo pedido en línea #' || o.number, v_name || ' · ' || case when v_fulfillment = 'pickup' then 'Recoge' else 'Domicilio' end,
    jsonb_build_object('order_id', v_order));

  return jsonb_build_object('order_id', v_order, 'number', o.number, 'tracking_token', o.tracking_token,
                            'total', o.total, 'requires_gateway', pm.gateway is not null, 'gateway', pm.gateway);
end $$;

-- Seguimiento público por token
create or replace function public_track(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', o.number, 'channel', o.channel, 'status', o.status, 'created_at', o.created_at,
    'customer_name', o.customer_name, 'subtotal', o.subtotal, 'discount_total', o.discount_total,
    'delivery_fee', o.delivery_fee, 'total', o.total, 'paid_total', o.paid_total,
    'business', (select jsonb_build_object('name', name, 'phone', phone, 'logo_url', logo_url) from businesses where id = o.business_id),
    'items', (select jsonb_agg(jsonb_build_object('name', name, 'variant', variant_label, 'qty', qty, 'line_total', line_total, 'modifiers', modifiers))
              from order_items where order_id = o.id and status = 'active'),
    'delivery', (select jsonb_build_object('status', d.status, 'address', d.address, 'fee', d.fee,
                   'courier', (select split_part(full_name, ' ', 1) from members where id = d.courier_id),
                   'assigned_at', d.assigned_at, 'picked_up_at', d.picked_up_at, 'delivered_at', d.delivered_at,
                   'events', (select jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at) order by e.created_at)
                              from delivery_events e where e.delivery_id = d.id and e.from_status is distinct from e.to_status),
                   'location', case when d.location_consent and d.status in ('picked_up', 'on_the_way') then
                       (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'at', l.recorded_at) from courier_locations l
                        where l.delivery_id = d.id order by l.recorded_at desc limit 1) end)
                 from deliveries d where d.order_id = o.id)
  ) from orders o where o.tracking_token = p_token;
$$;

-- Confirmación de pasarela (la invoca SOLO el servidor con service_role,
-- tras verificar la firma del evento de la pasarela)
create or replace function gateway_confirm_payment(p_tracking text, p_amount numeric, p_reference text,
  p_gateway text, p_status payment_status, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_method uuid; v_pay uuid;
begin
  select * into o from orders where tracking_token = p_tracking for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if exists (select 1 from payments where reference = p_reference and gateway = p_gateway) then return; end if;  -- idempotente
  select id into v_method from payment_methods where business_id = o.business_id and gateway = p_gateway and active limit 1;
  if v_method is null then raise exception 'Método de pasarela no configurado'; end if;
  insert into payments (business_id, order_id, method_id, amount, status, reference, gateway, gateway_payload)
  values (o.business_id, o.id, v_method, p_amount, p_status, p_reference, p_gateway, p_payload)
  returning id into v_pay;
  if p_status = 'approved' then
    perform allocate_payment(v_pay);
    update orders set paid_total = (select coalesce(sum(amount), 0) from payments where order_id = o.id and status = 'approved')
      where id = o.id;
    perform notify(o.business_id, 'delivery.manage', null, 'payment_approved', 'Pago en línea aprobado · #' || o.number,
                   p_reference, jsonb_build_object('order_id', o.id));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Compras y proveedores
-- ---------------------------------------------------------------------
-- p_items: [{ingredient_id? | variant_id?, qty, unit_cost, expires_on?, description?}]
create or replace function purchase_create(p_business uuid, p_unit uuid, p_supplier uuid, p_items jsonb,
  p_invoice text default null, p_invoice_date date default null, p_due date default null,
  p_notes text default null, p_receive_now boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; it jsonb;
begin
  perform require_perm(p_business, 'purchases.manage');
  if not exists (select 1 from suppliers where id = p_supplier and business_id = p_business) then raise exception 'Proveedor no válido'; end if;
  if not exists (select 1 from business_units where id = p_unit and business_id = p_business) then raise exception 'Unidad no válida'; end if;
  insert into purchases (business_id, business_unit_id, supplier_id, status, invoice_number, invoice_date, due_date, notes)
  values (p_business, p_unit, p_supplier, 'ordered', p_invoice, p_invoice_date,
          coalesce(p_due, current_date + (select payment_terms_days from suppliers where id = p_supplier)), p_notes)
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into purchase_items (business_id, purchase_id, ingredient_id, variant_id, description, qty_ordered, unit_cost, expires_on)
    values (p_business, v_id, nullif(it->>'ingredient_id', '')::uuid, nullif(it->>'variant_id', '')::uuid, it->>'description',
            (it->>'qty')::numeric, (it->>'unit_cost')::numeric, nullif(it->>'expires_on', '')::date);
  end loop;
  update purchases set total = (select sum(round(qty_ordered * unit_cost, 2)) from purchase_items where purchase_id = v_id) where id = v_id;
  if p_receive_now then
    perform purchase_receive(v_id, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', qty_ordered)) from purchase_items where purchase_id = v_id));
  end if;
  return v_id;
end $$;

-- Recepción (total o parcial) → entra al inventario de la unidad
create or replace function purchase_receive(p_purchase uuid, p_receipts jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare pu purchases%rowtype; r jsonb; pi purchase_items%rowtype; v_qty numeric;
begin
  select * into pu from purchases where id = p_purchase for update;
  perform require_perm(pu.business_id, 'purchases.manage');
  if pu.status in ('received', 'cancelled') then raise exception 'La compra ya está cerrada'; end if;
  for r in select * from jsonb_array_elements(p_receipts) loop
    select * into pi from purchase_items where id = (r->>'item_id')::uuid and purchase_id = p_purchase for update;
    v_qty := (r->>'qty')::numeric;
    if v_qty <= 0 then continue; end if;
    if pi.qty_received + v_qty > pi.qty_ordered then raise exception 'Cantidad recibida mayor a la ordenada'; end if;
    update purchase_items set qty_received = qty_received + v_qty where id = pi.id;
    insert into inventory_movements (business_id, business_unit_id, ingredient_id, variant_id, kind, qty, unit_cost, purchase_id, expires_on, reason)
    values (pu.business_id, pu.business_unit_id, pi.ingredient_id, pi.variant_id, 'purchase', v_qty, pi.unit_cost, p_purchase,
            pi.expires_on, 'Compra ' || coalesce(pu.invoice_number, ''));
  end loop;
  update purchases set status = case
    when not exists (select 1 from purchase_items where purchase_id = p_purchase and qty_received < qty_ordered) then 'received'
    else 'partially_received' end
  where id = p_purchase;
end $$;

create or replace function purchase_pay(p_purchase uuid, p_amount numeric, p_method uuid, p_reference text default null,
  p_session uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare pu purchases%rowtype;
begin
  select * into pu from purchases where id = p_purchase for update;
  perform require_perm(pu.business_id, 'purchases.manage');
  if p_amount <= 0 or pu.paid_total + p_amount > pu.total then raise exception 'Valor inválido: saldo %', pu.total - pu.paid_total; end if;
  insert into purchase_payments (business_id, purchase_id, amount, method_id, reference)
  values (pu.business_id, p_purchase, p_amount, p_method, p_reference);
  update purchases set paid_total = paid_total + p_amount where id = p_purchase;
  if p_session is not null then
    perform require_perm(pu.business_id, 'cash.move');
    insert into cash_movements (business_id, session_id, business_unit_id, method_id, kind, amount, description)
    values (pu.business_id, p_session, pu.business_unit_id, p_method, 'expense', -p_amount,
            'Pago a proveedor · factura ' || coalesce(pu.invoice_number, '-'));
  end if;
end $$;

create or replace function purchase_cancel(p_purchase uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pu purchases%rowtype;
begin
  select * into pu from purchases where id = p_purchase for update;
  perform require_perm(pu.business_id, 'purchases.manage');
  if exists (select 1 from purchase_items where purchase_id = p_purchase and qty_received > 0) then
    raise exception 'La compra tiene recepciones; registre una devolución';
  end if;
  update purchases set status = 'cancelled', cancel_reason = p_reason where id = p_purchase;
end $$;

-- ---------------------------------------------------------------------
-- Gastos con reparto por unidad
-- ---------------------------------------------------------------------
create or replace function expense_create(p_business uuid, p_category uuid, p_scope expense_scope, p_description text,
  p_amount numeric, p_date date default current_date, p_gastro_pct numeric default null,
  p_session uuid default null, p_supplier uuid default null, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_g uuid := unit_id(p_business, 'gastronomy'); v_s uuid := unit_id(p_business, 'shop'); v_pct numeric; v_ga numeric;
begin
  perform require_perm(p_business, 'expenses.manage');
  if p_amount <= 0 then raise exception 'Valor inválido'; end if;
  insert into expenses (business_id, category_id, scope, description, amount, expense_date, gastronomy_pct,
                        paid_from_cash, cash_session_id, supplier_id, reference)
  values (p_business, p_category, p_scope, p_description, p_amount, p_date, p_gastro_pct,
          p_session is not null, p_session, p_supplier, p_reference)
  returning id into v_id;

  if p_scope = 'gastronomy' then
    insert into expense_allocations (business_id, expense_id, business_unit_id, amount) values (p_business, v_id, v_g, p_amount);
  elsif p_scope = 'shop' then
    insert into expense_allocations (business_id, expense_id, business_unit_id, amount) values (p_business, v_id, v_s, p_amount);
  else
    v_pct := coalesce(p_gastro_pct, (select shared_expense_pct from business_units where id = v_g));
    v_ga := round(p_amount * v_pct / 100, 2);
    insert into expense_allocations (business_id, expense_id, business_unit_id, amount)
    values (p_business, v_id, v_g, v_ga), (p_business, v_id, v_s, p_amount - v_ga);
  end if;

  if p_session is not null then
    perform require_perm(p_business, 'cash.move');
    if not exists (select 1 from cash_sessions where id = p_session and closed_at is null and business_id = p_business) then
      raise exception 'La caja no está abierta';
    end if;
    insert into cash_movements (business_id, session_id, business_unit_id, method_id, kind, amount, expense_id, description)
    select p_business, p_session, ea.business_unit_id,
           (select id from payment_methods where business_id = p_business and is_cash limit 1),
           'expense', -ea.amount, v_id, p_description
    from expense_allocations ea where ea.expense_id = v_id;
  end if;
  return v_id;
end $$;

create or replace function expense_void(p_expense uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e expenses%rowtype;
begin
  select * into e from expenses where id = p_expense for update;
  perform require_perm(e.business_id, 'expenses.manage');
  if e.status = 'voided' then return; end if;
  update expenses set status = 'voided', void_reason = p_reason where id = p_expense;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, old_data, reason)
  values (e.business_id, auth.uid(), current_member_id(e.business_id), 'expenses', p_expense::text, 'void', to_jsonb(e), p_reason);
end $$;

-- ---------------------------------------------------------------------
-- Dashboard y reportes (indicadores administrativos, no contables)
-- ---------------------------------------------------------------------
create or replace function dashboard_summary(p_business uuid, p_from date, p_to date, p_unit uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz text := (select timezone from businesses where id = p_business);
  f timestamptz := (p_from::timestamp at time zone tz);
  t timestamptz := ((p_to + 1)::timestamp at time zone tz);
  today_f timestamptz := (date_trunc('day', now() at time zone tz) at time zone tz);
  month_f timestamptz := (date_trunc('month', now() at time zone tz) at time zone tz);
  v jsonb;
begin
  perform require_perm(p_business, 'dashboard.view');
  with rev as (
    select r.*, bu.kind from revenue_entries r left join business_units bu on bu.id = r.business_unit_id
    where r.business_id = p_business and r.concept <> 'tip' and (p_unit is null or r.business_unit_id = p_unit)
  ), exp as (
    select ea.amount, ea.business_unit_id, e.expense_date from expense_allocations ea join expenses e on e.id = ea.expense_id
    where e.business_id = p_business and e.status = 'active' and (p_unit is null or ea.business_unit_id = p_unit)
  )
  select jsonb_build_object(
    'sales_today', (select coalesce(sum(amount), 0) from rev where created_at >= today_f),
    'sales_month', (select coalesce(sum(amount), 0) from rev where created_at >= month_f),
    'sales_range', (select coalesce(sum(amount), 0) from rev where created_at >= f and created_at < t),
    'cost_range', (select coalesce(sum(cost), 0) from rev where created_at >= f and created_at < t),
    'gastronomy_range', (select coalesce(sum(amount), 0) from rev where kind = 'gastronomy' and created_at >= f and created_at < t),
    'shop_range', (select coalesce(sum(amount), 0) from rev where kind = 'shop' and created_at >= f and created_at < t),
    'expenses_today', (select coalesce(sum(amount), 0) from exp where expense_date = (now() at time zone tz)::date),
    'expenses_range', (select coalesce(sum(amount), 0) from exp where expense_date between p_from and p_to),
    'tips_range', (select coalesce(sum(amount), 0) from revenue_entries where business_id = p_business and concept = 'tip' and created_at >= f and created_at < t),
    'active_orders', (select count(*) from orders where business_id = p_business and status in ('open', 'confirmed', 'in_progress', 'ready', 'delivered') and not finalized),
    'kitchen_pending', (select count(*) from kds_tickets where business_id = p_business and status in ('received', 'accepted', 'preparing')),
    'deliveries_active', (select count(*) from deliveries where business_id = p_business and status not in ('delivered', 'cancelled')),
    'tables_occupied', (select count(*) from dining_tables where business_id = p_business and active and status <> 'available'),
    'tables_total', (select count(*) from dining_tables where business_id = p_business and active),
    'low_stock', (select count(*) from low_stock where business_id = p_business),
    'cash_open', (select coalesce(jsonb_agg(jsonb_build_object('register', cr.name, 'opened_at', cs.opened_at,
                     'expected_cash', (select coalesce(sum(cm.amount), 0) from cash_movements cm join payment_methods pm on pm.id = cm.method_id
                                       where cm.session_id = cs.id and pm.is_cash))), '[]')
                  from cash_sessions cs join cash_registers cr on cr.id = cs.register_id
                  where cs.business_id = p_business and cs.closed_at is null),
    'daily', (select coalesce(jsonb_agg(x order by x.day), '[]') from (
        select (created_at at time zone tz)::date as day,
               sum(amount) filter (where kind = 'gastronomy') as gastronomy,
               sum(amount) filter (where kind = 'shop') as shop,
               sum(amount) as total
        from rev where created_at >= f and created_at < t group by 1) x),
    'expenses_daily', (select coalesce(jsonb_agg(x order by x.day), '[]') from (
        select expense_date as day, sum(amount) as total from exp where expense_date between p_from and p_to group by 1) x),
    'top_products', (select coalesce(jsonb_agg(x), '[]') from (
        select oi.name, sum(oi.qty) as qty, sum(oi.line_total) as total
        from order_items oi join orders o on o.id = oi.order_id
        where o.business_id = p_business and o.finalized and oi.status = 'active' and o.paid_at >= f and o.paid_at < t
          and (p_unit is null or oi.business_unit_id = p_unit)
        group by oi.name order by sum(oi.qty) desc limit 8) x),
    'by_category', (select coalesce(jsonb_agg(x), '[]') from (
        select c.name, sum(oi.line_total) as revenue, round(sum(oi.qty * oi.unit_cost), 2) as cost,
               sum(oi.line_total) - round(sum(oi.qty * oi.unit_cost), 2) as margin
        from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id join categories c on c.id = p.category_id
        where o.business_id = p_business and o.finalized and oi.status = 'active' and o.paid_at >= f and o.paid_at < t
          and (p_unit is null or oi.business_unit_id = p_unit)
        group by c.name order by 2 desc) x),
    'by_method', (select coalesce(jsonb_agg(x), '[]') from (
        select pm.name, sum(pa.amount) as total
        from payment_allocations pa join payments py on py.id = pa.payment_id join payment_methods pm on pm.id = py.method_id
        where pa.business_id = p_business and pa.created_at >= f and pa.created_at < t and (p_unit is null or pa.business_unit_id = p_unit)
        group by pm.name order by 2 desc) x),
    'by_employee', (select coalesce(jsonb_agg(x), '[]') from (
        select m.full_name as name, count(distinct o.id) as orders, sum(o.total) as total
        from orders o join members m on m.id = o.waiter_id
        where o.business_id = p_business and o.finalized and o.paid_at >= f and o.paid_at < t
        group by m.full_name order by 3 desc limit 10) x)
  ) into v;
  return v;
end $$;

-- Resultado operativo estimado por unidad:
-- ingresos − costo de productos − gastos asignados
create or replace function unit_results(p_business uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from businesses where id = p_business);
begin
  perform require_perm(p_business, 'reports.finance');
  return (select jsonb_agg(x) from (
    select bu.id, bu.name, bu.kind,
      coalesce(r.revenue, 0) as revenue, coalesce(r.cost, 0) as product_cost, coalesce(e.expenses, 0) as expenses,
      coalesce(r.revenue, 0) - coalesce(r.cost, 0) - coalesce(e.expenses, 0) as operating_result
    from business_units bu
    left join (select business_unit_id, sum(amount) as revenue, sum(cost) as cost from revenue_entries
               where business_id = p_business and concept <> 'tip'
                 and created_at >= (p_from::timestamp at time zone tz) and created_at < ((p_to + 1)::timestamp at time zone tz)
               group by business_unit_id) r on r.business_unit_id = bu.id
    left join (select ea.business_unit_id, sum(ea.amount) as expenses from expense_allocations ea join expenses ex on ex.id = ea.expense_id
               where ex.business_id = p_business and ex.status = 'active' and ex.expense_date between p_from and p_to
               group by ea.business_unit_id) e on e.business_unit_id = bu.id
    where bu.business_id = p_business order by bu.kind) x);
end $$;

-- Reportes tabulares (para tablas, Excel y PDF)
create or replace function report_rows(p_business uuid, p_kind text, p_from date, p_to date, p_unit uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz text := (select timezone from businesses where id = p_business);
  f timestamptz := (p_from::timestamp at time zone tz);
  t timestamptz := ((p_to + 1)::timestamp at time zone tz);
  v jsonb;
begin
  perform require_perm(p_business, 'reports.view');
  if p_kind in ('costs', 'expenses', 'results', 'purchases', 'suppliers') then perform require_perm(p_business, 'reports.finance'); end if;

  case p_kind
  when 'sales_by_date' then
    select jsonb_agg(x order by x.fecha) into v from (
      select (r.created_at at time zone tz)::date as fecha, bu.name as unidad, sum(r.amount) as ingresos, sum(r.cost) as costo
      from revenue_entries r join business_units bu on bu.id = r.business_unit_id
      where r.business_id = p_business and r.created_at >= f and r.created_at < t and r.concept <> 'tip'
        and (p_unit is null or r.business_unit_id = p_unit)
      group by 1, 2) x;
  when 'sales_by_product' then
    select jsonb_agg(x) into v from (
      select oi.name as producto, coalesce(oi.variant_label, '') as variante, bu.name as unidad, sum(oi.qty) as cantidad,
             sum(oi.line_total) as ingresos, round(sum(oi.qty * oi.unit_cost), 2) as costo
      from order_items oi join orders o on o.id = oi.order_id join business_units bu on bu.id = oi.business_unit_id
      where o.business_id = p_business and o.finalized and oi.status = 'active' and o.paid_at >= f and o.paid_at < t
        and (p_unit is null or oi.business_unit_id = p_unit)
      group by 1, 2, 3 order by 5 desc) x;
  when 'sales_by_category' then
    select jsonb_agg(x) into v from (
      select c.name as categoria, bu.name as unidad, sum(oi.qty) as cantidad, sum(oi.line_total) as ingresos,
             round(sum(oi.qty * oi.unit_cost), 2) as costo
      from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
      join categories c on c.id = p.category_id join business_units bu on bu.id = oi.business_unit_id
      where o.business_id = p_business and o.finalized and oi.status = 'active' and o.paid_at >= f and o.paid_at < t
        and (p_unit is null or oi.business_unit_id = p_unit)
      group by 1, 2 order by 4 desc) x;
  when 'sales_by_employee' then
    select jsonb_agg(x) into v from (
      select coalesce(m.full_name, 'En línea / QR') as empleado, count(distinct o.id) as pedidos, sum(o.total) as ventas, sum(o.tip) as propinas
      from orders o left join members m on m.id = o.waiter_id
      where o.business_id = p_business and o.finalized and o.paid_at >= f and o.paid_at < t
      group by 1 order by 3 desc) x;
  when 'sales_by_channel' then
    select jsonb_agg(x) into v from (
      select o.channel as canal, count(*) as pedidos, sum(o.total) as ventas, round(avg(o.total), 0) as ticket_promedio
      from orders o where o.business_id = p_business and o.finalized and o.paid_at >= f and o.paid_at < t
      group by 1 order by 3 desc) x;
  when 'payment_methods' then
    select jsonb_agg(x) into v from (
      select pm.name as metodo, coalesce(bu.name, 'Propinas') as unidad, sum(pa.amount) as total, count(distinct pa.payment_id) as pagos
      from payment_allocations pa join payments py on py.id = pa.payment_id join payment_methods pm on pm.id = py.method_id
      left join business_units bu on bu.id = pa.business_unit_id
      where pa.business_id = p_business and pa.created_at >= f and pa.created_at < t and (p_unit is null or pa.business_unit_id = p_unit)
      group by 1, 2 order by 1, 2) x;
  when 'expenses' then
    select jsonb_agg(x) into v from (
      select e.expense_date as fecha, ec.name as categoria, e.description as descripcion, e.scope as alcance,
             bu.name as unidad, ea.amount as valor_asignado
      from expenses e join expense_categories ec on ec.id = e.category_id
      join expense_allocations ea on ea.expense_id = e.id join business_units bu on bu.id = ea.business_unit_id
      where e.business_id = p_business and e.status = 'active' and e.expense_date between p_from and p_to
        and (p_unit is null or ea.business_unit_id = p_unit)
      order by 1) x;
  when 'results' then
    v := unit_results(p_business, p_from, p_to);
  when 'inventory' then
    select jsonb_agg(x) into v from (
      select bu.name as unidad, 'Ingrediente' as tipo, i.name as articulo, '' as variante, i.stock as existencia, i.min_stock as minimo,
             i.unit as unidad_medida, i.cost_per_unit as costo_unitario, round(i.stock * i.cost_per_unit, 2) as valor
      from ingredients i join business_units bu on bu.id = i.business_unit_id
      where i.business_id = p_business and i.active and (p_unit is null or i.business_unit_id = p_unit)
      union all
      select bu.name, 'Variante', p.name, concat_ws(' / ', v2.size, v2.color, v2.design), v2.stock, v2.min_stock, 'und', v2.cost, round(v2.stock * v2.cost, 2)
      from product_variants v2 join products p on p.id = v2.product_id join business_units bu on bu.id = p.business_unit_id
      where v2.business_id = p_business and v2.active and (p_unit is null or p.business_unit_id = p_unit)
      order by 1, 3) x;
  when 'inventory_movements' then
    select jsonb_agg(x) into v from (
      select m.created_at at time zone tz as fecha, bu.name as unidad, coalesce(i.name, p.name) as articulo,
             concat_ws(' / ', pv.size, pv.color, pv.design) as variante, m.kind as tipo, m.qty as cantidad, m.reason as motivo
      from inventory_movements m join business_units bu on bu.id = m.business_unit_id
      left join ingredients i on i.id = m.ingredient_id
      left join product_variants pv on pv.id = m.variant_id left join products p on p.id = pv.product_id
      where m.business_id = p_business and m.created_at >= f and m.created_at < t and (p_unit is null or m.business_unit_id = p_unit)
      order by m.created_at desc limit 5000) x;
  when 'purchases' then
    select jsonb_agg(x) into v from (
      select pu.created_at::date as fecha, s.name as proveedor, bu.name as unidad, pu.invoice_number as factura,
             pu.status as estado, pu.total, pu.paid_total as pagado, pu.total - pu.paid_total as saldo, pu.due_date as vence
      from purchases pu join suppliers s on s.id = pu.supplier_id join business_units bu on bu.id = pu.business_unit_id
      where pu.business_id = p_business and pu.created_at >= f and pu.created_at < t and (p_unit is null or pu.business_unit_id = p_unit)
      order by 1 desc) x;
  when 'suppliers' then
    select jsonb_agg(x) into v from (
      select s.name as proveedor, count(pu.id) as compras, coalesce(sum(pu.total), 0) as total,
             coalesce(sum(pu.total - pu.paid_total) filter (where pu.status <> 'cancelled'), 0) as por_pagar
      from suppliers s left join purchases pu on pu.supplier_id = s.id and pu.status <> 'cancelled'
      where s.business_id = p_business group by s.name order by 3 desc) x;
  when 'couriers' then
    select jsonb_agg(x) into v from (
      select m.full_name as domiciliario, count(*) as entregas,
             round(avg(extract(epoch from (d.delivered_at - d.picked_up_at)) / 60)::numeric, 1) as min_promedio_entrega,
             sum(d.fee) as valor_domicilios
      from deliveries d join members m on m.id = d.courier_id
      where d.business_id = p_business and d.status = 'delivered' and d.delivered_at >= f and d.delivered_at < t
      group by 1 order by 2 desc) x;
  when 'prep_times' then
    select jsonb_agg(x) into v from (
      select st.name as estacion, count(*) as tickets,
             round(avg(extract(epoch from (k.ready_at - k.received_at)) / 60)::numeric, 1) as min_promedio_preparacion,
             round(max(extract(epoch from (k.ready_at - k.received_at)) / 60)::numeric, 1) as min_maximo
      from kds_tickets k join stations st on st.id = k.station_id
      where k.business_id = p_business and k.ready_at is not null and k.received_at >= f and k.received_at < t
      group by 1) x;
  when 'delivery_times' then
    select jsonb_agg(x) into v from (
      select o.channel as canal, count(*) as pedidos,
             round(avg(extract(epoch from (d.delivered_at - o.created_at)) / 60)::numeric, 1) as min_promedio_total
      from deliveries d join orders o on o.id = d.order_id
      where d.business_id = p_business and d.status = 'delivered' and d.delivered_at >= f and d.delivered_at < t
      group by 1) x;
  when 'cancelled' then
    select jsonb_agg(x) into v from (
      select o.created_at at time zone tz as fecha, o.number as pedido, o.channel as canal, o.cancel_reason as motivo,
             (select sum(qty * unit_price) from order_items where order_id = o.id) as valor
      from orders o where o.business_id = p_business and o.status = 'cancelled' and o.merged_into_id is null
        and o.created_at >= f and o.created_at < t order by 1 desc) x;
  else
    raise exception 'Reporte desconocido: %', p_kind;
  end case;
  return coalesce(v, '[]');
end $$;

-- ---------------------------------------------------------------------
-- Alta de establecimiento (crea unidades, estaciones, roles, métodos)
-- ---------------------------------------------------------------------
insert into permissions (code, module, description) values
  ('*', 'system', 'Acceso total'),
  ('dashboard.view', 'dashboard', 'Ver dashboard'),
  ('pos.sell', 'pos', 'Crear pedidos y agregar productos'),
  ('pos.charge', 'pos', 'Cobrar y registrar pagos'),
  ('pos.discount', 'pos', 'Aplicar descuentos'),
  ('pos.void', 'pos', 'Anular productos enviados'),
  ('pos.cancel', 'pos', 'Anular pedidos'),
  ('pos.merge', 'pos', 'Unificar cuentas'),
  ('tables.view', 'tables', 'Ver mesas'),
  ('tables.manage', 'tables', 'Atender mesas y solicitudes'),
  ('kds.kitchen', 'kds', 'Pantalla de cocina'),
  ('kds.bar', 'kds', 'Pantalla de bar'),
  ('kds.cafe', 'kds', 'Pantalla de cafetería'),
  ('catalog.manage', 'catalog', 'Administrar productos y categorías'),
  ('inventory.view', 'inventory', 'Ver inventario'),
  ('inventory.manage', 'inventory', 'Administrar ingredientes'),
  ('inventory.adjust', 'inventory', 'Ajustes, mermas y desperdicios'),
  ('purchases.manage', 'purchases', 'Proveedores y compras'),
  ('customers.view', 'customers', 'Ver clientes'),
  ('customers.manage', 'customers', 'Administrar clientes'),
  ('cash.view', 'cash', 'Ver caja'),
  ('cash.open', 'cash', 'Abrir caja'),
  ('cash.move', 'cash', 'Ingresos, egresos y retiros'),
  ('cash.close', 'cash', 'Cerrar caja y arqueo'),
  ('cash.void_payment', 'cash', 'Reversar pagos'),
  ('expenses.manage', 'expenses', 'Registrar gastos'),
  ('delivery.manage', 'delivery', 'Gestionar domicilios'),
  ('delivery.courier', 'delivery', 'Panel de domiciliario'),
  ('reports.view', 'reports', 'Ver reportes de ventas'),
  ('reports.finance', 'reports', 'Ver costos, gastos y resultados'),
  ('audit.view', 'audit', 'Ver auditoría'),
  ('users.manage', 'users', 'Usuarios y roles'),
  ('settings.manage', 'settings', 'Configuración general')
on conflict do nothing;

create or replace function bootstrap_business(p_name text, p_slug text, p_admin_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid; g uuid; s uuid; st_k uuid; st_b uuid; st_c uuid; r record; v_admin_role uuid;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  insert into businesses (name, slug) values (p_name, p_slug) returning id into b;
  insert into business_units (business_id, kind, name, shared_expense_pct) values (b, 'gastronomy', 'Gastronomía', 70) returning id into g;
  insert into business_units (business_id, kind, name, shared_expense_pct) values (b, 'shop', 'Tienda', 30) returning id into s;
  insert into stations (business_id, code, name) values (b, 'kitchen', 'Cocina') returning id into st_k;
  insert into stations (business_id, code, name) values (b, 'bar', 'Bar') returning id into st_b;
  insert into stations (business_id, code, name) values (b, 'cafe', 'Cafetería') returning id into st_c;

  insert into categories (business_id, business_unit_id, default_station_id, name, slug, sort) values
    (b, g, st_k, 'Hamburguesas', 'hamburguesas', 1),
    (b, g, st_k, 'Entradas', 'entradas', 2),
    (b, g, st_k, 'Platos principales', 'platos-principales', 3),
    (b, g, st_c, 'Cafetería', 'cafeteria', 4),
    (b, g, st_b, 'Bebidas', 'bebidas', 5),
    (b, g, st_b, 'Cervezas', 'cervezas', 6),
    (b, g, st_b, 'Licores', 'licores', 7),
    (b, g, st_k, 'Postres', 'postres', 8),
    (b, s, null, 'Camisas personalizadas', 'camisas-personalizadas', 9),
    (b, s, null, 'Camisetas', 'camisetas', 10),
    (b, s, null, 'Merchandising', 'merchandising', 11);

  for r in select * from (values
    ('admin', 'Administrador general', array['*']),
    ('restaurant_admin', 'Administrador de restaurante', array['dashboard.view','pos.*','tables.*','kds.*','catalog.manage','inventory.*','purchases.manage','customers.*','cash.*','expenses.manage','delivery.manage','reports.view']),
    ('cashier', 'Cajero', array['pos.sell','pos.charge','pos.discount','tables.view','customers.view','customers.manage','cash.view','cash.open','cash.move','cash.close','delivery.manage']),
    ('waiter', 'Mesero', array['pos.sell','tables.view','tables.manage','customers.view']),
    ('cook', 'Cocinero', array['kds.kitchen']),
    ('barista', 'Barista', array['kds.cafe']),
    ('bartender', 'Personal de bar', array['kds.bar','pos.sell','tables.view']),
    ('shop_admin', 'Administrador de tienda', array['dashboard.view','pos.sell','pos.charge','pos.discount','catalog.manage','inventory.*','purchases.manage','customers.*','reports.view']),
    ('shop_staff', 'Personal de tienda', array['pos.sell','pos.charge','customers.view','inventory.view']),
    ('courier', 'Domiciliario', array['delivery.courier']),
    ('accounting', 'Contabilidad', array['dashboard.view','reports.view','reports.finance','expenses.manage','purchases.manage','cash.view','audit.view','inventory.view','customers.view'])
  ) as t(code, name, perms) loop
    insert into roles (business_id, code, name, is_system) values (b, r.code, r.name, true) returning id into v_admin_role;
    -- Comodines de módulo ("pos.*") se guardan como permisos explícitos
    insert into role_permissions (role_id, permission)
    select v_admin_role, p.code from permissions p
    where p.code = any(r.perms) or (p.code <> '*' and split_part(p.code, '.', 1) || '.*' = any(r.perms))
    on conflict do nothing;
  end loop;
  select id into v_admin_role from roles where business_id = b and code = 'admin';
  insert into members (business_id, user_id, role_id, full_name) values (b, auth.uid(), v_admin_role, p_admin_name);

  insert into payment_methods (business_id, code, name, is_cash, requires_reference, gateway, available_online, sort) values
    (b, 'cash', 'Efectivo', true, false, null, true, 1),
    (b, 'debit', 'Tarjeta débito', false, false, null, false, 2),
    (b, 'credit', 'Tarjeta crédito', false, false, null, false, 3),
    (b, 'transfer', 'Transferencia', false, true, null, false, 4),
    (b, 'qr', 'QR (Nequi / Daviplata / Bre-B)', false, true, null, false, 5),
    (b, 'online', 'Pago en línea', false, false, 'wompi', false, 6),
    (b, 'other', 'Otro', false, true, null, false, 7);

  insert into expense_categories (business_id, code, name) values
    (b, 'rent', 'Arriendo'), (b, 'utilities', 'Servicios públicos'), (b, 'payroll', 'Nómina'),
    (b, 'purchases', 'Compras'), (b, 'transport', 'Transporte'), (b, 'marketing', 'Publicidad'),
    (b, 'maintenance', 'Mantenimiento'), (b, 'other', 'Otros gastos');

  insert into cash_registers (business_id, name) values (b, 'Caja principal');
  return b;
end $$;

-- ---------------------------------------------------------------------
-- RLS operativa: lectura por miembros con permiso; escritura vía funciones
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['customers','customer_addresses','dining_tables','payment_methods','delivery_zones','order_counters',
    'orders','kds_tickets','order_items','order_status_history','service_requests','cash_registers','cash_sessions',
    'payments','payment_allocations','revenue_entries','cash_movements','deliveries','delivery_events','courier_locations',
    'notifications','notification_outbox','push_subscriptions','suppliers','purchases','purchase_items','purchase_payments',
    'expense_categories','expenses','expense_allocations'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Lectura general por miembros
create policy r_tables on dining_tables for select using (is_member(business_id));
create policy r_pm on payment_methods for select using (is_member(business_id));
create policy r_zones on delivery_zones for select using (is_member(business_id));
create policy r_orders on orders for select using (is_member(business_id));
create policy r_items on order_items for select using (is_member(business_id));
create policy r_tickets on kds_tickets for select using (is_member(business_id));
create policy r_hist on order_status_history for select using (is_member(business_id));
create policy r_sreq on service_requests for select using (is_member(business_id));
create policy r_registers on cash_registers for select using (is_member(business_id));
create policy r_exp_cat on expense_categories for select using (is_member(business_id));
-- Domicilios: gestores ven todo; domiciliario solo lo asignado
create policy r_deliveries on deliveries for select using (
  has_perm(business_id, 'delivery.manage') or has_perm(business_id, 'reports.view')
  or (courier_id = current_member_id(business_id)));
create policy r_delivery_events on delivery_events for select using (
  exists (select 1 from deliveries d where d.id = delivery_id));
create policy r_courier_loc on courier_locations for select using (has_perm(business_id, 'delivery.manage'));
-- Datos sensibles
create policy r_customers on customers for select using (has_perm(business_id, 'customers.view') or has_perm(business_id, 'pos.sell'));
create policy r_addresses on customer_addresses for select using (has_perm(business_id, 'customers.view') or has_perm(business_id, 'delivery.manage'));
create policy r_sessions on cash_sessions for select using (has_perm(business_id, 'cash.view') or has_perm(business_id, 'pos.charge'));
create policy r_payments on payments for select using (has_perm(business_id, 'cash.view') or has_perm(business_id, 'pos.charge') or has_perm(business_id, 'reports.view'));
create policy r_alloc on payment_allocations for select using (has_perm(business_id, 'cash.view') or has_perm(business_id, 'reports.view'));
create policy r_revenue on revenue_entries for select using (has_perm(business_id, 'reports.view') or has_perm(business_id, 'dashboard.view'));
create policy r_cash_mov on cash_movements for select using (has_perm(business_id, 'cash.view'));
create policy r_suppliers on suppliers for select using (has_perm(business_id, 'purchases.manage') or has_perm(business_id, 'reports.finance'));
create policy r_purchases on purchases for select using (has_perm(business_id, 'purchases.manage') or has_perm(business_id, 'reports.finance'));
create policy r_purchase_items on purchase_items for select using (has_perm(business_id, 'purchases.manage') or has_perm(business_id, 'reports.finance'));
create policy r_purchase_pay on purchase_payments for select using (has_perm(business_id, 'purchases.manage') or has_perm(business_id, 'reports.finance'));
create policy r_expenses on expenses for select using (has_perm(business_id, 'expenses.manage') or has_perm(business_id, 'reports.finance'));
create policy r_exp_alloc on expense_allocations for select using (has_perm(business_id, 'expenses.manage') or has_perm(business_id, 'reports.finance'));
create policy r_notifications on notifications for select using (
  is_member(business_id) and (member_id = current_member_id(business_id) or (target_perm is not null and has_perm(business_id, target_perm))));
create policy r_outbox on notification_outbox for select using (has_perm(business_id, 'settings.manage'));

-- Escrituras directas permitidas (configuración / maestros)
create policy w_tables on dining_tables for all using (has_perm(business_id, 'settings.manage')) with check (has_perm(business_id, 'settings.manage'));
create policy w_pm on payment_methods for all using (has_perm(business_id, 'settings.manage')) with check (has_perm(business_id, 'settings.manage'));
create policy w_zones on delivery_zones for all using (has_perm(business_id, 'settings.manage')) with check (has_perm(business_id, 'settings.manage'));
create policy w_registers on cash_registers for all using (has_perm(business_id, 'settings.manage')) with check (has_perm(business_id, 'settings.manage'));
create policy w_exp_cat on expense_categories for all using (has_perm(business_id, 'settings.manage')) with check (has_perm(business_id, 'settings.manage'));
create policy w_customers on customers for insert with check (has_perm(business_id, 'customers.manage') or has_perm(business_id, 'pos.sell'));
create policy u_customers on customers for update using (has_perm(business_id, 'customers.manage'));
create policy w_addresses on customer_addresses for all using (has_perm(business_id, 'customers.manage')) with check (has_perm(business_id, 'customers.manage'));
create policy w_suppliers on suppliers for all using (has_perm(business_id, 'purchases.manage')) with check (has_perm(business_id, 'purchases.manage'));
create policy w_push on push_subscriptions for insert with check (is_member(business_id) and member_id = current_member_id(business_id));

-- Nada de borrados silenciosos en registros transaccionales
do $$
declare t text;
begin
  foreach t in array array['orders','order_items','kds_tickets','payments','payment_allocations','revenue_entries',
    'cash_movements','cash_sessions','deliveries','delivery_events','order_status_history','purchases','purchase_items',
    'purchase_payments','expenses','expense_allocations'] loop
    execute format('create trigger %1$s_no_delete before delete on %1$s for each row execute function forbid_delete()', t);
  end loop;
  foreach t in array array['customers','dining_tables','payment_methods','delivery_zones','suppliers','cash_sessions','expenses','purchases','deliveries','payments'] loop
    execute format('create trigger audit_%1$s after insert or update on %1$s for each row execute function audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Internas: no invocables directamente por usuarios
revoke execute on function add_order_lines(uuid, jsonb), apply_order_stock(uuid), reverse_item_stock(uuid, text),
  route_order(uuid), allocate_payment(uuid), finalize_order(uuid), refresh_order_progress(uuid), refresh_table_status(uuid),
  delivery_transition(uuid, delivery_status, text, boolean), recalc_order(uuid), next_order_number(uuid),
  log_status(uuid, uuid, text, uuid, text, text, text), notify(uuid, text, uuid, text, text, text, jsonb),
  gateway_confirm_payment(text, numeric, text, text, payment_status, jsonb), audit_trigger(), forbid_delete(),
  apply_inventory_movement()
  from authenticated;
grant execute on function gateway_confirm_payment(text, numeric, text, text, payment_status, jsonb) to service_role;
-- Públicas (clientes por QR o tienda en línea)
grant execute on function public_menu(text), public_table(text), qr_place_order(text, jsonb, text, text),
  qr_service_request(text, text, text), qr_table_status(text), shop_place_order(text, jsonb), public_track(text)
  to anon, authenticated;
-- Funciones auxiliares usadas por políticas RLS
grant execute on function is_member(uuid), has_perm(uuid, text), current_member_id(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime: tablas que las pantallas escuchan en vivo
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table orders, order_items, kds_tickets, dining_tables, service_requests,
      deliveries, notifications, courier_locations;
  end if;
end $$;

-- =====================================================================
-- RUPÍCOLA · 0011 · Fase 2 (reunión de noviembre)
--  · Comisión automática de la tienda para gastronomía (p. ej. 10 %)
--  · Productos que se venden sin control de existencias
--  · Gastos con medio de pago (efectivo, transferencia, datáfono…)
--  · Canje de puntos de fidelización con historial
--  · Caja y dashboard con métodos de pago por negocio
--  · Reporte de liquidación de la tienda
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------
alter table businesses
  add column shop_commission_pct numeric(5,2) not null default 0 check (shop_commission_pct between 0 and 100),
  add column loyalty_point_value numeric(10,2) not null default 10 check (loyalty_point_value >= 0),
  add column loyalty_min_redeem int not null default 100 check (loyalty_min_redeem >= 1);
comment on column businesses.shop_commission_pct is '% de cada venta de la tienda que queda para gastronomía (comisión)';
comment on column businesses.loyalty_point_value is 'Valor en pesos de cada punto al canjear';

-- false = se vende sin descontar ni exigir existencias (p. ej. camisetas por encargo)
alter table products add column track_stock boolean not null default true;

-- % de comisión vigente cuando se agregó la línea (no cambia si luego se ajusta la configuración)
alter table order_items add column commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100);

alter table expenses add column method_id uuid references payment_methods(id);

alter table revenue_entries drop constraint revenue_entries_concept_check;
alter table revenue_entries add constraint revenue_entries_concept_check
  check (concept in ('sale', 'delivery_fee', 'tip', 'reversal', 'commission'));

-- ---------------------------------------------------------------------
-- Historial de puntos (ganados, canjeados, devueltos). Nunca se borra.
-- ---------------------------------------------------------------------
create table loyalty_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id),
  order_id uuid references orders(id),
  payment_id uuid references payments(id),
  kind text not null check (kind in ('earn', 'redeem', 'refund', 'earn_reversal')),
  points numeric(14,2) not null,          -- + suma al cliente · − resta
  amount numeric(14,2) not null default 0, -- valor en pesos (canjes)
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on loyalty_movements (customer_id, created_at desc);
create index on loyalty_movements (payment_id);
alter table loyalty_movements enable row level security;
create policy r_loyalty on loyalty_movements for select
  using (has_perm(business_id, 'customers.view') or has_perm(business_id, 'pos.sell'));
create trigger loyalty_movements_no_delete before delete on loyalty_movements for each row execute function forbid_delete();

-- Devuelve al cliente los puntos canjeados en un pago reversado
create or replace function loyalty_refund_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select business_id, customer_id, order_id, -sum(points) as pts, -sum(amount) as amt
           from loyalty_movements where payment_id = p_payment group by 1, 2, 3 having sum(points) < 0 loop
    update customers set points = points + r.pts where id = r.customer_id;
    insert into loyalty_movements (business_id, customer_id, order_id, payment_id, kind, points, amount, reason)
    values (r.business_id, r.customer_id, r.order_id, p_payment, 'refund', r.pts, r.amt, 'Pago con puntos reversado: ' || p_reason);
  end loop;
end $$;

-- Quita los puntos que se ganaron con un pedido cuyo pago se reversó
create or replace function loyalty_reverse_earned(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select business_id, customer_id, sum(points) as pts from loyalty_movements
           where order_id = p_order and kind in ('earn', 'earn_reversal') group by 1, 2 having sum(points) > 0 loop
    update customers set points = greatest(points - r.pts, 0) where id = r.customer_id;
    insert into loyalty_movements (business_id, customer_id, order_id, kind, points, reason)
    values (r.business_id, r.customer_id, p_order, 'earn_reversal', -r.pts, p_reason);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Cierre del pedido: ingresos por unidad, comisión de tienda y puntos
-- ---------------------------------------------------------------------
create or replace function finalize_order(o_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_gastro uuid; v_points numeric; v_paid_points numeric;
begin
  select * into o from orders where id = o_id for update;
  if o.finalized then return; end if;
  v_gastro := unit_id(o.business_id, 'gastronomy');

  perform apply_order_stock(o_id);

  -- Ventas por unidad (la tienda registra su valor neto de comisión)
  insert into revenue_entries (business_id, business_unit_id, order_id, concept, amount, cost)
  select o.business_id, business_unit_id, o.id, 'sale',
         sum(line_total - round(line_total * commission_pct / 100, 2)), round(sum(qty * unit_cost), 2)
  from order_items where order_id = o.id and status = 'active'
  group by business_unit_id;
  -- Comisión de la tienda: ingreso de gastronomía
  insert into revenue_entries (business_id, business_unit_id, order_id, concept, amount)
  select o.business_id, v_gastro, o.id, 'commission', sum(round(line_total * commission_pct / 100, 2))
  from order_items where order_id = o.id and status = 'active' and commission_pct > 0
  having sum(round(line_total * commission_pct / 100, 2)) > 0;
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
    -- Lo pagado con puntos no genera puntos nuevos
    select coalesce(sum(p.amount), 0) into v_paid_points from payments p join payment_methods pm on pm.id = p.method_id
      where p.order_id = o.id and p.status = 'approved' and pm.code = 'points';
    select case when b.loyalty_enabled then floor(greatest(o.total - v_paid_points, 0) / 1000) * b.loyalty_points_per_1000 else 0 end
      into v_points from businesses b where b.id = o.business_id;
    update customers set total_spent = total_spent + o.total, orders_count = orders_count + 1,
      points = points + coalesce(v_points, 0) where id = o.customer_id;
    if coalesce(v_points, 0) > 0 then
      insert into loyalty_movements (business_id, customer_id, order_id, kind, points, reason)
      values (o.business_id, o.customer_id, o.id, 'earn', v_points, 'Compra pedido #' || o.number);
    end if;
  end if;

  update service_requests set status = 'attended', attended_at = now()
    where order_id = o.id and kind = 'bill' and status = 'open';
  perform refresh_table_status(o.table_id);
end $$;

-- ---------------------------------------------------------------------
-- Gastos con medio de pago
-- ---------------------------------------------------------------------
drop function expense_create(uuid, uuid, expense_scope, text, numeric, date, numeric, uuid, uuid, text);
create function expense_create(p_business uuid, p_category uuid, p_scope expense_scope, p_description text,
  p_amount numeric, p_date date default current_date, p_gastro_pct numeric default null,
  p_session uuid default null, p_supplier uuid default null, p_reference text default null, p_method uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_g uuid := unit_id(p_business, 'gastronomy'); v_s uuid := unit_id(p_business, 'shop');
  v_pct numeric; v_ga numeric; v_method uuid;
begin
  perform require_perm(p_business, 'expenses.manage');
  if p_amount <= 0 then raise exception 'Valor inválido'; end if;
  if p_method is not null then
    select id into v_method from payment_methods where id = p_method and business_id = p_business and code <> 'points';
    if v_method is null then raise exception 'Medio de pago no válido'; end if;
  elsif p_session is not null then
    v_method := (select id from payment_methods where business_id = p_business and is_cash order by sort limit 1);
  end if;
  insert into expenses (business_id, category_id, scope, description, amount, expense_date, gastronomy_pct,
                        paid_from_cash, cash_session_id, supplier_id, reference, method_id)
  values (p_business, p_category, p_scope, p_description, p_amount, p_date, p_gastro_pct,
          p_session is not null, p_session, p_supplier, p_reference, v_method)
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

  -- Pagado desde la caja: sale del saldo del medio elegido (efectivo, transferencia…)
  if p_session is not null then
    perform require_perm(p_business, 'cash.move');
    if not exists (select 1 from cash_sessions where id = p_session and closed_at is null and business_id = p_business) then
      raise exception 'La caja no está abierta';
    end if;
    insert into cash_movements (business_id, session_id, business_unit_id, method_id, kind, amount, expense_id, description)
    select p_business, p_session, ea.business_unit_id, v_method, 'expense', -ea.amount, v_id, p_description
    from expense_allocations ea where ea.expense_id = v_id and ea.amount <> 0;
  end if;
  return v_id;
end $$;

-- Líneas de pedido: productos sin control de existencias y comisión de tienda
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
      if p.track_stock and v.stock < v_qty then
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
                             name, variant_label, qty, unit_price, modifiers, notes, unit_cost, commission_pct)
    values (v_order.business_id, o, p.id, v.id, p.business_unit_id, v_station,
            p.name, case when v.id is not null then concat_ws(' / ', v.size, v.color, v.design) end,
            v_qty, v_price, v_mods, nullif(left(trim(it->>'notes'), 300), ''),
            product_unit_cost(p.id, v.id),
            case when (select kind from business_units where id = p.business_unit_id) = 'shop'
                 then (select shop_commission_pct from businesses where id = v_order.business_id) else 0 end);
    v_count := v_count + 1;
  end loop;

  perform recalc_order(o);
  return v_count;
end $$;

create or replace function apply_order_stock(o uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  li order_items%rowtype;
  p products%rowtype;
  r record;
begin
  for li in select * from order_items where order_id = o and status = 'active' and not stock_applied for update loop
    select * into p from products where id = li.product_id;
    if not p.track_stock then
      null;   -- producto sin control de existencias
    elsif li.variant_id is not null then
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
         'is_available', p.is_available and (p.stock_mode <> 'variant' or not p.track_stock or exists (
            select 1 from product_variants v where v.product_id = p.id and v.active and v.stock > 0)),
         'stock_mode', p.stock_mode,
         'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.size, 'color', v.color,
              'design', v.design, 'price', coalesce(v.price, p.price), 'available', (v.stock > 0 or not p.track_stock),
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

-- Reparto de pagos: la comisión de las ventas de tienda queda en gastronomía
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
      select business_unit_id as unit, 'sale'::text as concept, line_total - round(line_total * commission_pct / 100, 2) as amt
        from order_items where order_id = o.id and status = 'active'
      union all select v_gastro, 'sale', round(line_total * commission_pct / 100, 2)
        from order_items where order_id = o.id and status = 'active' and commission_pct > 0
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
    if pm.code = 'points' then raise exception 'Use "Canjear puntos" para pagar con puntos'; end if;
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
  perform loyalty_refund_payment(p_payment, p_reason);   -- pago con puntos: se devuelven
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
      perform loyalty_reverse_earned(o.id, 'Pago reversado: ' || p_reason);
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
    'by_unit_method', coalesce((select jsonb_agg(x) from (
        select coalesce(bu.name, case when cm.kind = 'opening' then 'Apertura' else 'Propinas / sin unidad' end) as unit,
               pm.name as method, pm.is_cash, sum(cm.amount) as total
        from cash_movements cm join payment_methods pm on pm.id = cm.method_id
        left join business_units bu on bu.id = cm.business_unit_id
        where cm.session_id = p_session group by 1, 2, 3 order by 1, 2) x), '[]'),
    'by_kind', coalesce((select jsonb_agg(x) from (
        select kind, sum(amount) as total, count(*) as n from cash_movements where session_id = p_session group by kind) x), '[]'),
    'expected_cash', (select coalesce(sum(cm.amount), 0) from cash_movements cm join payment_methods pm on pm.id = cm.method_id
                      where cm.session_id = p_session and pm.is_cash)
  ) into v;
  return v;
end $$;

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
    'by_unit_method', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(bu.name, 'Propinas') as unit, pm.name as method, pm.is_cash, sum(pa.amount) as total
        from payment_allocations pa join payments py on py.id = pa.payment_id join payment_methods pm on pm.id = py.method_id
        left join business_units bu on bu.id = pa.business_unit_id
        where pa.business_id = p_business and pa.created_at >= f and pa.created_at < t and (p_unit is null or pa.business_unit_id = p_unit)
        group by 1, 2, 3 order by 1, 4 desc) x),
    'by_employee', (select coalesce(jsonb_agg(x), '[]') from (
        select m.full_name as name, count(distinct o.id) as orders, sum(o.total) as total
        from orders o join members m on m.id = o.waiter_id
        where o.business_id = p_business and o.finalized and o.paid_at >= f and o.paid_at < t
        group by m.full_name order by 3 desc limit 10) x)
  ) into v;
  return v;
end $$;

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
             bu.name as unidad, coalesce(pm.name, '') as medio_pago, ea.amount as valor_asignado
      from expenses e join expense_categories ec on ec.id = e.category_id
      join expense_allocations ea on ea.expense_id = e.id join business_units bu on bu.id = ea.business_unit_id
      left join payment_methods pm on pm.id = e.method_id
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
  when 'commissions' then
    -- Liquidación de la tienda: lo vendido, la comisión que queda en gastronomía y el neto de la tienda
    select jsonb_agg(x) into v from (
      select oi.name as producto, coalesce(oi.variant_label, '') as variante, oi.commission_pct as comision_pct,
             sum(oi.qty) as cantidad, sum(oi.line_total) as ventas,
             sum(round(oi.line_total * oi.commission_pct / 100, 2)) as comision,
             sum(oi.line_total - round(oi.line_total * oi.commission_pct / 100, 2)) as neto_tienda
      from order_items oi join orders o on o.id = oi.order_id join business_units bu on bu.id = oi.business_unit_id
      where o.business_id = p_business and o.finalized and oi.status = 'active' and bu.kind = 'shop'
        and o.paid_at >= f and o.paid_at < t
      group by 1, 2, 3 order by 5 desc) x;
  else
    raise exception 'Reporte desconocido: %', p_kind;
  end case;
  return coalesce(v, '[]');
end $$;

-- ---------------------------------------------------------------------
-- Canje de puntos: se registra como un pago "Puntos de fidelización"
-- que se reparte entre los negocios como cualquier otro pago.
-- ---------------------------------------------------------------------
create or replace function pos_redeem_points(p_order uuid, p_points numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; b businesses%rowtype; c customers%rowtype;
  v_method uuid; v_value numeric; v_due numeric; v_pay uuid;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  perform require_perm(o.business_id, 'pos.charge');
  select * into b from businesses where id = o.business_id;
  if not b.loyalty_enabled then raise exception 'El programa de puntos está desactivado'; end if;
  if o.status = 'cancelled' then raise exception 'Pedido anulado'; end if;
  if o.finalized then raise exception 'El pedido ya está pagado'; end if;
  if o.customer_id is null then raise exception 'Asocie un cliente al pedido para canjear puntos'; end if;
  if p_points is null or p_points <= 0 or p_points <> trunc(p_points) then raise exception 'Cantidad de puntos inválida'; end if;
  if p_points < b.loyalty_min_redeem then raise exception 'El mínimo para canjear es % puntos', b.loyalty_min_redeem; end if;
  if b.loyalty_point_value <= 0 then raise exception 'Configure el valor del punto en Configuración'; end if;

  select * into c from customers where id = o.customer_id for update;
  if c.points < p_points then raise exception 'El cliente solo tiene % puntos', c.points; end if;

  v_value := round(p_points * b.loyalty_point_value, 2);
  v_due := o.total + o.tip - (select coalesce(sum(amount), 0) from payments where order_id = o.id and status = 'approved');
  if v_value > v_due then
    raise exception 'Los puntos ($%) superan el saldo pendiente ($%). Máximo % puntos', v_value, v_due, floor(v_due / b.loyalty_point_value);
  end if;

  select id into v_method from payment_methods where business_id = o.business_id and code = 'points';
  if v_method is null then
    insert into payment_methods (business_id, code, name, is_cash, active, sort)
    values (o.business_id, 'points', 'Puntos de fidelización', false, false, 99) returning id into v_method;
  end if;

  insert into payments (business_id, order_id, method_id, amount, status, reference)
  values (o.business_id, o.id, v_method, v_value, 'approved', p_points || ' puntos') returning id into v_pay;
  update customers set points = points - p_points where id = c.id;
  insert into loyalty_movements (business_id, customer_id, order_id, payment_id, kind, points, amount, reason)
  values (o.business_id, c.id, o.id, v_pay, 'redeem', -p_points, v_value, 'Canje en pedido #' || o.number);
  perform allocate_payment(v_pay);

  update orders set paid_total = (select coalesce(sum(amount), 0) from payments where order_id = o.id and status = 'approved')
    where id = o.id returning * into o;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, new_data, order_id)
  values (o.business_id, auth.uid(), current_member_id(o.business_id), 'payments', v_pay::text, 'redeem_points',
          jsonb_build_object('points', p_points, 'value', v_value, 'customer_id', c.id), o.id);
  if o.paid_total >= o.total + o.tip then perform finalize_order(o.id); end if;

  return jsonb_build_object('value', v_value, 'points_left', c.points - p_points,
    'due', greatest(o.total + o.tip - o.paid_total, 0), 'finalized', o.paid_total >= o.total + o.tip);
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución de las funciones nuevas o recreadas
-- ---------------------------------------------------------------------
revoke execute on function expense_create(uuid, uuid, expense_scope, text, numeric, date, numeric, uuid, uuid, text, uuid),
  pos_redeem_points(uuid, numeric), loyalty_refund_payment(uuid, text), loyalty_reverse_earned(uuid, text)
  from public, anon;
grant execute on function expense_create(uuid, uuid, expense_scope, text, numeric, date, numeric, uuid, uuid, text, uuid),
  pos_redeem_points(uuid, numeric) to authenticated;
revoke execute on function loyalty_refund_payment(uuid, text), loyalty_reverse_earned(uuid, text) from authenticated;

-- RUPÍCOLA: comisión del 10 % sobre las ventas de la tienda (acordado en la reunión)
update businesses set shop_commission_pct = 10;

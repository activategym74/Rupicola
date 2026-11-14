-- =====================================================================
-- Fase 3: proveedores en consignación (Rupícola) y módulo de aliados (Mi Tierra)
-- =====================================================================
-- 1. Cada proveedor puede trabajar en consignación con su propio % de comisión.
--    Se le paga solo lo vendido (precio de venta menos el %), lo demás queda pendiente.
-- 2. Un negocio puede tener perfil 'brand' (marca que distribuye a establecimientos
--    aliados), como Mi Tierra: entregas, ventas reportadas, devoluciones y cuentas por cobrar.

-- ---------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------
alter table suppliers
  add column if not exists is_consignment boolean not null default false,
  add column if not exists commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  add column if not exists show_in_dashboard boolean not null default false;

alter table products add column if not exists consignment_supplier_id uuid references suppliers(id);
create index if not exists products_consignment_idx on products (consignment_supplier_id);

alter table order_items add column if not exists consignment_supplier_id uuid references suppliers(id);
create index if not exists order_items_consignment_idx on order_items (consignment_supplier_id);

alter table inventory_movements add column if not exists supplier_id uuid references suppliers(id);
create index if not exists inventory_movements_supplier_idx on inventory_movements (supplier_id);

alter table businesses add column if not exists profile text not null default 'restaurant'
  check (profile in ('restaurant', 'brand'));

-- ---------------------------------------------------------------------
-- Pagos a proveedores en consignación
-- ---------------------------------------------------------------------
create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  amount numeric(14,2) not null check (amount > 0),
  method_id uuid references payment_methods(id),
  cash_session_id uuid references cash_sessions(id),
  reference text,
  notes text,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on supplier_payments (supplier_id, created_at desc);
create index on supplier_payments (business_id, created_at desc);
alter table supplier_payments enable row level security;
create policy r_supplier_payments on supplier_payments for select
  using (has_perm(business_id, 'purchases.manage') or has_perm(business_id, 'reports.finance'));
create trigger supplier_payments_no_delete before delete on supplier_payments for each row execute function forbid_delete();
create trigger audit_supplier_payments after insert or update on supplier_payments for each row execute function audit_trigger();

-- Lo que se le debe a un proveedor: ventas cobradas de sus productos menos la
-- comisión pactada en cada venta, menos los pagos ya hechos.
create or replace function supplier_balance(p_supplier uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(oi.line_total - round(oi.line_total * oi.commission_pct / 100, 2))
                   from order_items oi join orders o on o.id = oi.order_id
                   where oi.consignment_supplier_id = p_supplier and oi.status = 'active' and o.finalized), 0)
       - coalesce((select sum(amount) from supplier_payments where supplier_id = p_supplier and status = 'active'), 0);
$$;

-- Líneas de pedido: los productos en consignación guardan proveedor y % vigente
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
  v_sup suppliers%rowtype;
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
    v_sup := null;
    if p.consignment_supplier_id is not null then
      select * into v_sup from suppliers where id = p.consignment_supplier_id and business_id = v_order.business_id and is_consignment;
    end if;
    v_station := coalesce(p.station_id, (select default_station_id from categories where id = p.category_id));
    if (select kind from business_units where id = p.business_unit_id) = 'shop' then
      v_station := null;   -- la tienda nunca va a cocina
    end if;

    insert into order_items (business_id, order_id, product_id, variant_id, business_unit_id, station_id,
                             name, variant_label, qty, unit_price, modifiers, notes, unit_cost, commission_pct, consignment_supplier_id)
    values (v_order.business_id, o, p.id, v.id, p.business_unit_id, v_station,
            p.name, case when v.id is not null then concat_ws(' / ', v.size, v.color, v.design) end,
            v_qty, v_price, v_mods, nullif(left(trim(it->>'notes'), 300), ''),
            case when v_sup.id is not null then round(v_price * (100 - v_sup.commission_pct) / 100, 2)
                 else product_unit_cost(p.id, v.id) end,
            coalesce(v_sup.commission_pct, 0), v_sup.id);
    v_count := v_count + 1;
  end loop;

  perform recalc_order(o);
  return v_count;
end $$;

create or replace function finalize_order(o_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_gastro uuid; v_points numeric; v_paid_points numeric;
begin
  select * into o from orders where id = o_id for update;
  if o.finalized then return; end if;
  v_gastro := unit_id(o.business_id, 'gastronomy');

  perform apply_order_stock(o_id);

  -- Ventas por unidad. En consignación el costo es lo que se le debe al proveedor,
  -- así la utilidad de esas líneas es exactamente la comisión de Rupícola.
  insert into revenue_entries (business_id, business_unit_id, order_id, concept, amount, cost)
  select o.business_id, business_unit_id, o.id, 'sale', sum(line_total),
         round(sum(case when consignment_supplier_id is not null
                         then line_total - round(line_total * commission_pct / 100, 2)
                         else qty * unit_cost end), 2)
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
    'featured_suppliers', (select coalesce(jsonb_agg(x order by x.name), '[]') from (
        select s.id, s.name, s.commission_pct,
               coalesce(sold.sales, 0) as sales_range, coalesce(sold.owed, 0) as owed_range,
               coalesce(sold.sales, 0) - coalesce(sold.owed, 0) as commission_range,
               supplier_balance(s.id) as balance
        from suppliers s
        left join lateral (
          select sum(oi.line_total) as sales, sum(oi.line_total - round(oi.line_total * oi.commission_pct / 100, 2)) as owed
          from order_items oi join orders o on o.id = oi.order_id
          where oi.consignment_supplier_id = s.id and oi.status = 'active' and o.finalized
            and o.paid_at >= f and o.paid_at < t) sold on true
        where s.business_id = p_business and s.is_consignment and s.show_in_dashboard and s.active) x),
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
  if p_kind in ('costs', 'expenses', 'results', 'purchases', 'suppliers', 'commissions', 'consignment') then perform require_perm(p_business, 'reports.finance'); end if;

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
  when 'consignment' then
    -- Consignación: por proveedor, categoría y producto
    select jsonb_agg(x) into v from (
      select s.name as proveedor, c.name as categoria, p.name as producto,
             concat_ws(' / ', pv.size, pv.color, pv.design) as variante, s.commission_pct as comision_pct,
             coalesce((select sum(m.qty) from inventory_movements m where m.variant_id = pv.id and m.supplier_id = s.id and m.kind = 'purchase' and m.created_at >= f and m.created_at < t), 0) as recibido,
             coalesce(sold.cant, 0) as vendido,
             coalesce((select -sum(m.qty) from inventory_movements m where m.variant_id = pv.id and m.supplier_id = s.id and m.kind = 'return' and m.created_at >= f and m.created_at < t), 0) as devuelto,
             consignment_pending(s.id, pv.id) as existencia,
             coalesce(sold.ventas, 0) as ventas, coalesce(sold.comision, 0) as comision, coalesce(sold.ventas, 0) - coalesce(sold.comision, 0) as a_pagar
      from suppliers s join products p on p.consignment_supplier_id = s.id
      join categories c on c.id = p.category_id join product_variants pv on pv.product_id = p.id
      left join lateral (
        select sum(oi.qty) as cant, sum(oi.line_total) as ventas, sum(round(oi.line_total * oi.commission_pct / 100, 2)) as comision
        from order_items oi join orders o on o.id = oi.order_id
        where oi.variant_id = pv.id and oi.consignment_supplier_id = s.id and oi.status = 'active'
          and o.finalized and o.paid_at >= f and o.paid_at < t) sold on true
      where s.business_id = p_business and s.is_consignment
      order by 1, 2, 3, 4) x;
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

create or replace function my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'logo_url', b.logo_url,
                                   'timezone', b.timezone, 'currency', b.currency, 'profile', b.profile),
    'member', jsonb_build_object('id', m.id, 'full_name', m.full_name),
    'role', jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name),
    'permissions', (select coalesce(jsonb_agg(rp.permission), '[]') from role_permissions rp where rp.role_id = r.id),
    'units', (select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'name', u.name)) from business_units u where u.business_id = b.id)
  ) order by b.name), '[]')
  from members m join businesses b on b.id = m.business_id join roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.active;
$$;


-- ---------------------------------------------------------------------
-- Consignación: recibir y devolver mercancía del proveedor
-- ---------------------------------------------------------------------
-- p_items: [{variant_id, qty}]. 'receive' suma existencias, 'return' las devuelve al proveedor.
create or replace function consignment_move(p_business uuid, p_supplier uuid, p_kind text, p_items jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare s suppliers%rowtype; it jsonb; v_qty numeric; v record; n int := 0; v_pending numeric;
begin
  perform require_perm(p_business, 'purchases.manage');
  select * into s from suppliers where id = p_supplier and business_id = p_business;
  if not found or not s.is_consignment then raise exception 'El proveedor no trabaja en consignación'; end if;
  if p_kind not in ('receive', 'return') then raise exception 'Movimiento no válido'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agregue al menos un producto'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'Cantidad inválida'; end if;
    select pv.id, pv.stock, p.name, p.business_unit_id into v
    from product_variants pv join products p on p.id = pv.product_id
    where pv.id = (it->>'variant_id')::uuid and pv.business_id = p_business and p.consignment_supplier_id = p_supplier;
    if not found then raise exception 'El producto no pertenece a %', s.name; end if;
    if p_kind = 'return' then
      v_pending := consignment_pending(p_supplier, v.id);
      if v_qty > v_pending then
        raise exception 'Solo quedan % unidades de "%" por vender; no se pueden devolver %', trim_scale(v_pending), v.name, trim_scale(v_qty);
      end if;
    end if;
    insert into inventory_movements (business_id, business_unit_id, variant_id, kind, qty, unit_cost, supplier_id, reason)
    values (p_business, v.business_unit_id, v.id, case when p_kind = 'receive' then 'purchase' else 'return' end::movement_kind,
            case when p_kind = 'receive' then v_qty else -v_qty end, 0, p_supplier,
            coalesce(nullif(trim(p_note), ''), case when p_kind = 'receive' then 'Recibido en consignación de ' else 'Devuelto a ' end || s.name));
    n := n + 1;
  end loop;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, new_data)
  values (p_business, auth.uid(), current_member_id(p_business), 'suppliers', p_supplier::text, 'consignment_' || p_kind,
          jsonb_build_object('items', p_items, 'note', p_note));
  return n;
end $$;

-- Unidades de una variante que siguen pendientes por vender (recibido − devuelto − vendido)
create or replace function consignment_pending(p_supplier uuid, p_variant uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(qty) from inventory_movements where supplier_id = p_supplier and variant_id = p_variant and kind in ('purchase', 'return')), 0)
       - coalesce((select sum(oi.qty) from order_items oi join orders o on o.id = oi.order_id
                   where oi.consignment_supplier_id = p_supplier and oi.variant_id = p_variant and oi.status = 'active' and o.finalized), 0);
$$;

-- ---------------------------------------------------------------------
-- Pagos a proveedores
-- ---------------------------------------------------------------------
create or replace function supplier_payment_create(p_business uuid, p_supplier uuid, p_amount numeric, p_method uuid,
  p_session uuid default null, p_reference text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s suppliers%rowtype; v_method payment_methods%rowtype; v_id uuid; v_balance numeric;
begin
  perform require_perm(p_business, 'purchases.manage');
  select * into s from suppliers where id = p_supplier and business_id = p_business for update;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor inválido'; end if;
  v_balance := supplier_balance(p_supplier);
  if p_amount > v_balance then
    raise exception 'El pago (%) supera lo que se le debe a % (%)', trim_scale(p_amount), s.name, trim_scale(v_balance);
  end if;
  select * into v_method from payment_methods where id = p_method and business_id = p_business and code <> 'points';
  if not found then raise exception 'Medio de pago no válido'; end if;
  if v_method.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception 'Este medio de pago requiere referencia';
  end if;
  if p_session is not null then
    perform require_perm(p_business, 'cash.move');
    if not exists (select 1 from cash_sessions where id = p_session and closed_at is null and business_id = p_business) then
      raise exception 'La caja no está abierta';
    end if;
  end if;
  insert into supplier_payments (business_id, supplier_id, amount, method_id, cash_session_id, reference, notes)
  values (p_business, p_supplier, p_amount, p_method, p_session, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''))
  returning id into v_id;
  if p_session is not null then
    insert into cash_movements (business_id, session_id, method_id, kind, amount, description)
    values (p_business, p_session, p_method, 'expense', -p_amount, 'Pago a proveedor ' || s.name);
  end if;
  return v_id;
end $$;

create or replace function supplier_payment_void(p_payment uuid, p_reason text, p_session uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare sp supplier_payments%rowtype; v_name text;
begin
  select * into sp from supplier_payments where id = p_payment for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  perform require_perm(sp.business_id, 'purchases.manage');
  if sp.status <> 'active' then raise exception 'El pago ya está anulado'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Indique el motivo de la anulación'; end if;
  update supplier_payments set status = 'voided', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_payment;
  -- Si salió de la caja, el dinero vuelve a la caja abierta que se indique
  if sp.cash_session_id is not null then
    if p_session is null or not exists (select 1 from cash_sessions where id = p_session and closed_at is null and business_id = sp.business_id) then
      raise exception 'Este pago salió de caja: abra la caja para registrar el reingreso';
    end if;
    perform require_perm(sp.business_id, 'cash.move');
    select name into v_name from suppliers where id = sp.supplier_id;
    insert into cash_movements (business_id, session_id, method_id, kind, amount, description)
    values (sp.business_id, p_session, sp.method_id, 'income', sp.amount, 'Anulación de pago a ' || v_name || ': ' || trim(p_reason));
  end if;
end $$;

-- Resumen por proveedor en consignación (el período filtra lo vendido; saldos son totales)
create or replace function consignment_summary(p_business uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f timestamptz := coalesce(p_from, '-infinity'); t timestamptz := coalesce(p_to, 'infinity'); v jsonb;
begin
  if not (has_perm(p_business, 'purchases.manage') or has_perm(p_business, 'reports.finance')) then
    raise exception 'Permiso requerido: purchases.manage' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x.name), '[]') into v from (
    select s.id, s.name, s.commission_pct, s.show_in_dashboard, s.active, s.phone, s.contact_name,
      coalesce((select sum(qty) from inventory_movements where supplier_id = s.id and kind = 'purchase'), 0) as received,
      coalesce((select -sum(qty) from inventory_movements where supplier_id = s.id and kind = 'return'), 0) as returned,
      coalesce(sold.qty, 0) as sold,
      coalesce((select sum(qty) from inventory_movements where supplier_id = s.id and kind in ('purchase', 'return')), 0) - coalesce(sold.qty, 0) as pending_units,
      coalesce(sold.sales, 0) as sales_total,
      coalesce(sold.owed, 0) as owed_total,
      coalesce((select sum(amount) from supplier_payments where supplier_id = s.id and status = 'active'), 0) as paid_total,
      supplier_balance(s.id) as balance,
      coalesce(sold.sales_range, 0) as sales_range,
      coalesce(sold.sales_range, 0) - coalesce(sold.owed_range, 0) as commission_range,
      coalesce(sold.owed_range, 0) as owed_range,
      coalesce(sold.qty_range, 0) as sold_range
    from suppliers s
    left join lateral (
      select sum(oi.qty) as qty, sum(oi.line_total) as sales,
             sum(oi.line_total - round(oi.line_total * oi.commission_pct / 100, 2)) as owed,
             sum(oi.qty) filter (where o.paid_at >= f and o.paid_at < t) as qty_range,
             sum(oi.line_total) filter (where o.paid_at >= f and o.paid_at < t) as sales_range,
             sum(oi.line_total - round(oi.line_total * oi.commission_pct / 100, 2)) filter (where o.paid_at >= f and o.paid_at < t) as owed_range
      from order_items oi join orders o on o.id = oi.order_id
      where oi.consignment_supplier_id = s.id and oi.status = 'active' and o.finalized) sold on true
    where s.business_id = p_business and s.is_consignment) x;
  return v;
end $$;

-- Detalle de un proveedor: productos con lo recibido, vendido y pendiente; pagos e historial
create or replace function consignment_detail(p_supplier uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s suppliers%rowtype;
begin
  select * into s from suppliers where id = p_supplier;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  if not (has_perm(s.business_id, 'purchases.manage') or has_perm(s.business_id, 'reports.finance')) then
    raise exception 'Permiso requerido: purchases.manage' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'supplier', to_jsonb(s), 'balance', supplier_balance(s.id),
    'items', (select coalesce(jsonb_agg(x order by x.category, x.product, x.variant), '[]') from (
      select pv.id as variant_id, c.name as category, p.name as product,
             concat_ws(' / ', pv.size, pv.color, pv.design) as variant, coalesce(pv.price, p.price) as price,
             coalesce((select sum(qty) from inventory_movements where supplier_id = s.id and variant_id = pv.id and kind = 'purchase'), 0) as received,
             coalesce((select -sum(qty) from inventory_movements where supplier_id = s.id and variant_id = pv.id and kind = 'return'), 0) as returned,
             coalesce(sold.qty, 0) as sold, consignment_pending(s.id, pv.id) as pending,
             coalesce(sold.sales, 0) as sales, coalesce(sold.owed, 0) as owed
      from products p join product_variants pv on pv.product_id = p.id join categories c on c.id = p.category_id
      left join lateral (
        select sum(oi.qty) as qty, sum(oi.line_total) as sales,
               sum(oi.line_total - round(oi.line_total * oi.commission_pct / 100, 2)) as owed
        from order_items oi join orders o on o.id = oi.order_id
        where oi.variant_id = pv.id and oi.consignment_supplier_id = s.id and oi.status = 'active' and o.finalized) sold on true
      where p.consignment_supplier_id = s.id and pv.active) x),
    'payments', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
      select sp.id, sp.amount, sp.reference, sp.notes, sp.status, sp.void_reason, sp.created_at, sp.cash_session_id,
             pm.name as method
      from supplier_payments sp left join payment_methods pm on pm.id = sp.method_id
      where sp.supplier_id = s.id) x),
    'movements', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
      select m.id, m.kind, m.qty, m.reason, m.created_at, p.name as product,
             concat_ws(' / ', pv.size, pv.color, pv.design) as variant
      from inventory_movements m join product_variants pv on pv.id = m.variant_id join products p on p.id = pv.product_id
      where m.supplier_id = s.id order by m.created_at desc limit 200) x)
  );
end $$;

-- =====================================================================
-- Aliados (establecimientos a los que una marca lleva sus productos)
-- =====================================================================
create table outlets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  address text,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table outlet_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  outlet_id uuid not null references outlets(id),
  variant_id uuid not null references product_variants(id),
  kind text not null check (kind in ('delivery', 'sale', 'return')),
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null default 0,
  commission_pct numeric(5,2) not null default 0,
  amount numeric(14,2) not null default 0,       -- ventas: qty × precio
  receivable numeric(14,2) not null default 0,   -- ventas: lo que el aliado debe pagar (amount − %)
  note text,
  inventory_movement_id uuid references inventory_movements(id),
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on outlet_movements (outlet_id, created_at desc);
create index on outlet_movements (business_id, created_at desc);
create index on outlet_movements (variant_id);

create table outlet_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  outlet_id uuid not null references outlets(id),
  amount numeric(14,2) not null check (amount > 0),
  method_id uuid references payment_methods(id),
  reference text,
  notes text,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on outlet_payments (outlet_id, created_at desc);

alter table outlets enable row level security;
alter table outlet_movements enable row level security;
alter table outlet_payments enable row level security;
create policy r_outlets on outlets for select using (has_perm(business_id, 'inventory.view') or has_perm(business_id, 'reports.finance'));
create policy w_outlets on outlets for all using (has_perm(business_id, 'inventory.manage')) with check (has_perm(business_id, 'inventory.manage'));
create policy r_outlet_movements on outlet_movements for select using (has_perm(business_id, 'inventory.view') or has_perm(business_id, 'reports.finance'));
create policy r_outlet_payments on outlet_payments for select using (has_perm(business_id, 'inventory.view') or has_perm(business_id, 'reports.finance'));
create trigger outlets_no_delete before delete on outlets for each row execute function forbid_delete();
create trigger outlet_movements_no_delete before delete on outlet_movements for each row execute function forbid_delete();
create trigger outlet_payments_no_delete before delete on outlet_payments for each row execute function forbid_delete();
create trigger audit_outlets after insert or update on outlets for each row execute function audit_trigger();
create trigger audit_outlet_movements after insert or update on outlet_movements for each row execute function audit_trigger();
create trigger audit_outlet_payments after insert or update on outlet_payments for each row execute function audit_trigger();

-- Unidades de una variante que están en un aliado (entregado − vendido − devuelto)
create or replace function outlet_on_hand(p_outlet uuid, p_variant uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when kind = 'delivery' then qty else -qty end), 0)
  from outlet_movements where outlet_id = p_outlet and variant_id = p_variant and status = 'active';
$$;

-- Saldo por cobrar a un aliado
create or replace function outlet_balance(p_outlet uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(receivable) from outlet_movements where outlet_id = p_outlet and kind = 'sale' and status = 'active'), 0)
       - coalesce((select sum(amount) from outlet_payments where outlet_id = p_outlet and status = 'active'), 0);
$$;

-- p_kind: 'delivery' (sale de bodega hacia el aliado), 'sale' (el aliado reporta lo vendido),
-- 'return' (el aliado devuelve sin vender; vuelve a bodega). p_items: [{variant_id, qty, unit_price?}]
create or replace function outlet_move(p_business uuid, p_outlet uuid, p_kind text, p_items jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare ol outlets%rowtype; it jsonb; v_qty numeric; v record; n int := 0; v_price numeric; v_amount numeric;
  v_inv uuid; v_has numeric;
begin
  perform require_perm(p_business, 'inventory.manage');
  select * into ol from outlets where id = p_outlet and business_id = p_business for update;
  if not found then raise exception 'Establecimiento no encontrado'; end if;
  if p_kind not in ('delivery', 'sale', 'return') then raise exception 'Movimiento no válido'; end if;
  if p_kind = 'delivery' and not ol.active then raise exception 'El establecimiento está inactivo'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agregue al menos un producto'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'Cantidad inválida'; end if;
    select pv.id, pv.stock, coalesce(pv.price, p.price) as price, p.name, p.business_unit_id, p.track_stock,
           concat_ws(' / ', pv.size, pv.color, pv.design) as label into v
    from product_variants pv join products p on p.id = pv.product_id
    where pv.id = (it->>'variant_id')::uuid and pv.business_id = p_business;
    if not found then raise exception 'Producto no encontrado'; end if;
    v_inv := null; v_price := 0; v_amount := 0;

    if p_kind = 'delivery' then
      if v.track_stock and v.stock < v_qty then
        raise exception 'No hay suficientes "%" en bodega (quedan %)', v.name, trim_scale(v.stock);
      end if;
      insert into inventory_movements (business_id, business_unit_id, variant_id, kind, qty, reason)
      values (p_business, v.business_unit_id, v.id, 'adjustment', -v_qty, 'Entrega a ' || ol.name)
      returning id into v_inv;
    else
      v_has := outlet_on_hand(p_outlet, v.id);
      if v_qty > v_has then
        raise exception '% tiene % unidades de "%"; no se pueden registrar %', ol.name, trim_scale(v_has), v.name, trim_scale(v_qty);
      end if;
      if p_kind = 'return' then
        insert into inventory_movements (business_id, business_unit_id, variant_id, kind, qty, reason)
        values (p_business, v.business_unit_id, v.id, 'return', v_qty, 'Devolución de ' || ol.name)
        returning id into v_inv;
      else
        v_price := coalesce((it->>'unit_price')::numeric, v.price);
        if v_price < 0 then raise exception 'Precio inválido'; end if;
        v_amount := round(v_qty * v_price, 2);
      end if;
    end if;

    insert into outlet_movements (business_id, outlet_id, variant_id, kind, qty, unit_price, commission_pct, amount, receivable,
                                  note, inventory_movement_id)
    values (p_business, p_outlet, v.id, p_kind, v_qty, v_price, case when p_kind = 'sale' then ol.commission_pct else 0 end,
            v_amount, case when p_kind = 'sale' then v_amount - round(v_amount * ol.commission_pct / 100, 2) else 0 end,
            nullif(trim(p_note), ''), v_inv);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function outlet_move_void(p_movement uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m outlet_movements%rowtype; im inventory_movements%rowtype;
begin
  select * into m from outlet_movements where id = p_movement for update;
  if not found then raise exception 'Movimiento no encontrado'; end if;
  perform require_perm(m.business_id, 'inventory.manage');
  if m.status <> 'active' then raise exception 'El movimiento ya está anulado'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Indique el motivo de la anulación'; end if;
  update outlet_movements set status = 'voided', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_movement;
  if outlet_on_hand(m.outlet_id, m.variant_id) < 0 then
    raise exception 'No se puede anular: el establecimiento ya reportó ventas o devoluciones de esas unidades';
  end if;
  if outlet_balance(m.outlet_id) < 0 then
    raise exception 'No se puede anular: el establecimiento ya pagó esa venta. Anule primero el pago';
  end if;
  if m.inventory_movement_id is not null then
    select * into im from inventory_movements where id = m.inventory_movement_id;
    insert into inventory_movements (business_id, business_unit_id, variant_id, kind, qty, reverses_id, reason)
    values (im.business_id, im.business_unit_id, im.variant_id, 'reversal', -im.qty, im.id, 'Anulación: ' || trim(p_reason));
  end if;
end $$;

create or replace function outlet_payment_create(p_business uuid, p_outlet uuid, p_amount numeric, p_method uuid,
  p_reference text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ol outlets%rowtype; v_method payment_methods%rowtype; v_id uuid; v_balance numeric;
begin
  perform require_perm(p_business, 'inventory.manage');
  select * into ol from outlets where id = p_outlet and business_id = p_business for update;
  if not found then raise exception 'Establecimiento no encontrado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor inválido'; end if;
  v_balance := outlet_balance(p_outlet);
  if p_amount > v_balance then
    raise exception 'El abono (%) supera lo que debe % (%)', trim_scale(p_amount), ol.name, trim_scale(v_balance);
  end if;
  select * into v_method from payment_methods where id = p_method and business_id = p_business and code <> 'points';
  if not found then raise exception 'Medio de pago no válido'; end if;
  if v_method.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception 'Este medio de pago requiere referencia';
  end if;
  insert into outlet_payments (business_id, outlet_id, amount, method_id, reference, notes)
  values (p_business, p_outlet, p_amount, p_method, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function outlet_payment_void(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare op outlet_payments%rowtype;
begin
  select * into op from outlet_payments where id = p_payment for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  perform require_perm(op.business_id, 'inventory.manage');
  if op.status <> 'active' then raise exception 'El pago ya está anulado'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Indique el motivo de la anulación'; end if;
  update outlet_payments set status = 'voided', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_payment;
end $$;

-- Resumen de aliados: unidades en cada uno, ventas reportadas, por cobrar y cobrado
create or replace function outlet_summary(p_business uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f timestamptz := coalesce(p_from, '-infinity'); t timestamptz := coalesce(p_to, 'infinity'); v jsonb;
begin
  if not (has_perm(p_business, 'inventory.view') or has_perm(p_business, 'reports.finance')) then
    raise exception 'Permiso requerido: inventory.view' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x.name), '[]') into v from (
    select ol.id, ol.name, ol.contact_name, ol.phone, ol.address, ol.commission_pct, ol.notes, ol.active,
      coalesce(sum(m.qty) filter (where m.kind = 'delivery'), 0) as delivered,
      coalesce(sum(m.qty) filter (where m.kind = 'sale'), 0) as sold,
      coalesce(sum(m.qty) filter (where m.kind = 'return'), 0) as returned,
      coalesce(sum(case when m.kind = 'delivery' then m.qty else -m.qty end), 0) as on_hand,
      coalesce(sum(m.amount) filter (where m.kind = 'sale'), 0) as sales_total,
      coalesce(sum(m.receivable) filter (where m.kind = 'sale'), 0) as receivable_total,
      coalesce(sum(m.amount) filter (where m.kind = 'sale' and m.created_at >= f and m.created_at < t), 0) as sales_range,
      coalesce(sum(m.receivable) filter (where m.kind = 'sale' and m.created_at >= f and m.created_at < t), 0) as receivable_range,
      coalesce((select sum(amount) from outlet_payments where outlet_id = ol.id and status = 'active'), 0) as paid_total,
      outlet_balance(ol.id) as balance
    from outlets ol left join outlet_movements m on m.outlet_id = ol.id and m.status = 'active'
    where ol.business_id = p_business
    group by ol.id) x;
  return v;
end $$;

-- Detalle de un aliado: existencias por producto, movimientos y pagos
create or replace function outlet_detail(p_outlet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ol outlets%rowtype;
begin
  select * into ol from outlets where id = p_outlet;
  if not found then raise exception 'Establecimiento no encontrado'; end if;
  if not (has_perm(ol.business_id, 'inventory.view') or has_perm(ol.business_id, 'reports.finance')) then
    raise exception 'Permiso requerido: inventory.view' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'outlet', to_jsonb(ol), 'balance', outlet_balance(ol.id),
    'stock', (select coalesce(jsonb_agg(x order by x.product, x.variant), '[]') from (
      select pv.id as variant_id, p.name as product, concat_ws(' / ', pv.size, pv.color, pv.design) as variant,
             coalesce(pv.price, p.price) as price,
             sum(m.qty) filter (where m.kind = 'delivery') as delivered,
             coalesce(sum(m.qty) filter (where m.kind = 'sale'), 0) as sold,
             coalesce(sum(m.qty) filter (where m.kind = 'return'), 0) as returned,
             sum(case when m.kind = 'delivery' then m.qty else -m.qty end) as on_hand
      from outlet_movements m join product_variants pv on pv.id = m.variant_id join products p on p.id = pv.product_id
      where m.outlet_id = ol.id and m.status = 'active'
      group by pv.id, p.name, pv.size, pv.color, pv.design, pv.price, p.price) x),
    'movements', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
      select m.id, m.kind, m.qty, m.unit_price, m.commission_pct, m.amount, m.receivable, m.note, m.status, m.void_reason,
             m.created_at, p.name as product, concat_ws(' / ', pv.size, pv.color, pv.design) as variant
      from outlet_movements m join product_variants pv on pv.id = m.variant_id join products p on p.id = pv.product_id
      where m.outlet_id = ol.id order by m.created_at desc limit 300) x),
    'payments', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
      select op.id, op.amount, op.reference, op.notes, op.status, op.void_reason, op.created_at, pm.name as method
      from outlet_payments op left join payment_methods pm on pm.id = op.method_id
      where op.outlet_id = ol.id) x)
  );
end $$;

-- ---------------------------------------------------------------------
-- Crear un negocio adicional desde la app (p. ej. Mi Tierra como marca propia)
-- ---------------------------------------------------------------------
create or replace function create_extra_business(p_name text, p_slug text, p_profile text default 'brand')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_admin text;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode = '42501'; end if;
  -- Solo quien ya administra un negocio puede crear otro
  if not exists (select 1 from members m join roles r on r.id = m.role_id
                 where m.user_id = auth.uid() and m.active and r.code = 'admin') then
    raise exception 'Solo un administrador puede crear otro negocio' using errcode = '42501';
  end if;
  if p_profile not in ('restaurant', 'brand') then raise exception 'Tipo de negocio no válido'; end if;
  select m.full_name into v_admin from members m join roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.active and r.code = 'admin' order by m.created_at limit 1;
  v_id := bootstrap_business(p_name, p_slug, coalesce(v_admin, 'Administrador'));
  update businesses set profile = p_profile where id = v_id;
  if p_profile = 'brand' then
    -- Una marca no usa cocina ni mesas: se desactivan las categorías de comida
    update categories set active = false
    where business_id = v_id and business_unit_id = unit_id(v_id, 'gastronomy');
    insert into categories (business_id, business_unit_id, name, slug, sort) values
      (v_id, unit_id(v_id, 'shop'), 'Camisas', 'camisas', 1),
      (v_id, unit_id(v_id, 'shop'), 'Bolsos', 'bolsos', 2)
    on conflict (business_id, slug) do nothing;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on function supplier_balance(uuid), consignment_pending(uuid, uuid),
  consignment_move(uuid, uuid, text, jsonb, text),
  supplier_payment_create(uuid, uuid, numeric, uuid, uuid, text, text), supplier_payment_void(uuid, text, uuid),
  consignment_summary(uuid, timestamptz, timestamptz), consignment_detail(uuid),
  outlet_on_hand(uuid, uuid), outlet_balance(uuid), outlet_move(uuid, uuid, text, jsonb, text), outlet_move_void(uuid, text),
  outlet_payment_create(uuid, uuid, numeric, uuid, text, text), outlet_payment_void(uuid, text),
  outlet_summary(uuid, timestamptz, timestamptz), outlet_detail(uuid), create_extra_business(text, text, text)
  from public, anon;
grant execute on function consignment_move(uuid, uuid, text, jsonb, text),
  supplier_payment_create(uuid, uuid, numeric, uuid, uuid, text, text), supplier_payment_void(uuid, text, uuid),
  consignment_summary(uuid, timestamptz, timestamptz), consignment_detail(uuid),
  outlet_move(uuid, uuid, text, jsonb, text), outlet_move_void(uuid, text),
  outlet_payment_create(uuid, uuid, numeric, uuid, text, text), outlet_payment_void(uuid, text),
  outlet_summary(uuid, timestamptz, timestamptz), outlet_detail(uuid), create_extra_business(text, text, text)
  to authenticated;
revoke execute on function supplier_balance(uuid), consignment_pending(uuid, uuid),
  outlet_on_hand(uuid, uuid), outlet_balance(uuid) from authenticated;

-- ---------------------------------------------------------------------
-- RUPÍCOLA: Mi Tierra pasa a ser un proveedor en consignación (10 %, visible en el dashboard)
-- y la unidad de tienda vuelve a llamarse "Tienda", porque ahí se venden todos los proveedores.
-- ---------------------------------------------------------------------
do $$
declare r record; v_sup uuid;
begin
  for r in select bu.id as unit_id, bu.business_id, b.shop_commission_pct
           from business_units bu join businesses b on b.id = bu.business_id
           where bu.kind = 'shop' and lower(bu.name) = 'mi tierra' loop
    select id into v_sup from suppliers where business_id = r.business_id and lower(name) = 'mi tierra';
    if v_sup is null then
      insert into suppliers (business_id, name, is_consignment, commission_pct, show_in_dashboard, notes)
      values (r.business_id, 'Mi Tierra', true, coalesce(nullif(r.shop_commission_pct, 0), 10), true,
              'Marca de los mismos dueños. Se le paga lo vendido menos la comisión.')
      returning id into v_sup;
    else
      update suppliers set is_consignment = true, show_in_dashboard = true,
        commission_pct = coalesce(nullif(r.shop_commission_pct, 0), 10) where id = v_sup;
    end if;
    update products set consignment_supplier_id = v_sup
    where business_id = r.business_id and business_unit_id = r.unit_id and consignment_supplier_id is null;
    update business_units set name = 'Tienda' where id = r.unit_id;
  end loop;
end $$;

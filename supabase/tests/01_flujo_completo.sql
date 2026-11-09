-- Prueba de extremo a extremo del motor de RUPÍCOLA (se ejecuta sobre
-- PostgreSQL con 00_stub_supabase.sql). Falla con excepción si algo no cuadra.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false); $$;
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALLÓ: %', msg; end if; raise notice 'ok · %', msg; end $$;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'admin@rupicola.test'),
  ('00000000-0000-0000-0000-00000000000c', 'cocina@rupicola.test'),
  ('00000000-0000-0000-0000-00000000000d', 'domi@rupicola.test'),
  ('00000000-0000-0000-0000-00000000000e', 'mesero@rupicola.test'),
  ('00000000-0000-0000-0000-0000000000ff', 'otro@negocio.test');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select bootstrap_business('RUPÍCOLA', 'rupicola', 'Admin General') \gset biz_
reset role;

-- Contexto en variables
select id as b from businesses where slug = 'rupicola' \gset
select id as gastro from business_units where business_id = :'b' and kind = 'gastronomy' \gset
select id as shop from business_units where business_id = :'b' and kind = 'shop' \gset

-- Personal
insert into members (business_id, user_id, role_id, full_name)
select :'b', '00000000-0000-0000-0000-00000000000c', id, 'Carla Cocina' from roles where business_id = :'b' and code = 'cook';
insert into members (business_id, user_id, role_id, full_name)
select :'b', '00000000-0000-0000-0000-00000000000d', id, 'Diego Domi' from roles where business_id = :'b' and code = 'courier';
insert into members (business_id, user_id, role_id, full_name)
select :'b', '00000000-0000-0000-0000-00000000000e', id, 'Mario Mesero' from roles where business_id = :'b' and code = 'waiter';

set role authenticated;
-- Catálogo (como admin, vía RLS)
insert into ingredients (business_id, business_unit_id, name, unit, min_stock) values
  (:'b', :'gastro', 'Pan brioche', 'und', 5), (:'b', :'gastro', 'Carne 150g', 'und', 5),
  (:'b', :'gastro', 'Queso cheddar', 'tajada', 5), (:'b', :'gastro', 'Café en grano', 'g', 500);
select id as pan from ingredients where name = 'Pan brioche' \gset
select id as carne from ingredients where name = 'Carne 150g' \gset
select id as queso from ingredients where name = 'Queso cheddar' \gset
select id as cafeg from ingredients where name = 'Café en grano' \gset

insert into products (business_id, business_unit_id, category_id, name, price, stock_mode, sku)
select :'b', :'gastro', id, 'Hamburguesa Rupícola', 28000, 'recipe', 'HAM-01' from categories where business_id = :'b' and slug = 'hamburguesas';
insert into products (business_id, business_unit_id, category_id, name, price, stock_mode, sku)
select :'b', :'gastro', id, 'Café americano', 8000, 'recipe', 'CAF-01' from categories where business_id = :'b' and slug = 'cafeteria';
insert into products (business_id, business_unit_id, category_id, name, price, stock_mode, sku)
select :'b', :'shop', id, 'Camisa Rupícola', 55000, 'variant', 'CAM-01' from categories where business_id = :'b' and slug = 'camisas-personalizadas';
select id as ham from products where sku = 'HAM-01' \gset
select id as cafe from products where sku = 'CAF-01' \gset
select id as camisa from products where sku = 'CAM-01' \gset

insert into recipe_items (business_id, product_id, ingredient_id, qty) values
  (:'b', :'ham', :'pan', 1), (:'b', :'ham', :'carne', 1), (:'b', :'ham', :'queso', 1), (:'b', :'cafe', :'cafeg', 18);
insert into modifier_groups (business_id, product_id, name) values (:'b', :'ham', 'Personaliza');
select id as grp from modifier_groups where product_id = :'ham' \gset
insert into modifier_options (business_id, group_id, name, price_delta, ingredient_id, ingredient_qty) values
  (:'b', :'grp', 'Extra queso', 3000, :'queso', 1), (:'b', :'grp', 'Sin cebolla', 0, null, 0);
select id as extra from modifier_options where name = 'Extra queso' \gset
insert into product_variants (business_id, product_id, sku, size, color, design, cost)
values (:'b', :'camisa', 'CAM-01-M-NEG', 'M', 'Negro', 'Gallito', 0), (:'b', :'camisa', 'CAM-01-L-NEG', 'L', 'Negro', 'Gallito', 0);
select id as cam_m from product_variants where sku = 'CAM-01-M-NEG' \gset

-- Compra que alimenta inventario
insert into suppliers (business_id, name) values (:'b', 'Distribuidora Andina');
select id as sup from suppliers where name = 'Distribuidora Andina' \gset
select purchase_create(:'b', :'gastro', :'sup', jsonb_build_array(
  jsonb_build_object('ingredient_id', :'pan', 'qty', 20, 'unit_cost', 1200),
  jsonb_build_object('ingredient_id', :'carne', 'qty', 20, 'unit_cost', 6000),
  jsonb_build_object('ingredient_id', :'queso', 'qty', 40, 'unit_cost', 800),
  jsonb_build_object('ingredient_id', :'cafeg', 'qty', 1000, 'unit_cost', 60)), 'FV-100', current_date, null, null, true);
insert into suppliers (business_id, name) values (:'b', 'Textiles Bogotá');
select id as sup2 from suppliers where name = 'Textiles Bogotá' \gset
select purchase_create(:'b', :'shop', :'sup2', jsonb_build_array(
  jsonb_build_object('variant_id', :'cam_m', 'qty', 5, 'unit_cost', 20000)), 'TX-1', current_date, null, null, true);

select pg_temp.check((select stock from ingredients where id = :'pan') = 20, 'compra suma 20 panes');
select pg_temp.check((select stock from product_variants where id = :'cam_m') = 5 and (select cost from product_variants where id = :'cam_m') = 20000, 'compra suma 5 camisas M y fija costo');

-- Caja
select cash_open((select id from cash_registers where business_id = :'b'), 100000) as sess \gset

-- ===== Venta mixta del ejemplo: hamburguesa 28.000 + café 8.000 + camisa 55.000 = 91.000
select pos_create_order(:'b', 'counter', jsonb_build_array(
  jsonb_build_object('product_id', :'ham', 'qty', 1, 'notes', 'Carne bien cocida'),
  jsonb_build_object('product_id', :'cafe', 'qty', 1),
  jsonb_build_object('product_id', :'camisa', 'variant_id', :'cam_m', 'qty', 1))) as o1 \gset

select pg_temp.check((select total from orders where id = :'o1') = 91000, 'total 91.000');
select pg_temp.check((select count(*) from kds_tickets where order_id = :'o1') = 2, 'dos tickets: cocina y cafetería');
select pg_temp.check((select station_id is null and ticket_id is null from order_items where order_id = :'o1' and product_id = :'camisa'), 'la camisa no va a cocina');

select pos_register_payments(:'o1', jsonb_build_array(
  jsonb_build_object('method_id', (select id from payment_methods where business_id = :'b' and code = 'cash'), 'amount', 40000, 'received_amount', 50000),
  jsonb_build_object('method_id', (select id from payment_methods where business_id = :'b' and code = 'debit'), 'amount', 51000)), :'sess') as res \gset
select pg_temp.check((:'res'::jsonb->>'finalized')::boolean and (:'res'::jsonb->>'change')::numeric = 10000, 'pagado con vueltas de 10.000');

select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o1' and business_unit_id = :'gastro') = 36000, 'ingreso gastronomía 36.000');
select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o1' and business_unit_id = :'shop') = 55000, 'ingreso tienda 55.000');
select pg_temp.check((select sum(amount) from payment_allocations where order_id = :'o1' and business_unit_id = :'gastro') = 36000, 'pagos asignados a gastronomía 36.000');
select pg_temp.check((select sum(amount) from payment_allocations where order_id = :'o1' and business_unit_id = :'shop') = 55000, 'pagos asignados a tienda 55.000');
select pg_temp.check((select sum(amount) from cash_movements where order_id = :'o1') = 91000, 'caja registra 91.000 por unidad y método');
select pg_temp.check((select stock from product_variants where id = :'cam_m') = 4, 'descuenta camisa M (queda 4)');
select pg_temp.check((select stock from ingredients where id = :'pan') = 19 and (select stock from ingredients where id = :'cafeg') = 982, 'descuenta receta: pan y 18 g de café');
select pg_temp.check((select sum(cost) from revenue_entries where order_id = :'o1' and business_unit_id = :'shop') = 20000, 'costo de la camisa 20.000');

-- Pago que excede el saldo es rechazado
do $$ begin
  perform pos_register_payments((select id from orders where number = 1), '[{"method_id":"00000000-0000-0000-0000-000000000000","amount":1}]', null);
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · bloquea pago sobre pedido cerrado (%)', sqlerrm; end $$;

-- Mesas + QR
insert into dining_tables (business_id, number) values (:'b', 1), (:'b', 2);
select qr_token as tok, id as mesa1 from dining_tables where business_id = :'b' and number = 1 \gset
reset role;
select pg_temp.as_user(null);
set role anon;
select public_table(:'tok') is not null as ok_table;
select (public_menu('rupicola')->'products') is not null as ok_menu;
select qr_place_order(:'tok', jsonb_build_array(jsonb_build_object('product_id', :'ham', 'qty', 2, 'option_ids', jsonb_build_array(:'extra'), 'notes', 'Sin tomate')), 'Laura') as qr \gset
select qr_service_request(:'tok', 'call_waiter', 'Por favor');
reset role;
select (:'qr'::jsonb->>'order_id') as o2 \gset
select pg_temp.check((select total from orders where id = :'o2') = 62000, 'QR: 2 hamburguesas con extra queso = 62.000');
select pg_temp.check((select status from dining_tables where id = :'mesa1') = 'needs_attention', 'mesa solicita atención');

-- Cocina procesa (permiso kds.kitchen)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select id as t2 from kds_tickets where order_id = :'o2' \gset
select pg_temp.check((select count(*) from kds_tickets where status = 'received') >= 1, 'cocinero ve sus tickets');
select kds_update_ticket(:'t2', 'accepted');
select kds_update_ticket(:'t2', 'preparing');
select kds_update_ticket(:'t2', 'ready');
do $$ begin
  perform pos_register_payments((select id from orders where number = 2), '[]', null);
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · cocinero no puede cobrar (%)', sqlerrm; end $$;
reset role;
select pg_temp.check((select status from orders where id = :'o2') = 'ready', 'pedido QR listo');
select pg_temp.check((select count(*) from notifications where kind = 'order_ready' and data->>'order_id' = :'o2') = 1, 'notifica al mesero');
select pg_temp.check((select stock from ingredients where id = :'queso') = 39, 'política al pagar: aún no descuenta el pedido QR');

-- Mesero atiende solicitud y entrega
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set role authenticated;
select service_request_attend((select id from service_requests where table_id = :'mesa1' and status = 'open'));
select kds_update_ticket(:'t2', 'delivered');
reset role;
select pg_temp.check((select status from dining_tables where id = :'mesa1') = 'occupied', 'mesa ocupada tras entregar');

-- Admin: dividir cuenta, propina y cobro con transferencia (requiere referencia)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select pos_add_items(:'o2', jsonb_build_array(jsonb_build_object('product_id', :'camisa', 'variant_id', :'cam_m', 'qty', 1)), true);
select pos_split_order(:'o2', array(select id from order_items where order_id = :'o2' and product_id = :'camisa')) as o3 \gset
select pg_temp.check((select total from orders where id = :'o2') = 62000 and (select total from orders where id = :'o3') = 55000, 'cuenta dividida 62.000 / 55.000');
select pos_set_tip(:'o2', 6200);
do $$ begin
  perform pos_register_payments((select id from orders where number = 2),
    jsonb_build_array(jsonb_build_object('method_id', (select id from payment_methods where code = 'transfer'), 'amount', 68200)), null);
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · transferencia exige referencia (%)', sqlerrm; end $$;
select pos_register_payments(:'o2', jsonb_build_array(jsonb_build_object('method_id', (select id from payment_methods where code = 'transfer'), 'amount', 68200, 'reference', 'TRX-889')), :'sess');
select pg_temp.check((select stock from ingredients where id = :'queso') = 40 - 1 - 4, 'al pagar, extra queso descuenta 2 tajadas por hamburguesa');
select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o2' and concept = 'tip') = 6200, 'propina separada de ingresos');
select pg_temp.check((select status from dining_tables where id = :'mesa1') = 'occupied', 'mesa sigue ocupada por la cuenta dividida');
select pos_register_payments(:'o3', jsonb_build_array(jsonb_build_object('method_id', (select id from payment_methods where code = 'credit'), 'amount', 55000)), :'sess');
select pg_temp.check((select status from dining_tables where id = :'mesa1') = 'available', 'mesa liberada al pagar todo');

-- Reverso de pago con motivo: revierte ingresos
select payment_void((select id from payments where order_id = :'o3'), 'Cliente pagó con otra tarjeta');
select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o3') = 0, 'reverso deja ingreso neto en 0');
select pos_register_payments(:'o3', jsonb_build_array(jsonb_build_object('method_id', (select id from payment_methods where code = 'debit'), 'amount', 55000)), :'sess');
select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o3') = 55000, 'nuevo pago reconoce de nuevo 55.000');

-- No se puede borrar una venta (RLS no lo permite; y aun como dueño, el trigger lo bloquea)
delete from payments where true;
select pg_temp.check((select count(*) from payments) = 5, 'usuario no puede borrar pagos');
reset role;
do $$ begin
  delete from payments where true;
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · ni el superusuario borra pagos (%)', sqlerrm; end $$;
set role authenticated;

-- ===== Domicilio desde casa
insert into delivery_zones (business_id, name, fee, center_lat, center_lng, radius_km) values (:'b', 'Centro', 5000, 4.6097, -74.0817, 3);
update payment_methods set available_online = true where business_id = :'b' and code = 'cash';
select id as cashpm from payment_methods where business_id = :'b' and code = 'cash' \gset
reset role;
select pg_temp.as_user(null);
set role anon;
select shop_place_order('rupicola', jsonb_build_object(
  'customer', jsonb_build_object('full_name', 'Ana Pérez', 'phone', '300 123 4567'),
  'fulfillment', 'delivery',
  'address', jsonb_build_object('address', 'Cra 7 # 12-34', 'details', 'Apto 501', 'lat', 4.6100, 'lng', -74.0800),
  'payment_method_id', :'cashpm',
  'items', jsonb_build_array(jsonb_build_object('product_id', :'cafe', 'qty', 2),
                             jsonb_build_object('product_id', :'camisa', 'variant_id', :'cam_m', 'qty', 1)))) as d \gset
select set_config('t.cashpm', :'cashpm', false);
select set_config('t.cafe', :'cafe', false);
do $$ begin
  perform shop_place_order('rupicola', jsonb_build_object(
    'customer', jsonb_build_object('full_name', 'Lejos', 'phone', '3009999999'), 'fulfillment', 'delivery',
    'address', jsonb_build_object('address', 'Chía', 'lat', 4.86, 'lng', -74.05),
    'payment_method_id', current_setting('t.cashpm'),
    'items', jsonb_build_array(jsonb_build_object('product_id', current_setting('t.cafe'), 'qty', 1))));
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · fuera de cobertura (%)', sqlerrm; end $$;
select public_track(:'d'::jsonb->>'tracking_token')->'delivery'->>'status' as track_status;
reset role;
select (:'d'::jsonb->>'order_id') as o4 \gset
select id as dl from deliveries where order_id = :'o4' \gset
select pg_temp.check((select total from orders where id = :'o4') = 16000 + 55000 + 5000, 'domicilio: productos + 5.000 de envío');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select delivery_confirm(:'dl');
select delivery_assign(:'dl', (select id from members where full_name = 'Diego Domi'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
-- Cafetería: el cocinero NO tiene kds.cafe
set role authenticated;
do $$ begin
  perform kds_update_ticket((select id from kds_tickets where order_id = (select id from orders where number = 4)), 'accepted');
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · cocina no opera tickets de cafetería (%)', sqlerrm; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select kds_update_ticket((select id from kds_tickets where order_id = :'o4'), 'preparing');
select pg_temp.check((select status from deliveries where id = :'dl') = 'preparing', 'domicilio en preparación');
select kds_update_ticket((select id from kds_tickets where order_id = :'o4'), 'ready');
select pg_temp.check((select status from deliveries where id = :'dl') = 'courier_assigned', 'listo con domiciliario asignado');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select pg_temp.check((select count(*) from deliveries) = 1, 'domiciliario solo ve lo asignado');
select courier_update(:'dl', 'picked_up');
select courier_update(:'dl', 'on_the_way');
do $$ begin
  perform courier_update((select id from deliveries limit 1), 'delivered', null, null, 1000);
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · exige cobro completo (%)', sqlerrm; end $$;
select courier_update(:'dl', 'delivered', 'Recibió portería', null, 80000);
reset role;
select pg_temp.check((select status from orders where id = :'o4') = 'paid', 'domicilio pagado al entregar');
select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o4' and business_unit_id = :'gastro') = 21000, 'gastronomía: 16.000 + 5.000 de envío');
select pg_temp.check((select count(*) from delivery_events where delivery_id = :'dl') >= 7, 'línea de tiempo del domicilio registrada');
select pg_temp.check((select count(*) from notification_outbox where order_id = :'o4') >= 5, 'mensajes de estado encolados para WhatsApp');

-- ===== Gastos, resultados y reportes
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select expense_create(:'b', (select id from expense_categories where code = 'rent'), 'shared', 'Arriendo octubre', 3000000, current_date);
select pg_temp.check((select amount from expense_allocations ea join business_units bu on bu.id = ea.business_unit_id where bu.kind = 'gastronomy') = 2100000, 'gasto compartido 70/30');
select dashboard_summary(:'b', current_date - 7, current_date) as dash \gset
select pg_temp.check((:'dash'::jsonb->>'sales_range')::numeric = 91000 + 62000 + 55000 + 76000, 'dashboard suma ventas sin propinas');
select unit_results(:'b', current_date - 30, current_date) as ur \gset
\echo :ur
select jsonb_array_length(report_rows(:'b', 'sales_by_product', current_date - 1, current_date)) > 0 as rep_ok;
select cash_close(:'sess', 100000 + 40000) as cierre \gset
\echo :cierre

-- ===== Fase 2: comisión Mi Tierra, camisas sin existencias, puntos, gastos con medio de pago
reset role;
update businesses set shop_commission_pct = 10, loyalty_enabled = true, loyalty_points_per_1000 = 1,
  loyalty_point_value = 10, loyalty_min_redeem = 100 where id = :'b';
update business_units set name = 'Rupícola' where id = :'gastro';
update business_units set name = 'Tienda' where id = :'shop';
-- Solo para las pruebas: las funciones internas de saldo se consultan directamente
select pg_temp.check(not has_function_privilege('authenticated', 'supplier_balance(uuid)', 'execute'), 'saldos internos no son invocables por usuarios');
grant execute on function supplier_balance(uuid), consignment_pending(uuid, uuid), outlet_on_hand(uuid, uuid), outlet_balance(uuid) to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select cash_open((select id from cash_registers where business_id = :'b'), 50000) as sess2 \gset
insert into products (business_id, business_unit_id, category_id, name, price, stock_mode, sku, track_stock)
select :'b', :'shop', id, 'Camisa Mi Tierra', 60000, 'variant', 'MT-01', false from categories where business_id = :'b' and slug = 'camisas-personalizadas';
select id as mt from products where sku = 'MT-01' \gset
insert into product_variants (business_id, product_id, sku, size, color, design, cost) values (:'b', :'mt', 'MT-01-S', 'S', 'Blanco', 'Colibrí', 0);
select id as mt_s from product_variants where sku = 'MT-01-S' \gset
-- Mi Tierra es un proveedor en consignación con 10 % de comisión para Rupícola
insert into suppliers (business_id, name, is_consignment, commission_pct, show_in_dashboard)
values (:'b', 'Mi Tierra', true, 10, true);
select id as sup_mt from suppliers where business_id = :'b' and name = 'Mi Tierra' \gset
update products set consignment_supplier_id = :'sup_mt' where id = :'mt';
select consignment_move(:'b', :'sup_mt', 'receive', jsonb_build_array(jsonb_build_object('variant_id', :'mt_s', 'qty', 10)), 'Entrega inicial');
select pg_temp.check(consignment_pending(:'sup_mt', :'mt_s') = 10, 'consignación: recibe 10 camisas de Mi Tierra');
select pg_temp.check((select (p->>'is_available')::boolean from jsonb_array_elements(public_menu('rupicola')->'products') p where p->>'id' = :'mt') and (select (v->>'available')::boolean from jsonb_array_elements(public_menu('rupicola')->'products') p, jsonb_array_elements(p->'variants') v where p->>'id' = :'mt'), 'camisa sin control de existencias aparece disponible en el menú');
insert into customers (business_id, full_name, phone, points) values (:'b', 'Lucía Puntos', '3105550000', 150);
select id as cli from customers where phone = '3105550000' \gset

-- Hamburguesa 28.000 + camisa Mi Tierra 60.000 (sin existencias) = 88.000
select pos_create_order(:'b', 'counter', jsonb_build_array(
  jsonb_build_object('product_id', :'ham', 'qty', 1),
  jsonb_build_object('product_id', :'mt', 'variant_id', :'mt_s', 'qty', 1)), null, :'cli') as o5 \gset
select pg_temp.check((select commission_pct from order_items where order_id = :'o5' and product_id = :'mt') = 10
  and (select consignment_supplier_id from order_items where order_id = :'o5' and product_id = :'mt') = :'sup_mt', 'la línea de camisa guarda proveedor y comisión del 10 %');
do $$ begin
  perform pos_redeem_points((select id from orders where customer_id = (select id from customers where phone = '3105550000')), 50);
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · bloquea canje bajo el mínimo (%)', sqlerrm; end $$;
select pos_redeem_points(:'o5', 120) as red \gset
select pg_temp.check((:'red'::jsonb->>'value')::numeric = 1200 and (select points from customers where id = :'cli') = 30, 'canje: 120 puntos = $1.200, quedan 30');
select pos_register_payments(:'o5', jsonb_build_array(
  jsonb_build_object('method_id', (select id from payment_methods where business_id = :'b' and code = 'cash'), 'amount', 40000, 'received_amount', 40000),
  jsonb_build_object('method_id', (select id from payment_methods where business_id = :'b' and code = 'transfer'), 'amount', 46800, 'reference', 'TR-998877')), :'sess2') as res5 \gset
select pg_temp.check((:'res5'::jsonb->>'finalized')::boolean, 'pedido con puntos + efectivo + transferencia queda pagado');
select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o5' and business_unit_id = :'shop') = 60000
  and (select sum(cost) from revenue_entries where order_id = :'o5' and business_unit_id = :'shop') = 54000, 'tienda vende 60.000 con costo 54.000 (lo de Mi Tierra): utilidad 6.000');
select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o5' and business_unit_id = :'gastro') = 28000, 'gastronomía: 28.000');
select pg_temp.check((select sum(amount) from payment_allocations where order_id = :'o5' and business_unit_id = :'shop') = 60000, 'pagos asignados a la tienda 60.000');
select pg_temp.check(supplier_balance(:'sup_mt') = 54000, 'por pagar a Mi Tierra: 54.000');
select pg_temp.check(consignment_pending(:'sup_mt', :'mt_s') = 9, 'quedan 9 camisas pendientes por vender');
select pg_temp.check((select points from customers where id = :'cli') = 30 + 86, 'gana puntos solo sobre lo pagado en dinero (86.800 → 86)');
select pos_create_order(:'b', 'counter', jsonb_build_array(jsonb_build_object('product_id', :'cafe', 'qty', 1))) as o6 \gset
select set_config('test.o6', :'o6', false);
do $$ begin
  perform pos_register_payments(current_setting('test.o6')::uuid, jsonb_build_array(jsonb_build_object('method_id', (select id from payment_methods where code = 'points'), 'amount', 1)), null);
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · no se paga con puntos por el cobro normal (%)', sqlerrm; end $$;

-- Reverso del pago con puntos: devuelve los puntos y quita los ganados
select payment_void((select p.id from payments p join payment_methods m on m.id = p.method_id where p.order_id = :'o5' and m.code = 'points'), 'Prueba de reverso');
select pg_temp.check((select points from customers where id = :'cli') = 150, 'reverso devuelve 120 puntos y descuenta los 86 ganados');
select pg_temp.check((select count(*) from loyalty_movements where customer_id = :'cli') = 4, 'historial de puntos: canje, ganados, devolución y reverso');

select pg_temp.check(not (select finalized from orders where id = :'o5'), 'pedido vuelve a quedar con saldo pendiente');
select pos_register_payments(:'o5', jsonb_build_array(
  jsonb_build_object('method_id', (select id from payment_methods where business_id = :'b' and code = 'cash'), 'amount', 1200, 'received_amount', 2000)), :'sess2');
select pg_temp.check((select sum(amount) from revenue_entries where order_id = :'o5' and business_unit_id = :'gastro') = 28000 and (select sum(amount) from revenue_entries where order_id = :'o5' and business_unit_id = :'shop') = 60000
  and supplier_balance(:'sup_mt') = 54000, 'al completar el pago de nuevo: gastronomía 28.000, tienda 60.000 y Mi Tierra por pagar 54.000');

-- Gasto con medio de pago (100 % Rupícola)
select expense_create(:'b', (select id from expense_categories where code = 'rent' and business_id = :'b'), 'gastronomy', 'Gas', 20000, current_date,
  null, :'sess2', null, null, (select id from payment_methods where business_id = :'b' and code = 'transfer')) as gx \gset
select pg_temp.check((select m.code from expenses e join payment_methods m on m.id = e.method_id where e.id = :'gx') = 'transfer', 'gasto guarda el medio de pago');

select cash_session_summary(:'sess2') as cs \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'cs'::jsonb->'by_unit_method') x where x->>'unit' = 'Tienda'), 'caja muestra la tienda por medio de pago');
\echo :cs
select report_rows(:'b', 'commissions', current_date - 1, current_date) as com \gset
\echo :com
select pg_temp.check((select sum((x->>'comision')::numeric) from jsonb_array_elements(:'com'::jsonb) x) = 6000, 'liquidación Mi Tierra: comisión 6.000');
select dashboard_summary(:'b', current_date - 7, current_date) as dash2 \gset
select pg_temp.check(jsonb_array_length(:'dash2'::jsonb->'by_unit_method') > 0, 'dashboard por negocio y medio de pago');
select pg_temp.check((select (x->>'balance')::numeric = 54000 and (x->>'sales_range')::numeric = 60000 and (x->>'owed_range')::numeric = 54000
  from jsonb_array_elements(:'dash2'::jsonb->'featured_suppliers') x where x->>'name' = 'Mi Tierra'), 'dashboard: tarjeta de Mi Tierra con 54.000 por pagar');

-- ===== Fase 3: consignación (devoluciones, pagos y anulaciones)
select consignment_move(:'b', :'sup_mt', 'return', jsonb_build_array(jsonb_build_object('variant_id', :'mt_s', 'qty', 2)));
select pg_temp.check(consignment_pending(:'sup_mt', :'mt_s') = 7, 'devuelve 2 a Mi Tierra: quedan 7');
select set_config('test.sup_mt', :'sup_mt', false), set_config('test.mt_s', :'mt_s', false), set_config('test.b', :'b', false);
do $$ begin
  perform consignment_move(current_setting('test.b')::uuid, current_setting('test.sup_mt')::uuid, 'return',
    jsonb_build_array(jsonb_build_object('variant_id', current_setting('test.mt_s'), 'qty', 8)));
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · no devuelve más de lo pendiente (%)', sqlerrm; end $$;
do $$ begin
  perform supplier_payment_create(current_setting('test.b')::uuid, current_setting('test.sup_mt')::uuid, 60000,
    (select id from payment_methods where business_id = current_setting('test.b')::uuid and code = 'cash'));
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · no paga más de lo que se debe (%)', sqlerrm; end $$;
select supplier_payment_create(:'b', :'sup_mt', 20000, (select id from payment_methods where business_id = :'b' and code = 'cash'), :'sess2', null, 'Abono') as sp1 \gset
select pg_temp.check(supplier_balance(:'sup_mt') = 34000, 'abono de 20.000: quedan 34.000 por pagar');
select pg_temp.check((select amount from cash_movements where session_id = :'sess2' and description = 'Pago a proveedor Mi Tierra') = -20000, 'el abono sale de la caja');
select consignment_summary(:'b') as csum \gset
select pg_temp.check((select (x->>'received')::numeric = 10 and (x->>'returned')::numeric = 2 and (x->>'sold')::numeric = 1
  and (x->>'pending_units')::numeric = 7 and (x->>'owed_total')::numeric = 54000 and (x->>'paid_total')::numeric = 20000
  and (x->>'balance')::numeric = 34000 from jsonb_array_elements(:'csum'::jsonb) x where x->>'name' = 'Mi Tierra'), 'resumen: recibido 10, devuelto 2, vendido 1, pendiente 7, debe 34.000');
select supplier_payment_void(:'sp1', 'Pago duplicado', :'sess2');
select pg_temp.check(supplier_balance(:'sup_mt') = 54000, 'anular el abono vuelve a dejar 54.000 por pagar');
select report_rows(:'b', 'consignment', current_date - 1, current_date) as crep \gset
select pg_temp.check((select (x->>'a_pagar')::numeric = 54000 and (x->>'existencia')::numeric = 7 from jsonb_array_elements(:'crep'::jsonb) x where x->>'proveedor' = 'Mi Tierra'), 'reporte de consignación: a pagar 54.000, quedan 7');
select pg_temp.check(jsonb_array_length(consignment_detail(:'sup_mt')->'payments') = 1 and (consignment_detail(:'sup_mt')->>'balance')::numeric = 54000, 'detalle del proveedor con pagos');
reset role;

-- ===== Fase 3: Mi Tierra como marca con establecimientos aliados
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select create_extra_business('Mi Tierra', 'mi-tierra', 'brand') as bmt \gset
select pg_temp.check((select profile from businesses where id = :'bmt') = 'brand', 'Mi Tierra creada como marca');
select pg_temp.check(not exists (select 1 from categories where business_id = :'bmt' and active and business_unit_id = unit_id(:'bmt', 'gastronomy')), 'la marca no muestra categorías de comida');
insert into products (business_id, business_unit_id, category_id, name, price, stock_mode, sku)
select :'bmt', unit_id(:'bmt', 'shop'), id, 'Camisa Colibrí', 60000, 'variant', 'MTB-01' from categories where business_id = :'bmt' and slug = 'camisas';
insert into product_variants (business_id, product_id, sku, size) select :'bmt', id, 'MTB-01-M', 'M' from products where sku = 'MTB-01';
select id as cam from product_variants where sku = 'MTB-01-M' \gset
select inventory_adjust(:'bmt', null, :'cam', 'initial', 20, 'Inventario inicial');
insert into outlets (business_id, name, commission_pct) values (:'bmt', 'Rupícola', 10), (:'bmt', 'La Reserva', 15);
select id as ol_r from outlets where business_id = :'bmt' and name = 'Rupícola' \gset
select id as ol_lr from outlets where business_id = :'bmt' and name = 'La Reserva' \gset
select pg_temp.check((select count(*) from outlets where business_id = :'b') = 0, 'los aliados de Mi Tierra no se cruzan con Rupícola');
select outlet_move(:'bmt', :'ol_r', 'delivery', jsonb_build_array(jsonb_build_object('variant_id', :'cam', 'qty', 10)));
select pg_temp.check((select stock from product_variants where id = :'cam') = 10 and outlet_on_hand(:'ol_r', :'cam') = 10, 'entrega 10 camisas a Rupícola: quedan 10 en bodega');
select set_config('test.bmt', :'bmt', false), set_config('test.cam', :'cam', false), set_config('test.ol_r', :'ol_r', false), set_config('test.ol_lr', :'ol_lr', false);
do $$ begin
  perform outlet_move(current_setting('test.bmt')::uuid, current_setting('test.ol_lr')::uuid, 'delivery',
    jsonb_build_array(jsonb_build_object('variant_id', current_setting('test.cam'), 'qty', 15)));
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · no entrega más de lo que hay en bodega (%)', sqlerrm; end $$;
select outlet_move(:'bmt', :'ol_lr', 'delivery', jsonb_build_array(jsonb_build_object('variant_id', :'cam', 'qty', 8)));
select outlet_move(:'bmt', :'ol_r', 'sale', jsonb_build_array(jsonb_build_object('variant_id', :'cam', 'qty', 5)), 'Corte semanal');
select pg_temp.check(outlet_balance(:'ol_r') = 270000 and outlet_on_hand(:'ol_r', :'cam') = 5, 'Rupícola vendió 5: debe 270.000 (300.000 menos 10 %), le quedan 5');
do $$ begin
  perform outlet_move(current_setting('test.bmt')::uuid, current_setting('test.ol_r')::uuid, 'sale',
    jsonb_build_array(jsonb_build_object('variant_id', current_setting('test.cam'), 'qty', 6)));
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · no reporta más ventas de lo que tiene el aliado (%)', sqlerrm; end $$;
select outlet_move(:'bmt', :'ol_r', 'return', jsonb_build_array(jsonb_build_object('variant_id', :'cam', 'qty', 2)));
select pg_temp.check((select stock from product_variants where id = :'cam') = 4 and outlet_on_hand(:'ol_r', :'cam') = 3, 'devuelve 2: bodega 4, Rupícola 3');
select outlet_payment_create(:'bmt', :'ol_r', 100000, (select id from payment_methods where business_id = :'bmt' and code = 'cash')) as op1 \gset
select pg_temp.check(outlet_balance(:'ol_r') = 170000, 'abono de 100.000: por cobrar 170.000');
do $$ begin
  perform outlet_move_void((select id from outlet_movements where outlet_id = current_setting('test.ol_r')::uuid and kind = 'sale'), 'Error');
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · no anula una venta ya pagada (%)', sqlerrm; end $$;
select outlet_summary(:'bmt') as osum \gset
select pg_temp.check((select (x->>'delivered')::numeric = 10 and (x->>'sold')::numeric = 5 and (x->>'returned')::numeric = 2 and (x->>'on_hand')::numeric = 3
  and (x->>'receivable_total')::numeric = 270000 and (x->>'balance')::numeric = 170000 from jsonb_array_elements(:'osum'::jsonb) x where x->>'name' = 'Rupícola'), 'resumen de aliados: Rupícola');
select pg_temp.check((select (x->>'on_hand')::numeric = 8 and (x->>'balance')::numeric = 0 from jsonb_array_elements(:'osum'::jsonb) x where x->>'name' = 'La Reserva'), 'resumen de aliados: La Reserva tiene 8');
select outlet_move_void((select id from outlet_movements where outlet_id = :'ol_lr' and kind = 'delivery'), 'Se registró por error');
select pg_temp.check((select stock from product_variants where id = :'cam') = 12 and outlet_on_hand(:'ol_lr', :'cam') = 0, 'anular la entrega devuelve las 8 a bodega');
select outlet_payment_void(:'op1', 'Consignación rebotada');
select pg_temp.check(outlet_balance(:'ol_r') = 270000, 'anular el abono vuelve a 270.000 por cobrar');
select pg_temp.check((outlet_detail(:'ol_r')->>'balance')::numeric = 270000, 'detalle del aliado');
select pg_temp.check(exists (select 1 from jsonb_array_elements(my_context()) x where x->'business'->>'profile' = 'brand' and x->'business'->>'slug' = 'mi-tierra'), 'el contexto informa el perfil de marca');
reset role;

-- ===== Aislamiento entre establecimientos
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
set role authenticated;
select bootstrap_business('Otro Café', 'otro-cafe', 'Dueño');
select pg_temp.check((select count(*) from orders) = 0, 'otro establecimiento no ve pedidos de RUPÍCOLA');
select pg_temp.check((select count(*) from products) = 0, 'ni productos');
do $$ begin
  perform pos_create_order((select id from businesses where slug = 'rupicola'), 'counter', '[]');
  raise exception 'debió fallar';
exception when others then if sqlerrm = 'debió fallar' then raise; end if; raise notice 'ok · no puede vender en otro negocio (%)', sqlerrm; end $$;
reset role;
\echo '==== TODAS LAS PRUEBAS PASARON ===='

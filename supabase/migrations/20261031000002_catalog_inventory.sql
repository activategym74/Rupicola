-- =====================================================================
-- RUPÍCOLA · 0002 · Catálogo, recetas e inventario (separado por unidad)
-- =====================================================================

create table stations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,               -- kitchen | bar | cafe | ...
  name text not null,
  active boolean not null default true,
  unique (business_id, code)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  business_unit_id uuid not null references business_units(id),
  default_station_id uuid references stations(id),
  name text not null,
  slug text not null,
  sort int not null default 0,
  show_in_menu boolean not null default true,
  active boolean not null default true,
  unique (business_id, slug)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  business_unit_id uuid not null references business_units(id),
  category_id uuid not null references categories(id),
  -- Estación de preparación. NULL = no va a cocina (p. ej. tienda)
  station_id uuid references stations(id),
  sku text,
  barcode text,
  name text not null,
  description text,
  ingredients_text text,           -- texto visible para el cliente
  price numeric(14,2) not null check (price >= 0),
  tax_rate numeric(5,2) not null default 0,   -- % incluido en precio (IVA / impoconsumo)
  image_url text,
  model_3d_url text,               -- GLB / glTF opcional
  is_featured boolean not null default false,
  is_recommended boolean not null default false,
  is_available boolean not null default true,
  -- recipe: descuenta ingredientes · variant: descuenta variante · none: sin control
  stock_mode text not null default 'none' check (stock_mode in ('recipe', 'variant', 'none')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, sku)
);
create index on products (business_id, category_id);
create index on products (business_id, barcode);

-- Variantes de tienda (talla, color, diseño). Cada una con existencia propia.
create table product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  sku text,
  barcode text,
  size text,
  color text,
  design text,
  price numeric(14,2),             -- NULL = precio del producto
  cost numeric(14,2) not null default 0,
  stock numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0,
  image_url text,
  model_3d_url text,
  active boolean not null default true,
  unique (business_id, sku)
);
create index on product_variants (product_id);
create index on product_variants (business_id, barcode);

-- Opciones de personalización (sin cebolla, término de la carne, extra queso)
create table modifier_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  min_select int not null default 0,
  max_select int not null default 10,
  sort int not null default 0
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  business_unit_id uuid not null references business_units(id),
  name text not null,
  kind text not null default 'ingredient'
    check (kind in ('ingredient', 'food', 'beverage', 'liquor', 'supply', 'finished')),
  unit text not null default 'und',          -- und, g, ml, kg, l
  stock numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0,
  cost_per_unit numeric(14,4) not null default 0,
  active boolean not null default true,
  unique (business_id, name)
);

create table modifier_options (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  group_id uuid not null references modifier_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(14,2) not null default 0,
  -- Si la opción consume (o evita consumir) un ingrediente
  ingredient_id uuid references ingredients(id),
  ingredient_qty numeric(14,3) not null default 0,
  sort int not null default 0
);

-- Ficha técnica: ingredientes que consume una unidad de producto
create table recipe_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty numeric(14,3) not null check (qty > 0),
  unique (product_id, ingredient_id)
);

-- Libro de movimientos. La existencia se deriva SOLO de aquí.
create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  business_unit_id uuid not null references business_units(id),
  ingredient_id uuid references ingredients(id),
  variant_id uuid references product_variants(id),
  kind movement_kind not null,
  qty numeric(14,3) not null,               -- positivo entra, negativo sale
  unit_cost numeric(14,4) not null default 0,
  order_id uuid,
  order_item_id uuid,
  purchase_id uuid,
  reverses_id uuid references inventory_movements(id),
  expires_on date,
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check ((ingredient_id is null) <> (variant_id is null))
);
create index on inventory_movements (business_id, created_at desc);
create index on inventory_movements (ingredient_id);
create index on inventory_movements (variant_id);
create index on inventory_movements (order_id);

create or replace function apply_inventory_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ingredient_id is not null then
    update ingredients set stock = stock + new.qty,
      cost_per_unit = case when new.kind = 'purchase' and new.qty > 0 and new.unit_cost > 0
        then round(((greatest(stock,0) * cost_per_unit) + (new.qty * new.unit_cost)) / nullif(greatest(stock,0) + new.qty, 0), 4)
        else cost_per_unit end
    where id = new.ingredient_id;
  else
    update product_variants set stock = stock + new.qty,
      cost = case when new.kind = 'purchase' and new.qty > 0 and new.unit_cost > 0 then new.unit_cost else cost end
    where id = new.variant_id;
  end if;
  return new;
end $$;

create trigger inventory_apply after insert on inventory_movements
  for each row execute function apply_inventory_movement();
create trigger inventory_no_delete before delete or update on inventory_movements
  for each row execute function forbid_delete();

-- Costo teórico de un producto
create or replace function product_unit_cost(p uuid, v uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when v is not null then (select cost from product_variants where id = v)
    else coalesce((select sum(ri.qty * i.cost_per_unit) from recipe_items ri join ingredients i on i.id = ri.ingredient_id where ri.product_id = p), 0)
  end;
$$;

-- Ajuste manual de inventario (entradas, mermas, desperdicios, vencimientos)
create or replace function inventory_adjust(
  p_business uuid, p_ingredient uuid, p_variant uuid, p_kind movement_kind,
  p_qty numeric, p_reason text, p_unit_cost numeric default 0, p_expires date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_unit uuid; v_id uuid;
begin
  perform require_perm(p_business, 'inventory.adjust');
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Debe indicar el motivo del movimiento';
  end if;
  if p_kind in ('sale', 'reversal') then raise exception 'Tipo de movimiento no permitido manualmente'; end if;
  if p_ingredient is not null then
    select business_unit_id into v_unit from ingredients where id = p_ingredient and business_id = p_business;
  else
    select p.business_unit_id into v_unit from product_variants pv join products p on p.id = pv.product_id
      where pv.id = p_variant and pv.business_id = p_business;
  end if;
  if v_unit is null then raise exception 'Artículo no encontrado'; end if;
  insert into inventory_movements (business_id, business_unit_id, ingredient_id, variant_id, kind, qty, unit_cost, reason, expires_on)
  values (p_business, v_unit, p_ingredient, p_variant, p_kind,
          case when p_kind in ('waste', 'shrinkage', 'expired') then -abs(p_qty) else p_qty end,
          coalesce(p_unit_cost, 0), p_reason, p_expires)
  returning id into v_id;
  return v_id;
end $$;

-- Vista de inventario bajo (ambas unidades)
create or replace view low_stock with (security_invoker = true) as
  select i.business_id, i.business_unit_id, 'ingredient'::text as item_type, i.id, i.name, null::text as variant_label, i.stock, i.min_stock, i.unit
  from ingredients i where i.active and i.stock <= i.min_stock
  union all
  select pv.business_id, p.business_unit_id, 'variant', pv.id, p.name,
         concat_ws(' / ', pv.size, pv.color, pv.design), pv.stock, pv.min_stock, 'und'
  from product_variants pv join products p on p.id = pv.product_id
  where pv.active and pv.stock <= pv.min_stock;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table stations enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table product_variants enable row level security;
alter table modifier_groups enable row level security;
alter table modifier_options enable row level security;
alter table ingredients enable row level security;
alter table recipe_items enable row level security;
alter table inventory_movements enable row level security;

do $$
declare t text;
begin
  foreach t in array array['stations','categories','products','product_variants','modifier_groups','modifier_options','recipe_items'] loop
    execute format('create policy %1$s_read on %1$s for select using (is_member(business_id))', t);
    execute format('create policy %1$s_write on %1$s for all using (has_perm(business_id, ''catalog.manage'')) with check (has_perm(business_id, ''catalog.manage''))', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_trigger()', t);
  end loop;
end $$;

create policy ingredients_read on ingredients for select using (is_member(business_id));
create policy ingredients_write on ingredients for all
  using (has_perm(business_id, 'inventory.manage')) with check (has_perm(business_id, 'inventory.manage'));
create trigger audit_ingredients after insert or update or delete on ingredients for each row execute function audit_trigger();

create policy inv_mov_read on inventory_movements for select using (has_perm(business_id, 'inventory.view'));
-- Inserción solo vía funciones (security definer)

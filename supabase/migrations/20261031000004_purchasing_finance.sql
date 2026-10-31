-- =====================================================================
-- RUPÍCOLA · 0004 · Proveedores, compras, cuentas por pagar y gastos
-- =====================================================================

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  tax_id text,
  contact_name text,
  phone text,
  email text,
  address text,
  payment_terms_days int not null default 0,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Orden de compra → recepción → factura → pagos
create table purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  business_unit_id uuid not null references business_units(id),
  supplier_id uuid not null references suppliers(id),
  status text not null default 'draft'
    check (status in ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  invoice_number text,
  invoice_date date,
  due_date date,
  total numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0,
  notes text,
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  purchase_id uuid not null references purchases(id),
  ingredient_id uuid references ingredients(id),
  variant_id uuid references product_variants(id),
  description text,
  qty_ordered numeric(14,3) not null check (qty_ordered > 0),
  qty_received numeric(14,3) not null default 0,
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  expires_on date,
  check ((ingredient_id is null) <> (variant_id is null))
);

create table purchase_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  purchase_id uuid not null references purchases(id),
  amount numeric(14,2) not null check (amount > 0),
  method_id uuid references payment_methods(id),
  reference text,
  paid_at date not null default current_date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  unique (business_id, code)
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  category_id uuid not null references expense_categories(id),
  scope expense_scope not null,
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  -- Para gastos compartidos: % asignado a gastronomía (resto a tienda).
  -- NULL = usar el porcentaje configurado en la unidad.
  gastronomy_pct numeric(5,2) check (gastronomy_pct between 0 and 100),
  paid_from_cash boolean not null default false,
  cash_session_id uuid references cash_sessions(id),
  supplier_id uuid references suppliers(id),
  reference text,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on expenses (business_id, expense_date);

-- Asignación del gasto a cada unidad (calculada)
create table expense_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  expense_id uuid not null references expenses(id),
  business_unit_id uuid not null references business_units(id),
  amount numeric(14,2) not null
);

alter table cash_movements add constraint cash_movements_expense_fk foreign key (expense_id) references expenses(id);

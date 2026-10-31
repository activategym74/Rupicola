-- =====================================================================
-- RUPÍCOLA · 0003 · Clientes, mesas, pedidos, KDS, pagos, caja, domicilios
-- =====================================================================

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  full_name text not null,
  document text,
  phone text,
  email text,
  preferences text,
  notes text,
  points numeric(14,2) not null default 0,
  total_spent numeric(14,2) not null default 0,
  orders_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (business_id, phone)
);

create table customer_addresses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  label text,
  address text not null,
  details text,                    -- indicaciones para encontrar la dirección
  neighborhood text,
  lat double precision,
  lng double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Mesas
-- ---------------------------------------------------------------------
create table dining_tables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  number int not null,
  name text,
  zone text not null default 'Salón',
  seats int not null default 4,
  pos_x int not null default 0,      -- posición en el plano (grilla)
  pos_y int not null default 0,
  shape text not null default 'square' check (shape in ('square', 'round', 'bar')),
  qr_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  status table_status not null default 'available',
  current_order_id uuid,
  status_changed_at timestamptz not null default now(),
  active boolean not null default true,
  unique (business_id, number)
);

-- ---------------------------------------------------------------------
-- Métodos de pago, impuestos, zonas de domicilio
-- ---------------------------------------------------------------------
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,               -- cash, debit, credit, transfer, qr, online, other
  name text not null,
  is_cash boolean not null default false,
  requires_reference boolean not null default false,
  -- Pasarela que procesa el método (NULL = registro manual en caja)
  gateway text,
  available_online boolean not null default false,
  active boolean not null default true,
  sort int not null default 0,
  unique (business_id, code)
);

create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  fee numeric(14,2) not null default 0,
  min_order numeric(14,2) not null default 0,
  eta_minutes int not null default 45,
  -- Polígono GeoJSON [[lng,lat],...] o centro + radio
  polygon jsonb,
  center_lat double precision,
  center_lng double precision,
  radius_km numeric(6,2),
  active boolean not null default true
);

-- ---------------------------------------------------------------------
-- Pedidos (venta) y detalles
-- ---------------------------------------------------------------------
create table order_counters (
  business_id uuid primary key references businesses(id) on delete cascade,
  last_number int not null default 0
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  number int not null,
  channel order_channel not null,
  status order_status not null default 'open',
  table_id uuid references dining_tables(id),
  customer_id uuid references customers(id),
  customer_name text,
  customer_phone text,
  waiter_id uuid references members(id),
  created_by uuid default auth.uid(),
  notes text,
  subtotal numeric(14,2) not null default 0,      -- suma de líneas antes de descuento
  discount_total numeric(14,2) not null default 0,
  delivery_fee numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,         -- subtotal - descuentos + domicilio
  tip numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0,    -- pagos aprobados (incluye propina)
  tracking_token text unique default encode(gen_random_bytes(16), 'hex'),
  parent_order_id uuid references orders(id),     -- cuenta dividida
  merged_into_id uuid references orders(id),      -- cuenta unificada
  stock_applied boolean not null default false,
  finalized boolean not null default false,       -- ingresos ya registrados
  cancel_reason text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  ready_at timestamptz,
  paid_at timestamptz,
  closed_at timestamptz,
  unique (business_id, number)
);
create index on orders (business_id, created_at desc);
create index on orders (business_id, status);
create index on orders (table_id) where status not in ('paid', 'cancelled');

alter table dining_tables add constraint dining_tables_current_order_fk
  foreign key (current_order_id) references orders(id);

create table kds_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null references orders(id),
  station_id uuid not null references stations(id),
  status ticket_status not null default 'received',
  received_at timestamptz not null default now(),
  accepted_at timestamptz,
  started_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  rejected_reason text,
  updated_by uuid
);
create index on kds_tickets (business_id, station_id, status);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null references orders(id),
  product_id uuid not null references products(id),
  variant_id uuid references product_variants(id),
  business_unit_id uuid not null references business_units(id),
  station_id uuid references stations(id),
  ticket_id uuid references kds_tickets(id),
  name text not null,
  variant_label text,
  qty numeric(10,3) not null check (qty > 0),
  unit_price numeric(14,2) not null,     -- incluye modificadores
  modifiers jsonb not null default '[]', -- [{option_id,name,price_delta}]
  notes text,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  line_total numeric(14,2) generated always as (round(qty * unit_price - discount, 2)) stored,
  unit_cost numeric(14,4) not null default 0,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  promotion text,
  added_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on order_items (order_id);
create index on order_items (ticket_id);

create table order_status_history (
  id bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null references orders(id),
  entity text not null default 'order',   -- order | ticket | delivery
  entity_id uuid,
  from_status text,
  to_status text not null,
  note text,
  user_id uuid default auth.uid(),
  member_id uuid,
  created_at timestamptz not null default now()
);
create index on order_status_history (order_id, created_at);

-- Solicitudes desde la mesa (llamar mesero, servilletas, cuenta...)
create table service_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  table_id uuid not null references dining_tables(id),
  order_id uuid references orders(id),
  kind text not null check (kind in ('call_waiter', 'supplies', 'assistance', 'bill')),
  note text,
  status text not null default 'open' check (status in ('open', 'attended')),
  attended_by uuid references members(id),
  created_at timestamptz not null default now(),
  attended_at timestamptz
);
create index on service_requests (business_id, status);

-- ---------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------
create table cash_registers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  active boolean not null default true
);

create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  register_id uuid not null references cash_registers(id),
  opened_by uuid not null references members(id),
  closed_by uuid references members(id),
  opening_amount numeric(14,2) not null default 0,
  expected_cash numeric(14,2),
  counted_cash numeric(14,2),
  difference numeric(14,2),
  counted_detail jsonb,            -- arqueo por método / denominación
  notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index cash_sessions_one_open on cash_sessions (register_id) where closed_at is null;

-- ---------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------
create table payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null references orders(id),
  method_id uuid not null references payment_methods(id),
  cash_session_id uuid references cash_sessions(id),
  amount numeric(14,2) not null check (amount > 0),
  received_amount numeric(14,2),     -- efectivo entregado por el cliente
  change_amount numeric(14,2) not null default 0,
  status payment_status not null default 'approved',
  reference text,
  gateway text,
  gateway_payload jsonb,
  void_reason text,
  voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on payments (order_id);
create index on payments (business_id, created_at desc);

-- Distribución interna de cada pago por unidad de negocio (NULL = propina)
create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  payment_id uuid not null references payments(id),
  order_id uuid not null references orders(id),
  business_unit_id uuid references business_units(id),
  concept text not null default 'sale' check (concept in ('sale', 'tip', 'reversal')),
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index on payment_allocations (order_id);

-- Ingresos y costo de venta reconocidos por unidad al cerrar el pedido
create table revenue_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  business_unit_id uuid references business_units(id),
  order_id uuid not null references orders(id),
  concept text not null check (concept in ('sale', 'delivery_fee', 'tip', 'reversal')),
  amount numeric(14,2) not null,
  cost numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create index on revenue_entries (business_id, created_at);

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  session_id uuid references cash_sessions(id),
  business_unit_id uuid references business_units(id),
  method_id uuid references payment_methods(id),
  kind cash_movement_kind not null,
  amount numeric(14,2) not null,   -- positivo entra, negativo sale
  payment_id uuid references payments(id),
  order_id uuid references orders(id),
  expense_id uuid,
  description text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on cash_movements (session_id);
create index on cash_movements (business_id, created_at desc);

-- ---------------------------------------------------------------------
-- Domicilios
-- ---------------------------------------------------------------------
create table deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null unique references orders(id),
  customer_id uuid references customers(id),
  address_id uuid references customer_addresses(id),
  address text not null,
  details text,
  lat double precision,
  lng double precision,
  zone_id uuid references delivery_zones(id),
  fee numeric(14,2) not null default 0,
  payment_method_id uuid references payment_methods(id),
  cash_to_collect numeric(14,2) not null default 0,
  cash_change_for numeric(14,2),
  courier_id uuid references members(id),
  status delivery_status not null default 'received',
  proof_url text,
  incident_notes text,
  location_consent boolean not null default false,
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now()
);
create index on deliveries (business_id, status);
create index on deliveries (courier_id, status);

create table delivery_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  delivery_id uuid not null references deliveries(id),
  from_status delivery_status,
  to_status delivery_status not null,
  note text,
  user_id uuid default auth.uid(),
  member_id uuid,
  created_at timestamptz not null default now()
);

-- Preparado para seguimiento en vivo (solo con consentimiento del domiciliario)
create table courier_locations (
  id bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  delivery_id uuid not null references deliveries(id),
  courier_id uuid not null references members(id),
  lat double precision not null,
  lng double precision not null,
  accuracy_m numeric(8,2),
  recorded_at timestamptz not null default now()
);
create index on courier_locations (delivery_id, recorded_at desc);

-- ---------------------------------------------------------------------
-- Notificaciones
-- ---------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- Destino: un permiso (todos los que lo tengan) o un miembro específico
  target_perm text,
  member_id uuid references members(id),
  kind text not null,
  title text not null,
  body text,
  data jsonb not null default '{}',
  read_at timestamptz,
  read_by uuid,
  created_at timestamptz not null default now()
);
create index on notifications (business_id, created_at desc);

-- Cola de mensajes externos (WhatsApp). Un worker los envía si hay credenciales.
create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'email', 'webpush')),
  recipient text not null,
  template text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  order_id uuid references orders(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on notification_outbox (status, created_at);

-- Suscripciones Web Push de clientes y personal
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  member_id uuid references members(id),
  order_tracking_token text,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

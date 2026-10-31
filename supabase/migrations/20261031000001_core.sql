-- =====================================================================
-- RUPÍCOLA · 0001 · Núcleo multi-establecimiento, roles, permisos, auditoría
-- =====================================================================
-- Todo registro de negocio lleva business_id. Las políticas RLS aíslan
-- la información por establecimiento para que la plataforma pueda
-- comercializarse como SaaS sin cambios de esquema.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type unit_kind as enum ('gastronomy', 'shop');
create type order_channel as enum ('counter', 'table', 'qr', 'delivery', 'pickup');
create type order_status as enum ('open', 'confirmed', 'in_progress', 'ready', 'delivered', 'paid', 'cancelled');
create type ticket_status as enum ('received', 'accepted', 'preparing', 'ready', 'delivered', 'rejected');
create type table_status as enum ('available', 'occupied', 'pending_order', 'preparing', 'order_ready', 'needs_attention', 'requesting_bill');
create type delivery_status as enum ('received', 'confirmed', 'preparing', 'ready_for_dispatch', 'courier_assigned', 'picked_up', 'on_the_way', 'delivered', 'cancelled');
create type movement_kind as enum ('purchase', 'sale', 'adjustment', 'waste', 'shrinkage', 'expired', 'return', 'reversal', 'initial');
create type cash_movement_kind as enum ('opening', 'sale', 'income', 'expense', 'withdrawal', 'refund', 'delivery_collection', 'closing_adjustment');
create type payment_status as enum ('pending', 'approved', 'rejected', 'voided');
create type expense_scope as enum ('gastronomy', 'shop', 'shared');

-- ---------------------------------------------------------------------
-- Establecimientos y unidades de negocio
-- ---------------------------------------------------------------------
create table businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null,
  legal_name text,
  tax_id text,
  phone text,
  email text,
  address text,
  city text,
  logo_url text,
  brand_colors jsonb not null default '{"primary":"#791522","sand":"#D7C5A2","ivory":"#F7F5F0","charcoal":"#292524"}',
  opening_hours jsonb not null default '{}',
  currency text not null default 'COP',
  timezone text not null default 'America/Bogota',
  -- Configuración operativa
  inventory_policy text not null default 'on_payment' check (inventory_policy in ('on_confirm', 'on_payment')),
  tip_suggested_pct numeric(5,2) not null default 10,
  delivery_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  loyalty_enabled boolean not null default false,
  loyalty_points_per_1000 numeric(8,2) not null default 1,
  created_at timestamptz not null default now()
);

create table business_units (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind unit_kind not null,
  name text not null,
  -- Porcentaje por defecto para repartir gastos compartidos
  shared_expense_pct numeric(5,2) not null default 50 check (shared_expense_pct between 0 and 100),
  unique (business_id, kind)
);

-- ---------------------------------------------------------------------
-- Usuarios, roles y permisos
-- ---------------------------------------------------------------------
create table permissions (
  code text primary key,
  module text not null,
  description text not null
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, code)
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission text not null references permissions(code) on delete cascade,
  primary key (role_id, permission)
);

-- Perfil del usuario dentro de un establecimiento
create table members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references roles(id),
  full_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (business_id, user_id)
);
create index on members (user_id);

-- ---------------------------------------------------------------------
-- Funciones de seguridad (security definer para evitar recursión RLS)
-- ---------------------------------------------------------------------
create or replace function is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.business_id = b and m.user_id = auth.uid() and m.active);
$$;

create or replace function has_perm(b uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from members m
    join role_permissions rp on rp.role_id = m.role_id
    where m.business_id = b and m.user_id = auth.uid() and m.active
      and (rp.permission = perm or rp.permission = '*'
           or rp.permission = split_part(perm, '.', 1) || '.*')
  );
$$;

create or replace function current_member_id(b uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.id from members m where m.business_id = b and m.user_id = auth.uid() and m.active;
$$;

create or replace function require_perm(b uuid, perm text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm(b, perm) then
    raise exception 'Permiso requerido: %', perm using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  business_id uuid references businesses(id) on delete cascade,
  user_id uuid,
  member_id uuid,
  entity text not null,
  entity_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  reason text,
  order_id uuid,
  business_unit_id uuid,
  created_at timestamptz not null default now()
);
create index on audit_log (business_id, created_at desc);
create index on audit_log (entity, entity_id);

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  b uuid := (rec->>'business_id')::uuid;
begin
  -- Cambios derivados (existencias recalculadas, última conexión) ya quedan
  -- trazados en su propio libro; no se duplican aquí.
  if tg_op = 'UPDATE' and (to_jsonb(new) - array['stock','cost','cost_per_unit','last_seen_at','status_changed_at'])
                        = (to_jsonb(old) - array['stock','cost','cost_per_unit','last_seen_at','status_changed_at']) then
    return new;
  end if;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, old_data, new_data, order_id, business_unit_id)
  values (
    b, auth.uid(), case when b is not null then current_member_id(b) end,
    tg_table_name, rec->>'id', lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    nullif(rec->>'order_id', '')::uuid,
    nullif(rec->>'business_unit_id', '')::uuid
  );
  return coalesce(new, old);
end $$;

-- Impide borrar registros con valor financiero o de trazabilidad.
create or replace function forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'No se permite eliminar registros de %: use anulación con motivo', tg_table_name
    using errcode = '42501';
end $$;

-- Registro manual de actividad (inicio de sesión, exportes, etc.)
create or replace function log_activity(b uuid, p_action text, p_entity text default 'session', p_data jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(b) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update members set last_seen_at = now() where business_id = b and user_id = auth.uid();
  insert into audit_log (business_id, user_id, member_id, entity, action, new_data)
  values (b, auth.uid(), current_member_id(b), p_entity, p_action, p_data);
end $$;

-- ---------------------------------------------------------------------
-- RLS núcleo
-- ---------------------------------------------------------------------
alter table businesses enable row level security;
alter table business_units enable row level security;
alter table permissions enable row level security;
alter table roles enable row level security;
alter table role_permissions enable row level security;
alter table members enable row level security;
alter table audit_log enable row level security;

create policy businesses_read on businesses for select using (is_member(id));
create policy businesses_update on businesses for update using (has_perm(id, 'settings.manage'));

create policy units_read on business_units for select using (is_member(business_id));
create policy units_write on business_units for update using (has_perm(business_id, 'settings.manage'));

create policy permissions_read on permissions for select to authenticated using (true);

create policy roles_read on roles for select using (is_member(business_id));
create policy roles_write on roles for all using (has_perm(business_id, 'users.manage'))
  with check (has_perm(business_id, 'users.manage'));

create policy role_perms_read on role_permissions for select
  using (exists (select 1 from roles r where r.id = role_id and is_member(r.business_id)));
create policy role_perms_write on role_permissions for all
  using (exists (select 1 from roles r where r.id = role_id and r.code <> 'admin' and has_perm(r.business_id, 'users.manage')))
  with check (exists (select 1 from roles r where r.id = role_id and r.code <> 'admin' and has_perm(r.business_id, 'users.manage')));

create policy members_read on members for select using (is_member(business_id));
create policy members_write on members for all using (has_perm(business_id, 'users.manage'))
  with check (has_perm(business_id, 'users.manage'));

create policy audit_read on audit_log for select using (has_perm(business_id, 'audit.view'));

create trigger audit_members after insert or update or delete on members for each row execute function audit_trigger();
create trigger audit_roles after insert or update or delete on roles for each row execute function audit_trigger();
create trigger audit_businesses after update on businesses for each row execute function audit_trigger();
create trigger audit_log_no_delete before delete or update on audit_log for each row execute function forbid_delete();

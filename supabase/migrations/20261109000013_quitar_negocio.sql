-- Quitar (archivar) un negocio creado por error. No se borra nada: el negocio
-- queda archivado y sus usuarios desactivados, para conservar la trazabilidad.
alter table businesses add column if not exists archived_at timestamptz;

create or replace function business_archive(p_business uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = public as $$
declare b businesses%rowtype;
begin
  select * into b from businesses where id = p_business for update;
  if not found then raise exception 'Negocio no encontrado'; end if;
  if not exists (select 1 from members m join roles r on r.id = m.role_id
                 where m.business_id = p_business and m.user_id = auth.uid() and m.active and r.code = 'admin') then
    raise exception 'Solo el administrador general puede quitar este negocio' using errcode = '42501';
  end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(b.name)) then
    raise exception 'Escriba el nombre exacto del negocio para confirmar';
  end if;
  if not exists (select 1 from members m where m.user_id = auth.uid() and m.active and m.business_id <> p_business) then
    raise exception 'No puede quitar su único negocio';
  end if;
  if exists (select 1 from cash_sessions where business_id = p_business and closed_at is null) then
    raise exception 'Cierre primero la caja abierta de este negocio';
  end if;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, new_data)
  values (p_business, auth.uid(), current_member_id(p_business), 'businesses', p_business::text, 'archive',
          jsonb_build_object('name', b.name));
  update businesses set archived_at = now() where id = p_business;
  update members set active = false where business_id = p_business;
end $$;

revoke execute on function business_archive(uuid, text) from public, anon;
grant execute on function business_archive(uuid, text) to authenticated;

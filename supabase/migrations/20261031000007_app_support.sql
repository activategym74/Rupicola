-- =====================================================================
-- RUPÍCOLA · 0007 · Soporte para la aplicación: contexto de sesión,
-- buckets de almacenamiento
-- =====================================================================

-- Establecimientos del usuario con su rol y permisos efectivos
create or replace function my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'logo_url', b.logo_url,
                                   'timezone', b.timezone, 'currency', b.currency),
    'member', jsonb_build_object('id', m.id, 'full_name', m.full_name),
    'role', jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name),
    'permissions', (select coalesce(jsonb_agg(rp.permission), '[]') from role_permissions rp where rp.role_id = r.id),
    'units', (select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'name', u.name)) from business_units u where u.business_id = b.id)
  ) order by b.name), '[]')
  from members m join businesses b on b.id = m.business_id join roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.active;
$$;
grant execute on function my_context() to authenticated;

-- Buckets de Supabase Storage (solo existen en Supabase)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values
      ('catalog', 'catalog', true),          -- fotos y modelos 3D de productos
      ('branding', 'branding', true),        -- logo
      ('delivery-proofs', 'delivery-proofs', false)
    on conflict (id) do nothing;

    execute $p$create policy "catalog_write" on storage.objects for all to authenticated
      using (bucket_id in ('catalog', 'branding') and has_perm((storage.foldername(name))[1]::uuid, 'catalog.manage'))
      with check (bucket_id in ('catalog', 'branding') and has_perm((storage.foldername(name))[1]::uuid, 'catalog.manage'))$p$;
    execute $p$create policy "proofs_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'delivery-proofs' and has_perm((storage.foldername(name))[1]::uuid, 'delivery.courier'))$p$;
    execute $p$create policy "proofs_read" on storage.objects for select to authenticated
      using (bucket_id = 'delivery-proofs' and (has_perm((storage.foldername(name))[1]::uuid, 'delivery.manage')
             or has_perm((storage.foldername(name))[1]::uuid, 'delivery.courier')))$p$;
  end if;
end $$;

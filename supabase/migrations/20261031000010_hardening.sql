-- =====================================================================
-- RUPÍCOLA · 0010 · Ajustes de seguridad sugeridos por Supabase Advisors
-- =====================================================================
revoke execute on function my_context() from anon, public;
alter function forbid_delete() set search_path = public;
alter function point_in_zone(delivery_zones, double precision, double precision) set search_path = public;

-- =====================================================================
-- RUPÍCOLA · 0009 · Relación auditoría → usuario que realizó la acción
-- (permite mostrar el nombre del responsable en el módulo de Auditoría)
-- =====================================================================
alter table audit_log
  add constraint audit_log_member_id_fkey foreign key (member_id) references members(id) on delete set null;
create index if not exists audit_log_member_idx on audit_log (member_id);

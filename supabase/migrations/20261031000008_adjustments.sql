-- =====================================================================
-- RUPÍCOLA · 0008 · Ajustes: plantilla de comprobante, reverso de gastos
-- pagados desde caja, alcance de unidad por usuario
-- =====================================================================
alter table businesses add column receipt_header text;
alter table businesses add column receipt_footer text default '¡Gracias por visitarnos!';
alter table businesses add column notify_whatsapp boolean not null default true;

-- Al anular un gasto pagado desde caja, el dinero vuelve a la caja (si sigue abierta)
create or replace function expense_void(p_expense uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e expenses%rowtype; v_session uuid;
begin
  select * into e from expenses where id = p_expense for update;
  perform require_perm(e.business_id, 'expenses.manage');
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Indique el motivo'; end if;
  if e.status = 'voided' then return; end if;
  update expenses set status = 'voided', void_reason = p_reason where id = p_expense;
  if e.paid_from_cash then
    select id into v_session from cash_sessions where id = e.cash_session_id and closed_at is null;
    if v_session is not null then
      insert into cash_movements (business_id, session_id, business_unit_id, method_id, kind, amount, expense_id, description)
      select business_id, v_session, business_unit_id, method_id, 'closing_adjustment', -amount, expense_id, 'Anulación de gasto: ' || p_reason
      from cash_movements where expense_id = p_expense and kind = 'expense';
    end if;
  end if;
  insert into audit_log (business_id, user_id, member_id, entity, entity_id, action, old_data, reason)
  values (e.business_id, auth.uid(), current_member_id(e.business_id), 'expenses', p_expense::text, 'void', to_jsonb(e), p_reason);
end $$;

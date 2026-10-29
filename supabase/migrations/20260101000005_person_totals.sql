-- Per-person totals by currency (valid rows only). SECURITY INVOKER: RLS applies, so another user's
-- person id simply returns no rows.
create function public.person_totals(p_person_id uuid)
returns table (currency text, total_received text, total_given text, outstanding text)
language sql stable set search_path = '' as $$
  select t.currency::text,
         coalesce(sum(t.amount) filter (where t.transaction_type = 'received'), 0)::text,
         coalesce(sum(t.amount) filter (where t.transaction_type = 'given'), 0)::text,
         (coalesce(sum(t.amount) filter (where t.transaction_type = 'received'), 0)
          - coalesce(sum(t.amount) filter (where t.transaction_type = 'given'), 0))::text
  from public.transactions t
  where t.person_id = p_person_id and t.status = 'valid'
  group by t.currency
  order by t.currency;
$$;

revoke all on function public.person_totals(uuid) from public, anon, authenticated;
grant execute on function public.person_totals(uuid) to authenticated;

-- Guarded wrapper so the app can record admin actions that are not covered by another admin RPC
-- (admin_log itself stays internal because it has no guard of its own).
create function public.admin_record_action(p_action text, p_target_type text, p_target_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  perform public.admin_log(left(p_action, 64), left(p_target_type, 64), left(p_target_id, 100), p_details);
end $$;
revoke all on function public.admin_record_action(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_record_action(text, text, text, jsonb) to authenticated;

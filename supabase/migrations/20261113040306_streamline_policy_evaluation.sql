-- Preserve write authorization while avoiding FOR ALL policies being evaluated
-- again alongside the dedicated SELECT policies.
DO $$
DECLARE item record;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('students','students_admin','(SELECT public.is_admin())'),
  ('academic_periods','periods_admin','(SELECT public.is_admin())'),
  ('school_groups','groups_admin','(SELECT public.is_admin())'),
  ('enrollments','enrollments_admin','(SELECT public.is_admin())'),
  ('teaching_assignments','assignments_admin','(SELECT public.is_admin())'),
  ('attendances','attendance_write','public.can_manage_session(session_id)')
 ) AS policies(table_name,policy_name,predicate)
 LOOP
  EXECUTE format('DROP POLICY %I ON public.%I',item.policy_name,item.table_name);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',item.policy_name||'_insert',item.table_name,item.predicate);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',item.policy_name||'_update',item.table_name,item.predicate,item.predicate);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',item.policy_name||'_delete',item.table_name,item.predicate);
 END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS attendances_marked_by_idx ON public.attendances(marked_by);
CREATE INDEX IF NOT EXISTS incidents_actor_idx ON public.incidents(actor_id);

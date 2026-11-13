-- Retain safeupdate: delete an explicit, locked snapshot of activity IDs.
BEGIN;
CREATE OR REPLACE FUNCTION app_private.clear_test_activity(p_actor uuid,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ns bigint; na bigint; ni bigint; result jsonb; target_ids uuid[]; cutoff timestamptz:=clock_timestamp();
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_confirmation IS DISTINCT FROM 'BORRAR SESIONES DE PRUEBA'
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND role='admin') THEN
 RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.sessions,public.attendances,public.incidents,public.session_roster,public.audit_events IN ACCESS EXCLUSIVE MODE;
 PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO target_ids FROM public.sessions WHERE created_at<=cutoff;
 ns:=cardinality(target_ids);
 SELECT count(*) INTO na FROM public.attendances WHERE session_id=ANY(target_ids);
 SELECT count(*) INTO ni FROM public.incidents WHERE created_at<=cutoff OR session_id=ANY(target_ids);
 DELETE FROM public.attendances WHERE session_id=ANY(target_ids);
 DELETE FROM public.incidents WHERE created_at<=cutoff OR session_id=ANY(target_ids);
 -- Keep security history; detach deleted session references before removing sessions.
 UPDATE public.audit_events SET session_id=NULL WHERE session_id=ANY(target_ids);
 DELETE FROM public.sessions WHERE id=ANY(target_ids);
 result:=jsonb_build_object('sessions',ns,'attendances',na,'incidents',ni);
 INSERT INTO public.audit_events(actor_id,entity_id,action,after_value)
 VALUES(p_actor,gen_random_uuid(),'test_activity.clear',result);
 RETURN result;
END $$;
-- Service-only integration probe: the entire deletion is unconditionally rolled
-- back inside a subtransaction, including triggers and audit. Nothing is committed.
CREATE FUNCTION app_private.verify_test_activity_cleanup(p_actor uuid,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 BEGIN
  result:=app_private.clear_test_activity(p_actor,p_confirmation);
  RAISE EXCEPTION 'Rollback integration probe' USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
 END;
 RETURN result;
END $$;
CREATE FUNCTION public.verify_test_activity_cleanup(p_actor uuid,p_confirmation text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.verify_test_activity_cleanup(p_actor,p_confirmation); $$;
REVOKE ALL ON FUNCTION app_private.verify_test_activity_cleanup(uuid,text),public.verify_test_activity_cleanup(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.verify_test_activity_cleanup(uuid,text),public.verify_test_activity_cleanup(uuid,text) TO service_role;
COMMIT;

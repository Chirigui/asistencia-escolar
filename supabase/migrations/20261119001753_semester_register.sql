BEGIN;
ALTER TABLE public.sessions ADD COLUMN is_test boolean NOT NULL DEFAULT false;
CREATE FUNCTION app_private.keep_session_kind() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.is_test IS DISTINCT FROM OLD.is_test THEN
   RAISE EXCEPTION 'Session classification is permanent' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_kind_immutable BEFORE UPDATE OF is_test ON public.sessions
FOR EACH ROW EXECUTE FUNCTION app_private.keep_session_kind();
REVOKE ALL ON FUNCTION app_private.keep_session_kind() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION app_private.clear_test_activity(p_actor uuid,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ns bigint; na bigint; ni bigint; result jsonb; target_ids uuid[]; cutoff timestamptz:=clock_timestamp();
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_confirmation IS DISTINCT FROM 'BORRAR SESIONES DE PRUEBA'
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND role='admin') THEN
 RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.sessions,public.attendances,public.incidents,public.session_roster,public.audit_events IN ACCESS EXCLUSIVE MODE;
 PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO target_ids FROM public.sessions WHERE is_test AND created_at<=cutoff;
 ns:=cardinality(target_ids);
 SELECT count(*) INTO na FROM public.attendances WHERE session_id=ANY(target_ids);
 SELECT count(*) INTO ni FROM public.incidents WHERE session_id=ANY(target_ids);
 DELETE FROM public.attendances WHERE session_id=ANY(target_ids);
 DELETE FROM public.incidents WHERE session_id=ANY(target_ids);
 -- Keep security history; detach deleted session references before removing sessions.
 UPDATE public.audit_events SET session_id=NULL WHERE session_id=ANY(target_ids);
 DELETE FROM public.sessions WHERE id=ANY(target_ids);
 result:=jsonb_build_object('sessions',ns,'attendances',na,'incidents',ni);
 INSERT INTO public.audit_events(actor_id,entity_id,action,after_value)
 VALUES(p_actor,gen_random_uuid(),'test_activity.clear',result);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.coordination_day(p_day date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'expected', COALESCE((SELECT jsonb_agg(group_id) FROM public.daily_expected_groups WHERE day = p_day), '[]'::jsonb),
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'groupId', s.group_id, 'groupName', s.group_name, 'subject', s.subject, 'status', s.status,
        'absences', CASE WHEN s.status IN ('CERRADA','FINALIZADA') THEN (
          SELECT count(*) FROM public.session_roster r WHERE r.session_id = s.id AND NOT EXISTS (
            SELECT 1 FROM public.attendances a WHERE a.session_id = s.id AND a.student_id = r.student_id)
        ) END
      ) ORDER BY s.start_time, s.id) FROM public.sessions s WHERE s.date = p_day AND NOT s.is_test
    ), '[]'::jsonb)
  ) WHERE (SELECT public.is_admin());
$$;

-- A separate entry point keeps new application builds safe against an older schema.
CREATE FUNCTION public.clear_marked_test_activity(p_actor uuid,p_confirmation text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT app_private.clear_test_activity(p_actor,p_confirmation);
$$;
REVOKE ALL ON FUNCTION public.clear_marked_test_activity(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clear_marked_test_activity(uuid,text) TO service_role;

CREATE FUNCTION public.semester_register(p_group uuid,p_year integer,p_half integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH bounds AS (
   SELECT make_date(p_year,CASE p_half WHEN 1 THEN 1 ELSE 7 END,1) AS start_day
   WHERE p_year BETWEEN 1900 AND 2200 AND p_half IN (1,2)
 ), classes AS (
   SELECT s.id,s.subject,s.date,s.start_time,s.code
   FROM public.sessions s CROSS JOIN bounds b
   WHERE s.group_id=p_group AND NOT s.is_test AND s.status IN ('CERRADA','FINALIZADA')
   AND s.date>=b.start_day AND s.date<b.start_day+interval '6 months'
 ), marks AS (
   SELECT r.student_id,r.full_name,c.id,c.date,c.start_time,
     coalesce(a.status,'AUSENTE') AS status,r.source
   FROM classes c JOIN public.session_roster r ON r.session_id=c.id
   LEFT JOIN public.attendances a ON a.session_id=c.id AND a.student_id=r.student_id
 ), members AS (
   SELECT DISTINCT ON (student_id) student_id,full_name FROM (
     SELECT student_id,full_name,date,start_time FROM marks
     UNION ALL
     SELECT e.student_id,s.full_name,NULL::date,NULL::time
     FROM public.enrollments e JOIN public.students s ON s.id=e.student_id
     JOIN public.academic_periods p ON p.id=e.period_id CROSS JOIN bounds b
     WHERE e.group_id=p_group AND p.starts_on<b.start_day+interval '6 months'
       AND p.ends_on>=b.start_day
       AND (e.valid_from AT TIME ZONE 'America/Bogota')::date<b.start_day+interval '6 months'
       AND (e.valid_to IS NULL OR (e.valid_to AT TIME ZONE 'America/Bogota')::date>=b.start_day)
   ) people ORDER BY student_id,date DESC NULLS LAST,start_time DESC NULLS LAST
 ), students AS (
   SELECT m.student_id,m.full_name,count(k.id) AS total,
     count(*) FILTER (WHERE k.status IN ('PRESENTE','TARDE')) AS attended,
     count(*) FILTER (WHERE k.status='AUSENTE') AS absent,
     count(*) FILTER (WHERE k.status='JUSTIFICADO') AS excused,
     coalesce(jsonb_object_agg(k.id,k.status) FILTER (WHERE k.id IS NOT NULL),'{}') AS marks
   FROM members m LEFT JOIN marks k ON k.student_id=m.student_id GROUP BY m.student_id,m.full_name
 )
 SELECT jsonb_build_object('groupName',g.name,'historical',EXISTS(SELECT 1 FROM marks WHERE source='BACKFILL'),
   'classes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'subject',subject,'date',date,'time',left(start_time::text,5),'code',code) ORDER BY date,start_time,code) FROM classes),'[]'),
   'students',coalesce((SELECT jsonb_agg(jsonb_build_object('id',student_id,'name',full_name,'total',total,'attended',attended,'absent',absent,'excused',excused,'marks',marks) ORDER BY full_name,student_id) FROM students),'[]'))
 FROM public.school_groups g CROSS JOIN bounds WHERE g.id=p_group AND (SELECT public.is_admin());
$$;
REVOKE ALL ON FUNCTION public.semester_register(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.semester_register(uuid,integer,integer) TO authenticated;
COMMIT;

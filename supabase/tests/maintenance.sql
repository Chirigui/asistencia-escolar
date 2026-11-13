-- ISOLATED TEST DATABASE ONLY: this suite exercises global deletion then rolls back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES ('70000000-0000-4000-8000-000000000001','cleanup-teacher@example.invalid'),('70000000-0000-4000-8000-000000000002','cleanup-admin@example.invalid');
UPDATE public.profiles SET role='admin' WHERE id='70000000-0000-4000-8000-000000000002';
INSERT INTO public.students(id,document,document_normalized,full_name,grade,group_name) VALUES ('80000000-0000-4000-8000-000000000001','CLEANUP001','CLEANUP001','Synthetic Student','TEST','CLEANUPTEST');
INSERT INTO public.sessions(code,teacher_id,subject,group_name,date,start_time,end_time,registration_opens_at,registration_closes_at)
SELECT 'WINDOW-'||n,'70000000-0000-4000-8000-000000000001','Test','CLEANUPTEST',(now() AT TIME ZONE 'America/Bogota')::date,'00:00','23:59',clock_timestamp()+start_offset,clock_timestamp()+end_offset
FROM (VALUES(1,interval '-20 minutes',interval '-10 minutes'),(2,interval '10 minutes',interval '20 minutes'),(3,interval '-1 minute',interval '9 minutes')) AS cases(n,start_offset,end_offset);
INSERT INTO public.sessions(code,teacher_id,subject,group_name,date,start_time,end_time)
VALUES('MIDNIGHT','70000000-0000-4000-8000-000000000001','Test','CLEANUPTEST',(now() AT TIME ZONE 'America/Bogota')::date,'23:55','00:05');
DO $$ BEGIN
 IF (SELECT registration_closes_at-registration_opens_at FROM public.sessions WHERE code='MIDNIGHT')<>interval '10 minutes' THEN RAISE EXCEPTION 'FAIL midnight window'; END IF;
 IF has_function_privilege('authenticated','public.clear_test_activity(uuid,text)','EXECUTE') OR has_function_privilege('anon','public.clear_test_activity(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL cleanup exposed'; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ BEGIN
 IF (public.register_student_attendance('WINDOW-1','CLEANUP001')->>'code')<>'OUTSIDE_TIME_WINDOW' THEN RAISE EXCEPTION 'FAIL expired window allowed within old tolerance'; END IF;
 IF (public.register_student_attendance('WINDOW-2','CLEANUP001')->>'code')<>'OUTSIDE_TIME_WINDOW' THEN RAISE EXCEPTION 'FAIL early window allowed within old tolerance'; END IF;
 IF (public.register_student_attendance('WINDOW-3','CLEANUP001')->>'success')<>'true' THEN RAISE EXCEPTION 'FAIL valid window denied'; END IF;
 BEGIN INSERT INTO public.attendances(session_id,student_id,method) SELECT id,'80000000-0000-4000-8000-000000000001','QR' FROM public.sessions WHERE code='WINDOW-1'; RAISE EXCEPTION 'FAIL direct QR outside window'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.clear_test_activity('70000000-0000-4000-8000-000000000002','wrong'); RAISE EXCEPTION 'FAIL confirmation ignored'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.clear_test_activity('70000000-0000-4000-8000-000000000001','BORRAR SESIONES DE PRUEBA'); RAISE EXCEPTION 'FAIL teacher actor allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
CREATE TEMP TABLE retained_counts AS SELECT (SELECT count(*) FROM public.students) students,(SELECT count(*) FROM public.profiles) profiles,(SELECT count(*) FROM public.teaching_assignments) assignments,(SELECT count(*) FROM public.enrollments) enrollments,(SELECT count(*) FROM public.school_groups) groups;
SET LOCAL ROLE service_role;
SELECT public.verify_test_activity_cleanup('70000000-0000-4000-8000-000000000002','BORRAR SESIONES DE PRUEBA');
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sessions WHERE code='WINDOW-3') OR NOT EXISTS(SELECT 1 FROM public.attendances) THEN RAISE EXCEPTION 'FAIL verification committed cleanup'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_events WHERE action='test_activity.clear') THEN RAISE EXCEPTION 'FAIL verification left audit changes'; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT public.clear_test_activity('70000000-0000-4000-8000-000000000002','BORRAR SESIONES DE PRUEBA');
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sessions) OR EXISTS(SELECT 1 FROM public.attendances) OR EXISTS(SELECT 1 FROM public.incidents) OR EXISTS(SELECT 1 FROM public.session_roster) THEN RAISE EXCEPTION 'FAIL activity remains'; END IF;
 IF EXISTS(SELECT 1 FROM retained_counts WHERE students<>(SELECT count(*) FROM public.students) OR profiles<>(SELECT count(*) FROM public.profiles) OR assignments<>(SELECT count(*) FROM public.teaching_assignments) OR enrollments<>(SELECT count(*) FROM public.enrollments) OR groups<>(SELECT count(*) FROM public.school_groups)) THEN RAISE EXCEPTION 'FAIL school data changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_events WHERE action='test_activity.clear' AND actor_id='70000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'FAIL cleanup not audited'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_events WHERE action='attendances.insert') THEN RAISE EXCEPTION 'FAIL security history removed'; END IF;
END $$;
SELECT 'Strict windows, midnight, restricted cleanup and retained school data passed' result;
ROLLBACK;

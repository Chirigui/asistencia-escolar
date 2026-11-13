BEGIN;
-- Isolated identities and records; ROLLBACK always removes the fixtures.
INSERT INTO auth.users(id,email) VALUES ('10000000-0000-4000-8000-000000000001','teacher-a@example.invalid'),('10000000-0000-4000-8000-000000000002','teacher-b@example.invalid'),('10000000-0000-4000-8000-000000000003','admin@example.invalid');
UPDATE public.profiles SET role='admin' WHERE id='10000000-0000-4000-8000-000000000003';
INSERT INTO public.students(id,document,document_normalized,full_name,grade,group_name) VALUES ('20000000-0000-4000-8000-000000000001','TEST90001','TEST90001','Test Student','TEST','TEST-A'),('20000000-0000-4000-8000-000000000002','TEST90002','TEST90002','QR Student','TEST','TEST-A'),('20000000-0000-4000-8000-000000000003','TEST90003','TEST90003','Other Student','TEST','TEST-B');
INSERT INTO public.teaching_assignments(period_id,teacher_id,group_id) SELECT p.id,'10000000-0000-4000-8000-000000000001',g.id FROM public.academic_periods p CROSS JOIN public.school_groups g WHERE p.active AND g.normalized_name='TESTA';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
INSERT INTO public.sessions(id,code,teacher_id,subject,group_name,date,start_time,end_time) VALUES ('30000000-0000-4000-8000-000000000001','TEST-SESSION','10000000-0000-4000-8000-000000000001','Test subject','TESTA',(now() AT TIME ZONE 'America/Bogota')::date,'00:00','23:59');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.session_roster WHERE session_id='30000000-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'FAIL: positive roster read'; END IF;
 IF (SELECT public.record_manual_attendance('30000000-0000-4000-8000-000000000001','TEST90001','PRESENTE','Test reason')->>'success')<>'true' THEN RAISE EXCEPTION 'FAIL: positive manual attendance'; END IF;
 IF (SELECT public.record_manual_attendance('30000000-0000-4000-8000-000000000001','TEST90001','PRESENTE','Retry')->>'code')<>'ALREADY_REGISTERED' THEN RAISE EXCEPTION 'FAIL: duplicate attendance'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_events WHERE action='attendances.insert' AND actor_id=auth.uid()) THEN RAISE EXCEPTION 'FAIL: atomic audit'; END IF;
 BEGIN UPDATE public.profiles SET role='admin' WHERE id=auth.uid(); RAISE EXCEPTION 'FAIL: role escalation'; EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
 BEGIN UPDATE public.audit_events SET action='forged'; RAISE EXCEPTION 'FAIL: mutable audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Force the audit trigger to fail; the attendance must not survive its subtransaction.
SELECT set_config('request.headers','not-json',true);
DO $$ BEGIN
 BEGIN PERFORM public.record_manual_attendance('30000000-0000-4000-8000-000000000001','TEST90002','PRESENTE','Atomic check'); RAISE EXCEPTION 'FAIL: audit failure not raised'; EXCEPTION WHEN invalid_text_representation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.attendances WHERE student_id='20000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'FAIL: audit failure left attendance'; END IF;
END $$;
SELECT set_config('request.headers','{}',true);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true);
DO $$ BEGIN
 IF (public.register_student_attendance('TEST-SESSION','TEST90002')->>'success')<>'true' THEN RAISE EXCEPTION 'FAIL: valid QR registration'; END IF;
 IF public.register_student_attendance('TEST-SESSION','TEST90002')->>'code'<>'ALREADY_REGISTERED' THEN RAISE EXCEPTION 'FAIL: QR duplicate'; END IF;
 IF public.register_student_attendance('TEST-SESSION','TEST90003')->>'code'<>'GROUP_MISMATCH' THEN RAISE EXCEPTION 'FAIL: QR foreign roster'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sessions WHERE id='30000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: foreign session visible'; END IF;
 IF EXISTS(SELECT 1 FROM public.session_roster WHERE session_id='30000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: foreign roster visible'; END IF;
 BEGIN PERFORM public.record_manual_attendance('30000000-0000-4000-8000-000000000001','TEST90001','PRESENTE','Forged'); RAISE EXCEPTION 'FAIL: foreign write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.sessions(code,teacher_id,subject,group_name,date,start_time,end_time) VALUES('TEST-FORGED',auth.uid(),'Forged','TESTA',current_date,'00:00','23:59'); RAISE EXCEPTION 'FAIL: unassigned group'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.students SET group_name='TEST-B' WHERE id='20000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.session_roster WHERE student_id='20000000-0000-4000-8000-000000000001' AND group_name='TEST-A') THEN RAISE EXCEPTION 'FAIL: historical roster changed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
UPDATE public.sessions SET status='CERRADA' WHERE id='30000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 BEGIN PERFORM public.record_manual_attendance('30000000-0000-4000-8000-000000000001','TEST90001','PRESENTE','Closed'); RAISE EXCEPTION 'FAIL: closed session accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sessions) THEN RAISE EXCEPTION 'FAIL: anon session read'; END IF;
 IF has_function_privilege(current_user,'public.register_student_attendance(text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: public QR RPC'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF NOT (public.consume_request_limit(repeat('a',64),1,60)->>'allowed')::boolean THEN RAISE EXCEPTION 'FAIL: first request blocked'; END IF;
 IF (public.consume_request_limit(repeat('a',64),1,60)->>'allowed')::boolean THEN RAISE EXCEPTION 'FAIL: repeated request allowed'; END IF;
END $$;
RESET ROLE;
SELECT 'RLS, roster, assignment, audit, duplicate, closed-session and distributed-limit checks passed' result;
ROLLBACK;

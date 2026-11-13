-- Compatible expansion: existing rows retained. New authorization uses assignments.
BEGIN;
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.normalize_group(p_group text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$ SELECT upper(regexp_replace(coalesce(p_group,''),'[[:space:]_-]','','g')); $$;
ALTER TABLE public.attendances ADD COLUMN IF NOT EXISTS marked_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES public.profiles(id);
CREATE TABLE public.academic_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 starts_on date NOT NULL, ends_on date NOT NULL, active boolean NOT NULL DEFAULT false,
 CHECK (ends_on>=starts_on));
CREATE UNIQUE INDEX one_active_period ON public.academic_periods(active) WHERE active;
INSERT INTO public.academic_periods(name,starts_on,ends_on,active)
VALUES (extract(year from current_date)::text, date_trunc('year',current_date)::date, (date_trunc('year',current_date)+interval '1 year - 1 day')::date,true);
CREATE TABLE public.school_groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, normalized_name text GENERATED ALWAYS AS (public.normalize_group(name)) STORED UNIQUE, CHECK(length(name) BETWEEN 1 AND 40));
INSERT INTO public.school_groups(name) SELECT DISTINCT public.normalize_group(group_name) FROM (SELECT group_name FROM public.students UNION SELECT group_name FROM public.sessions) x WHERE public.normalize_group(group_name)<>'';
CREATE TABLE public.enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid NOT NULL REFERENCES public.academic_periods(id),
 student_id uuid NOT NULL REFERENCES public.students(id), group_id uuid NOT NULL REFERENCES public.school_groups(id),
 valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz, CHECK(valid_to IS NULL OR valid_to>=valid_from));
CREATE UNIQUE INDEX one_current_enrollment ON public.enrollments(period_id,student_id) WHERE valid_to IS NULL;
CREATE INDEX enrollments_group_idx ON public.enrollments(group_id,period_id) WHERE valid_to IS NULL;
CREATE INDEX enrollments_student_idx ON public.enrollments(student_id);
CREATE TABLE public.teaching_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid NOT NULL REFERENCES public.academic_periods(id),
 teacher_id uuid NOT NULL REFERENCES public.profiles(id), group_id uuid NOT NULL REFERENCES public.school_groups(id),
 UNIQUE(period_id,teacher_id,group_id));
CREATE INDEX assignments_teacher_idx ON public.teaching_assignments(teacher_id,period_id);
CREATE INDEX assignments_group_idx ON public.teaching_assignments(group_id);
INSERT INTO public.enrollments(period_id,student_id,group_id)
SELECT p.id,s.id,g.id FROM public.students s JOIN public.school_groups g ON g.normalized_name=public.normalize_group(s.group_name) CROSS JOIN public.academic_periods p WHERE p.active AND s.status='ACTIVO';
INSERT INTO public.teaching_assignments(period_id,teacher_id,group_id)
SELECT DISTINCT p.id,s.teacher_id,g.id FROM public.sessions s JOIN public.school_groups g ON g.normalized_name=public.normalize_group(s.group_name) CROSS JOIN public.academic_periods p WHERE p.active AND s.teacher_id IS NOT NULL;
ALTER TABLE public.sessions ADD COLUMN group_id uuid REFERENCES public.school_groups(id), ADD COLUMN period_id uuid REFERENCES public.academic_periods(id), ADD COLUMN qr_token_required boolean NOT NULL DEFAULT false;
UPDATE public.sessions s SET group_id=g.id,period_id=p.id FROM public.school_groups g CROSS JOIN public.academic_periods p WHERE g.normalized_name=public.normalize_group(s.group_name) AND p.active;
UPDATE public.sessions SET group_name=public.normalize_group(group_name);
CREATE INDEX sessions_group_period_idx ON public.sessions(group_id,period_id);
CREATE INDEX sessions_period_idx ON public.sessions(period_id);
CREATE INDEX sessions_page_idx ON public.sessions(created_at DESC,id DESC);
CREATE INDEX sessions_teacher_page_idx ON public.sessions(teacher_id,created_at DESC,id DESC);
CREATE INDEX attendances_page_idx ON public.attendances(registered_at DESC,id DESC);
CREATE TABLE public.session_roster (
 session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
 student_id uuid NOT NULL REFERENCES public.students(id), document text NOT NULL, document_normalized text NOT NULL,
 full_name text NOT NULL, grade text NOT NULL, group_name text NOT NULL,
 source text NOT NULL CHECK(source IN ('CREATION','BACKFILL')), PRIMARY KEY(session_id,student_id));
CREATE INDEX roster_student_idx ON public.session_roster(student_id);
INSERT INTO public.session_roster SELECT se.id,s.id,s.document,s.document_normalized,s.full_name,s.grade,s.group_name,'BACKFILL'
FROM public.sessions se JOIN public.students s ON public.normalize_group(s.group_name)=public.normalize_group(se.group_name) WHERE s.status='ACTIVO';
-- Include legacy attendance even when a student's current group differs.
INSERT INTO public.session_roster SELECT a.session_id,s.id,s.document,s.document_normalized,s.full_name,s.grade,s.group_name,'BACKFILL' FROM public.attendances a JOIN public.students s ON s.id=a.student_id ON CONFLICT DO NOTHING;
ALTER TABLE public.attendances ADD CONSTRAINT attendances_roster_fkey FOREIGN KEY(session_id,student_id) REFERENCES public.session_roster(session_id,student_id);
CREATE TABLE public.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid REFERENCES public.profiles(id), session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
 entity_id uuid NOT NULL, action text NOT NULL, before_value jsonb, after_value jsonb,
 request_id text);
CREATE INDEX audit_session_idx ON public.audit_events(session_id,occurred_at DESC);
CREATE INDEX audit_actor_idx ON public.audit_events(actor_id);
CREATE OR REPLACE FUNCTION app_private.current_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT role FROM public.profiles WHERE id=auth.uid(); $$;
CREATE OR REPLACE FUNCTION app_private.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce(app_private.current_role()='admin',false); $$;
CREATE OR REPLACE FUNCTION app_private.can_manage_session(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.sessions WHERE id=p_id AND (teacher_id=auth.uid() OR app_private.is_admin())); $$;
CREATE OR REPLACE FUNCTION app_private.can_access_group(p_group text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT auth.uid() IS NOT NULL AND (app_private.is_admin() OR EXISTS(SELECT 1 FROM public.teaching_assignments a JOIN public.school_groups g ON g.id=a.group_id JOIN public.academic_periods p ON p.id=a.period_id WHERE a.teacher_id=auth.uid() AND p.active AND g.normalized_name=public.normalize_group(p_group))); $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.is_admin(); $$;
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.current_role(); $$;
CREATE OR REPLACE FUNCTION public.is_authenticated_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT coalesce(app_private.current_role() IN ('admin','teacher'),false); $$;
CREATE OR REPLACE FUNCTION public.can_manage_session(p_session_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.can_manage_session(p_session_id); $$;
CREATE OR REPLACE FUNCTION public.can_access_group(p_group text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.can_access_group(p_group); $$;

DO $$ DECLARE t record; BEGIN FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal AND tgfoid IN (SELECT p.oid FROM pg_proc p WHERE p.proname IN ('prevent_profile_role_change','prevent_profile_role_escalation')) LOOP EXECUTE format('DROP TRIGGER %I ON public.profiles',t.tgname); END LOOP; END $$;
CREATE OR REPLACE FUNCTION app_private.guard_profile_role() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 IF NEW.role IS DISTINCT FROM OLD.role AND current_user NOT IN ('postgres','service_role','supabase_admin') AND NOT app_private.is_admin() THEN RAISE EXCEPTION 'Only admins may change roles' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_profile_role BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_role();

-- Remove all historical policies before installing one consistent set.
DO $$ DECLARE x record; BEGIN FOR x IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('profiles','students','sessions','attendances','incidents') LOOP EXECUTE format('DROP POLICY %I ON public.%I',x.policyname,x.tablename); END LOOP; END $$;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING(id=(SELECT auth.uid()) OR (SELECT public.is_admin()));
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING(id=(SELECT auth.uid()) OR (SELECT public.is_admin())) WITH CHECK((id=(SELECT auth.uid()) AND role=(SELECT public.current_user_role())) OR (SELECT public.is_admin()));
CREATE POLICY profiles_admin ON public.profiles FOR INSERT TO authenticated WITH CHECK((SELECT public.is_admin()));
CREATE POLICY students_read ON public.students FOR SELECT TO authenticated USING(public.can_access_group(group_name));
CREATE POLICY students_admin ON public.students FOR ALL TO authenticated USING((SELECT public.is_admin())) WITH CHECK((SELECT public.is_admin()));
CREATE POLICY sessions_read ON public.sessions FOR SELECT TO authenticated USING(teacher_id=(SELECT auth.uid()) OR (SELECT public.is_admin()));
CREATE POLICY sessions_create ON public.sessions FOR INSERT TO authenticated WITH CHECK(public.is_authenticated_staff() AND teacher_id=(SELECT auth.uid()) AND public.can_access_group(group_name));
CREATE POLICY sessions_update ON public.sessions FOR UPDATE TO authenticated USING(public.can_manage_session(id)) WITH CHECK(public.can_manage_session(id));
CREATE POLICY attendance_read ON public.attendances FOR SELECT TO authenticated USING(public.can_manage_session(session_id));
CREATE POLICY attendance_write ON public.attendances FOR ALL TO authenticated USING(public.can_manage_session(session_id)) WITH CHECK(public.can_manage_session(session_id));
CREATE POLICY incidents_read ON public.incidents FOR SELECT TO authenticated USING(public.can_manage_session(session_id) OR (SELECT public.is_admin()));
-- No direct client writes to incidents: attendance audit is transactionally generated.
ALTER TABLE public.academic_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY periods_read ON public.academic_periods FOR SELECT TO authenticated USING(public.is_authenticated_staff());
CREATE POLICY periods_admin ON public.academic_periods FOR ALL TO authenticated USING((SELECT public.is_admin())) WITH CHECK((SELECT public.is_admin()));
CREATE POLICY groups_read ON public.school_groups FOR SELECT TO authenticated USING(public.can_access_group(name));
CREATE POLICY groups_admin ON public.school_groups FOR ALL TO authenticated USING((SELECT public.is_admin())) WITH CHECK((SELECT public.is_admin()));
CREATE POLICY enrollments_read ON public.enrollments FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.school_groups g WHERE g.id=group_id AND public.can_access_group(g.name)));
CREATE POLICY enrollments_admin ON public.enrollments FOR ALL TO authenticated USING((SELECT public.is_admin())) WITH CHECK((SELECT public.is_admin()));
CREATE POLICY assignments_read ON public.teaching_assignments FOR SELECT TO authenticated USING(teacher_id=(SELECT auth.uid()) OR (SELECT public.is_admin()));
CREATE POLICY assignments_admin ON public.teaching_assignments FOR ALL TO authenticated USING((SELECT public.is_admin())) WITH CHECK((SELECT public.is_admin()));
CREATE POLICY roster_read ON public.session_roster FOR SELECT TO authenticated USING(public.can_manage_session(session_id));
CREATE POLICY audit_read ON public.audit_events FOR SELECT TO authenticated USING(public.can_manage_session(session_id) OR (SELECT public.is_admin()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.academic_periods,public.school_groups,public.enrollments,public.teaching_assignments TO authenticated;
GRANT SELECT ON public.session_roster,public.audit_events TO authenticated;
GRANT ALL ON public.academic_periods,public.school_groups,public.enrollments,public.teaching_assignments,public.session_roster,public.audit_events TO service_role;
REVOKE ALL ON public.session_roster,public.audit_events FROM anon;
CREATE OR REPLACE FUNCTION app_private.sync_enrollment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p uuid; g uuid;
BEGIN
 SELECT id INTO p FROM public.academic_periods WHERE active;
 IF p IS NULL THEN RAISE EXCEPTION 'No active academic period'; END IF;
 IF TG_OP='UPDATE' AND NEW.status=OLD.status AND public.normalize_group(NEW.group_name)=public.normalize_group(OLD.group_name) THEN RETURN NEW; END IF;
 UPDATE public.enrollments SET valid_to=clock_timestamp() WHERE student_id=NEW.id AND period_id=p AND valid_to IS NULL;
 IF NEW.status='ACTIVO' THEN
 INSERT INTO public.school_groups(name) VALUES(public.normalize_group(NEW.group_name)) ON CONFLICT(normalized_name) DO UPDATE SET name=excluded.name RETURNING id INTO g;
 INSERT INTO public.enrollments(period_id,student_id,group_id) VALUES(p,NEW.id,g);
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER sync_enrollment AFTER INSERT OR UPDATE OF status,group_name ON public.students FOR EACH ROW EXECUTE FUNCTION app_private.sync_enrollment();
CREATE OR REPLACE FUNCTION app_private.prepare_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 SELECT id INTO NEW.period_id FROM public.academic_periods WHERE active AND NEW.date BETWEEN starts_on AND ends_on;
 SELECT id INTO NEW.group_id FROM public.school_groups WHERE normalized_name=public.normalize_group(NEW.group_name);
 IF NEW.period_id IS NULL OR NEW.group_id IS NULL THEN RAISE EXCEPTION 'Invalid academic period or group' USING ERRCODE='23514'; END IF;
 IF auth.uid() IS NOT NULL AND NOT (app_private.is_admin() OR EXISTS(SELECT 1 FROM public.teaching_assignments WHERE period_id=NEW.period_id AND group_id=NEW.group_id AND teacher_id=auth.uid())) THEN RAISE EXCEPTION 'Group not assigned' USING ERRCODE='42501'; END IF;
 NEW.group_name:=public.normalize_group(NEW.group_name); RETURN NEW;
END $$;
CREATE TRIGGER prepare_session BEFORE INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION app_private.prepare_session();
CREATE OR REPLACE FUNCTION app_private.capture_roster() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 INSERT INTO public.session_roster SELECT NEW.id,s.id,s.document,s.document_normalized,s.full_name,s.grade,s.group_name,'CREATION' FROM public.enrollments e JOIN public.students s ON s.id=e.student_id WHERE e.period_id=NEW.period_id AND e.group_id=NEW.group_id AND e.valid_to IS NULL AND s.status='ACTIVO'; RETURN NEW;
END $$;
CREATE TRIGGER capture_roster AFTER INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION app_private.capture_roster();
CREATE OR REPLACE FUNCTION app_private.guard_session_update() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF OLD.status='FINALIZADA' AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'Finalized session cannot reopen' USING ERRCODE='23514'; END IF;
 IF NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.period_id IS DISTINCT FROM OLD.period_id OR NEW.group_name IS DISTINCT FROM OLD.group_name OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id THEN RAISE EXCEPTION 'Session ownership and roster are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_session_update BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION app_private.guard_session_update();
CREATE OR REPLACE FUNCTION app_private.guard_attendance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE se public.sessions; st public.students;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.session_id<>OLD.session_id OR NEW.student_id<>OLD.student_id OR NEW.method<>OLD.method) THEN RAISE EXCEPTION 'Attendance identity is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO se FROM public.sessions WHERE id=NEW.session_id FOR SHARE;
 IF NOT FOUND OR se.status<>'ABIERTA' THEN RAISE EXCEPTION 'Session closed' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.session_roster WHERE session_id=se.id AND student_id=NEW.student_id) THEN RAISE EXCEPTION 'Student not in session roster' USING ERRCODE='23514'; END IF;
 SELECT * INTO st FROM public.students WHERE id=NEW.student_id;
 IF st.status<>'ACTIVO' THEN RAISE EXCEPTION 'Inactive student' USING ERRCODE='23514'; END IF;
 IF length(coalesce(NEW.notes,''))>500 THEN RAISE EXCEPTION 'Notes too long' USING ERRCODE='23514'; END IF;
 IF NEW.method='ADMIN' AND NOT app_private.is_admin() THEN RAISE EXCEPTION 'Admin method restricted' USING ERRCODE='42501'; END IF;
 IF NEW.method<>'QR' THEN
 IF NOT app_private.can_manage_session(se.id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 NEW.marked_by:=auth.uid();
 ELSE
 IF TG_OP='INSERT' AND auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'QR is server only' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_attendance BEFORE INSERT OR UPDATE ON public.attendances FOR EACH ROW EXECUTE FUNCTION app_private.guard_attendance();
CREATE OR REPLACE FUNCTION app_private.audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_row jsonb; after_row jsonb; sid uuid; eid uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
 eid:=coalesce((after_row->>'id')::uuid,(before_row->>'id')::uuid);
 sid:=CASE WHEN TG_TABLE_NAME='sessions' THEN eid ELSE coalesce((after_row->>'session_id')::uuid,(before_row->>'session_id')::uuid) END;
 INSERT INTO public.audit_events(actor_id,session_id,entity_id,action,before_value,after_value,request_id)
 VALUES(auth.uid(),sid,eid,TG_TABLE_NAME||'.'||lower(TG_OP),jsonb_build_object('status',before_row->'status','method',before_row->'method','notes',before_row->'notes','group',before_row->'group_name','groupId',before_row->'group_id','periodId',before_row->'period_id','teacherId',before_row->'teacher_id'),jsonb_build_object('status',after_row->'status','method',after_row->'method','notes',after_row->'notes','group',after_row->'group_name','groupId',after_row->'group_id','periodId',after_row->'period_id','teacherId',after_row->'teacher_id'),nullif(current_setting('request.headers',true),'')::jsonb->>'x-request-id');
 IF TG_TABLE_NAME='attendances' THEN
 IF TG_OP='INSERT' AND NEW.method<>'QR' THEN INSERT INTO public.incidents(session_id,student_id,incident_type,details,actor_id) VALUES(NEW.session_id,NEW.student_id,'REGISTRO_MANUAL_DOCENTE',NEW.notes,auth.uid()); END IF; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER audit_attendance AFTER INSERT OR UPDATE OR DELETE ON public.attendances FOR EACH ROW EXECUTE FUNCTION app_private.audit_change();
CREATE TRIGGER audit_session AFTER INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION app_private.audit_change();
CREATE TRIGGER audit_student AFTER INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION app_private.audit_change();
CREATE TRIGGER audit_assignment AFTER INSERT OR UPDATE OR DELETE ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION app_private.audit_change();
CREATE TRIGGER audit_period AFTER INSERT OR UPDATE ON public.academic_periods FOR EACH ROW EXECUTE FUNCTION app_private.audit_change();
CREATE OR REPLACE FUNCTION public.record_manual_attendance(p_session_id uuid,p_document text,p_status text,p_notes text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE sid uuid; aid uuid;
BEGIN
 IF NOT public.can_manage_session(p_session_id) THEN RAISE EXCEPTION 'Session not found' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('PRESENTE','TARDE','JUSTIFICADO') OR length(p_notes)>500 THEN RAISE EXCEPTION 'Invalid attendance' USING ERRCODE='23514'; END IF;
 SELECT student_id INTO sid FROM public.session_roster WHERE session_id=p_session_id AND upper(document_normalized)=upper(p_document);
 IF sid IS NULL THEN RAISE EXCEPTION 'Student not in roster' USING ERRCODE='23514'; END IF;
 INSERT INTO public.attendances(session_id,student_id,status,method,notes) VALUES(p_session_id,sid,p_status,'MANUAL',p_notes) ON CONFLICT(session_id,student_id) DO NOTHING RETURNING id INTO aid;
 RETURN jsonb_build_object('success',aid IS NOT NULL,'code',CASE WHEN aid IS NULL THEN 'ALREADY_REGISTERED' ELSE 'REGISTERED' END,'attendanceId',aid);
END $$;
CREATE TABLE app_private.request_buckets(bucket text PRIMARY KEY, window_started_at timestamptz NOT NULL, attempts integer NOT NULL);
ALTER TABLE app_private.request_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.request_buckets FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION app_private.consume_limit(p_bucket text,p_limit integer,p_seconds integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b app_private.request_buckets;
BEGIN
 IF length(p_bucket)<>64 OR p_limit NOT BETWEEN 1 AND 10000 OR p_seconds NOT BETWEEN 1 AND 3600 THEN RAISE EXCEPTION 'Invalid rate limit parameters'; END IF;
 INSERT INTO app_private.request_buckets VALUES(p_bucket,clock_timestamp(),1) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN app_private.request_buckets.window_started_at<clock_timestamp()-make_interval(secs=>p_seconds) THEN 1 ELSE app_private.request_buckets.attempts+1 END,window_started_at=CASE WHEN app_private.request_buckets.window_started_at<clock_timestamp()-make_interval(secs=>p_seconds) THEN clock_timestamp() ELSE app_private.request_buckets.window_started_at END RETURNING * INTO b;
 DELETE FROM app_private.request_buckets WHERE bucket IN (SELECT bucket FROM app_private.request_buckets WHERE window_started_at<clock_timestamp()-interval '2 hours' LIMIT 100);
 RETURN jsonb_build_object('allowed',b.attempts<=p_limit,'retryAfterSeconds',greatest(1,ceil(extract(epoch FROM b.window_started_at+make_interval(secs=>p_seconds)-clock_timestamp()))::integer));
END $$;
CREATE OR REPLACE FUNCTION public.consume_request_limit(p_bucket text,p_limit integer,p_seconds integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.consume_limit(p_bucket,p_limit,p_seconds); $$;
-- Counts are computed server-side from the immutable session roster, under RLS.
CREATE OR REPLACE FUNCTION public.session_counts(p_ids uuid[]) RETURNS TABLE(session_id uuid,total bigint,presents bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT s.id,(SELECT count(*) FROM public.session_roster r WHERE r.session_id=s.id),(SELECT count(*) FROM public.attendances a WHERE a.session_id=s.id) FROM public.sessions s WHERE s.id=ANY(p_ids) AND cardinality(p_ids)<=101; $$;
CREATE OR REPLACE FUNCTION app_private.register_student_attendance(
    p_session_code TEXT,
    p_document_normalized TEXT,
    p_ip TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecuta con privilegios elevados para validar sin exponer toda la tabla de estudiantes
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session RECORD;
    v_student RECORD;
    v_session_code TEXT;
    v_document TEXT;
    v_now_ts TIMESTAMP;
    v_now_date DATE;
    v_window_start TIMESTAMP;
    v_window_end TIMESTAMP;
    v_attendance_id UUID;
BEGIN
    -- Normalización defensiva: la API normaliza, pero la función también puede
    -- recibir llamadas directas.
    v_session_code := upper(btrim(coalesce(p_session_code, '')));
    v_document := regexp_replace(
        upper(btrim(coalesce(p_document_normalized, ''))),
        '[^A-Z0-9]',
        '',
        'g'
    );

    -- 1. Buscar sesión por código
    SELECT * INTO v_session
    FROM public.sessions
    WHERE upper(btrim(code)) = v_session_code
    LIMIT 1 FOR SHARE;

    IF NOT FOUND THEN
        INSERT INTO public.incidents (document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (NULL, 'SESION_NO_EXISTE', 'Intento con código: ' || left(v_session_code, 32), NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_NOT_FOUND',
            'message', 'La sesión especificada no existe.'
        );
    END IF;

    -- Validar estado de la sesión
    IF v_session.status <> 'ABIERTA' THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, NULL, 'FUERA_HORARIO', 'Sesión cerrada o finalizada', NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_CLOSED',
            'message', 'La sesión está cerrada para registro de asistencia.'
        );
    END IF;

    -- Ventana de registro: 15 minutos antes del inicio y 15 después del fin.
    -- Se construyen timestamps con la fecha de la sesión para evitar que la
    -- aritmética de TIME cruce la medianoche de forma incorrecta.
    v_now_ts := CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota';
    v_now_date := v_now_ts::DATE;
    v_window_start := (v_session.date + v_session.start_time) - INTERVAL '15 minutes';
    v_window_end := (v_session.date + v_session.end_time) + INTERVAL '15 minutes';

    IF v_session.date <> v_now_date THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, NULL, 'FECHA_INVALIDA', 'Fecha sesión: ' || v_session.date || ' vs hoy: ' || v_now_date, NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'DATE_MISMATCH',
            'message', 'La sesión no corresponde a la fecha de hoy.'
        );
    END IF;

    IF v_now_ts < v_window_start OR v_now_ts > v_window_end THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (
            v_session.id,
            NULL,
            'FUERA_HORARIO',
            'Fuera de ventana: ' || v_window_start || ' a ' || v_window_end,
            NULL,
            NULL
        );

        RETURN jsonb_build_object(
            'success', false,
            'code', 'OUTSIDE_TIME_WINDOW',
            'message', 'La ventana de registro de esta clase no está abierta.'
        );
    END IF;

    -- 2. Buscar estudiante
    SELECT * INTO v_student
    FROM public.students
    WHERE upper(document_normalized) = v_document
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.incidents (session_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, NULL, 'NO_ENCONTRADO', 'Documento no registrado en el padrón', NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_NOT_FOUND',
            'message', 'El documento no se encuentra registrado en el colegio.'
        );
    END IF;

    IF v_student.status <> 'ACTIVO' THEN
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, NULL, 'INACTIVO', 'Estado: ' || v_student.status, NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_INACTIVE',
            'message', 'El estudiante está inactivo en el sistema. Consulta con coordinación.'
        );
    END IF;

    -- El estudiante sólo puede registrarse en sesiones de su propio grupo.
    IF NOT EXISTS (SELECT 1 FROM public.session_roster WHERE session_id=v_session.id AND student_id=v_student.id) THEN
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, NULL, 'GRUPO_INVALIDO', 'Grupo del estudiante distinto al de la sesión', NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'GROUP_MISMATCH',
            'message', 'Tu documento no corresponde al grupo de esta clase.'
        );
    END IF;

    -- 3. Intentar insertar asistencia (previniendo concurrencia mediante cláusula ON CONFLICT)
    INSERT INTO public.attendances (session_id, student_id, status, method)
    VALUES (v_session.id, v_student.id, 'PRESENTE', 'QR')
    ON CONFLICT (session_id, student_id) DO NOTHING
    RETURNING id INTO v_attendance_id;

    IF v_attendance_id IS NULL THEN
        -- Ya existía el registro. No se devuelve el nombre para no filtrar PII
        -- a quien prueba documentos ajenos.
        INSERT INTO public.incidents (session_id, student_id, document_attempted, incident_type, details, ip_address, user_agent)
        VALUES (v_session.id, v_student.id, NULL, 'DUPLICADO', 'Intento reiterado de asistencia', NULL, NULL);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'ALREADY_REGISTERED',
            'message', '¡Ya estás registrado! Tu asistencia en esta clase ya fue recibida.'
        );
    END IF;

    -- Registro exitoso
    RETURN jsonb_build_object(
        'success', true,
        'code', 'REGISTERED',
        'message', 'Asistencia registrada con éxito.',
        'data', jsonb_build_object(
            'attendanceId', v_attendance_id,
            'studentName', v_student.full_name,
            'grade', v_student.grade,
            'group', v_student.group_name,
            'subject', v_session.subject,
            'registeredAt', now()
        )
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.register_student_attendance(p_session_code text,p_document_normalized text,p_ip text DEFAULT NULL,p_user_agent text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.register_student_attendance(p_session_code,p_document_normalized,p_ip,p_user_agent); $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.current_role(),app_private.is_admin(),app_private.can_access_group(text),app_private.can_manage_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consume_limit(text,integer,integer),app_private.register_student_attendance(text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.is_admin(),public.current_user_role(),public.is_authenticated_staff(),public.can_manage_session(uuid),public.can_access_group(text),public.record_manual_attendance(uuid,text,text,text),public.session_counts(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_admin(),public.current_user_role(),public.is_authenticated_staff(),public.can_manage_session(uuid),public.can_access_group(text),public.record_manual_attendance(uuid,text,text,text),public.session_counts(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.consume_request_limit(text,integer,integer),public.register_student_attendance(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_request_limit(text,integer,integer),public.register_student_attendance(text,text,text,text) TO service_role;
REVOKE DELETE ON public.attendances FROM authenticated;

CREATE OR REPLACE FUNCTION public.activate_academic_period(p_name text,p_start date,p_end date,p_copy_assignments boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_id uuid; new_id uuid;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 IF p_end<p_start OR length(p_name) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='23514'; END IF;
 SELECT id INTO old_id FROM public.academic_periods WHERE active FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.sessions WHERE status='ABIERTA') THEN RAISE EXCEPTION 'Close open sessions before activating a period' USING ERRCODE='23514'; END IF;
 UPDATE public.academic_periods SET active=false WHERE id=old_id;
 INSERT INTO public.academic_periods(name,starts_on,ends_on,active) VALUES(p_name,p_start,p_end,true) RETURNING id INTO new_id;
 INSERT INTO public.enrollments(period_id,student_id,group_id) SELECT new_id,student_id,group_id FROM public.enrollments WHERE period_id=old_id AND valid_to IS NULL;
 IF p_copy_assignments THEN INSERT INTO public.teaching_assignments(period_id,teacher_id,group_id) SELECT new_id,teacher_id,group_id FROM public.teaching_assignments WHERE period_id=old_id; END IF;
 RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.activate_academic_period(text,date,date,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_academic_period(text,date,date,boolean) TO authenticated;
DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('mark_attendance_manual','update_attendance_with_audit','undo_attendance_with_audit','get_absence_report','get_absence_report_count','get_active_student_counts_by_group','get_group_name_variants') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature); END LOOP; END $$;

COMMENT ON TABLE public.session_roster IS 'Immutable attendance denominator. BACKFILL rows reconstruct membership from current data and are not proof of historical enrollment.';
COMMIT;

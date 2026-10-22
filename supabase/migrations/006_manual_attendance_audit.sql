ALTER TABLE public.attendances
  ADD COLUMN IF NOT EXISTS marked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.mark_attendance_manual(
  p_session_id uuid, p_student_id uuid, p_status text, p_notes text, p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_attendance public.attendances%ROWTYPE;
BEGIN
  INSERT INTO public.attendances(session_id, student_id, status, method, notes, marked_by)
  VALUES (p_session_id, p_student_id, p_status, 'MANUAL', p_notes, p_actor_id)
  RETURNING * INTO v_attendance;
  INSERT INTO public.incidents(session_id, student_id, document_attempted, incident_type, details, actor_id)
  SELECT p_session_id, p_student_id, s.document_normalized, 'REGISTRO_MANUAL_DOCENTE', COALESCE(p_notes, 'Marcado manual en panel docente'), p_actor_id
  FROM public.students s WHERE s.id = p_student_id;
  RETURN to_jsonb(v_attendance);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_attendance_with_audit(
  p_attendance_id uuid, p_status text, p_notes text, p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old public.attendances%ROWTYPE; v_new public.attendances%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.attendances WHERE id = p_attendance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.attendances SET status = p_status, notes = p_notes, marked_by = p_actor_id, method = 'MANUAL'
  WHERE id = p_attendance_id RETURNING * INTO v_new;
  INSERT INTO public.incidents(session_id, student_id, incident_type, details, actor_id)
  VALUES (v_old.session_id, v_old.student_id, 'CORRECCION_MANUAL_ASISTENCIA',
    format('Estado: %s → %s%s', v_old.status, p_status, CASE WHEN p_notes IS NULL THEN '' ELSE '. Nota: ' || p_notes END), p_actor_id);
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_attendance_with_audit(p_attendance_id uuid, p_actor_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old public.attendances%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.attendances WHERE id = p_attendance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM public.attendances WHERE id = p_attendance_id;
  INSERT INTO public.incidents(session_id, student_id, incident_type, details, actor_id)
  VALUES (v_old.session_id, v_old.student_id, 'DESHACER_MARCACION_ASISTENCIA',
    format('Marcación %s eliminada. Nota previa: %s', v_old.status, COALESCE(v_old.notes, 'sin nota')), p_actor_id);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_attendance_manual(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_attendance_with_audit(uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.undo_attendance_with_audit(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attendance_manual(uuid,uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_attendance_with_audit(uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.undo_attendance_with_audit(uuid,uuid) TO service_role;

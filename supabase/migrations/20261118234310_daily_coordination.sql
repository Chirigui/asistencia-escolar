BEGIN;
CREATE TABLE public.daily_expected_groups (
  day date NOT NULL,
  group_id uuid NOT NULL REFERENCES public.school_groups(id),
  PRIMARY KEY (day, group_id)
);
ALTER TABLE public.daily_expected_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_expected_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.daily_expected_groups TO authenticated;
CREATE POLICY expected_groups_admin ON public.daily_expected_groups TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE INDEX IF NOT EXISTS sessions_day_group_idx ON public.sessions(date, group_id);
CREATE FUNCTION public.coordination_day(p_day date) RETURNS jsonb
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
      ) ORDER BY s.start_time, s.id) FROM public.sessions s WHERE s.date = p_day
    ), '[]'::jsonb)
  ) WHERE (SELECT public.is_admin());
$$;
REVOKE ALL ON FUNCTION public.coordination_day(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coordination_day(date) TO authenticated;
COMMIT;

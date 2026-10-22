CREATE OR REPLACE FUNCTION public.get_absence_report(
  p_date_from date,
  p_date_to date,
  p_group_name text,
  p_document text,
  p_teacher_id uuid,
  p_limit integer,
  p_offset integer
) RETURNS TABLE(
  session_code text,
  date date,
  subject text,
  session_group text,
  document text,
  full_name text,
  grade text,
  group_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT se.code, se.date, se.subject, se.group_name, st.document, st.full_name, st.grade, st.group_name
  FROM public.sessions se
  JOIN public.students st
    ON regexp_replace(upper(st.group_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(se.group_name), '[^A-Z0-9]', '', 'g')
   AND st.status = 'ACTIVO'
  LEFT JOIN public.attendances a ON a.session_id = se.id AND a.student_id = st.id
  WHERE a.id IS NULL
    AND (p_date_from IS NULL OR se.date >= p_date_from)
    AND (p_date_to IS NULL OR se.date <= p_date_to)
    AND (p_group_name IS NULL OR regexp_replace(upper(se.group_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_group_name), '[^A-Z0-9]', '', 'g'))
    AND (p_document IS NULL OR st.document_normalized = p_document)
    AND (p_teacher_id IS NULL OR se.teacher_id = p_teacher_id)
  ORDER BY se.date DESC, se.code, st.full_name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.get_absence_report(date,date,text,text,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_absence_report(date,date,text,text,uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_absence_report_count(
  p_date_from date, p_date_to date, p_group_name text, p_document text, p_teacher_id uuid
) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)
  FROM public.sessions se
  JOIN public.students st
    ON regexp_replace(upper(st.group_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(se.group_name), '[^A-Z0-9]', '', 'g')
   AND st.status = 'ACTIVO'
  LEFT JOIN public.attendances a ON a.session_id = se.id AND a.student_id = st.id
  WHERE a.id IS NULL
    AND (p_date_from IS NULL OR se.date >= p_date_from)
    AND (p_date_to IS NULL OR se.date <= p_date_to)
    AND (p_group_name IS NULL OR regexp_replace(upper(se.group_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_group_name), '[^A-Z0-9]', '', 'g'))
    AND (p_document IS NULL OR st.document_normalized = p_document)
    AND (p_teacher_id IS NULL OR se.teacher_id = p_teacher_id);
$$;
REVOKE EXECUTE ON FUNCTION public.get_absence_report_count(date,date,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_absence_report_count(date,date,text,text,uuid) TO service_role;

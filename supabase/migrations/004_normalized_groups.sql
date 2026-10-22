CREATE OR REPLACE FUNCTION public.get_active_student_counts_by_group()
RETURNS TABLE(group_name text, student_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT regexp_replace(upper(s.group_name), '[^A-Z0-9]', '', 'g') AS normalized_group, count(*)
  FROM public.students s
  WHERE s.status = 'ACTIVO'
  GROUP BY normalized_group;
$$;

CREATE OR REPLACE FUNCTION public.get_group_name_variants(p_group_name text)
RETURNS TABLE(group_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT variants.group_name
  FROM (
    SELECT st.group_name FROM public.students st
    UNION
    SELECT se.group_name FROM public.sessions se
  ) AS variants
  WHERE regexp_replace(upper(variants.group_name), '[^A-Z0-9]', '', 'g') =
    regexp_replace(upper(COALESCE(p_group_name, '')), '[^A-Z0-9]', '', 'g');
$$;
REVOKE EXECUTE ON FUNCTION public.get_active_student_counts_by_group() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_student_counts_by_group() TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_group_name_variants(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_name_variants(text) TO service_role;

-- The UNIQUE constraints already create B-tree indexes with these leading columns.
DROP INDEX IF EXISTS public.idx_students_doc_norm;
DROP INDEX IF EXISTS public.idx_sessions_code;
DROP INDEX IF EXISTS public.idx_attendances_session;

BEGIN;
ALTER TABLE public.profiles ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.students ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.sessions ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.attendances ALTER COLUMN registered_at SET DEFAULT now(), ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.incidents ALTER COLUMN created_at SET DEFAULT now();
COMMIT;

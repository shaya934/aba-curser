-- The app uses its trusted server PostgreSQL role and checks tenant/assignment
-- permissions there. Supabase's public REST roles must not bypass that boundary.
DO $$
DECLARE table_name TEXT; role_name TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['Organization','User','AuthSession','Client','Assignment','RecurringRule','Appointment','Goal','Target','ClinicalHistory','ClinicalSession','DataEntry','Amendment','PdfReport','Document','AuditLog','RateLimit','SessionTimer','_prisma_migrations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_positive_duration" CHECK ("end" > "start");
ALTER TABLE "DataEntry" ADD CONSTRAINT "DataEntry_valid_measurement" CHECK (
 "value" >= 0 AND ("durationMs" IS NULL OR "durationMs" >= 0)
 AND (("kind" = 'Percentage' AND "numerator" >= 0 AND "denominator" > 0 AND "numerator" <= "denominator")
 OR ("kind" <> 'Percentage' AND "numerator" IS NULL AND "denominator" IS NULL))
);
-- Cross-tenant relationships are also rejected at the database boundary.
CREATE FUNCTION validate_tenant_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE client_org TEXT; staff_org TEXT; session_org TEXT; session_client TEXT; target_client TEXT; ap RECORD;
BEGIN
 IF TG_TABLE_NAME = 'Assignment' THEN
  SELECT "orgId" INTO client_org FROM "Client" WHERE id = NEW."clientId";
  SELECT "orgId" INTO staff_org FROM "User" WHERE id = NEW."userId";
  IF client_org IS DISTINCT FROM staff_org THEN RAISE EXCEPTION 'Cross-tenant assignment' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME = 'Appointment' THEN
  SELECT "orgId" INTO staff_org FROM "User" WHERE id = NEW."therapistId";
  IF NEW."orgId" IS DISTINCT FROM staff_org THEN RAISE EXCEPTION 'Cross-tenant appointment' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME = 'ClinicalSession' THEN
  SELECT * INTO ap FROM "Appointment" WHERE id = NEW."appointmentId";
  IF ap."orgId" IS DISTINCT FROM NEW."orgId" OR ap."clientId" IS DISTINCT FROM NEW."clientId" OR ap."therapistId" IS DISTINCT FROM NEW."therapistId" THEN RAISE EXCEPTION 'Session appointment mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('Finalized','Submitted') AND
   (NEW.note IS DISTINCT FROM OLD.note OR NEW.observations IS DISTINCT FROM OLD.observations OR NEW."actualStart" IS DISTINCT FROM OLD."actualStart" OR NEW."actualEnd" IS DISTINCT FROM OLD."actualEnd" OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."therapistId" IS DISTINCT FROM OLD."therapistId" OR NEW."appointmentId" IS DISTINCT FROM OLD."appointmentId" OR NEW."orgId" IS DISTINCT FROM OLD."orgId") THEN
    RAISE EXCEPTION 'Signed session is immutable' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME = 'Document' THEN
  IF (NEW."clientId" IS NULL) = (NEW."staffId" IS NULL) THEN RAISE EXCEPTION 'Document requires exactly one owner' USING ERRCODE='23514'; END IF;
  IF NEW."clientId" IS NOT NULL THEN SELECT "orgId" INTO client_org FROM "Client" WHERE id=NEW."clientId"; ELSE SELECT "orgId" INTO client_org FROM "User" WHERE id=NEW."staffId"; END IF;
  IF NEW."orgId" IS DISTINCT FROM client_org THEN RAISE EXCEPTION 'Cross-tenant document' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME = 'PdfReport' THEN
  SELECT "orgId" INTO session_org FROM "ClinicalSession" WHERE id=NEW."sessionId";
  IF NEW."orgId" IS DISTINCT FROM session_org THEN RAISE EXCEPTION 'Cross-tenant report' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN RAISE EXCEPTION 'Report snapshot is immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME IN ('DataEntry','SessionTimer') THEN
  SELECT "clientId" INTO session_client FROM "ClinicalSession" WHERE id=NEW."sessionId";
  SELECT g."clientId" INTO target_client FROM "Target" t JOIN "Goal" g ON g.id=t."goalId" WHERE t.id=NEW."targetId";
  IF session_client IS DISTINCT FROM target_client THEN RAISE EXCEPTION 'Target belongs to another client' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "Assignment_tenant" BEFORE INSERT OR UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION validate_tenant_links();
CREATE TRIGGER "Appointment_tenant" BEFORE INSERT OR UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION validate_tenant_links();
CREATE TRIGGER "Session_integrity" BEFORE INSERT OR UPDATE ON "ClinicalSession" FOR EACH ROW EXECUTE FUNCTION validate_tenant_links();
CREATE TRIGGER "Document_tenant" BEFORE INSERT OR UPDATE ON "Document" FOR EACH ROW EXECUTE FUNCTION validate_tenant_links();
CREATE TRIGGER "Report_integrity" BEFORE INSERT OR UPDATE ON "PdfReport" FOR EACH ROW EXECUTE FUNCTION validate_tenant_links();
CREATE TRIGGER "Entry_integrity" BEFORE INSERT OR UPDATE ON "DataEntry" FOR EACH ROW EXECUTE FUNCTION validate_tenant_links();
CREATE TRIGGER "Timer_integrity" BEFORE INSERT OR UPDATE ON "SessionTimer" FOR EACH ROW EXECUTE FUNCTION validate_tenant_links();

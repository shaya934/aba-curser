ALTER TABLE "SessionTimer" ADD COLUMN "targetSnapshot" JSONB;
UPDATE "SessionTimer" timer SET "targetSnapshot" = to_jsonb(t) || jsonb_build_object('goal', to_jsonb(g)) FROM "Target" t JOIN "Goal" g ON g.id=t."goalId" WHERE timer."targetId"=t.id;
ALTER TABLE "SessionTimer" ALTER COLUMN "targetSnapshot" SET NOT NULL;

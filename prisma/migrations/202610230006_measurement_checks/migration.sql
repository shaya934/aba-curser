ALTER TABLE "DataEntry" DROP CONSTRAINT "DataEntry_valid_measurement";
ALTER TABLE "DataEntry" ADD CONSTRAINT "DataEntry_valid_measurement" CHECK (
 "kind" IN ('Correct','Incorrect','Prompted','Independent','Yes','No','Frequency','Duration','Percentage')
 AND "value" >= 0
 AND (
  ("kind"='Percentage' AND "numerator" IS NOT NULL AND "denominator" IS NOT NULL
   AND "numerator">=0 AND "denominator">0 AND "numerator"<="denominator" AND "value"="numerator" AND "durationMs" IS NULL)
  OR
  ("kind"='Duration' AND "durationMs" IS NOT NULL AND "durationMs">=0 AND "numerator" IS NULL AND "denominator" IS NULL)
  OR
  ("kind" NOT IN ('Percentage','Duration') AND "numerator" IS NULL AND "denominator" IS NULL AND "durationMs" IS NULL
   AND (("kind"='Frequency' AND "value">0 AND "value"=floor("value")) OR ("kind"<>'Frequency' AND "value"=1)))
 )
);

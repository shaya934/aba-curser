CREATE TYPE "Role" AS ENUM ('ADMIN', 'BCBA', 'RBT', 'BT');

CREATE TABLE "Organization" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "name" TEXT NOT NULL,
 "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
 "requireApproval" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "User" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "email" TEXT NOT NULL UNIQUE,
 "name" TEXT NOT NULL,
 "passwordHash" TEXT NOT NULL,
 "role" "Role" NOT NULL,
 "phone" TEXT NOT NULL DEFAULT '',
 "title" TEXT NOT NULL DEFAULT '',
 "status" TEXT NOT NULL DEFAULT 'Active',
 "startDate" TEXT NOT NULL DEFAULT '',
 "certification" TEXT NOT NULL DEFAULT '',
 "certificationExpiry" TEXT NOT NULL DEFAULT '',
 "npi" TEXT NOT NULL DEFAULT '',
 "availability" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AuthSession" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Client" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "clientCode" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "dob" TEXT NOT NULL,
 "address" TEXT NOT NULL DEFAULT '',
 "guardians" TEXT NOT NULL DEFAULT '',
 "contact" TEXT NOT NULL DEFAULT '',
 "diagnosis" TEXT NOT NULL DEFAULT '',
 "insurance" TEXT NOT NULL DEFAULT '',
 "authorizationStart" TEXT NOT NULL DEFAULT '',
 "authorizationEnd" TEXT NOT NULL DEFAULT '',
 "authorizationHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
 "status" TEXT NOT NULL DEFAULT 'Active',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE ("orgId", "clientCode"),
 UNIQUE ("id", "orgId")
);

CREATE TABLE "Assignment" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "clientId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("clientId", "userId")
);

CREATE TABLE "RecurringRule" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "timezone" TEXT NOT NULL,
 "frequency" TEXT NOT NULL,
 "count" INTEGER NOT NULL,
 "localStart" TEXT NOT NULL,
 "localEnd" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Appointment" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "clientId" TEXT NOT NULL,
 "therapistId" TEXT NOT NULL,
 "start" TIMESTAMP(3) NOT NULL,
 "end" TIMESTAMP(3) NOT NULL,
 "timezone" TEXT NOT NULL,
 "location" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'Scheduled',
 "recurrenceId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Goal" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "clientId" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "description" TEXT NOT NULL DEFAULT '',
 "domain" TEXT NOT NULL,
 "startDate" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'Active',
 "masteryCriteria" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Target" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "goalId" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "description" TEXT NOT NULL DEFAULT '',
 "measurement" TEXT NOT NULL,
 "baseline" TEXT NOT NULL DEFAULT '',
 "masteryCriteria" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'Active',
 "masteredAt" TIMESTAMP(3),
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ClinicalHistory" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "entityId" TEXT NOT NULL,
 "entityType" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "snapshot" JSONB NOT NULL,
 "actorId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("entityId", "version")
);

CREATE TABLE "ClinicalSession" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "clientId" TEXT NOT NULL,
 "therapistId" TEXT NOT NULL,
 "appointmentId" TEXT NOT NULL UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'In Progress',
 "actualStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "actualEnd" TIMESTAMP(3),
 "note" TEXT NOT NULL DEFAULT '',
 "observations" TEXT NOT NULL DEFAULT '',
 "version" INTEGER NOT NULL DEFAULT 0,
 "signedAt" TIMESTAMP(3),
 "approvedAt" TIMESTAMP(3),
 "approvedBy" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "DataEntry" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "sessionId" TEXT NOT NULL,
 "targetId" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "value" DOUBLE PRECISION NOT NULL,
 "numerator" DOUBLE PRECISION,
 "denominator" DOUBLE PRECISION,
 "durationMs" INTEGER,
 "targetSnapshot" JSONB NOT NULL,
 "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "voidedAt" TIMESTAMP(3),
 UNIQUE ("sessionId", "idempotencyKey")
);

CREATE TABLE "Amendment" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "sessionId" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "reason" TEXT NOT NULL,
 "note" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("sessionId", "version")
);

CREATE TABLE "PdfReport" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "sessionId" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'Pending',
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "error" TEXT,
 "storageKey" TEXT,
 "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("sessionId", "version")
);

CREATE TABLE "Document" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "clientId" TEXT,
 "staffId" TEXT,
 "name" TEXT NOT NULL,
 "category" TEXT NOT NULL,
 "mimeType" TEXT NOT NULL,
 "size" INTEGER NOT NULL,
 "storageKey" TEXT NOT NULL,
 "uploadedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AuditLog" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orgId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "entityId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "RateLimit" (
 "key" TEXT NOT NULL PRIMARY KEY,
 "attempts" INTEGER NOT NULL DEFAULT 1,
 "resetAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "User" ADD CONSTRAINT "User_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_user_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Client" ADD CONSTRAINT "Client_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_client_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_user_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_client_fkey" FOREIGN KEY ("clientId", "orgId") REFERENCES "Client" ("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_therapist_fkey" FOREIGN KEY ("therapistId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_recurrence_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "RecurringRule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Goal" ADD CONSTRAINT "Goal_client_fkey" FOREIGN KEY ("clientId", "orgId") REFERENCES "Client" ("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Target" ADD CONSTRAINT "Target_goal_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicalSession" ADD CONSTRAINT "ClinicalSession_client_fkey" FOREIGN KEY ("clientId", "orgId") REFERENCES "Client" ("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicalSession" ADD CONSTRAINT "ClinicalSession_therapist_fkey" FOREIGN KEY ("therapistId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicalSession" ADD CONSTRAINT "ClinicalSession_appointment_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DataEntry" ADD CONSTRAINT "DataEntry_session_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClinicalSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DataEntry" ADD CONSTRAINT "DataEntry_target_fkey" FOREIGN KEY ("targetId") REFERENCES "Target" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Amendment" ADD CONSTRAINT "Amendment_session_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClinicalSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PdfReport" ADD CONSTRAINT "PdfReport_session_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClinicalSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Document" ADD CONSTRAINT "Document_client_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Appointment_orgId_start_idx" ON "Appointment" ("orgId", "start");

CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog" ("orgId", "createdAt");

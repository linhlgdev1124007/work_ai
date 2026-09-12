CREATE TABLE "ProjectAiCache" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cacheName" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAiCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectAiCache_projectId_key" ON "ProjectAiCache"("projectId");
CREATE INDEX "ProjectAiCache_expiresAt_idx" ON "ProjectAiCache"("expiresAt");

ALTER TABLE "ProjectAiCache" ADD CONSTRAINT "ProjectAiCache_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

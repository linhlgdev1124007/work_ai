CREATE TABLE "AiTokenUsage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "cachedInputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiTokenUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiTokenUsage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AiTokenUsage_orgId_createdAt_idx" ON "AiTokenUsage"("orgId", "createdAt");

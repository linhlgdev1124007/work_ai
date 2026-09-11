ALTER TABLE "Message" ADD COLUMN "mentionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Message" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CHAT';
ALTER TABLE "Notification" ADD COLUMN "eventKey" TEXT,
ADD COLUMN "pushProcessedAt" TIMESTAMP(3),
ADD COLUMN "pushAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pushNextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Notification" SET "pushProcessedAt" = CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_pushProcessedAt_pushNextAt_idx" ON "Notification"("pushProcessedAt", "pushNextAt");
ALTER TABLE "PushSubscription" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" ADD COLUMN "assistantReply" TEXT;
UPDATE "Task" SET "sourceConversationId" = NULL WHERE "sourceConversationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Conversation" WHERE id = "Task"."sourceConversationId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceConversationId_fkey" FOREIGN KEY ("sourceConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_sourceConversationId_idx" ON "Task"("sourceConversationId");
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");

ALTER TABLE "Notification" ADD COLUMN "pushAcceptedSubscriptionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

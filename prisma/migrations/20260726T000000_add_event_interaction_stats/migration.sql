-- CreateTable
CREATE TABLE "EventInteractionStats" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "counterField" TEXT NOT NULL,
    "interactionKey" TEXT NOT NULL,
    "objectId" TEXT,
    "count" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "date" TEXT,
    "hotelId" TEXT,
    "eventSlug" TEXT,
    "source" TEXT NOT NULL DEFAULT 'finish',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInteractionStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventInteractionStats_eventKey_counterField_key" ON "EventInteractionStats"("eventKey", "counterField");

-- CreateIndex
CREATE INDEX "EventInteractionStats_eventKey_idx" ON "EventInteractionStats"("eventKey");

-- CreateIndex
CREATE INDEX "EventInteractionStats_date_idx" ON "EventInteractionStats"("date");

-- CreateTable
CREATE TABLE "MatchDecision" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stackRunId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "ra" DOUBLE PRECISION NOT NULL,
    "dec" DOUBLE PRECISION NOT NULL,
    "objectId" TEXT,
    "confidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewerStatsNightly" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "date" TEXT,
    "hotelId" TEXT,
    "eventSlug" TEXT,
    "unique" INTEGER NOT NULL,
    "maxConcurrent" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'finish',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewerStatsNightly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchDecision_sessionId_createdAt_idx" ON "MatchDecision"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "MatchDecision_result_createdAt_idx" ON "MatchDecision"("result", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerStatsNightly_eventKey_key" ON "ViewerStatsNightly"("eventKey");

-- CreateIndex
CREATE INDEX "ViewerStatsNightly_date_idx" ON "ViewerStatsNightly"("date");


-- CreateTable
CREATE TABLE "StackRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "objectId" TEXT,
    "objectName" TEXT,
    "objectType" TEXT,
    "confidence" TEXT,
    "firstFrameId" TEXT,
    "latestFrameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StackRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StackRun_sessionId_source_startedAt_idx" ON "StackRun"("sessionId", "source", "startedAt");

-- CreateIndex
CREATE INDEX "StackRun_observationId_idx" ON "StackRun"("observationId");

-- AddForeignKey
ALTER TABLE "StackRun" ADD CONSTRAINT "StackRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StackRun" ADD CONSTRAINT "StackRun_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

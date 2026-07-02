-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cancellationReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "rawTargetName" TEXT,
    "objectType" TEXT,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Frame" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "blobPath" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "thumbnailPath" TEXT,
    "stackMilestone" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Frame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_status_date_idx" ON "Session"("status", "date");

-- CreateIndex
CREATE INDEX "Session_hotelId_date_idx" ON "Session"("hotelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Session_date_hotelId_key" ON "Session"("date", "hotelId");

-- CreateIndex
CREATE INDEX "Observation_sessionId_startedAt_idx" ON "Observation"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "Observation_source_startedAt_idx" ON "Observation"("source", "startedAt");

-- CreateIndex
CREATE INDEX "Frame_observationId_idx" ON "Frame"("observationId");

-- CreateIndex
CREATE INDEX "Frame_source_capturedAt_idx" ON "Frame"("source", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Frame_source_sha256_key" ON "Frame"("source", "sha256");

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Frame" ADD CONSTRAINT "Frame_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

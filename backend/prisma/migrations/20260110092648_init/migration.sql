-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "recordingStartTime" TIMESTAMP(3) NOT NULL,
    "recordingEndTime" TIMESTAMP(3),
    "videoFps" DOUBLE PRECISION,
    "totalFrames" INTEGER,
    "processedFrames" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Frame" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "frameNumber" INTEGER NOT NULL,
    "realTimestamp" TIMESTAMP(3) NOT NULL,
    "totalPersons" INTEGER NOT NULL,
    "occupiedSeats" INTEGER NOT NULL,

    CONSTRAINT "Frame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Detection" (
    "id" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "bboxX1" INTEGER NOT NULL,
    "bboxY1" INTEGER NOT NULL,
    "bboxX2" INTEGER NOT NULL,
    "bboxY2" INTEGER NOT NULL,
    "seatId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Detection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Video_recordingStartTime_idx" ON "Video"("recordingStartTime");

-- CreateIndex
CREATE INDEX "Frame_realTimestamp_idx" ON "Frame"("realTimestamp");

-- CreateIndex
CREATE INDEX "Frame_videoId_idx" ON "Frame"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "Frame_videoId_frameNumber_key" ON "Frame"("videoId", "frameNumber");

-- CreateIndex
CREATE INDEX "Detection_personId_idx" ON "Detection"("personId");

-- CreateIndex
CREATE INDEX "Detection_frameId_idx" ON "Detection"("frameId");

-- AddForeignKey
ALTER TABLE "Frame" ADD CONSTRAINT "Frame_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detection" ADD CONSTRAINT "Detection_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "Frame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

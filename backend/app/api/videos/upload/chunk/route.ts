import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRealTimestamp } from '@/lib/timeConverter';
import { z } from 'zod';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const chunkSchema = z.object({
  videoId: z.string().uuid(),
  chunkIndex: z.number().int().min(0),
  totalChunks: z.number().int().positive(),
  // Zod v4: record は keySchema と valueSchema の2引数が必要（1引数だと valueSchema が undefined になり parse 時に落ちる）
  jsonData: z.record(z.string(), z.unknown()), // このチャンクのフレームデータ
  isLastChunk: z.boolean(),
});

// チャンク処理用ヘルパー関数
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const validated = chunkSchema.parse(body);

    const { videoId, chunkIndex, totalChunks, jsonData, isLastChunk } = validated;

    // Videoレコードを取得
    const video = await prisma.video.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    console.log(`Processing chunk ${chunkIndex + 1}/${totalChunks} for video ${videoId}`);

    // フレームデータを準備
    const frameDataWithDetections = [];
    const fps = video.videoFps || 30;
    const startTimestamp = video.recordingStartTime;

    for (const [frameKey, detections] of Object.entries(jsonData)) {
      const frameNumber = parseInt(frameKey.replace('frame_', ''));
      const realTimestamp = calculateRealTimestamp(startTimestamp, frameNumber, fps);

      const uniqueSeats = new Set(
        (detections as any[])
          .map(d => d.confirmed_seat_id || d.seat_id || d.SeatID)
          .filter(Boolean)
      );

      frameDataWithDetections.push({
        videoId: video.id,
        frameNumber,
        realTimestamp,
        totalPersons: (detections as any[]).length,
        occupiedSeats: uniqueSeats.size,
        detections: (detections as any[]).map(det => ({
          personId: det.person_id || det.Name || `person_${det.ID}`,
          bboxX1: Math.round(det.bbox?.[0] || det.BBox?.[0] || 0),
          bboxY1: Math.round(det.bbox?.[1] || det.BBox?.[1] || 0),
          bboxX2: Math.round(det.bbox?.[2] || det.BBox?.[2] || 0),
          bboxY2: Math.round(det.bbox?.[3] || det.BBox?.[3] || 0),
          seatId: det.confirmed_seat_id || det.seat_id || det.SeatID || null,
          confidence: det.confidence || det.Score || 0.0,
        })),
      });
    }

    // バッチ挿入
    const FRAME_CHUNK_SIZE = 1000;
    const DETECTION_CHUNK_SIZE = 5000;

    await prisma.$transaction(async (tx) => {
      const frameChunks = chunkArray(frameDataWithDetections, FRAME_CHUNK_SIZE);

      for (const chunk of frameChunks) {
        const createdFrames = await tx.frame.createManyAndReturn({
          data: chunk.map(fd => ({
            videoId: fd.videoId,
            frameNumber: fd.frameNumber,
            realTimestamp: fd.realTimestamp,
            totalPersons: fd.totalPersons,
            occupiedSeats: fd.occupiedSeats,
          })),
        });

        const allDetections: any[] = [];
        for (let i = 0; i < createdFrames.length; i++) {
          const frame = createdFrames[i];
          const detections = chunk[i].detections;

          for (const det of detections) {
            allDetections.push({
              frameId: frame.id,
              personId: det.personId,
              bboxX1: det.bboxX1,
              bboxY1: det.bboxY1,
              bboxX2: det.bboxX2,
              bboxY2: det.bboxY2,
              seatId: det.seatId,
              confidence: det.confidence,
            });
          }
        }

        if (allDetections.length > 0) {
          const detectionChunks = chunkArray(allDetections, DETECTION_CHUNK_SIZE);
          for (const detChunk of detectionChunks) {
            await tx.detection.createMany({
              data: detChunk,
            });
          }
        }
      }
    }, {
      maxWait: 30000,
      timeout: 300000,
    });

    // processedFramesを更新
    const processedFrames = (video.processedFrames || 0) + frameDataWithDetections.length;
    await prisma.video.update({
      where: { id: videoId },
      data: { processedFrames },
    });

    const processingTime = Date.now() - startTime;
    console.log(`Chunk ${chunkIndex + 1}/${totalChunks} completed in ${processingTime}ms (${frameDataWithDetections.length} frames)`);

    return NextResponse.json({
      success: true,
      videoId,
      chunkIndex,
      processedFrames,
      totalFrames: video.totalFrames,
      processingTimeMs: processingTime,
      isComplete: isLastChunk && processedFrames >= (video.totalFrames || 0),
    });

  } catch (error: any) {
    console.error('Chunk upload error:', error);
    return NextResponse.json(
      {
        error: 'Chunk upload failed',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

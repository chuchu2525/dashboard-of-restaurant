import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRealTimestamp, estimateFps, parseTimestamp } from '@/lib/timeConverter';
import { z } from 'zod';

// Route Segment Config
export const maxDuration = 300; // 5分 (秒単位)
export const dynamic = 'force-dynamic'; // 動的レンダリングを強制

const uploadSchema = z.object({
  jsonData: z.record(z.unknown()), // z.any()からz.unknown()に変更
  filename: z.string().min(1).max(255),
  recordingStartTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  recordingEndTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
  videoFps: z.number().positive().optional(),
});

// チャンク処理用のヘルパー関数
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
  const startProcessTime = Date.now();
  let videoId: string | undefined;

  try {
    // リクエストサイズの事前チェック
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Request body too large. Maximum size is 100MB.' },
        { status: 413 }
      );
    }

    // JSONパース
    let body;
    try {
      body = await request.json();
    } catch (parseError: any) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON format', details: parseError.message },
        { status: 400 }
      );
    }

    // バリデーション
    let validatedData;
    try {
      validatedData = uploadSchema.parse(body);
    } catch (validationError: any) {
      console.error('Validation error:', validationError);
      return NextResponse.json(
        { error: 'Validation failed', details: validationError.errors },
        { status: 400 }
      );
    }

    const { jsonData, filename, recordingStartTime, recordingEndTime, videoFps } = validatedData;

    // 撮影開始時刻をパース
    const startTime = parseTimestamp(recordingStartTime);
    const endTime = recordingEndTime ? parseTimestamp(recordingEndTime) : undefined;

    // FPS推定（提供されない場合）
    const fps = videoFps || estimateFps(jsonData, startTime, endTime);

    // フレーム数を取得
    const frameKeys = Object.keys(jsonData);
    const totalFrames = frameKeys.length;

    // 最後のフレームから終了時刻を計算
    const lastFrameNumber = parseInt(frameKeys[frameKeys.length - 1].replace('frame_', ''));
    const calculatedEndTime = calculateRealTimestamp(startTime, lastFrameNumber, fps);

    // Videoレコード作成
    const video = await prisma.video.create({
      data: {
        filename,
        recordingStartTime: startTime,
        recordingEndTime: endTime || calculatedEndTime,
        videoFps: fps,
        totalFrames,
        processedFrames: 0, // 初期値は0
      },
    });

    videoId = video.id;
    console.log(`Created video record: ${videoId} with ${totalFrames} frames`);

    // フレームデータを準備
    const frameDataWithDetections = [];

    for (const [frameKey, detections] of Object.entries(jsonData)) {
      const frameNumber = parseInt(frameKey.replace('frame_', ''));
      const realTimestamp = calculateRealTimestamp(startTime, frameNumber, fps);

      // 座席の重複を除去
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

    // データベース挿入（バッチ処理）
    try {
      // バッチ挿入用の定数
      const FRAME_CHUNK_SIZE = 1000;
      const DETECTION_CHUNK_SIZE = 5000;

      console.log(`Processing ${totalFrames} frames for video ${video.id}...`);

      // トランザクションで一括挿入
      await prisma.$transaction(async (tx) => {
        // Framesをチャンク単位で一括作成
        const frameChunks = chunkArray(frameDataWithDetections, FRAME_CHUNK_SIZE);

        for (let chunkIndex = 0; chunkIndex < frameChunks.length; chunkIndex++) {
          const chunk = frameChunks[chunkIndex];

          // createManyAndReturnでFramesを作成し、IDを取得
          const createdFrames = await tx.frame.createManyAndReturn({
            data: chunk.map(fd => ({
              videoId: fd.videoId,
              frameNumber: fd.frameNumber,
              realTimestamp: fd.realTimestamp,
              totalPersons: fd.totalPersons,
              occupiedSeats: fd.occupiedSeats,
            })),
          });

          // 作成されたFrameのIDとdetectionsを紐付け
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

          // Detectionsをチャンク単位で一括作成
          if (allDetections.length > 0) {
            const detectionChunks = chunkArray(allDetections, DETECTION_CHUNK_SIZE);
            for (const detChunk of detectionChunks) {
              await tx.detection.createMany({
                data: detChunk,
              });
            }
          }

          // 進捗ログ
          console.log(`Processed chunk ${chunkIndex + 1}/${frameChunks.length} (${chunk.length} frames, ${allDetections.length} detections)`);
        }
      }, {
        maxWait: 30000, // トランザクション開始までの最大待機時間（30秒）
        timeout: 300000, // トランザクションタイムアウト（5分）
      });

      console.log(`Successfully inserted all ${totalFrames} frames and detections`);

      // processedFramesを更新
      await prisma.video.update({
        where: { id: videoId },
        data: { processedFrames: totalFrames },
      });

    } catch (dbError: any) {
      console.error('Database insertion error:', dbError);

      // 部分的に作成されたデータをクリーンアップ
      if (videoId) {
        await prisma.video.delete({ where: { id: videoId } }).catch(e => {
          console.error('Failed to cleanup video record:', e);
        });
      }

      return NextResponse.json(
        {
          error: 'Database insertion failed',
          details: dbError.message,
          videoId: videoId
        },
        { status: 500 }
      );
    }

    const processingTime = Date.now() - startProcessTime;
    console.log(`Upload completed in ${processingTime}ms for video ${videoId}`);

    return NextResponse.json({
      success: true,
      videoId: video.id,
      message: `Successfully uploaded ${totalFrames} frames`,
      processingTimeMs: processingTime,
    });

  } catch (error: any) {
    console.error('Unexpected upload error:', error);
    return NextResponse.json(
      {
        error: 'Upload failed',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}


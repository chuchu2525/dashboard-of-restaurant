import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseTimestamp } from '@/lib/timeConverter';
import { z } from 'zod';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const initSchema = z.object({
  filename: z.string().min(1).max(255),
  recordingStartTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  recordingEndTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
  videoFps: z.number().positive().optional(),
  totalFrames: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
});

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
  try {
    const body = await request.json();
    const validated = initSchema.parse(body);

    const startTime = parseTimestamp(validated.recordingStartTime);
    const endTime = validated.recordingEndTime ? parseTimestamp(validated.recordingEndTime) : null;

    // Videoレコードを作成（processedFrames = 0）
    const video = await prisma.video.create({
      data: {
        filename: validated.filename,
        recordingStartTime: startTime,
        recordingEndTime: endTime,
        videoFps: validated.videoFps || 30,
        totalFrames: validated.totalFrames,
        processedFrames: 0,
      },
    });

    console.log(`Initialized upload session for video ${video.id}: ${validated.totalFrames} frames, ${validated.totalChunks} chunks`);

    // セッション情報を返す
    return NextResponse.json({
      success: true,
      videoId: video.id,
      uploadSessionId: video.id, // 簡易的にvideoIdを使用
      totalChunks: validated.totalChunks,
    });
  } catch (error: any) {
    console.error('Init failed:', error);
    return NextResponse.json(
      { error: 'Init failed', details: error.message },
      { status: 400 }
    );
  }
}

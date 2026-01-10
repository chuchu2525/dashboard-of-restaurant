import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const completeSchema = z.object({
  videoId: z.string().uuid(),
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
    const { videoId } = completeSchema.parse(body);

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        _count: {
          select: { frames: true },
        },
      },
    });

    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    const actualFrameCount = video._count.frames;
    const isComplete = actualFrameCount >= (video.totalFrames || 0);

    if (isComplete) {
      // 最終的なprocessedFramesを更新
      await prisma.video.update({
        where: { id: videoId },
        data: { processedFrames: actualFrameCount },
      });
      console.log(`Upload completed for video ${videoId}: ${actualFrameCount}/${video.totalFrames} frames`);
    } else {
      console.log(`Upload incomplete for video ${videoId}: ${actualFrameCount}/${video.totalFrames} frames`);
    }

    return NextResponse.json({
      success: true,
      videoId,
      isComplete,
      processedFrames: actualFrameCount,
      totalFrames: video.totalFrames,
      message: isComplete
        ? `Successfully uploaded ${actualFrameCount} frames`
        : `Upload incomplete: ${actualFrameCount}/${video.totalFrames} frames`,
    });

  } catch (error: any) {
    console.error('Complete check failed:', error);
    return NextResponse.json(
      { error: 'Complete check failed', details: error.message },
      { status: 400 }
    );
  }
}

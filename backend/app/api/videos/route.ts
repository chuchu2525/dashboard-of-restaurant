import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const videos = await prisma.video.findMany({
      orderBy: { recordingStartTime: 'desc' },
      select: {
        id: true,
        filename: true,
        recordingStartTime: true,
        recordingEndTime: true,
        videoFps: true,
        totalFrames: true,
        processedFrames: true,
        uploadedAt: true,
      },
    });
    
    return NextResponse.json({ videos });
  } catch (error: any) {
    console.error('Failed to fetch videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch videos', details: error.message },
      { status: 500 }
    );
  }
}


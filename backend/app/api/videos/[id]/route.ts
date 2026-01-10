import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const video = await prisma.video.findUnique({
      where: { id },
      select: {
        id: true,
        filename: true,
        recordingStartTime: true,
        recordingEndTime: true,
        videoFps: true,
        totalFrames: true,
        processedFrames: true,
        uploadedAt: true,
        metadata: true,
      },
    });
    
    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ video });
  } catch (error: any) {
    console.error('Failed to fetch video:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video', details: error.message },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processFramesForDashboard } from '@/lib/dataProcessor';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // URLパラメータから開始時刻フィルターを取得
    const searchParams = request.nextUrl.searchParams;
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const limitParam = searchParams.get('limit');
    const parsedStartTime = startTime ? new Date(startTime) : null;
    const parsedEndTime = endTime ? new Date(endTime) : null;
    const parsedLimitRaw = limitParam ? Number.parseInt(limitParam, 10) : NaN;
    const frameLimit = Number.isFinite(parsedLimitRaw) ? Math.min(Math.max(parsedLimitRaw, 1), 5000) : 5000;

    if (startTime && parsedStartTime && Number.isNaN(parsedStartTime.getTime())) {
      return NextResponse.json({ error: 'Invalid startTime' }, { status: 400 });
    }
    if (endTime && parsedEndTime && Number.isNaN(parsedEndTime.getTime())) {
      return NextResponse.json({ error: 'Invalid endTime' }, { status: 400 });
    }
    
    // フレームと検出データを取得
    const where: any = { videoId: id };
    
    if (startTime) {
      where.realTimestamp = {
        gte: new Date(startTime),
      };
    }
    if (endTime) {
      where.realTimestamp = {
        ...(where.realTimestamp || {}),
        lte: new Date(endTime),
      };
    }

    const frameCount = await prisma.frame.count({ where });
    
    // NOTE: include(detections) + 大量件数で Prisma が stack overflow することがあるため、フレームを上限付きで取得してから検出を別クエリで紐付ける
    const frames = await prisma.frame.findMany({
      where,
      orderBy: { frameNumber: 'asc' },
      take: frameLimit,
      select: {
        id: true,
        videoId: true,
        frameNumber: true,
        realTimestamp: true,
        totalPersons: true,
        occupiedSeats: true,
      },
    });

    const frameIds = frames.map(f => f.id);
    const detections = frameIds.length === 0
      ? []
      : await prisma.detection.findMany({
          where: { frameId: { in: frameIds } },
          select: {
            id: true,
            frameId: true,
            personId: true,
            bboxX1: true,
            bboxY1: true,
            bboxX2: true,
            bboxY2: true,
            seatId: true,
            confidence: true,
          },
        });

    const detByFrameId = new Map<string, typeof detections>();
    for (const det of detections) {
      const arr = detByFrameId.get(det.frameId);
      if (arr) arr.push(det);
      else detByFrameId.set(det.frameId, [det]);
    }

    const framesWithDetections = frames.map(f => ({
      ...f,
      detections: detByFrameId.get(f.id) || [],
    }));
    
    if (frames.length === 0) {
      return NextResponse.json(
        { error: 'No frames found for this video' },
        { status: 404 }
      );
    }
    
    // ダッシュボード用にデータを処理
    const dashboardData = processFramesForDashboard(framesWithDetections as any);
    
    return NextResponse.json({
      ...dashboardData,
      meta: {
        totalMatchingFrames: frameCount,
        returnedFrames: frames.length,
        frameLimit,
        limited: typeof frameCount === 'number' ? frameCount > frames.length : null,
      },
    });
  } catch (error: any) {
    console.error('Failed to fetch video data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video data', details: error.message },
      { status: 500 }
    );
  }
}


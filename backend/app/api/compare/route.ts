import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const videoIdsParam = searchParams.get('videoIds');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    
    if (!videoIdsParam) {
      return NextResponse.json(
        { error: 'videoIds parameter is required' },
        { status: 400 }
      );
    }
    
    const videoIds = videoIdsParam.split(',');
    
    // 各動画のフレーム数と占有率を取得
    const comparisonData = [];
    
    for (const videoId of videoIds) {
      const where: any = { videoId };
      
      if (startTime) {
        where.realTimestamp = { ...where.realTimestamp, gte: new Date(startTime) };
      }
      if (endTime) {
        where.realTimestamp = { ...where.realTimestamp, lte: new Date(endTime) };
      }
      
      const video = await prisma.video.findUnique({
        where: { id: videoId },
      });
      
      if (!video) continue;
      
      const frames = await prisma.frame.findMany({
        where,
        orderBy: { frameNumber: 'asc' },
      });
      
      if (frames.length === 0) continue;
      
      // 統計情報を計算
      const totalPersons = frames.reduce((sum, frame) => sum + frame.totalPersons, 0);
      const avgOccupancy = totalPersons / frames.length;
      const peakOccupancy = Math.max(...frames.map(f => f.totalPersons));
      const avgSeatsOccupied = frames.reduce((sum, frame) => sum + frame.occupiedSeats, 0) / frames.length;
      
      // 時系列データ
      const timeSeries = frames.map(frame => ({
        time: frame.realTimestamp.toISOString(),
        totalPersons: frame.totalPersons,
        occupiedSeats: frame.occupiedSeats,
      }));
      
      comparisonData.push({
        videoId: video.id,
        filename: video.filename,
        recordingStartTime: video.recordingStartTime.toISOString(),
        recordingEndTime: video.recordingEndTime?.toISOString(),
        stats: {
          totalFrames: frames.length,
          avgOccupancy,
          peakOccupancy,
          avgSeatsOccupied,
        },
        timeSeries,
      });
    }
    
    return NextResponse.json({ comparisonData });
  } catch (error: any) {
    console.error('Failed to compare videos:', error);
    return NextResponse.json(
      { error: 'Failed to compare videos', details: error.message },
      { status: 500 }
    );
  }
}


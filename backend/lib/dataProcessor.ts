import { Frame, Detection } from '@prisma/client';

export interface ProcessedFrame {
  frameId: string;
  detections: PersonDetection[];
  time: string;
  fullTimestamp: string;
  totalPersons: number;
  seatOccupancy: SeatOccupancyDataPoint[];
  groupSizesAtTables: number[];
}

export interface PersonDetection {
  frame_number: number;
  timestamp: string;
  person_id: string;
  bbox: [number, number, number, number];
  raw_seat_id: string | null;
  confirmed_seat_id: string | null;
  seat_status: string;
  confidence: number;
}

export interface SeatOccupancyDataPoint {
  seatId: string;
  persons: number;
}

export interface SummaryMetrics {
  currentTotalCustomers: number;
  currentOccupiedTables: number;
  averageGroupSizeOverall: number;
  peakOccupancyTime: string;
  peakOccupancyCount: number;
  totalUniqueVisitors: number;
  totalUniqueGroups: number;
  averageStayTime: number;
}

export interface TimeSeriesDataPoint {
  time: string;
  totalPersons: number;
}

export interface ArrivalTrendDataPoint {
  time: string;
  newVisitors: number;
  newGroups: number;
}

export interface SeatUsageBlock {
  seatId: string;
  startTime: string;
  endTime: string;
  duration: number;
  personCount: number;
  personIds: string[];
}

export interface TableOccupancyOverTimeDataPoint {
  time: string;
  [seatId: string]: number | string;
}

type FrameWithDetections = Frame & { detections: Detection[] };

/**
 * フレームデータをダッシュボード用に処理
 */
export function processFramesForDashboard(frames: FrameWithDetections[]) {
  const processedFrames: ProcessedFrame[] = [];
  const timeSeries: TimeSeriesDataPoint[] = [];
  const uniquePersons = new Set<string>();
  const personFirstSeen = new Map<string, Date>();
  const personLastSeen = new Map<string, Date>();
  const seatUsageMap = new Map<string, { persons: Set<string>; startTime: Date; endTime: Date }>();
  
  let peakOccupancy = 0;
  let peakTime = '';
  
  for (const frame of frames) {
    const timestamp = frame.realTimestamp.toISOString();
    const time = formatTime(frame.realTimestamp);
    
    // 検出データを変換
    const detections: PersonDetection[] = frame.detections.map(det => {
      uniquePersons.add(det.personId);
      
      // 初回と最終見た時刻を記録
      if (!personFirstSeen.has(det.personId)) {
        personFirstSeen.set(det.personId, frame.realTimestamp);
      }
      personLastSeen.set(det.personId, frame.realTimestamp);
      
      return {
        frame_number: frame.frameNumber,
        timestamp,
        person_id: det.personId,
        bbox: [det.bboxX1, det.bboxY1, det.bboxX2, det.bboxY2] as [number, number, number, number],
        raw_seat_id: det.seatId,
        confirmed_seat_id: det.seatId,
        seat_status: det.seatId ? 'Assigned' : 'Unassigned',
        confidence: det.confidence,
      };
    });
    
    // 座席ごとの人数を集計
    const seatOccupancyMap = new Map<string, number>();
    for (const det of frame.detections) {
      if (det.seatId) {
        seatOccupancyMap.set(det.seatId, (seatOccupancyMap.get(det.seatId) || 0) + 1);
        
        // 座席使用状況を記録
        if (!seatUsageMap.has(det.seatId)) {
          seatUsageMap.set(det.seatId, {
            persons: new Set([det.personId]),
            startTime: frame.realTimestamp,
            endTime: frame.realTimestamp,
          });
        } else {
          const usage = seatUsageMap.get(det.seatId)!;
          usage.persons.add(det.personId);
          usage.endTime = frame.realTimestamp;
        }
      }
    }
    
    const seatOccupancy: SeatOccupancyDataPoint[] = Array.from(seatOccupancyMap.entries()).map(
      ([seatId, persons]) => ({ seatId, persons })
    );
    
    const groupSizesAtTables = Array.from(seatOccupancyMap.values());
    
    // ピーク検出
    if (frame.totalPersons > peakOccupancy) {
      peakOccupancy = frame.totalPersons;
      peakTime = timestamp;
    }
    
    processedFrames.push({
      frameId: `frame_${frame.frameNumber.toString().padStart(3, '0')}`,
      detections,
      time,
      fullTimestamp: timestamp,
      totalPersons: frame.totalPersons,
      seatOccupancy,
      groupSizesAtTables,
    });
    
    timeSeries.push({
      time,
      totalPersons: frame.totalPersons,
    });
  }
  
  // サマリーメトリクスを計算
  const lastFrame = frames[frames.length - 1];
  const currentTotalCustomers = lastFrame?.totalPersons || 0;
  const currentOccupiedTables = lastFrame?.occupiedSeats || 0;
  
  // 平均滞在時間を計算
  let totalStayTime = 0;
  for (const [personId, firstSeen] of personFirstSeen.entries()) {
    const lastSeen = personLastSeen.get(personId)!;
    const stayTimeMs = lastSeen.getTime() - firstSeen.getTime();
    totalStayTime += stayTimeMs / 1000 / 60; // 分に変換
  }
  const averageStayTime = uniquePersons.size > 0 ? totalStayTime / uniquePersons.size : 0;
  
  // グループサイズの平均計算
  const allGroupSizes: number[] = [];
  for (const frame of processedFrames) {
    allGroupSizes.push(...frame.groupSizesAtTables);
  }
  const averageGroupSizeOverall =
    allGroupSizes.length > 0 ? allGroupSizes.reduce((a, b) => a + b, 0) / allGroupSizes.length : 0;
  
  const summaryMetrics: SummaryMetrics = {
    currentTotalCustomers,
    currentOccupiedTables,
    averageGroupSizeOverall,
    peakOccupancyTime: peakTime,
    peakOccupancyCount: peakOccupancy,
    totalUniqueVisitors: uniquePersons.size,
    totalUniqueGroups: seatUsageMap.size,
    averageStayTime,
  };
  
  // 座席使用タイムラインを生成
  const seatUsageTimeline: SeatUsageBlock[] = Array.from(seatUsageMap.entries()).map(
    ([seatId, usage]) => ({
      seatId,
      startTime: usage.startTime.toISOString(),
      endTime: usage.endTime.toISOString(),
      duration: (usage.endTime.getTime() - usage.startTime.getTime()) / 1000 / 60,
      personCount: usage.persons.size,
      personIds: Array.from(usage.persons),
    })
  );
  
  // テーブル占有率の時系列データ
  const interpolatedOccupancyData: TableOccupancyOverTimeDataPoint[] = processedFrames.map(
    frame => {
      const dataPoint: TableOccupancyOverTimeDataPoint = { time: frame.time };
      for (const seat of frame.seatOccupancy) {
        dataPoint[seat.seatId] = seat.persons;
      }
      return dataPoint;
    }
  );
  
  // 時系列の集約
  const aggregatedTimeSeries = {
    raw: timeSeries,
    '1min': aggregateTimeSeries(timeSeries, 60),
    '15min': aggregateTimeSeries(timeSeries, 900),
    hour: aggregateTimeSeries(timeSeries, 3600),
  };
  
  // 到着トレンド（簡易実装）
  const arrivalTrendData: ArrivalTrendDataPoint[] = [];
  const hourlyNewVisitors = new Map<string, Set<string>>();
  
  for (const frame of frames) {
    const hour = frame.realTimestamp.toISOString().substring(0, 13) + ':00';
    if (!hourlyNewVisitors.has(hour)) {
      hourlyNewVisitors.set(hour, new Set());
    }
    for (const det of frame.detections) {
      hourlyNewVisitors.get(hour)!.add(det.personId);
    }
  }
  
  for (const [hour, visitors] of hourlyNewVisitors.entries()) {
    arrivalTrendData.push({
      time: hour,
      newVisitors: visitors.size,
      newGroups: 0, // 簡易実装のため0
    });
  }
  
  return {
    processedFrames,
    summaryMetrics,
    arrivalTrendData,
    aggregatedTimeSeries,
    seatUsageTimeline,
    interpolatedOccupancyData,
  };
}

function formatTime(date: Date): string {
  return date.toTimeString().substring(0, 8);
}

function aggregateTimeSeries(
  timeSeries: TimeSeriesDataPoint[],
  intervalSeconds: number
): TimeSeriesDataPoint[] {
  // 簡易実装: そのまま返す
  return timeSeries;
}


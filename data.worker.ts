import { RestaurantData, ProcessedFrame, SummaryMetrics, SeatOccupancyDataPoint, ArrivalTrendDataPoint, AggregatedTimeSeries, TimeSeriesDataPoint, SeatUsageBlock, TableOccupancyOverTimeDataPoint } from './types';

function downsample<T>(frames: T[], maxPoints: number = 500): T[] {
  if (frames.length <= maxPoints) {
    return frames;
  }

  const downsampled: T[] = [];
  const totalFrames = frames.length;
  const step = totalFrames / maxPoints;

  for (let i = 0; i < totalFrames; i += step) {
    downsampled.push(frames[Math.floor(i)]);
  }

  // Ensure the very last frame is included for accurate end-point representation
  if (downsampled[downsampled.length - 1] !== frames[totalFrames - 1]) {
    downsampled.push(frames[totalFrames - 1]);
  }

  return downsampled;
}

function getBucketKey(timestamp: string, granularity: '1min' | '15min' | 'hour'): string {
    const date = new Date(timestamp);
    date.setSeconds(0, 0);
    if (granularity === '15min') {
        date.setMinutes(Math.floor(date.getMinutes() / 15) * 15);
    }
    if (granularity === 'hour') {
        date.setMinutes(0);
    }
    return date.toISOString();
}

function aggregateTimeSeries(frames: ProcessedFrame[]): AggregatedTimeSeries {
    const rawTimeSeries = frames.map(f => ({ time: f.time, totalPersons: f.totalPersons }));

    const aggregations: AggregatedTimeSeries = {
        raw: downsample(rawTimeSeries, 1000), // Downsample the raw data to a reasonable number of points for display
        '1min': [],
        '15min': [],
        'hour': [],
    };

    const minuteBuckets = new Map<string, number[]>();
    const fifteenMinuteBuckets = new Map<string, number[]>();
    const hourBuckets = new Map<string, number[]>();

    for (const frame of frames) {
        const minKey = getBucketKey(frame.fullTimestamp, '1min');
        if (!minuteBuckets.has(minKey)) minuteBuckets.set(minKey, []);
        minuteBuckets.get(minKey)!.push(frame.totalPersons);

        const fifteenMinKey = getBucketKey(frame.fullTimestamp, '15min');
        if (!fifteenMinuteBuckets.has(fifteenMinKey)) fifteenMinuteBuckets.set(fifteenMinKey, []);
        fifteenMinuteBuckets.get(fifteenMinKey)!.push(frame.totalPersons);

        const hourKey = getBucketKey(frame.fullTimestamp, 'hour');
        if (!hourBuckets.has(hourKey)) hourBuckets.set(hourKey, []);
        hourBuckets.get(hourKey)!.push(frame.totalPersons);
    }

    aggregations['1min'] = Array.from(minuteBuckets.entries()).map(([ts, values]) => ({
        time: new Date(ts).toLocaleTimeString('en-GB'),
        totalPersons: Math.max(...values)
    })).sort((a, b) => a.time.localeCompare(b.time));

    aggregations['15min'] = Array.from(fifteenMinuteBuckets.entries()).map(([ts, values]) => ({
        time: new Date(ts).toLocaleTimeString('en-GB'),
        totalPersons: Math.max(...values)
    })).sort((a, b) => a.time.localeCompare(b.time));
    
    aggregations['hour'] = Array.from(hourBuckets.entries()).map(([ts, values]) => ({
        time: new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        totalPersons: Math.max(...values)
    })).sort((a, b) => a.time.localeCompare(b.time));

    return aggregations;
}

function generateInterpolatedOccupancy(
  allFrames: ProcessedFrame[],
  seatUsageTimeline: SeatUsageBlock[]
): TableOccupancyOverTimeDataPoint[] {
  if (allFrames.length === 0 || seatUsageTimeline.length === 0) {
    return [];
  }

  const allSeatIds = Array.from(new Set(seatUsageTimeline.map(b => b.seatId))).sort();
  const seatBlocksBySeatId = new Map<string, SeatUsageBlock[]>();

  allSeatIds.forEach(id => seatBlocksBySeatId.set(id, []));
  seatUsageTimeline.forEach(block => {
    seatBlocksBySeatId.get(block.seatId)?.push(block);
  });

  const interpolatedData = allFrames.map(frame => {
    const frameTimestamp = new Date(frame.fullTimestamp).getTime();
    const dataPoint: TableOccupancyOverTimeDataPoint = { time: frame.time };

    allSeatIds.forEach(seatId => {
      const blocks = seatBlocksBySeatId.get(seatId) || [];
      let persons = 0;
      for (const block of blocks) {
        const start = new Date(block.startTime).getTime();
        const end = new Date(block.endTime).getTime();
        if (frameTimestamp >= start && frameTimestamp <= end) {
          persons = block.personCount;
          break; // Found the block for this timestamp
        }
      }
      dataPoint[seatId] = persons;
    });

    return dataPoint;
  });

  // Downsample the interpolated data to a reasonable number of points for display
  return downsample(interpolatedData, 500);
}

function generateSeatUsageTimeline(allFrames: ProcessedFrame[]): SeatUsageBlock[] {
    const usageBlocks: SeatUsageBlock[] = [];
    if (allFrames.length === 0) return usageBlocks;

    // 9000フレームをミリ秒に変換 (30fpsと仮定)
    const FRAME_RATE_HZ = 30;
    const ABSENCE_THRESHOLD_FRAMES = 9000;
    const ABSENCE_THRESHOLD_MS = (ABSENCE_THRESHOLD_FRAMES / FRAME_RATE_HZ) * 1000;

    const seatStates = new Map<string, {
        personIds: string; // Stored as a sorted, comma-separated string
        startTime: number;
        lastSeenTime: number;
        personCount: number;
    }>();

    // 席を離れたが、まだ戻ってくる可能性があるセッションを保持する
    const pendingFinalization = new Map<string, { session: any, disappearanceTime: number }>();
    
    // Finalize a session and add it to the blocks array
    const finalizeSession = (session: any) => {
        const duration = Math.round((session.lastSeenTime - session.startTime) / 60000); // in minutes
        if (duration > 0) {
            usageBlocks.push({
                seatId: session.seatId,
                startTime: new Date(session.startTime).toISOString(),
                endTime: new Date(session.lastSeenTime).toISOString(),
                duration,
                personCount: session.personCount,
                personIds: session.personIds.split(','),
            });
        }
    };

    allFrames.forEach((frame) => {
        const frameTimestamp = new Date(frame.fullTimestamp).getTime();
        const seatsInFrame = new Map<string, string[]>();
        const seatsInFrameById = new Map<string, string>();

        // まず、保留中のセッションで、不在許容時間を超えたものを確定させる
        for (const [seatId, pending] of pendingFinalization.entries()) {
            if (frameTimestamp - pending.disappearanceTime > ABSENCE_THRESHOLD_MS) {
                finalizeSession(pending.session);
                pendingFinalization.delete(seatId);
            }
        }

        frame.detections.forEach(det => {
            const seatId = det.confirmed_seat_id || det.raw_seat_id;
            if (seatId) {
                if (!seatsInFrame.has(seatId)) seatsInFrame.set(seatId, []);
                seatsInFrame.get(seatId)!.push(det.person_id);
            }
        });

        seatsInFrame.forEach((personIds, seatId) => {
            seatsInFrameById.set(seatId, personIds.sort().join(','));
        });

        const checkedSeats = new Set<string>();

        // Check active sessions for changes
        for (const [seatId, state] of seatStates.entries()) {
            const currentGroupId = seatsInFrameById.get(seatId);
            if (state.personIds === currentGroupId) {
                state.lastSeenTime = frameTimestamp;
            } else {
                // Group has changed or disappeared. Move to pending.
                pendingFinalization.set(seatId, {
                    session: { ...state, seatId },
                    disappearanceTime: state.lastSeenTime
                });
                seatStates.delete(seatId);
                
                if (currentGroupId) {
                     // A new group has appeared immediately. Check if it's a pending group returning.
                     const pendingSession = pendingFinalization.get(seatId);
                     if (pendingSession && pendingSession.session.personIds === currentGroupId) {
                         // It's the same group returning within the threshold!
                         seatStates.set(seatId, pendingSession.session);
                         seatStates.get(seatId)!.lastSeenTime = frameTimestamp;
                         pendingFinalization.delete(seatId);
                     } else {
                        // It's a brand new group.
                        seatStates.set(seatId, {
                            personIds: currentGroupId,
                            startTime: frameTimestamp,
                            lastSeenTime: frameTimestamp,
                            personCount: seatsInFrame.get(seatId)!.length,
                        });
                     }
                }
            }
            checkedSeats.add(seatId);
        }

        // Check for brand new sessions or returning sessions
        for (const [seatId, groupId] of seatsInFrameById.entries()) {
            if (!checkedSeats.has(seatId)) {
                const pendingSession = pendingFinalization.get(seatId);
                if (pendingSession && pendingSession.session.personIds === groupId) {
                    // This group was temporarily away and has now returned.
                    // Restore the session from pending.
                    seatStates.set(seatId, pendingSession.session);
                    seatStates.get(seatId)!.lastSeenTime = frameTimestamp; // Update last seen time
                    pendingFinalization.delete(seatId); // Remove from pending
                } else {
                    // This is a genuinely new session.
                    if (pendingSession) {
                        // A different group was here before. Finalize the old session.
                        finalizeSession(pendingSession.session);
                        pendingFinalization.delete(seatId);
                    }
                    seatStates.set(seatId, {
                        personIds: groupId,
                        startTime: frameTimestamp,
                        lastSeenTime: frameTimestamp,
                        personCount: seatsInFrame.get(seatId)!.length,
                    });
                }
            }
        }
    });

    // After the loop, close any remaining active and pending sessions
    for (const state of seatStates.values()) {
        const session = { ...state, seatId: [...seatStates.entries()].find(([key, val]) => val === state)?.[0] || '' };
        finalizeSession(session);
    }
    for (const pending of pendingFinalization.values()) {
        finalizeSession(pending.session);
    }
    
    return usageBlocks.sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

// This function is the core processing logic, moved from App.tsx
function processData(data: RestaurantData): { 
  processedFrames: ProcessedFrame[], 
  summaryMetrics: SummaryMetrics | null, 
  arrivalTrendData: ArrivalTrendDataPoint[],
  aggregatedTimeSeries: AggregatedTimeSeries,
  seatUsageTimeline: SeatUsageBlock[],
  interpolatedOccupancyData: TableOccupancyOverTimeDataPoint[],
} {
  const allFrames: ProcessedFrame[] = Object.entries(data)
    .map(([frameKey, detections]) => {
      if (!detections || detections.length === 0) {
        return null;
      }
      const firstDetection = detections[0];
      const time = new Date(firstDetection.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      const seatCounts: Record<string, number> = {};
      detections.forEach(det => {
        const seatId = det.confirmed_seat_id || det.raw_seat_id; // Fallback to raw_seat_id
        if (seatId) {
          seatCounts[seatId] = (seatCounts[seatId] || 0) + 1;
        }
      });
      
      const seatOccupancy: SeatOccupancyDataPoint[] = Object.entries(seatCounts).map(([seatId, persons]) => ({
        seatId,
        persons
      }));

      const groupSizesAtTables: number[] = Object.values(seatCounts).filter(count => count > 0);

      return {
        frameId: frameKey,
        detections,
        time,
        fullTimestamp: firstDetection.timestamp,
        totalPersons: detections.length,
        seatOccupancy,
        groupSizesAtTables,
      };
    })
    .filter((frame): frame is ProcessedFrame => frame !== null)
    .sort((a, b) => new Date(a.fullTimestamp).getTime() - new Date(b.fullTimestamp).getTime());

  if (allFrames.length === 0) {
    return {
      processedFrames: [],
      summaryMetrics: null,
      arrivalTrendData: [],
      aggregatedTimeSeries: { raw: [], '1min': [], '15min': [], 'hour': [] },
      seatUsageTimeline: [],
      interpolatedOccupancyData: [],
    };
  }
  
  // --- Metric calculations use ALL frames to ensure accuracy ---
  // --- Legacy metrics calculation ---
  const latestFrame = allFrames[allFrames.length - 1];
  const currentTotalCustomers = latestFrame.totalPersons;
  const currentOccupiedTables = latestFrame.seatOccupancy.filter(s => s.persons > 0).length;

  let peakOccupancyCount = 0;
  let peakOccupancyTime = '';
  allFrames.forEach(frame => {
    if (frame.totalPersons > peakOccupancyCount) {
      peakOccupancyCount = frame.totalPersons;
      peakOccupancyTime = `${frame.time} on ${new Date(frame.fullTimestamp).toLocaleDateString()}`;
    }
  });
  
  const allGroupSizes: number[] = allFrames.flatMap(frame => frame.groupSizesAtTables);
  const averageGroupSizeOverall = allGroupSizes.length > 0 
    ? allGroupSizes.reduce((sum, size) => sum + size, 0) / allGroupSizes.length 
    : 0;

  // --- New Advanced Metrics Calculation ---
  const seenPersonIds = new Set<string>();
  const personStayTimes = new Map<string, { firstSeen: number, lastSeen: number }>();
  const seenGroupIds = new Set<string>();
  const arrivalTrend = new Map<string, { newVisitors: number, newGroups: number }>();

  allFrames.forEach(frame => {
      const frameTimestamp = new Date(frame.fullTimestamp).getTime();
      const hourlyBucket = new Date(frame.fullTimestamp).toISOString().substring(0, 13); // YYYY-MM-DDTHH

      if (!arrivalTrend.has(hourlyBucket)) {
          arrivalTrend.set(hourlyBucket, { newVisitors: 0, newGroups: 0 });
      }
      const trendBucket = arrivalTrend.get(hourlyBucket)!;
      const groupsInFrame = new Map<string, string[]>();

      // Update person stay times and find new visitors
      frame.detections.forEach(det => {
          const personData = personStayTimes.get(det.person_id);
          if (personData) {
              personData.lastSeen = frameTimestamp;
          } else {
              personStayTimes.set(det.person_id, { firstSeen: frameTimestamp, lastSeen: frameTimestamp });
          }
          
          if (!seenPersonIds.has(det.person_id)) {
              seenPersonIds.add(det.person_id);
              trendBucket.newVisitors += 1;
          }

          if (det.confirmed_seat_id) {
              if (!groupsInFrame.has(det.confirmed_seat_id)) {
                  groupsInFrame.set(det.confirmed_seat_id, []);
              }
              groupsInFrame.get(det.confirmed_seat_id)!.push(det.person_id);
          }
      });

      // Find new groups in this frame
      groupsInFrame.forEach((personIds) => {
          if (personIds.length > 0) {
              const groupId = personIds.sort().join(',');
              if (!seenGroupIds.has(groupId)) {
                  seenGroupIds.add(groupId);
                  trendBucket.newGroups += 1;
              }
          }
      });
  });

  const totalUniqueVisitors = personStayTimes.size;
  const totalUniqueGroups = seenGroupIds.size;
  let totalStayDuration = 0;
  personStayTimes.forEach(stay => { totalStayDuration += (stay.lastSeen - stay.firstSeen); });
  const averageStayTime = totalUniqueVisitors > 0 ? Math.round(totalStayDuration / totalUniqueVisitors / 60000) : 0; // in minutes

  const arrivalTrendData: ArrivalTrendDataPoint[] = Array.from(arrivalTrend.entries()).map(([timeBucket, data]) => ({
      time: timeBucket.replace('T', ' ') + ':00',
      newVisitors: data.newVisitors,
      newGroups: data.newGroups
  })).sort((a,b) => a.time.localeCompare(b.time));

  const summaryMetrics: SummaryMetrics = {
    currentTotalCustomers,
    currentOccupiedTables,
    averageGroupSizeOverall: parseFloat(averageGroupSizeOverall.toFixed(2)),
    peakOccupancyTime,
    peakOccupancyCount,
    totalUniqueVisitors,
    totalUniqueGroups,
    averageStayTime,
  };

  // --- Generate aggregated data for charts ---
  const aggregatedTimeSeries = aggregateTimeSeries(allFrames);
  const seatUsageTimeline = generateSeatUsageTimeline(allFrames);
  const interpolatedOccupancyData = generateInterpolatedOccupancy(allFrames, seatUsageTimeline);
  
  // Downsample the detailed frame data for sending to the UI
  const processedFrames = downsample(allFrames);

  return { processedFrames, summaryMetrics, arrivalTrendData, aggregatedTimeSeries, seatUsageTimeline, interpolatedOccupancyData };
}

self.onmessage = (e: MessageEvent<{ jsonString: string, startTime: string | null }>) => {
  try {
    const { jsonString, startTime } = e.data;
    const data: RestaurantData = JSON.parse(jsonString);

    // Basic validation
    if (typeof data !== 'object' || data === null || Object.keys(data).length === 0) {
        throw new Error("JSON data is empty or not an object.");
    }

    let filteredData: RestaurantData = data;
    if (startTime) {
        const startTimestamp = new Date(startTime).getTime();
        if (!isNaN(startTimestamp)) {
            filteredData = Object.entries(data).reduce((acc, [frameKey, detections]) => {
                if (detections && detections.length > 0) {
                    const frameTimestamp = new Date(detections[0].timestamp).getTime();
                    if (!isNaN(frameTimestamp) && frameTimestamp >= startTimestamp) {
                        acc[frameKey] = detections;
                    }
                }
                return acc;
            }, {} as RestaurantData);
        }
    }


    const firstFrameKey = Object.keys(filteredData)[0];
    if (firstFrameKey) {
        const firstFrame = filteredData[firstFrameKey];
        if (!Array.isArray(firstFrame)) {
             throw new Error("JSON structure is not as expected. Should be { frameKey: [detections...] }.");
        }
        // Deeper validation for the new format
        if (firstFrame.length > 0) {
            const firstDetection = firstFrame[0];
            if (typeof firstDetection.person_id === 'undefined' || typeof firstDetection.timestamp === 'undefined') {
                throw new Error("Detection object is missing required fields like 'person_id' or 'timestamp'.");
            }
        }
    }


    const result = processData(filteredData);
    self.postMessage({ type: 'success', data: result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Unknown worker error' });
  }
}; 
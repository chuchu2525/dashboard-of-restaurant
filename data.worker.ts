import { RestaurantData, ProcessedFrame, SummaryMetrics, SeatOccupancyDataPoint, ArrivalTrendDataPoint, AggregatedTimeSeries, TimeSeriesDataPoint, SeatUsageBlock } from './types';

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

function generateSeatUsageTimeline(allFrames: ProcessedFrame[]): SeatUsageBlock[] {
    const usageBlocks: SeatUsageBlock[] = [];
    if (allFrames.length === 0) return usageBlocks;

    const seatStates = new Map<string, {
        personIds: string; // Stored as a sorted, comma-separated string
        startTime: number;
        lastSeenTime: number;
        personCount: number;
    }>();
    
    // Finalize a session and add it to the blocks array
    const finalizeSession = (seatId: string, endTime: number) => {
        const state = seatStates.get(seatId);
        if (!state) return;
        const duration = Math.round((endTime - state.startTime) / 60000);
        if (duration > 0) {
            usageBlocks.push({
                seatId: seatId,
                startTime: new Date(state.startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                duration,
                personCount: state.personCount,
                personIds: state.personIds.split(','),
            });
        }
        seatStates.delete(seatId);
    };

    allFrames.forEach((frame) => {
        const frameTimestamp = new Date(frame.fullTimestamp).getTime();
        const seatsInFrame = new Map<string, string[]>();
        const seatsInFrameById = new Map<string, string>();

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
                finalizeSession(seatId, state.lastSeenTime);
                if (currentGroupId) {
                     seatStates.set(seatId, {
                        personIds: currentGroupId,
                        startTime: frameTimestamp,
                        lastSeenTime: frameTimestamp,
                        personCount: seatsInFrame.get(seatId)!.length,
                    });
                }
            }
            checkedSeats.add(seatId);
        }

        // Check for brand new sessions
        for (const [seatId, groupId] of seatsInFrameById.entries()) {
            if (!checkedSeats.has(seatId)) {
                seatStates.set(seatId, {
                    personIds: groupId,
                    startTime: frameTimestamp,
                    lastSeenTime: frameTimestamp,
                    personCount: seatsInFrame.get(seatId)!.length,
                });
            }
        }
    });

    // After the loop, close any remaining open sessions
    for (const seatId of seatStates.keys()) {
        finalizeSession(seatId, seatStates.get(seatId)!.lastSeenTime);
    }
    
    return usageBlocks.sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

// This function is the core processing logic, moved from App.tsx
function processData(data: RestaurantData): { 
  processedFrames: ProcessedFrame[], 
  summaryMetrics: SummaryMetrics, 
  arrivalTrendData: ArrivalTrendDataPoint[],
  aggregatedTimeSeries: AggregatedTimeSeries,
  seatUsageTimeline: SeatUsageBlock[]
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
    throw new Error("No valid data found in the file after processing.");
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
  
  // Downsample the detailed frame data for sending to the UI
  const processedFrames = downsample(allFrames);

  return { processedFrames, summaryMetrics, arrivalTrendData, aggregatedTimeSeries, seatUsageTimeline };
}

self.onmessage = (e: MessageEvent<string>) => {
  try {
    const jsonString = e.data;
    const data: RestaurantData = JSON.parse(jsonString);

    // Basic validation
    if (typeof data !== 'object' || data === null || Object.keys(data).length === 0) {
        throw new Error("JSON data is empty or not an object.");
    }
    const firstFrameKey = Object.keys(data)[0];
    const firstFrame = data[firstFrameKey];
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

    const result = processData(data);
    self.postMessage({ type: 'success', data: result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Unknown worker error' });
  }
}; 
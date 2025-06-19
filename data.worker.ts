import { RestaurantData, ProcessedFrame, SummaryMetrics, SeatOccupancyDataPoint } from './types';

function downsample(frames: ProcessedFrame[], maxPoints: number = 500): ProcessedFrame[] {
  if (frames.length <= maxPoints) {
    return frames;
  }

  const downsampled: ProcessedFrame[] = [];
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

// This function is the core processing logic, moved from App.tsx
function processData(data: RestaurantData): { processedFrames: ProcessedFrame[], summaryMetrics: SummaryMetrics } {
  const allFrames: ProcessedFrame[] = Object.entries(data)
    .map(([frameKey, detections]) => {
      if (!detections || detections.length === 0) {
        return null;
      }
      const firstDetection = detections[0];
      const time = new Date(firstDetection.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      const seatCounts: Record<string, number> = {};
      detections.forEach(det => {
        if (det.confirmed_seat_id) {
          seatCounts[det.confirmed_seat_id] = (seatCounts[det.confirmed_seat_id] || 0) + 1;
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
  
  // Calculate Summary Metrics
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
  
  const allGroupSizes: number[] = [];
  allFrames.forEach(frame => {
    allGroupSizes.push(...frame.groupSizesAtTables);
  });
  const totalCustomersInAllGroups = allGroupSizes.reduce((sum, size) => sum + size, 0);
  const averageGroupSizeOverall = allGroupSizes.length > 0 
    ? totalCustomersInAllGroups / allGroupSizes.length 
    : 0;

  const summaryMetrics: SummaryMetrics = {
    currentTotalCustomers,
    currentOccupiedTables,
    averageGroupSizeOverall: parseFloat(averageGroupSizeOverall.toFixed(2)),
    peakOccupancyTime,
    peakOccupancyCount,
  };

  // Downsample the frames for sending to the UI
  const processedFrames = downsample(allFrames);

  return { processedFrames, summaryMetrics };
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
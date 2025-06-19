import { RestaurantData, ProcessedFrame, SummaryMetrics, SeatOccupancyDataPoint } from './types';

// This function is the core processing logic, moved from App.tsx
function processData(data: RestaurantData): { processedFrames: ProcessedFrame[], summaryMetrics: SummaryMetrics } {
  const framesArray: ProcessedFrame[] = Object.entries(data)
    .map(([frameKey, detections]) => {
      if (!detections || detections.length === 0) {
        return null;
      }
      const firstDetection = detections[0];
      const time = new Date(firstDetection.Time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      const seatCounts: Record<string, number> = {};
      detections.forEach(det => {
        seatCounts[det.SeatID] = (seatCounts[det.SeatID] || 0) + 1;
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
        fullTimestamp: firstDetection.Time,
        totalPersons: firstDetection.TotalPerson,
        seatOccupancy,
        groupSizesAtTables,
      };
    })
    .filter((frame): frame is ProcessedFrame => frame !== null)
    .sort((a, b) => new Date(a.fullTimestamp).getTime() - new Date(b.fullTimestamp).getTime());

  if (framesArray.length === 0) {
    throw new Error("No valid data found in the file after processing.");
  }
  
  // Calculate Summary Metrics
  const latestFrame = framesArray[framesArray.length - 1];
  const currentTotalCustomers = latestFrame.totalPersons;
  const currentOccupiedTables = latestFrame.seatOccupancy.filter(s => s.persons > 0).length;

  let peakOccupancyCount = 0;
  let peakOccupancyTime = '';
  framesArray.forEach(frame => {
    if (frame.totalPersons > peakOccupancyCount) {
      peakOccupancyCount = frame.totalPersons;
      peakOccupancyTime = `${frame.time} on ${new Date(frame.fullTimestamp).toLocaleDateString()}`;
    }
  });
  
  const allGroupSizes: number[] = [];
  framesArray.forEach(frame => {
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

  return { processedFrames: framesArray, summaryMetrics };
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
    if (!Array.isArray(data[firstFrameKey])) {
         throw new Error("JSON structure is not as expected. Should be { frameKey: [detections...] }.");
    }

    const result = processData(data);
    self.postMessage({ type: 'success', data: result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Unknown worker error' });
  }
}; 
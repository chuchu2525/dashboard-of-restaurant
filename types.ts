export interface PersonDetection {
  ID: number;
  Name: string;
  Class: number;
  Score: number;
  BBox: [number, number, number, number];
  Time: string; // "YYYY-MM-DD HH:MM:SS"
  Total: number; // Total detections in this frame (seems same as TotalPerson)
  TotalPerson: number; // Total persons in this frame
  DetectedCount: number; // Cumulative detection counter
  SeatID: string; // e.g., "table3"
  SeatConfirmed: boolean;
}

export interface FrameDetections extends Array<PersonDetection> {}

export interface RestaurantData {
  [frameKey: string]: FrameDetections;
}

// Processed data structures
export interface ProcessedFrame {
  frameId: string;
  detections: FrameDetections;
  time: string; // Extracted time (e.g., HH:MM:SS)
  fullTimestamp: string; // Original full timestamp
  totalPersons: number;
  seatOccupancy: SeatOccupancyDataPoint[];
  groupSizesAtTables: number[]; // e.g. [2,3,1] for tables with 2, 3, and 1 person
}

export interface TimeSeriesDataPoint {
  time: string; // HH:MM:SS for chart display
  totalPersons: number;
}

export interface SeatOccupancyDataPoint {
  seatId: string;
  persons: number;
}

export interface GroupSizeDistributionDataPoint {
  groupSize: string; // "1 person", "2 people", etc.
  frequency: number;
}

export interface SummaryMetrics {
  currentTotalCustomers: number;
  currentOccupiedTables: number;
  averageGroupSizeOverall: number;
  peakOccupancyTime: string;
  peakOccupancyCount: number;
}

export interface TableOccupancyOverTimeDataPoint {
  time: string; // HH:MM:SS for chart display
  [seatId: string]: number | string; // Dynamic keys for each seatId, e.g., table1: 2
}
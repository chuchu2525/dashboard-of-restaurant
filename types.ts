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
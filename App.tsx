
import React, { useState, useCallback } from 'react';
import { FileUpload } from './components/FileUpload';
import { Dashboard } from './components/Dashboard';
import { RestaurantData, ProcessedFrame, SummaryMetrics, PersonDetection, SeatOccupancyDataPoint } from './types';

const App: React.FC = () => {
  const [restaurantData, setRestaurantData] = useState<RestaurantData | null>(null);
  const [processedFrames, setProcessedFrames] = useState<ProcessedFrame[]>([]);
  const [summaryMetrics, setSummaryMetrics] = useState<SummaryMetrics | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const processData = useCallback((data: RestaurantData) => {
    setIsLoading(true);
    setError(null);
    try {
      const framesArray: ProcessedFrame[] = Object.entries(data)
        .map(([frameKey, detections]) => {
          if (!detections || detections.length === 0) {
            return null; // Skip empty frames
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
        .filter((frame): frame is ProcessedFrame => frame !== null) // Type guard and filter out nulls
        .sort((a, b) => new Date(a.fullTimestamp).getTime() - new Date(b.fullTimestamp).getTime()); // Sort by time

      if (framesArray.length === 0) {
        setError("No valid data found in the file after processing.");
        setRestaurantData(null);
        setProcessedFrames([]);
        setSummaryMetrics(null);
        setIsLoading(false);
        return;
      }
      
      setProcessedFrames(framesArray);

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
      const averageGroupSizeOverall = allGroupSizes.length > 0 
        ? allGroupSizes.reduce((sum, size) => sum + size, 0) / allGroupSizes.length 
        : 0;

      setSummaryMetrics({
        currentTotalCustomers,
        currentOccupiedTables,
        averageGroupSizeOverall: parseFloat(averageGroupSizeOverall.toFixed(2)),
        peakOccupancyTime,
        peakOccupancyCount,
      });
      setRestaurantData(data); // Store original raw data if needed elsewhere
      
    } catch (e) {
      console.error("Error processing data:", e);
      setError("Failed to process the data. Ensure the JSON format is correct.");
      setRestaurantData(null);
      setProcessedFrames([]);
      setSummaryMetrics(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFileUpload = useCallback((data: RestaurantData, name: string) => {
    setFileName(name);
    processData(data);
  }, [processData]);

  const handleFileError = useCallback((errMsg: string) => {
    setError(errMsg);
    setRestaurantData(null);
    setProcessedFrames([]);
    setSummaryMetrics(null);
    setFileName('');
  }, []);
  
  const handleClearData = useCallback(() => {
    setRestaurantData(null);
    setProcessedFrames([]);
    setSummaryMetrics(null);
    setFileName('');
    setError(null);
    setIsLoading(false);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-gray-200 p-4 sm:p-6 lg:p-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-white tracking-tight">Restaurant Occupancy Dashboard</h1>
        <p className="text-lg text-slate-400 mt-2">Analyze customer patterns and optimize your restaurant's operations.</p>
      </header>

      <main>
        {!restaurantData && !isLoading && (
          <div className="max-w-xl mx-auto bg-slate-800 shadow-2xl rounded-lg p-8">
            <FileUpload onFileUploadSuccess={handleFileUpload} onFileUploadError={handleFileError} />
          </div>
        )}
        {isLoading && (
           <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
            <p className="ml-4 text-xl">Processing data...</p>
          </div>
        )}
        {error && (
          <div className="max-w-xl mx-auto mt-4 bg-red-700 text-white p-4 rounded-md shadow-lg">
            <p className="font-semibold">Error:</p>
            <p>{error}</p>
            <button 
              onClick={handleClearData} 
              className="mt-2 bg-red-500 hover:bg-red-400 text-white font-bold py-2 px-4 rounded transition duration-150"
            >
              Try again
            </button>
          </div>
        )}
        {restaurantData && !error && !isLoading && processedFrames.length > 0 && summaryMetrics && (
          <Dashboard 
            processedFrames={processedFrames} 
            summaryMetrics={summaryMetrics} 
            fileName={fileName}
            onClearData={handleClearData}
          />
        )}
      </main>
      <footer className="text-center mt-12 text-slate-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Restaurant Analytics. Powered by Data.</p>
      </footer>
    </div>
  );
};

export default App;
    
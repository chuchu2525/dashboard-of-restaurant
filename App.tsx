import React, { useState, useCallback, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { Dashboard } from './components/Dashboard';
import { RestaurantData, ProcessedFrame, SummaryMetrics, ArrivalTrendDataPoint, AggregatedTimeSeries, SeatUsageBlock, TableOccupancyOverTimeDataPoint } from './types';

const App: React.FC = () => {
  const [processedFrames, setProcessedFrames] = useState<ProcessedFrame[]>([]);
  const [summaryMetrics, setSummaryMetrics] = useState<SummaryMetrics | null>(null);
  const [arrivalTrend, setArrivalTrend] = useState<ArrivalTrendDataPoint[]>([]);
  const [aggregatedTimeSeries, setAggregatedTimeSeries] = useState<AggregatedTimeSeries | null>(null);
  const [seatUsageTimeline, setSeatUsageTimeline] = useState<SeatUsageBlock[]>([]);
  const [interpolatedOccupancyData, setInterpolatedOccupancyData] = useState<TableOccupancyOverTimeDataPoint[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasData, setHasData] = useState<boolean>(false);
  const [originalJson, setOriginalJson] = useState<string>('');
  const [startTimeFilter, setStartTimeFilter] = useState<string>('');


  const processDataWithWorker = useCallback((jsonString: string, startTime: string | null) => {
    if (!jsonString) return;

    setIsLoading(true);
    setError(null);
    setHasData(false);

    const worker = new Worker(new URL('./data.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e) => {
      const { type, data, error: workerError } = e.data;
      if (type === 'success') {
        setProcessedFrames(data.processedFrames);
        setSummaryMetrics(data.summaryMetrics);
        setArrivalTrend(data.arrivalTrendData);
        setAggregatedTimeSeries(data.aggregatedTimeSeries);
        setSeatUsageTimeline(data.seatUsageTimeline);
        setInterpolatedOccupancyData(data.interpolatedOccupancyData);
        setHasData(true);
      } else {
        console.error("Error from worker:", workerError);
        setError(workerError || "Failed to process data in worker.");
        setHasData(false);
      }
      setIsLoading(false);
      worker.terminate();
    };

    worker.onerror = (e) => {
      console.error("Worker error:", e);
      setError("An unexpected error occurred in the data processing worker.");
      setHasData(false);
      setIsLoading(false);
      worker.terminate();
    };
    
    worker.postMessage({ jsonString, startTime });
  }, []);

  const handleFileUpload = useCallback((jsonString: string, name: string, startTime: string) => {
    setOriginalJson(jsonString);
    setFileName(name);
    setStartTimeFilter(startTime);
    processDataWithWorker(jsonString, startTime || null);
  }, [processDataWithWorker]);

  const handleFileError = useCallback((errMsg: string) => {
    setError(errMsg);
    setHasData(false);
    setFileName('');
  }, []);
  

  const handleClearData = useCallback(() => {
    setProcessedFrames([]);
    setSummaryMetrics(null);
    setArrivalTrend([]);
    setAggregatedTimeSeries(null);
    setSeatUsageTimeline([]);
    setInterpolatedOccupancyData([]);
    setFileName('');
    setError(null);
    setIsLoading(false);
    setHasData(false);
    setOriginalJson('');
    setStartTimeFilter('');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-gray-200 p-4 sm:p-6 lg:p-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-white tracking-tight">Restaurant Occupancy Dashboard</h1>
        <p className="text-lg text-slate-400 mt-2">Analyze customer patterns and optimize your restaurant's operations.</p>
      </header>

      <main>
        {!hasData && !isLoading && (
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
        {hasData && !error && !isLoading && (
          processedFrames.length > 0 && summaryMetrics ? (
            <Dashboard 
              processedFrames={processedFrames} 
              summaryMetrics={summaryMetrics} 
              arrivalTrendData={arrivalTrend}
              aggregatedTimeSeries={aggregatedTimeSeries}
              seatUsageTimeline={seatUsageTimeline}
              interpolatedOccupancyData={interpolatedOccupancyData}
              fileName={fileName}
              onClearData={handleClearData}
              startTimeFilter={startTimeFilter}
            />
          ) : (
            <div className="max-w-xl mx-auto text-center p-8 bg-slate-800 rounded-lg shadow-xl">
              <h3 className="text-xl font-semibold text-sky-300 mb-2">No Data to Display</h3>
              <p className="text-slate-400">
                There is no data available for the selected file and time range.
                Please try clearing the start time filter or upload a different file.
              </p>
              <button 
                onClick={handleClearData} 
                className="mt-6 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded transition duration-150"
              >
                Load New File
              </button>
            </div>
          )
        )}
      </main>
      <footer className="text-center mt-12 text-slate-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Restaurant Analytics. Powered by Data.</p>
      </footer>
    </div>
  );
};

export default App;
    
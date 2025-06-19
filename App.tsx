import React, { useState, useCallback, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { Dashboard } from './components/Dashboard';
import { RestaurantData, ProcessedFrame, SummaryMetrics } from './types';

const App: React.FC = () => {
  const [processedFrames, setProcessedFrames] = useState<ProcessedFrame[]>([]);
  const [summaryMetrics, setSummaryMetrics] = useState<SummaryMetrics | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasData, setHasData] = useState<boolean>(false);


  const handleFileUpload = useCallback((jsonString: string, name: string) => {
    setIsLoading(true);
    setError(null);
    setFileName(name);

    // Vite-specific worker instantiation
    const worker = new Worker(new URL('./data.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e) => {
      const { type, data, error: workerError } = e.data;
      if (type === 'success') {
        setProcessedFrames(data.processedFrames);
        setSummaryMetrics(data.summaryMetrics);
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
    
    worker.postMessage(jsonString);
  }, []);

  const handleFileError = useCallback((errMsg: string) => {
    setError(errMsg);
    setHasData(false);
    setFileName('');
  }, []);
  
  const handleClearData = useCallback(() => {
    setProcessedFrames([]);
    setSummaryMetrics(null);
    setFileName('');
    setError(null);
    setIsLoading(false);
    setHasData(false);
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
        {hasData && !error && !isLoading && processedFrames.length > 0 && summaryMetrics && (
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
    
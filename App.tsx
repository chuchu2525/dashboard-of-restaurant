import React, { useState, useCallback, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { Dashboard } from './components/Dashboard';
import { RestaurantData, ProcessedFrame, SummaryMetrics, ArrivalTrendDataPoint, AggregatedTimeSeries, SeatUsageBlock, TableOccupancyOverTimeDataPoint } from './types';

// API URL設定
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
  const [uploadProgress, setUploadProgress] = useState<number>(0);


  const processDataWithAPI = useCallback(async (jsonString: string, name: string, startTime: string, durationHms: string) => {
    if (!jsonString) return;

    setIsLoading(true);
    setError(null);
    setHasData(false);
    setUploadProgress(0);

    try {
      // JSONデータをパース
      const jsonData = JSON.parse(jsonString);
      const frameKeys = Object.keys(jsonData);
      const totalFrames = frameKeys.length;

      // チャンクサイズを決定（10,000フレーム = 約10-15MB）
      const CHUNK_SIZE = 10000;
      const totalChunks = Math.ceil(totalFrames / CHUNK_SIZE);

      console.log(`Starting chunked upload: ${totalFrames} frames in ${totalChunks} chunks`);

      // 1. セッション初期化
      const initResponse = await fetch(`${API_URL}/api/videos/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: name,
          recordingStartTime: startTime || '2025-06-30 10:00:00',
          recordingDuration: durationHms,
          videoFps: 30,
          totalFrames,
          totalChunks,
        }),
      });

      if (!initResponse.ok) {
        const errorData = await initResponse.json();
        throw new Error(errorData.details || 'Init failed');
      }

      const { videoId } = await initResponse.json();
      console.log('Upload session initialized:', videoId);

      // 2. 各チャンクをアップロード
      for (let i = 0; i < totalChunks; i++) {
        const startIdx = i * CHUNK_SIZE;
        const endIdx = Math.min((i + 1) * CHUNK_SIZE, totalFrames);
        const chunkKeys = frameKeys.slice(startIdx, endIdx);

        // このチャンクのフレームデータを抽出
        const chunkData: Record<string, any> = {};
        chunkKeys.forEach(key => {
          chunkData[key] = jsonData[key];
        });

        console.log(`Uploading chunk ${i + 1}/${totalChunks} (${chunkKeys.length} frames)...`);

        const chunkResponse = await fetch(`${API_URL}/api/videos/upload/chunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            chunkIndex: i,
            totalChunks,
            jsonData: chunkData,
            isLastChunk: i === totalChunks - 1,
          }),
        });

        if (!chunkResponse.ok) {
          const errorData = await chunkResponse.json();
          throw new Error(`Chunk ${i + 1} upload failed: ${errorData.details || 'Unknown error'}`);
        }

        const chunkResult = await chunkResponse.json();
        console.log(`Chunk ${i + 1}/${totalChunks} completed: ${chunkResult.processedFrames}/${chunkResult.totalFrames} frames processed`);

        // 進捗を更新
        const progress = Math.round(((i + 1) / totalChunks) * 100);
        setUploadProgress(progress);
      }

      // 3. 完了確認
      console.log('Verifying upload completion...');
      const completeResponse = await fetch(`${API_URL}/api/videos/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });

      if (!completeResponse.ok) {
        const errorData = await completeResponse.json();
        throw new Error(errorData.details || 'Complete check failed');
      }

      const completeResult = await completeResponse.json();

      if (!completeResult.isComplete) {
        throw new Error(`Upload incomplete: ${completeResult.processedFrames}/${completeResult.totalFrames} frames`);
      }

      console.log('Video uploaded successfully:', videoId);

      // 4. ダッシュボード用データを取得
      const dataUrl = startTime
        ? `${API_URL}/api/videos/${videoId}/data?startTime=${encodeURIComponent(startTime)}`
        : `${API_URL}/api/videos/${videoId}/data`;

      const dataResponse = await fetch(dataUrl);

      if (!dataResponse.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const dashboardData = await dataResponse.json();

      // 状態を更新
      setProcessedFrames(dashboardData.processedFrames);
      setSummaryMetrics(dashboardData.summaryMetrics);
      setArrivalTrend(dashboardData.arrivalTrendData);
      setAggregatedTimeSeries(dashboardData.aggregatedTimeSeries);
      setSeatUsageTimeline(dashboardData.seatUsageTimeline);
      setInterpolatedOccupancyData(dashboardData.interpolatedOccupancyData);
      setHasData(true);
    } catch (err: any) {
      console.error('Error processing data:', err);
      setError(err.message || 'Failed to process data');
      setHasData(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFileUpload = useCallback((jsonString: string, name: string, startTime: string, durationHms: string) => {
    setOriginalJson(jsonString);
    setFileName(name);
    setStartTimeFilter(startTime);
    processDataWithAPI(jsonString, name, startTime, durationHms);
  }, [processDataWithAPI]);

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
    setUploadProgress(0);
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
          <div className="flex flex-col justify-center items-center h-64">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
            <p className="mt-4 text-xl">Processing data...</p>
            {uploadProgress > 0 && (
              <div className="mt-4 w-64">
                <div className="bg-slate-700 rounded-full h-4">
                  <div
                    className="bg-blue-500 h-4 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-center mt-2 text-sm text-slate-400">{uploadProgress}% uploaded</p>
              </div>
            )}
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
    

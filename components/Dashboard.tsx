import React, { useState, useMemo } from 'react';
import { ProcessedFrame, SummaryMetrics, TimeSeriesDataPoint, SeatOccupancyDataPoint, GroupSizeDistributionDataPoint, TableOccupancyOverTimeDataPoint, ArrivalTrendDataPoint, AggregatedTimeSeries, TimeSeriesGranularity, SeatUsageBlock } from '../types';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { MetricCard } from './MetricCard';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

interface DashboardProps {
  processedFrames: ProcessedFrame[];
  summaryMetrics: SummaryMetrics;
  arrivalTrendData: ArrivalTrendDataPoint[];
  aggregatedTimeSeries: AggregatedTimeSeries | null;
  seatUsageTimeline: SeatUsageBlock[];
  interpolatedOccupancyData: TableOccupancyOverTimeDataPoint[];
  fileName: string;
  onClearData: () => void;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82Ca9D', '#FF847C', '#E84A5F', '#2A363B'];

// Attempt to initialize GoogleGenAI client
// API_KEY is expected to be in process.env set by the execution environment
let ai: GoogleGenAI | null = null;
let aiInitializationError: string | null = null;
try {
  // IMPORTANT: process.env.API_KEY is an environment variable. 
  // It should NOT be hardcoded here or exposed to the client-side directly if this were a typical web app.
  // For this specific environment, we assume process.env.API_KEY is securely available.
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    ai = new GoogleGenAI({ apiKey });
  } else {
    aiInitializationError = "API_KEY environment variable not set. AI features will be disabled.";
    console.warn(aiInitializationError);
  }
} catch (e) {
  aiInitializationError = `Failed to initialize GoogleGenAI: ${e instanceof Error ? e.message : String(e)}`;
  console.error(aiInitializationError);
  ai = null; 
}


const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-700 p-3 rounded shadow-lg border border-slate-600">
        <p className="label text-slate-300">{`${label}`}</p>
        {payload.map((entry: any, index: number) => (
           <p key={`item-${index}`} style={{ color: entry.color || entry.fill }} className="intro">
            {`${entry.name || entry.dataKey}: ${typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const formatAiSuggestions = (text: string): React.ReactNode => {
  const lines = text.split('\n');
  const listItems: React.ReactNode[] = [];
  let inList = false;

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ') || /^\d+\.\s/.test(trimmedLine)) {
      if (!inList) {
        inList = true;
      }
      listItems.push(<li key={`item-${index}`} className="ml-5 list-disc mb-1">{trimmedLine.replace(/^[-*]|\d+\.\s*/, '').trim()}</li>);
    } else {
      if (inList) {
        // End of a list, wrap previous items in <ul>
        // This simple logic might need improvement for complex nested lists
        inList = false; 
      }
      if (trimmedLine) {
         // Check for headings (e.g., lines ending with ':') or bolded text
        if (trimmedLine.endsWith(':') || (trimmedLine.startsWith('**') && trimmedLine.endsWith('**'))) {
            listItems.push(<h4 key={`heading-${index}`} className="text-md font-semibold mt-3 mb-1 text-sky-200">{trimmedLine.replace(/\*\*/g, '')}</h4>);
        } else {
            listItems.push(<p key={`p-${index}`} className="mb-2">{trimmedLine}</p>);
        }
      } else if (listItems.length > 0 && typeof listItems[listItems.length-1] !== 'string' ) { // Avoid multiple <br> for consecutive empty lines
        listItems.push(<br key={`br-${index}`} />);
      }
    }
  });
  
  // Wrap in a div container for overall styling
  return <div className="prose prose-sm prose-invert max-w-none">{listItems}</div>;
};

const GanttTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const dataKey = payload[0].dataKey as string;
    const value = payload[0].value;

    // Extract block index from dataKey like "block_0_duration"
    const match = dataKey.match(/block_(\d+)_duration/);
    if (!match) return null;

    const blockIndex = match[1];
    const block = data[`block_${blockIndex}_details`];
    if (!block) return null;

    return (
      <div className="bg-slate-700 p-3 rounded shadow-lg border border-slate-600 text-sm">
        <p className="font-bold text-sky-300">{data.seatId}</p>
        <p className="text-slate-300">
          Start: {new Date(block.startTime).toLocaleTimeString('en-GB')}
        </p>
        <p className="text-slate-300">
          End: {new Date(block.endTime).toLocaleTimeString('en-GB')}
        </p>
        <p className="text-slate-300">Duration: {block.duration} min</p>
        <p className="text-slate-300">Group Size: {block.personCount} people</p>
        <p className="text-slate-300">Group IDs: {block.personIds.join(', ')}</p>
      </div>
    );
  }
  return null;
};

const CustomGanttLegend = () => {
  const legendItems = [
    { value: '1 Person', color: getGroupColor(1) },
    { value: '2 People', color: getGroupColor(2) },
    { value: '3-4 People', color: getGroupColor(3) },
    { value: '5+ People', color: getGroupColor(5) },
  ];

  return (
    <div className="flex justify-center items-center space-x-4 mt-3">
      {legendItems.map(item => (
        <div key={item.value} className="flex items-center">
          <div className="w-3.5 h-3.5 rounded-full mr-2" style={{ backgroundColor: item.color }}></div>
          <span className="text-xs text-slate-300">{item.value}</span>
        </div>
      ))}
    </div>
  );
};

const getGroupColor = (personCount: number) => {
    if (personCount === 1) return '#3b82f6'; // Blue
    if (personCount === 2) return '#22c55e'; // Green
    if (personCount >= 3 && personCount <= 4) return '#f97316'; // Orange
    if (personCount > 4) return '#ef4444'; // Red
    return '#6b7280'; // Gray for unknown/0
};

export const Dashboard: React.FC<DashboardProps> = ({ processedFrames, summaryMetrics, arrivalTrendData, aggregatedTimeSeries, seatUsageTimeline, interpolatedOccupancyData, fileName, onClearData }) => {
  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState<boolean>(false);
  const [aiSuggestionsError, setAiSuggestionsError] = useState<string | null>(aiInitializationError); // Initialize with potential AI client error
  const [timeSeriesGranularity, setTimeSeriesGranularity] = useState<TimeSeriesGranularity>('15min');

  if (processedFrames.length === 0) {
    return <p className="text-center text-xl">No data to display.</p>;
  }

  const timeSeriesData: TimeSeriesDataPoint[] = useMemo(() => {
    if (!aggregatedTimeSeries) return [];
    return aggregatedTimeSeries[timeSeriesGranularity] || [];
  }, [aggregatedTimeSeries, timeSeriesGranularity]);

  const latestFrame = processedFrames[processedFrames.length - 1];
  const seatOccupancyData: SeatOccupancyDataPoint[] = latestFrame.seatOccupancy
    .sort((a,b) => a.seatId.localeCompare(b.seatId)); 

  const groupSizeCounts: Record<number, number> = {};
  processedFrames.forEach(frame => {
    frame.groupSizesAtTables.forEach(size => {
      groupSizeCounts[size] = (groupSizeCounts[size] || 0) + 1;
    });
  });

  const groupSizeDistributionData: GroupSizeDistributionDataPoint[] = Object.entries(groupSizeCounts)
    .map(([size, frequency]) => ({
      groupSize: `${size} person${parseInt(size) > 1 ? 's' : ''}`,
      frequency,
    }))
    .sort((a,b) => parseInt(a.groupSize) - parseInt(b.groupSize));
  
  const latestFrameGroupSizes = latestFrame.groupSizesAtTables;
  const latestFrameGroupSizeCounts: Record<number, number> = {};
   latestFrameGroupSizes.forEach(size => {
      latestFrameGroupSizeCounts[size] = (latestFrameGroupSizeCounts[size] || 0) + 1;
    });
  const latestFrameGroupSizeDistribution: GroupSizeDistributionDataPoint[] = Object.entries(latestFrameGroupSizeCounts)
    .map(([size, frequency]) => ({
      groupSize: `${size} person${parseInt(size) > 1 ? 's' : ''}`,
      frequency,
    }))
    .sort((a,b) => parseInt(a.groupSize) - parseInt(b.groupSize));

  const allSeatIds = Array.from(
    new Set(processedFrames.flatMap(frame => frame.seatOccupancy.map(so => so.seatId)))
  ).sort();

  const tableOccupancyOverTimeData: TableOccupancyOverTimeDataPoint[] = processedFrames.map(frame => {
    const dataPoint: TableOccupancyOverTimeDataPoint = { time: frame.time };
    allSeatIds.forEach(seatId => {
      const seatInfo = frame.seatOccupancy.find(so => so.seatId === seatId);
      dataPoint[seatId] = seatInfo ? seatInfo.persons : 0;
    });
    return dataPoint;
  });

  const ganttChartData = useMemo(() => {
        if (seatUsageTimeline.length === 0) return [];
        console.log('[Debug] Input to Gantt Chart processing:', seatUsageTimeline);
        
        const seatData = new Map<string, { seatId: string, blocks: any[] }>();
        
        // Initialize all seats
        const allSeatIds = Array.from(new Set(seatUsageTimeline.map(b => b.seatId))).sort();
        allSeatIds.forEach(id => {
            seatData.set(id, { seatId: id, blocks: [] });
        });

        // Populate blocks
        for(const block of seatUsageTimeline) {
            const entry = seatData.get(block.seatId);
            if(entry) {
                entry.blocks.push(block);
            }
        }
        
        const chartData = Array.from(seatData.values()).map(seatInfo => {
            const dataRow: any = { seatId: seatInfo.seatId };
            
            seatInfo.blocks.sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
            
            // 累積時間でバーを作成
            let cumulativeTime = 0;
            seatInfo.blocks.forEach((block, index) => {
                const duration = block.duration;
                dataRow[`block_${index}_start`] = cumulativeTime;
                dataRow[`block_${index}_duration`] = duration;
                dataRow[`block_${index}_details`] = block;
                cumulativeTime += duration;
            });

            return dataRow;
        });
        console.log('[Debug] Gantt Chart data structure:', chartData);
        return chartData;
    }, [seatUsageTimeline]);

    const maxBlocks = useMemo(() => {
        if (!ganttChartData || ganttChartData.length === 0) return 0;
        return Math.max(...ganttChartData.map(row => Object.keys(row).filter(k => k.endsWith('_details')).length));
    }, [ganttChartData]);

  const handleGenerateSuggestions = async () => {
    if (!ai) {
      setAiSuggestionsError(aiInitializationError || "AI client is not initialized. Please ensure the API_KEY is configured correctly.");
      setIsGeneratingSuggestions(false);
      return;
    }
    if (!processedFrames.length || !summaryMetrics) {
      setAiSuggestionsError("No data available to generate suggestions.");
      setIsGeneratingSuggestions(false);
      return;
    }

    setIsGeneratingSuggestions(true);
    setAiSuggestions(null);
    setAiSuggestionsError(null);

    const peakTimesSummary = () => {
      if (!timeSeriesData || timeSeriesData.length === 0) return "Not available";
      const sortedByPersons = [...timeSeriesData].sort((a, b) => b.totalPersons - a.totalPersons);
      
      const busiest = sortedByPersons.slice(0, Math.min(3, sortedByPersons.length))
        .map(d => `${d.time} (${d.totalPersons} cust.)`)
        .join(', ');
      
      // For quietest, find distinct low points if data varies, or take last few if mostly flat
      const quietestCandidates = [...timeSeriesData].sort((a, b) => a.totalPersons - b.totalPersons);
      const quietest = quietestCandidates.slice(0, Math.min(3, quietestCandidates.length))
        .map(d => `${d.time} (${d.totalPersons} cust.)`)
        .join(', ');
        
      return `Busiest times appear to be: ${busiest || 'N/A'}. Quieter periods observed around: ${quietest || 'N/A'}.`;
    };

    const commonGroupSizesSummary = () => {
      if(!groupSizeDistributionData || groupSizeDistributionData.length === 0) return "Not available";
      const topGroups = [...groupSizeDistributionData]
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 3)
          .map(g => `${g.groupSize} (observed ${g.frequency} times)`)
          .join('; ');
      return `Most common group sizes: ${topGroups || 'N/A'}.`;
    };

    const prompt = `
You are an expert restaurant business consultant. Analyze the following data for a restaurant and provide 3-5 actionable suggestions to help them improve profitability, optimize staffing, and enhance customer experience.
Be specific with your suggestions and briefly explain the reasoning behind each. Present your suggestions as a clear, easy-to-read list.

Restaurant Data Snapshot:
- Data Source File: ${fileName}
- Latest Customer Count: ${summaryMetrics.currentTotalCustomers}
- Latest Occupied Tables: ${summaryMetrics.currentOccupiedTables}
- Overall Average Group Size: ${summaryMetrics.averageGroupSizeOverall.toFixed(2)}
- Recorded Peak Occupancy: ${summaryMetrics.peakOccupancyCount} customers at ${summaryMetrics.peakOccupancyTime}
- Customer Traffic Patterns Observed: ${peakTimesSummary()}
- Predominant Group Configurations: ${commonGroupSizesSummary()}

Based on this data, here are your recommendations:
    `;

    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: prompt,
      });
      setAiSuggestions(response.text ?? null);
    } catch (error) {
      console.error("Error generating AI suggestions:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching suggestions.";
      setAiSuggestionsError(`Failed to get suggestions from AI: ${errorMessage}`);
    } finally {
      setIsGeneratingSuggestions(false);
    }
  };


  return (
    <div className="space-y-8">
      <div className="flex flex-wrap justify-between items-center bg-slate-800 p-4 rounded-lg shadow-md gap-4">
        <h2 className="text-xl sm:text-2xl font-semibold text-sky-400">Displaying data for: <span className="text-white">{fileName}</span></h2>
        <button
            onClick={onClearData}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-lg transition duration-150 ease-in-out shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75"
            aria-label="Load a new data file"
        >
            Load New File
        </button>
      </div>

      {/* --- Visit Summary Section --- */}
      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
        <h3 className="text-xl font-semibold mb-4 text-sky-300">Visit Summary & Trends</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
          <MetricCard title="Total Unique Groups" value={summaryMetrics.totalUniqueGroups.toLocaleString()} subtitle="Across the entire duration" />
          <MetricCard title="Total Unique Visitors" value={summaryMetrics.totalUniqueVisitors.toLocaleString()} subtitle="Across the entire duration" />
          <MetricCard title="Avg. Stay Time (per person)" value={`${summaryMetrics.averageStayTime.toLocaleString()} min`} subtitle="Across the entire duration" />
          <MetricCard title="Peak Concurrent Visitors" value={`${summaryMetrics.peakOccupancyCount.toLocaleString()} `} subtitle={`at ${summaryMetrics.peakOccupancyTime}`} />
        </div>
        
        {arrivalTrendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={arrivalTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
              <XAxis dataKey="time" stroke="#90CDF4" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" stroke="#38BDF8" allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#34D399" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{color: "#E2E8F0"}}/>
              <Line yAxisId="left" type="monotone" dataKey="newVisitors" name="New Visitors (per hour)" stroke="#38BDF8" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="newGroups" name="New Groups (per hour)" stroke="#34D399" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-slate-400 text-center py-10">No arrival trend data available.</p>
        )}
      </div>

      {/* --- Current Status Section --- */}
      <h3 className="text-2xl font-bold text-center text-white -mb-4">Current & Real-time Snapshot</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
        <MetricCard title="Current Customers" value={summaryMetrics.currentTotalCustomers.toLocaleString()} />
        <MetricCard title="Occupied Tables (Now)" value={summaryMetrics.currentOccupiedTables.toLocaleString()} />
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard title="Current Customers" value={summaryMetrics.currentTotalCustomers.toLocaleString()} />
        <MetricCard title="Occupied Tables (Now)" value={summaryMetrics.currentOccupiedTables.toLocaleString()} />
        <MetricCard title="Avg. Group Size (Overall)" value={summaryMetrics.averageGroupSizeOverall.toLocaleString()} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-8">
        <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
          <div className="flex flex-wrap justify-between items-center mb-4">
            <h3 className="text-xl font-semibold text-sky-300">Total Customers Over Time</h3>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-slate-400">Granularity:</span>
              {(['raw', '1min', '15min', 'hour'] as TimeSeriesGranularity[]).map((gran) => (
                <button
                  key={gran}
                  onClick={() => setTimeSeriesGranularity(gran)}
                  className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                    timeSeriesGranularity === gran
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {gran}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timeSeriesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
              <XAxis dataKey="time" stroke="#90CDF4" />
              <YAxis stroke="#90CDF4" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{color: "#E2E8F0"}} />
              <Line type="monotone" dataKey="totalPersons" name="Total Customers" stroke="#38BDF8" strokeWidth={2} dot={timeSeriesData.length < 100 ? { r: 4, fill: '#38BDF8' } : false} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
          <h3 className="text-xl font-semibold mb-4 text-sky-300">Seat Occupancy (Latest Frame at {latestFrame.time})</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={seatOccupancyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
              <XAxis dataKey="seatId" stroke="#90CDF4" />
              <YAxis stroke="#90CDF4" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{color: "#E2E8F0"}}/>
              <Bar dataKey="persons" name="Customers" fill="#34D399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
            <h3 className="text-xl font-semibold mb-4 text-sky-300">Group Size Distribution (Latest Frame at {latestFrame.time})</h3>
            {latestFrameGroupSizeDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                <Pie
                    data={latestFrameGroupSizeDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent, groupSize }) => `${groupSize}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="frequency"
                    nameKey="groupSize"
                >
                    {latestFrameGroupSizeDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{color: "#E2E8F0"}}/>
                </PieChart>
            </ResponsiveContainer>
            ) : (
                <p className="text-slate-400 text-center py-10">No group data for the latest frame.</p>
            )}
        </div>

        <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
          <h3 className="text-xl font-semibold mb-4 text-sky-300">Group Size Distribution (Overall)</h3>
          {groupSizeDistributionData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={groupSizeDistributionData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
              <XAxis type="number" stroke="#90CDF4" allowDecimals={false} />
              <YAxis type="category" dataKey="groupSize" stroke="#90CDF4" width={100} interval={0}/>
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{color: "#E2E8F0"}}/>
              <Bar dataKey="frequency" name="Number of Groups" fill="#A78BFA" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          ) : (
             <p className="text-slate-400 text-center py-10">No group data available overall.</p>
          )}
        </div>
      </div>

      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
        <h3 className="text-xl font-semibold mb-4 text-sky-300">Table Occupancy Over Time</h3>
        {tableOccupancyOverTimeData.length > 0 && allSeatIds.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={tableOccupancyOverTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
              <XAxis dataKey="time" stroke="#90CDF4" />
              <YAxis stroke="#90CDF4" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{color: "#E2E8F0"}} />
              {allSeatIds.map((seatId, index) => (
                <Line
                  key={seatId}
                  type="monotone"
                  dataKey={seatId}
                  name={seatId}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-slate-400 text-center py-10">No table occupancy data available to display trends.</p>
        )}
      </div>

      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
        <h3 className="text-xl font-semibold mb-2 text-sky-300">Interpreted Table Occupancy (with absence tolerance)</h3>
        <p className="text-xs text-slate-400 mb-4 -mt-1">This chart shows continuous table usage, smoothing over short breaks (up to 5 mins) to reflect actual session durations.</p>
        {interpolatedOccupancyData.length > 0 && allSeatIds.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={interpolatedOccupancyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
              <XAxis dataKey="time" stroke="#90CDF4" />
              <YAxis stroke="#90CDF4" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{color: "#E2E8F0"}} />
              {allSeatIds.map((seatId, index) => (
                <Line
                  key={seatId}
                  type="monotone"
                  dataKey={seatId}
                  name={seatId}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-slate-400 text-center py-10">No interpreted table occupancy data available.</p>
        )}
      </div>

      {/* Seat Usage Timeline Section */}
      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
        <h3 className="text-xl font-semibold mb-4 text-sky-300">Seat Usage Timeline (Gantt View)</h3>
        {ganttChartData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={ganttChartData.length * 60 + 50}>
              <BarChart
                data={ganttChartData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                barCategoryGap="30%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                <XAxis 
                  type="number" 
                  stroke="#90CDF4" 
                  domain={[0, 'dataMax']}
                  label={{ value: 'Duration (minutes)', position: 'bottom', fill: '#90CDF4', dy: 10 }}
                />
                <YAxis 
                  type="category" 
                  dataKey="seatId" 
                  stroke="#90CDF4" 
                  width={80}
                  tickFormatter={(value) => value.charAt(0).toUpperCase() + value.slice(1)}
                />
                <Tooltip content={<GanttTooltip />} cursor={{ fill: 'rgba(100, 116, 139, 0.2)' }}/>
                
                {Array.from({ length: maxBlocks }).map((_, i) => (
                  <Bar 
                    key={i}
                    dataKey={`block_${i}_duration`} 
                    stackId="a" 
                    name={`Visit ${i+1}`}
                    isAnimationActive={false}
                  >
                    {ganttChartData.map((entry, cellIndex) => {
                      const block = entry[`block_${i}_details`];
                      return (
                        <Cell 
                          key={`cell-${cellIndex}`} 
                          fill={block ? getGroupColor(block.personCount) : 'transparent'} 
                        />
                      );
                    })}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
            <CustomGanttLegend />
          </>
        ) : (
          <p className="text-slate-400 text-center py-10">No seat usage data available to display timeline.</p>
        )}
      </div>

      {/* AI Suggestions Section */}
      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
        <h3 className="text-xl font-semibold mb-4 text-sky-300">AI-Powered Suggestions</h3>
        {!ai && aiInitializationError && (
           <div className="bg-yellow-800 border border-yellow-700 text-yellow-100 px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">AI Feature Notice: </strong>
            <span className="block sm:inline">{aiInitializationError}</span>
          </div>
        )}
        {ai && (
            <>
            <button
                onClick={handleGenerateSuggestions}
                disabled={isGeneratingSuggestions || !ai}
                className="bg-teal-600 hover:bg-teal-500 disabled:bg-slate-600 text-white font-bold py-2 px-6 rounded-lg transition duration-150 ease-in-out shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-opacity-75 disabled:cursor-not-allowed mb-4"
                aria-live="polite"
                aria-label={isGeneratingSuggestions ? "Generating AI suggestions..." : "Get AI-powered suggestions for your restaurant"}
            >
                {isGeneratingSuggestions ? (
                <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating...
                </>
                ) : "Get AI Suggestions"}
            </button>

            {aiSuggestionsError && !isGeneratingSuggestions && (
                <div className="bg-red-700 border border-red-600 text-white px-4 py-3 rounded relative mt-4" role="alert">
                <strong className="font-bold">Error: </strong>
                <span className="block sm:inline">{aiSuggestionsError}</span>
                </div>
            )}

            {aiSuggestions && !isGeneratingSuggestions && !aiSuggestionsError && (
                <div className="mt-4 p-4 bg-slate-700 rounded-lg max-h-96 overflow-y-auto">
                 {formatAiSuggestions(aiSuggestions)}
                </div>
            )}
            {!aiSuggestions && !isGeneratingSuggestions && !aiSuggestionsError && (
                <p className="text-slate-400 mt-4">Click the button above to generate AI-driven insights and suggestions based on your data.</p>
            )}
            </>
        )}
      </div>

    </div>
  );
};

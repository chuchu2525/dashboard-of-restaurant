import React, { useCallback, useState } from 'react';
import { RestaurantData } from '../types';

interface FileUploadProps {
  onFileUploadSuccess: (jsonString: string, fileName: string, startTime: string) => void;
  onFileUploadError: (error: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileUploadSuccess, onFileUploadError }) => {
  const [dragging, setDragging] = useState(false);
  const [startTime, setStartTime] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

  const resetState = useCallback(() => {
    setSelectedFile(null);
    setFileContent('');
    // Do not reset startTime, allow user to reuse it
  }, []);

  const processFile = useCallback((file: File) => {
    if (file.type !== 'application/json') {
      onFileUploadError('Invalid file type. Please upload a JSON file.');
      return;
    }

    // Always set the new file first
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          throw new Error("File is empty or could not be read.");
        }
        // Then set the content for the *now current* file
        setFileContent(text);
      } catch (err) {
        console.error("File reading error:", err);
        onFileUploadError(`Error reading file: ${err instanceof Error ? err.message : 'Unknown error'}`);
        resetState();
      }
    };
    reader.onerror = () => {
        onFileUploadError('Error reading file.');
        resetState();
    };
    reader.readAsText(file);
  }, [onFileUploadError, resetState]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // It is crucial to reset state *before* processing the new file
      // to avoid submitting stale content.
      resetState();
      processFile(file);
    }
    event.target.value = ''; // Reset input to allow re-uploading the same file
  }, [processFile, resetState]);
  
  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      // Crucial reset
      resetState();
      processFile(file);
    }
  }, [processFile, resetState]);

  const handleSubmit = () => {
    if (selectedFile && fileContent) {
      onFileUploadSuccess(fileContent, selectedFile.name, startTime);
    } else {
      onFileUploadError('Please select a file first.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <label
        htmlFor="file-upload"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full max-w-lg flex flex-col items-center px-4 py-12 bg-slate-700 text-blue-300 rounded-lg shadow-lg tracking-wide uppercase border-2 border-dashed cursor-pointer hover:bg-slate-600 hover:text-sky-400 transition-all duration-300 ease-in-out
                    ${dragging ? 'border-sky-400 scale-105' : 'border-slate-500'}`}
      >
        <svg className="w-16 h-16 mb-4 text-slate-400" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
          <path d="M16.88 9.1A4 4 0 0 1 16 17H5a5 5 0 0 1-1-9.9V7a3 3 0 0 1 4.52-2.59A4.98 4.98 0 0 1 17 8c0 .38-.04.74-.12 1.1zM11 11h3l-4-4-4 4h3v3h2v-3z" />
        </svg>
        <span className="mt-2 text-base leading-normal">{selectedFile ? selectedFile.name : 'Select a JSON file or drag it here'}</span>
        <input id="file-upload" type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
      </label>
      {selectedFile && <p className="mt-4 text-sm text-green-400">File ready: {selectedFile.name}</p>}

      <div className="w-full max-w-lg my-6">
        <label htmlFor="start-time-upload" className="block text-sm font-medium text-slate-300 mb-2 text-center">
          Optional: Set Analysis Start Time
        </label>
        <input 
          type="datetime-local" 
          id="start-time-upload"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="bg-slate-900 text-white border border-slate-600 rounded-md px-3 py-2 text-sm focus:ring-sky-500 focus:border-sky-500 w-full shadow-inner"
          step="1"
        />
       </div>

      <button
        onClick={handleSubmit}
        disabled={!selectedFile}
        className="w-full max-w-lg bg-sky-600 hover:bg-sky-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition duration-150 ease-in-out shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-opacity-75"
        aria-label="Load and process the selected file"
      >
        Load Data
      </button>

    </div>
  );
};
    
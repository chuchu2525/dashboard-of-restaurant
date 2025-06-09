
import React, { useCallback, useState } from 'react';
import { RestaurantData } from '../types';

interface FileUploadProps {
  onFileUploadSuccess: (data: RestaurantData, fileName: string) => void;
  onFileUploadError: (error: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileUploadSuccess, onFileUploadError }) => {
  const [dragging, setDragging] = useState(false);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
    event.target.value = ''; // Reset input to allow re-uploading the same file
  }, [onFileUploadSuccess, onFileUploadError]);

  const processFile = (file: File) => {
    if (file.type !== 'application/json') {
      onFileUploadError('Invalid file type. Please upload a JSON file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text) as RestaurantData;
        // Basic validation of data structure
        if (typeof data !== 'object' || data === null || Object.keys(data).length === 0) {
            throw new Error("JSON data is empty or not an object.");
        }
        // Further check if the first entry is an array of objects
        const firstFrameKey = Object.keys(data)[0];
        if (!Array.isArray(data[firstFrameKey]) || (data[firstFrameKey].length > 0 && typeof data[firstFrameKey][0] !== 'object')) {
             throw new Error("JSON structure is not as expected. Should be { frameKey: [detections...] }.");
        }
        onFileUploadSuccess(data, file.name);
      } catch (err) {
        console.error("File parsing error:", err);
        onFileUploadError(`Error parsing JSON file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };
    reader.onerror = () => {
        onFileUploadError('Error reading file.');
    };
    reader.readAsText(file);
  };
  
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
      processFile(file);
    }
  }, [onFileUploadSuccess, onFileUploadError]);


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
        <span className="mt-2 text-base leading-normal">Select a JSON file or drag it here</span>
        <input id="file-upload" type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
      </label>
      <p className="mt-4 text-sm text-slate-400">Supported format: JSON (.json)</p>
    </div>
  );
};
    
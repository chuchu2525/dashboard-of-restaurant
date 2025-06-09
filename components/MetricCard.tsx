
import React from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode; // Optional: For an icon
}

export const MetricCard: React.FC<MetricCardProps> = ({ title, value, subtitle, icon }) => {
  return (
    <div className="bg-slate-800 p-6 rounded-xl shadow-xl hover:shadow-2xl transition-shadow duration-300 transform hover:-translate-y-1">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider">{title}</h4>
        {icon && <div className="text-blue-400">{icon}</div>}
      </div>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
};
    
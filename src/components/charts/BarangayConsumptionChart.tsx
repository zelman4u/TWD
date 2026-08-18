/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { BarangayConsumptionData } from '../../utils/analytics';
import { MapPin, Filter, ArrowUpDown } from 'lucide-react';

interface BarangayConsumptionChartProps {
  data: BarangayConsumptionData[];
}

export default function BarangayConsumptionChart({ data }: BarangayConsumptionChartProps) {
  const [sortBy, setSortBy] = useState<'volume' | 'average' | 'collection'>('volume');
  const [metricView, setMetricView] = useState<'volume' | 'average'>('volume');

  // Dynamic sorting
  const sortedData = [...data].sort((a, b) => {
    if (sortBy === 'volume') return b.totalVolume - a.totalVolume;
    if (sortBy === 'average') return b.averagePerConsumer - a.averagePerConsumer;
    if (sortBy === 'collection') return b.collectionRate - a.collectionRate;
    return 0;
  });

  // Dynamic Color according to consumption tier
  const getBarColor = (volume: number) => {
    if (volume >= 500) return '#2563eb'; // blue-600 (High demand)
    if (volume >= 300) return '#0ea5e9'; // sky-500 (Moderate demand)
    if (volume >= 150) return '#14b8a6'; // teal-500 (Standard demand)
    return '#8b5cf6'; // violet-500 (Light demand)
  };

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item: BarangayConsumptionData = payload[0].payload;
      return (
        <div className="bg-slate-900/95 backdrop-blur-md text-white p-4 rounded-xl border border-slate-700/80 shadow-xl text-xs space-y-2 min-w-[210px]">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-1.5">
            <span className="font-extrabold text-sky-400 text-sm">{item.barangayName}</span>
            <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono">
              {item.code}
            </span>
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between items-center text-slate-200">
              <span className="text-slate-300">Total Consumption:</span>
              <span className="font-mono font-bold text-white">{item.totalVolume.toLocaleString()} m³</span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-300">Active Connections:</span>
              <span className="font-mono text-slate-200">{item.consumerCount} households</span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-300">Average / Household:</span>
              <span className="font-mono font-bold text-amber-300">{item.averagePerConsumer} m³</span>
            </div>
            <div className="border-t border-slate-800 pt-1.5 flex justify-between items-center">
              <span className="text-slate-400">Total Billed:</span>
              <span className="font-mono font-bold text-emerald-400">₱{item.totalBilled.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Collection Efficiency:</span>
              <span className="font-mono font-bold text-sky-400">{item.collectionRate}%</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <MapPin className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Barangay Zonal Consumption Distribution</h3>
            <p className="text-xs text-slate-500">Comparative intake across Tagoloan municipal water supply routes</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Metric View toggle */}
          <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs font-semibold text-slate-600">
            <button
              onClick={() => setMetricView('volume')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                metricView === 'volume' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              Total m³
            </button>
            <button
              onClick={() => setMetricView('average')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                metricView === 'average' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              Avg / Household
            </button>
          </div>

          {/* Sort Selector */}
          <div className="flex items-center space-x-1 bg-slate-100 px-2.5 py-1.5 rounded-xl text-xs text-slate-700">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent border-0 font-bold focus:ring-0 text-xs text-slate-800 cursor-pointer outline-hidden"
            >
              <option value="volume">Sort by Total Volume</option>
              <option value="average">Sort by Avg Intake</option>
              <option value="collection">Sort by Collection %</option>
            </select>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-72 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sortedData} margin={{ top: 10, right: 10, left: -10, bottom: 25 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis 
              dataKey="barangayName" 
              tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
              axisLine={{ stroke: '#cbd5e1' }}
              tickLine={false}
              angle={-25}
              textAnchor="end"
              interval={0}
            />
            <YAxis 
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(val) => `${val}m³`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar 
              dataKey={metricView === 'volume' ? 'totalVolume' : 'averagePerConsumer'} 
              radius={[6, 6, 0, 0]}
            >
              {sortedData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={getBarColor(entry.totalVolume)} 
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend & Tier Indicators */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
        <div className="flex items-center space-x-4">
          <span className="font-bold text-slate-700">Demand Tiers:</span>
          <span className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
            <span>High (≥500 m³)</span>
          </span>
          <span className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
            <span>Moderate (300-499 m³)</span>
          </span>
          <span className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span>
            <span>Standard (150-299 m³)</span>
          </span>
          <span className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500"></span>
            <span>Light (&lt;150 m³)</span>
          </span>
        </div>
        <span className="font-mono font-semibold text-slate-400">Total {sortedData.length} Barangays Evaluated</span>
      </div>
    </div>
  );
}

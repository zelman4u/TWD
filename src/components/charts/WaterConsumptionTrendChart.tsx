/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { MonthlyConsumptionTrend } from '../../utils/analytics';
import { Activity, Droplets, TrendingUp, DollarSign, BarChart2, Layers } from 'lucide-react';

interface WaterConsumptionTrendChartProps {
  data: MonthlyConsumptionTrend[];
}

export default function WaterConsumptionTrendChart({ data }: WaterConsumptionTrendChartProps) {
  const [viewMode, setViewMode] = useState<'volume' | 'breakdown' | 'revenue' | 'average'>('volume');
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');

  // Calculate high-level summary metrics
  const totalVolume = data.reduce((acc, curr) => acc + curr.totalVolume, 0);
  const totalBilled = data.reduce((acc, curr) => acc + curr.totalBilledAmount, 0);
  const averageMonthly = data.length > 0 ? Math.round((totalVolume / data.length) * 10) / 10 : 0;
  
  // Find highest peak month
  const peakMonth = data.reduce((prev, curr) => (curr.totalVolume > prev.totalVolume ? curr : prev), data[0] || { period: 'N/A', totalVolume: 0 });

  // Custom polished Tooltip Component
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const rowData: MonthlyConsumptionTrend = payload[0]?.payload;
      return (
        <div className="bg-slate-900/95 backdrop-blur-md text-white p-4 rounded-xl border border-slate-700/80 shadow-xl text-xs space-y-2 min-w-[200px]">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
            <span className="font-extrabold text-sky-400 text-sm">{label}</span>
            <span className="text-[10px] text-slate-400 font-mono">{rowData.readingCount} Reads</span>
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between items-center text-slate-200">
              <span className="flex items-center space-x-1.5 text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
                <span>Total Discharge:</span>
              </span>
              <span className="font-mono font-bold text-white">{rowData.totalVolume.toLocaleString()} m³</span>
            </div>

            <div className="flex justify-between items-center text-slate-300">
              <span className="flex items-center space-x-1.5 text-slate-400">
                <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block"></span>
                <span>Residential:</span>
              </span>
              <span className="font-mono text-slate-200">{rowData.residentialVolume.toLocaleString()} m³</span>
            </div>

            <div className="flex justify-between items-center text-slate-300">
              <span className="flex items-center space-x-1.5 text-slate-400">
                <span className="w-2 h-2 rounded-full bg-purple-400 inline-block"></span>
                <span>Commercial:</span>
              </span>
              <span className="font-mono text-slate-200">{rowData.commercialVolume.toLocaleString()} m³</span>
            </div>

            <div className="border-t border-slate-800 pt-1.5 mt-1.5 flex justify-between items-center">
              <span className="text-slate-400">Total Billed:</span>
              <span className="font-mono font-bold text-emerald-400">₱{rowData.totalBilledAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Avg / Connection:</span>
              <span className="font-mono text-amber-300">{rowData.averageVolume} m³</span>
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
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Droplets className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Water Consumption & Discharge Dynamics</h3>
              <p className="text-xs text-slate-500">Historical time-series telemetry across municipal intake zones</p>
            </div>
          </div>
        </div>

        {/* View Mode Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Mode Switcher */}
          <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs font-semibold text-slate-600">
            <button
              onClick={() => setViewMode('volume')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center space-x-1.5 ${
                viewMode === 'volume' ? 'bg-white text-blue-700 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Total Volume</span>
            </button>
            <button
              onClick={() => setViewMode('breakdown')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center space-x-1.5 ${
                viewMode === 'breakdown' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Type Split</span>
            </button>
            <button
              onClick={() => setViewMode('revenue')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center space-x-1.5 ${
                viewMode === 'revenue' ? 'bg-white text-emerald-700 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              <DollarSign className="h-3.5 w-3.5" />
              <span>Billed Revenue</span>
            </button>
          </div>

          {/* Chart Display Style Toggle */}
          <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs">
            <button
              onClick={() => setChartType('area')}
              title="Area Trend Curve"
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                chartType === 'area' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => setChartType('bar')}
              title="Column Comparison"
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                chartType === 'bar' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <BarChart2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100 text-xs">
        <div>
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Cumulative Intake</span>
          <span className="text-base font-black text-slate-900 font-mono">{totalVolume.toLocaleString()} m³</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Avg Monthly Usage</span>
          <span className="text-base font-black text-blue-600 font-mono">{averageMonthly.toLocaleString()} m³</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Peak Usage Period</span>
          <span className="text-base font-black text-indigo-600 truncate block">{peakMonth?.period} ({peakMonth?.totalVolume} m³)</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Total Billed Tariff</span>
          <span className="text-base font-black text-emerald-600 font-mono">₱{totalBilled.toLocaleString()}</span>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-72 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'area' ? (
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="totalVolumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="residentialGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="commercialGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis 
                dataKey="period" 
                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis 
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => viewMode === 'revenue' ? `₱${(val / 1000).toFixed(0)}k` : `${val}m³`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                verticalAlign="top" 
                align="right"
                wrapperStyle={{ paddingBottom: '12px', fontSize: '11px', fontWeight: 600 }}
              />

              {viewMode === 'volume' && (
                <>
                  <Area
                    type="monotone"
                    dataKey="totalVolume"
                    name="Total Water Consumption (m³)"
                    stroke="#2563eb"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#totalVolumeGradient)"
                  />
                  <Line
                    type="monotone"
                    dataKey="averageVolume"
                    name="Avg Household Intake (m³)"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={{ r: 3, fill: '#f59e0b' }}
                  />
                </>
              )}

              {viewMode === 'breakdown' && (
                <>
                  <Area
                    type="monotone"
                    dataKey="residentialVolume"
                    name="Residential Volume (m³)"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#residentialGradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="commercialVolume"
                    name="Commercial Volume (m³)"
                    stroke="#a855f7"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#commercialGradient)"
                  />
                </>
              )}

              {viewMode === 'revenue' && (
                <Area
                  type="monotone"
                  dataKey="totalBilledAmount"
                  name="Total Billed Revenue (₱)"
                  stroke="#10b981"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#revenueGradient)"
                />
              )}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis 
                dataKey="period" 
                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis 
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => viewMode === 'revenue' ? `₱${(val / 1000).toFixed(0)}k` : `${val}m³`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                verticalAlign="top" 
                align="right"
                wrapperStyle={{ paddingBottom: '12px', fontSize: '11px', fontWeight: 600 }}
              />

              {viewMode === 'volume' && (
                <Bar 
                  dataKey="totalVolume" 
                  name="Total Consumption (m³)" 
                  fill="#2563eb" 
                  radius={[6, 6, 0, 0]} 
                />
              )}

              {viewMode === 'breakdown' && (
                <>
                  <Bar 
                    dataKey="residentialVolume" 
                    name="Residential (m³)" 
                    fill="#6366f1" 
                    radius={[6, 6, 0, 0]} 
                  />
                  <Bar 
                    dataKey="commercialVolume" 
                    name="Commercial (m³)" 
                    fill="#a855f7" 
                    radius={[6, 6, 0, 0]} 
                  />
                </>
              )}

              {viewMode === 'revenue' && (
                <Bar 
                  dataKey="totalBilledAmount" 
                  name="Billed Revenue (₱)" 
                  fill="#10b981" 
                  radius={[6, 6, 0, 0]} 
                />
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

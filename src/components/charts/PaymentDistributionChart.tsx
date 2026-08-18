/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import { PaymentStatusData } from '../../utils/analytics';
import { CreditCard, CheckCircle2, Clock, AlertCircle, Percent, ArrowUpRight } from 'lucide-react';

interface PaymentDistributionChartProps {
  data: {
    distribution: PaymentStatusData[];
    totalReceivables: number;
    totalCollected: number;
    collectionRate: number;
    totalBilled: number;
  };
}

export default function PaymentDistributionChart({ data }: PaymentDistributionChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const { distribution, totalReceivables, totalCollected, collectionRate, totalBilled } = data;

  const totalTransactions = distribution.reduce((sum, item) => sum + item.count, 0);

  // Custom polished Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item: PaymentStatusData = payload[0].payload;
      return (
        <div className="bg-slate-900/95 backdrop-blur-md text-white p-3.5 rounded-xl border border-slate-700/80 shadow-xl text-xs space-y-1.5 min-w-[170px]">
          <div className="flex items-center space-x-2 border-b border-slate-700/60 pb-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="font-bold text-slate-100">{item.status}</span>
          </div>
          <div className="flex justify-between items-center text-slate-300 pt-0.5">
            <span>Accounts:</span>
            <span className="font-mono font-bold text-white">{item.count}</span>
          </div>
          <div className="flex justify-between items-center text-slate-300">
            <span>Share:</span>
            <span className="font-mono font-bold text-sky-300">{item.percentage}%</span>
          </div>
          <div className="flex justify-between items-center text-slate-300 border-t border-slate-800 pt-1">
            <span>Amount:</span>
            <span className="font-mono font-bold text-emerald-400">₱{item.totalAmount.toLocaleString()}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  const getStatusIcon = (status: string) => {
    if (status.includes('Paid')) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (status.includes('Partial')) return <Clock className="h-4 w-4 text-amber-500" />;
    return <AlertCircle className="h-4 w-4 text-rose-500" />;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Payment Settlement Distribution</h3>
            <p className="text-xs text-slate-500">Real-time breakdown of municipal billing recovery & receivables</p>
          </div>
        </div>
        <div className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-bold">
          <Percent className="h-3.5 w-3.5" />
          <span>{collectionRate}% Efficiency</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* Donut Chart with Center Metric */}
        <div className="md:col-span-5 relative flex items-center justify-center h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={distribution}
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={95}
                paddingAngle={4}
                dataKey="count"
                onMouseEnter={(_, index) => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                {distribution.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.color} 
                    stroke={activeIndex === index ? '#ffffff' : 'none'}
                    strokeWidth={activeIndex === index ? 3 : 0}
                    className="transition-all duration-200 cursor-pointer"
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>

          {/* Central Donut Floating Metric */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Total Billed</span>
            <span className="text-sm font-black text-slate-900 font-mono">₱{(totalBilled / 1000).toFixed(1)}k</span>
            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full mt-0.5">
              {totalTransactions} Bills
            </span>
          </div>
        </div>

        {/* Breakdown Status Cards */}
        <div className="md:col-span-7 space-y-3">
          {distribution.map((item, idx) => {
            const isHovered = activeIndex === idx;
            return (
              <div
                key={item.status}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseLeave={() => setActiveIndex(null)}
                className={`p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer ${
                  isHovered 
                    ? 'border-slate-400 bg-slate-50/90 shadow-xs translate-x-1' 
                    : 'border-slate-100 bg-slate-50/40 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(item.status)}
                    <span className="text-xs font-bold text-slate-800">{item.status}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-black text-slate-900">₱{item.totalAmount.toLocaleString()}</span>
                    <span 
                      className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md font-mono"
                      style={{ 
                        backgroundColor: `${item.color}20`,
                        color: item.color
                      }}
                    >
                      {item.percentage}%
                    </span>
                  </div>
                </div>

                {/* Progress Mini-Bar */}
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500" 
                    style={{ 
                      width: `${item.percentage}%`, 
                      backgroundColor: item.color 
                    }}
                  />
                </div>

                <div className="flex justify-between items-center mt-1 text-[10px] text-slate-500">
                  <span>{item.count} Customer Accounts</span>
                  <span className="font-mono">{item.count > 0 ? `Avg ₱${Math.round(item.totalAmount / item.count)}/acct` : '₱0'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary Footer */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
        <div className="bg-emerald-50/70 border border-emerald-100 rounded-xl p-3 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">Collected Revenue</span>
            <span className="text-sm font-black text-emerald-700 font-mono">₱{totalCollected.toLocaleString()}</span>
          </div>
          <ArrowUpRight className="h-4 w-4 text-emerald-600" />
        </div>
        <div className="bg-rose-50/70 border border-rose-100 rounded-xl p-3 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-rose-800 uppercase tracking-wider block">Outstanding Arrears</span>
            <span className="text-sm font-black text-rose-700 font-mono">₱{totalReceivables.toLocaleString()}</span>
          </div>
          <AlertCircle className="h-4 w-4 text-rose-600" />
        </div>
      </div>
    </div>
  );
}

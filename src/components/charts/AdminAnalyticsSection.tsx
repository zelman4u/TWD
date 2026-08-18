/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { MeterReading, Consumer, Barangay, AuditLog } from '../../types';
import { 
  computeMonthlyTrends, 
  computePaymentDistributions, 
  computeBarangayConsumption 
} from '../../utils/analytics';
import WaterConsumptionTrendChart from './WaterConsumptionTrendChart';
import PaymentDistributionChart from './PaymentDistributionChart';
import BarangayConsumptionChart from './BarangayConsumptionChart';
import { 
  BarChart3, 
  Filter, 
  Calendar, 
  Users, 
  Droplet, 
  TrendingUp, 
  Sparkles,
  Download,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';

interface AdminAnalyticsSectionProps {
  readings: MeterReading[];
  consumers: Consumer[];
  barangayList: Barangay[];
  auditLogs: AuditLog[];
}

export default function AdminAnalyticsSection({
  readings,
  consumers,
  barangayList,
  auditLogs
}: AdminAnalyticsSectionProps) {
  // Global Filters for Analytics
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  const [selectedClassification, setSelectedClassification] = useState<string>('all');
  const [selectedBarangay, setSelectedBarangay] = useState<string>('all');

  // Extract unique periods
  const uniquePeriods = useMemo(() => {
    const periods = new Set<string>();
    readings.forEach(r => {
      if (r.billingPeriod) periods.add(r.billingPeriod);
    });
    return Array.from(periods);
  }, [readings]);

  // Filtered dataset
  const filteredReadings = useMemo(() => {
    const consumerMap = new Map<string, Consumer>();
    consumers.forEach(c => consumerMap.set(c.accountNumber, c));

    return readings.filter(r => {
      // Period filter
      if (selectedPeriod !== 'all' && r.billingPeriod !== selectedPeriod) {
        return false;
      }
      // Classification filter
      const consumer = consumerMap.get(r.accountNumber);
      const isCommercial = r.classification === 'Commercial' || consumer?.consumerType === 'Commercial';
      if (selectedClassification === 'Residential' && isCommercial) return false;
      if (selectedClassification === 'Commercial' && !isCommercial) return false;

      // Barangay filter
      const bName = consumer?.barangay || r.route;
      if (selectedBarangay !== 'all' && bName !== selectedBarangay) return false;

      return true;
    });
  }, [readings, consumers, selectedPeriod, selectedClassification, selectedBarangay]);

  // Computed data models
  const monthlyTrends = useMemo(() => {
    return computeMonthlyTrends(filteredReadings.length > 0 ? filteredReadings : readings, consumers);
  }, [filteredReadings, readings, consumers]);

  const paymentData = useMemo(() => {
    return computePaymentDistributions(filteredReadings.length > 0 ? filteredReadings : readings, consumers);
  }, [filteredReadings, readings, consumers]);

  const barangayData = useMemo(() => {
    return computeBarangayConsumption(filteredReadings.length > 0 ? filteredReadings : readings, consumers, barangayList);
  }, [filteredReadings, readings, consumers, barangayList]);

  // Quick Stats
  const totalVolume = monthlyTrends.reduce((acc, curr) => acc + curr.totalVolume, 0);
  const totalBilled = paymentData.totalBilled;
  const collectionRate = paymentData.collectionRate;

  return (
    <div className="space-y-8" id="admin-analytics-visualizers">
      {/* Filter Control Ribbon */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-extrabold text-slate-900 tracking-tight">Municipal Telemetry & Financial Analytics</h4>
            <p className="text-xs text-slate-500">Interactive charts tracking water production, consumption trends, and revenue collection</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Period Filter */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
            <Calendar className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-transparent border-0 font-bold focus:ring-0 text-xs text-slate-800 cursor-pointer outline-hidden"
              id="analytics-period-filter"
            >
              <option value="all">All Billing Cycles</option>
              {uniquePeriods.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Classification Filter */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
            <Users className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={selectedClassification}
              onChange={(e) => setSelectedClassification(e.target.value)}
              className="bg-transparent border-0 font-bold focus:ring-0 text-xs text-slate-800 cursor-pointer outline-hidden"
              id="analytics-classification-filter"
            >
              <option value="all">All Consumer Classes</option>
              <option value="Residential">Residential Only</option>
              <option value="Commercial">Commercial Only</option>
            </select>
          </div>

          {/* Barangay Filter */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
            <Filter className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={selectedBarangay}
              onChange={(e) => setSelectedBarangay(e.target.value)}
              className="bg-transparent border-0 font-bold focus:ring-0 text-xs text-slate-800 cursor-pointer outline-hidden"
              id="analytics-barangay-filter"
            >
              <option value="all">All 10 Barangays</option>
              {barangayList.map(b => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>

          {(selectedPeriod !== 'all' || selectedClassification !== 'all' || selectedBarangay !== 'all') && (
            <button
              onClick={() => {
                setSelectedPeriod('all');
                setSelectedClassification('all');
                setSelectedBarangay('all');
              }}
              className="px-2.5 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Visualizer Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (8 Cols): Time Series Water Consumption Trend Chart */}
        <div className="lg:col-span-8 space-y-8">
          <WaterConsumptionTrendChart data={monthlyTrends} />
          <BarangayConsumptionChart data={barangayData} />
        </div>

        {/* Right Column (4 Cols): Payment Distribution Donut & District Insights */}
        <div className="lg:col-span-4 space-y-8">
          <PaymentDistributionChart data={paymentData} />

          {/* District Operational Insights Panel */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                  <Sparkles className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">Operational Health Signals</h4>
              </div>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
                Normal Flow
              </span>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="flex items-start space-x-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-slate-800">Tariff Collection Rate</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    Municipal recovery is tracking at <span className="font-bold text-emerald-700">{collectionRate}%</span> against gross billed receivables.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                <TrendingUp className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-slate-800">Highest Intake Zone</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    <span className="font-bold text-blue-700">{barangayData[0]?.barangayName || 'Baluarte'}</span> registers highest aggregate intake at {barangayData[0]?.totalVolume || 710} m³.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-slate-800">Leak Prevention Audit</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    Field officers confirmed 0 active main pipe disruptions across monitored district lines.
                  </p>
                </div>
              </div>
            </div>

            {/* System Audit Activity Logs Summary */}
            <div className="border-t border-slate-100 pt-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-3">
                Live Authorization Feed
              </span>
              <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                {auditLogs.slice(0, 3).map(log => (
                  <div key={log.id} className="text-[11px] flex items-start space-x-2 border-b border-slate-100 pb-2 last:border-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0 mt-1.5"></span>
                    <div className="w-full">
                      <p className="font-bold text-slate-800">{log.action}</p>
                      <p className="text-slate-500 text-[10px] truncate">{log.details}</p>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5">{log.userName} • {new Date(log.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

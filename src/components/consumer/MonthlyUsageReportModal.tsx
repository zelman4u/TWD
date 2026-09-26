/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef } from 'react';
import { 
  FileText, 
  Download, 
  Printer, 
  X, 
  Droplet, 
  TrendingDown, 
  TrendingUp, 
  ShieldCheck, 
  Calendar, 
  Users, 
  Gauge, 
  Award, 
  Info,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Consumer, MeterReading } from '../../types';
import { calculateWaterTariff } from '../../utils/tariffCalculator';
import { mockDb } from '../../mockDb';

interface MonthlyUsageReportModalProps {
  consumer: Consumer;
  readings: MeterReading[];
  allHistoryReadings: MeterReading[];
  isOpen: boolean;
  onClose: () => void;
}

const OFFICIAL_LOGO_URL = 'https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg';
const FALLBACK_LOGO_URL = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';

// Helper to convert image URL to base64
const getBase64Image = async (url: string, fallbackUrl?: string): Promise<string | null> => {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    // Fallback to canvas
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 200;
        canvas.height = img.naturalHeight || 200;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
          return;
        }
      } catch {
        // Safe fail
      }
      resolve(null);
    };
    img.onerror = () => {
      if (fallbackUrl && fallbackUrl !== url) {
        getBase64Image(fallbackUrl).then(resolve);
      } else {
        resolve(null);
      }
    };
    img.src = url;
  });
};

export const MonthlyUsageReportModal: React.FC<MonthlyUsageReportModalProps> = ({
  consumer,
  readings,
  allHistoryReadings,
  isOpen,
  onClose
}) => {
  if (!isOpen) return null;

  // Available billing periods from readings
  const availablePeriods = useMemo(() => {
    const periods = Array.from(new Set(allHistoryReadings.map(r => r.billingPeriod).filter(Boolean)));
    if (periods.length === 0) {
      return ['August 2026', 'July 2026', 'June 2026'];
    }
    return periods;
  }, [allHistoryReadings]);

  const [selectedPeriod, setSelectedPeriod] = useState<string>(availablePeriods[0] || 'August 2026');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Selected Reading for the period
  const currentReading = useMemo(() => {
    const found = allHistoryReadings.find(r => r.billingPeriod === selectedPeriod);
    if (found) return found;
    return allHistoryReadings[0] || null;
  }, [allHistoryReadings, selectedPeriod]);

  // Dynamic District Household Average Usage Calculation
  const districtMetrics = useMemo(() => {
    const allDbReadings = mockDb.getReadings();
    const allConsumers = mockDb.getConsumers();
    const consumerMap = new Map(allConsumers.map(c => [c.accountNumber, c]));

    const periodDbReadings = allDbReadings.filter(r => 
      r.billingPeriod === selectedPeriod || (!selectedPeriod && r.consumption > 0)
    );

    const residentialReadings = periodDbReadings.filter(r => 
      (r.classification || 'Residential').toLowerCase() === 'residential' && r.consumption > 0
    );

    let avgM3 = 21.5; // Benchmark standard for Tagoloan Water District
    if (residentialReadings.length > 0) {
      const sum = residentialReadings.reduce((acc, r) => acc + (r.consumption || 0), 0);
      avgM3 = Number((sum / residentialReadings.length).toFixed(1));
    }

    // Barangay specific average
    const targetBrgy = (consumer.barangay || '').toLowerCase();
    const brgyReadings = residentialReadings.filter(r => {
      const readingBrgy = (r.addressZone || consumerMap.get(r.accountNumber)?.barangay || '').toLowerCase();
      return targetBrgy && readingBrgy === targetBrgy;
    });

    let brgyAvgM3 = avgM3;
    if (brgyReadings.length > 0) {
      const bSum = brgyReadings.reduce((acc, r) => acc + (r.consumption || 0), 0);
      brgyAvgM3 = Number((bSum / brgyReadings.length).toFixed(1));
    }

    return {
      districtAvgM3: avgM3,
      barangayAvgM3: brgyAvgM3
    };
  }, [selectedPeriod, consumer.barangay]);

  // Consumer's stats for the selected period
  const usageStats = useMemo(() => {
    const consumerM3 = currentReading ? (currentReading.consumption || 0) : 18.0;
    const avgM3 = districtMetrics.districtAvgM3;
    const brgyAvgM3 = districtMetrics.barangayAvgM3;
    const diff = Number((consumerM3 - avgM3).toFixed(1));
    const percentDiff = avgM3 > 0 ? Number(((diff / avgM3) * 100).toFixed(1)) : 0;
    const isBelowAverage = diff <= 0;

    // Tariff breakdown
    const billedAmount = calculateWaterTariff(consumerM3, consumer.consumerType === 'Commercial' ? 'Commercial' : 'Residential');
    const baseRate = 245.00; // First 10 m³
    const commodityCharge = Math.max(0, billedAmount - baseRate);

    // Efficiency Rating
    let efficiencyTitle = 'Normal Household Baseline';
    let efficiencyBadge = 'bg-blue-100 text-blue-800 border-blue-300';
    let efficiencyAdvice = 'Your household water consumption is within the standard provincial utility baseline. Maintain routine leak checks on faucets and toilet fixtures.';

    if (consumerM3 <= 10) {
      efficiencyTitle = 'Lifeline Water Conservation Hero';
      efficiencyBadge = 'bg-emerald-100 text-emerald-800 border-emerald-300';
      efficiencyAdvice = 'Exceptional water conservation! Your consumption qualifies for minimum lifeline brackets. You are using significantly less water than the average Tagoloan household.';
    } else if (isBelowAverage) {
      efficiencyTitle = 'Water Efficient Household';
      efficiencyBadge = 'bg-teal-100 text-teal-800 border-teal-300';
      efficiencyAdvice = `Great job! Your consumption is ${Math.abs(percentDiff)}% lower than the municipal average household (${avgM3} m³). Continue mindful water usage habits.`;
    } else if (percentDiff <= 25) {
      efficiencyTitle = 'Moderate Household Usage';
      efficiencyBadge = 'bg-amber-100 text-amber-800 border-amber-300';
      efficiencyAdvice = `Your consumption is ${percentDiff}% above the average household. Check outdoor garden hoses and bathroom taps to optimize your monthly water bill.`;
    } else {
      efficiencyTitle = 'High Consumption Alert';
      efficiencyBadge = 'bg-rose-100 text-rose-800 border-rose-300';
      efficiencyAdvice = `Your usage is ${percentDiff}% higher than average. We advise inspecting underground pipe lines, float valves, and overhead storage tanks for concealed leaks.`;
    }

    return {
      consumerM3,
      avgM3,
      brgyAvgM3,
      diff,
      percentDiff,
      isBelowAverage,
      billedAmount,
      baseRate,
      commodityCharge,
      efficiencyTitle,
      efficiencyBadge,
      efficiencyAdvice
    };
  }, [currentReading, districtMetrics, consumer]);

  // Historical Timeline (up to last 6 cycles)
  const historyTimeline = useMemo(() => {
    return allHistoryReadings.slice(0, 6).map(r => {
      const m3 = r.consumption || 0;
      const bAmt = calculateWaterTariff(m3, consumer.consumerType === 'Commercial' ? 'Commercial' : 'Residential');
      const varVsAvg = Number((m3 - districtMetrics.districtAvgM3).toFixed(1));
      return {
        period: r.billingPeriod || 'N/A',
        date: r.readingDate || 'N/A',
        prev: r.previousReading || 0,
        curr: r.currentReading || 0,
        m3,
        varVsAvg,
        amount: bAmt,
        status: r.paymentStatus || 'verified'
      };
    });
  }, [allHistoryReadings, consumer, districtMetrics]);

  // Direct Browser Print
  const handlePrint = () => {
    window.print();
  };

  // Generate & Download Official PDF Document
  const handleDownloadPDF = async () => {
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = 210;
      const margin = 14;

      // Load official logo
      const logoData = await getBase64Image(OFFICIAL_LOGO_URL, FALLBACK_LOGO_URL);
      if (logoData) {
        try {
          doc.addImage(logoData, 'PNG', margin, 10, 20, 20);
        } catch {
          // Ignore
        }
      }

      // Letterhead
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('REPUBLIC OF THE PHILIPPINES', pageWidth / 2, 13, { align: 'center' });

      doc.setFontSize(13);
      doc.text('TAGOLOAN WATER DISTRICT', pageWidth / 2, 19, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text('Poblacion, Tagoloan, Misamis Oriental 9001 • Provincial Water Utilities Act (PD 198)', pageWidth / 2, 24, { align: 'center' });
      doc.text('Commercial Operations & Consumer Telemetry Division • Hotline: (088) 890-4946', pageWidth / 2, 28, { align: 'center' });

      // Dividers
      doc.setDrawColor(30, 58, 138);
      doc.setLineWidth(0.6);
      doc.line(margin, 32, pageWidth - margin, 32);
      doc.setLineWidth(0.2);
      doc.line(margin, 33, pageWidth - margin, 33);

      // Report Header
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('CONSUMER MONTHLY WATER USAGE & EFFICIENCY REPORT', pageWidth / 2, 39, { align: 'center' });

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`Billing Cycle: ${selectedPeriod}  •  Report Ref: TWD-MUR-${selectedPeriod.replace(/\s+/g, '-').toUpperCase()}-${consumer.accountNumber || '001'}`, pageWidth / 2, 44, { align: 'center' });

      // Consumer Account Information Box
      autoTable(doc, {
        startY: 48,
        margin: { left: margin, right: margin },
        theme: 'plain',
        styles: { fontSize: 8, cellPadding: 2, textColor: [30, 41, 59] },
        body: [
          [
            { content: `ACCOUNT HOLDER:\n${consumer.name.toUpperCase()}`, styles: { fontStyle: 'bold' } },
            { content: `ACCOUNT NUMBER:\n#${consumer.accountNumber || 'PENDING'}`, styles: { fontStyle: 'bold' } },
            { content: `METER SERIAL NUMBER:\n#${consumer.meterNumber || 'MT-ACTIVE'}`, styles: { fontStyle: 'bold' } }
          ],
          [
            { content: `SERVICE ADDRESS:\n${consumer.address}` },
            { content: `BARANGAY & SITIO:\n${consumer.barangay || 'Poblacion'} (${consumer.sitioZone || 'Zone 1'})` },
            { content: `CLASSIFICATION / TAG:\n${consumer.consumerType || 'Residential'} • ${consumer.rfidTag || 'NFC-ENABLED'}` }
          ]
        ]
      });

      // Consumption Benchmark Box (Core User Requirement)
      const benchmarkY = (doc as any).lastAutoTable.finalY + 4;
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin, benchmarkY, pageWidth - (margin * 2), 34, 3, 3, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin, benchmarkY, pageWidth - (margin * 2), 34, 3, 3, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 58, 138);
      doc.text('CONSUMPTION BENCHMARK AGAINST DISTRICT AVERAGE HOUSEHOLD', margin + 4, benchmarkY + 6);

      // 3 Stat Boxes inside benchmark
      const statW = (pageWidth - (margin * 2) - 16) / 3;
      
      // Box 1: Your Consumption
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin + 4, benchmarkY + 9, statW, 20, 2, 2, 'FD');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('YOUR CONSUMPTION', margin + 7, benchmarkY + 14);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(29, 78, 216);
      doc.text(`${usageStats.consumerM3} m³`, margin + 7, benchmarkY + 23);

      // Box 2: Average Household
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin + 8 + statW, benchmarkY + 9, statW, 20, 2, 2, 'FD');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('DISTRICT AVERAGE HOUSEHOLD', margin + 11 + statW, benchmarkY + 14);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`${usageStats.avgM3} m³`, margin + 11 + statW, benchmarkY + 23);

      // Box 3: Variance
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin + 12 + (statW * 2), benchmarkY + 9, statW, 20, 2, 2, 'FD');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('HOUSEHOLD VARIANCE', margin + 15 + (statW * 2), benchmarkY + 14);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      if (usageStats.isBelowAverage) {
        doc.setTextColor(16, 185, 129);
        doc.text(`-${Math.abs(usageStats.diff)} m³ (-${Math.abs(usageStats.percentDiff)}%)`, margin + 15 + (statW * 2), benchmarkY + 22);
      } else {
        doc.setTextColor(225, 29, 72);
        doc.text(`+${usageStats.diff} m³ (+${usageStats.percentDiff}%)`, margin + 15 + (statW * 2), benchmarkY + 22);
      }
      doc.setFontSize(6.5);
      doc.setTextColor(71, 85, 105);
      doc.text(usageStats.isBelowAverage ? 'Water Efficient Rating' : 'Above Average Usage', margin + 15 + (statW * 2), benchmarkY + 26);

      // Efficiency Rating Banner
      const ratingY = benchmarkY + 38;
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`Official Household Efficiency Status: ${usageStats.efficiencyTitle}`, margin, ratingY);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`Recommendation: ${usageStats.efficiencyAdvice}`, margin, ratingY + 4, { maxWidth: pageWidth - (margin * 2) });

      // Monthly Tariff Breakdown Table
      autoTable(doc, {
        startY: ratingY + 11,
        margin: { left: margin, right: margin },
        head: [['TARIFF ITEM', 'CONSUMPTION TIER', 'RATE SCHEDULE (PHP)', 'ASSESSED SUB-TOTAL']],
        body: [
          ['Minimum Base Charge', 'First 10 m³ (Baseline)', 'Fixed Official Bracket', 'PHP 245.00'],
          ['Tiered Commodity Charges', `${Math.max(0, usageStats.consumerM3 - 10)} m³ incremental`, 'Poblacion Progressive Tariff', `PHP ${usageStats.commodityCharge.toFixed(2)}`],
          ['Franchise & Watershed Preservation', 'Mandatory Regulatory Fee', '2.0% Government Mandate', `PHP ${(usageStats.billedAmount * 0.02).toFixed(2)}`],
          [
            { content: 'TOTAL MONTHLY BILLING ASSESSMENT', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } },
            { content: `PHP ${(usageStats.billedAmount * 1.02).toFixed(2)}`, styles: { fontStyle: 'bold', textColor: [29, 78, 216] } }
          ]
        ],
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
        styles: { fontSize: 7.5, cellPadding: 2.2 }
      });

      // Historical Comparison Table
      const histY = (doc as any).lastAutoTable.finalY + 6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text('HISTORICAL MONTH-OVER-MONTH CONSUMPTION MATRIX', margin, histY);

      autoTable(doc, {
        startY: histY + 3,
        margin: { left: margin, right: margin },
        head: [['BILLING PERIOD', 'INSPECTION DATE', 'PREV INDEX', 'CURR INDEX', 'CONSUMED', 'VS. DISTRICT AVG', 'BILLED AMOUNT', 'STATUS']],
        body: historyTimeline.map(h => [
          h.period,
          h.date,
          `${h.prev} m³`,
          `${h.curr} m³`,
          `${h.m3} m³`,
          h.varVsAvg <= 0 ? `-${Math.abs(h.varVsAvg)} m³ (Efficient)` : `+${h.varVsAvg} m³ (Higher)`,
          `PHP ${h.amount.toFixed(2)}`,
          h.status.toUpperCase()
        ]),
        theme: 'striped',
        headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 7, fontStyle: 'bold' },
        styles: { fontSize: 7, cellPadding: 2 }
      });

      // Certification & Signatures Section
      const sigY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text('I hereby certify that the consumption telemetry reflected above represents official automated meter readings verified by Tagoloan Water District.', margin, sigY, { maxWidth: pageWidth - (margin * 2) });

      const sigColW = (pageWidth - (margin * 2)) / 2;
      
      // Left Signature
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('ENGR. ROLANDO S. MAGPALE', margin, sigY + 18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('Commercial Operations Manager', margin, sigY + 22);
      doc.text('Tagoloan Water District', margin, sigY + 25);

      // Right Signature
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.text('OFFICIAL ELECTRONIC SEAL', margin + sigColW, sigY + 18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, margin + sigColW, sigY + 22);
      doc.text('Verified Authenticated Utility Record', margin + sigColW, sigY + 25);

      // Save PDF
      doc.save(`TWD_Monthly_Usage_Report_${consumer.accountNumber || 'Account'}_${selectedPeriod.replace(/\s+/g, '_')}.pdf`);
    } catch (err) {
      console.error('Error generating consumer usage report PDF:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-blue-900 via-slate-900 to-indigo-900 p-5 sm:p-6 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-2xl border border-blue-500/30 shrink-0">
              <FileText className="h-6 w-6" />
            </div>
            <div className="truncate">
              <h3 className="text-base sm:text-lg font-black tracking-tight text-white uppercase truncate">
                Monthly Water Usage & Efficiency Report
              </h3>
              <p className="text-xs text-blue-200 truncate">
                Official consumption benchmark against average household usage in Tagoloan
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action Toolbar & Period Filter */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-2">
            <Calendar className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-700">Billing Period:</span>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer shadow-xs"
            >
              {availablePeriods.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center space-x-1.5 transition cursor-pointer shadow-xs"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Report</span>
            </button>

            <button
              onClick={handleDownloadPDF}
              disabled={isGeneratingPdf}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isGeneratingPdf ? 'Generating PDF...' : 'Download Official PDF'}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Report Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-800" ref={printAreaRef}>
          
          {/* Consumer Identification Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4.5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Consumer Name</span>
              <span className="font-black text-slate-900 text-sm block mt-0.5">{consumer.name}</span>
              <span className="text-[11px] text-slate-500 font-mono">Account #{consumer.accountNumber || 'Pending'}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Connection & Barangay</span>
              <span className="font-bold text-slate-800 block mt-0.5">{consumer.barangay || 'Poblacion'} ({consumer.sitioZone || 'Zone 1'})</span>
              <span className="text-[11px] text-slate-500 truncate block">{consumer.address}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Hardware Telemetry</span>
              <span className="font-mono font-bold text-blue-700 block mt-0.5">Meter: #{consumer.meterNumber || 'MT-ACTIVE'}</span>
              <span className="text-[11px] text-purple-700 font-mono font-bold">RFID: {consumer.rfidTag || 'NFC-TAG'}</span>
            </div>
          </div>

          {/* CONSUMPTION BENCHMARK AGAINST AVERAGE HOUSEHOLD USAGE */}
          <div className="bg-gradient-to-br from-blue-50/80 via-indigo-50/40 to-slate-50 border-2 border-blue-200 rounded-3xl p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 bg-blue-600 text-white rounded-md">
                  Municipal Benchmark Audit
                </span>
                <h4 className="text-base font-black text-slate-900 mt-1">
                  Your Consumption vs. Average Household Usage
                </h4>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase border ${usageStats.efficiencyBadge}`}>
                <Award className="h-3.5 w-3.5 shrink-0" />
                <span>{usageStats.efficiencyTitle}</span>
              </span>
            </div>

            {/* Benchmark Comparison Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              
              {/* Card 1: Your Monthly Volume */}
              <div className="bg-white p-4.5 rounded-2xl border border-blue-100 shadow-2xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Your Household Volume</span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span className="text-3xl font-black font-mono text-blue-700">{usageStats.consumerM3}</span>
                  <span className="text-sm font-bold text-slate-500">m³</span>
                </div>
                <span className="text-[10px] text-blue-600 font-semibold block mt-1">
                  {currentReading?.currentReading ? `Index: ${currentReading.previousReading} → ${currentReading.currentReading} m³` : 'Audited reading'}
                </span>
              </div>

              {/* Card 2: Average Household in District */}
              <div className="bg-white p-4.5 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Tagoloan Average Household</span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span className="text-3xl font-black font-mono text-slate-900">{usageStats.avgM3}</span>
                  <span className="text-sm font-bold text-slate-500">m³</span>
                </div>
                <span className="text-[10px] text-slate-500 font-semibold block mt-1">
                  Barangay {consumer.barangay || 'Poblacion'} Avg: {usageStats.brgyAvgM3} m³
                </span>
              </div>

              {/* Card 3: Difference & Percentage */}
              <div className={`p-4.5 rounded-2xl border shadow-2xs ${
                usageStats.isBelowAverage ? 'bg-emerald-50/80 border-emerald-200' : 'bg-rose-50/80 border-rose-200'
              }`}>
                <span className="text-[10px] font-bold uppercase text-slate-500 block">Variance from Average</span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span className={`text-3xl font-black font-mono ${
                    usageStats.isBelowAverage ? 'text-emerald-700' : 'text-rose-700'
                  }`}>
                    {usageStats.isBelowAverage ? `-${Math.abs(usageStats.diff)}` : `+${usageStats.diff}`}
                  </span>
                  <span className="text-sm font-bold text-slate-500">m³</span>
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    usageStats.isBelowAverage ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'
                  }`}>
                    {usageStats.isBelowAverage ? `-${Math.abs(usageStats.percentDiff)}%` : `+${usageStats.percentDiff}%`}
                  </span>
                </div>
                <span className={`text-[10px] font-bold block mt-1 ${
                  usageStats.isBelowAverage ? 'text-emerald-800' : 'text-rose-800'
                }`}>
                  {usageStats.isBelowAverage ? 'Conserving water below district avg' : 'Consuming more than district avg'}
                </span>
              </div>

            </div>

            {/* Visual Comparative Gauge Bar */}
            <div className="bg-white p-4.5 rounded-2xl border border-slate-200 space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-600">Visual Usage Gauge</span>
                <span className="font-mono text-blue-700">{usageStats.consumerM3} m³ (You) vs {usageStats.avgM3} m³ (Avg)</span>
              </div>
              <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div 
                  className={`h-full transition-all rounded-full ${
                    usageStats.consumerM3 <= 10 
                      ? 'bg-emerald-500' 
                      : usageStats.isBelowAverage 
                        ? 'bg-blue-600' 
                        : 'bg-amber-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(10, (usageStats.consumerM3 / (usageStats.avgM3 * 1.5)) * 100))}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>0 m³ (Lifeline)</span>
                <span className="font-bold text-slate-700">▲ Tagoloan Avg ({usageStats.avgM3} m³)</span>
                <span>40+ m³ (High)</span>
              </div>
            </div>

            {/* Personalized Efficiency Advice */}
            <div className="bg-white/80 p-4 rounded-xl border border-slate-200 flex items-start space-x-3 text-xs">
              <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <strong className="font-bold text-slate-900">Utility Advisor Notice:</strong>
                <p className="text-slate-600 leading-relaxed">{usageStats.efficiencyAdvice}</p>
              </div>
            </div>
          </div>

          {/* Itemized Billing Breakdown for Selected Month */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                Tariff Assessment Breakdown ({selectedPeriod})
              </span>
              <span className="text-xs font-black font-mono text-blue-700">
                Total: ₱{usageStats.billedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Base Minimum (10 m³)</span>
                <span className="font-mono font-bold text-slate-800 text-sm mt-0.5 block">₱245.00</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Tiered Usage Charge</span>
                <span className="font-mono font-bold text-slate-800 text-sm mt-0.5 block">
                  ₱{usageStats.commodityCharge.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Franchise & Watershed</span>
                <span className="font-mono font-bold text-slate-800 text-sm mt-0.5 block">
                  ₱{(usageStats.billedAmount * 0.02).toFixed(2)}
                </span>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                <span className="text-[10px] font-bold text-blue-600 uppercase block">Net Assessed Bill</span>
                <span className="font-mono font-black text-blue-800 text-sm mt-0.5 block">
                  ₱{(usageStats.billedAmount * 1.02).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Historical Month-over-Month Matrix */}
          <div className="space-y-2">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>Historical Reading History & Household Average Variance</span>
            </h5>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Billing Cycle</th>
                    <th className="px-4 py-3">Index (Prev → Curr)</th>
                    <th className="px-4 py-3">Consumed</th>
                    <th className="px-4 py-3">vs. District Avg</th>
                    <th className="px-4 py-3">Billed (PHP)</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyTimeline.map((h, i) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-bold text-slate-900">{h.period}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{h.prev} m³ → {h.curr} m³</td>
                      <td className="px-4 py-3 font-mono font-black text-blue-700">{h.m3} m³</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono text-[11px] font-bold ${
                          h.varVsAvg <= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}>
                          {h.varVsAvg <= 0 ? `-${Math.abs(h.varVsAvg)} m³` : `+${h.varVsAvg} m³`}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-800">
                        ₱{h.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          h.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {h.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 border-t border-slate-200 p-4.5 px-6 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500 font-medium">
            Tagoloan Water District • Official Consumer Telemetry Service
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={isGeneratingPdf}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 transition cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download PDF</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

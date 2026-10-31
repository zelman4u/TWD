/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FileText,
  Download,
  Printer,
  X,
  ShieldCheck,
  Calendar,
  Award,
  Info,
  CheckCircle2
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Consumer, MeterReading } from '../../types';
import {
  calculateWaterTariff,
  getActiveTariffConfig,
  getReadingEffectiveBillAmount
} from '../../utils/tariffCalculator';
import { mockDb } from '../../mockDb';
import { useToast } from '../../context/ToastContext';

interface MonthlyUsageReportModalProps {
  consumer: Consumer;
  readings: MeterReading[];
  allHistoryReadings: MeterReading[];
  isOpen: boolean;
  onClose: () => void;
}

const OFFICIAL_LOGO_URL = 'https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg';
const FALLBACK_LOGO_URL = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';

// Helper to convert image URL to base64 with a strict timeout so PDF generation never hangs
const getBase64ImageWithTimeout = async (url: string, fallbackUrl?: string, timeoutMs = 1500): Promise<string | null> => {
  const loadAttempt = async (targetUrl: string, allowFallback: boolean): Promise<string | null> => {
    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(targetUrl, { mode: 'cors', signal: controller.signal });
      clearTimeout(abortTimer);
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
        if (dataUrl) return dataUrl;
      }
    } catch {
      // Fallback to Image + Canvas
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
          // Ignore canvas taint
        }
        resolve(null);
      };
      img.onerror = () => {
        if (allowFallback && fallbackUrl && fallbackUrl !== targetUrl) {
          loadAttempt(fallbackUrl, false).then(resolve);
        } else {
          resolve(null);
        }
      };
      img.src = targetUrl;
    });
  };

  return Promise.race([
    loadAttempt(url, true),
    new Promise<string | null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);
};

function computeReportData(
  consumer: Consumer,
  allHistoryReadings: MeterReading[],
  selectedPeriod: string
) {
  const isComm = consumer.consumerType === 'Commercial';
  const classification: 'Residential' | 'Commercial' = isComm ? 'Commercial' : 'Residential';
  const activeTariff = getActiveTariffConfig();
  const baseRate = isComm
    ? activeTariff.commercial.baseMinCharge
    : activeTariff.residential.baseMinCharge;
  const franchiseRate = activeTariff.franchiseTaxRate ?? 0.02;

  const validHistory = allHistoryReadings.filter((r) => r.status !== 'cancelled');

  const formatReadingOptionKey = (r: MeterReading, list: MeterReading[]) => {
    const basePeriod = r.billingPeriod || r.readingDate || 'Current Cycle';
    const duplicates = list.filter((item) => (item.billingPeriod || item.readingDate || 'Current Cycle') === basePeriod);
    if (duplicates.length <= 1) return basePeriod;
    return `${basePeriod} (${r.readingDate} · Index ${r.currentReading} m³)`;
  };

  const currentReading =
    validHistory.find(
      (r) =>
        r.id === selectedPeriod ||
        formatReadingOptionKey(r, validHistory) === selectedPeriod ||
        r.billingPeriod === selectedPeriod
    ) ||
    validHistory[0] ||
    null;

  const targetBillingPeriod = currentReading?.billingPeriod || selectedPeriod;

  // Dynamic District Household Average Usage Calculation
  const allDbReadings = mockDb.getReadings().filter((r) => r.status !== 'cancelled');
  const allConsumers = mockDb.getConsumers();
  const consumerMap = new Map(allConsumers.map((c) => [c.accountNumber, c]));

  const periodDbReadings = allDbReadings.filter(
    (r) => r.billingPeriod === targetBillingPeriod || (!targetBillingPeriod && r.consumption > 0)
  );

  const residentialReadings = periodDbReadings.filter(
    (r) => (r.classification || 'Residential').toLowerCase() === 'residential' && r.consumption > 0
  );

  let districtAvgM3 = 21.5;
  if (residentialReadings.length > 0) {
    const sum = residentialReadings.reduce((acc, r) => acc + (r.consumption || 0), 0);
    districtAvgM3 = Number((sum / residentialReadings.length).toFixed(1));
  }

  const targetBrgy = (consumer.barangay || '').toLowerCase();
  const brgyReadings = residentialReadings.filter((r) => {
    const readingBrgy = (
      r.addressZone ||
      consumerMap.get(r.accountNumber)?.barangay ||
      ''
    ).toLowerCase();
    return targetBrgy && readingBrgy === targetBrgy;
  });

  let barangayAvgM3 = districtAvgM3;
  if (brgyReadings.length > 0) {
    const bSum = brgyReadings.reduce((acc, r) => acc + (r.consumption || 0), 0);
    barangayAvgM3 = Number((bSum / brgyReadings.length).toFixed(1));
  }

  const consumerM3 = currentReading ? Number(currentReading.consumption || 0) : 0;
  const diff = Number((consumerM3 - districtAvgM3).toFixed(1));
  const percentDiff = districtAvgM3 > 0 ? Number(((diff / districtAvgM3) * 100).toFixed(1)) : 0;
  const isBelowAverage = diff <= 0;

  const billedAmount = currentReading
    ? getReadingEffectiveBillAmount(currentReading, classification)
    : consumerM3 > 0
      ? calculateWaterTariff(consumerM3, classification)
      : baseRate;

  const effectiveBase = currentReading && billedAmount < baseRate ? billedAmount : baseRate;
  const commodityCharge = Math.max(0, Number((billedAmount - effectiveBase).toFixed(2)));
  const franchiseTax = Number((billedAmount * franchiseRate).toFixed(2));
  const netAssessedBill = Number((billedAmount + franchiseTax).toFixed(2));

  let efficiencyTitle = 'Normal Household Baseline';
  let efficiencyBadge = 'bg-blue-950/90 text-blue-300 border-blue-700/80';
  let efficiencyAdvice =
    'Your household water consumption is within the standard provincial utility baseline. Maintain routine leak checks on faucets and toilet fixtures.';

  if (consumerM3 <= 10) {
    efficiencyTitle = 'Lifeline Water Conservation Hero';
    efficiencyBadge = 'bg-emerald-950/90 text-emerald-300 border-emerald-700/80';
    efficiencyAdvice =
      'Exceptional water conservation! Your consumption qualifies for minimum lifeline brackets. You are using significantly less water than the average Tagoloan household.';
  } else if (isBelowAverage) {
    efficiencyTitle = 'Water Efficient Household';
    efficiencyBadge = 'bg-teal-950/90 text-teal-300 border-teal-700/80';
    efficiencyAdvice = `Great job! Your consumption is ${Math.abs(percentDiff)}% lower than the municipal average household (${districtAvgM3} m³). Continue mindful water usage habits.`;
  } else if (percentDiff <= 25) {
    efficiencyTitle = 'Moderate Household Usage';
    efficiencyBadge = 'bg-amber-950/90 text-amber-300 border-amber-700/80';
    efficiencyAdvice = `Your consumption is ${percentDiff}% above the average household. Check outdoor garden hoses and bathroom taps to optimize your monthly water bill.`;
  } else {
    efficiencyTitle = 'High Consumption Alert';
    efficiencyBadge = 'bg-rose-950/90 text-rose-300 border-rose-700/80';
    efficiencyAdvice = `Your usage is ${percentDiff}% higher than average. We advise inspecting underground pipe lines, float valves, and overhead storage tanks for concealed leaks.`;
  }

  const historyTimeline = validHistory.slice(0, 8).map((r) => {
    const m3 = r.consumption || 0;
    const bAmt = getReadingEffectiveBillAmount(r, classification);
    const varVsAvg = Number((m3 - districtAvgM3).toFixed(1));
    const prev = r.previousReading || 0;
    const pres = r.presentReading ?? r.currentReading ?? prev;
    return {
      period: r.billingPeriod || 'N/A',
      date: r.readingDate || 'N/A',
      prev,
      pres,
      curr: r.currentReading ?? pres,
      m3,
      varVsAvg,
      amount: bAmt,
      status: r.status === 'pending' || r.status === 'flagged_abnormal'
        ? 'pending approval'
        : r.paymentStatus || r.status || 'verified'
    };
  });

  return {
    currentReading,
    consumerM3,
    avgM3: districtAvgM3,
    brgyAvgM3: barangayAvgM3,
    diff,
    percentDiff,
    isBelowAverage,
    billedAmount,
    baseRate: effectiveBase,
    commodityCharge,
    franchiseTax,
    franchiseRate,
    netAssessedBill,
    efficiencyTitle,
    efficiencyBadge,
    efficiencyAdvice,
    historyTimeline
  };
}

/**
 * Generates and downloads the Official Consumer Monthly Water Usage & Efficiency Report PDF.
 * Can be invoked directly from "My Usage" or inside MonthlyUsageReportModal.
 */
export async function downloadConsumerUsageReportPdf(params: {
  consumer: Consumer;
  allHistoryReadings: MeterReading[];
  selectedPeriod?: string;
}): Promise<{ success: boolean; fileName: string; error?: string }> {
  const { consumer, allHistoryReadings } = params;
  const defaultPeriod =
    params.selectedPeriod ||
    allHistoryReadings.find((r) => Boolean(r.billingPeriod))?.billingPeriod ||
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const safeAcc = (consumer.accountNumber || 'PENDING').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePeriod = defaultPeriod.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `TWD_Monthly_Usage_Report_${safeAcc}_${safePeriod}.pdf`;

  try {
    const stats = computeReportData(consumer, allHistoryReadings, defaultPeriod);

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = 210;
    const margin = 14;

    // Load official logo with timeout so PDF never stalls
    const logoData = await getBase64ImageWithTimeout(OFFICIAL_LOGO_URL, FALLBACK_LOGO_URL, 1500);
    if (logoData) {
      try {
        doc.addImage(logoData, 'PNG', margin, 10, 18, 18);
      } catch {
        // Safe skip if format unsupported
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
    doc.text(
      'Poblacion, Tagoloan, Misamis Oriental 9001 • Provincial Water Utilities Act (PD 198)',
      pageWidth / 2,
      24,
      { align: 'center' }
    );
    doc.text(
      'Commercial Operations & Consumer Telemetry Division • Hotline: (088) 890-4946',
      pageWidth / 2,
      28,
      { align: 'center' }
    );

    // Dividers
    doc.setDrawColor(30, 58, 138);
    doc.setLineWidth(0.6);
    doc.line(margin, 32, pageWidth - margin, 32);
    doc.setLineWidth(0.2);
    doc.line(margin, 33, pageWidth - margin, 33);

    // Report Header
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text('CONSUMER MONTHLY WATER USAGE & EFFICIENCY REPORT', pageWidth / 2, 39, {
      align: 'center'
    });

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Billing Cycle: ${defaultPeriod}  •  Report Ref: TWD-MUR-${defaultPeriod.replace(/\s+/g, '-').toUpperCase()}-${consumer.accountNumber || '001'}`,
      pageWidth / 2,
      44,
      { align: 'center' }
    );

    // Consumer Account Information Box
    let cursorY = 48;
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 2, textColor: [30, 41, 59] },
      body: [
        [
          { content: `ACCOUNT HOLDER:\n${(consumer.name || 'CONSUMER').toUpperCase()}`, styles: { fontStyle: 'bold' } },
          { content: `ACCOUNT NUMBER:\n#${consumer.accountNumber || 'PENDING'}`, styles: { fontStyle: 'bold' } },
          { content: `METER SERIAL NUMBER:\n#${consumer.meterNumber || 'PENDING'}`, styles: { fontStyle: 'bold' } }
        ],
        [
          { content: `SERVICE ADDRESS:\n${consumer.address || 'Tagoloan, Misamis Oriental'}` },
          { content: `BARANGAY & SITIO:\n${consumer.barangay || 'Poblacion'} (${consumer.sitioZone || 'Zone 1'})` },
          { content: `CLASSIFICATION / TAG:\n${consumer.consumerType || 'Residential'} • ${consumer.rfidTag || 'NFC-ENABLED'}` }
        ]
      ],
      didDrawPage: (data) => {
        if (data.cursor?.y) cursorY = data.cursor.y;
      }
    });

    const afterInfoY = (doc as any).lastAutoTable?.finalY ?? (cursorY > 48 ? cursorY : 68);
    const benchmarkY = afterInfoY + 4;

    // Consumption Benchmark Box
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, benchmarkY, pageWidth - margin * 2, 34, 3, 3, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, benchmarkY, pageWidth - margin * 2, 34, 3, 3, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 58, 138);
    doc.text('CONSUMPTION BENCHMARK AGAINST DISTRICT AVERAGE HOUSEHOLD', margin + 4, benchmarkY + 6);

    const statW = (pageWidth - margin * 2 - 16) / 3;

    // Box 1: Your Consumption
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin + 4, benchmarkY + 9, statW, 20, 2, 2, 'FD');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('YOUR CONSUMPTION', margin + 7, benchmarkY + 14);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(29, 78, 216);
    doc.text(`${stats.consumerM3} m3`, margin + 7, benchmarkY + 23);

    // Box 2: District Average
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin + 8 + statW, benchmarkY + 9, statW, 20, 2, 2, 'FD');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('DISTRICT AVERAGE HOUSEHOLD', margin + 11 + statW, benchmarkY + 14);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${stats.avgM3} m3`, margin + 11 + statW, benchmarkY + 23);

    // Box 3: Variance
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin + 12 + statW * 2, benchmarkY + 9, statW, 20, 2, 2, 'FD');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('HOUSEHOLD VARIANCE', margin + 15 + statW * 2, benchmarkY + 14);
    doc.setFontSize(11.5);
    doc.setFont('helvetica', 'bold');
    if (stats.isBelowAverage) {
      doc.setTextColor(16, 185, 129);
      doc.text(
        `-${Math.abs(stats.diff)} m3 (-${Math.abs(stats.percentDiff)}%)`,
        margin + 15 + statW * 2,
        benchmarkY + 22
      );
    } else {
      doc.setTextColor(225, 29, 72);
      doc.text(
        `+${stats.diff} m3 (+${stats.percentDiff}%)`,
        margin + 15 + statW * 2,
        benchmarkY + 22
      );
    }
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      stats.isBelowAverage ? 'Water Efficient Rating' : 'Above Average Usage',
      margin + 15 + statW * 2,
      benchmarkY + 26
    );

    // Efficiency Rating Banner
    const ratingY = benchmarkY + 39;
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`Official Household Efficiency Status: ${stats.efficiencyTitle}`, margin, ratingY);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Recommendation: ${stats.efficiencyAdvice}`, margin, ratingY + 4.5, {
      maxWidth: pageWidth - margin * 2
    });

    // Monthly Tariff Breakdown Table
    let tariffEndY = ratingY + 42;
    autoTable(doc, {
      startY: ratingY + 12,
      margin: { left: margin, right: margin },
      head: [['TARIFF ITEM', 'CONSUMPTION TIER', 'RATE SCHEDULE (PHP)', 'ASSESSED SUB-TOTAL']],
      body: [
        [
          'Minimum Base Charge',
          'First 10 m3 (Baseline)',
          'Fixed Official Bracket',
          `PHP ${stats.baseRate.toFixed(2)}`
        ],
        [
          'Tiered Commodity Charges',
          `${Math.max(0, stats.consumerM3 - 10)} m3 incremental`,
          'Progressive Utility Tariff',
          `PHP ${stats.commodityCharge.toFixed(2)}`
        ],
        [
          'Franchise & Watershed Preservation',
          'Mandatory Regulatory Fee',
          `${(stats.franchiseRate * 100).toFixed(1)}% Government Mandate`,
          `PHP ${stats.franchiseTax.toFixed(2)}`
        ],
        [
          {
            content: 'TOTAL MONTHLY BILLING ASSESSMENT',
            colSpan: 3,
            styles: { fontStyle: 'bold', halign: 'right' }
          },
          {
            content: `PHP ${stats.netAssessedBill.toFixed(2)}`,
            styles: { fontStyle: 'bold', textColor: [29, 78, 216] }
          }
        ]
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
      styles: { fontSize: 7.5, cellPadding: 2.2 },
      didDrawPage: (data) => {
        if (data.cursor?.y) tariffEndY = data.cursor.y;
      }
    });

    const histY = ((doc as any).lastAutoTable?.finalY ?? tariffEndY) + 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('HISTORICAL MONTH-OVER-MONTH CONSUMPTION MATRIX', margin, histY);

    let historyEndY = histY + 25;
    const historyRows =
      stats.historyTimeline.length > 0
        ? stats.historyTimeline.map((h) => [
            h.period,
            h.date,
            `${h.prev} m3`,
            `${h.pres} m3`,
            `${h.m3} m3 (Idx ${h.curr})`,
            h.varVsAvg <= 0
              ? `-${Math.abs(h.varVsAvg)} m3 (Efficient)`
              : `+${h.varVsAvg} m3 (Higher)`,
            `PHP ${h.amount.toFixed(2)}`,
            String(h.status).toUpperCase()
          ])
        : [['No verified meter readings logged yet', '-', '-', '-', '0 m3', 'Baseline', 'PHP 0.00', 'PENDING']];

    autoTable(doc, {
      startY: histY + 3,
      margin: { left: margin, right: margin },
      head: [
        [
          'BILLING PERIOD',
          'INSPECTION DATE',
          'PREV READING',
          'PRES READING',
          'CURRENT / USED',
          'VS. DISTRICT AVG',
          'BILLED AMOUNT',
          'STATUS'
        ]
      ],
      body: historyRows,
      theme: 'striped',
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 7, fontStyle: 'bold' },
      styles: { fontSize: 7, cellPadding: 2 },
      didDrawPage: (data) => {
        if (data.cursor?.y) historyEndY = data.cursor.y;
      }
    });

    const sigY = Math.min(258, ((doc as any).lastAutoTable?.finalY ?? historyEndY) + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      'I hereby certify that the consumption telemetry reflected above represents official meter readings verified by Tagoloan Water District.',
      margin,
      sigY,
      { maxWidth: pageWidth - margin * 2 }
    );

    const sigColW = (pageWidth - margin * 2) / 2;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('ENGR. ROLANDO S. MAGPALE', margin, sigY + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Commercial Operations Manager', margin, sigY + 20);
    doc.text('Tagoloan Water District', margin, sigY + 23);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text('OFFICIAL ELECTRONIC SEAL', margin + sigColW, sigY + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, margin + sigColW, sigY + 20);
    doc.text('Verified Authenticated Utility Record', margin + sigColW, sigY + 23);

    // Reliable browser download (works inside preview iframes and all desktop/mobile browsers)
    try {
      const pdfBlob = doc.output('blob');
      const blobUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch {
      doc.save(fileName);
    }

    return { success: true, fileName };
  } catch (err: any) {
    console.error('Error generating consumer usage report PDF:', err);
    return {
      success: false,
      fileName,
      error: err?.message || 'Unable to generate PDF document.'
    };
  }
}

export const MonthlyUsageReportModal: React.FC<MonthlyUsageReportModalProps> = ({
  consumer,
  allHistoryReadings,
  isOpen,
  onClose
}) => {
  const toast = useToast();

  // Available billing periods from readings (ALL hooks unconditionally declared before early return!)
  const availablePeriods = useMemo(() => {
    const valid = allHistoryReadings.filter((r) => r.status !== 'cancelled');
    const labels = valid.map((r) => {
      const basePeriod = r.billingPeriod || r.readingDate || 'Current Cycle';
      const duplicates = valid.filter((item) => (item.billingPeriod || item.readingDate || 'Current Cycle') === basePeriod);
      return duplicates.length <= 1
        ? basePeriod
        : `${basePeriod} (${r.readingDate} · Index ${r.currentReading} m³)`;
    });
    const periods = Array.from(new Set(labels.filter(Boolean)));
    if (periods.length === 0) {
      const fallbackCurrent = new Date().toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
      });
      return [fallbackCurrent];
    }
    return periods;
  }, [allHistoryReadings]);

  const [selectedPeriod, setSelectedPeriod] = useState<string>(availablePeriods[0] || '');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (availablePeriods.length > 0 && !availablePeriods.includes(selectedPeriod)) {
      setSelectedPeriod(availablePeriods[0]);
    }
  }, [availablePeriods, selectedPeriod]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const usageStats = useMemo(
    () => computeReportData(consumer, allHistoryReadings, selectedPeriod || availablePeriods[0]),
    [consumer, allHistoryReadings, selectedPeriod, availablePeriods]
  );

  // Safe conditional return AFTER all React hooks
  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    try {
      const result = await downloadConsumerUsageReportPdf({
        consumer,
        allHistoryReadings,
        selectedPeriod: selectedPeriod || availablePeriods[0]
      });
      if (result.success) {
        toast.success(
          'Usage Report Downloaded',
          `Official PDF report (${result.fileName}) has been downloaded.`
        );
      } else {
        toast.error('PDF Download Failed', result.error || 'Could not generate the usage report PDF.');
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-slate-900 text-slate-100 rounded-3xl shadow-2xl border border-slate-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        id="monthly-usage-report-modal"
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 p-5 sm:p-6 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3.5 min-w-0">
            <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-2xl border border-blue-500/30 shrink-0">
              <FileText className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-md">
                  Official Utility Report
                </span>
                <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                  Account #{consumer.accountNumber || 'Pending'}
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-black tracking-tight text-white uppercase truncate mt-0.5">
                Monthly Water Usage & Efficiency Report
              </h3>
              <p className="text-xs text-slate-300 truncate">
                Official consumption benchmark against average household usage in Tagoloan
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition cursor-pointer shrink-0"
            title="Close Report"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action Toolbar & Period Filter - Dark Slate */}
        <div className="bg-slate-950/90 border-b border-slate-800 px-5 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-2.5">
            <Calendar className="h-4 w-4 text-blue-400" />
            <span className="text-xs font-bold text-slate-300">Billing Period:</span>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {availablePeriods.map((p) => (
                <option key={p} value={p} className="bg-slate-900 text-white">
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl flex items-center space-x-1.5 transition cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-slate-300" />
              <span>Print Report</span>
            </button>

            <button
              onClick={handleDownloadPDF}
              disabled={isGeneratingPdf}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl flex items-center space-x-1.5 transition shadow-md shadow-blue-600/20 cursor-pointer disabled:opacity-50"
              id="modal-download-official-pdf-btn"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isGeneratingPdf ? 'Generating PDF...' : 'Download Official PDF'}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Report Content - Dark Slate Enterprise Theme */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 text-slate-100" ref={printAreaRef}>
          {/* Consumer Identification Card */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Consumer Name
              </span>
              <span className="font-black text-white text-sm block mt-0.5">{consumer.name}</span>
              <span className="text-[11px] text-amber-300 font-mono font-bold">
                Account #{consumer.accountNumber || 'Pending'}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Connection & Barangay
              </span>
              <span className="font-bold text-slate-200 block mt-0.5">
                {consumer.barangay || 'Poblacion'} ({consumer.sitioZone || 'Zone 1'})
              </span>
              <span className="text-[11px] text-slate-400 truncate block">{consumer.address}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Hardware Telemetry
              </span>
              <span className="font-mono font-bold text-sky-400 block mt-0.5">
                Meter: #{consumer.meterNumber || 'Pending'}
              </span>
              <span className="text-[11px] text-purple-300 font-mono font-bold">
                RFID: {consumer.rfidTag || 'NFC-TAG'}
              </span>
            </div>
          </div>

          {/* CONSUMPTION BENCHMARK AGAINST AVERAGE HOUSEHOLD USAGE */}
          <div className="bg-gradient-to-br from-slate-950 via-blue-950/30 to-slate-950 border border-blue-800/60 rounded-3xl p-5 sm:p-6 shadow-lg space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 bg-blue-600 text-white rounded-md">
                  Municipal Benchmark Audit
                </span>
                <h4 className="text-base font-black text-white mt-1.5">
                  Your Consumption vs. Average Household Usage
                </h4>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase border self-start sm:self-auto ${usageStats.efficiencyBadge}`}
              >
                <Award className="h-3.5 w-3.5 shrink-0" />
                <span>{usageStats.efficiencyTitle}</span>
              </span>
            </div>

            {/* Benchmark Comparison Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Card 1: Your Monthly Volume */}
              <div className="bg-slate-900/90 p-4 rounded-2xl border border-blue-800/60">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Your Household Volume
                </span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span className="text-3xl font-black font-mono tabular-nums text-sky-400">
                    {usageStats.consumerM3}
                  </span>
                  <span className="text-sm font-bold text-slate-400">m³</span>
                </div>
                <span className="text-[10px] text-blue-300 font-semibold block mt-1 font-mono tabular-nums">
                  {usageStats.currentReading
                    ? `Prev ${usageStats.currentReading.previousReading} → Pres ${usageStats.currentReading.presentReading ?? usageStats.currentReading.currentReading} m³ (Curr ${usageStats.currentReading.currentReading})`
                    : `Baseline: ${consumer.previousReading ?? 0} m³`}
                </span>
              </div>

              {/* Card 2: Average Household in District */}
              <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Tagoloan Average Household
                </span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span className="text-3xl font-black font-mono tabular-nums text-white">
                    {usageStats.avgM3}
                  </span>
                  <span className="text-sm font-bold text-slate-400">m³</span>
                </div>
                <span className="text-[10px] text-slate-400 font-semibold block mt-1">
                  Barangay {consumer.barangay || 'Poblacion'} Avg: {usageStats.brgyAvgM3} m³
                </span>
              </div>

              {/* Card 3: Difference & Percentage */}
              <div
                className={`p-4 rounded-2xl border ${
                  usageStats.isBelowAverage
                    ? 'bg-emerald-950/40 border-emerald-800/70'
                    : 'bg-rose-950/40 border-rose-800/70'
                }`}
              >
                <span className="text-[10px] font-bold uppercase text-slate-300 block">
                  Variance from Average
                </span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span
                    className={`text-3xl font-black font-mono tabular-nums ${
                      usageStats.isBelowAverage ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {usageStats.isBelowAverage
                      ? `-${Math.abs(usageStats.diff)}`
                      : `+${usageStats.diff}`}
                  </span>
                  <span className="text-sm font-bold text-slate-400">m³</span>
                  <span
                    className={`text-xs font-bold px-1.5 py-0.5 rounded font-mono ${
                      usageStats.isBelowAverage
                        ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-700/60'
                        : 'bg-rose-900/80 text-rose-200 border border-rose-700/60'
                    }`}
                  >
                    {usageStats.isBelowAverage
                      ? `-${Math.abs(usageStats.percentDiff)}%`
                      : `+${usageStats.percentDiff}%`}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-bold block mt-1 ${
                    usageStats.isBelowAverage ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {usageStats.isBelowAverage
                    ? 'Conserving water below district avg'
                    : 'Consuming more than district avg'}
                </span>
              </div>
            </div>

            {/* Visual Comparative Gauge Bar */}
            <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-300">Visual Usage Gauge</span>
                <span className="font-mono text-sky-400">
                  {usageStats.consumerM3} m³ (You) vs {usageStats.avgM3} m³ (Avg)
                </span>
              </div>
              <div className="relative h-3.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all rounded-full ${
                    usageStats.consumerM3 <= 10
                      ? 'bg-emerald-500'
                      : usageStats.isBelowAverage
                        ? 'bg-blue-500'
                        : 'bg-amber-500'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(6, (usageStats.consumerM3 / Math.max(1, usageStats.avgM3 * 1.5)) * 100)
                    )}%`
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>0 m³ (Lifeline)</span>
                <span className="font-bold text-slate-200">
                  ▲ Tagoloan Avg ({usageStats.avgM3} m³)
                </span>
                <span>40+ m³ (High)</span>
              </div>
            </div>

            {/* Personalized Efficiency Advice */}
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex items-start space-x-3 text-xs">
              <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <strong className="font-bold text-white">Utility Advisor Notice:</strong>
                <p className="text-slate-300 leading-relaxed">{usageStats.efficiencyAdvice}</p>
              </div>
            </div>
          </div>

          {/* Itemized Billing Breakdown for Selected Month */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="bg-slate-950 px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                Tariff Assessment Breakdown ({selectedPeriod || availablePeriods[0]})
              </span>
              <span className="text-xs font-black font-mono text-sky-400">
                Basic Water Charge: ₱
                {usageStats.billedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">
                  Base Minimum (10 m³)
                </span>
                <span className="font-mono font-bold text-white text-sm mt-1 block">
                  ₱{usageStats.baseRate.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">
                  Tiered Usage Charge
                </span>
                <span className="font-mono font-bold text-white text-sm mt-1 block">
                  ₱{usageStats.commodityCharge.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">
                  Franchise Tax ({(usageStats.franchiseRate * 100).toFixed(0)}%)
                </span>
                <span className="font-mono font-bold text-white text-sm mt-1 block">
                  ₱{usageStats.franchiseTax.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-blue-950/60 p-3.5 rounded-xl border border-blue-800/70">
                <span className="text-[10px] font-bold text-blue-300 uppercase block">
                  Net Assessed Bill
                </span>
                <span className="font-mono font-black text-sky-300 text-sm mt-1 block">
                  ₱{usageStats.netAssessedBill.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Historical Month-over-Month Matrix */}
          <div className="space-y-2.5">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-blue-400" />
              <span>Historical Reading History & Household Average Variance</span>
            </h5>
            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950 text-slate-300 font-bold uppercase border-b border-slate-800 text-[10px]">
                    <tr>
                      <th className="px-4 py-3">Billing Cycle</th>
                      <th className="px-4 py-3">Previous → Present</th>
                      <th className="px-4 py-3">Current & Usage</th>
                      <th className="px-4 py-3">vs. District Avg</th>
                      <th className="px-4 py-3">Billed (PHP)</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/80 text-slate-200">
                    {usageStats.historyTimeline.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          No historical meter readings logged for this account yet.
                        </td>
                      </tr>
                    ) : (
                      usageStats.historyTimeline.map((h, i) => (
                        <tr key={i} className="hover:bg-slate-800/60 transition">
                          <td className="px-4 py-3 font-bold text-white">
                            {h.period}
                            <span className="text-[10px] text-slate-400 font-mono block">{h.date}</span>
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums text-slate-300">
                            {h.prev} m³ → <strong className="text-white">{h.pres} m³</strong>
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums font-black text-sky-400">
                            {h.m3} m³ <span className="text-[10px] text-slate-400 font-normal">(Idx {h.curr})</span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`font-mono text-[11px] font-bold ${
                                h.varVsAvg <= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {h.varVsAvg <= 0 ? `-${Math.abs(h.varVsAvg)} m³` : `+${h.varVsAvg} m³`}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-slate-200">
                            ₱{h.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
                                h.status === 'paid' || h.status === 'verified'
                                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                                  : 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                              }`}
                            >
                              {h.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer - Dark Slate */}
        <div className="bg-slate-950 border-t border-slate-800 py-4 px-5 sm:px-6 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>Tagoloan Water District • Authenticated Consumer Telemetry Report</span>
          </div>

          <div className="flex items-center space-x-2 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={isGeneratingPdf}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl flex items-center space-x-1.5 transition cursor-pointer shadow-md shadow-blue-600/20 disabled:opacity-50"
            >
              {isGeneratingPdf ? (
                <CheckCircle2 className="h-3.5 w-3.5 animate-pulse" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>{isGeneratingPdf ? 'Downloading...' : 'Download PDF'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

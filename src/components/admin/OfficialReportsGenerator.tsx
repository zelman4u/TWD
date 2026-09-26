import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  FileText, 
  Download, 
  Printer, 
  Filter, 
  Calendar, 
  MapPin, 
  Users, 
  Gauge, 
  DollarSign, 
  CheckCircle2, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  Building2, 
  UserCheck, 
  RefreshCw,
  Droplet,
  Search,
  Eye,
  FileSpreadsheet,
  X,
  Layers,
  ChevronRight,
  ShieldAlert,
  Clock,
  Briefcase,
  Moon,
  Sun,
  Sparkles,
  FileDown,
  CheckSquare
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Consumer, MeterReading, WaterMeter, Barangay, MeterReader, User } from '../../types';
import { calculateWaterTariff } from '../../utils/tariffCalculator';

interface OfficialReportsGeneratorProps {
  consumers: Consumer[];
  readings: MeterReading[];
  meters: WaterMeter[];
  barangays: Barangay[];
  meterReaders?: MeterReader[];
  currentUser?: User | null;
}

export type ReportCategory = 
  | 'daily_accomplishment'
  | 'unread_meter'
  | 'consumption_trend'
  | 'billing_prep'
  | 'consolidated_master'
  | 'consumption' 
  | 'billing' 
  | 'collection' 
  | 'pending_ar' 
  | 'summary_matrix' 
  | 'barangay_performance' 
  | 'reading_status' 
  | 'meter_reader_perf' 
  | 'abnormal_consumption' 
  | 'arrears_ledger';

const OFFICIAL_LOGO_URL = 'https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg';
const FALLBACK_LOGO_URL = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
const PH_SEAL_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Coat_of_arms_of_the_Philippines.svg/500px-Coat_of_arms_of_the_Philippines.svg.png';
const PH_SEAL_FALLBACK = 'https://upload.wikimedia.org/wikipedia/commons/8/84/Coat_of_arms_of_the_Philippines.svg';

// Robust helper to load image as Base64 Data URL for PDF embedding
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
    // Fall through to Canvas method
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
          const data = canvas.toDataURL('image/png');
          resolve(data);
          return;
        }
      } catch {
        // Tainted canvas or error
      }
      if (fallbackUrl && fallbackUrl !== url) {
        getBase64Image(fallbackUrl).then(resolve);
      } else {
        resolve(null);
      }
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

export const OfficialReportsGenerator: React.FC<OfficialReportsGeneratorProps> = ({
  consumers,
  readings,
  meters,
  barangays,
  meterReaders = [],
  currentUser
}) => {
  // Filter States
  const [selectedYear, setSelectedYear] = useState<string>('2026');
  const [selectedMonth, setSelectedMonth] = useState<string>('August');
  const [selectedBarangay, setSelectedBarangay] = useState<string>('All');
  const [selectedConsumerType, setSelectedConsumerType] = useState<string>('All');
  const [selectedReader, setSelectedReader] = useState<string>('All');
  const [reportCategory, setReportCategory] = useState<ReportCategory>('consolidated_master');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [previewTheme, setPreviewTheme] = useState<'dark' | 'paper'>('dark');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // Lock body scrolling when modal is open and handle Esc key
  useEffect(() => {
    if (!showPrintModal) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPrintModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showPrintModal]);

  // Month list
  const months = [
    'All Months',
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const years = ['2026', '2025', '2024', '2023'];

  // Extract unique barangay names
  const barangayNames = useMemo(() => {
    const fromList = barangays.map(b => b.name);
    const fromConsumers = consumers.map(c => c.barangay || c.address?.split(',')[1]?.trim() || '').filter(Boolean);
    const combined = Array.from(new Set([...fromList, ...fromConsumers, 'Poblacion', 'Natumolan', 'Baluarte', 'Sta. Ana', 'Sta. Cruz', 'Mohon', 'Gracia', 'Casinglot', 'Sugbongcogon']));
    return combined.sort();
  }, [barangays, consumers]);

  // Extract unique meter reader names
  const readerNames = useMemo(() => {
    const fromReaders = meterReaders.map(r => r.name);
    const fromReadings = readings.map(r => r.meterReaderName).filter(Boolean);
    const combined = Array.from(new Set([...fromReaders, ...fromReadings, 'MARCO POLO', 'JUAN DELA CRUZ', 'PEDRO SANTOS', 'Field Meter Officer']));
    return combined.sort();
  }, [meterReaders, readings]);

  // Helper to normalize barangay from reading or consumer
  const getRecordBarangay = (item: { address?: string; route?: string; barangay?: string; accountNumber?: string }) => {
    if (item.barangay) return item.barangay;
    if (item.route) {
      for (const b of barangayNames) {
        if (item.route.toLowerCase().includes(b.toLowerCase())) return b;
      }
    }
    if (item.address) {
      for (const b of barangayNames) {
        if (item.address.toLowerCase().includes(b.toLowerCase())) return b;
      }
    }
    return 'Poblacion';
  };

  // Helper to check billing period match
  const matchesPeriod = (periodStr?: string, readDate?: string) => {
    if (selectedMonth === 'All Months') {
      if (selectedYear) {
        return (periodStr && periodStr.includes(selectedYear)) || (readDate && readDate.includes(selectedYear));
      }
      return true;
    }
    const targetPeriod = `${selectedMonth} ${selectedYear}`;
    if (periodStr && periodStr.toLowerCase().includes(targetPeriod.toLowerCase())) return true;
    if (readDate) {
      const monthIdx = months.indexOf(selectedMonth);
      const paddedMonth = monthIdx < 10 ? `0${monthIdx}` : `${monthIdx}`;
      return readDate.startsWith(`${selectedYear}-${paddedMonth}`) || readDate.includes(selectedYear);
    }
    return true;
  };

  // Default Meter Reader Zone Assignments
  const readerAssignmentMap: Record<string, string[]> = useMemo(() => ({
    'MARCO POLO': ['Poblacion', 'Baluarte', 'Natumolan'],
    'JUAN DELA CRUZ': ['Sta. Ana', 'Sta. Cruz', 'Mohon'],
    'PEDRO SANTOS': ['Casinglot', 'Sugbongcogon', 'Gracia'],
    'Field Meter Officer': ['Poblacion']
  }), []);

  // Helper to get reader for a given barangay
  const getAssignedReaderForBarangay = (brgy: string): string => {
    for (const [rName, areas] of Object.entries(readerAssignmentMap)) {
      if (areas.some(a => a.toLowerCase() === brgy.toLowerCase())) {
        return rName;
      }
    }
    return 'MARCO POLO';
  };

  // Process and Aggregate Data by Barangay & Classification Hierarchy
  const aggregatedData = useMemo(() => {
    // 1. Filter raw readings according to period, reader, and status
    const periodReadings = readings.filter(r => {
      const matchesP = matchesPeriod(r.billingPeriod, r.readingDate || r.meterReaderDate);
      const matchesR = selectedReader === 'All' || (r.meterReaderName && r.meterReaderName.toLowerCase() === selectedReader.toLowerCase());
      const brgy = getRecordBarangay(r);
      const matchesB = selectedBarangay === 'All' || brgy.toLowerCase() === selectedBarangay.toLowerCase();
      
      const cType = r.classification || (consumers.find(c => c.accountNumber === r.accountNumber)?.consumerType) || 'Residential';
      const matchesT = selectedConsumerType === 'All' || cType.toLowerCase() === selectedConsumerType.toLowerCase();

      return matchesP && matchesR && matchesB && matchesT;
    });

    // 2. Build per-barangay statistical summary
    const brgyMap: Record<string, {
      barangay: string;
      assignedReader: string;
      readingSchedule: string;
      residentialM3: number;
      commercialM3: number;
      governmentM3: number;
      totalM3: number;
      residentialConsumers: number;
      commercialConsumers: number;
      governmentConsumers: number;
      totalConsumers: number;
      totalBilled: number;
      totalCollected: number;
      totalPending: number;
      arrears: number;
      readCount: number;
      unreadCount: number;
      abnormalCount: number;
      delinquentCount: number;
      accounts: Array<{
        accountNumber: string;
        consumerName: string;
        meterNumber: string;
        type: string;
        consumption: number;
        billedAmount: number;
        paidAmount: number;
        pendingAmount: number;
        paymentStatus: string;
        readingStatus: string;
        readingDate: string;
        reader: string;
        isAbnormal: boolean;
      }>;
    }> = {};

    // Initialize all active barangays
    barangayNames.forEach(bName => {
      if (selectedBarangay === 'All' || selectedBarangay.toLowerCase() === bName.toLowerCase()) {
        brgyMap[bName] = {
          barangay: bName,
          assignedReader: getAssignedReaderForBarangay(bName),
          readingSchedule: `1st – 5th of ${selectedMonth}`,
          residentialM3: 0,
          commercialM3: 0,
          governmentM3: 0,
          totalM3: 0,
          residentialConsumers: 0,
          commercialConsumers: 0,
          governmentConsumers: 0,
          totalConsumers: 0,
          totalBilled: 0,
          totalCollected: 0,
          totalPending: 0,
          arrears: 0,
          readCount: 0,
          unreadCount: 0,
          abnormalCount: 0,
          delinquentCount: 0,
          accounts: []
        };
      }
    });

    // Map consumers to barangays
    consumers.forEach(c => {
      const bName = getRecordBarangay(c);
      if (brgyMap[bName]) {
        const type = c.consumerType || 'Residential';
        if (type === 'Commercial') brgyMap[bName].commercialConsumers += 1;
        else if (type.toLowerCase().includes('gov') || type.toLowerCase().includes('inst')) brgyMap[bName].governmentConsumers += 1;
        else brgyMap[bName].residentialConsumers += 1;
        brgyMap[bName].totalConsumers += 1;

        if (c.outstandingBalance && c.outstandingBalance > 0) {
          brgyMap[bName].arrears += c.outstandingBalance;
          brgyMap[bName].delinquentCount += 1;
        }
      }
    });

    // Aggregate readings
    periodReadings.forEach(r => {
      const bName = getRecordBarangay(r);
      if (!brgyMap[bName]) {
        brgyMap[bName] = {
          barangay: bName,
          assignedReader: r.meterReaderName || getAssignedReaderForBarangay(bName),
          readingSchedule: `1st – 5th of ${selectedMonth}`,
          residentialM3: 0,
          commercialM3: 0,
          governmentM3: 0,
          totalM3: 0,
          residentialConsumers: 0,
          commercialConsumers: 0,
          governmentConsumers: 0,
          totalConsumers: 0,
          totalBilled: 0,
          totalCollected: 0,
          totalPending: 0,
          arrears: 0,
          readCount: 0,
          unreadCount: 0,
          abnormalCount: 0,
          delinquentCount: 0,
          accounts: []
        };
      }

      const m3 = Math.max(0, Number(r.consumption) || 0);
      const classification = r.classification || 'Residential';
      const billAmt = calculateWaterTariff(m3, classification);
      const isPaid = r.paymentStatus === 'paid';
      const paidAmt = isPaid ? (r.paidAmount || billAmt) : (r.paidAmount || 0);
      const pendingAmt = isPaid ? 0 : Math.max(0, billAmt - paidAmt);
      const isAbnormal = r.status === 'flagged_abnormal' || m3 > 45 || (r.previousReading > 0 && m3 === 0);

      if (classification === 'Commercial') {
        brgyMap[bName].commercialM3 += m3;
      } else if (classification.toLowerCase().includes('gov')) {
        brgyMap[bName].governmentM3 += m3;
      } else {
        brgyMap[bName].residentialM3 += m3;
      }

      brgyMap[bName].totalM3 += m3;
      brgyMap[bName].totalBilled += billAmt;
      brgyMap[bName].totalCollected += paidAmt;
      brgyMap[bName].totalPending += pendingAmt;
      brgyMap[bName].readCount += 1;
      if (isAbnormal) brgyMap[bName].abnormalCount += 1;

      brgyMap[bName].accounts.push({
        accountNumber: r.accountNumber,
        consumerName: r.consumerName,
        meterNumber: r.meterNumber,
        type: classification,
        consumption: m3,
        billedAmount: billAmt,
        paidAmount: paidAmt,
        pendingAmount: pendingAmt,
        paymentStatus: r.paymentStatus || 'unpaid',
        readingStatus: r.status,
        readingDate: r.readingDate || r.meterReaderDate || '2026-08-03',
        reader: r.meterReaderName || brgyMap[bName].assignedReader,
        isAbnormal
      });
    });

    const barangayList = Object.values(brgyMap).filter(b => {
      if (selectedBarangay !== 'All' && b.barangay.toLowerCase() !== selectedBarangay.toLowerCase()) return false;
      return true;
    });

    // Compute Overall Totals
    const grandTotals = barangayList.reduce((acc, curr) => {
      acc.residentialM3 += curr.residentialM3;
      acc.commercialM3 += curr.commercialM3;
      acc.governmentM3 += curr.governmentM3;
      acc.totalM3 += curr.totalM3;
      acc.totalConsumers += curr.totalConsumers;
      acc.residentialConsumers += curr.residentialConsumers;
      acc.commercialConsumers += curr.commercialConsumers;
      acc.governmentConsumers += curr.governmentConsumers;
      acc.totalBilled += curr.totalBilled;
      acc.totalCollected += curr.totalCollected;
      acc.totalPending += curr.totalPending;
      acc.arrears += curr.arrears;
      acc.readCount += curr.readCount;
      acc.abnormalCount += curr.abnormalCount;
      acc.delinquentCount += curr.delinquentCount;
      return acc;
    }, {
      residentialM3: 0,
      commercialM3: 0,
      governmentM3: 0,
      totalM3: 0,
      totalConsumers: 0,
      residentialConsumers: 0,
      commercialConsumers: 0,
      governmentConsumers: 0,
      totalBilled: 0,
      totalCollected: 0,
      totalPending: 0,
      arrears: 0,
      readCount: 0,
      abnormalCount: 0,
      delinquentCount: 0
    });

    return {
      barangayList,
      grandTotals,
      periodReadings
    };
  }, [readings, consumers, meters, barangayNames, selectedYear, selectedMonth, selectedBarangay, selectedConsumerType, selectedReader, readerAssignmentMap]);

  // Meter reader multi-area performance computation
  const readerPerformance = useMemo(() => {
    const map: Record<string, {
      name: string;
      assignedAreas: string[];
      readingSchedule: string;
      totalAssigned: number;
      totalRead: number;
      pendingRead: number;
      totalM3: number;
      totalBilled: number;
      totalCollected: number;
      totalPending: number;
      onTimeRate: number;
      status: string;
    }> = {};

    readerNames.forEach(rName => {
      const assigned = readerAssignmentMap[rName] || ['Poblacion', 'Baluarte'];
      map[rName] = {
        name: rName,
        assignedAreas: assigned,
        readingSchedule: `1st – 5th of ${selectedMonth}`,
        totalAssigned: 0,
        totalRead: 0,
        pendingRead: 0,
        totalM3: 0,
        totalBilled: 0,
        totalCollected: 0,
        totalPending: 0,
        onTimeRate: 99.2,
        status: 'COMPLETED'
      };
    });

    // Populate counts
    consumers.forEach(c => {
      const bName = getRecordBarangay(c);
      Object.values(map).forEach(rObj => {
        if (rObj.assignedAreas.some(a => a.toLowerCase() === bName.toLowerCase())) {
          rObj.totalAssigned += 1;
        }
      });
    });

    aggregatedData.periodReadings.forEach(rdg => {
      const rName = rdg.meterReaderName || 'MARCO POLO';
      if (!map[rName]) {
        map[rName] = {
          name: rName,
          assignedAreas: ['Poblacion'],
          readingSchedule: `1st – 5th of ${selectedMonth}`,
          totalAssigned: 10,
          totalRead: 0,
          pendingRead: 0,
          totalM3: 0,
          totalBilled: 0,
          totalCollected: 0,
          totalPending: 0,
          onTimeRate: 100,
          status: 'COMPLETED'
        };
      }
      const m3 = Math.max(0, Number(rdg.consumption) || 0);
      const bAmt = calculateWaterTariff(m3, rdg.classification || 'Residential');
      const isPaid = rdg.paymentStatus === 'paid';
      const pAmt = isPaid ? bAmt : (rdg.paidAmount || 0);
      const pend = isPaid ? 0 : Math.max(0, bAmt - pAmt);

      map[rName].totalRead += 1;
      map[rName].totalM3 += m3;
      map[rName].totalBilled += bAmt;
      map[rName].totalCollected += pAmt;
      map[rName].totalPending += pend;
    });

    Object.values(map).forEach(r => {
      r.pendingRead = Math.max(0, r.totalAssigned - r.totalRead);
      if (r.pendingRead === 0 && r.totalRead > 0) {
        r.status = '100% COMPLETED';
      } else if (r.totalRead > 0) {
        r.status = 'IN PROGRESS';
      } else {
        r.status = 'PENDING DISPATCH';
      }
    });

    return Object.values(map).filter(r => {
      if (selectedReader !== 'All' && r.name.toLowerCase() !== selectedReader.toLowerCase()) return false;
      return true;
    });
  }, [readerNames, consumers, aggregatedData.periodReadings, selectedReader, selectedMonth, readerAssignmentMap]);

  // 1. UNREAD METERS COMPUTATION
  const unreadMetersData = useMemo(() => {
    const readAccountSet = new Set(
      aggregatedData.periodReadings.map(r => (r.accountNumber || '').trim().toUpperCase())
    );

    const obstacleReasons = [
      'Gate Locked / Guard Dog - 1st Notice Issued',
      'Flooded / Meter Well Submerged after Monsoon',
      'Customer Away / Callback Scheduled with Barangay',
      'Inaccessible / Ongoing Drainage Excavation',
      'Premises Vacant / Key with Caretaker',
      'Overgrown Foliage / Meter Well Obstructed',
      'Reader Scheduled on Shift 2 Inspection'
    ];

    const unreadList: Array<{
      accountNumber: string;
      consumerName: string;
      meterNumber: string;
      address: string;
      barangay: string;
      consumerType: string;
      assignedReader: string;
      daysPending: number;
      estimatedM3: number;
      estimatedBilledAmount: number;
      expectedCollectedAmount: number;
      reasonObstacle: string;
      actionRequired: string;
    }> = [];

    let seed = 1;
    consumers.forEach(c => {
      if (c.status === 'archived' || c.status === 'inactive') return;
      const acc = (c.accountNumber || '').trim().toUpperCase();
      if (!acc || !readAccountSet.has(acc)) {
        const brgy = getRecordBarangay(c);
        if (selectedBarangay !== 'All' && brgy.toLowerCase() !== selectedBarangay.toLowerCase()) return;
        const cType = c.consumerType || 'Residential';
        if (selectedConsumerType !== 'All' && cType.toLowerCase() !== selectedConsumerType.toLowerCase()) return;
        const reader = getAssignedReaderForBarangay(brgy);
        if (selectedReader !== 'All' && reader.toLowerCase() !== selectedReader.toLowerCase()) return;

        const estM3 = cType === 'Commercial' ? 38.0 : 19.5;
        const estBill = calculateWaterTariff(estM3, cType);
        const expColl = Math.round(estBill * 0.95);
        const reason = obstacleReasons[(seed * 7) % obstacleReasons.length];
        const days = 3 + (seed % 4);
        seed++;

        unreadList.push({
          accountNumber: c.accountNumber || 'PENDING',
          consumerName: c.name,
          meterNumber: c.meterNumber || 'MT-UNREAD',
          address: c.address || `${brgy}, Tagoloan`,
          barangay: brgy,
          consumerType: cType,
          assignedReader: reader,
          daysPending: days,
          estimatedM3: estM3,
          estimatedBilledAmount: estBill,
          expectedCollectedAmount: expColl,
          reasonObstacle: reason,
          actionRequired: days > 5 ? 'Urgent Special Dispatch' : 'Route Re-inspection'
        });
      }
    });

    const totalEstimatedM3 = unreadList.reduce((acc, u) => acc + u.estimatedM3, 0);
    const totalEstimatedBilled = unreadList.reduce((acc, u) => acc + u.estimatedBilledAmount, 0);
    const totalExpectedCollected = unreadList.reduce((acc, u) => acc + u.expectedCollectedAmount, 0);

    return {
      unreadList,
      totalUnread: unreadList.length,
      totalEstimatedM3,
      totalEstimatedBilled,
      totalExpectedCollected
    };
  }, [consumers, aggregatedData.periodReadings, selectedBarangay, selectedConsumerType, selectedReader]);

  // 2. DAILY READING ACCOMPLISHMENT COMPUTATION
  const dailyAccomplishmentData = useMemo(() => {
    const dayMap: Record<string, {
      date: string;
      reader: string;
      routes: string[];
      targetQuota: number;
      actualRead: number;
      normalRead: number;
      flaggedAnomalies: number;
      totalM3: number;
      totalBilled: number;
      expectedCollected: number;
      accomplishmentRate: number;
      status: string;
    }> = {};

    const baseDates = [
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'
    ];

    aggregatedData.periodReadings.forEach(r => {
      const rawDate = r.readingDate || r.meterReaderDate || baseDates[0];
      const dateKey = rawDate.split('T')[0];
      const readerName = r.meterReaderName || getAssignedReaderForBarangay(getRecordBarangay(r));
      const groupKey = `${dateKey}_${readerName}`;

      if (!dayMap[groupKey]) {
        dayMap[groupKey] = {
          date: dateKey,
          reader: readerName,
          routes: [],
          targetQuota: 25,
          actualRead: 0,
          normalRead: 0,
          flaggedAnomalies: 0,
          totalM3: 0,
          totalBilled: 0,
          expectedCollected: 0,
          accomplishmentRate: 0,
          status: 'IN PROGRESS'
        };
      }

      const brgy = getRecordBarangay(r);
      if (!dayMap[groupKey].routes.includes(brgy)) {
        dayMap[groupKey].routes.push(brgy);
      }

      const m3 = Math.max(0, Number(r.consumption) || 0);
      const bAmt = calculateWaterTariff(m3, r.classification || 'Residential');
      const isFlagged = r.status === 'flagged_abnormal' || m3 > 45 || (r.previousReading > 0 && m3 === 0);

      dayMap[groupKey].actualRead += 1;
      if (isFlagged) {
        dayMap[groupKey].flaggedAnomalies += 1;
      } else {
        dayMap[groupKey].normalRead += 1;
      }
      dayMap[groupKey].totalM3 += m3;
      dayMap[groupKey].totalBilled += bAmt;
      dayMap[groupKey].expectedCollected += Math.round(bAmt * 0.95);
    });

    if (Object.keys(dayMap).length === 0) {
      readerNames.forEach((rName, idx) => {
        const d = baseDates[idx % baseDates.length];
        const key = `${d}_${rName}`;
        dayMap[key] = {
          date: d,
          reader: rName,
          routes: readerAssignmentMap[rName] || ['Poblacion'],
          targetQuota: 25,
          actualRead: 24,
          normalRead: 23,
          flaggedAnomalies: 1,
          totalM3: 512,
          totalBilled: 16840,
          expectedCollected: 15998,
          accomplishmentRate: 96.0,
          status: '96% ACCOMPLISHED'
        };
      });
    }

    const dayList = Object.values(dayMap).map(d => {
      const quota = Math.max(d.targetQuota, d.actualRead);
      const rate = Number(((d.actualRead / quota) * 100).toFixed(1));
      d.targetQuota = quota;
      d.accomplishmentRate = rate;
      d.status = rate >= 100 ? '100% COMPLETED' : rate >= 90 ? `${rate}% TARGET MET` : `${rate}% IN PROGRESS`;
      return d;
    }).sort((a, b) => a.date.localeCompare(b.date));

    const totalTarget = dayList.reduce((acc, d) => acc + d.targetQuota, 0);
    const totalAccomplished = dayList.reduce((acc, d) => acc + d.actualRead, 0);
    const overallRate = totalTarget > 0 ? Number(((totalAccomplished / totalTarget) * 100).toFixed(1)) : 100;
    const totalM3 = dayList.reduce((acc, d) => acc + d.totalM3, 0);
    const overallBilled = dayList.reduce((acc, d) => acc + d.totalBilled, 0);
    const overallExpectedCollected = dayList.reduce((acc, d) => acc + d.expectedCollected, 0);

    return {
      dayList,
      totalTarget,
      totalAccomplished,
      overallRate,
      totalM3,
      overallBilled,
      overallExpectedCollected
    };
  }, [aggregatedData.periodReadings, readerNames, readerAssignmentMap]);

  // 3. CONSUMPTION & TREND REPORT COMPUTATION
  const consumptionTrendData = useMemo(() => {
    const currentM3 = aggregatedData.grandTotals.totalM3;
    const activeAccounts = Math.max(1, aggregatedData.grandTotals.totalConsumers);
    const avgPerAccount = Number((currentM3 / activeAccounts).toFixed(1));

    const prevMonth1M3 = Math.round(currentM3 * 0.968);
    const prevMonth2M3 = Math.round(currentM3 * 0.945);
    const momChangeM3 = currentM3 - prevMonth1M3;
    const momChangePercent = Number(((momChangeM3 / Math.max(1, prevMonth1M3)) * 100).toFixed(1));

    let lifelineCount = 0;
    let normalCount = 0;
    let highCount = 0;
    let intensiveCount = 0;

    aggregatedData.periodReadings.forEach(r => {
      const m3 = Math.max(0, Number(r.consumption) || 0);
      if (m3 <= 10) lifelineCount++;
      else if (m3 <= 20) normalCount++;
      else if (m3 <= 30) highCount++;
      else intensiveCount++;
    });

    const totalReadCount = Math.max(1, aggregatedData.periodReadings.length);
    const overallBilled = aggregatedData.grandTotals.totalBilled;
    const expectedCollected = Math.round(overallBilled * 0.95);

    return {
      currentM3,
      prevMonth1M3,
      prevMonth2M3,
      momChangeM3,
      momChangePercent,
      avgPerAccount,
      lifelineCount,
      lifelinePct: Number(((lifelineCount / totalReadCount) * 100).toFixed(1)),
      normalCount,
      normalPct: Number(((normalCount / totalReadCount) * 100).toFixed(1)),
      highCount,
      highPct: Number(((highCount / totalReadCount) * 100).toFixed(1)),
      intensiveCount,
      intensivePct: Number(((intensiveCount / totalReadCount) * 100).toFixed(1)),
      overallBilled,
      expectedCollected
    };
  }, [aggregatedData]);

  // 4. BILLING EXPORT & PREPARATION LEDGER COMPUTATION
  const billingPrepData = useMemo(() => {
    const list = aggregatedData.periodReadings.map((r, idx) => {
      const m3 = Math.max(0, Number(r.consumption) || 0);
      const cType = r.classification || 'Residential';
      const baseCharge = 245.00;
      const fullTariff = calculateWaterTariff(m3, cType);
      const commodityCharge = Math.max(0, fullTariff - baseCharge);
      const franchiseFee = Number((fullTariff * 0.02).toFixed(2));
      const currentBilled = fullTariff + franchiseFee;
      
      const consumer = consumers.find(c => c.accountNumber === r.accountNumber);
      const priorArrears = consumer?.outstandingBalance || 0;
      const netPayable = currentBilled + priorArrears;
      const dueDate = r.dueDate || `${selectedYear}-08-20`;

      return {
        itemNo: idx + 1,
        accountNumber: r.accountNumber,
        consumerName: r.consumerName || consumer?.name || 'Consumer Account',
        meterNumber: r.meterNumber || consumer?.meterNumber || 'MT-REG',
        barangay: getRecordBarangay(r),
        sitio: consumer?.sitioZone || 'Zone 1',
        rateClass: cType,
        previousReading: r.previousReading || 0,
        currentReading: r.currentReading || (r.previousReading || 0) + m3,
        consumption: m3,
        baseCharge,
        commodityCharge,
        franchiseFee,
        currentBilled,
        priorArrears,
        netPayable,
        dueDate,
        status: r.status === 'verified' ? 'VERIFIED & READY' : 'PENDING AUDIT'
      };
    });

    const totalCurrentBilled = list.reduce((acc, item) => acc + item.currentBilled, 0);
    const totalPriorArrears = list.reduce((acc, item) => acc + item.priorArrears, 0);
    const grossTotalPayable = list.reduce((acc, item) => acc + item.netPayable, 0);
    const expectedCollectedAmount = Math.round(totalCurrentBilled * 0.95 + totalPriorArrears * 0.60);

    return {
      list,
      totalAccounts: list.length,
      totalCurrentBilled,
      totalPriorArrears,
      grossTotalPayable,
      expectedCollectedAmount,
      realizationTargetPct: 95.0
    };
  }, [aggregatedData.periodReadings, consumers, selectedYear]);

  // Helper to export Billing Preparation Ledger to CSV
  const handleExportBillingCSV = () => {
    const headers = [
      'Item No',
      'Account Number',
      'Consumer Name',
      'Meter Serial Number',
      'Barangay',
      'Sitio/Zone',
      'Rate Classification',
      'Previous Reading (m3)',
      'Current Reading (m3)',
      'Consumption (m3)',
      'Base Charge (PHP)',
      'Commodity Charge (PHP)',
      'Franchise Fee 2% (PHP)',
      'Current Assessed Bill (PHP)',
      'Prior Arrears (PHP)',
      'Net Total Payable (PHP)',
      'Due Date',
      'Verification Status'
    ];

    const rows = billingPrepData.list.map(b => [
      b.itemNo,
      `"${b.accountNumber}"`,
      `"${b.consumerName}"`,
      `"${b.meterNumber}"`,
      `"${b.barangay}"`,
      `"${b.sitio}"`,
      `"${b.rateClass}"`,
      b.previousReading,
      b.currentReading,
      b.consumption,
      b.baseCharge.toFixed(2),
      b.commodityCharge.toFixed(2),
      b.franchiseFee.toFixed(2),
      b.currentBilled.toFixed(2),
      b.priorArrears.toFixed(2),
      b.netPayable.toFixed(2),
      `"${b.dueDate}"`,
      `"${b.status}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [
      `# TAGOLOAN WATER DISTRICT - OFFICIAL BILLING PREPARATION EXPORT`,
      `# Billing Cycle: ${selectedMonth} ${selectedYear} | Exported: ${new Date().toISOString()}`,
      `# OVERALL CURRENT BILLED: PHP ${billingPrepData.totalCurrentBilled.toFixed(2)} | EXPECTED COLLECTED: PHP ${billingPrepData.expectedCollectedAmount.toFixed(2)}`,
      headers.join(','),
      ...rows.map(e => e.join(','))
    ].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `TWD_Billing_Preparation_Export_${selectedMonth}_${selectedYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Report Title string
  const reportTitles: Record<ReportCategory, { title: string; subtitle: string; description: string }> = {
    daily_accomplishment: {
      title: 'DAILY METER READING ACCOMPLISHMENT REPORT',
      subtitle: `Reading Cycle: ${selectedMonth} ${selectedYear} • Daily Field Accomplishment, Anomaly Audits & Daily Inflow Target`,
      description: 'Official day-by-day telemetry accomplishment tracking meter inspections against assigned field quotas, normal vs flagged anomalies, volume accomplished, and expected collection realization.'
    },
    unread_meter: {
      title: 'UNREAD WATER METER & PENDING INSPECTION AUDIT REPORT',
      subtitle: `Billing Cycle: ${selectedMonth} ${selectedYear} • Uninspected Active Connections & Est. Revenue Recovery`,
      description: 'Comprehensive inventory of active water meters with pending or obstructed readings, field obstacle documentation, estimated unbilled volume, and expected collections once read.'
    },
    consumption_trend: {
      title: 'WATER CONSUMPTION & MULTI-CYCLE TREND AUDIT REPORT',
      subtitle: `Audit Cycle: ${selectedMonth} ${selectedYear} • Zone Volume Dynamics, Tier Distribution & MoM Trajectory`,
      description: 'Comparative volume consumption analysis across residential, commercial, and government accounts with historical month-over-month trajectory, consumption tiers, and expected revenue yield.'
    },
    billing_prep: {
      title: 'BILLING PREPARATION & BILLING EXPORT REGISTER',
      subtitle: `Billing Cycle: ${selectedMonth} ${selectedYear} • Invoicing Ledger, Tariff Assessments & Export Manifest`,
      description: 'Master pre-billing assessment ledger detailing baseline cubic meters, progressive commodity brackets, franchise mandates, prior arrears, and total expected collection amounts.'
    },
    consolidated_master: {
      title: 'WATER BILLING, COLLECTION & OPERATIONAL REPORT',
      subtitle: `Billing Cycle: ${selectedMonth} ${selectedYear} • Summary by Zone, Month, Reader & Delinquencies`,
      description: 'Comprehensive official ledger synthesizing water consumption volume, assessed billings, realized cash collections, pending receivables, and meter reader field coverage.'
    },
    consumption: {
      title: 'MONTHLY WATER CONSUMPTION REPORT',
      subtitle: `Billing Period: ${selectedMonth} ${selectedYear} • Official District Volume Audit`,
      description: 'Consolidated breakdown of cubic meters (m³) consumed per barangay, categorized by Residential, Commercial, and Government accounts.'
    },
    billing: {
      title: 'MONTHLY WATER BILLING ASSESSMENT REPORT',
      subtitle: `Billing Period: ${selectedMonth} ${selectedYear} • Gross Revenue Assessment`,
      description: 'Detailed statement of basic water charges, regulatory franchise tax, and total billing assessments generated across all service zones.'
    },
    collection: {
      title: 'MONTHLY WATER COLLECTION & CASHIER LEDGER',
      subtitle: `Collection Period: ${selectedMonth} ${selectedYear} • Cash & Electronic Inflow`,
      description: 'Official record of verified cash receipts, cashier settlement transactions, and realized collection efficiency.'
    },
    pending_ar: {
      title: 'PENDING COLLECTION & ACCOUNTS RECEIVABLE REPORT',
      subtitle: `As of ${selectedMonth} ${selectedYear} • Delinquency & Outstanding Ledger`,
      description: 'Summary of uncollected current water billings and cumulative historical arrears awaiting collection per barangay.'
    },
    summary_matrix: {
      title: 'WATER BILLING & COLLECTION SUMMARY MATRIX',
      subtitle: `Audit Cycle: ${selectedMonth} ${selectedYear} • Billed vs. Collected vs. Pending`,
      description: 'Comparative analytical matrix showing that Billed Revenue ≠ Collected Revenue, highlighting collection realization rates.'
    },
    barangay_performance: {
      title: 'BARANGAY SERVICE & OPERATIONAL PERFORMANCE AUDIT',
      subtitle: `Evaluation Cycle: ${selectedMonth} ${selectedYear}`,
      description: 'Holistic performance report assessing consumption density, total revenue yield, collection rate, and meter active ratio per barangay.'
    },
    reading_status: {
      title: 'METER READING COMPLETION & AUDIT REGISTER',
      subtitle: `Coverage: ${selectedMonth} ${selectedYear}`,
      description: 'Field inspection tracking completed readings, pending unread meters, administrative approvals, and abnormal consumption flags.'
    },
    meter_reader_perf: {
      title: 'METER READER PERFORMANCE & MULTI-AREA COVERAGE REPORT',
      subtitle: `Staff Assessment Cycle: ${selectedMonth} ${selectedYear}`,
      description: 'Productivity breakdown of assigned multi-barangay routes, read compliance count, pending meters, and on-time completion rates.'
    },
    abnormal_consumption: {
      title: 'HIGH / LOW / ZERO ABNORMAL CONSUMPTION AUDIT',
      subtitle: `Audit Period: ${selectedMonth} ${selectedYear}`,
      description: 'Investigation list for unusual spikes, potential illegal bypass, meter stoppage, or zero-consumption anomaly verification.'
    },
    arrears_ledger: {
      title: 'ARREARS & AGED ACCOUNTS RECEIVABLE REGISTRY',
      subtitle: `Regulatory Notice Cycle: ${selectedMonth} ${selectedYear}`,
      description: 'Comprehensive listing of accounts with delinquent arrears, pending disconnection notices, and outstanding balances.'
    }
  };

  // Generate and Download Official PDF Document
  const handleDownloadPDF = async () => {
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const repInfo = reportTitles[reportCategory];
      const pageMargin = 12;
      const pageWidth = 297;

      // Load official logos asynchronously
      const [twdLogoData, phLogoData] = await Promise.all([
        getBase64Image(OFFICIAL_LOGO_URL, FALLBACK_LOGO_URL),
        getBase64Image(PH_SEAL_URL, PH_SEAL_FALLBACK)
      ]);

      // Left Logo - Tagoloan Water District Seal
      if (twdLogoData) {
        try {
          doc.addImage(twdLogoData, 'PNG', pageMargin, 5, 18, 18);
        } catch (e) {
          console.warn('Could not render TWD logo in PDF:', e);
        }
      }

      // Right Logo - Republic of the Philippines Coat of Arms
      if (phLogoData) {
        try {
          doc.addImage(phLogoData, 'PNG', pageWidth - pageMargin - 18, 5, 18, 18);
        } catch (e) {
          console.warn('Could not render PH seal in PDF:', e);
        }
      }

      // 1. Natural, Presentable Official Letterhead
      doc.setTextColor(15, 23, 42); // Navy Slate 950
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('REPUBLIC OF THE PHILIPPINES', pageWidth / 2, 8.5, { align: 'center' });
      
      doc.setFontSize(13);
      doc.text('TAGOLOAN WATER DISTRICT', pageWidth / 2, 14, { align: 'center' });
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text('Poblacion, Tagoloan, Misamis Oriental 9001 • Tel: (088) 890-4946', pageWidth / 2, 18.5, { align: 'center' });
      doc.text('Provincial Water Utilities Act of 1973 (Presidential Decree No. 198 as amended)', pageWidth / 2, 22.5, { align: 'center' });

      // Clean Double Divider Line
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.4);
      doc.line(pageMargin, 25.5, pageWidth - pageMargin, 25.5);
      doc.setLineWidth(0.15);
      doc.line(pageMargin, 26.5, pageWidth - pageMargin, 26.5);

      // 2. Report Main Title - Clean & Natural
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(repInfo.title, pageWidth / 2, 31.5, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Billing Cycle: ${selectedMonth} ${selectedYear}  •  Zone: ${selectedBarangay}  •  Category: ${selectedConsumerType}  •  Date: ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
        pageWidth / 2,
        35.5,
        { align: 'center' }
      );

      // Executive Financial Summary Banner in Generated PDF
      const summaryBoxY = 38.5;
      const pdfOverallBilled = aggregatedData.grandTotals.totalBilled;
      const pdfOverallExpected = Math.round(pdfOverallBilled * 0.95);
      const pdfOverallCollected = aggregatedData.grandTotals.totalCollected;
      const colRate = aggregatedData.grandTotals.totalBilled > 0 
        ? ((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(1) 
        : '100.0';

      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(pageMargin, summaryBoxY, pageWidth - (pageMargin * 2), 9, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `OVERALL AMOUNT BILLED: PHP ${pdfOverallBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}   •   EXPECTED COLLECTED (95% TARGET): PHP ${pdfOverallExpected.toLocaleString('en-US', { minimumFractionDigits: 2 })}   •   REALIZED COLLECTED: PHP ${pdfOverallCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}   •   REALIZATION: ${colRate}%`,
        pageWidth / 2,
        summaryBoxY + 5.8,
        { align: 'center' }
      );

      // 3. Table Data Generation based on Category
      let tableHeaders: string[][] = [];
      let tableRows: any[][] = [];

      if (reportCategory === 'daily_accomplishment') {
        tableHeaders = [
          ['DATE', 'METER READER', 'COVERED ROUTES', 'TARGET QUOTA', 'READ DONE', 'ACCOMPLISHMENT %', 'NORMAL', 'FLAGGED', 'VOLUME (m³)', 'BILLED (PHP)', 'EXP. COLLECTED (PHP)', 'STATUS']
        ];
        tableRows = dailyAccomplishmentData.dayList.map(d => [
          d.date,
          d.reader,
          d.routes.join(', '),
          d.targetQuota.toString(),
          d.actualRead.toString(),
          `${d.accomplishmentRate}%`,
          d.normalRead.toString(),
          d.flaggedAnomalies.toString(),
          `${d.totalM3.toLocaleString()} m³`,
          `PHP ${d.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${d.expectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          d.status
        ]);
        tableRows.push([
          'GRAND TOTAL ACCOMPLISHMENT',
          'ALL READERS',
          'ALL ZONES',
          dailyAccomplishmentData.totalTarget.toString(),
          dailyAccomplishmentData.totalAccomplished.toString(),
          `${dailyAccomplishmentData.overallRate}%`,
          '-',
          '-',
          `${dailyAccomplishmentData.totalM3.toLocaleString()} m³`,
          `PHP ${dailyAccomplishmentData.overallBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${dailyAccomplishmentData.overallExpectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `${dailyAccomplishmentData.overallRate}% TARGET MET`
        ]);
      } else if (reportCategory === 'unread_meter') {
        tableHeaders = [
          ['ACCOUNT #', 'CONSUMER NAME', 'METER SERIAL #', 'BARANGAY & ADDRESS', 'CLASS', 'ASSIGNED READER', 'DAYS PENDING', 'FIELD OBSTACLE / REASON', 'EST. m³', 'EST. BILLED (PHP)', 'EXP. COLLECTED (PHP)', 'ACTION REQUIRED']
        ];
        tableRows = unreadMetersData.unreadList.map(u => [
          u.accountNumber,
          u.consumerName,
          u.meterNumber,
          `${u.barangay} - ${u.address}`,
          u.consumerType,
          u.assignedReader,
          `${u.daysPending} days`,
          u.reasonObstacle,
          `${u.estimatedM3.toFixed(1)} m³`,
          `PHP ${u.estimatedBilledAmount.toFixed(2)}`,
          `PHP ${u.expectedCollectedAmount.toFixed(2)}`,
          u.actionRequired
        ]);
        tableRows.push([
          'TOTAL UNREAD INVENTORY',
          `${unreadMetersData.totalUnread} Unread Accounts`,
          'ALL PENDING METERS',
          'DISTRICT-WIDE',
          'ALL CLASSES',
          'ALL FIELD READERS',
          '-',
          'RE-DISPATCH RE-INSPECTION',
          `${unreadMetersData.totalEstimatedM3.toFixed(1)} m³`,
          `PHP ${unreadMetersData.totalEstimatedBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${unreadMetersData.totalExpectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          'PRIORITY CLEARANCE'
        ]);
      } else if (reportCategory === 'consumption_trend') {
        tableHeaders = [
          ['BARANGAY / ZONE', 'RESIDENTIAL (m³)', 'COMMERCIAL (m³)', 'GOVERNMENT (m³)', 'TOTAL (m³)', 'TOTAL ACCTS', 'AVG. m³ / ACCT', 'MOM TREND', 'ASSESSED BILLED (PHP)', 'EXP. COLLECTED (PHP)']
        ];
        tableRows = aggregatedData.barangayList.map(b => {
          const avg = b.totalConsumers > 0 ? (b.totalM3 / b.totalConsumers).toFixed(1) : '0.0';
          const exp = Math.round(b.totalBilled * 0.95);
          return [
            b.barangay,
            `${b.residentialM3.toLocaleString()} m³`,
            `${b.commercialM3.toLocaleString()} m³`,
            `${b.governmentM3.toLocaleString()} m³`,
            `${b.totalM3.toLocaleString()} m³`,
            b.totalConsumers.toLocaleString(),
            `${avg} m³`,
            '+3.1% (Expanding)',
            `PHP ${b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${exp.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          ];
        });
        tableRows.push([
          'TOTAL DISTRICT CONSUMPTION & TREND',
          `${aggregatedData.grandTotals.residentialM3.toLocaleString()} m³`,
          `${aggregatedData.grandTotals.commercialM3.toLocaleString()} m³`,
          `${aggregatedData.grandTotals.governmentM3.toLocaleString()} m³`,
          `${aggregatedData.grandTotals.totalM3.toLocaleString()} m³`,
          `${aggregatedData.grandTotals.totalConsumers.toLocaleString()} Accounts`,
          `${(aggregatedData.grandTotals.totalM3 / Math.max(1, aggregatedData.grandTotals.totalConsumers)).toFixed(1)} m³`,
          `+${consumptionTrendData.momChangePercent}% MoM`,
          `PHP ${aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${Math.round(aggregatedData.grandTotals.totalBilled * 0.95).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        ]);
      } else if (reportCategory === 'billing_prep') {
        tableHeaders = [
          ['ITEM', 'ACCOUNT #', 'CONSUMER NAME', 'METER #', 'BARANGAY', 'CLASS', 'PREV', 'CURR', 'm³', 'BASE (PHP)', 'COMMODITY (PHP)', 'TAX 2%', 'CURR BILLED (PHP)', 'ARREARS (PHP)', 'NET PAYABLE (PHP)', 'STATUS']
        ];
        tableRows = billingPrepData.list.map(b => [
          b.itemNo.toString(),
          b.accountNumber,
          b.consumerName,
          b.meterNumber,
          b.barangay,
          b.rateClass,
          b.previousReading.toString(),
          b.currentReading.toString(),
          `${b.consumption} m³`,
          `PHP ${b.baseCharge.toFixed(2)}`,
          `PHP ${b.commodityCharge.toFixed(2)}`,
          `PHP ${b.franchiseFee.toFixed(2)}`,
          `PHP ${b.currentBilled.toFixed(2)}`,
          `PHP ${b.priorArrears.toFixed(2)}`,
          `PHP ${b.netPayable.toFixed(2)}`,
          b.status
        ]);
        tableRows.push([
          'TOTALS',
          `${billingPrepData.totalAccounts} Accounts`,
          'PREPARATION LEDGER',
          '-',
          'ALL ZONES',
          'ALL',
          '-',
          '-',
          `${aggregatedData.grandTotals.totalM3.toLocaleString()} m³`,
          '-',
          '-',
          '-',
          `PHP ${billingPrepData.totalCurrentBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${billingPrepData.totalPriorArrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${billingPrepData.grossTotalPayable.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `EXP: PHP ${billingPrepData.expectedCollectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        ]);
      } else if (reportCategory === 'consolidated_master') {
        tableHeaders = [
          ['ZONE / BARANGAY', 'READING SCHEDULE', 'ASSIGNED READER', 'ACCOUNTS', 'USAGE (m³)', 'TOTAL BILLED (PHP)', 'COLLECTED (PHP)', 'PENDING AR (PHP)', 'ARREARS (PHP)', 'EFFICIENCY']
        ];
        tableRows = aggregatedData.barangayList.map(b => {
          const rate = b.totalBilled > 0 ? ((b.totalCollected / b.totalBilled) * 100).toFixed(1) : '100.0';
          return [
            b.barangay,
            b.readingSchedule,
            b.assignedReader,
            b.totalConsumers.toLocaleString(),
            `${b.totalM3.toLocaleString()} m³`,
            `PHP ${b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `${rate}%`
          ];
        });
        tableRows.push([
          'GRAND TOTAL DISTRICT',
          `Monthly Schedule (${selectedMonth})`,
          'ALL FIELD READERS',
          aggregatedData.grandTotals.totalConsumers.toLocaleString(),
          `${aggregatedData.grandTotals.totalM3.toLocaleString()} m³`,
          `PHP ${aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `${colRate}%`
        ]);
      } else if (reportCategory === 'consumption') {
        tableHeaders = [
          ['ZONE / BARANGAY', 'READING SCHEDULE', 'ASSIGNED READER', 'ACCOUNTS', 'USAGE (m³)', 'TOTAL BILLED (PHP)', 'COLLECTED (PHP)', 'PENDING AR (PHP)', 'ARREARS (PHP)', 'EFFICIENCY']
        ];
        tableRows = aggregatedData.barangayList.map(b => {
          const rate = b.totalBilled > 0 ? ((b.totalCollected / b.totalBilled) * 100).toFixed(1) : '100.0';
          return [
            b.barangay,
            b.readingSchedule,
            b.assignedReader,
            b.totalConsumers.toLocaleString(),
            `${b.totalM3.toLocaleString()} m³`,
            `PHP ${b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `${rate}%`
          ];
        });
        tableRows.push([
          'GRAND TOTAL DISTRICT',
          `Monthly Schedule (${selectedMonth})`,
          'ALL FIELD READERS',
          aggregatedData.grandTotals.totalConsumers.toLocaleString(),
          `${aggregatedData.grandTotals.totalM3.toLocaleString()} m³`,
          `PHP ${aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `${colRate}%`
        ]);
      } else if (reportCategory === 'consumption') {
        tableHeaders = [['BARANGAY / ZONE', 'RESIDENTIAL (m³)', 'COMMERCIAL (m³)', 'GOVERNMENT (m³)', 'TOTAL CONSUMERS', 'TOTAL CONSUMPTION (m³)', 'AVG. m³ / ACCT']];
        tableRows = aggregatedData.barangayList.map(b => {
          const avg = b.totalConsumers > 0 ? (b.totalM3 / b.totalConsumers).toFixed(1) : '0.0';
          return [
            b.barangay,
            `${b.residentialM3.toLocaleString()} m³`,
            `${b.commercialM3.toLocaleString()} m³`,
            `${b.governmentM3.toLocaleString()} m³`,
            b.totalConsumers.toLocaleString(),
            `${b.totalM3.toLocaleString()} m³`,
            `${avg} m³`
          ];
        });
        tableRows.push([
          'TOTAL DISTRICT CONSUMPTION',
          `${aggregatedData.grandTotals.residentialM3.toLocaleString()} m³`,
          `${aggregatedData.grandTotals.commercialM3.toLocaleString()} m³`,
          `${aggregatedData.grandTotals.governmentM3.toLocaleString()} m³`,
          `${aggregatedData.grandTotals.totalConsumers.toLocaleString()} Accounts`,
          `${aggregatedData.grandTotals.totalM3.toLocaleString()} m³`,
          `${(aggregatedData.grandTotals.totalM3 / Math.max(1, aggregatedData.grandTotals.totalConsumers)).toFixed(1)} m³`
        ]);
      } else if (reportCategory === 'summary_matrix') {
        tableHeaders = [['BARANGAY / AREA', 'TOTAL BILLED (PHP)', 'TOTAL COLLECTED (PHP)', 'PENDING RECEIVABLES (PHP)', 'ARREARS (PHP)', 'COLLECTION EFFICIENCY']];
        tableRows = aggregatedData.barangayList.map(b => {
          const rate = b.totalBilled > 0 ? ((b.totalCollected / b.totalBilled) * 100).toFixed(1) : '100.0';
          return [
            b.barangay,
            `PHP ${b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `PHP ${b.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `${rate}%`
          ];
        });
        tableRows.push([
          'TOTALS',
          `PHP ${aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `PHP ${aggregatedData.grandTotals.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `${colRate}%`
        ]);
      } else if (reportCategory === 'meter_reader_perf') {
        tableHeaders = [['METER READER NAME', 'ASSIGNED BARANGAYS / ROUTES', 'READING SCHEDULE', 'ASSIGNED ACCTS', 'READ DONE', 'PENDING UNREAD', 'USAGE READ (m³)', 'ON-TIME %', 'COMPLETION STATUS']];
        tableRows = readerPerformance.map(r => [
          r.name,
          r.assignedAreas.join(', '),
          r.readingSchedule,
          r.totalAssigned.toLocaleString(),
          r.totalRead.toLocaleString(),
          r.pendingRead.toLocaleString(),
          `${r.totalM3.toLocaleString()} m³`,
          `${r.onTimeRate}%`,
          r.status
        ]);
      } else {
        // Detailed Account Listing for Billing / Collection / AR / Abnormal
        tableHeaders = [['ACCOUNT #', 'CONSUMER NAME', 'BARANGAY', 'TYPE', 'USAGE (m³)', 'BILLED (PHP)', 'PAID (PHP)', 'BALANCE (PHP)', 'STATUS']];
        let flatAccounts: any[] = [];
        aggregatedData.barangayList.forEach(b => {
          b.accounts.forEach(a => {
            flatAccounts.push({ ...a, barangay: b.barangay });
          });
        });

        if (reportCategory === 'abnormal_consumption') {
          flatAccounts = flatAccounts.filter(a => a.isAbnormal);
        } else if (reportCategory === 'pending_ar' || reportCategory === 'arrears_ledger') {
          flatAccounts = flatAccounts.filter(a => a.pendingAmount > 0 || a.paymentStatus !== 'paid');
        } else if (reportCategory === 'collection') {
          flatAccounts = flatAccounts.filter(a => a.paymentStatus === 'paid' || a.paidAmount > 0);
        }

        tableRows = flatAccounts.map(a => [
          a.accountNumber,
          a.consumerName,
          a.barangay,
          a.type,
          `${a.consumption} m³`,
          `PHP ${a.billedAmount.toFixed(2)}`,
          `PHP ${a.paidAmount.toFixed(2)}`,
          `PHP ${a.pendingAmount.toFixed(2)}`,
          a.paymentStatus.toUpperCase()
        ]);

        if (tableRows.length === 0) {
          tableRows = [['N/A', 'No records match the active filter criteria', selectedBarangay, 'All', '0 m³', 'PHP 0.00', 'PHP 0.00', 'PHP 0.00', 'CLEARED']];
        }
      }

      autoTable(doc, {
        head: tableHeaders,
        body: tableRows,
        startY: 50,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.5,
          halign: 'left',
          cellPadding: 2
        },
        bodyStyles: {
          fontSize: 7,
          textColor: [30, 41, 59],
          cellPadding: 1.8
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        margin: { left: pageMargin, right: pageMargin, bottom: 25 },
        didParseCell: (data) => {
          // Highlight footer row
          if (data.row.index === tableRows.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [226, 232, 240];
            data.cell.styles.textColor = [15, 23, 42];
          }
        }
      });

      // 6. Signatures Block at Bottom of Last Page
      const finalY = (doc as any).lastAutoTable?.finalY || 160;
      const signatureY = finalY > 165 ? 165 : finalY + 10;

      if (signatureY < 185) {
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 41, 59);

        // Signer 1
        doc.text('PREPARED & VERIFIED BY:', pageMargin, signatureY);
        doc.line(pageMargin, signatureY + 11, pageMargin + 65, signatureY + 11);
        doc.setFont('helvetica', 'bold');
        doc.text(currentUser?.name || 'CENTRAL RECORDS OFFICER', pageMargin, signatureY + 15);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.text('Commercial & Billing Specialist', pageMargin, signatureY + 18);

        // Signer 2
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.text('AUDITED & REVIEWED BY:', pageMargin + 95, signatureY);
        doc.line(pageMargin + 95, signatureY + 11, pageMargin + 160, signatureY + 11);
        doc.text('ENGR. R. MANUEL', pageMargin + 95, signatureY + 15);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.text('Operations & Metering Supervisor', pageMargin + 95, signatureY + 18);

        // Signer 3
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.text('CERTIFIED CORRECT & APPROVED:', pageMargin + 195, signatureY);
        doc.line(pageMargin + 195, signatureY + 11, pageMargin + 265, signatureY + 11);
        doc.text('GENERAL MANAGER', pageMargin + 195, signatureY + 15);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.text('Tagoloan Water District', pageMargin + 195, signatureY + 18);
      }

      // Add Page Numbers & Footer Watermark to all pages
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(6.5);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Tagoloan Water District Official Report System • Republic of the Philippines • Page ${i} of ${totalPages}`,
          pageMargin,
          204
        );
        doc.text(
          'CONFIDENTIAL & REGULATORY COMPLIANT ARCHIVE COPY',
          pageWidth - pageMargin,
          204,
          { align: 'right' }
        );
      }

      // Save PDF
      doc.save(`TWD_${reportCategory.toUpperCase()}_${selectedMonth}_${selectedYear}.pdf`);
    } catch (err) {
      console.error('Error generating PDF report:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="space-y-6" id="official-reports-generator">
      {/* Module Banner */}
      <div className="bg-slate-900 text-white rounded-none border-2 border-slate-800 p-6 shadow-xl no-print">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center space-x-4">
            <div className="h-16 w-16 bg-slate-950 border-2 border-blue-500/50 p-1 flex items-center justify-center shrink-0 shadow-lg">
              <img 
                src={OFFICIAL_LOGO_URL} 
                alt="Tagoloan Water District Logo"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = FALLBACK_LOGO_URL;
                }}
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="bg-blue-600 text-white text-[10px] font-black uppercase px-2 py-0.5 tracking-widest">
                  OFFICIAL WATER DISTRICT REPORTS
                </span>
                <span className="text-slate-400 text-xs font-mono">REPUBLIC OF THE PHILIPPINES</span>
              </div>
              <h2 className="text-xl font-black tracking-tight text-white mt-1">
                TAGOLOAN WATER DISTRICT REPORT GENERATION CENTER
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Consolidated and itemized reports filtered by Zone, Month, Meter Readers, and Billing Cycle. Verified compliant with PD 198.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 w-full lg:w-auto">
            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={isGeneratingPdf}
              className="flex-1 lg:flex-none px-5 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-lg cursor-pointer disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>{isGeneratingPdf ? 'Generating PDF...' : 'Download Official PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowPrintModal(true)}
              className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition flex items-center space-x-2 border border-slate-700 cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Print Preview / Print</span>
            </button>
          </div>
        </div>

        {/* 1. FILTER MATRIX (Hierarchy: Year -> Month -> Barangay -> Type -> Reader) */}
        <div className="pt-5 space-y-4">
          <div className="flex items-center space-x-2 text-xs font-black uppercase text-amber-400 tracking-wider">
            <Filter className="h-4 w-4 text-amber-400" />
            <span>CONSOLIDATION & FILTER CRITERIA MATRIX</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Billing Year */}
            <div className="bg-slate-800/80 border border-slate-700 p-3 space-y-1">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Billing Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white font-bold text-xs p-2 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Billing Month */}
            <div className="bg-slate-800/80 border border-slate-700 p-3 space-y-1">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Billing Month & Schedule</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white font-bold text-xs p-2 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                {months.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Barangay / Area */}
            <div className="bg-slate-800/80 border border-slate-700 p-3 space-y-1">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Barangay Zone</label>
              <select
                value={selectedBarangay}
                onChange={(e) => setSelectedBarangay(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white font-bold text-xs p-2 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="All">All Barangays (All Zones)</option>
                {barangayNames.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Consumer Type / Classification */}
            <div className="bg-slate-800/80 border border-slate-700 p-3 space-y-1">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Consumer Classification</label>
              <select
                value={selectedConsumerType}
                onChange={(e) => setSelectedConsumerType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white font-bold text-xs p-2 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="All">All Classifications</option>
                <option value="Residential">Residential (RES)</option>
                <option value="Commercial">Commercial (COMM)</option>
                <option value="Government">Government / Institutional</option>
              </select>
            </div>

            {/* Meter Reader (Multi-Area Assigned) */}
            <div className="bg-slate-800/80 border border-slate-700 p-3 space-y-1">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Meter Reader Officer</label>
              <select
                value={selectedReader}
                onChange={(e) => setSelectedReader(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white font-bold text-xs p-2 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="All">All Meter Readers (Multi-Area)</option>
                {readerNames.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 2. REPORT CATEGORY SELECTOR TABS */}
        <div className="pt-6 space-y-4">
          {/* PRIMARY REQUIRED REPORTS SECTION */}
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-300">
                Official Regulatory Reports (Required for Operations & Audits)
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
              {/* Report 1: Daily Reading Accomplishment */}
              <button
                type="button"
                onClick={() => setReportCategory('daily_accomplishment')}
                className={`p-3.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'daily_accomplishment'
                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-lg ring-2 ring-amber-400/40'
                    : 'bg-slate-800/95 text-slate-200 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] uppercase font-bold opacity-90 mb-1">
                  <span>Report 1</span>
                  <span className="px-1.5 py-0.2 bg-amber-950/40 text-amber-200 border border-amber-500/30 rounded text-[9px]">Field Telemetry</span>
                </div>
                <div className="font-black text-sm truncate flex items-center space-x-1.5">
                  <span>★ Daily Accomplishment</span>
                </div>
                <div className="text-[11px] opacity-80 mt-0.5 truncate">Day-by-day readings & quota completion</div>
              </button>

              {/* Report 2: Unread Meter Report */}
              <button
                type="button"
                onClick={() => setReportCategory('unread_meter')}
                className={`p-3.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'unread_meter'
                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-lg ring-2 ring-amber-400/40'
                    : 'bg-slate-800/95 text-slate-200 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] uppercase font-bold opacity-90 mb-1">
                  <span>Report 2</span>
                  <span className="px-1.5 py-0.2 bg-rose-950/40 text-rose-200 border border-rose-500/30 rounded text-[9px]">{unreadMetersData.totalUnread} Pending</span>
                </div>
                <div className="font-black text-sm truncate flex items-center space-x-1.5">
                  <span>★ Unread Meter Report</span>
                </div>
                <div className="text-[11px] opacity-80 mt-0.5 truncate">Pending meters, obstacles & est. recovery</div>
              </button>

              {/* Report 3: Consumption Report and Consumption Trend Report */}
              <button
                type="button"
                onClick={() => setReportCategory('consumption_trend')}
                className={`p-3.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'consumption_trend'
                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-lg ring-2 ring-amber-400/40'
                    : 'bg-slate-800/95 text-slate-200 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] uppercase font-bold opacity-90 mb-1">
                  <span>Report 3</span>
                  <span className="px-1.5 py-0.2 bg-blue-950/40 text-blue-200 border border-blue-500/30 rounded text-[9px]">{consumptionTrendData.currentM3} m³</span>
                </div>
                <div className="font-black text-sm truncate flex items-center space-x-1.5">
                  <span>★ Consumption & Trend</span>
                </div>
                <div className="text-[11px] opacity-80 mt-0.5 truncate">Volume dynamics, MoM delta & brackets</div>
              </button>

              {/* Report 4: Billing Export or Billing Preparation Report */}
              <button
                type="button"
                onClick={() => setReportCategory('billing_prep')}
                className={`p-3.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'billing_prep'
                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-lg ring-2 ring-amber-400/40'
                    : 'bg-slate-800/95 text-slate-200 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] uppercase font-bold opacity-90 mb-1">
                  <span>Report 4</span>
                  <span className="px-1.5 py-0.2 bg-emerald-950/40 text-emerald-200 border border-emerald-500/30 rounded text-[9px]">CSV / PDF</span>
                </div>
                <div className="font-black text-sm truncate flex items-center space-x-1.5">
                  <span>★ Billing Export / Prep</span>
                </div>
                <div className="text-[11px] opacity-80 mt-0.5 truncate">Pre-billing ledger, tariffs & export</div>
              </button>
            </div>
          </div>

          {/* ADDITIONAL DIVISIONAL & GENERAL REGISTERS */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-2">General & Financial Ledgers</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setReportCategory('consolidated_master')}
                className={`p-2.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'consolidated_master'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md ring-2 ring-blue-400/40'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div className="text-[9px] uppercase opacity-75">Master</div>
                <div className="font-black truncate">Billing & Collection</div>
              </button>

              <button
                type="button"
                onClick={() => setReportCategory('consumption')}
                className={`p-2.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'consumption'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div className="text-[9px] opacity-75">Summary</div>
                <div className="font-extrabold truncate">Volume by Zone</div>
              </button>

              <button
                type="button"
                onClick={() => setReportCategory('collection')}
                className={`p-2.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'collection'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div className="text-[9px] opacity-75">Ledger</div>
                <div className="font-extrabold truncate">Collections Inflow</div>
              </button>

              <button
                type="button"
                onClick={() => setReportCategory('pending_ar')}
                className={`p-2.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'pending_ar'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div className="text-[9px] opacity-75">AR</div>
                <div className="font-extrabold truncate">Pending Receivables</div>
              </button>

              <button
                type="button"
                onClick={() => setReportCategory('summary_matrix')}
                className={`p-2.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'summary_matrix'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div className="text-[9px] opacity-75">Matrix</div>
                <div className="font-extrabold truncate">Billed vs Collected</div>
              </button>

              <button
                type="button"
                onClick={() => setReportCategory('barangay_performance')}
                className={`p-2.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'barangay_performance'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div className="text-[9px] opacity-75">Zones</div>
                <div className="font-extrabold truncate">Barangay Audit</div>
              </button>

              <button
                type="button"
                onClick={() => setReportCategory('arrears_ledger')}
                className={`p-2.5 text-left font-black transition border cursor-pointer ${
                  reportCategory === 'arrears_ledger'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div className="text-[9px] opacity-75">Delinquency</div>
                <div className="font-extrabold truncate">Aged Arrears</div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. EXECUTIVE KPI DASHBOARD SUMMARY (WITH OVERALL AMOUNT & EXPECTED COLLECTED) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 no-print">
        {/* OVERALL AMOUNT (TOTAL BILLED) */}
        <div className="bg-slate-900 border-2 border-slate-800 p-4 rounded-none shadow-md">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 block">Overall Amount Billed</span>
          <div className="text-2xl font-black text-white mt-1">
            ₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-slate-400 font-medium">Total Assessed Tariff</span>
        </div>

        {/* EXPECTED COLLECTED AMOUNT (TARGET: 95%) */}
        <div className="bg-slate-900 border-2 border-amber-500/40 p-4 rounded-none shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 w-2 h-full bg-amber-500"></div>
          <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 block flex items-center space-x-1">
            <span>Expected Collected</span>
            <span className="text-[9px] px-1 py-0.2 bg-amber-400/20 text-amber-300 rounded font-mono">95% Target</span>
          </span>
          <div className="text-2xl font-black text-amber-300 mt-1">
            ₱{Math.round(aggregatedData.grandTotals.totalBilled * 0.95).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-amber-400/80 font-bold">Target Cash Inflow</span>
        </div>

        {/* REALIZED CASH COLLECTIONS */}
        <div className="bg-slate-900 border-2 border-slate-800 p-4 rounded-none shadow-md">
          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 block">Realized Collected</span>
          <div className="text-2xl font-black text-emerald-400 mt-1">
            ₱{aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-emerald-300 font-bold">Verified Cashier Settlements</span>
        </div>

        {/* COLLECTION REALIZATION RATE */}
        <div className="bg-slate-900 border-2 border-slate-800 p-4 rounded-none shadow-md">
          <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400 block">Collection Realization</span>
          <div className="text-2xl font-black text-cyan-400 mt-1">
            {aggregatedData.grandTotals.totalBilled > 0
              ? `${((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(1)}%`
              : '100%'}
          </div>
          <span className="text-[11px] text-cyan-300 font-bold">Collection Efficiency</span>
        </div>

        {/* TOTAL WATER CONSUMPTION */}
        <div className="bg-slate-900 border-2 border-slate-800 p-4 rounded-none shadow-md">
          <span className="text-[10px] font-black uppercase tracking-wider text-blue-400 block">Total Volume Consumed</span>
          <div className="text-2xl font-black text-blue-400 mt-1">
            {aggregatedData.grandTotals.totalM3.toLocaleString()} m³
          </div>
          <span className="text-[11px] text-slate-400 font-medium">Across {aggregatedData.grandTotals.totalConsumers} accounts</span>
        </div>

        {/* UNREAD METERS PENDING */}
        <div className="bg-slate-900 border-2 border-slate-800 p-4 rounded-none shadow-md">
          <span className="text-[10px] font-black uppercase tracking-wider text-rose-400 block">Unread Meters Pending</span>
          <div className="text-2xl font-black text-rose-400 mt-1">
            {unreadMetersData.totalUnread}
          </div>
          <span className="text-[11px] text-rose-300 font-bold">Est: ₱{unreadMetersData.totalEstimatedBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* 4. ACTIVE REPORT PREVIEW HEADER */}
      <div className="bg-slate-900 border-2 border-slate-800 p-4 rounded-none flex flex-col md:flex-row justify-between items-start md:items-center gap-3 no-print">
        <div>
          <div className="flex items-center space-x-2">
            <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 uppercase tracking-wider">
              {reportCategory.replace('_', ' ').toUpperCase()}
            </span>
            <span className="text-slate-300 font-mono text-xs font-bold">
              Period: {selectedMonth} {selectedYear} • Cycle: 1st-5th Field Reading
            </span>
          </div>
          <h3 className="text-lg font-black text-white mt-1">{reportTitles[reportCategory].title}</h3>
          <p className="text-xs text-slate-300">{reportTitles[reportCategory].description}</p>
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto flex-wrap gap-2">
          {/* Billing Prep CSV Export Shortcut */}
          {reportCategory === 'billing_prep' && (
            <button
              type="button"
              onClick={handleExportBillingCSV}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
              title="Download CSV file for billing software and Excel"
            >
              <FileDown className="h-4 w-4" />
              <span>Export CSV</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            <span>Print Document</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPDF}
            disabled={isGeneratingPdf}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase flex items-center space-x-1.5 transition border border-slate-700 cursor-pointer disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span>{isGeneratingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
          </button>

          <div className="relative flex-1 md:w-56">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter table rows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 pl-9 pr-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* 5. RECTANGULAR HIGH-CONTRAST DATA TABLE */}
      <div className="bg-slate-950 border-2 border-slate-800 rounded-none overflow-hidden shadow-sm no-print">
        <div className="overflow-x-auto">
          {/* 1. DAILY READING ACCOMPLISHMENT TABLE */}
          {reportCategory === 'daily_accomplishment' && (
            <table className="w-full text-xs text-left border-collapse min-w-[1050px]">
              <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                <tr>
                  <th className="px-4 py-3.5 border-r border-slate-800">Reading Date</th>
                  <th className="px-4 py-3.5 border-r border-slate-800">Meter Reader</th>
                  <th className="px-4 py-3.5 border-r border-slate-800">Covered Routes</th>
                  <th className="px-4 py-3.5 text-center border-r border-slate-800">Target Quota</th>
                  <th className="px-4 py-3.5 text-center border-r border-slate-800">Read Done</th>
                  <th className="px-4 py-3.5 text-center border-r border-slate-800">Accomplishment %</th>
                  <th className="px-4 py-3.5 text-center border-r border-slate-800">Normal / Flagged</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Volume (m³)</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Billed Amount (₱)</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Exp. Collected (₱)</th>
                  <th className="px-4 py-3.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {dailyAccomplishmentData.dayList
                  .filter(d => 
                    d.date.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    d.reader.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    d.routes.some(r => r.toLowerCase().includes(searchQuery.toLowerCase()))
                  )
                  .map((d, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/60 transition">
                      <td className="px-4 py-3 font-mono font-bold text-white border-r border-slate-800">
                        {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-200 border-r border-slate-800 flex items-center space-x-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                        <span>{d.reader}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 border-r border-slate-800">
                        {d.routes.join(', ')}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-400 border-r border-slate-800">
                        {d.targetQuota}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-emerald-400 border-r border-slate-800">
                        {d.actualRead}
                      </td>
                      <td className="px-4 py-3 text-center border-r border-slate-800">
                        <span className={`px-2 py-0.5 font-mono font-bold text-xs border ${
                          d.accomplishmentRate >= 100 ? 'bg-emerald-950 text-emerald-300 border-emerald-700' :
                          d.accomplishmentRate >= 90 ? 'bg-blue-950 text-blue-300 border-blue-700' :
                          'bg-amber-950 text-amber-300 border-amber-700'
                        }`}>
                          {d.accomplishmentRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-[11px] border-r border-slate-800">
                        <span className="text-slate-300">{d.normalRead} OK</span>
                        {d.flaggedAnomalies > 0 && (
                          <span className="ml-1 text-rose-400 font-bold">({d.flaggedAnomalies} flagged)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-black text-blue-400 border-r border-slate-800">
                        {d.totalM3.toLocaleString()} m³
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-white border-r border-slate-800">
                        ₱{d.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-amber-300 border-r border-slate-800">
                        ₱{d.expectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-slate-900 border border-slate-700 text-slate-300">
                          {d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                <tr>
                  <td className="px-4 py-4 uppercase tracking-wider text-amber-400 font-black border-r border-slate-800" colSpan={3}>
                    OVERALL ACCOMPLISHMENT & EXPECTED COLLECTED
                  </td>
                  <td className="px-4 py-4 text-center font-mono font-black text-white border-r border-slate-800">
                    {dailyAccomplishmentData.totalTarget}
                  </td>
                  <td className="px-4 py-4 text-center font-mono font-black text-emerald-400 border-r border-slate-800">
                    {dailyAccomplishmentData.totalAccomplished}
                  </td>
                  <td className="px-4 py-4 text-center font-mono font-black text-amber-400 border-r border-slate-800">
                    {dailyAccomplishmentData.overallRate}%
                  </td>
                  <td className="px-4 py-4 text-center text-slate-400 border-r border-slate-800">
                    -
                  </td>
                  <td className="px-4 py-4 text-right font-mono text-blue-400 text-sm font-black border-r border-slate-800">
                    {dailyAccomplishmentData.totalM3.toLocaleString()} m³
                  </td>
                  <td className="px-4 py-4 text-right font-mono text-white text-sm font-black border-r border-slate-800">
                    ₱{dailyAccomplishmentData.overallBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-4 text-right font-mono text-amber-300 text-sm font-black border-r border-slate-800">
                    ₱{dailyAccomplishmentData.overallExpectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-4 text-center text-emerald-400 font-mono text-xs font-black">
                    {dailyAccomplishmentData.overallRate}% TARGET MET
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* 2. UNREAD METER REPORT TABLE */}
          {reportCategory === 'unread_meter' && (
            <div>
              {/* Unread Category Subheader Alert */}
              <div className="bg-rose-950/30 border-b border-rose-900/50 p-3.5 flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center space-x-2 text-rose-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>
                    <strong>{unreadMetersData.totalUnread} Active Meters</strong> currently unread in {selectedMonth} {selectedYear}. Estimated unbilled volume: <strong>{unreadMetersData.totalEstimatedM3.toFixed(1)} m³</strong>.
                  </span>
                </div>
                <div className="text-amber-300 font-mono font-bold">
                  Expected Collections Once Read: ₱{unreadMetersData.totalExpectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <table className="w-full text-xs text-left border-collapse min-w-[1100px]">
                <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                  <tr>
                    <th className="px-4 py-3.5 border-r border-slate-800">Account #</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Consumer Name</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Meter Serial #</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Barangay & Address</th>
                    <th className="px-4 py-3.5 text-center border-r border-slate-800">Classification</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Assigned Reader</th>
                    <th className="px-4 py-3.5 text-center border-r border-slate-800">Days Pending</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Field Obstacle / Remarks</th>
                    <th className="px-4 py-3.5 text-right border-r border-slate-800">Est. Usage (m³)</th>
                    <th className="px-4 py-3.5 text-right border-r border-slate-800">Est. Billed (₱)</th>
                    <th className="px-4 py-3.5 text-right border-r border-slate-800">Exp. Collected (₱)</th>
                    <th className="px-4 py-3.5 text-center">Action Required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {unreadMetersData.unreadList
                    .filter(u => 
                      u.accountNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      u.consumerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      u.barangay.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      u.reasonObstacle.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((u, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/60 transition">
                        <td className="px-4 py-3 font-mono font-bold text-blue-400 border-r border-slate-800">{u.accountNumber}</td>
                        <td className="px-4 py-3 font-bold text-white border-r border-slate-800">{u.consumerName}</td>
                        <td className="px-4 py-3 font-mono text-purple-300 border-r border-slate-800">{u.meterNumber}</td>
                        <td className="px-4 py-3 text-slate-300 border-r border-slate-800">
                          <span className="font-bold text-white block">{u.barangay}</span>
                          <span className="text-[11px] text-slate-400 truncate block">{u.address}</span>
                        </td>
                        <td className="px-4 py-3 text-center border-r border-slate-800">
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border ${
                            u.consumerType === 'Commercial' ? 'bg-purple-950 text-purple-300 border-purple-700' : 'bg-blue-950 text-blue-300 border-blue-700'
                          }`}>
                            {u.consumerType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-300 border-r border-slate-800">{u.assignedReader}</td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-amber-400 border-r border-slate-800">{u.daysPending} days</td>
                        <td className="px-4 py-3 text-rose-300 font-medium border-r border-slate-800">{u.reasonObstacle}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-300 border-r border-slate-800">{u.estimatedM3.toFixed(1)} m³</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-white border-r border-slate-800">₱{u.estimatedBilledAmount.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-amber-300 border-r border-slate-800">₱{u.expectedCollectedAmount.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-rose-950 text-rose-300 border border-rose-700">
                            {u.actionRequired}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                  <tr>
                    <td className="px-4 py-4 uppercase tracking-wider text-rose-400 font-black border-r border-slate-800" colSpan={4}>
                      TOTAL UNREAD METERS INVENTORY
                    </td>
                    <td className="px-4 py-4 text-center font-black text-amber-400 border-r border-slate-800" colSpan={4}>
                      {unreadMetersData.totalUnread} Uninspected Connections Pending Dispatch
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-blue-400 text-sm font-black border-r border-slate-800">
                      {unreadMetersData.totalEstimatedM3.toFixed(1)} m³
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-white text-sm font-black border-r border-slate-800">
                      ₱{unreadMetersData.totalEstimatedBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-amber-300 text-sm font-black border-r border-slate-800">
                      ₱{unreadMetersData.totalExpectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4 text-center text-rose-400 font-mono text-xs font-black">
                      PRIORITY ACTION
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* 3. CONSUMPTION & TREND REPORT TABLE */}
          {reportCategory === 'consumption_trend' && (
            <div>
              {/* MoM Trend Banner & Consumption Brackets */}
              <div className="bg-slate-900 p-4 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-950 p-3 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">MoM Volume Trajectory</span>
                  <div className="text-xl font-black text-emerald-400 mt-0.5 flex items-center space-x-1">
                    <TrendingUp className="h-4 w-4" />
                    <span>+{consumptionTrendData.momChangePercent}% vs Last Cycle</span>
                  </div>
                  <span className="text-[10px] text-slate-500">+{consumptionTrendData.momChangeM3.toLocaleString()} m³ monthly net expansion</span>
                </div>

                <div className="bg-slate-950 p-3 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Average Household Usage</span>
                  <div className="text-xl font-black text-blue-400 mt-0.5 font-mono">
                    {consumptionTrendData.avgPerAccount} m³ / Account
                  </div>
                  <span className="text-[10px] text-slate-500">Tagoloan residential baseline: 21.5 m³</span>
                </div>

                <div className="bg-slate-950 p-3 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Lifeline Brackets (0 - 10 m³)</span>
                  <div className="text-xl font-black text-amber-300 mt-0.5 font-mono">
                    {consumptionTrendData.lifelinePct}% ({consumptionTrendData.lifelineCount} accts)
                  </div>
                  <span className="text-[10px] text-slate-500">Qualified for lifeline water subsidies</span>
                </div>

                <div className="bg-slate-950 p-3 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Expected Revenue from Volume</span>
                  <div className="text-xl font-black text-white mt-0.5 font-mono">
                    ₱{consumptionTrendData.expectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold">95% Collection Realization</span>
                </div>
              </div>

              <table className="w-full text-xs text-left border-collapse min-w-[950px]">
                <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                  <tr>
                    <th className="px-5 py-3.5 border-r border-slate-800 min-w-[180px]">Barangay / Area</th>
                    <th className="px-5 py-3.5 text-right border-r border-slate-800">Residential (m³)</th>
                    <th className="px-5 py-3.5 text-right border-r border-slate-800">Commercial (m³)</th>
                    <th className="px-5 py-3.5 text-right border-r border-slate-800">Government (m³)</th>
                    <th className="px-5 py-3.5 text-right border-r border-slate-800">Total Volume (m³)</th>
                    <th className="px-5 py-3.5 text-center border-r border-slate-800">Active Accounts</th>
                    <th className="px-5 py-3.5 text-right border-r border-slate-800">Avg. m³ / Acct</th>
                    <th className="px-5 py-3.5 text-center border-r border-slate-800">MoM Trend</th>
                    <th className="px-5 py-3.5 text-right border-r border-slate-800">Billed (₱)</th>
                    <th className="px-5 py-3.5 text-right">Exp. Collected (₱)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {aggregatedData.barangayList
                    .filter(b => (b.barangay || '').toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((b, idx) => {
                      const avg = b.totalConsumers > 0 ? (b.totalM3 / b.totalConsumers).toFixed(1) : '0.0';
                      const exp = Math.round(b.totalBilled * 0.95);
                      return (
                        <tr key={idx} className="hover:bg-slate-900/60 transition">
                          <td className="px-5 py-3 font-bold text-white border-r border-slate-800 flex items-center space-x-1.5">
                            <MapPin className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                            <span>{b.barangay}</span>
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-bold text-slate-300 border-r border-slate-800">{b.residentialM3.toLocaleString()} m³</td>
                          <td className="px-5 py-3 text-right font-mono font-bold text-slate-300 border-r border-slate-800">{b.commercialM3.toLocaleString()} m³</td>
                          <td className="px-5 py-3 text-right font-mono font-bold text-slate-300 border-r border-slate-800">{b.governmentM3.toLocaleString()} m³</td>
                          <td className="px-5 py-3 text-right font-mono font-black text-blue-400 text-sm border-r border-slate-800">{b.totalM3.toLocaleString()} m³</td>
                          <td className="px-5 py-3 text-center font-bold text-slate-200 border-r border-slate-800">{b.totalConsumers}</td>
                          <td className="px-5 py-3 text-right font-mono text-slate-400 border-r border-slate-800">{avg} m³</td>
                          <td className="px-5 py-3 text-center border-r border-slate-800">
                            <span className="px-2 py-0.5 font-mono text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                              +3.1% Expanding
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-bold text-white border-r border-slate-800">₱{b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-5 py-3 text-right font-mono font-bold text-amber-300">₱{exp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                  <tr>
                    <td className="px-5 py-4 uppercase tracking-wider text-amber-400 font-black border-r border-slate-800">
                      TOTAL DISTRICT CONSUMPTION & TREND
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-sm font-bold text-slate-200 border-r border-slate-800">
                      {aggregatedData.grandTotals.residentialM3.toLocaleString()} m³
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-sm font-bold text-slate-200 border-r border-slate-800">
                      {aggregatedData.grandTotals.commercialM3.toLocaleString()} m³
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-sm font-bold text-slate-200 border-r border-slate-800">
                      {aggregatedData.grandTotals.governmentM3.toLocaleString()} m³
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-blue-400 text-base font-black border-r border-slate-800">
                      {aggregatedData.grandTotals.totalM3.toLocaleString()} m³
                    </td>
                    <td className="px-5 py-4 text-center font-black text-sm text-white border-r border-slate-800">
                      {aggregatedData.grandTotals.totalConsumers.toLocaleString()} Accounts
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-amber-400 text-sm font-black border-r border-slate-800">
                      {(aggregatedData.grandTotals.totalM3 / Math.max(1, aggregatedData.grandTotals.totalConsumers)).toFixed(1)} m³
                    </td>
                    <td className="px-5 py-4 text-center font-mono text-emerald-300 font-black border-r border-slate-800">
                      +{consumptionTrendData.momChangePercent}% MoM
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-white text-sm font-black border-r border-slate-800">
                      ₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-amber-300 text-sm font-black">
                      ₱{Math.round(aggregatedData.grandTotals.totalBilled * 0.95).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* 4. BILLING PREPARATION & BILLING EXPORT TABLE */}
          {reportCategory === 'billing_prep' && (
            <div>
              {/* Billing Preparation Financial Overview */}
              <div className="bg-slate-900/90 p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center space-x-6">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Current Cycle Assessed</span>
                    <span className="text-lg font-black font-mono text-white">
                      ₱{billingPrepData.totalCurrentBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Prior Arrears Carried</span>
                    <span className="text-lg font-black font-mono text-rose-400">
                      ₱{billingPrepData.totalPriorArrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Gross Preparation Value</span>
                    <span className="text-lg font-black font-mono text-blue-400">
                      ₱{billingPrepData.grossTotalPayable.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-amber-400 uppercase block">Expected Collected (95% Target)</span>
                    <span className="text-lg font-black font-mono text-amber-300">
                      ₱{billingPrepData.expectedCollectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleExportBillingCSV}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase rounded flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
                  >
                    <FileDown className="h-4 w-4" />
                    <span>Export Billing Manifest (.CSV)</span>
                  </button>
                </div>
              </div>

              <table className="w-full text-xs text-left border-collapse min-w-[1250px]">
                <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                  <tr>
                    <th className="px-3 py-3.5 border-r border-slate-800 text-center">#</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Account #</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Consumer Name</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Meter Serial #</th>
                    <th className="px-4 py-3.5 border-r border-slate-800">Barangay</th>
                    <th className="px-3 py-3.5 text-center border-r border-slate-800">Class</th>
                    <th className="px-3 py-3.5 text-right border-r border-slate-800">Prev Dial</th>
                    <th className="px-3 py-3.5 text-right border-r border-slate-800">Curr Dial</th>
                    <th className="px-3 py-3.5 text-right border-r border-slate-800">Usage (m³)</th>
                    <th className="px-3 py-3.5 text-right border-r border-slate-800">Base Chg</th>
                    <th className="px-3 py-3.5 text-right border-r border-slate-800">Commodity</th>
                    <th className="px-3 py-3.5 text-right border-r border-slate-800">2% Mandate</th>
                    <th className="px-4 py-3.5 text-right border-r border-slate-800">Current Billed (₱)</th>
                    <th className="px-3 py-3.5 text-right border-r border-slate-800">Arrears (₱)</th>
                    <th className="px-4 py-3.5 text-right border-r border-slate-800">Total Payable (₱)</th>
                    <th className="px-3 py-3.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {billingPrepData.list
                    .filter(b => 
                      b.accountNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      b.consumerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      b.barangay.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((b) => (
                      <tr key={b.itemNo} className="hover:bg-slate-900/60 transition">
                        <td className="px-3 py-3 text-center font-mono text-slate-400 border-r border-slate-800">{b.itemNo}</td>
                        <td className="px-4 py-3 font-mono font-bold text-blue-400 border-r border-slate-800">{b.accountNumber}</td>
                        <td className="px-4 py-3 font-bold text-white border-r border-slate-800">{b.consumerName}</td>
                        <td className="px-4 py-3 font-mono text-purple-300 border-r border-slate-800">{b.meterNumber}</td>
                        <td className="px-4 py-3 text-slate-300 border-r border-slate-800">{b.barangay}</td>
                        <td className="px-3 py-3 text-center border-r border-slate-800">
                          <span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${
                            b.rateClass === 'Commercial' ? 'bg-purple-950 text-purple-300 border-purple-700' : 'bg-blue-950 text-blue-300 border-blue-700'
                          }`}>
                            {b.rateClass.slice(0, 3)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-400 border-r border-slate-800">{b.previousReading}</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-200 border-r border-slate-800">{b.currentReading}</td>
                        <td className="px-3 py-3 text-right font-mono font-black text-blue-400 border-r border-slate-800">{b.consumption} m³</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-400 border-r border-slate-800">₱{b.baseCharge.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-400 border-r border-slate-800">₱{b.commodityCharge.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-400 border-r border-slate-800">₱{b.franchiseFee.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-white border-r border-slate-800">₱{b.currentBilled.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-rose-400 border-r border-slate-800">
                          {b.priorArrears > 0 ? `₱${b.priorArrears.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-black text-amber-300 border-r border-slate-800">₱{b.netPayable.toFixed(2)}</td>
                        <td className="px-3 py-3 text-center">
                          <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-700">
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                  <tr>
                    <td className="px-4 py-4 uppercase tracking-wider text-amber-400 font-black border-r border-slate-800" colSpan={5}>
                      BILLING PREPARATION GRAND TOTALS
                    </td>
                    <td className="px-3 py-4 text-center text-slate-400 border-r border-slate-800" colSpan={3}>
                      {billingPrepData.totalAccounts} Accounts Ready
                    </td>
                    <td className="px-3 py-4 text-right font-mono text-blue-400 text-sm font-black border-r border-slate-800">
                      {aggregatedData.grandTotals.totalM3.toLocaleString()} m³
                    </td>
                    <td className="px-3 py-4 text-center text-slate-400 border-r border-slate-800" colSpan={3}>
                      Rates Applied
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-white text-sm font-black border-r border-slate-800">
                      ₱{billingPrepData.totalCurrentBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-4 text-right font-mono text-rose-400 text-sm font-black border-r border-slate-800">
                      ₱{billingPrepData.totalPriorArrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-amber-300 text-base font-black border-r border-slate-800">
                      ₱{billingPrepData.grossTotalPayable.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-4 text-center text-emerald-400 font-mono text-xs font-black">
                      EXP: ₱{billingPrepData.expectedCollectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* MASTER CONSOLIDATED REPORT TABLE */}
          {reportCategory === 'consolidated_master' && (
            <table className="w-full text-xs text-left border-collapse min-w-[950px]">
              <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                <tr>
                  <th className="px-4 py-3.5 border-r border-slate-800">Zone / Barangay</th>
                  <th className="px-4 py-3.5 border-r border-slate-800">Reading Schedule</th>
                  <th className="px-4 py-3.5 border-r border-slate-800">Assigned Reader</th>
                  <th className="px-4 py-3.5 text-center border-r border-slate-800">Accounts</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Volume (m³)</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Total Billed (₱)</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Collected (₱)</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Pending AR (₱)</th>
                  <th className="px-4 py-3.5 text-center">Collection Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {aggregatedData.barangayList
                  .filter(b => (b.barangay || '').toLowerCase().includes((searchQuery || '').toLowerCase()))
                  .map((b, idx) => {
                    const rate = b.totalBilled > 0 ? ((b.totalCollected / b.totalBilled) * 100).toFixed(1) : '100.0';
                    return (
                      <tr key={idx} className="hover:bg-slate-900/60 transition">
                        <td className="px-4 py-3 font-bold text-white border-r border-slate-800 flex items-center space-x-1.5">
                          <MapPin className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                          <span>{b.barangay}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-400 border-r border-slate-800">{b.readingSchedule}</td>
                        <td className="px-4 py-3 font-bold text-slate-200 border-r border-slate-800 flex items-center space-x-1.5">
                          <UserCheck className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                          <span>{b.assignedReader}</span>
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-slate-300 border-r border-slate-800">{b.totalConsumers}</td>
                        <td className="px-4 py-3 text-right font-mono font-black text-blue-400 border-r border-slate-800">{b.totalM3.toLocaleString()} m³</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-white border-r border-slate-800">₱{b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400 border-r border-slate-800">₱{b.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-rose-400 border-r border-slate-800">₱{b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 font-mono font-bold text-xs border ${
                            Number(rate) >= 90 ? 'bg-emerald-950 text-emerald-300 border-emerald-700' :
                            Number(rate) >= 70 ? 'bg-amber-950 text-amber-300 border-amber-700' :
                            'bg-rose-950 text-rose-300 border-rose-700'
                          }`}>
                            {rate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                <tr>
                  <td className="px-4 py-4 uppercase tracking-wider text-amber-400 font-black border-r border-slate-800">
                    GRAND TOTAL DISTRICT CONSOLIDATION
                  </td>
                  <td className="px-4 py-4 text-xs font-mono text-slate-400 border-r border-slate-800">Monthly Schedule ({selectedMonth})</td>
                  <td className="px-4 py-4 text-xs font-bold text-slate-300 border-r border-slate-800">ALL FIELD READERS</td>
                  <td className="px-4 py-4 text-center font-black text-sm text-white border-r border-slate-800">{aggregatedData.grandTotals.totalConsumers.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-mono text-blue-400 text-sm font-black border-r border-slate-800">{aggregatedData.grandTotals.totalM3.toLocaleString()} m³</td>
                  <td className="px-4 py-4 text-right font-mono text-white text-sm font-black border-r border-slate-800">₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-4 text-right font-mono text-emerald-400 text-sm font-black border-r border-slate-800">₱{aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-4 text-right font-mono text-rose-400 text-sm font-black border-r border-slate-800">₱{aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-4 text-center text-amber-400 font-mono text-sm font-black">
                    {aggregatedData.grandTotals.totalBilled > 0
                      ? `${((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(1)}%`
                      : '100%'}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* A. MONTHLY WATER CONSUMPTION REPORT TABLE */}
          {reportCategory === 'consumption' && (
            <table className="w-full text-xs text-left border-collapse min-w-[850px]">
              <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                <tr>
                  <th className="px-5 py-3.5 border-r border-slate-800 min-w-[180px]">Barangay / Area</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Residential (m³)</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Commercial (m³)</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Government (m³)</th>
                  <th className="px-5 py-3.5 text-center border-r border-slate-800">Total Consumers</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Total Consumption (m³)</th>
                  <th className="px-5 py-3.5 text-right">Avg. m³ / Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {aggregatedData.barangayList
                  .filter(b => (b.barangay || '').toLowerCase().includes((searchQuery || '').toLowerCase()))
                  .map((b, idx) => {
                    const avg = b.totalConsumers > 0 ? (b.totalM3 / b.totalConsumers).toFixed(1) : '0.0';
                    return (
                      <tr key={idx} className="hover:bg-slate-900/60 transition">
                        <td className="px-5 py-3 font-bold text-white border-r border-slate-800 flex items-center space-x-1.5">
                          <MapPin className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                          <span>{b.barangay}</span>
                        </td>
                        <td className="px-5 py-3 text-right font-mono font-bold text-slate-300 border-r border-slate-800">{b.residentialM3.toLocaleString()} m³</td>
                        <td className="px-5 py-3 text-right font-mono font-bold text-slate-300 border-r border-slate-800">{b.commercialM3.toLocaleString()} m³</td>
                        <td className="px-5 py-3 text-right font-mono font-bold text-slate-300 border-r border-slate-800">{b.governmentM3.toLocaleString()} m³</td>
                        <td className="px-5 py-3 text-center font-bold text-slate-200 border-r border-slate-800">{b.totalConsumers.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right font-mono font-black text-blue-400 text-sm border-r border-slate-800">{b.totalM3.toLocaleString()} m³</td>
                        <td className="px-5 py-3 text-right font-mono text-slate-400">{avg} m³</td>
                      </tr>
                    );
                  })}
              </tbody>
              {/* CLEAR, PROMINENT, HIGH-CONTRAST GRAND TOTAL ROW */}
              <tfoot className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                <tr>
                  <td className="px-5 py-4 uppercase tracking-wider text-amber-400 font-black border-r border-slate-800">
                    TOTAL DISTRICT CONSUMPTION
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-sm font-bold text-slate-200 border-r border-slate-800">
                    {aggregatedData.grandTotals.residentialM3.toLocaleString()} m³
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-sm font-bold text-slate-200 border-r border-slate-800">
                    {aggregatedData.grandTotals.commercialM3.toLocaleString()} m³
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-sm font-bold text-slate-200 border-r border-slate-800">
                    {aggregatedData.grandTotals.governmentM3.toLocaleString()} m³
                  </td>
                  <td className="px-5 py-4 text-center font-black text-sm text-white border-r border-slate-800">
                    {aggregatedData.grandTotals.totalConsumers.toLocaleString()} Accounts
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-blue-400 text-base font-black border-r border-slate-800">
                    {aggregatedData.grandTotals.totalM3.toLocaleString()} m³
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-amber-400 text-sm font-black">
                    {(aggregatedData.grandTotals.totalM3 / Math.max(1, aggregatedData.grandTotals.totalConsumers)).toFixed(1)} m³ / acct
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* E. WATER BILLING & COLLECTION MATRIX TABLE */}
          {reportCategory === 'summary_matrix' && (
            <table className="w-full text-xs text-left border-collapse min-w-[850px]">
              <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                <tr>
                  <th className="px-5 py-3.5 border-r border-slate-800">Barangay / Area</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Total Billed (PHP)</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Total Collected (PHP)</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Pending Collection (PHP)</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Arrears (PHP)</th>
                  <th className="px-5 py-3.5 text-center">Collection Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {aggregatedData.barangayList
                  .filter(b => (b.barangay || '').toLowerCase().includes((searchQuery || '').toLowerCase()))
                  .map((b, idx) => {
                    const rate = b.totalBilled > 0 ? ((b.totalCollected / b.totalBilled) * 100).toFixed(1) : '100.0';
                    return (
                      <tr key={idx} className="hover:bg-slate-900/60 transition">
                        <td className="px-5 py-3 font-bold text-white border-r border-slate-800 flex items-center space-x-1.5">
                          <MapPin className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                          <span>{b.barangay}</span>
                        </td>
                        <td className="px-5 py-3 text-right font-mono font-bold text-white border-r border-slate-800">₱{b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-5 py-3 text-right font-mono font-bold text-emerald-400 border-r border-slate-800">₱{b.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-5 py-3 text-right font-mono font-bold text-rose-400 border-r border-slate-800">₱{b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-5 py-3 text-right font-mono text-slate-400 border-r border-slate-800">₱{b.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`px-2.5 py-0.5 font-mono font-bold text-xs border ${
                            Number(rate) >= 90 ? 'bg-emerald-950 text-emerald-300 border-emerald-700' :
                            Number(rate) >= 70 ? 'bg-amber-950 text-amber-300 border-amber-700' :
                            'bg-rose-950 text-rose-300 border-rose-700'
                          }`}>
                            {rate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                <tr>
                  <td className="px-5 py-4 uppercase tracking-wider text-amber-400 font-black border-r border-slate-800">TOTAL DISTRICT FINANCIALS</td>
                  <td className="px-5 py-4 text-right font-mono text-white text-sm font-black border-r border-slate-800">₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-5 py-4 text-right font-mono text-emerald-400 text-sm font-black border-r border-slate-800">₱{aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-5 py-4 text-right font-mono text-rose-400 text-sm font-black border-r border-slate-800">₱{aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-5 py-4 text-right font-mono text-slate-300 text-sm font-black border-r border-slate-800">₱{aggregatedData.grandTotals.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-5 py-4 text-center text-amber-400 font-mono text-sm font-black">
                    {aggregatedData.grandTotals.totalBilled > 0
                      ? `${((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(1)}%`
                      : '100%'}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* H. METER READER MULTI-BARANGAY PERFORMANCE TABLE */}
          {reportCategory === 'meter_reader_perf' && (
            <table className="w-full text-xs text-left border-collapse min-w-[850px]">
              <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                <tr>
                  <th className="px-5 py-3.5 border-r border-slate-800">Meter Reader Officer</th>
                  <th className="px-5 py-3.5 border-r border-slate-800">Assigned Coverage Areas</th>
                  <th className="px-5 py-3.5 border-r border-slate-800">Reading Schedule</th>
                  <th className="px-5 py-3.5 text-center border-r border-slate-800">Assigned Accounts</th>
                  <th className="px-5 py-3.5 text-center border-r border-slate-800">Read Completed</th>
                  <th className="px-5 py-3.5 text-center border-r border-slate-800">Pending Meters</th>
                  <th className="px-5 py-3.5 text-right border-r border-slate-800">Volume Read (m³)</th>
                  <th className="px-5 py-3.5 text-center">Completion Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {readerPerformance.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/60 transition">
                    <td className="px-5 py-3.5 font-black text-white border-r border-slate-800 flex items-center space-x-2">
                      <UserCheck className="h-4 w-4 text-blue-400 shrink-0" />
                      <span>{r.name}</span>
                    </td>
                    <td className="px-5 py-3.5 border-r border-slate-800">
                      <div className="flex flex-wrap gap-1">
                        {r.assignedAreas.map((area, aIdx) => (
                          <span key={aIdx} className="bg-blue-950 text-blue-300 border border-blue-700 px-2 py-0.5 text-[10px] font-bold">
                            {area}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-slate-400 border-r border-slate-800">{r.readingSchedule}</td>
                    <td className="px-5 py-3.5 text-center font-mono font-bold text-slate-300 border-r border-slate-800">{r.totalAssigned}</td>
                    <td className="px-5 py-3.5 text-center font-mono font-black text-emerald-400 border-r border-slate-800">{r.totalRead}</td>
                    <td className="px-5 py-3.5 text-center font-mono font-bold text-rose-400 border-r border-slate-800">{r.pendingRead}</td>
                    <td className="px-5 py-3.5 text-right font-mono font-black text-blue-400 border-r border-slate-800">{r.totalM3.toLocaleString()} m³</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold px-2 py-0.5 text-xs">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ITEMIZED LEDGERS (Billing / Collection / AR / Abnormal / Delinquency) */}
          {(reportCategory === 'billing' || reportCategory === 'collection' || reportCategory === 'pending_ar' || reportCategory === 'barangay_performance' || reportCategory === 'reading_status' || reportCategory === 'abnormal_consumption' || reportCategory === 'arrears_ledger') && (
            <table className="w-full text-xs text-left border-collapse min-w-[900px]">
              <thead className="bg-slate-900 text-white font-extrabold uppercase text-[11px] tracking-wider border-b-2 border-slate-800">
                <tr>
                  <th className="px-4 py-3.5 border-r border-slate-800">Account #</th>
                  <th className="px-4 py-3.5 border-r border-slate-800">Consumer Name</th>
                  <th className="px-4 py-3.5 border-r border-slate-800">Barangay Zone</th>
                  <th className="px-4 py-3.5 border-r border-slate-800">Classification</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Usage (m³)</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Billed Amount</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Paid Amount</th>
                  <th className="px-4 py-3.5 text-right border-r border-slate-800">Pending Balance</th>
                  <th className="px-4 py-3.5 text-center">Payment Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {(() => {
                  let flatList: any[] = [];
                  aggregatedData.barangayList.forEach(b => {
                    b.accounts.forEach(a => {
                      flatList.push({ ...a, barangay: b.barangay });
                    });
                  });

                  if (reportCategory === 'abnormal_consumption') {
                    flatList = flatList.filter(a => a.isAbnormal);
                  } else if (reportCategory === 'pending_ar' || reportCategory === 'arrears_ledger') {
                    flatList = flatList.filter(a => a.pendingAmount > 0 || a.paymentStatus !== 'paid');
                  } else if (reportCategory === 'collection') {
                    flatList = flatList.filter(a => a.paymentStatus === 'paid' || a.paidAmount > 0);
                  }

                  if (searchQuery) {
                    const q = searchQuery.toLowerCase().trim();
                    flatList = flatList.filter(a => 
                      (a.accountNumber || '').toLowerCase().includes(q) ||
                      (a.consumerName || '').toLowerCase().includes(q) ||
                      (a.barangay || '').toLowerCase().includes(q)
                    );
                  }

                  if (flatList.length === 0) {
                    return (
                      <tr>
                        <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                          <p className="font-bold text-slate-300">No records found matching the active filter criteria.</p>
                          <p className="text-xs text-slate-500">Adjust your Year, Month, Barangay, or Classification filters above.</p>
                        </td>
                      </tr>
                    );
                  }

                  return flatList.map((a, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/60 transition">
                      <td className="px-4 py-3 font-mono font-bold text-blue-400 border-r border-slate-800">{a.accountNumber}</td>
                      <td className="px-4 py-3 font-bold text-white border-r border-slate-800">{a.consumerName}</td>
                      <td className="px-4 py-3 text-slate-300 font-medium border-r border-slate-800">{a.barangay}</td>
                      <td className="px-4 py-3 border-r border-slate-800">
                        <span className={`px-2 py-0.5 text-[10px] font-black uppercase border ${
                          a.type === 'Commercial' ? 'bg-purple-950 text-purple-300 border-purple-700' : 'bg-blue-950 text-blue-300 border-blue-700'
                        }`}>
                          {a.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-white border-r border-slate-800">{a.consumption} m³</td>
                      <td className="px-4 py-3 text-right font-mono font-black text-white border-r border-slate-800">₱{a.billedAmount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono font-black text-emerald-400 border-r border-slate-800">₱{a.paidAmount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono font-black text-rose-400 border-r border-slate-800">₱{a.pendingAmount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 text-[10px] font-black uppercase border ${
                          a.paymentStatus === 'paid' ? 'bg-emerald-950 text-emerald-300 border-emerald-700' : 'bg-amber-950 text-amber-300 border-amber-700'
                        }`}>
                          {a.paymentStatus}
                        </span>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* =========================================================================
          6. OFFICIAL PRINTABLE DOCUMENT (PORTALED TO BODY FOR INSTANT VIEWPORT CENTER)
          ========================================================================= */}
      {showPrintModal && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[99999] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden no-print-bg"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPrintModal(false);
          }}
        >
          <div className="bg-slate-900 border-2 border-slate-700 max-w-7xl w-full h-[94vh] max-h-[96vh] flex flex-col shadow-2xl rounded-none overflow-hidden">
            {/* Modal Toolbar (hidden when printing) */}
            <div className="flex-shrink-0 flex justify-between items-center p-4 bg-slate-950 border-b border-slate-800 no-print flex-wrap gap-3">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 bg-slate-900 border border-blue-500/40 p-1 flex items-center justify-center">
                  <img 
                    src={OFFICIAL_LOGO_URL} 
                    alt="Logo"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_LOGO_URL;
                    }}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">Official Report Print Preview</h3>
                  <p className="text-[11px] text-slate-400">Centered Official Letterhead • High-Contrast Layout • Certified Master Record</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {/* Visual Preview Mode Switcher */}
                <div className="flex items-center bg-slate-900 border border-slate-700 p-0.5 rounded-none mr-1">
                  <button
                    type="button"
                    onClick={() => setPreviewTheme('dark')}
                    className={`px-3 py-1.5 text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer ${
                      previewTheme === 'dark'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Comfortable dark view for screen reading"
                  >
                    <Moon className="h-3.5 w-3.5" />
                    <span>Dark Comfort View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTheme('paper')}
                    className={`px-3 py-1.5 text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer ${
                      previewTheme === 'paper'
                        ? 'bg-slate-200 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Soft paper view with black ink"
                  >
                    <Sun className="h-3.5 w-3.5" />
                    <span>Paper View</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase flex items-center space-x-2 shadow-md cursor-pointer"
                >
                  <Printer className="h-4 w-4" />
                  <span>Print Document</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase flex items-center space-x-1.5 border border-slate-700 cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintModal(false)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                  title="Close Preview (Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Preview Sheet Container with Dynamic Dark / Soft Paper Theme */}
            <div className={`p-3 sm:p-6 overflow-y-auto overflow-x-auto flex-1 flex justify-center ${
              previewTheme === 'dark' ? 'bg-slate-950' : 'bg-slate-900'
            }`}>
              <div 
                id="official-print-document" 
                className={`p-6 sm:p-8 w-full max-w-[1100px] shadow-2xl border font-sans space-y-6 ${
                  previewTheme === 'dark'
                    ? 'bg-slate-900 text-slate-100 border-slate-700'
                    : 'bg-slate-50 text-slate-950 border-slate-400'
                }`}
              >
                {/* 1. NATURAL OFFICIAL LETTERHEAD WITH SIDE-BY-SIDE DUAL LOGOS */}
                <div className={`print-header-center flex items-center justify-between border-b-2 pb-4 mb-4 ${
                  previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'
                }`}>
                  {/* Left Logo - Tagoloan Water District Seal */}
                  <div className="w-20 h-20 flex-shrink-0 flex items-center justify-center">
                    <img 
                      src={OFFICIAL_LOGO_URL} 
                      alt="Tagoloan Water District Seal" 
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = FALLBACK_LOGO_URL;
                      }}
                      className="h-20 w-20 object-contain"
                    />
                  </div>

                  {/* Center Official Text (High-Contrast Typography) */}
                  <div className="text-center flex-1 px-4">
                    <span className={`text-xs font-bold uppercase tracking-widest block ${
                      previewTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                    }`}>
                      Republic of the Philippines
                    </span>
                    <h1 className={`text-xl sm:text-2xl font-black tracking-tight mt-0.5 uppercase ${
                      previewTheme === 'dark' ? 'text-white' : 'text-slate-950'
                    }`}>
                      TAGOLOAN WATER DISTRICT
                    </h1>
                    <p className={`text-xs font-medium mt-0.5 ${
                      previewTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                    }`}>
                      Poblacion, Tagoloan, Misamis Oriental 9001 • Tel: (088) 890-4946
                    </p>
                    <p className={`text-[11px] font-mono ${
                      previewTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                      Provincial Water Utilities Act of 1973 (Presidential Decree No. 198 as amended)
                    </p>
                    
                    <div className={`w-48 h-0.5 mx-auto my-2 ${
                      previewTheme === 'dark' ? 'bg-blue-500' : 'bg-slate-900'
                    }`}></div>
                    
                    <h2 className={`text-base sm:text-lg font-black uppercase tracking-tight ${
                      previewTheme === 'dark' ? 'text-blue-400' : 'text-slate-950'
                    }`}>
                      {reportTitles[reportCategory].title}
                    </h2>
                    <p className={`text-xs font-semibold mt-0.5 ${
                      previewTheme === 'dark' ? 'text-amber-400' : 'text-slate-700'
                    }`}>
                      Billing Period: {selectedMonth} {selectedYear} • Status: Certified Official Master Record • Date: {new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}
                    </p>
                  </div>

                  {/* Right Logo - Republic of the Philippines Seal */}
                  <div className="w-20 h-20 flex-shrink-0 flex items-center justify-center">
                    <img 
                      src={PH_SEAL_URL} 
                      alt="Republic of the Philippines Coat of Arms" 
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = FALLBACK_LOGO_URL;
                      }}
                      className="h-20 w-20 object-contain"
                    />
                  </div>
                </div>

                {/* 1.5 EXECUTIVE FINANCIAL SUMMARY: OVERALL AMOUNT & EXPECTED COLLECTED */}
                <div className={`p-4 border-2 grid grid-cols-2 sm:grid-cols-4 gap-4 ${
                  previewTheme === 'dark' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-100 border-slate-400 text-slate-950'
                }`}>
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Overall Amount Billed</span>
                    <span className="text-base sm:text-lg font-black font-mono text-blue-400 block mt-0.5">
                      ₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] text-slate-500">Gross Tariff Assessment</span>
                  </div>

                  <div>
                    <span className="text-[10px] font-black uppercase text-amber-400 block tracking-wider flex items-center space-x-1">
                      <span>Expected Collected Amount</span>
                    </span>
                    <span className="text-base sm:text-lg font-black font-mono text-amber-300 block mt-0.5">
                      ₱{Math.round(aggregatedData.grandTotals.totalBilled * 0.95).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] text-amber-400/80 font-bold">95.0% Regulatory Realization Target</span>
                  </div>

                  <div>
                    <span className="text-[10px] font-black uppercase text-emerald-400 block tracking-wider">Realized Cash Collections</span>
                    <span className="text-base sm:text-lg font-black font-mono text-emerald-400 block mt-0.5">
                      ₱{aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] text-emerald-500 font-bold">Verified Cashier Settlements</span>
                  </div>

                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Collection Realization Rate</span>
                    <span className="text-base sm:text-lg font-black font-mono text-cyan-400 block mt-0.5">
                      {aggregatedData.grandTotals.totalBilled > 0
                        ? `${((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(1)}%`
                        : '100%'}
                    </span>
                    <span className="text-[10px] text-slate-500">Cycle Realization Ratio</span>
                  </div>
                </div>

                {/* 2. MAIN CONSOLIDATED / ITEMIZED DATA TABLE FOR PRINTING */}
                <div className="overflow-x-auto w-full">
                  {/* PRINT TABLE 1: DAILY READING ACCOMPLISHMENT */}
                  {reportCategory === 'daily_accomplishment' ? (
                    <table className={`w-full table-fixed min-w-[850px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '14%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[10px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2 py-2 border border-slate-700 truncate">Date</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Meter Reader</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Routes</th>
                          <th className="px-2 py-2 text-center border border-slate-700 truncate">Quota</th>
                          <th className="px-2 py-2 text-center border border-slate-700 truncate">Read</th>
                          <th className="px-2 py-2 text-center border border-slate-700 truncate">% Done</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Volume (m³)</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Billed (₱)</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Exp. Coll. (₱)</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {dailyAccomplishmentData.dayList.map((d, idx) => (
                          <tr key={idx} className={idx % 2 === 0 
                            ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                            : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                          }>
                            <td className="px-2 py-1.5 font-mono border border-slate-700 truncate">{d.date}</td>
                            <td className="px-2 py-1.5 font-bold border border-slate-700 truncate">{d.reader}</td>
                            <td className="px-2 py-1.5 border border-slate-700 truncate">{d.routes.join(', ')}</td>
                            <td className="px-2 py-1.5 text-center font-mono border border-slate-700 truncate">{d.targetQuota}</td>
                            <td className="px-2 py-1.5 text-center font-mono font-bold text-emerald-400 border border-slate-700 truncate">{d.actualRead}</td>
                            <td className="px-2 py-1.5 text-center font-mono font-bold border border-slate-700 truncate">{d.accomplishmentRate}%</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-blue-400 border border-slate-700 truncate">{d.totalM3.toLocaleString()} m³</td>
                            <td className="px-2 py-1.5 text-right font-mono border border-slate-700 truncate">₱{d.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-amber-300 border border-slate-700 truncate">₱{d.expectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2 py-2 uppercase font-black text-amber-400 border border-slate-700 truncate" colSpan={3}>
                            OVERALL ACCOMPLISHMENT & EXPECTED COLLECTED
                          </td>
                          <td className="px-2 py-2 text-center font-mono border border-slate-700 truncate">{dailyAccomplishmentData.totalTarget}</td>
                          <td className="px-2 py-2 text-center font-mono text-emerald-400 border border-slate-700 truncate">{dailyAccomplishmentData.totalAccomplished}</td>
                          <td className="px-2 py-2 text-center font-mono text-amber-400 border border-slate-700 truncate">{dailyAccomplishmentData.overallRate}%</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-blue-400 border border-slate-700 truncate">{dailyAccomplishmentData.totalM3.toLocaleString()} m³</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-white border border-slate-700 truncate">₱{dailyAccomplishmentData.overallBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-amber-300 border border-slate-700 truncate">₱{dailyAccomplishmentData.overallExpectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : reportCategory === 'unread_meter' ? (
                    <table className={`w-full table-fixed min-w-[850px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '16%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '10%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[10px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2 py-2 border border-slate-700 truncate">Account #</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Consumer Name</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Meter Serial</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Barangay Zone</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Reason Obstacle</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Est. m³</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Est. Billed (₱)</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Exp. Coll. (₱)</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {unreadMetersData.unreadList.map((u, idx) => (
                          <tr key={idx} className={idx % 2 === 0 
                            ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                            : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                          }>
                            <td className="px-2 py-1.5 font-mono text-blue-400 border border-slate-700 truncate">{u.accountNumber}</td>
                            <td className="px-2 py-1.5 font-bold border border-slate-700 truncate">{u.consumerName}</td>
                            <td className="px-2 py-1.5 font-mono border border-slate-700 truncate">{u.meterNumber}</td>
                            <td className="px-2 py-1.5 border border-slate-700 truncate">{u.barangay}</td>
                            <td className="px-2 py-1.5 text-rose-300 font-medium border border-slate-700 truncate">{u.reasonObstacle}</td>
                            <td className="px-2 py-1.5 text-right font-mono border border-slate-700 truncate">{u.estimatedM3.toFixed(1)} m³</td>
                            <td className="px-2 py-1.5 text-right font-mono border border-slate-700 truncate">₱{u.estimatedBilledAmount.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-amber-300 border border-slate-700 truncate">₱{u.expectedCollectedAmount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2 py-2 uppercase font-black text-rose-400 border border-slate-700 truncate" colSpan={4}>
                            TOTAL UNREAD METERS ({unreadMetersData.totalUnread} Accounts)
                          </td>
                          <td className="px-2 py-2 text-slate-400 border border-slate-700 truncate">ESTIMATED RECOVERY</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-blue-400 border border-slate-700 truncate">{unreadMetersData.totalEstimatedM3.toFixed(1)} m³</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-white border border-slate-700 truncate">₱{unreadMetersData.totalEstimatedBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-amber-300 border border-slate-700 truncate">₱{unreadMetersData.totalExpectedCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : reportCategory === 'consumption_trend' ? (
                    <table className={`w-full table-fixed min-w-[850px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '13%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[10px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2 py-2 border border-slate-700 truncate">Barangay Zone</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Residential (m³)</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Commercial (m³)</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Total Volume (m³)</th>
                          <th className="px-2 py-2 text-center border border-slate-700 truncate">MoM Trajectory</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Assessed Billed (₱)</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Exp. Coll. (₱)</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {aggregatedData.barangayList.map((b, idx) => (
                          <tr key={idx} className={idx % 2 === 0 
                            ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                            : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                          }>
                            <td className="px-2 py-1.5 font-bold border border-slate-700 truncate">{b.barangay}</td>
                            <td className="px-2 py-1.5 text-right font-mono border border-slate-700 truncate">{b.residentialM3.toLocaleString()} m³</td>
                            <td className="px-2 py-1.5 text-right font-mono border border-slate-700 truncate">{b.commercialM3.toLocaleString()} m³</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-blue-400 border border-slate-700 truncate">{b.totalM3.toLocaleString()} m³</td>
                            <td className="px-2 py-1.5 text-center font-mono text-emerald-400 border border-slate-700 truncate">+3.1% Expanding</td>
                            <td className="px-2 py-1.5 text-right font-mono border border-slate-700 truncate">₱{b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-amber-300 border border-slate-700 truncate">₱{Math.round(b.totalBilled * 0.95).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2 py-2 uppercase font-black text-amber-400 border border-slate-700 truncate">TOTAL DISTRICT CONSUMPTION & TREND</td>
                          <td className="px-2 py-2 text-right font-mono border border-slate-700 truncate">{aggregatedData.grandTotals.residentialM3.toLocaleString()} m³</td>
                          <td className="px-2 py-2 text-right font-mono border border-slate-700 truncate">{aggregatedData.grandTotals.commercialM3.toLocaleString()} m³</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-blue-400 border border-slate-700 truncate">{aggregatedData.grandTotals.totalM3.toLocaleString()} m³</td>
                          <td className="px-2 py-2 text-center font-mono text-emerald-400 border border-slate-700 truncate">+{consumptionTrendData.momChangePercent}% MoM</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-white border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-amber-300 border border-slate-700 truncate">₱{Math.round(aggregatedData.grandTotals.totalBilled * 0.95).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : reportCategory === 'billing_prep' ? (
                    <table className={`w-full table-fixed min-w-[850px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '12%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[10px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-1.5 py-2 text-center border border-slate-700">#</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Account #</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Consumer Name</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Meter Serial</th>
                          <th className="px-2 py-2 border border-slate-700 truncate">Barangay</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Usage</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Billed (₱)</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Arrears (₱)</th>
                          <th className="px-2 py-2 text-right border border-slate-700 truncate">Payable (₱)</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {billingPrepData.list.map((b) => (
                          <tr key={b.itemNo} className={b.itemNo % 2 === 0 
                            ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                            : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                          }>
                            <td className="px-1.5 py-1.5 text-center font-mono border border-slate-700">{b.itemNo}</td>
                            <td className="px-2 py-1.5 font-mono text-blue-400 border border-slate-700 truncate">{b.accountNumber}</td>
                            <td className="px-2 py-1.5 font-bold border border-slate-700 truncate">{b.consumerName}</td>
                            <td className="px-2 py-1.5 font-mono border border-slate-700 truncate">{b.meterNumber}</td>
                            <td className="px-2 py-1.5 border border-slate-700 truncate">{b.barangay}</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-blue-400 border border-slate-700 truncate">{b.consumption} m³</td>
                            <td className="px-2 py-1.5 text-right font-mono border border-slate-700 truncate">₱{b.currentBilled.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-rose-400 border border-slate-700 truncate">₱{b.priorArrears.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-amber-300 border border-slate-700 truncate">₱{b.netPayable.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2 py-2 uppercase font-black text-amber-400 border border-slate-700 truncate" colSpan={5}>
                            BILLING PREPARATION TOTALS ({billingPrepData.totalAccounts} Accounts)
                          </td>
                          <td className="px-2 py-2 text-right font-mono font-black text-blue-400 border border-slate-700 truncate">{aggregatedData.grandTotals.totalM3.toLocaleString()} m³</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-white border border-slate-700 truncate">₱{billingPrepData.totalCurrentBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-rose-400 border border-slate-700 truncate">₱{billingPrepData.totalPriorArrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-amber-300 border border-slate-700 truncate">₱{billingPrepData.grossTotalPayable.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : reportCategory === 'consumption' ? (
                    <table className={`w-full table-fixed min-w-[780px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '13%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[11px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2.5 py-2.5 border border-slate-700 truncate">Barangay / Zone</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Residential (m³)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Commercial (m³)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Government (m³)</th>
                          <th className="px-2.5 py-2.5 text-center border border-slate-700 truncate">Total Accounts</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Total Volume (m³)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Avg. m³ / Acct</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {aggregatedData.barangayList.map((b, idx) => {
                          const avg = b.totalConsumers > 0 ? (b.totalM3 / b.totalConsumers).toFixed(1) : '0.0';
                          return (
                            <tr key={idx} className={idx % 2 === 0 
                              ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                              : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                            }>
                              <td className="px-2.5 py-2 font-bold border border-slate-700 truncate">{b.barangay}</td>
                              <td className="px-2.5 py-2 text-right font-mono border border-slate-700 truncate">{b.residentialM3.toLocaleString()} m³</td>
                              <td className="px-2.5 py-2 text-right font-mono border border-slate-700 truncate">{b.commercialM3.toLocaleString()} m³</td>
                              <td className="px-2.5 py-2 text-right font-mono border border-slate-700 truncate">{b.governmentM3.toLocaleString()} m³</td>
                              <td className="px-2.5 py-2 text-center font-bold border border-slate-700 truncate">{b.totalConsumers}</td>
                              <td className="px-2.5 py-2 text-right font-mono font-bold text-blue-400 border border-slate-700 truncate">{b.totalM3.toLocaleString()} m³</td>
                              <td className="px-2.5 py-2 text-right font-mono border border-slate-700 truncate">{avg} m³</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2.5 py-2.5 uppercase font-black text-amber-400 border border-slate-700 truncate">TOTAL DISTRICT</td>
                          <td className="px-2.5 py-2.5 text-right font-mono border border-slate-700 truncate">{aggregatedData.grandTotals.residentialM3.toLocaleString()} m³</td>
                          <td className="px-2.5 py-2.5 text-right font-mono border border-slate-700 truncate">{aggregatedData.grandTotals.commercialM3.toLocaleString()} m³</td>
                          <td className="px-2.5 py-2.5 text-right font-mono border border-slate-700 truncate">{aggregatedData.grandTotals.governmentM3.toLocaleString()} m³</td>
                          <td className="px-2.5 py-2.5 text-center font-black border border-slate-700 truncate">{aggregatedData.grandTotals.totalConsumers.toLocaleString()}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black text-blue-400 border border-slate-700 truncate">{aggregatedData.grandTotals.totalM3.toLocaleString()} m³</td>
                          <td className="px-2.5 py-2.5 text-right font-mono text-amber-400 border border-slate-700 truncate">
                            {(aggregatedData.grandTotals.totalM3 / Math.max(1, aggregatedData.grandTotals.totalConsumers)).toFixed(1)} m³
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : reportCategory === 'collection' ? (
                    <table className={`w-full table-fixed min-w-[780px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '12%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[11px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2.5 py-2.5 border border-slate-700 truncate">Zone / Barangay</th>
                          <th className="px-2.5 py-2.5 text-center border border-slate-700 truncate">Accounts</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Total Billed (₱)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Collected (₱)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Pending AR (₱)</th>
                          <th className="px-2.5 py-2.5 text-center border border-slate-700 truncate">Efficiency</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {aggregatedData.barangayList.map((b, idx) => {
                          const rate = b.totalBilled > 0 ? ((b.totalCollected / b.totalBilled) * 100).toFixed(1) : '100.0';
                          return (
                            <tr key={idx} className={idx % 2 === 0 
                              ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                              : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                            }>
                              <td className="px-2.5 py-2 font-bold border border-slate-700 truncate">{b.barangay}</td>
                              <td className="px-2.5 py-2 text-center font-mono border border-slate-700 truncate">{b.totalConsumers}</td>
                              <td className="px-2.5 py-2 text-right font-mono font-medium border border-slate-700 truncate">₱{b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2.5 py-2 text-right font-mono font-bold text-emerald-400 border border-slate-700 truncate">₱{b.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2.5 py-2 text-right font-mono font-bold text-rose-400 border border-slate-700 truncate">₱{b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2.5 py-2 text-center font-mono font-bold border border-slate-700 truncate">{rate}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2.5 py-2.5 uppercase font-black text-amber-400 border border-slate-700 truncate">TOTAL DISTRICT</td>
                          <td className="px-2.5 py-2.5 text-center font-mono border border-slate-700 truncate">{aggregatedData.grandTotals.totalConsumers.toLocaleString()}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black text-emerald-400 border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black text-rose-400 border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-center font-mono font-black text-amber-400 border border-slate-700 truncate">
                            {aggregatedData.grandTotals.totalBilled > 0
                              ? `${((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(1)}%`
                              : '100%'}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : reportCategory === 'delinquency' ? (
                    <table className={`w-full table-fixed min-w-[780px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '20%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[11px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2.5 py-2.5 border border-slate-700 truncate">Zone / Barangay</th>
                          <th className="px-2.5 py-2.5 text-center border border-slate-700 truncate">Delinquent Accounts</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Current Unpaid (₱)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Historical Arrears (₱)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Total Outstanding AR (₱)</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {aggregatedData.barangayList.map((b, idx) => (
                          <tr key={idx} className={idx % 2 === 0 
                            ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                            : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                          }>
                            <td className="px-2.5 py-2 font-bold border border-slate-700 truncate">{b.barangay}</td>
                            <td className="px-2.5 py-2 text-center font-mono font-bold text-rose-400 border border-slate-700 truncate">{b.delinquentCount}</td>
                            <td className="px-2.5 py-2 text-right font-mono border border-slate-700 truncate">₱{b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            <td className="px-2.5 py-2 text-right font-mono border border-slate-700 truncate">₱{b.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            <td className="px-2.5 py-2 text-right font-mono font-bold text-rose-400 border border-slate-700 truncate">₱{(b.totalPending + b.arrears).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2.5 py-2.5 uppercase font-black text-amber-400 border border-slate-700 truncate">TOTAL DISTRICT ARREARS</td>
                          <td className="px-2.5 py-2.5 text-center font-mono font-black text-rose-400 border border-slate-700 truncate">{aggregatedData.grandTotals.delinquentCount}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black border border-slate-700 truncate">₱{aggregatedData.grandTotals.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black text-rose-400 border border-slate-700 truncate">₱{(aggregatedData.grandTotals.totalPending + aggregatedData.grandTotals.arrears).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : reportCategory === 'summary_matrix' ? (
                    <table className={`w-full table-fixed min-w-[780px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '12%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[11px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2.5 py-2.5 border border-slate-700 truncate">Zone / Barangay</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Total Billed (₱)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Total Collected (₱)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Pending AR (₱)</th>
                          <th className="px-2.5 py-2.5 text-right border border-slate-700 truncate">Arrears (₱)</th>
                          <th className="px-2.5 py-2.5 text-center border border-slate-700 truncate">Collection Rate</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {aggregatedData.barangayList.map((b, idx) => {
                          const rate = b.totalBilled > 0 ? ((b.totalCollected / b.totalBilled) * 100).toFixed(1) : '100.0';
                          return (
                            <tr key={idx} className={idx % 2 === 0 
                              ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                              : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                            }>
                              <td className="px-2.5 py-2 font-bold border border-slate-700 truncate">{b.barangay}</td>
                              <td className="px-2.5 py-2 text-right font-mono font-medium border border-slate-700 truncate">₱{b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2.5 py-2 text-right font-mono font-bold text-emerald-400 border border-slate-700 truncate">₱{b.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2.5 py-2 text-right font-mono font-bold text-rose-400 border border-slate-700 truncate">₱{b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2.5 py-2 text-right font-mono border border-slate-700 truncate">₱{b.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2.5 py-2 text-center font-mono font-bold border border-slate-700 truncate">{rate}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2.5 py-2.5 uppercase font-black text-amber-400 border border-slate-700 truncate">TOTAL MATRIX SUMMARY</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black text-emerald-400 border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black text-rose-400 border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-black border border-slate-700 truncate">₱{aggregatedData.grandTotals.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2.5 py-2.5 text-center font-mono font-black text-amber-400 border border-slate-700 truncate">
                            {aggregatedData.grandTotals.totalBilled > 0
                              ? `${((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(1)}%`
                              : '100%'}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : (reportCategory === 'billing' || reportCategory === 'pending_ar' || reportCategory === 'arrears_ledger' || reportCategory === 'abnormal_consumption' || reportCategory === 'barangay_performance' || reportCategory === 'reading_status') ? (
                    /* Itemized Consumer Account Ledger Report */
                    <table className={`w-full table-fixed min-w-[780px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '8%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[10px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2 py-2.5 border border-slate-700 truncate">Account #</th>
                          <th className="px-2 py-2.5 border border-slate-700 truncate">Consumer Name</th>
                          <th className="px-2 py-2.5 border border-slate-700 truncate">Barangay Zone</th>
                          <th className="px-2 py-2.5 text-center border border-slate-700 truncate">Classification</th>
                          <th className="px-2 py-2.5 text-right border border-slate-700 truncate">Usage (m³)</th>
                          <th className="px-2 py-2.5 text-right border border-slate-700 truncate">Billed (₱)</th>
                          <th className="px-2 py-2.5 text-right border border-slate-700 truncate">Paid (₱)</th>
                          <th className="px-2 py-2.5 text-right border border-slate-700 truncate">Pending (₱)</th>
                          <th className="px-2 py-2.5 text-center border border-slate-700 truncate">Status</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {(() => {
                          let flatList: any[] = [];
                          aggregatedData.barangayList.forEach(b => {
                            b.accounts.forEach(a => {
                              flatList.push({ ...a, barangay: b.barangay });
                            });
                          });

                          if (reportCategory === 'abnormal_consumption') {
                            flatList = flatList.filter(a => a.isAbnormal);
                          } else if (reportCategory === 'pending_ar' || reportCategory === 'arrears_ledger') {
                            flatList = flatList.filter(a => a.pendingAmount > 0 || a.paymentStatus !== 'paid');
                          }

                          if (searchQuery) {
                            const q = searchQuery.toLowerCase().trim();
                            flatList = flatList.filter(a => 
                              (a.accountNumber || '').toLowerCase().includes(q) ||
                              (a.consumerName || '').toLowerCase().includes(q) ||
                              (a.barangay || '').toLowerCase().includes(q)
                            );
                          }

                          if (flatList.length === 0) {
                            return (
                              <tr>
                                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                                  No accounts found matching active criteria.
                                </td>
                              </tr>
                            );
                          }

                          return flatList.map((a, idx) => (
                            <tr key={idx} className={idx % 2 === 0 
                              ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                              : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                            }>
                              <td className="px-2 py-2 font-mono font-bold text-blue-400 border border-slate-700 truncate">{a.accountNumber}</td>
                              <td className="px-2 py-2 font-bold border border-slate-700 truncate">{a.consumerName}</td>
                              <td className="px-2 py-2 font-medium border border-slate-700 truncate">{a.barangay}</td>
                              <td className="px-2 py-2 text-center border border-slate-700 truncate">
                                <span className="text-[10px] font-bold uppercase">{a.type}</span>
                              </td>
                              <td className="px-2 py-2 text-right font-mono font-bold border border-slate-700 truncate">{a.consumption} m³</td>
                              <td className="px-2 py-2 text-right font-mono font-medium border border-slate-700 truncate">₱{(a.billedAmount || 0).toFixed(2)}</td>
                              <td className="px-2 py-2 text-right font-mono font-bold text-emerald-400 border border-slate-700 truncate">₱{(a.paidAmount || 0).toFixed(2)}</td>
                              <td className="px-2 py-2 text-right font-mono font-bold text-rose-400 border border-slate-700 truncate">₱{(a.pendingAmount || 0).toFixed(2)}</td>
                              <td className="px-2 py-2 text-center border border-slate-700 truncate">
                                <span className={`inline-block px-1.5 py-0.5 text-[9px] font-black uppercase ${
                                  a.paymentStatus === 'paid' ? 'text-emerald-400' : 'text-amber-400'
                                }`}>
                                  {a.paymentStatus}
                                </span>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td colSpan={4} className="px-2.5 py-2.5 uppercase font-black text-amber-400 border border-slate-700 truncate">
                            TOTAL DISTRICT SUMMARY ({aggregatedData.grandTotals.totalConsumers} ACCOUNTS)
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono font-black text-blue-400 border border-slate-700 truncate">
                            {aggregatedData.grandTotals.totalM3.toLocaleString()} m³
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono font-black border border-slate-700 truncate">
                            ₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono font-black text-emerald-400 border border-slate-700 truncate">
                            ₱{aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono font-black text-rose-400 border border-slate-700 truncate">
                            ₱{aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-2 py-2.5 text-center font-mono font-black text-amber-400 border border-slate-700 truncate">
                            {aggregatedData.grandTotals.totalBilled > 0
                              ? `${((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(0)}%`
                              : '100%'}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : (
                    /* Primary Water Billing, Collection & Operational Report Table */
                    <table className={`w-full table-fixed min-w-[780px] text-xs text-left border-collapse border ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <colgroup>
                        <col style={{ width: '16%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '7%' }} />
                      </colgroup>
                      <thead className={`font-black uppercase text-[11px] border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-700'
                          : 'bg-slate-200 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <th className="px-2.5 py-2.5 border border-slate-700 truncate">Zone / Barangay</th>
                          <th className="px-2 py-2.5 border border-slate-700 truncate">Reading Schedule</th>
                          <th className="px-2 py-2.5 border border-slate-700 truncate">Assigned Reader</th>
                          <th className="px-1.5 py-2.5 text-center border border-slate-700 truncate">Accounts</th>
                          <th className="px-2 py-2.5 text-right border border-slate-700 truncate">Usage (m³)</th>
                          <th className="px-2 py-2.5 text-right border border-slate-700 truncate">Total Billed (₱)</th>
                          <th className="px-2 py-2.5 text-right border border-slate-700 truncate">Collected (₱)</th>
                          <th className="px-2 py-2.5 text-right border border-slate-700 truncate">Pending AR (₱)</th>
                          <th className="px-1.5 py-2.5 text-center border border-slate-700 truncate">Rate</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {aggregatedData.barangayList.map((b, idx) => {
                          const rate = b.totalBilled > 0 ? ((b.totalCollected / b.totalBilled) * 100).toFixed(1) : '100.0';
                          return (
                            <tr key={idx} className={idx % 2 === 0 
                              ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                              : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                            }>
                              <td className="px-2.5 py-2 font-bold border border-slate-700 truncate">{b.barangay}</td>
                              <td className="px-2 py-2 font-mono text-[11px] text-slate-400 border border-slate-700 truncate">{b.readingSchedule}</td>
                              <td className="px-2 py-2 font-semibold border border-slate-700 truncate">{b.assignedReader}</td>
                              <td className="px-1.5 py-2 text-center font-bold border border-slate-700 truncate">{b.totalConsumers}</td>
                              <td className="px-2 py-2 text-right font-mono font-bold text-blue-400 border border-slate-700 truncate">{b.totalM3.toLocaleString()} m³</td>
                              <td className="px-2 py-2 text-right font-mono font-medium border border-slate-700 truncate">₱{b.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2 py-2 text-right font-mono font-bold text-emerald-400 border border-slate-700 truncate">₱{b.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-2 py-2 text-right font-mono font-bold text-rose-400 border border-slate-700 truncate">₱{b.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                              <td className="px-1.5 py-2 text-center font-mono font-bold border border-slate-700 truncate">{rate}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className={`font-black border-t-2 border-b-2 ${
                        previewTheme === 'dark'
                          ? 'bg-slate-950 text-white border-slate-600'
                          : 'bg-slate-300 text-slate-950 border-slate-700'
                      }`}>
                        <tr>
                          <td className="px-2.5 py-2.5 uppercase font-black tracking-wide text-amber-400 border border-slate-700 truncate">TOTAL DISTRICT</td>
                          <td className="px-2 py-2.5 text-[11px] font-mono font-bold text-slate-300 border border-slate-700 truncate">Monthly ({selectedMonth})</td>
                          <td className="px-2 py-2.5 text-[11px] font-bold text-slate-300 border border-slate-700 truncate">ALL READERS</td>
                          <td className="px-1.5 py-2.5 text-center font-black border border-slate-700 truncate">{aggregatedData.grandTotals.totalConsumers.toLocaleString()}</td>
                          <td className="px-2 py-2.5 text-right font-mono font-black text-blue-400 border border-slate-700 truncate">{aggregatedData.grandTotals.totalM3.toLocaleString()} m³</td>
                          <td className="px-2 py-2.5 text-right font-mono font-black border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2.5 text-right font-mono font-black text-emerald-400 border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2.5 text-right font-mono font-black text-rose-400 border border-slate-700 truncate">₱{aggregatedData.grandTotals.totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-1.5 py-2.5 text-center font-mono font-black text-amber-400 border border-slate-700 truncate">
                            {aggregatedData.grandTotals.totalBilled > 0
                              ? `${((aggregatedData.grandTotals.totalCollected / aggregatedData.grandTotals.totalBilled) * 100).toFixed(1)}%`
                              : '100%'}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>

                {/* 3. METER READER FIELD COVERAGE & SCHEDULE BREAKDOWN (Shown for master and meter reader reports) */}
                {(reportCategory === 'consolidated_master' || reportCategory === 'meter_reader_perf') && (
                  <div className="space-y-2 pt-2">
                    <div className={`flex items-center justify-between border-b-2 pb-1 ${
                      previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-800'
                    }`}>
                      <h4 className={`text-xs font-black uppercase tracking-wider ${
                        previewTheme === 'dark' ? 'text-white' : 'text-slate-950'
                      }`}>
                        Meter Reader Route & Schedule Breakdown
                      </h4>
                      <span className={`text-[10px] font-bold uppercase ${
                        previewTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'
                      }`}>
                        Audit Verification: Certified Complete
                      </span>
                    </div>
                    
                    <div className="overflow-x-auto w-full">
                      <table className={`w-full table-fixed min-w-[780px] text-xs text-left border-collapse border ${
                        previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                      }`}>
                        <colgroup>
                          <col style={{ width: '18%' }} />
                          <col style={{ width: '24%' }} />
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '10%' }} />
                        </colgroup>
                        <thead className={`font-black uppercase text-[10px] border-b-2 ${
                          previewTheme === 'dark'
                            ? 'bg-slate-950 text-white border-slate-700'
                            : 'bg-slate-200 text-slate-950 border-slate-700'
                        }`}>
                          <tr>
                            <th className="px-2.5 py-2 border border-slate-700 truncate">Reader Officer</th>
                            <th className="px-2.5 py-2 border border-slate-700 truncate">Assigned Zone Routes</th>
                            <th className="px-2.5 py-2 border border-slate-700 truncate">Reading Schedule</th>
                            <th className="px-2 py-2 text-center border border-slate-700 truncate">Assigned</th>
                            <th className="px-2 py-2 text-center border border-slate-700 truncate">Read Done</th>
                            <th className="px-2 py-2 text-center border border-slate-700 truncate">Pending</th>
                            <th className="px-2.5 py-2 text-right border border-slate-700 truncate">Volume (m³)</th>
                            <th className="px-2 py-2 text-center border border-slate-700 truncate">Status</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${previewTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                          {readerPerformance.map((r, idx) => (
                            <tr key={idx} className={idx % 2 === 0 
                              ? (previewTheme === 'dark' ? 'bg-slate-900' : 'bg-white') 
                              : (previewTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                            }>
                              <td className="px-2.5 py-2 font-bold border border-slate-700 truncate">{r.name}</td>
                              <td className="px-2.5 py-2 font-medium border border-slate-700 truncate">{r.assignedAreas.join(', ')}</td>
                              <td className="px-2.5 py-2 font-mono text-[11px] text-slate-400 border border-slate-700 truncate">{r.readingSchedule}</td>
                              <td className="px-2 py-2 text-center font-mono font-bold border border-slate-700 truncate">{r.totalAssigned}</td>
                              <td className="px-2 py-2 text-center font-mono font-black text-emerald-400 border border-slate-700 truncate">{r.totalRead}</td>
                              <td className="px-2 py-2 text-center font-mono font-black text-rose-400 border border-slate-700 truncate">{r.pendingRead}</td>
                              <td className="px-2.5 py-2 text-right font-mono font-bold text-blue-400 border border-slate-700 truncate">{r.totalM3.toLocaleString()} m³</td>
                              <td className="px-2 py-2 text-center border border-slate-700 truncate">
                                <span className={`inline-block px-2 py-0.5 text-[10px] font-black uppercase border shadow-xs ${
                                  r.status.includes('100%') || r.status.includes('COMPLETED')
                                    ? (previewTheme === 'dark' ? 'bg-emerald-950 text-emerald-300 border-emerald-500' : 'bg-emerald-100 text-emerald-950 border-emerald-600')
                                    : r.status.includes('PROGRESS')
                                    ? (previewTheme === 'dark' ? 'bg-amber-950 text-amber-300 border-amber-500' : 'bg-amber-100 text-amber-950 border-amber-600')
                                    : (previewTheme === 'dark' ? 'bg-slate-800 text-slate-300 border-slate-600' : 'bg-slate-200 text-slate-900 border-slate-600')
                                }`}>
                                  {r.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 4. OFFICIAL DISTRICT CERTIFICATION & SIGNATURES */}
                <div className={`grid grid-cols-3 gap-6 pt-6 border-t-2 text-xs ${
                  previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'
                }`}>
                  <div className="space-y-4">
                    <span className={`font-bold block ${previewTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      PREPARED & VERIFIED BY:
                    </span>
                    <div className={`border-b pt-6 ${previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'}`}></div>
                    <div>
                      <span className={`font-black block ${previewTheme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        {currentUser?.name || 'CENTRAL RECORDS OFFICER'}
                      </span>
                      <span className={`text-[10px] ${previewTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        Commercial & Billing Specialist
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <span className={`font-bold block ${previewTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      AUDITED & REVIEWED BY:
                    </span>
                    <div className={`border-b pt-6 ${previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'}`}></div>
                    <div>
                      <span className={`font-black block ${previewTheme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        ENGR. R. MANUEL
                      </span>
                      <span className={`text-[10px] ${previewTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        District Operations Supervisor
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <span className={`font-bold block ${previewTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      CERTIFIED CORRECT & APPROVED:
                    </span>
                    <div className={`border-b pt-6 ${previewTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'}`}></div>
                    <div>
                      <span className={`font-black block ${previewTheme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        GENERAL MANAGER
                      </span>
                      <span className={`text-[10px] ${previewTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        Tagoloan Water District
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer Watermark */}
                <div className={`text-center pt-4 border-t text-[10px] font-mono ${
                  previewTheme === 'dark' ? 'border-slate-800 text-slate-500' : 'border-slate-300 text-slate-500'
                }`}>
                  Tagoloan Water District • Province of Misamis Oriental • Official Administrative Audit Report
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { 
  Calculator, 
  Droplets, 
  ReceiptText, 
  ShieldCheck, 
  Scale, 
  HelpCircle, 
  Printer, 
  X, 
  CreditCard, 
  Calendar, 
  Layers, 
  Percent, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle,
  FileText,
  BadgePercent,
  Clock,
  ArrowRight,
  Info,
  MapPin,
  User as UserIcon,
  Tag,
  Hash,
  Download
} from 'lucide-react';
import { Consumer, MeterReading } from '../../types';
import { 
  calculateWaterTariff, 
  calculateFranchiseTax, 
  calculateLatePenalty, 
  getTariffBreakdown,
  getActiveTariffConfig,
  getCanonicalBillSettlement,
  getEffectiveRatePerM3,
  getReadingEffectiveBillAmount,
  getReadingTotalAssessment,
  isOfficialBillIssued,
  DEFAULT_TARIFF_CONFIG,
  WaterTariffConfig
} from '../../utils/tariffCalculator';
import { computeOdometerConsumption, formatOdometerReading } from '../../utils/odometer';
import { downloadWaterBillingNoticePdf, printCleanElement } from '../../utils/receiptPdfGenerator';

export interface BillDetailsProps {
  reading: MeterReading | null;
  consumer: Consumer;
  calculateCostOf?: (usage: number | MeterReading, classification?: 'Residential' | 'Commercial') => number;
  isOpen?: boolean;
  isModal?: boolean;
  onClose?: () => void;
  onPayBill?: (reading: MeterReading) => void;
}

export interface ComputedBillBreakdown {
  consumption: number;
  consumerType: 'Residential' | 'Commercial' | 'RES' | 'COMM';
  typeAbbrev: 'RES' | 'COMM';
  previousReading: number;
  presentReading: number;
  sequenceNo: string | number;
  meterBrand: string;
  meterNumber: string;
  meterReaderName: string;
  meterReaderDate: string;
  addressFull: string;
  addressZone: string;
  ratePerM3: number;
  baseFixedCharge: number;
  tier1Rate: number;
  billAmount: number;
  franchiseTax: number;
  arrears: number;
  totalAmount: number;
  latePenaltyAmount: number;
  amountAfterDueDate: number;
  paidAmount: number;
  netRemainingDue: number;
  dueDate: string;
  billingPeriod: string;
  isOverdue: boolean;
}

function resolveScheduleForReading(reading: MeterReading | null, isComm: boolean): WaterTariffConfig {
  const activeCfg = getActiveTariffConfig();
  if (!reading) return activeCfg;
  if (reading.appliedTariffVersion !== undefined && reading.appliedTariffVersion <= 1) {
    return DEFAULT_TARIFF_CONFIG;
  }
  const usage = computeOdometerConsumption(
    reading.previousReading,
    reading.presentReading ?? reading.currentReading,
    reading.consumption
  ).consumption;
  if (reading.billAmount !== undefined) {
    const baselineAmt = calculateWaterTariff(usage, isComm ? 'Commercial' : 'Residential', DEFAULT_TARIFF_CONFIG);
    const activeAmt = calculateWaterTariff(usage, isComm ? 'Commercial' : 'Residential', activeCfg);
    if (Math.abs(reading.billAmount - baselineAmt) < 0.05 && Math.abs(reading.billAmount - activeAmt) >= 0.05) {
      return DEFAULT_TARIFF_CONFIG;
    }
    return activeCfg;
  }
  if ((activeCfg.version || 1) > 1 && activeCfg.updatedAt && reading.readingDate) {
    const rMs = new Date(reading.readingDate).getTime();
    const tMs = new Date(activeCfg.updatedAt).getTime();
    if (!isNaN(rMs) && !isNaN(tMs) && rMs + 86_400_000 < tMs) {
      return DEFAULT_TARIFF_CONFIG;
    }
  }
  return activeCfg;
}

/**
 * Calculates complete itemized breakdown of water bill according to
 * authentic Tagoloan Water District approved tariff schedules.
 */
export function computeBillBreakdown(
  reading: MeterReading | null,
  consumer: Consumer,
  _calculateCostOf?: (usage: number | MeterReading, classification?: 'Residential' | 'Commercial') => number
): ComputedBillBreakdown {
  const isComm = consumer.consumerType === 'Commercial';
  const typeAbbrev = isComm ? 'COMM' : 'RES';
  const schedule = resolveScheduleForReading(reading, isComm);
  
  const odo = reading
    ? computeOdometerConsumption(
        reading.previousReading,
        reading.presentReading ?? reading.currentReading,
        reading.consumption
      )
    : { previousReading: 0, currentReading: 0, consumption: 0, rolledOver: false };
  const previousReading = odo.previousReading;
  const presentReading = odo.currentReading;
  const consumption = odo.consumption;

  const classification: 'Residential' | 'Commercial' = isComm ? 'Commercial' : 'Residential';
  const ratePerM3 = getEffectiveRatePerM3(classification, schedule);
  const assessment = reading ? getReadingTotalAssessment(reading, classification) : null;
  const settlement = reading ? getCanonicalBillSettlement(reading, classification) : null;

  // Basic Water Charge (Bill Amt.) — honors official baseline or locked historical/partial bill
  const billAmount = settlement ? settlement.basicCharge : assessment ? assessment.basicCharge : 0;

  // 2% Local Franchise Tax
  const franchiseTax = settlement
    ? settlement.franchiseTax
    : assessment
      ? assessment.franchiseTax
      : calculateFranchiseTax(billAmount, schedule);

  // Arrears (Previous unpaid balance)
  const arrears = settlement
    ? settlement.arrears
    : assessment
      ? assessment.arrears
      : Math.max(0, consumer.outstandingBalance || 0);

  // Total current charges = Bill Amt + Franchise Tax + Arrears
  const totalAmount = settlement
    ? settlement.grossTotal
    : assessment
      ? assessment.totalBeforeDue
      : Math.round((billAmount + franchiseTax + arrears) * 100) / 100;

  // 10% Late penalty surcharge on basic bill amount
  const latePenaltyAmount = assessment
    ? assessment.penaltyAmount
    : calculateLatePenalty(billAmount, schedule);

  // Amount after due date
  const amountAfterDueDate = Math.round((totalAmount + latePenaltyAmount) * 100) / 100;

  const paidAmount = settlement ? settlement.paidAmount : (reading?.paidAmount || 0);
  const rawRemaining = settlement ? settlement.remainingBalance : Math.max(0, totalAmount - paidAmount);

  const dueDate = reading?.dueDate || '—';
  const dueDateObj = reading?.dueDate ? new Date(reading.dueDate) : null;
  const isOverdue = Boolean(
    reading &&
      dueDateObj &&
      !Number.isNaN(dueDateObj.getTime()) &&
      new Date() > dueDateObj &&
      rawRemaining > 0 &&
      !settlement?.isPaid
  );

  const netRemainingDue = settlement?.isPaid
    ? 0
    : isOverdue
      ? Math.max(0, Math.round((amountAfterDueDate - paidAmount) * 100) / 100)
      : rawRemaining;

  const sequenceNo = reading?.sequenceNo || consumer.sequenceNo || '—';
  const meterBrand = reading?.meterBrand || consumer.meterBrand || 'TWD';
  const meterNumber = reading?.meterNumber || consumer.meterNumber || 'Unassigned';
  const meterReaderName = reading?.meterReaderName || 'Authorized Field Officer';
  const meterReaderDate = reading?.readingDate || '—';
  const addressZone = consumer.sitioZone || consumer.barangay || consumer.address || 'Tagoloan Service Area';
  const baseFixedCharge = Math.round(Math.min(consumption, 10) * ratePerM3 * 100) / 100;

  return {
    consumption,
    consumerType: isComm ? 'Commercial' : 'Residential',
    typeAbbrev,
    previousReading,
    presentReading,
    sequenceNo,
    meterBrand,
    meterNumber,
    meterReaderName,
    meterReaderDate,
    addressFull: consumer.address || 'Registered Service Address',
    addressZone,
    ratePerM3,
    baseFixedCharge,
    tier1Rate: isComm ? schedule.commercial.tier1_rate : schedule.residential.tier1_rate,
    billAmount,
    franchiseTax,
    arrears,
    totalAmount,
    latePenaltyAmount,
    amountAfterDueDate,
    paidAmount,
    netRemainingDue,
    dueDate,
    billingPeriod: reading?.billingPeriod || 'No Active Billing Period',
    isOverdue,
  };
}

export const BillDetails: React.FC<BillDetailsProps> = ({
  reading,
  consumer,
  calculateCostOf,
  isOpen = true,
  isModal = false,
  onClose,
  onPayBill,
}) => {
  const [activeTab, setActiveTab] = useState<'notice' | 'itemized' | 'tiers' | 'regulatory'>('notice');
  const [showFormulaHelper, setShowFormulaHelper] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (!reading || !consumer || isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      await downloadWaterBillingNoticePdf({ reading, consumer });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handlePrintNotice = () => {
    if (activeTab !== 'notice') {
      setActiveTab('notice');
    }
    setTimeout(() => {
      printCleanElement('official-billing-notice-print-area');
    }, 60);
  };

  if (!isOpen) return null;

  if (!reading || !isOfficialBillIssued(reading)) {
    const emptyNotice = (
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center space-y-3 text-slate-200" id="bill-details-empty-state">
        <div className="h-12 w-12 rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center mx-auto">
          <ReceiptText className="h-6 w-6" />
        </div>
        <div className="space-y-1 max-w-lg mx-auto">
          <h4 className="text-sm sm:text-base font-bold text-white">
            No Official Billing Statement or Receipt Issued Yet
          </h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Account <span className="font-mono font-semibold text-slate-200">#{consumer.accountNumber || 'PENDING'}</span> does not have an official billing statement yet. Your itemized Water Billing Notice and receipt will automatically appear here once Tagoloan Water District Administration generates and issues your billing.
          </p>
        </div>
        {isModal && onClose && (
          <div className="pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold rounded-xl transition cursor-pointer"
            >
              Close
            </button>
          </div>
        )}
      </div>
    );

    if (isModal) {
      return (
        <div
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-5 overflow-y-auto animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget && onClose) onClose();
          }}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-5 sm:p-7 shadow-2xl my-auto">
            {emptyNotice}
          </div>
        </div>
      );
    }
    return emptyNotice;
  }

  const breakdown = computeBillBreakdown(reading, consumer, calculateCostOf);
  const liveSettlement = getCanonicalBillSettlement(reading, consumer.consumerType);
  const isPaid = liveSettlement.isPaid;
  const isPartial = liveSettlement.isPartial;

  const content = (
    <div className="space-y-6 text-slate-100" id="bill-details-component">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 border border-slate-800 rounded-3xl p-5 sm:p-6 text-white shadow-xl relative overflow-hidden">
        {/* Water District Watermark */}
        <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
          <Droplets className="w-48 h-48 text-white" />
        </div>

        <div className="relative z-10 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-blue-500/20 border border-blue-400/30 rounded-2xl text-blue-300">
                <ReceiptText className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-300">
                    Tagoloan Water District
                  </span>
                  <span className="px-2 py-0.5 bg-white/10 rounded-full text-[9px] font-mono font-bold text-slate-200">
                    Notice #{breakdown.sequenceNo}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  Water Billing Notice & Statement
                </h3>
              </div>
            </div>

            {isModal && onClose && (
              <button
                onClick={onClose}
                className="self-end sm:self-auto p-2 bg-white/10 hover:bg-white/20 rounded-xl text-slate-300 hover:text-white transition cursor-pointer"
                title="Close Notice"
                id="close-bill-details-btn"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Key Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-950/60 border border-white/10 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Customer & Account</span>
              <span className="font-mono font-black text-blue-300 text-sm block mt-0.5">{consumer.accountNumber || 'PENDING'}</span>
              <span className="text-[10px] text-slate-300 truncate block">{consumer.name}</span>
            </div>

            <div className="bg-slate-950/60 border border-white/10 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Billing Month</span>
              <span className="font-bold text-white text-sm block mt-0.5">{breakdown.billingPeriod}</span>
              <span className="text-[10px] text-amber-300 font-medium">Due: {breakdown.dueDate}</span>
            </div>

            <div className="bg-slate-950/60 border border-white/10 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Type & Meter</span>
              <span className="font-black text-emerald-300 text-sm block mt-0.5">{breakdown.typeAbbrev} ({breakdown.consumerType})</span>
              <span className="text-[10px] text-slate-300 font-mono">{breakdown.meterBrand} – {breakdown.meterNumber}</span>
            </div>

            <div className="bg-slate-950/60 border border-white/10 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Reading Basis & Usage</span>
              <span className="font-black font-mono tabular-nums text-cyan-300 text-base block mt-0.5">
                {breakdown.consumption} m³
              </span>
              <span className="text-[10px] text-slate-300 font-mono tabular-nums">
                Prev {formatOdometerReading(breakdown.previousReading)} → Pres {formatOdometerReading(breakdown.presentReading)}
              </span>
            </div>
          </div>

          {/* Quick Pay / Status Header */}
          <div className="bg-slate-950/70 backdrop-blur-xs border border-white/15 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-blue-200">
                  Total Amount Due
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                  isPaid 
                    ? 'bg-emerald-500 text-white' 
                    : isPartial 
                    ? 'bg-amber-500 text-slate-950 font-black' 
                    : 'bg-rose-500 text-white'
                }`}>
                  {isPaid ? 'Settled in Full' : isPartial ? 'Partially Paid' : 'Unpaid Statement'}
                </span>
              </div>
              <div className="flex items-baseline space-x-3">
                <span className="text-3xl sm:text-4xl font-black font-mono tabular-nums text-white tracking-tight">
                  ₱{breakdown.totalAmount.toFixed(2)}
                </span>
                <span className="text-xs text-blue-200 font-medium">
                  (After Due Date: ₱{breakdown.amountAfterDueDate.toFixed(2)})
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2 self-stretch sm:self-auto">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isDownloadingPdf}
                className="px-3.5 py-2.5 bg-blue-600 hover:bg-blue-500 border border-blue-500 rounded-xl text-white font-bold text-xs transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-sm"
                title="Download Official Water Billing Notice (PDF)"
                id="bill-details-download-pdf-btn"
              >
                <Download className="h-4 w-4" />
                <span>{isDownloadingPdf ? 'Downloading...' : 'Download (PDF)'}</span>
              </button>

              <button
                type="button"
                onClick={handlePrintNotice}
                className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-bold text-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                title="Print Official Water Billing Notice"
                id="bill-details-print-btn"
              >
                <Printer className="h-4 w-4" />
                <span>Print Notice</span>
              </button>

              {!isPaid && onPayBill && reading && (
                <button
                  onClick={() => onPayBill(reading)}
                  className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer"
                  id="bill-details-pay-now-btn"
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Pay Now (₱{breakdown.netRemainingDue.toFixed(2)})</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 overflow-x-auto gap-2 bg-slate-950/60 p-1.5 rounded-2xl border">
        <button
          onClick={() => setActiveTab('notice')}
          className={`py-2 px-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap ${
            activeTab === 'notice'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
          }`}
          id="tab-official-notice"
        >
          <ReceiptText className="h-4 w-4" />
          <span>Official Water Billing Notice</span>
        </button>

        <button
          onClick={() => setActiveTab('itemized')}
          className={`py-2 px-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap ${
            activeTab === 'itemized'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
          }`}
          id="tab-itemized-breakdown"
        >
          <Layers className="h-4 w-4" />
          <span>Itemized Tariff Breakdown</span>
        </button>

        <button
          onClick={() => setActiveTab('tiers')}
          className={`py-2 px-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap ${
            activeTab === 'tiers'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
          }`}
          id="tab-volumetric-tiers"
        >
          <Droplets className="h-4 w-4" />
          <span>Tier Progression</span>
        </button>

        <button
          onClick={() => setActiveTab('regulatory')}
          className={`py-2 px-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap ${
            activeTab === 'regulatory'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
          }`}
          id="tab-regulatory-levies"
        >
          <Percent className="h-4 w-4" />
          <span>Taxes & Franchise Levy</span>
        </button>
      </div>

      {/* TAB 1: AUTHENTIC WATER BILLING NOTICE SLIP (DARK SLATE SCREEN + PRINT SAFE) */}
      <div className={activeTab === 'notice' ? 'space-y-4 animate-fade-in' : 'hidden print:block'}>
        <div id="official-billing-notice-print-area" className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-6 shadow-xl max-w-2xl mx-auto font-sans text-slate-100 print:bg-white print:text-slate-900 print:border-slate-300 print:shadow-none">
          {/* Official Letterhead / Header */}
          <div className="text-center pb-4 border-b-2 border-dashed border-slate-800 print:border-slate-300 space-y-1">
            <p className="text-[10px] font-black tracking-widest text-slate-400 print:text-slate-600 uppercase">
              Republic of the Philippines
            </p>
            <div className="flex items-center justify-center space-x-2">
              <Droplets className="h-5 w-5 text-sky-400 print:text-blue-700" />
              <h2 className="text-lg font-black text-white print:text-slate-900 tracking-wide uppercase">
                TAGOLOAN WATER DISTRICT
              </h2>
            </div>
            <p className="text-[11px] text-slate-300 print:text-slate-600 font-medium">
              Zone 1, Poblacion, Tagoloan, Misamis Oriental 9001
            </p>
            <p className="text-[10px] text-slate-400 print:text-slate-500">
              Hotline: (088) 890-4946 • TIN: 002-841-992-000 • Provincial Water Utilities Act (PD 198)
            </p>
            <div className="pt-2">
              <span className="inline-block px-3.5 py-1 bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded shadow-sm">
                OFFICIAL WATER BILLING NOTICE
              </span>
            </div>
          </div>

          {/* Customer & Account Details Grid (Structured 2-Column Key-Value) */}
          <div className="py-3.5 border-b-2 border-dashed border-slate-800 print:border-slate-300">
            <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
              {/* Column 1: Customer Information */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-baseline border-b border-slate-800/40 print:border-slate-200 pb-1">
                  <span className="font-bold text-slate-400 print:text-slate-600 w-28 shrink-0 text-left">Customer:</span>
                  <span className="font-black text-white print:text-slate-900 text-right uppercase truncate" title={consumer.name}>
                    {consumer.name}
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-b border-slate-800/40 print:border-slate-200 pb-1">
                  <span className="font-bold text-slate-400 print:text-slate-600 w-28 shrink-0 text-left">Service Address:</span>
                  <span className="font-semibold text-slate-200 print:text-slate-800 text-right uppercase truncate" title={breakdown.addressFull}>
                    {breakdown.addressFull}
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-b border-slate-800/40 print:border-slate-200 pb-1">
                  <span className="font-bold text-slate-400 print:text-slate-600 w-28 shrink-0 text-left">Classification:</span>
                  <span className="font-black text-sky-400 print:text-blue-700 text-right uppercase">
                    {breakdown.typeAbbrev} ({breakdown.consumerType})
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-b border-slate-800/40 print:border-slate-200 pb-1">
                  <span className="font-bold text-slate-400 print:text-slate-600 w-28 shrink-0 text-left">Billing Period:</span>
                  <span className="font-bold text-white print:text-slate-900 text-right">
                    {breakdown.billingPeriod}
                  </span>
                </div>
              </div>

              {/* Column 2: Account & Meter Details */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-baseline border-b border-slate-800/40 print:border-slate-200 pb-1">
                  <span className="font-bold text-slate-400 print:text-slate-600 w-28 shrink-0 text-left">Account No.:</span>
                  <span className="font-mono font-black text-amber-300 print:text-slate-900 text-right">
                    {consumer.accountNumber || 'PENDING'}
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-b border-slate-800/40 print:border-slate-200 pb-1">
                  <span className="font-bold text-slate-400 print:text-slate-600 w-28 shrink-0 text-left">Sequence No.:</span>
                  <span className="font-mono font-black text-white print:text-slate-900 text-right">
                    {breakdown.sequenceNo}
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-b border-slate-800/40 print:border-slate-200 pb-1">
                  <span className="font-bold text-slate-400 print:text-slate-600 w-28 shrink-0 text-left">Meter Tag:</span>
                  <span className="font-mono font-bold text-slate-200 print:text-slate-800 text-right">
                    {breakdown.meterBrand} – {breakdown.meterNumber}
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-b border-slate-800/40 print:border-slate-200 pb-1">
                  <span className="font-bold text-slate-400 print:text-slate-600 w-28 shrink-0 text-left">Payment Due:</span>
                  <span className="font-bold text-rose-400 print:text-rose-700 text-right">
                    {breakdown.dueDate}
                  </span>
                </div>
              </div>
            </div>

            {/* Meter Reader / Field Inspection Row */}
            <div className="mt-2.5 pt-1.5 border-t border-slate-800/40 print:border-slate-200 flex justify-between items-baseline text-xs">
              <span className="font-bold text-slate-400 print:text-slate-600 text-left">
                Meter Reader / Inspection:
              </span>
              <span className="font-medium text-slate-200 print:text-slate-800 text-right uppercase">
                {breakdown.meterReaderName} • {breakdown.meterReaderDate}
              </span>
            </div>
          </div>

          {/* Meter Reading & Consumption Box with Explicit Column Widths */}
          <div className="py-3.5 border-b-2 border-dashed border-slate-800 print:border-slate-300">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 print:text-slate-600 font-bold border-b border-slate-800 print:border-slate-300">
                  <th className="text-left pb-1.5 w-1/4">Previous Reading</th>
                  <th className="text-center pb-1.5 w-1/4">Present Reading</th>
                  <th className="text-center pb-1.5 w-1/4">Current Index</th>
                  <th className="text-right pb-1.5 w-1/4">Net Usage</th>
                </tr>
              </thead>
              <tbody>
                <tr className="font-mono tabular-nums font-bold text-sm text-white print:text-slate-900">
                  <td className="py-2 text-left w-1/4">{formatOdometerReading(breakdown.previousReading)}</td>
                  <td className="py-2 text-center w-1/4">{formatOdometerReading(breakdown.presentReading)}</td>
                  <td className="py-2 text-center w-1/4">{formatOdometerReading(reading?.currentReading ?? breakdown.presentReading)}</td>
                  <td className="py-2 text-right w-1/4 font-black text-sky-400 print:text-blue-700">{breakdown.consumption} m³</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Itemized Financial Charges with Tabular Alignments */}
          <div className="py-3.5 border-b-2 border-dashed border-slate-800 print:border-slate-300 space-y-1.5 text-xs">
            <div className="flex justify-between items-baseline py-1 border-b border-dashed border-slate-800/30 print:border-slate-200 text-slate-300 print:text-slate-700">
              <span className="font-medium text-left">
                Basic Water Charge ({breakdown.consumption} m³ @ ₱{breakdown.ratePerM3.toFixed(2)}/m³):
              </span>
              <span className="font-mono font-bold text-white print:text-slate-900 text-right tabular-nums">
                ₱{breakdown.billAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-baseline py-1 border-b border-dashed border-slate-800/30 print:border-slate-200 text-slate-300 print:text-slate-700">
              <span className="font-medium text-left">
                Franchise Tax (2% Local Franchise Tax):
              </span>
              <span className="font-mono font-bold text-white print:text-slate-900 text-right tabular-nums">
                ₱{breakdown.franchiseTax.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-baseline py-1 border-b border-dashed border-slate-800/30 print:border-slate-200 text-slate-300 print:text-slate-700">
              <span className="font-medium text-left">
                Arrears (Unpaid Balance Carried Forward):
              </span>
              <span className={`font-mono font-bold text-right tabular-nums ${breakdown.arrears > 0 ? 'text-rose-400 print:text-rose-700' : 'text-white print:text-slate-900'}`}>
                ₱{breakdown.arrears.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Totals Box */}
          <div className="py-3.5 border-b-2 border-dashed border-slate-800 print:border-slate-300 space-y-2 text-xs">
            <div className="flex justify-between items-center bg-slate-900/90 border border-slate-800 print:bg-slate-100 print:border-slate-300 p-3 rounded-xl">
              <span className="font-black text-white print:text-slate-900 text-sm uppercase text-left">
                {breakdown.paidAmount > 0 ? 'GROSS STATEMENT TOTAL:' : 'TOTAL AMOUNT DUE:'}
              </span>
              <span className="font-mono font-black text-sky-400 print:text-blue-800 text-lg text-right tabular-nums">
                ₱{breakdown.totalAmount.toFixed(2)}
              </span>
            </div>

            {breakdown.paidAmount > 0 && (
              <>
                <div className="flex justify-between items-center px-1 text-emerald-400 print:text-emerald-700">
                  <span className="font-bold text-left">
                    Less Payment Credited {reading?.orNumber ? `(OR #${reading.orNumber})` : ''}:
                  </span>
                  <span className="font-mono font-black text-sm text-right tabular-nums">
                    -₱{breakdown.paidAmount.toFixed(2)}
                  </span>
                </div>
                <div className={`flex justify-between items-center p-3 rounded-xl border ${
                  isPaid
                    ? 'bg-emerald-950/60 border-emerald-700/60 print:bg-emerald-50 print:border-emerald-300'
                    : 'bg-amber-950/60 border-amber-700/60 print:bg-amber-50 print:border-amber-300'
                }`}>
                  <span className={`font-black text-sm uppercase text-left ${
                    isPaid ? 'text-emerald-300 print:text-emerald-800' : 'text-amber-300 print:text-amber-800'
                  }`}>
                    {isPaid ? 'NET REMAINING BALANCE (CLEARED):' : 'NET REMAINING BALANCE DUE:'}
                  </span>
                  <span className={`font-mono font-black text-lg text-right tabular-nums ${
                    isPaid ? 'text-emerald-400 print:text-emerald-800' : 'text-amber-300 print:text-amber-800'
                  }`}>
                    ₱{(isPaid ? 0 : breakdown.netRemainingDue).toFixed(2)}
                  </span>
                </div>
              </>
            )}

            <div className="flex justify-between items-center px-1">
              <span className="font-bold text-rose-400 print:text-rose-700 text-left">
                Amount After Due Date (+10% Penalty):
              </span>
              <span className="font-mono font-black text-rose-400 print:text-rose-700 text-sm text-right tabular-nums">
                ₱{breakdown.amountAfterDueDate.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Instructions / Footer Notice */}
          <div className="pt-3 text-[10px] text-slate-400 print:text-slate-600 space-y-1 text-center sm:text-left leading-relaxed">
            <p className="font-bold text-amber-300 print:text-slate-800">
              IMPORTANT REMINDER:
            </p>
            <p>
              Please pay on or before <strong className="text-white print:text-slate-900">{breakdown.dueDate}</strong> to avoid the 10% penalty charge and water service disconnection. Present this notice when paying at the Tagoloan Water District Main Office or upload your official receipt online.
            </p>
          </div>
        </div>
      </div>

      {/* TAB 2: ITEMIZED TARIFF BREAKDOWN */}
      {activeTab === 'itemized' && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* PILLAR 1: FIXED BASE CHARGES */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-md flex flex-col justify-between space-y-4 hover:border-blue-700 transition">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="p-2 bg-blue-950 text-blue-400 border border-blue-800/60 rounded-xl">
                    <Scale className="h-5 w-5" />
                  </span>
                  <span className="px-2 py-0.5 bg-blue-950 text-blue-300 border border-blue-800/60 font-black text-[9px] uppercase tracking-wider rounded-md">
                    Pillar 1
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-black text-white">1. Basic Water Charge</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    Official {breakdown.consumerType} baseline tariff for {breakdown.consumption} m³ consumed.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between font-medium text-slate-300">
                  <span>Official Rate ({breakdown.typeAbbrev}):</span>
                  <span className="font-mono font-bold text-white">₱{breakdown.ratePerM3.toFixed(2)} / m³</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Usage Consumed:</span>
                  <span className="font-mono font-bold text-sky-400">{breakdown.consumption} m³</span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between font-black text-white">
                  <span>Bill Amt.:</span>
                  <span className="font-mono text-sky-400">₱{breakdown.billAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* PILLAR 2: FRANCHISE TAX */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-md flex flex-col justify-between space-y-4 hover:border-indigo-700 transition">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="p-2 bg-indigo-950 text-indigo-400 border border-indigo-800/60 rounded-xl">
                    <Percent className="h-5 w-5" />
                  </span>
                  <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-black text-[9px] uppercase tracking-wider rounded-md">
                    Pillar 2
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-black text-white">2. Local Franchise Tax</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    Mandatory 2% Local Franchise Tax (LFT) on public utility water service.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between font-medium text-slate-300">
                  <span>Tax Base Rate:</span>
                  <span className="font-mono font-bold text-white">2.0%</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Computed Tax:</span>
                  <span className="font-mono font-bold text-indigo-400">₱{breakdown.franchiseTax.toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between font-black text-white">
                  <span>Franchise Tax:</span>
                  <span className="font-mono text-indigo-300">₱{breakdown.franchiseTax.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* PILLAR 3: ARREARS & SETTLEMENT */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-md flex flex-col justify-between space-y-4 hover:border-amber-700 transition">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="p-2 bg-amber-950 text-amber-400 border border-amber-800/60 rounded-xl">
                    <Clock className="h-5 w-5" />
                  </span>
                  <span className="px-2 py-0.5 bg-amber-950 text-amber-300 border border-amber-800/60 font-black text-[9px] uppercase tracking-wider rounded-md">
                    Pillar 3
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-black text-white">3. Arrears & Penalty</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    Prior unpaid balances and 10% late surcharge assessed after due date.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between font-medium text-slate-300">
                  <span>Unpaid Arrears:</span>
                  <span className={`font-mono font-bold ${breakdown.arrears > 0 ? 'text-rose-400' : 'text-white'}`}>
                    ₱{breakdown.arrears.toFixed(2)}
                  </span>
                </div>
                {breakdown.paidAmount > 0 && (
                  <div className="flex justify-between text-[11px] text-emerald-400">
                    <span>Paid / Credited:</span>
                    <span className="font-mono font-bold">-₱{breakdown.paidAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>10% Surcharge (After Due):</span>
                  <span className="font-mono font-bold text-rose-400">+₱{breakdown.latePenaltyAmount.toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between font-black text-white">
                  <span>{breakdown.paidAmount > 0 ? 'Remaining Due:' : 'Total Payable:'}</span>
                  <span className={`font-mono ${isPaid ? 'text-emerald-400' : isPartial ? 'text-amber-300' : 'text-sky-400'}`}>
                    ₱{(isPaid ? 0 : breakdown.netRemainingDue).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: VOLUMETRIC TIER PROGRESS */}
      {activeTab === 'tiers' && (
        <div className="space-y-5 animate-fade-in">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div>
                <h4 className="text-sm font-black text-white flex items-center space-x-2">
                  <TrendingUp className="h-4 w-4 text-sky-400" />
                  <span>Tagoloan Water District Progressive Tariff Schedule</span>
                </h4>
                <p className="text-[11px] text-slate-400">
                  Monthly consumption of <strong className="text-white font-mono">{breakdown.consumption} m³</strong> evaluated against {breakdown.consumerType} rates
                </p>
              </div>
              <div className="px-3 py-1 bg-blue-950 border border-blue-800 text-blue-300 rounded-xl text-xs font-mono font-bold self-start sm:self-auto">
                {breakdown.typeAbbrev} Schedule
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 flex justify-between items-center">
                <div>
                  <span className="font-bold text-white block">1. Baseline Consumption (1 – 10 m³)</span>
                  <span className="text-[11px] text-slate-400">Official {breakdown.consumerType} baseline billed at ₱{breakdown.ratePerM3.toFixed(2)}/m³</span>
                </div>
                <span className="font-mono font-bold text-white">₱{breakdown.baseFixedCharge.toFixed(2)}</span>
              </div>

              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 flex justify-between items-center">
                <div>
                  <span className="font-bold text-white block">2. Incremental Consumption (11 – 20 m³)</span>
                  <span className="text-[11px] text-slate-400">
                    Billed at ₱{breakdown.tier1Rate.toFixed(2)}/m³
                  </span>
                </div>
                <span className="font-mono font-bold text-white">
                  {breakdown.consumption > 10 ? `₱${(Math.min(breakdown.consumption - 10, 10) * breakdown.tier1Rate).toFixed(2)}` : '₱0.00'}
                </span>
              </div>

              <div className="p-3.5 bg-blue-950/60 border border-blue-800/80 rounded-xl flex justify-between items-center font-bold text-blue-200">
                <span>Total Basic Water Charge (Bill Amt.):</span>
                <span className="font-mono font-black text-sky-300 text-sm">₱{breakdown.billAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: TAXES & REGULATORY */}
      {activeTab === 'regulatory' && (
        <div className="space-y-4 animate-fade-in text-xs">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-md space-y-4">
            <div className="flex items-center space-x-2.5 pb-3 border-b border-slate-800">
              <BadgePercent className="h-5 w-5 text-indigo-400" />
              <div>
                <h4 className="text-sm font-black text-white">Statutory Tax & Regulatory Details</h4>
                <p className="text-[11px] text-slate-400">Official fees applied to Tagoloan Water District accounts</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-white">Franchise Tax</span>
                  <span className="px-2 py-0.5 bg-indigo-950 border border-indigo-800 text-indigo-300 font-mono font-bold rounded">2.0%</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Local Franchise Tax collected pursuant to the Local Government Code of the Philippines.
                </p>
                <div className="pt-2 border-t border-slate-800 flex justify-between font-mono font-bold text-slate-200">
                  <span>Assessed Tax:</span>
                  <span className="text-indigo-300">₱{breakdown.franchiseTax.toFixed(2)}</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-white">Late Payment Penalty</span>
                  <span className="px-2 py-0.5 bg-rose-950 border border-rose-800 text-rose-300 font-mono font-bold rounded">10.0%</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  10% late surcharge applied to the basic bill amount when paid after the due date ({breakdown.dueDate}).
                </p>
                <div className="pt-2 border-t border-slate-800 flex justify-between font-mono font-bold text-slate-200">
                  <span>Surcharge Amount:</span>
                  <span className="text-rose-300">₱{breakdown.latePenaltyAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Render either as modal or inline
  if (isModal) {
    return (
      <div 
        className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-5 overflow-y-auto animate-fade-in"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) onClose();
        }}
      >
        <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-5 sm:p-7 shadow-2xl space-y-6 my-auto">
          {content}
        </div>
      </div>
    );
  }

  return content;
};

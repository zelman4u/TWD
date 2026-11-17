import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  CreditCard, 
  ChevronDown, 
  ChevronUp, 
  Clock, 
  ShieldAlert, 
  Info, 
  ArrowRight,
  Zap,
  Minimize2,
  Maximize2,
  ReceiptText,
  Upload,
  AlertOctagon,
  FileWarning,
  Flame,
  X
} from 'lucide-react';
import { Consumer, MeterReading } from '../../types';
import { calculateLatePenalty, getReadingEffectiveBillAmount } from '../../utils/tariffCalculator';
import { formatOdometerReading } from '../../utils/odometer';
import { safeStorageGetItem, safeStorageSetStructured } from '../../services/storageSafe';

export const OVERDUE_BANNER_STORAGE_KEY = 'twd_live_v4_overdue_banner_state';

type OverdueBannerPersistedMode = 'minimized' | 'dismissed' | 'expanded';

function readOverdueBannerMap(): Record<string, OverdueBannerPersistedMode> {
  try {
    const raw = safeStorageGetItem(OVERDUE_BANNER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverdueBannerMode(bannerKey: string, mode: OverdueBannerPersistedMode): void {
  if (!bannerKey) return;
  const map = readOverdueBannerMap();
  map[bannerKey] = mode;
  safeStorageSetStructured(OVERDUE_BANNER_STORAGE_KEY, map);
}

export function markOverdueBannerDismissedForBill(accountOrEmail: string, billId: string): void {
  const owner = String(accountOrEmail || 'anon').replace(/^#/, '').trim().toUpperCase();
  const id = String(billId || '').trim();
  if (!id) return;
  writeOverdueBannerMode(`${owner}::${id}`, 'dismissed');
}

interface OverdueBillBannerProps {
  overdueBills: MeterReading[];
  consumerRecord: Consumer;
  onPayNow: (reading: MeterReading, mode?: 'full' | 'partial') => void;
  onViewBillDetails: (reading: MeterReading) => void;
  onUploadReceipt?: (reading: MeterReading) => void;
  calculateCostOf: (usageOrReading: number | MeterReading, classification?: 'Residential' | 'Commercial') => number;
  hasReadOverdueNotification?: boolean;
}

export const OverdueBillBanner: React.FC<OverdueBillBannerProps> = ({
  overdueBills,
  consumerRecord,
  onPayNow,
  onViewBillDetails,
  onUploadReceipt,
  calculateCostOf,
  hasReadOverdueNotification = false,
}) => {
  const primaryBillId = overdueBills?.[0]?.id || '';
  const ownerKey = String(consumerRecord?.accountNumber || consumerRecord?.email || 'anon')
    .replace(/^#/, '')
    .trim()
    .toUpperCase();
  const bannerStateKey = primaryBillId ? `${ownerKey}::${primaryBillId}` : '';

  const [isExpanded, setIsExpanded] = useState(false);
  const [bannerMode, setBannerMode] = useState<OverdueBannerPersistedMode | null>(() => {
    if (!bannerStateKey) return null;
    return readOverdueBannerMap()[bannerStateKey] || null;
  });

  useEffect(() => {
    if (!bannerStateKey) return;
    setBannerMode(readOverdueBannerMap()[bannerStateKey] || null);
  }, [bannerStateKey]);

  const handleSetMinimized = (minimized: boolean) => {
    const nextMode: OverdueBannerPersistedMode = minimized ? 'minimized' : 'expanded';
    setBannerMode(nextMode);
    writeOverdueBannerMode(bannerStateKey, nextMode);
  };

  const handleDismiss = () => {
    setBannerMode('dismissed');
    writeOverdueBannerMode(bannerStateKey, 'dismissed');
  };

  if (!overdueBills || overdueBills.length === 0) {
    return null;
  }

  // Stop re-popping once dismissed or once the consumer has already read the overdue notification
  if (bannerMode === 'dismissed' || (hasReadOverdueNotification && bannerMode !== 'expanded')) {
    return null;
  }

  const isMinimized = bannerMode === 'minimized';

  const primaryBill = overdueBills[0];
  const grossCost = calculateCostOf(primaryBill, consumerRecord.consumerType);
  const paidAmt = primaryBill.paidAmount || 0;
  const netDue = Math.max(0, grossCost - paidAmt);

  // Determine due date & days overdue
  let dueDateObj: Date;
  if (primaryBill.dueDate) {
    dueDateObj = new Date(primaryBill.dueDate);
  } else if (primaryBill.readingDate) {
    dueDateObj = new Date(primaryBill.readingDate);
    dueDateObj.setDate(dueDateObj.getDate() + 15);
  } else {
    dueDateObj = new Date('2026-06-20');
  }

  const now = new Date();
  const diffTime = Math.max(0, now.getTime() - dueDateObj.getTime());
  const daysOverdue = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  // Check if consumer has an active partial payment on primary bill or overdue list
  const hasPartialPayment = primaryBill.paymentStatus === 'partial' || (paidAmt > 0 && netDue > 0) ||
    overdueBills.some(b => b.paymentStatus === 'partial' || (b.paidAmount && b.paidAmount > 0));

  // Check 3-month disconnection notice criteria:
  // (a) 3 or more unpaid billing cycles OR (b) Overdue for 90+ days OR (c) flagged by system
  // When a consumer makes a partial payment, the critical disconnection notice HALTS!
  const isThreeMonthsOverdue = !hasPartialPayment && (daysOverdue >= 90 || overdueBills.length >= 3 || primaryBill.isDisconnectionNoticeIssued);
  
  // Standard Tagoloan Water District 10% Late Surcharge on Basic Water Charge
  const basicForPenalty = getReadingEffectiveBillAmount(
    primaryBill,
    consumerRecord.consumerType === 'Commercial' ? 'Commercial' : 'Residential'
  );
  const latePenalty = primaryBill.penaltyAmount !== undefined 
    ? primaryBill.penaltyAmount 
    : calculateLatePenalty(basicForPenalty);
  
  const totalPayableWithPenalty = netDue + latePenalty;
  const formattedDueDate = primaryBill.dueDate || dueDateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Calculate cutoff deadline (5 working days from now)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + 5);
  const formattedCutoff = cutoffDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  // If user minimized the banner, render a compact high-contrast bar
  if (isMinimized) {
    return (
      <div
        className={`rounded-2xl bg-slate-900 border px-4 py-3 text-slate-100 shadow-lg flex items-center justify-between gap-3 animate-fade-in ${
          isThreeMonthsOverdue ? 'border-rose-500/50' : 'border-amber-500/45'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`p-2 rounded-xl border shrink-0 ${
              isThreeMonthsOverdue
                ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}
          >
            {isThreeMonthsOverdue ? <AlertOctagon className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </div>
          <div className="min-w-0 truncate">
            <span className={`text-xs font-semibold mr-2 ${isThreeMonthsOverdue ? 'text-rose-400' : 'text-amber-300'}`}>
              {isThreeMonthsOverdue ? 'Final Disconnection Notice' : 'Overdue Statement'}
            </span>
            <span aria-hidden="true" className="text-slate-600 mr-2">·</span>
            <span className="text-sm font-semibold text-white tabular-nums">
              {primaryBill.billingPeriod} (₱{netDue.toFixed(2)}) — {daysOverdue} days past due
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onUploadReceipt && (
            <button
              onClick={() => onUploadReceipt(primaryBill)}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Upload Receipt</span>
            </button>
          )}
          <button
            onClick={() => onPayNow(primaryBill, 'full')}
            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
            id="overdue-minimized-pay-btn"
          >
            <CreditCard className="h-3.5 w-3.5" />
            <span>Pay ₱{netDue.toFixed(2)}</span>
          </button>
          <button
            onClick={() => handleSetMinimized(false)}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer shrink-0"
            title="Expand Overdue Details"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            onClick={handleDismiss}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer shrink-0"
            title="Dismiss Overdue Banner"
            aria-label="Dismiss Overdue Banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // 3-Month Disconnection Cutting Notice Layout
  if (isThreeMonthsOverdue) {
    return (
      <div
        className="bg-slate-900 border border-rose-500/45 rounded-2xl p-6 text-slate-100 shadow-xl space-y-5 animate-fade-in"
        id="disconnection-notice-banner"
      >
        {/* Eyebrow Metadata + Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-rose-500/15 text-rose-400 border border-rose-500/30 rounded-xl shrink-0">
              <AlertOctagon className="h-5 w-5" />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-semibold text-rose-400">Final Disconnection Notice</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-amber-300 font-medium tabular-nums">Unsettled 3+ Months ({daysOverdue} days)</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-400 tabular-nums">Reconnection Fee ₱300.00</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => handleSetMinimized(true)}
              className="text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-800 transition text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              title="Minimize alert to compact bar"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Minimize</span>
            </button>
            <button
              onClick={handleDismiss}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              title="Dismiss banner"
              aria-label="Dismiss banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Headline + Readable Body + CTAs */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white leading-snug">
                Water Service Disconnection Scheduled — ₱{netDue.toFixed(2)} Due
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                Cutoff on or before <strong className="text-rose-300">{formattedCutoff}</strong>
              </span>
            </div>

            <p className="text-sm text-slate-200 leading-[1.6] max-w-3xl">
              Account <strong className="font-mono tabular-nums text-white">{consumerRecord.accountNumber}</strong> ({consumerRecord.name}) has unsettled water statements spanning three consecutive billing cycles. Please settle your balance or upload your municipal cashier receipt before the cutoff date to avoid physical meter locking.
            </p>

            <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Flame className="h-3.5 w-3.5 shrink-0" />
                <span>What you can do right now</span>
              </div>
              <p className="text-[13px] text-slate-300 leading-relaxed">
                1. Already paid at the Tagoloan Water District Office? Upload a photo of your Official Receipt (OR) to clear this notice.
                <br />
                2. Pay online in full or settle at least 50% partial balance to defer service disconnection.
              </p>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-2.5 shrink-0">
            {onUploadReceipt && (
              <button
                onClick={() => onUploadReceipt(primaryBill)}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                id="disconnection-upload-receipt-btn"
              >
                <ReceiptText className="h-4 w-4 shrink-0" />
                <span>Paid at Office? Upload Receipt</span>
              </button>
            )}

            <button
              onClick={() => onPayNow(primaryBill, 'full')}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap tabular-nums"
              id="disconnection-pay-now-btn"
            >
              <CreditCard className="h-4 w-4 shrink-0" />
              <span>Settle Balance (₱{netDue.toFixed(2)})</span>
            </button>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Info className="h-3.5 w-3.5 text-amber-300 shrink-0" />
              <span>{isExpanded ? 'Hide Notice Breakdown' : 'View Arrears Breakdown'}</span>
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Collapsible Breakdown Panel */}
        {isExpanded && (
          <div className="pt-4 border-t border-slate-800 bg-slate-950/75 rounded-xl p-4 sm:p-5 space-y-4 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800 text-xs">
              <span className="font-semibold text-slate-200">
                Disconnection Order Breakdown
              </span>
              <span className="font-mono tabular-nums text-slate-400">
                Notice Ref #{primaryBill.sequenceNo || primaryBill.id}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-400 block">Unpaid Duration</span>
                <span className="text-base font-bold font-mono tabular-nums text-white mt-0.5 block">
                  {daysOverdue} Days
                </span>
                <span className="text-[11px] text-rose-400">3+ overdue cycles</span>
              </div>

              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-400 block">Base Tariff</span>
                <span className="text-base font-bold font-mono tabular-nums text-white mt-0.5 block">
                  ₱{grossCost.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-400">Cycle: {primaryBill.billingPeriod}</span>
              </div>

              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-400 block">10% Late Penalty</span>
                <span className="text-base font-bold font-mono tabular-nums text-amber-300 mt-0.5 block">
                  +₱{latePenalty.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-400">Standard surcharge</span>
              </div>

              <div className="bg-slate-900 p-3.5 rounded-xl border border-emerald-500/30">
                <span className="text-xs text-slate-400 block">Min. 50% to Defer</span>
                <span className="text-base font-bold font-mono tabular-nums text-emerald-400 mt-0.5 block">
                  ₱{(Math.round((netDue * 0.50) * 100) / 100).toFixed(2)}
                </span>
                <span className="text-[11px] text-emerald-300/80">Defers cutting order</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between pt-1 gap-3 text-xs">
              <span className="text-slate-400">
                TWD Operations Hotline: <strong className="text-slate-200">(088) 555-0145</strong> · Tagoloan Municipal Compound
              </span>
              <button
                onClick={() => onViewBillDetails(primaryBill)}
                className="font-semibold text-sky-400 hover:text-sky-300 hover:underline cursor-pointer whitespace-nowrap"
              >
                View Full Billing Statement →
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Standard Overdue Banner (< 3 months)
  return (
    <div
      className="bg-slate-900 border border-amber-500/45 rounded-2xl p-6 text-slate-100 shadow-xl space-y-5 animate-fade-in"
      id="overdue-bill-notification-banner"
    >
      {/* Eyebrow + Window Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-xl shrink-0">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-semibold text-amber-300">Overdue Water Tariff Notice</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-rose-400 font-medium tabular-nums">{daysOverdue} Days Past Due</span>
            {overdueBills.length > 1 && (
              <>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-slate-400 tabular-nums">+{overdueBills.length - 1} more unpaid cycle(s)</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => handleSetMinimized(true)}
            className="text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-800 transition text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            title="Minimize alert to compact bar"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Minimize</span>
          </button>
          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            title="Dismiss banner"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        <div className="lg:col-span-8 space-y-2.5">
          <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white leading-snug tabular-nums">
            {primaryBill.billingPeriod} Water Statement Overdue — ₱{netDue.toFixed(2)}
          </h3>

          <p className="text-sm text-slate-200 leading-[1.6] max-w-3xl">
            Your water statement for <strong>{primaryBill.billingPeriod}</strong> ({primaryBill.consumption} m³) was due on <strong>{formattedDueDate}</strong>. Upload a photo of your cashier receipt or settle online to clear this notice.
          </p>

          <div className="rounded-xl bg-slate-950/75 border border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
            <span>
              Account <strong className="font-mono tabular-nums text-white">{consumerRecord.accountNumber}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              Meter <strong className="font-mono tabular-nums text-white">{primaryBill.meterNumber}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              10% Surcharge <strong className="font-mono tabular-nums text-amber-300">+₱{latePenalty.toFixed(2)}</strong>
            </span>
          </div>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-2.5 shrink-0">
          {onUploadReceipt && (
            <button
              onClick={() => onUploadReceipt(primaryBill)}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap tabular-nums"
              id="overdue-banner-pay-now-btn"
            >
              <ReceiptText className="h-4 w-4 shrink-0" />
              <span>Upload Cashier Receipt (₱{netDue.toFixed(2)})</span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Info className="h-3.5 w-3.5 text-amber-300 shrink-0" />
            <span>{isExpanded ? 'Hide Breakdown' : 'View Surcharge Breakdown'}</span>
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Collapsible Breakdown Panel */}
      {isExpanded && (
        <div className="pt-4 border-t border-slate-800 bg-slate-950/75 rounded-xl p-4 sm:p-5 space-y-4 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800 text-xs">
            <span className="font-semibold text-slate-200">
              Overdue Bill &amp; Surcharge Breakdown
            </span>
            <span className="font-mono tabular-nums text-slate-400">
              Statement #{primaryBill.id}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-400 block">Billed Consumption</span>
              <span className="text-base font-bold font-mono tabular-nums text-white mt-0.5 block">
                {primaryBill.consumption} m³
              </span>
              <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                Dial {formatOdometerReading(primaryBill.previousReading)} → {formatOdometerReading(primaryBill.presentReading ?? primaryBill.currentReading)}
              </span>
            </div>

            <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-400 block">Base Water Tariff</span>
              <span className="text-base font-bold font-mono tabular-nums text-white mt-0.5 block">
                ₱{grossCost.toFixed(2)}
              </span>
              <span className="text-[11px] text-slate-400">
                {consumerRecord.consumerType} rate
              </span>
            </div>

            <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-400 block">10% Late Surcharge</span>
              <span className="text-base font-bold font-mono tabular-nums text-amber-300 mt-0.5 block">
                +₱{latePenalty.toFixed(2)}
              </span>
              <span className="text-[11px] text-slate-400">
                {daysOverdue} days overdue
              </span>
            </div>

            <div className="bg-slate-900 p-3.5 rounded-xl border border-emerald-500/30">
              <span className="text-xs text-slate-400 block">Net Settlement Due</span>
              <span className="text-base font-bold font-mono tabular-nums text-emerald-400 mt-0.5 block">
                ₱{netDue.toFixed(2)}
              </span>
              <span className="text-[11px] text-emerald-300/80">
                {paidAmt > 0 ? `₱${paidAmt.toFixed(2)} already credited` : 'Immediate clearance'}
              </span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-start gap-3">
            <Zap className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h5 className="text-xs font-semibold text-white">
                Tagoloan Water District Disconnection Policy
              </h5>
              <p className="text-[13px] text-slate-300 leading-relaxed">
                Accounts with unsettled water statements exceeding 2–3 consecutive months may be scheduled for service cutting. Settle online or upload your physical payment receipt to prevent disruption.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between pt-1 gap-3 text-xs">
            <span className="text-slate-400">
              Need assistance? Call TWD Hotline: <strong className="text-slate-200">(088) 555-0145</strong> (Mon–Fri 8AM–5PM)
            </span>
            <button
              onClick={() => onViewBillDetails(primaryBill)}
              className="font-semibold text-sky-400 hover:text-sky-300 hover:underline cursor-pointer whitespace-nowrap"
            >
              View Full Billing Statement →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OverdueBillBanner;


import React, { useState } from 'react';
import { 
  Calendar, 
  Clock, 
  AlertTriangle, 
  AlertCircle, 
  ShieldAlert, 
  CheckCircle2, 
  CreditCard, 
  Upload, 
  FileText, 
  ChevronRight, 
  Sparkles, 
  Flame, 
  ReceiptText, 
  AlertOctagon, 
  Timer,
  Info,
  ArrowRight
} from 'lucide-react';
import { Consumer, MeterReading } from '../../types';
import { calculateLatePenalty, getCanonicalBillSettlement, getReadingEffectiveBillAmount } from '../../utils/tariffCalculator';

interface DynamicDueAlertProps {
  consumerRecord: Consumer;
  readings: MeterReading[];
  overdueBills: MeterReading[];
  unpaidBills: MeterReading[];
  onPayNow: (reading: MeterReading, mode?: 'full' | 'partial') => void;
  onViewBillDetails: (reading: MeterReading) => void;
  onUploadReceipt: (reading: MeterReading | null) => void;
  calculateCostOf: (usageOrReading: number | MeterReading, classification?: 'Residential' | 'Commercial') => number;
}

export const DynamicDueAlert: React.FC<DynamicDueAlertProps> = ({
  consumerRecord,
  readings,
  overdueBills,
  unpaidBills,
  onPayNow,
  onViewBillDetails,
  onUploadReceipt,
  calculateCostOf,
}) => {
  const [showOverdueDetails, setShowOverdueDetails] = useState(false);

  // If the account has no verified readings or pending registration
  if (!readings || readings.length === 0) {
    return null;
  }

  // Identify current / latest active unsettled or verified reading
  const latestReading = unpaidBills && unpaidBills.length > 0 ? unpaidBills[0] : readings[0];
  const latestSt = getCanonicalBillSettlement(latestReading, consumerRecord.consumerType);
  const grossLatestCost = latestSt.grossTotal;
  const paidLatestAmt = latestSt.paidAmount;
  const netLatestDue = latestSt.remainingBalance;
  const isLatestPaid = latestSt.isPaid;

  // Calculate Due Date for Current/Latest Reading
  let currentDueDateObj: Date;
  if (latestReading.dueDate) {
    currentDueDateObj = new Date(latestReading.dueDate);
  } else if (latestReading.readingDate) {
    currentDueDateObj = new Date(latestReading.readingDate);
    currentDueDateObj.setDate(currentDueDateObj.getDate() + 15);
  } else {
    currentDueDateObj = new Date();
    currentDueDateObj.setDate(currentDueDateObj.getDate() + 10);
  }

  const now = new Date();
  const timeDiff = currentDueDateObj.getTime() - now.getTime();
  const remainingDays = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

  // Overdue calculations across all overdue bills
  const hasOverdue = overdueBills && overdueBills.length > 0;
  const overdueTotalNet = Math.round(
    overdueBills.reduce((sum, r) => {
      return sum + getCanonicalBillSettlement(r, consumerRecord.consumerType).remainingBalance;
    }, 0) * 100
  ) / 100;

  const totalPenalties = overdueBills.reduce((sum, r) => {
    const basicAmt = getReadingEffectiveBillAmount(
      r,
      consumerRecord.consumerType === 'Commercial' ? 'Commercial' : 'Residential'
    );
    const pen = r.penaltyAmount !== undefined ? r.penaltyAmount : calculateLatePenalty(basicAmt);
    return sum + pen;
  }, 0);

  const totalOverdueWithPenalty = overdueTotalNet + totalPenalties;

  // Check if consumer has an active partial payment
  const hasPartialGoodwill = (overdueBills && overdueBills.some(r => r.paymentStatus === 'partial' || (r.paidAmount && r.paidAmount > 0))) ||
    (latestSt.isPartial || (latestReading.paidAmount && latestReading.paidAmount > 0));

  // Check 3-month / 90-day critical disconnection criteria
  // When a consumer has made a partial payment, the critical disconnection warning HALTS!
  const isCriticalDisconnection = !hasPartialGoodwill && (overdueBills.length >= 3 || overdueBills.some(r => {
    let d = r.dueDate ? new Date(r.dueDate) : (r.readingDate ? new Date(r.readingDate) : new Date());
    const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 90 || r.isDisconnectionNoticeIssued;
  }));

  const formattedDueDate = currentDueDateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Calculate urgency styling tier
  let alertTier: 'critical_overdue' | 'partial_halt' | 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'all_settled';

  if (isCriticalDisconnection) {
    alertTier = 'critical_overdue';
  } else if (hasPartialGoodwill && (overdueTotalNet > 0 || netLatestDue > 0)) {
    alertTier = 'partial_halt';
  } else if (hasOverdue) {
    alertTier = 'overdue';
  } else if (!isLatestPaid && remainingDays <= 0) {
    alertTier = 'due_today';
  } else if (!isLatestPaid && remainingDays <= 5) {
    alertTier = 'due_soon';
  } else if (!isLatestPaid) {
    alertTier = 'upcoming';
  } else {
    alertTier = 'all_settled';
  }

  // 1. ALL BILLS SETTLED STATE
  if (alertTier === 'all_settled') {
    return (
      <div
        id="dynamic-due-alert-settled"
        className="bg-slate-900 border border-emerald-500/35 rounded-2xl p-6 text-slate-100 shadow-lg animate-fade-in"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-2.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-xl shrink-0 mt-0.5">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="font-semibold text-emerald-400">Good Standing</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="font-mono tabular-nums text-slate-400">
                  Account #{consumerRecord.accountNumber}
                </span>
              </div>
              <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white tabular-nums">
                All Water Bills Settled — ₱0.00 Outstanding
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                Current cycle ({latestReading.billingPeriod}) is fully paid. Your next monthly meter reading will generate your next billing statement.
              </p>
            </div>
          </div>

          <button
            onClick={() => onViewBillDetails(latestReading)}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 self-end sm:self-center"
          >
            <ReceiptText className="h-4 w-4 text-emerald-400" />
            <span>View Latest Receipt</span>
          </button>
        </div>
      </div>
    );
  }

  // 1b. PARTIAL PAYMENT ACKNOWLEDGED · DISCONNECTION HALTED STATE
  if (alertTier === 'partial_halt') {
    const activeTargetBill = overdueBills && overdueBills.length > 0 ? overdueBills[0] : latestReading;
    const activeSettlement = getCanonicalBillSettlement(activeTargetBill, consumerRecord.consumerType);
    const activeRemaining = overdueTotalNet > 0 ? overdueTotalNet : netLatestDue;
    const activePaid = activeSettlement.paidAmount || (consumerRecord.outstandingBalance ? Math.max(0, activeSettlement.grossTotal - activeRemaining) : 0);

    return (
      <div
        id="dynamic-due-alert-partial"
        className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 text-slate-100 shadow-lg animate-fade-in"
      >
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-semibold text-emerald-400">Partial Payment Credited · Disconnection Halted</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono tabular-nums text-slate-400">Account #{consumerRecord.accountNumber}</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-300">{activeTargetBill.billingPeriod}</span>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white tabular-nums">
                Remaining Balance: ₱{activeRemaining.toFixed(2)}
              </h3>
              <p className="text-sm text-slate-200 leading-[1.6]">
                Your partial payment of <strong className="font-mono tabular-nums text-emerald-400">₱{activePaid.toFixed(2)}</strong> was verified and recorded. Disconnection procedures are halted. You can settle the remaining balance at the municipal cashier or upload another receipt anytime.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="bg-slate-950/75 border border-slate-800 rounded-xl px-3.5 py-2.5">
                <span className="text-slate-400 text-xs block">Total Assessment</span>
                <span className="font-mono tabular-nums font-bold text-white text-sm">₱{activeSettlement.grossTotal.toFixed(2)}</span>
              </div>
              <div className="bg-slate-950/75 border border-slate-800 rounded-xl px-3.5 py-2.5">
                <span className="text-slate-400 text-xs block">Amount Credited</span>
                <span className="font-mono tabular-nums font-bold text-emerald-400 text-sm">₱{activePaid.toFixed(2)}</span>
              </div>
              <div className="bg-slate-950/75 border border-slate-800 rounded-xl px-3.5 py-2.5">
                <span className="text-slate-400 text-xs block">Net Remaining</span>
                <span className="font-mono tabular-nums font-bold text-amber-300 text-sm">₱{activeRemaining.toFixed(2)}</span>
              </div>
              <div className="bg-slate-950/75 border border-slate-800 rounded-xl px-3.5 py-2.5">
                <span className="text-slate-400 text-xs block">Target Statement</span>
                <span className="font-semibold text-slate-200 text-sm truncate block">{activeTargetBill.billingPeriod}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 w-full lg:w-auto">
            <button
              onClick={() => onUploadReceipt(activeTargetBill)}
              className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Upload className="h-4 w-4 shrink-0" />
              <span>Upload Additional OR Slip</span>
            </button>

            <button
              onClick={() => onViewBillDetails(activeTargetBill)}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <FileText className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>View Remaining Breakdown</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. CRITICAL DISCONNECTION NOTICE OR OVERDUE BALANCES STATE
  if (alertTier === 'critical_overdue' || alertTier === 'overdue') {
    const isCritical = alertTier === 'critical_overdue';
    return (
      <div
        id="dynamic-due-alert-overdue"
        className={`bg-slate-900 rounded-2xl p-6 text-slate-100 shadow-xl border animate-fade-in ${
          isCritical ? 'border-rose-500/50' : 'border-amber-500/45'
        }`}
      >
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className={`font-semibold inline-flex items-center gap-1.5 ${isCritical ? 'text-rose-400' : 'text-amber-300'}`}>
                {isCritical ? <AlertOctagon className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                <span>{isCritical ? 'Final Disconnection Notice' : 'Overdue Balance Notice'}</span>
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-300 tabular-nums">{overdueBills.length} Cycle(s) Past Due</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono tabular-nums text-slate-400">Account #{consumerRecord.accountNumber}</span>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white tabular-nums">
                Total Overdue Due: ₱{totalOverdueWithPenalty.toFixed(2)}
                <span className="text-xs font-normal text-slate-400 ml-2">
                  (includes 10% late surcharge ₱{totalPenalties.toFixed(2)})
                </span>
              </h3>
              <p className="text-sm text-slate-200 leading-[1.6]">
                {isCritical
                  ? 'Your water account has 3 or more unpaid billing cycles (or 90+ days overdue). Settle immediately or upload your cashier receipt to avoid physical line disconnection.'
                  : `Your water statement passed its due date (${formattedDueDate}). Standard 10% late surcharge applies. Please settle promptly to prevent service interruption.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {overdueBills.slice(0, 3).map((b, idx) => {
                const bNet = getCanonicalBillSettlement(b, consumerRecord.consumerType).remainingBalance;
                return (
                  <div
                    key={`overdue-pill-${b.id || idx}`}
                    className="text-xs bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-xl flex items-center gap-2"
                  >
                    <span className="font-semibold text-slate-300">{b.billingPeriod}</span>
                    <span className="font-mono tabular-nums font-bold text-white">₱{bNet.toFixed(2)}</span>
                    <span className="text-slate-400">({b.dueDate || 'Past Due'})</span>
                  </div>
                );
              })}
              {overdueBills.length > 3 && (
                <span className="text-xs text-amber-300 font-semibold">+{overdueBills.length - 3} more</span>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 w-full lg:w-auto">
            <button
              onClick={() => onUploadReceipt(overdueBills[0])}
              className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap tabular-nums"
              id="dynamic-alert-pay-overdue-btn"
            >
              <ReceiptText className="h-4 w-4 shrink-0" />
              <span>Upload Cashier Receipt (₱{totalOverdueWithPenalty.toFixed(2)})</span>
            </button>

            <div className="flex items-center gap-2 w-full">
              <button
                onClick={() => onUploadReceipt(overdueBills[0])}
                className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                id="dynamic-alert-upload-receipt-btn"
                title="Already paid at municipal hall? Upload OR"
              >
                <Upload className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                <span>Upload OR Photo</span>
              </button>

              <button
                onClick={() => onViewBillDetails(overdueBills[0])}
                className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                id="dynamic-alert-details-btn"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Details</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. CURRENT ACTIVE BILL COUNTDOWN & DUE ALERT STATE (DUE TODAY / DUE SOON / UPCOMING)
  const isDueToday = remainingDays <= 0;
  const isDueSoon = remainingDays > 0 && remainingDays <= 5;
  const urgencyPercent = Math.max(0, Math.min(100, Math.round(((15 - remainingDays) / 15) * 100)));

  return (
    <div
      id="dynamic-due-alert-current"
      className={`bg-slate-900 rounded-2xl p-6 text-slate-100 shadow-lg border animate-fade-in ${
        isDueToday
          ? 'border-rose-500/45'
          : isDueSoon
          ? 'border-amber-500/45'
          : 'border-sky-500/35'
      }`}
    >
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="space-y-3 max-w-3xl w-full">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span
              className={`font-semibold inline-flex items-center gap-1.5 ${
                isDueToday ? 'text-rose-400' : isDueSoon ? 'text-amber-300' : 'text-sky-400'
              }`}
            >
              <Timer className="h-3.5 w-3.5" />
              <span>
                {isDueToday
                  ? 'Due Today'
                  : remainingDays === 1
                  ? 'Due Tomorrow (1 Day Left)'
                  : `${remainingDays} Days Remaining`}
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-300">{latestReading.billingPeriod}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono tabular-nums text-slate-400">Due {formattedDueDate}</span>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white tabular-nums">
              {latestSt.isPartial
                ? `Remaining Balance Due: ₱${netLatestDue.toFixed(2)}`
                : `Current Water Statement Due: ₱${netLatestDue.toFixed(2)}`}
              {latestSt.isPartial && (
                <span className="text-xs font-normal text-emerald-400 ml-2">
                  (Paid ₱{paidLatestAmt.toFixed(2)} of ₱{grossLatestCost.toFixed(2)})
                </span>
              )}
            </h3>
            <p className="text-sm text-slate-200 leading-[1.6]">
              {latestSt.isPartial
                ? `Your partial payment of ₱${paidLatestAmt.toFixed(2)} for ${latestReading.billingPeriod} (${latestReading.consumption} m³) has been credited against your ₱${grossLatestCost.toFixed(2)} statement. Remaining balance of ₱${netLatestDue.toFixed(2)} is due on ${formattedDueDate}.`
                : isDueToday
                ? `Today (${formattedDueDate}) is the final payment cutoff for your ${latestReading.billingPeriod} consumption (${latestReading.consumption} m³). Pay online or upload your cashier receipt to avoid the 10% late surcharge.`
                : isDueSoon
                ? `Your water bill of ₱${netLatestDue.toFixed(2)} for ${latestReading.billingPeriod} is due in ${remainingDays} days on ${formattedDueDate}. Settle promptly to keep your service in good standing.`
                : `Your water bill of ₱${netLatestDue.toFixed(2)} for ${latestReading.billingPeriod} (${latestReading.consumption} m³) has been issued. Payment is due on ${formattedDueDate}.`}
            </p>
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>Reading: <span className="font-mono tabular-nums text-slate-300">{latestReading.readingDate}</span></span>
              <span className={`font-mono tabular-nums font-medium ${isDueToday ? 'text-rose-400' : isDueSoon ? 'text-amber-300' : 'text-sky-300'}`}>
                {isDueToday ? 'Cutoff reached' : `${remainingDays} days before due date`}
              </span>
              <span>Due: <span className="font-mono tabular-nums text-slate-300">{formattedDueDate}</span></span>
            </div>
            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-500 ${
                  isDueToday ? 'bg-rose-500' : isDueSoon ? 'bg-amber-400' : 'bg-sky-400'
                }`}
                style={{ width: `${urgencyPercent}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 w-full lg:w-auto">
          <button
            onClick={() => onUploadReceipt(latestReading)}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap tabular-nums"
            id="dynamic-alert-pay-current-btn"
          >
            <ReceiptText className="h-4 w-4 shrink-0" />
            <span>Validate Receipt (₱{netLatestDue.toFixed(2)})</span>
          </button>

          <div className="flex items-center gap-2 w-full">
            <button
              onClick={() => onUploadReceipt(latestReading)}
              className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              id="dynamic-alert-upload-receipt-btn"
              title="Upload physical receipt from municipal office"
            >
              <Upload className="h-3.5 w-3.5 text-amber-300 shrink-0" />
              <span>Upload Photo</span>
            </button>

            <button
              onClick={() => onViewBillDetails(latestReading)}
              className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              id="dynamic-alert-view-breakdown-btn"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Breakdown</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

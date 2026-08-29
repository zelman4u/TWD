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

interface DynamicDueAlertProps {
  consumerRecord: Consumer;
  readings: MeterReading[];
  overdueBills: MeterReading[];
  unpaidBills: MeterReading[];
  onPayNow: (reading: MeterReading, mode?: 'full' | 'partial') => void;
  onViewBillDetails: (reading: MeterReading) => void;
  onUploadReceipt: (reading: MeterReading | null) => void;
  calculateCostOf: (usage: number, classification?: 'Residential' | 'Commercial') => number;
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

  // Identify current / latest verified reading
  const latestReading = readings[0];
  const grossLatestCost = calculateCostOf(latestReading.consumption, consumerRecord.consumerType);
  const paidLatestAmt = latestReading.paidAmount || 0;
  const netLatestDue = latestReading.remainingBalance !== undefined 
    ? latestReading.remainingBalance 
    : Math.max(0, grossLatestCost - paidLatestAmt);
  const isLatestPaid = latestReading.paymentStatus === 'paid' || netLatestDue <= 0;

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
  const overdueTotalNet = overdueBills.reduce((sum, r) => {
    const gross = calculateCostOf(r.consumption, consumerRecord.consumerType);
    const paid = r.paidAmount || 0;
    const net = r.remainingBalance !== undefined ? r.remainingBalance : Math.max(0, gross - paid);
    return sum + net;
  }, 0);

  const totalPenalties = overdueBills.reduce((sum, r) => {
    const gross = calculateCostOf(r.consumption, consumerRecord.consumerType);
    const paid = r.paidAmount || 0;
    const net = r.remainingBalance !== undefined ? r.remainingBalance : Math.max(0, gross - paid);
    const pen = r.penaltyAmount !== undefined ? r.penaltyAmount : Math.round(net * 0.10 * 100) / 100;
    return sum + pen;
  }, 0);

  const totalOverdueWithPenalty = overdueTotalNet + totalPenalties;

  // Check 3-month / 90-day critical disconnection criteria
  const isCriticalDisconnection = overdueBills.length >= 3 || overdueBills.some(r => {
    let d = r.dueDate ? new Date(r.dueDate) : (r.readingDate ? new Date(r.readingDate) : new Date());
    const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 90 || r.isDisconnectionNoticeIssued;
  });

  const formattedDueDate = currentDueDateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Calculate urgency styling tier
  let alertTier: 'critical_overdue' | 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'all_settled';

  if (isCriticalDisconnection) {
    alertTier = 'critical_overdue';
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
        className="bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 rounded-3xl p-5 sm:p-6 text-white shadow-xl border border-emerald-500/30 relative overflow-hidden animate-fade-in"
      >
        <div className="absolute top-0 right-0 h-40 w-40 bg-white/5 rounded-full blur-2xl transform translate-x-10 -translate-y-10 pointer-events-none"></div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-start sm:items-center space-x-4">
            <div className="p-3 bg-white/20 backdrop-blur-md rounded-2xl shrink-0 shadow-inner">
              <CheckCircle2 className="h-6 w-6 text-emerald-200" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 bg-white/20 text-emerald-100 font-black text-[10px] uppercase tracking-wider rounded-lg border border-white/20">
                  Account Status: Good Standing
                </span>
                <span className="text-[11px] font-mono text-emerald-200">
                  Account #{consumerRecord.accountNumber}
                </span>
              </div>
              <h3 className="text-lg sm:text-xl font-black tracking-tight text-white">
                All Water Bills Settled in Full — ₱0.00 Outstanding
              </h3>
              <p className="text-xs text-emerald-100/90 leading-relaxed mt-0.5">
                Current cycle ({latestReading.billingPeriod}) is fully paid. No active overdue balances. Your next monthly reading will automatically generate your next billing statement.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
            <button
              onClick={() => onViewBillDetails(latestReading)}
              className="px-4 py-2.5 bg-white/15 hover:bg-white/25 border border-white/20 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
            >
              <ReceiptText className="h-4 w-4 text-emerald-200" />
              <span>View Latest Receipt</span>
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
        className={`rounded-3xl p-5 sm:p-6 text-white shadow-2xl relative overflow-hidden border-2 animate-fade-in ${
          isCritical 
            ? 'bg-gradient-to-r from-red-950 via-rose-900 to-red-900 border-red-500 ring-4 ring-red-600/20' 
            : 'bg-gradient-to-r from-rose-900 via-rose-850 to-amber-950 border-rose-500 ring-4 ring-rose-500/15'
        }`}
      >
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          
          {/* Main Info Block */}
          <div className="space-y-2.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-0.5 font-black text-[10px] uppercase tracking-wider rounded-lg flex items-center space-x-1 shadow-xs ${
                isCritical ? 'bg-red-600 text-white animate-pulse' : 'bg-rose-600 text-white'
              }`}>
                {isCritical ? <AlertOctagon className="h-3.5 w-3.5 mr-1" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
                <span>{isCritical ? 'CRITICAL DISCONNECTION NOTICE' : 'OVERDUE BALANCE DETECTED'}</span>
              </span>

              <span className="px-2.5 py-0.5 bg-black/40 text-amber-300 border border-amber-400/40 font-mono font-bold text-[10px] uppercase tracking-wider rounded-lg">
                {overdueBills.length} Cycle(s) Past Due
              </span>

              <span className="px-2.5 py-0.5 bg-white/10 text-white font-bold text-[10px] uppercase tracking-wider rounded-lg">
                Account #{consumerRecord.accountNumber}
              </span>
            </div>

            <div className="space-y-1">
              <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white flex flex-wrap items-center gap-2">
                <span>Account Flagged: Total Overdue ₱{totalOverdueWithPenalty.toFixed(2)}</span>
                <span className="text-xs font-medium text-rose-200 bg-black/30 px-2 py-0.5 rounded-md">
                  (Includes 10% Late Surcharge: ₱{totalPenalties.toFixed(2)})
                </span>
              </h3>
              <p className="text-xs sm:text-sm text-rose-100/90 leading-relaxed">
                {isCritical 
                  ? 'Your water account has 3 or more unpaid billing cycles (or 90+ days overdue). Immediate settlement or official receipt presentation is required to avoid physical service line disconnection.' 
                  : `Your water tariff bill is past its due date (${formattedDueDate}). Standard 10% late surcharge applies. Settle immediately to prevent service interruption.`}
              </p>
            </div>

            {/* Overdue Statements Summary Pill List */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {overdueBills.slice(0, 3).map((b, idx) => {
                const bGross = calculateCostOf(b.consumption, consumerRecord.consumerType);
                const bPaid = b.paidAmount || 0;
                const bNet = b.remainingBalance !== undefined ? b.remainingBalance : Math.max(0, bGross - bPaid);
                return (
                  <div key={`overdue-pill-${b.id || idx}`} className="text-[11px] bg-black/30 border border-white/15 px-3 py-1 rounded-xl flex items-center space-x-2">
                    <span className="font-bold text-amber-300">{b.billingPeriod}:</span>
                    <span className="font-mono font-black text-white">₱{bNet.toFixed(2)}</span>
                    <span className="text-[9px] text-rose-300 uppercase font-semibold">({b.dueDate || 'Past Due'})</span>
                  </div>
                );
              })}
              {overdueBills.length > 3 && (
                <span className="text-[11px] text-amber-200 font-bold">+{overdueBills.length - 3} more statements</span>
              )}
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 w-full lg:w-auto">
            <button
              onClick={() => onUploadReceipt(overdueBills[0])}
              className="px-6 py-3.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-2xl shadow-xl hover:shadow-2xl transition flex items-center justify-center space-x-2 cursor-pointer transform active:scale-98"
              id="dynamic-alert-pay-overdue-btn"
            >
              <ReceiptText className="h-4 w-4" />
              <span>Settle Overdue via Cashier Receipt (₱{totalOverdueWithPenalty.toFixed(2)})</span>
            </button>

            <div className="flex items-center gap-2 w-full">
              <button
                onClick={() => onUploadReceipt(overdueBills[0])}
                className="flex-1 px-4 py-2.5 bg-white/15 hover:bg-white/25 border border-white/20 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-1.5 cursor-pointer"
                id="dynamic-alert-upload-receipt-btn"
                title="Already paid at municipal hall? Upload OR"
              >
                <Upload className="h-3.5 w-3.5 text-amber-300" />
                <span>Upload OR Photo</span>
              </button>

              <button
                onClick={() => onViewBillDetails(overdueBills[0])}
                className="px-3 py-2.5 bg-black/30 hover:bg-black/40 border border-white/15 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-1 cursor-pointer"
                id="dynamic-alert-details-btn"
              >
                <FileText className="h-3.5 w-3.5" />
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
      className={`rounded-3xl p-5 sm:p-6 text-white shadow-xl relative overflow-hidden border-2 animate-fade-in ${
        isDueToday 
          ? 'bg-gradient-to-r from-rose-700 via-rose-650 to-orange-650 border-rose-400 ring-4 ring-rose-500/20' 
          : isDueSoon 
          ? 'bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 border-amber-300 ring-4 ring-amber-500/20'
          : 'bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-850 border-blue-400/40 ring-4 ring-blue-500/10'
      }`}
    >
      <div className="absolute top-0 right-0 h-48 w-48 bg-white/5 rounded-full blur-2xl transform translate-x-10 -translate-y-10 pointer-events-none"></div>

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
        
        {/* Left Info & Remaining Days Badge */}
        <div className="space-y-3 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Dynamic Days Remaining Badge */}
            <span className={`px-3 py-1 font-black text-xs uppercase tracking-wider rounded-xl flex items-center space-x-1.5 shadow-md ${
              isDueToday 
                ? 'bg-red-600 text-white animate-pulse' 
                : isDueSoon 
                ? 'bg-amber-950 text-amber-300 border border-amber-300' 
                : 'bg-white/20 text-white border border-white/20'
            }`}>
              <Timer className="h-4 w-4" />
              <span>
                {isDueToday 
                  ? '🚨 DUE TODAY' 
                  : remainingDays === 1 
                  ? '⚠️ DUE TOMORROW (1 DAY LEFT)' 
                  : `🗓️ ${remainingDays} DAYS REMAINING`}
              </span>
            </span>

            <span className="px-2.5 py-0.5 bg-black/25 text-white font-mono text-[11px] font-bold rounded-lg border border-white/10">
              Period: {latestReading.billingPeriod}
            </span>

            <span className="px-2.5 py-0.5 bg-white/10 text-white font-bold text-[10px] uppercase tracking-wider rounded-lg">
              Due Date: {formattedDueDate}
            </span>
          </div>

          <div>
            <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white flex flex-wrap items-center gap-2">
              <span>Water Tariff Statement Due: ₱{netLatestDue.toFixed(2)}</span>
              {latestReading.paymentStatus === 'partial' && (
                <span className="text-[10px] font-bold bg-amber-300 text-slate-900 px-2.5 py-0.5 rounded-full uppercase">
                  Partial Balance
                </span>
              )}
            </h3>
            <p className="text-xs sm:text-sm text-white/90 leading-relaxed mt-1">
              {isDueToday
                ? `Today (${formattedDueDate}) is the final payment cutoff for your ${latestReading.billingPeriod} consumption (${latestReading.consumption} m³). Pay now online or upload your municipal cashier receipt to avoid the 10% late surcharge.`
                : isDueSoon
                ? `Your water bill of ₱${netLatestDue.toFixed(2)} for ${latestReading.billingPeriod} is due in ${remainingDays} days on ${formattedDueDate}. Settle promptly to maintain uninterrupted district water supply.`
                : `Your water bill of ₱${netLatestDue.toFixed(2)} for ${latestReading.billingPeriod} (${latestReading.consumption} m³) has been officially issued. Payment is due on ${formattedDueDate} (${remainingDays} days remaining).`}
            </p>
          </div>

          {/* Timeline progress indicator */}
          <div className="space-y-1 pt-1">
            <div className="flex justify-between items-center text-[10px] text-white/80 font-bold uppercase tracking-wider">
              <span>Reading Date: {latestReading.readingDate}</span>
              <span className="font-mono text-amber-200">
                {isDueToday ? 'Cutoff Reached' : `${remainingDays} days before due cutoff`}
              </span>
              <span>Due: {formattedDueDate}</span>
            </div>
            <div className="w-full h-2 bg-black/30 rounded-full overflow-hidden border border-white/10">
              <div 
                className={`h-full transition-all duration-500 ${
                  isDueToday ? 'bg-red-400' : isDueSoon ? 'bg-amber-300' : 'bg-sky-300'
                }`}
                style={{ width: `${urgencyPercent}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 w-full lg:w-auto">
          <button
            onClick={() => onUploadReceipt(latestReading)}
            className={`px-6 py-3.5 font-black text-xs uppercase tracking-wider rounded-2xl shadow-xl transition flex items-center justify-center space-x-2 cursor-pointer transform active:scale-98 ${
              isDueToday || isDueSoon 
                ? 'bg-white hover:bg-slate-50 text-slate-950 shadow-white/20' 
                : 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-400/20'
            }`}
            id="dynamic-alert-pay-current-btn"
          >
            <ReceiptText className="h-4 w-4 text-blue-700" />
            <span>Validate Cashier Receipt (₱{netLatestDue.toFixed(2)})</span>
          </button>

          <div className="flex items-center gap-2 w-full">
            <button
              onClick={() => onUploadReceipt(latestReading)}
              className="flex-1 px-4 py-2.5 bg-white/15 hover:bg-white/25 border border-white/20 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-1.5 cursor-pointer"
              id="dynamic-alert-upload-receipt-btn"
              title="Upload physical receipt from municipal office"
            >
              <Upload className="h-3.5 w-3.5 text-amber-300" />
              <span>Upload Photo</span>
            </button>

            <button
              onClick={() => onViewBillDetails(latestReading)}
              className="px-3 py-2.5 bg-black/30 hover:bg-black/40 border border-white/15 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-1 cursor-pointer"
              id="dynamic-alert-view-breakdown-btn"
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Breakdown</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

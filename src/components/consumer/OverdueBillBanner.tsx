import React, { useState } from 'react';
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
  Maximize2
} from 'lucide-react';
import { Consumer, MeterReading } from '../../types';

interface OverdueBillBannerProps {
  overdueBills: MeterReading[];
  consumerRecord: Consumer;
  onPayNow: (reading: MeterReading, mode?: 'full' | 'partial') => void;
  onViewBillDetails: (reading: MeterReading) => void;
  calculateCostOf: (usage: number, classification?: 'Residential' | 'Commercial') => number;
}

export const OverdueBillBanner: React.FC<OverdueBillBannerProps> = ({
  overdueBills,
  consumerRecord,
  onPayNow,
  onViewBillDetails,
  calculateCostOf,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  if (!overdueBills || overdueBills.length === 0) {
    return null;
  }

  const primaryBill = overdueBills[0];
  const grossCost = calculateCostOf(primaryBill.consumption, consumerRecord.consumerType);
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
  
  // Standard Tagoloan Water District 10% Late Surcharge
  const latePenalty = primaryBill.penaltyAmount !== undefined 
    ? primaryBill.penaltyAmount 
    : Math.round(netDue * 0.10 * 100) / 100;
  
  const totalPayableWithPenalty = netDue + latePenalty;
  const formattedDueDate = primaryBill.dueDate || dueDateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // If user minimized the banner, render a high-visibility compact sticky bar
  if (isMinimized) {
    return (
      <div className="bg-rose-900 border-2 border-rose-500 rounded-2xl p-3 text-white shadow-lg flex items-center justify-between gap-3 animate-fade-in">
        <div className="flex items-center space-x-3 min-w-0">
          <span className="p-1.5 bg-rose-600 rounded-xl shrink-0 animate-pulse">
            <AlertTriangle className="h-4 w-4 text-white" />
          </span>
          <div className="truncate text-xs">
            <span className="font-black text-rose-200 uppercase tracking-wider text-[10px] mr-2">
              Overdue Alert:
            </span>
            <span className="font-bold text-white">
              {primaryBill.billingPeriod} Statement (₱{netDue.toFixed(2)}) is {daysOverdue} days past due!
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => onPayNow(primaryBill, 'full')}
            className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
            id="overdue-minimized-pay-btn"
          >
            <CreditCard className="h-3.5 w-3.5" />
            <span>Pay ₱{netDue.toFixed(2)}</span>
          </button>
          <button
            onClick={() => setIsMinimized(false)}
            className="p-1.5 hover:bg-rose-800 rounded-lg text-rose-300 hover:text-white transition cursor-pointer"
            title="Expand Overdue Details"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="bg-gradient-to-br from-rose-900 via-rose-800 to-amber-950 border-2 border-rose-500/80 rounded-3xl p-6 text-white shadow-2xl relative overflow-hidden ring-4 ring-rose-500/20 animate-slide-down"
      id="overdue-bill-notification-banner"
    >
      {/* Background Ambient Glow */}
      <div className="absolute -top-16 -right-16 h-48 w-48 bg-rose-500/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-16 -left-16 h-48 w-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="relative space-y-4">
        {/* Top Tag & Status Badges */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 bg-rose-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl shadow-md border border-rose-400">
              <span className="h-2 w-2 rounded-full bg-white animate-ping"></span>
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>URGENT: OVERDUE WATER TARIFF NOTICE</span>
            </span>

            <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-400 text-amber-950 font-black text-[10px] uppercase tracking-wider rounded-xl shadow-xs">
              <Clock className="h-3 w-3" />
              <span>{daysOverdue} Days Past Due</span>
            </span>

            {overdueBills.length > 1 && (
              <span className="px-2.5 py-1 bg-rose-950/80 text-rose-200 border border-rose-700/60 font-bold text-[10px] uppercase tracking-wider rounded-xl">
                +{overdueBills.length - 1} more unpaid cycle(s)
              </span>
            )}
          </div>

          {/* Minimize toggle */}
          <button
            onClick={() => setIsMinimized(true)}
            className="text-rose-200 hover:text-white p-1 rounded-lg hover:bg-white/10 transition text-xs flex items-center space-x-1 cursor-pointer"
            title="Minimize alert to compact bar"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Minimize</span>
          </button>
        </div>

        {/* Main Content Info Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          
          <div className="lg:col-span-8 space-y-2">
            <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white flex flex-wrap items-center gap-2">
              <span>{primaryBill.billingPeriod} Water Statement is Overdue</span>
              <span className="text-amber-300 font-mono text-lg font-black bg-black/30 px-2.5 py-0.5 rounded-lg border border-amber-400/30">
                ₱{netDue.toFixed(2)}
              </span>
            </h3>
            
            <p className="text-xs sm:text-sm text-rose-100/90 leading-relaxed max-w-3xl">
              Water service statement for cycle <strong>{primaryBill.billingPeriod}</strong> ({primaryBill.consumption} m³) was due on <strong>{formattedDueDate}</strong>. Outstanding balance remains unpaid. To prevent administrative penalty surcharges or potential disconnection notices under Tagoloan Water District municipal regulations, please settle your account now.
            </p>

            {/* Micro Details Row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-rose-200 font-medium pt-1">
              <span className="flex items-center space-x-1">
                <span className="text-rose-400">Account:</span>
                <strong className="font-mono text-white">{consumerRecord.accountNumber}</strong>
              </span>
              <span>•</span>
              <span className="flex items-center space-x-1">
                <span className="text-rose-400">Meter Tag:</span>
                <strong className="font-mono text-white">{primaryBill.meterNumber}</strong>
              </span>
              <span>•</span>
              <span className="flex items-center space-x-1">
                <span className="text-rose-400">Standard 10% Surcharge:</span>
                <strong className="font-mono text-amber-300">+₱{latePenalty.toFixed(2)}</strong>
              </span>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
            {/* Direct Pay Now Button */}
            <button
              onClick={() => onPayNow(primaryBill, 'full')}
              className="w-full px-6 py-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white font-black text-sm uppercase tracking-wider rounded-2xl shadow-xl hover:shadow-2xl transition-all transform hover:-translate-y-0.5 flex items-center justify-center space-x-2.5 cursor-pointer border border-emerald-400 group"
              id="overdue-banner-pay-now-btn"
            >
              <div className="p-1 bg-white/20 rounded-lg group-hover:scale-110 transition-transform">
                <CreditCard className="h-4 w-4" />
              </div>
              <span>Pay Now (₱{netDue.toFixed(2)})</span>
              <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
            </button>

            {/* Collapsible Details Trigger */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-full px-4 py-2.5 bg-black/30 hover:bg-black/40 border border-white/20 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Info className="h-3.5 w-3.5 text-amber-300" />
              <span>{isExpanded ? 'Hide Surcharge Breakdown' : 'View Tariff & Penalty Breakdown'}</span>
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

        </div>

        {/* Collapsible Breakdown Panel */}
        {isExpanded && (
          <div className="pt-4 mt-4 border-t border-rose-700/80 bg-black/25 rounded-2xl p-4 sm:p-5 space-y-4 animate-fade-in text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-rose-800">
              <span className="font-black text-rose-200 uppercase tracking-wider text-[11px]">
                Detailed Overdue Bill Breakdown & Surcharge Assessment
              </span>
              <span className="font-mono text-slate-300 text-[10px]">
                Statement #{primaryBill.id}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-rose-950/60 p-3 rounded-xl border border-rose-800">
                <span className="text-[10px] text-rose-300 font-bold uppercase block">Billed Consumption</span>
                <span className="text-base font-black font-mono text-white mt-0.5 block">
                  {primaryBill.consumption} m³
                </span>
                <span className="text-[9px] text-rose-400 font-mono">
                  {primaryBill.previousReading} m³ → {primaryBill.currentReading} m³
                </span>
              </div>

              <div className="bg-rose-950/60 p-3 rounded-xl border border-rose-800">
                <span className="text-[10px] text-rose-300 font-bold uppercase block">Base Water Tariff</span>
                <span className="text-base font-black font-mono text-white mt-0.5 block">
                  ₱{grossCost.toFixed(2)}
                </span>
                <span className="text-[9px] text-rose-400">
                  {consumerRecord.consumerType} standard rate
                </span>
              </div>

              <div className="bg-rose-950/60 p-3 rounded-xl border border-rose-800">
                <span className="text-[10px] text-amber-300 font-bold uppercase block">10% Late Surcharge</span>
                <span className="text-base font-black font-mono text-amber-300 mt-0.5 block">
                  +₱{latePenalty.toFixed(2)}
                </span>
                <span className="text-[9px] text-amber-200">
                  Accrued for {daysOverdue} days overdue
                </span>
              </div>

              <div className="bg-emerald-950/60 p-3 rounded-xl border border-emerald-700">
                <span className="text-[10px] text-emerald-300 font-bold uppercase block">Total Net Settlement</span>
                <span className="text-base font-black font-mono text-emerald-300 mt-0.5 block">
                  ₱{netDue.toFixed(2)}
                </span>
                <span className="text-[9px] text-emerald-200">
                  {paidAmt > 0 ? `₱${paidAmt.toFixed(2)} already credited` : 'Immediate clearance'}
                </span>
              </div>
            </div>

            {/* Disconnection Warning Notice */}
            <div className="bg-rose-950/90 border border-rose-700 rounded-xl p-3.5 flex items-start space-x-3">
              <Zap className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <h5 className="font-black text-white uppercase text-[11px] tracking-wide">
                  Tagoloan Water District Disconnection Advisory
                </h5>
                <p className="text-rose-200 text-[11px] leading-relaxed">
                  Accounts with unsettled water tariff statements exceeding 30 days past due are flagged for scheduled field inspection and service valve locking. Settle online today to automatically clear your account standing without visiting the district office.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between pt-2 gap-3">
              <span className="text-[11px] text-rose-300">
                Need assistance? Call TWD Hotline: <strong>(088) 555-0145</strong> (Mon-Fri 8AM-5PM)
              </span>
              <button
                onClick={() => onViewBillDetails(primaryBill)}
                className="text-xs font-black text-amber-300 hover:text-white underline uppercase tracking-wider cursor-pointer"
              >
                View Full Bill Statement Record →
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};

export default OverdueBillBanner;

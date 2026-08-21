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
  Sparkles, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle,
  FileText,
  BadgePercent,
  Clock,
  ArrowRight,
  Info
} from 'lucide-react';
import { Consumer, MeterReading } from '../../types';

export interface BillDetailsProps {
  reading: MeterReading | null;
  consumer: Consumer;
  calculateCostOf: (usage: number, classification?: 'Residential' | 'Commercial') => number;
  isOpen?: boolean;
  isModal?: boolean;
  onClose?: () => void;
  onPayBill?: (reading: MeterReading) => void;
}

export interface ComputedBillBreakdown {
  consumption: number;
  consumerType: 'Residential' | 'Commercial';
  baseFixedCharge: number;
  baseFixedAllowanceM3: number;
  volumetricTiers: {
    tierId: string;
    tierName: string;
    range: string;
    volumeUsed: number;
    maxTierVolume: number;
    ratePerM3: number;
    subtotal: number;
    isActive: boolean;
  }[];
  totalVolumetricCost: number;
  basicWaterCharge: number;
  franchiseTaxRate: number;
  franchiseTaxAmount: number;
  environmentalChargeAmount: number;
  waterCommodityAmount: number;
  grossAmount: number;
  paidAmount: number;
  netRemainingDue: number;
  dueDate: string;
  billingPeriod: string;
  isOverdue: boolean;
  latePenaltyAmount: number;
}

/**
 * Calculates complete itemized breakdown of water bill according to
 * Tagoloan Water District approved tariff schedules.
 */
export function computeBillBreakdown(
  reading: MeterReading | null,
  consumer: Consumer,
  calculateCostOf: (usage: number, classification?: 'Residential' | 'Commercial') => number
): ComputedBillBreakdown {
  const isCommercial = consumer.consumerType === 'Commercial';
  const consumption = reading ? Math.max(0, reading.consumption) : 0;
  const baseFixedCharge = isCommercial ? 270.00 : 180.00;
  const baseFixedAllowanceM3 = 10;

  // Volumetric Tiers Calculation
  // Tier 1: 11 - 20 m³
  const tier1Rate = isCommercial ? 30.00 : 20.00;
  const tier1Volume = Math.min(Math.max(0, consumption - 10), 10);
  const tier1Cost = tier1Volume * tier1Rate;

  // Tier 2: 21 - 30 m³
  const tier2Rate = isCommercial ? 36.00 : 24.00;
  const tier2Volume = Math.min(Math.max(0, consumption - 20), 10);
  const tier2Cost = tier2Volume * tier2Rate;

  // Tier 3: 31+ m³
  const tier3Rate = isCommercial ? 45.00 : 30.00;
  const tier3Volume = Math.max(0, consumption - 30);
  const tier3Cost = tier3Volume * tier3Rate;

  const totalVolumetricCost = tier1Cost + tier2Cost + tier3Cost;
  const grossAmount = reading ? calculateCostOf(consumption, consumer.consumerType) : baseFixedCharge;
  const basicWaterCharge = grossAmount;

  // Statutory 2.0% Local Franchise Tax (LFT) and Environmental Levy
  // Under LWUA / LGU standard water utility reporting:
  const franchiseTaxRate = 0.02; // 2%
  const franchiseTaxAmount = Math.round(grossAmount * franchiseTaxRate * 100) / 100;
  const environmentalChargeAmount = Math.round(grossAmount * 0.005 * 100) / 100; // 0.5% watershed levy
  const waterCommodityAmount = Math.max(0, grossAmount - franchiseTaxAmount - environmentalChargeAmount);

  const paidAmount = reading ? (reading.paidAmount || 0) : 0;
  const rawRemaining = Math.max(0, grossAmount - paidAmount);

  // Due date and overdue penalty
  const dueDate = reading?.dueDate || '20th of the month';
  const dueDateObj = reading?.dueDate ? new Date(reading.dueDate) : new Date('2026-06-20');
  const isOverdue = Boolean(reading && new Date() > dueDateObj && rawRemaining > 0 && reading.paymentStatus !== 'paid');
  const latePenaltyAmount = isOverdue
    ? (reading?.penaltyAmount !== undefined ? reading.penaltyAmount : Math.round(rawRemaining * 0.10 * 100) / 100)
    : 0;

  const netRemainingDue = rawRemaining + latePenaltyAmount;

  const volumetricTiers = [
    {
      tierId: 'tier1',
      tierName: 'Tier 1 (Normal Living)',
      range: '11 – 20 m³',
      volumeUsed: tier1Volume,
      maxTierVolume: 10,
      ratePerM3: tier1Rate,
      subtotal: tier1Cost,
      isActive: tier1Volume > 0,
    },
    {
      tierId: 'tier2',
      tierName: 'Tier 2 (Moderate Usage)',
      range: '21 – 30 m³',
      volumeUsed: tier2Volume,
      maxTierVolume: 10,
      ratePerM3: tier2Rate,
      subtotal: tier2Cost,
      isActive: tier2Volume > 0,
    },
    {
      tierId: 'tier3',
      tierName: 'Tier 3 (High Consumption)',
      range: '31+ m³',
      volumeUsed: tier3Volume,
      maxTierVolume: Infinity,
      ratePerM3: tier3Rate,
      subtotal: tier3Cost,
      isActive: tier3Volume > 0,
    },
  ];

  return {
    consumption,
    consumerType: consumer.consumerType || 'Residential',
    baseFixedCharge,
    baseFixedAllowanceM3,
    volumetricTiers,
    totalVolumetricCost,
    basicWaterCharge,
    franchiseTaxRate,
    franchiseTaxAmount,
    environmentalChargeAmount,
    waterCommodityAmount,
    grossAmount,
    paidAmount,
    netRemainingDue,
    dueDate,
    billingPeriod: reading?.billingPeriod || 'Current Billing Cycle',
    isOverdue,
    latePenaltyAmount,
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
  const [activeTab, setActiveTab] = useState<'itemized' | 'tiers' | 'regulatory'>('itemized');
  const [showFormulaHelper, setShowFormulaHelper] = useState(false);

  if (!isOpen) return null;

  const breakdown = computeBillBreakdown(reading, consumer, calculateCostOf);
  const isPaid = reading?.paymentStatus === 'paid';
  const isPartial = reading?.paymentStatus === 'partial';

  const content = (
    <div className="space-y-6 text-slate-800" id="bill-details-component">
      {/* Header Banner & Metadata */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 rounded-3xl p-5 sm:p-6 text-white shadow-xl relative overflow-hidden">
        {/* Subtle Water District Watermark */}
        <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
          <Droplets className="w-48 h-48 text-white" />
        </div>

        <div className="relative z-10 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-blue-500/20 border border-blue-400/30 rounded-2xl text-blue-300">
                <Calculator className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-300">
                    Official Tariff Breakdown
                  </span>
                  <span className="px-2 py-0.5 bg-white/10 rounded-full text-[9px] font-mono font-bold text-slate-200">
                    LWUA Schedule 2025–2026
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  Current Bill Amount Breakdown
                </h3>
              </div>
            </div>

            {isModal && onClose && (
              <button
                onClick={onClose}
                className="self-end sm:self-auto p-2 bg-white/10 hover:bg-white/20 rounded-xl text-slate-300 hover:text-white transition cursor-pointer"
                title="Close Breakdown"
                id="close-bill-details-btn"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Key Account & Period Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Billing Period</span>
              <span className="font-bold text-white text-sm block mt-0.5">{breakdown.billingPeriod}</span>
              <span className="text-[10px] text-slate-400">Due: {breakdown.dueDate}</span>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Account & Meter</span>
              <span className="font-mono font-bold text-blue-300 text-sm block mt-0.5">{consumer.accountNumber}</span>
              <span className="text-[10px] text-slate-400 font-mono">Meter #{consumer.meterNumber || reading?.meterNumber || 'N/A'}</span>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Rate Classification</span>
              <span className="font-black text-amber-300 text-sm block mt-0.5">{consumer.consumerType || 'Residential'}</span>
              <span className="text-[10px] text-slate-400">Standard Tier Schedule</span>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Net Consumption</span>
              <span className="font-black font-mono text-emerald-300 text-base block mt-0.5">
                {breakdown.consumption} m³
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {reading ? `${reading.previousReading} → ${reading.currentReading} m³` : 'Baseline'}
              </span>
            </div>
          </div>

          {/* Current Bill Total Highlight Card */}
          <div className="bg-white/10 backdrop-blur-xs border border-white/20 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-blue-200">
                  Total Current Bill Amount
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                  isPaid 
                    ? 'bg-emerald-500 text-white' 
                    : isPartial 
                    ? 'bg-amber-500 text-slate-950 font-black' 
                    : 'bg-rose-500 text-white'
                }`}>
                  {isPaid ? 'Settled in Full' : isPartial ? 'Partially Paid' : 'Unpaid Current Bill'}
                </span>
              </div>
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl sm:text-4xl font-black font-mono text-white tracking-tight">
                  ₱{breakdown.grossAmount.toFixed(2)}
                </span>
                <span className="text-xs text-blue-200 font-medium">
                  {breakdown.paidAmount > 0 
                    ? `(₱${breakdown.netRemainingDue.toFixed(2)} remaining)` 
                    : 'Gross assessed amount'}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2 self-stretch sm:self-auto">
              <button
                onClick={() => window.print()}
                className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-bold text-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                title="Print Breakdown Statement"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline">Print</span>
              </button>

              {!isPaid && onPayBill && reading && (
                <button
                  onClick={() => onPayBill(reading)}
                  className="flex-1 sm:flex-initial px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer"
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

      {/* Navigation Pills for Deep Dive */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-2">
        <button
          onClick={() => setActiveTab('itemized')}
          className={`pb-3 px-3 text-xs font-black uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 cursor-pointer whitespace-nowrap ${
            activeTab === 'itemized'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
          id="tab-itemized-breakdown"
        >
          <Layers className="h-4 w-4" />
          <span>3-Pillar Itemized Breakdown</span>
        </button>

        <button
          onClick={() => setActiveTab('tiers')}
          className={`pb-3 px-3 text-xs font-black uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 cursor-pointer whitespace-nowrap ${
            activeTab === 'tiers'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
          id="tab-volumetric-tiers"
        >
          <Droplets className="h-4 w-4" />
          <span>Volumetric Tier Progress</span>
        </button>

        <button
          onClick={() => setActiveTab('regulatory')}
          className={`pb-3 px-3 text-xs font-black uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 cursor-pointer whitespace-nowrap ${
            activeTab === 'regulatory'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
          id="tab-regulatory-levies"
        >
          <Percent className="h-4 w-4" />
          <span>Taxes & Regulatory Fees</span>
        </button>
      </div>

      {/* TAB 1: 3-PILLAR ITEMIZED BREAKDOWN (Fixed + Volumetric + Service Taxes) */}
      {activeTab === 'itemized' && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* PILLAR 1: FIXED BASE CHARGES */}
            <div className="bg-white border-2 border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-blue-300 transition">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <Scale className="h-5 w-5" />
                  </span>
                  <span className="px-2 py-0.5 bg-blue-100/80 text-blue-800 font-black text-[9px] uppercase tracking-wider rounded-md">
                    Pillar 1
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900">1. Fixed Charges</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Base connection maintenance fee and readiness-to-serve charge.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Minimum Base Rate:</span>
                  <span className="font-mono font-bold text-slate-900">₱{breakdown.baseFixedCharge.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Included Allowance:</span>
                  <span className="font-mono font-bold text-blue-600">First 10 m³</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Meter Service Fee:</span>
                  <span className="text-emerald-700 font-semibold">Included</span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-black text-slate-900">
                  <span>Subtotal Fixed:</span>
                  <span className="font-mono text-blue-700">₱{breakdown.baseFixedCharge.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* PILLAR 2: VOLUMETRIC CONSUMPTION FEES */}
            <div className="bg-white border-2 border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-blue-300 transition">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="p-2 bg-sky-50 text-sky-600 rounded-xl">
                    <Droplets className="h-5 w-5" />
                  </span>
                  <span className="px-2 py-0.5 bg-sky-100/80 text-sky-800 font-black text-[9px] uppercase tracking-wider rounded-md">
                    Pillar 2
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900">2. Volumetric Fees</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Tiered commodity fees for water used beyond the initial 10 m³ allowance.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Excess Billed Volume:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {Math.max(0, breakdown.consumption - 10)} m³
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Tier 1 (11–20 m³):</span>
                  <span className="font-mono font-bold text-slate-800">
                    ₱{breakdown.volumetricTiers[0].subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Tier 2 (21–30 m³):</span>
                  <span className="font-mono font-bold text-slate-800">
                    ₱{breakdown.volumetricTiers[1].subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Tier 3 (31+ m³):</span>
                  <span className="font-mono font-bold text-slate-800">
                    ₱{breakdown.volumetricTiers[2].subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-black text-slate-900">
                  <span>Subtotal Volumetric:</span>
                  <span className="font-mono text-sky-700">₱{breakdown.totalVolumetricCost.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* PILLAR 3: APPLICABLE SERVICE TAXES & LEVIES */}
            <div className="bg-white border-2 border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-blue-300 transition">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <Percent className="h-5 w-5" />
                  </span>
                  <span className="px-2 py-0.5 bg-indigo-100/80 text-indigo-800 font-black text-[9px] uppercase tracking-wider rounded-md">
                    Pillar 3
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900">3. Service Taxes & Levies</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Mandatory municipal franchise tax & watershed conservation fees.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Local Franchise Tax (2%):</span>
                  <span className="font-mono font-bold text-slate-900">₱{breakdown.franchiseTaxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Watershed / Environ (0.5%):</span>
                  <span className="font-mono font-bold text-slate-800">₱{breakdown.environmentalChargeAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>LWUA Regulatory Surcharge:</span>
                  <span className="text-emerald-700 font-semibold">Standard 0%</span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-black text-slate-900">
                  <span>Statutory Component:</span>
                  <span className="font-mono text-indigo-700">
                    ₱{(breakdown.franchiseTaxAmount + breakdown.environmentalChargeAmount).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

          </div>

          {/* Master Itemized Ledger Table */}
          <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center space-x-1.5">
                  <FileText className="h-4 w-4 text-blue-600" />
                  <span>Itemized Water Bill Statement Ledger</span>
                </h4>
                <p className="text-[11px] text-slate-500">Mathematical compilation of all bill line items</p>
              </div>
              <span className="text-xs font-mono font-bold text-slate-700">
                {consumer.consumerType} Rate Schedule
              </span>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <div>
                  <span className="font-bold text-slate-800">1. Fixed Minimum Base Charge</span>
                  <span className="text-[11px] text-slate-400 block">Covers service readiness & initial 0–10 m³ water allowance</span>
                </div>
                <span className="font-mono font-bold text-slate-900">₱{breakdown.baseFixedCharge.toFixed(2)}</span>
              </div>

              {breakdown.volumetricTiers.map((tier) => (
                <div key={tier.tierId} className="flex justify-between items-center py-2 border-b border-slate-100">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-800">2. Volumetric {tier.tierName}</span>
                      <span className={`px-2 py-0.2 rounded text-[9px] font-mono ${tier.isActive ? 'bg-blue-100 text-blue-800 font-bold' : 'bg-slate-100 text-slate-400'}`}>
                        {tier.range}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 block">
                      {tier.volumeUsed} m³ consumed × ₱{tier.ratePerM3.toFixed(2)} / m³
                    </span>
                  </div>
                  <span className={`font-mono font-bold ${tier.isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                    ₱{tier.subtotal.toFixed(2)}
                  </span>
                </div>
              ))}

              <div className="flex justify-between items-center py-2 border-b border-slate-100 bg-slate-50/60 px-3 rounded-lg">
                <span className="font-black text-slate-900">Total Assessed Water Commodity & Tariff</span>
                <span className="font-mono font-black text-slate-900 text-sm">
                  ₱{breakdown.grossAmount.toFixed(2)}
                </span>
              </div>

              {/* Adjustments, Credits, and Overdue Surcharges */}
              {breakdown.paidAmount > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-slate-100 text-emerald-700 bg-emerald-50/50 px-3 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <div>
                      <span className="font-bold">Prior Payments / Partial Credits Applied</span>
                      <span className="text-[10px] text-emerald-600 block">Credited to this statement</span>
                    </div>
                  </div>
                  <span className="font-mono font-black">-₱{breakdown.paidAmount.toFixed(2)}</span>
                </div>
              )}

              {breakdown.isOverdue && breakdown.latePenaltyAmount > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-slate-100 text-rose-700 bg-rose-50/50 px-3 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                    <div>
                      <span className="font-bold">10% Late Overdue Surcharge</span>
                      <span className="text-[10px] text-rose-600 block">Assessed past due date ({breakdown.dueDate})</span>
                    </div>
                  </div>
                  <span className="font-mono font-black">+₱{breakdown.latePenaltyAmount.toFixed(2)}</span>
                </div>
              )}

              {/* Grand Total Net Settlement */}
              <div className="pt-3 flex justify-between items-center">
                <div>
                  <span className="text-sm font-black text-slate-900 uppercase tracking-wide">
                    Net Outstanding Payable
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    {isPaid ? 'Paid in full — Official electronic receipt recorded' : `Due on or before ${breakdown.dueDate}`}
                  </span>
                </div>
                <div className="text-right">
                  <span className={`text-xl sm:text-2xl font-black font-mono ${
                    isPaid ? 'text-emerald-700' : 'text-blue-700'
                  }`}>
                    ₱{breakdown.netRemainingDue.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: VOLUMETRIC TIER PROGRESS & INVERTED BLOCK VISUALIZER */}
      {activeTab === 'tiers' && (
        <div className="space-y-5 animate-fade-in">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h4 className="text-sm font-black text-slate-900 flex items-center space-x-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  <span>Inverted Block Tariff Consumption Bar</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  See how your monthly consumption of <strong className="text-slate-800 font-mono">{breakdown.consumption} m³</strong> fills each volumetric tier
                </p>
              </div>
              <div className="px-3 py-1 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl text-xs font-mono font-bold">
                Classification: {consumer.consumerType}
              </div>
            </div>

            {/* Visual Tier Ladder */}
            <div className="space-y-4 pt-2">
              {/* Base Tier: 0-10 m3 */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                    <span>Baseline Tier (0 – 10 m³)</span>
                  </span>
                  <span className="font-mono font-bold text-slate-700">
                    {Math.min(breakdown.consumption, 10)} / 10 m³ ({breakdown.consumption >= 10 ? '100%' : `${(breakdown.consumption / 10 * 100).toFixed(0)}%`})
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                  <div 
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, (Math.min(breakdown.consumption, 10) / 10) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Fixed Base Rate: ₱{breakdown.baseFixedCharge.toFixed(2)} minimum</span>
                  <span>Living Allowance</span>
                </div>
              </div>

              {/* Tier 1: 11-20 m3 */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                    <span>Tier 1: Normal Household (11 – 20 m³)</span>
                  </span>
                  <span className="font-mono font-bold text-slate-700">
                    {breakdown.volumetricTiers[0].volumeUsed} / 10 m³ @ ₱{breakdown.volumetricTiers[0].ratePerM3.toFixed(2)}/m³
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                  <div 
                    className="bg-blue-500 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, (breakdown.volumetricTiers[0].volumeUsed / 10) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Subtotal for this tier: ₱{breakdown.volumetricTiers[0].subtotal.toFixed(2)}</span>
                  <span>₱{breakdown.volumetricTiers[0].ratePerM3.toFixed(2)}/m³ increment</span>
                </div>
              </div>

              {/* Tier 2: 21-30 m3 */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                    <span>Tier 2: Moderate Consumption (21 – 30 m³)</span>
                  </span>
                  <span className="font-mono font-bold text-slate-700">
                    {breakdown.volumetricTiers[1].volumeUsed} / 10 m³ @ ₱{breakdown.volumetricTiers[1].ratePerM3.toFixed(2)}/m³
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                  <div 
                    className="bg-amber-500 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, (breakdown.volumetricTiers[1].volumeUsed / 10) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Subtotal for this tier: ₱{breakdown.volumetricTiers[1].subtotal.toFixed(2)}</span>
                  <span>₱{breakdown.volumetricTiers[1].ratePerM3.toFixed(2)}/m³ increment</span>
                </div>
              </div>

              {/* Tier 3: 31+ m3 */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                    <span>Tier 3: Heavy Consumption (31+ m³)</span>
                  </span>
                  <span className="font-mono font-bold text-slate-700">
                    {breakdown.volumetricTiers[2].volumeUsed} m³ @ ₱{breakdown.volumetricTiers[2].ratePerM3.toFixed(2)}/m³
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                  <div 
                    className="bg-rose-500 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, (breakdown.volumetricTiers[2].volumeUsed / 15) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Subtotal for this tier: ₱{breakdown.volumetricTiers[2].subtotal.toFixed(2)}</span>
                  <span>Conservation surcharge bracket</span>
                </div>
              </div>
            </div>

            {/* Conservation Tip */}
            <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-4 flex items-start space-x-3 text-xs">
              <Sparkles className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-black text-blue-900 block">Conservation-Driven Inverted Block Pricing</span>
                <p className="text-blue-800/90 leading-relaxed mt-0.5">
                  Tagoloan Water District utilizes an inverted block tariff approved by LWUA. Baseline living consumption (0–10 m³) is subsidized at lower fixed costs, while higher consumption brackets are charged progressive volumetric rates to encourage environmental water stewardship.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SERVICE TAXES & REGULATORY ALLOCATIONS */}
      {activeTab === 'regulatory' && (
        <div className="space-y-4 animate-fade-in text-xs">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center space-x-2.5 pb-3 border-b border-slate-100">
              <BadgePercent className="h-5 w-5 text-indigo-600" />
              <div>
                <h4 className="text-sm font-black text-slate-900">Statutory Tax & Regulatory Surcharge Breakdown</h4>
                <p className="text-[11px] text-slate-500">Government taxes and conservation levies included in municipal water rates</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900">Local Franchise Tax (LFT)</span>
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 font-mono font-bold rounded">2.0%</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Remitted to the Local Government Unit (LGU) of Tagoloan, Misamis Oriental under Republic Act 7160 for public utility municipal franchise privileges.
                </p>
                <div className="pt-2 border-t border-slate-200 flex justify-between font-mono font-bold text-slate-800">
                  <span>Assessed LFT:</span>
                  <span>₱{breakdown.franchiseTaxAmount.toFixed(2)}</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900">Watershed & Environmental Levy</span>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-mono font-bold rounded">0.5%</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Dedicated to preserving and rehabilitating the Tagoloan river catchment basin, reforestation, and ecological springhead protection.
                </p>
                <div className="pt-2 border-t border-slate-200 flex justify-between font-mono font-bold text-slate-800">
                  <span>Allocated Fee:</span>
                  <span>₱{breakdown.environmentalChargeAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Explanation card */}
            <div className="bg-slate-900 text-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-white text-xs">LWUA Transparent Rate Disclosure</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                All charges and taxes on your Tagoloan Water District statement conform to the Local Water Utilities Administration (LWUA) regulatory guidelines. No hidden charges or unmetered fees are assessed to your account.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Formula Helper / FAQ Accordion */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4">
        <button
          onClick={() => setShowFormulaHelper(!showFormulaHelper)}
          className="w-full flex items-center justify-between text-left font-bold text-slate-800 text-xs hover:text-blue-600 transition cursor-pointer"
        >
          <div className="flex items-center space-x-2">
            <HelpCircle className="h-4 w-4 text-blue-600" />
            <span>How is your Tagoloan Water District bill computed mathematically?</span>
          </div>
          <span className="text-[10px] font-mono text-blue-600 uppercase">
            {showFormulaHelper ? 'Hide Formula' : 'View Formula'}
          </span>
        </button>

        {showFormulaHelper && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-2 text-xs text-slate-600 animate-fade-in">
            <div className="bg-white p-3 rounded-xl border border-slate-200 font-mono text-[11px] text-slate-800 space-y-1">
              <div>Total Current Bill = Fixed Minimum Base + Volumetric Tier Charges</div>
              <div className="text-slate-500 text-[10px]">
                Where Volumetric = (Tier 1 Volume × Rate) + (Tier 2 Volume × Rate) + (Tier 3 Volume × Rate)
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              For example, for a Residential consumer using {breakdown.consumption} m³:
              First 10 m³ are covered by the ₱180.00 base charge. The remaining {Math.max(0, breakdown.consumption - 10)} m³ are billed according to progressive tiers, yielding an exact total of ₱{breakdown.grossAmount.toFixed(2)}.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  // Render either as a modal or inline component
  if (isModal) {
    return (
      <div 
        className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-5 overflow-y-auto animate-fade-in"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) onClose();
        }}
      >
        <div className="bg-white border border-slate-200 rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-5 sm:p-7 shadow-2xl space-y-6 my-auto">
          {content}
        </div>
      </div>
    );
  }

  return content;
};

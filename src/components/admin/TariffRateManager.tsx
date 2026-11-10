/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useId } from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  Bell, 
  CheckCircle2, 
  AlertTriangle, 
  RotateCcw, 
  ShieldCheck, 
  Sliders, 
  Building2, 
  Home, 
  ArrowRight,
  Flame,
  Layers,
  Zap,
  Percent,
  Check
} from 'lucide-react';
import { 
  WaterTariffConfig, 
  DEFAULT_TARIFF_CONFIG, 
  OFFICIAL_TARIFF_BASELINE_SCHEMA,
  getActiveTariffConfig, 
  calculateWaterTariff, 
  calculateFranchiseTax 
} from '../../utils/tariffCalculator';
import { mockDb } from '../../mockDb';
import { User, Consumer, MeterReading, Announcement } from '../../types';
import { sendRealtimeMessage } from '../../services/realtimeSocket';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';

interface TariffRateManagerProps {
  currentUser: User;
  consumers: Consumer[];
  setConsumers?: React.Dispatch<React.SetStateAction<Consumer[]>>;
  readings: MeterReading[];
  setReadings: React.Dispatch<React.SetStateAction<MeterReading[]>>;
  setAnnouncements: React.Dispatch<React.SetStateAction<Announcement[]>>;
  onTariffApplied?: (config: WaterTariffConfig) => void;
}

export const TariffRateManager: React.FC<TariffRateManagerProps> = ({
  currentUser,
  consumers,
  readings,
  setAnnouncements,
  onTariffApplied
}) => {
  const toast = useToast();

  // Active saved tariff
  const [activeTariff, setActiveTariff] = useState<WaterTariffConfig>(() => getActiveTariffConfig());

  // Form state for proposed price hike
  const [formConfig, setFormConfig] = useState<WaterTariffConfig>(() => ({
    ...activeTariff,
    version: (activeTariff.version || 1) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser.name || 'Admin Operations Staff',
    effectiveDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    resolutionNumber: `TWD-BR-${new Date().getFullYear()}-${String(Math.floor(10 + Math.random() * 90))}`,
    memoNotes: 'Official Tagoloan Water District price hike adjustment to cover escalating electricity tariff, water treatment inputs, and municipal transmission pipeline maintenance.'
  }));

  // Target classification state: 'Residential' | 'Commercial' | 'both'
  const [targetScope, setTargetScope] = useState<'Residential' | 'Commercial' | 'both'>('Residential');

  // Adjustment mode: 'quick' | 'manual'
  const [adjustmentMode, setAdjustmentMode] = useState<'quick' | 'manual'>('quick');

  // Quick adjustment type: 'percentage' | 'flat_m3'
  const [quickType, setQuickType] = useState<'percentage' | 'flat_m3'>('flat_m3');
  const [quickFlatValue, setQuickFlatValue] = useState<number>(2.00);
  const [quickPercentValue, setQuickPercentValue] = useState<number>(10);

  // Notification options
  const [notifyAllConsumers, setNotifyAllConsumers] = useState(true);
  const [postAnnouncement, setPostAnnouncement] = useState(true);
  const [broadcastWebSocket, setBroadcastWebSocket] = useState(true);

  // Live impact simulator state
  const [simUsage, setSimUsage] = useState<number>(18);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Filtered account counts
  const residentialConsumersCount = consumers.filter(
    c => c.consumerType !== 'Commercial' && c.accountNumber && !c.accountNumber.toUpperCase().startsWith('PENDING')
  ).length;
  const commercialConsumersCount = consumers.filter(
    c => c.consumerType === 'Commercial' && c.accountNumber && !c.accountNumber.toUpperCase().startsWith('PENDING')
  ).length;

  // Apply quick flat increase per m3
  const applyQuickFlatHike = (hikePerM3: number) => {
    setQuickFlatValue(hikePerM3);
    setFormConfig(prev => {
      const updated = { ...prev };
      if (targetScope === 'both' || targetScope === 'Residential') {
        const nextResBase = Math.round(((activeTariff.residential.ratePerM3 ?? activeTariff.residential.baseMinCharge) + hikePerM3) * 100) / 100;
        updated.residential = {
          ...activeTariff.residential,
          ratePerM3: nextResBase,
          baseMinCharge: nextResBase,
          tier1_rate: Math.round((activeTariff.residential.tier1_rate + hikePerM3) * 100) / 100,
          tier2_rate: Math.round((activeTariff.residential.tier2_rate + hikePerM3) * 100) / 100,
          tier3_rate: Math.round((activeTariff.residential.tier3_rate + hikePerM3) * 100) / 100,
          tier4_rate: Math.round((activeTariff.residential.tier4_rate + hikePerM3) * 100) / 100,
        };
      }
      if (targetScope === 'both' || targetScope === 'Commercial') {
        const commHike = targetScope === 'Commercial' ? hikePerM3 : Math.round((hikePerM3 * 1.5) * 100) / 100;
        const nextCommBase = Math.round(((activeTariff.commercial.ratePerM3 ?? activeTariff.commercial.baseMinCharge) + commHike) * 100) / 100;
        updated.commercial = {
          ...activeTariff.commercial,
          ratePerM3: nextCommBase,
          baseMinCharge: nextCommBase,
          tier1_rate: Math.round((activeTariff.commercial.tier1_rate + commHike) * 100) / 100,
          tier2_rate: Math.round((activeTariff.commercial.tier2_rate + commHike) * 100) / 100,
          tier3_rate: Math.round((activeTariff.commercial.tier3_rate + commHike) * 100) / 100,
          tier4_rate: Math.round((activeTariff.commercial.tier4_rate + commHike) * 100) / 100,
          tier5_rate: Math.round((activeTariff.commercial.tier5_rate + commHike) * 100) / 100,
        };
      }
      return updated;
    });
  };

  // Apply quick percentage increase
  const applyQuickPercentHike = (pct: number) => {
    setQuickPercentValue(pct);
    const multiplier = 1 + (pct / 100);
    setFormConfig(prev => {
      const updated = { ...prev };
      if (targetScope === 'both' || targetScope === 'Residential') {
        const resBase = Math.round((activeTariff.residential.ratePerM3 ?? activeTariff.residential.baseMinCharge) * multiplier * 100) / 100;
        updated.residential = {
          ratePerM3: resBase,
          baseMinCharge: resBase,
          tier1_rate: Math.round(activeTariff.residential.tier1_rate * multiplier * 100) / 100,
          tier2_rate: Math.round(activeTariff.residential.tier2_rate * multiplier * 100) / 100,
          tier3_rate: Math.round(activeTariff.residential.tier3_rate * multiplier * 100) / 100,
          tier4_rate: Math.round(activeTariff.residential.tier4_rate * multiplier * 100) / 100,
        };
      }
      if (targetScope === 'both' || targetScope === 'Commercial') {
        const commBase = Math.round((activeTariff.commercial.ratePerM3 ?? activeTariff.commercial.baseMinCharge) * multiplier * 100) / 100;
        updated.commercial = {
          ratePerM3: commBase,
          baseMinCharge: commBase,
          tier1_rate: Math.round(activeTariff.commercial.tier1_rate * multiplier * 100) / 100,
          tier2_rate: Math.round(activeTariff.commercial.tier2_rate * multiplier * 100) / 100,
          tier3_rate: Math.round(activeTariff.commercial.tier3_rate * multiplier * 100) / 100,
          tier4_rate: Math.round(activeTariff.commercial.tier4_rate * multiplier * 100) / 100,
          tier5_rate: Math.round(activeTariff.commercial.tier5_rate * multiplier * 100) / 100,
        };
      }
      return updated;
    });
  };

  // Reset to default baseline
  const handleResetToBaseline = () => {
    setFormConfig(prev => ({
      ...prev,
      residential: { ...DEFAULT_TARIFF_CONFIG.residential },
      commercial: { ...DEFAULT_TARIFF_CONFIG.commercial },
      franchiseTaxRate: DEFAULT_TARIFF_CONFIG.franchiseTaxRate,
      latePaymentSurchargeRate: DEFAULT_TARIFF_CONFIG.latePaymentSurchargeRate,
    }));
    toast.info('Rates reset to standard baseline (₱10.00/m³ Residential, ₱25.00/m³ Commercial).');
  };

  // Execute tariff save
  const handleApplyTariff = async () => {
    setIsApplying(true);
    try {
      const finalConfig: WaterTariffConfig = {
        ...formConfig,
        version: (activeTariff.version || 1) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name || 'Admin Operations Staff',
      };

      // 1. Save to mockDb and active state
      mockDb.saveTariffConfig(finalConfig);
      setActiveTariff(finalConfig);

      // 2. Persist to API
      apiClient.saveTariffConfig(finalConfig).catch(() => {});

      // 3. Issue notifications if selected
      if (notifyAllConsumers) {
        const scopeLabel = targetScope === 'Residential' ? 'Residential' : targetScope === 'Commercial' ? 'Commercial' : 'District-Wide';
        const resBase = finalConfig.residential.ratePerM3 ?? finalConfig.residential.baseMinCharge;
        const commBase = finalConfig.commercial.ratePerM3 ?? finalConfig.commercial.baseMinCharge;
        const summaryMsg = `Pursuant to Board Resolution ${finalConfig.resolutionNumber}, water rates effective ${finalConfig.effectiveDate} apply to NEW meter readings going forward (${targetScope === 'Commercial' ? `Commercial: ₱${commBase.toFixed(2)}/m³` : `Residential: ₱${resBase.toFixed(2)}/m³`}, 2% Franchise Tax, 10% Late Penalty). Previous billed statements remain unchanged.`;

        const createdNotif = mockDb.addNotification({
          accountNumber: 'ALL',
          title: `Official Advisory: ${scopeLabel} Water Tariff Adjustment (${finalConfig.resolutionNumber})`,
          message: summaryMsg,
          type: 'announcement',
        });

        sendRealtimeMessage('CONSUMER_NOTIFICATION_CREATED', {
          notification: createdNotif,
          accountNumber: 'ALL',
        });
      }

      // 4. Publish public announcement
      if (postAnnouncement) {
        const resBase = finalConfig.residential.ratePerM3 ?? finalConfig.residential.baseMinCharge;
        const newAnn: Announcement = {
          id: `ann-tariff-${Date.now()}`,
          title: `District Advisory: Water Tariff Rate Adjustment (${finalConfig.resolutionNumber})`,
          content: `Notice to all Tagoloan Water District Consumers: Effective ${finalConfig.effectiveDate}, an official water tariff rate adjustment has been implemented under ${finalConfig.resolutionNumber}. Baseline rate: ₱${resBase.toFixed(2)}/m³ (Residential). Existing/prior billed readings remain unchanged. ${finalConfig.memoNotes}`,
          category: 'info',
          date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          postedBy: currentUser.name || 'Board of Directors / General Manager',
        };
        const currentAnns = mockDb.getAnnouncements();
        mockDb.saveAnnouncements([newAnn, ...currentAnns]);
        setAnnouncements(prev => [newAnn, ...prev.filter(a => a.id !== newAnn.id)]);
      }

      // 5. Broadcast WebSocket sync
      if (broadcastWebSocket) {
        sendRealtimeMessage('tariff:updated', {
          config: finalConfig,
          version: finalConfig.version,
          targetScope,
          resolutionNumber: finalConfig.resolutionNumber,
          effectiveDate: finalConfig.effectiveDate,
        });
      }

      // 6. Audit log
      mockDb.addAuditLog(
        currentUser.id,
        currentUser.name,
        'admin',
        `Water Tariff Price Adjustment (${targetScope.toUpperCase()})`,
        `Adjusted ${targetScope} water tariff under ${finalConfig.resolutionNumber} (v${finalConfig.version}). Effective ${finalConfig.effectiveDate} for NEW readings only.`
      );

      // 7. Dispatch events
      window.dispatchEvent(new CustomEvent('twd_database_updated'));
      window.dispatchEvent(new CustomEvent('twd_tariff_updated', { detail: finalConfig }));

      if (onTariffApplied) {
        onTariffApplied(finalConfig);
      }

      setShowConfirmModal(false);
      toast.success(`Water tariff adjustment successfully saved and implemented! New rates will apply to NEW meter readings.`);
    } catch (err: any) {
      toast.error(`Failed to implement price hike: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsApplying(false);
    }
  };

  // Helper simulator calculations
  const simClass: 'Residential' | 'Commercial' = targetScope === 'Commercial' ? 'Commercial' : 'Residential';
  const oldBaseCost = calculateWaterTariff(simUsage, simClass, activeTariff);
  const oldTax = calculateFranchiseTax(oldBaseCost, activeTariff);
  const oldTotal = Math.round((oldBaseCost + oldTax) * 100) / 100;

  const newBaseCost = calculateWaterTariff(simUsage, simClass, formConfig);
  const newTax = calculateFranchiseTax(newBaseCost, formConfig);
  const newTotal = Math.round((newBaseCost + newTax) * 100) / 100;

  const simDiff = Math.round((newTotal - oldTotal) * 100) / 100;
  const simPercentDiff = oldTotal > 0 ? Math.round(((newTotal - oldTotal) / oldTotal) * 1000) / 10 : 0;

  const effectiveResRate = formConfig.residential.ratePerM3 ?? formConfig.residential.baseMinCharge;
  const effectiveCommRate = formConfig.commercial.ratePerM3 ?? formConfig.commercial.baseMinCharge;
  const activeResRate = activeTariff.residential.ratePerM3 ?? activeTariff.residential.baseMinCharge;
  const activeCommRate = activeTariff.commercial.ratePerM3 ?? activeTariff.commercial.baseMinCharge;

  const formEffectiveDateId = useId();
  const formResolutionNumberId = useId();
  const formMemoNotesId = useId();

  return (
    <div className="space-y-6 animate-fade-in" id="tariff-rate-manager">
      
      {/* 1. Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-3xl p-6 sm:p-7 text-white border border-blue-900/50 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5 relative z-10">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 bg-blue-500/20 border border-blue-400/40 text-blue-300 font-black text-[10px] uppercase tracking-wider rounded-xl flex items-center space-x-1.5 shadow-xs">
                <Sliders className="h-3.5 w-3.5 text-blue-400" />
                <span>WATER TARIFF & PRICE HIKE MANAGER</span>
              </span>
              <span className="px-3 py-1 bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-black text-[10px] uppercase tracking-wider rounded-xl flex items-center space-x-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>v{activeTariff.version || 1} Active</span>
              </span>
              <span className="px-3 py-1 bg-slate-800 text-slate-300 font-mono text-[10px] rounded-xl border border-slate-700">
                {activeTariff.resolutionNumber}
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Water Meter Reading Tariff Rate Adjustment
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Easily adjust residential or commercial water rates in 3 simple steps. Adjustments apply strictly to new readings going forward; existing issued statements and payments remain protected.
            </p>
          </div>

          <div className="flex sm:flex-row lg:flex-col gap-2 shrink-0 w-full sm:w-auto">
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-3 text-center min-w-[170px] flex-1 sm:flex-initial">
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Current Residential</span>
              <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
                ₱{activeResRate.toFixed(2)} / m³
              </div>
              <span className="text-[10px] text-slate-400">Baseline (1-10 m³)</span>
            </div>
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-3 text-center min-w-[170px] flex-1 sm:flex-initial">
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Current Commercial</span>
              <div className="text-xl font-black text-blue-400 font-mono mt-0.5">
                ₱{activeCommRate.toFixed(2)} / m³
              </div>
              <span className="text-[10px] text-slate-400">Baseline (1-10 m³)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Adjustment Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-6 text-slate-100">
        
        {/* STEP 1: Select Target Scope */}
        <div className="space-y-3 pb-5 border-b border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center space-x-2">
                <span className="h-6 w-6 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center">1</span>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Select Target Classification to Adjust
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Choose whether this price adjustment applies to regular household consumers, commercial accounts, or both.
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetToBaseline}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs rounded-xl transition flex items-center space-x-1.5 self-start sm:self-auto cursor-pointer border border-slate-700"
              title="Reset form values to default baseline"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset Baseline</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {/* Residential */}
            <button
              type="button"
              onClick={() => setTargetScope('Residential')}
              className={`p-4 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
                targetScope === 'Residential'
                  ? 'bg-emerald-950/70 border-emerald-500 ring-2 ring-emerald-500/40 shadow-lg'
                  : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 opacity-75 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="inline-flex items-center space-x-1.5 text-xs font-black text-emerald-300">
                    <Home className="h-4 w-4 text-emerald-400" />
                    <span>Residential Accounts</span>
                  </span>
                  {targetScope === 'Residential' && <Check className="h-4 w-4 text-emerald-400" />}
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  Regular domestic community connections ({residentialConsumersCount} registered accounts).
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-emerald-900/60 flex items-center justify-between text-xs font-mono font-bold text-emerald-300">
                <span>Proposed Base:</span>
                <span>₱{effectiveResRate.toFixed(2)}/m³</span>
              </div>
            </button>

            {/* Commercial */}
            <button
              type="button"
              onClick={() => setTargetScope('Commercial')}
              className={`p-4 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
                targetScope === 'Commercial'
                  ? 'bg-blue-950/70 border-blue-500 ring-2 ring-blue-500/40 shadow-lg'
                  : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 opacity-75 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="inline-flex items-center space-x-1.5 text-xs font-black text-blue-300">
                    <Building2 className="h-4 w-4 text-blue-400" />
                    <span>Commercial Accounts</span>
                  </span>
                  {targetScope === 'Commercial' && <Check className="h-4 w-4 text-blue-400" />}
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  Private enterprises & high-volume commercial accounts ({commercialConsumersCount} registered accounts).
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-blue-900/60 flex items-center justify-between text-xs font-mono font-bold text-blue-300">
                <span>Proposed Base:</span>
                <span>₱{effectiveCommRate.toFixed(2)}/m³</span>
              </div>
            </button>

            {/* Both */}
            <button
              type="button"
              onClick={() => setTargetScope('both')}
              className={`p-4 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
                targetScope === 'both'
                  ? 'bg-purple-950/70 border-purple-500 ring-2 ring-purple-500/40 shadow-lg'
                  : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 opacity-75 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="inline-flex items-center space-x-1.5 text-xs font-black text-purple-300">
                    <Layers className="h-4 w-4 text-purple-400" />
                    <span>Both Classifications</span>
                  </span>
                  {targetScope === 'both' && <Check className="h-4 w-4 text-purple-400" />}
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  Apply proportional adjustment to both Residential and Commercial tiers simultaneously.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-purple-900/60 flex items-center justify-between text-xs font-mono font-bold text-purple-300">
                <span>Dual Scope:</span>
                <span>Res ₱{effectiveResRate.toFixed(2)} • Comm ₱{effectiveCommRate.toFixed(2)}</span>
              </div>
            </button>
          </div>
        </div>

        {/* STEP 2: Adjustment Mode (Quick Hike vs Direct Bracket Tuning) */}
        <div className="space-y-4 pb-5 border-b border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="h-6 w-6 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center">2</span>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Set Your Adjustment Values
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Use the Quick Hike tool or switch to Manual Tier Tuning for precise bracket control.
              </p>
            </div>

            <div className="inline-flex p-1 bg-slate-950 rounded-xl border border-slate-800 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setAdjustmentMode('quick')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center space-x-1.5 ${
                  adjustmentMode === 'quick' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                <span>Quick Hike</span>
              </button>
              <button
                type="button"
                onClick={() => setAdjustmentMode('manual')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center space-x-1.5 ${
                  adjustmentMode === 'manual' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>Manual Bracket Tuning</span>
              </button>
            </div>
          </div>

          {adjustmentMode === 'quick' ? (
            /* Quick Hike Mode */
            <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-300">Adjustment Type:</span>
                <div className="inline-flex p-1 bg-slate-900 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickType('flat_m3');
                      applyQuickFlatHike(quickFlatValue);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer flex items-center space-x-1 ${
                      quickType === 'flat_m3' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <DollarSign className="h-3.5 w-3.5" />
                    <span>Flat Increase (+₱/m³)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickType('percentage');
                      applyQuickPercentHike(quickPercentValue);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer flex items-center space-x-1 ${
                      quickType === 'percentage' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Percent className="h-3.5 w-3.5" />
                    <span>Percentage (+%)</span>
                  </button>
                </div>
              </div>

              {quickType === 'flat_m3' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">Quick Presets:</span>
                    {[1.00, 1.50, 2.00, 3.00, 5.00].map(amt => (
                      <button
                        key={`preset-${amt}`}
                        type="button"
                        onClick={() => applyQuickFlatHike(amt)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition cursor-pointer border ${
                          quickFlatValue === amt 
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs' 
                            : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border-slate-700'
                        }`}
                      >
                        +₱{amt.toFixed(2)}/m³
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center space-x-2 max-w-xs">
                    <span className="text-xs text-slate-400 font-bold whitespace-nowrap">Custom Amount:</span>
                    <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 flex-1">
                      <span className="text-xs font-bold text-slate-400 mr-1.5">₱</span>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max="100"
                        value={quickFlatValue}
                        onChange={(e) => applyQuickFlatHike(Number(e.target.value) || 0)}
                        className="w-full text-xs font-mono font-bold text-white bg-transparent focus:outline-hidden"
                      />
                      <span className="text-xs text-slate-400 font-mono">/m³</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">Quick Presets:</span>
                    {[5, 10, 15, 20, 25].map(pct => (
                      <button
                        key={`preset-pct-${pct}`}
                        type="button"
                        onClick={() => applyQuickPercentHike(pct)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition cursor-pointer border ${
                          quickPercentValue === pct 
                            ? 'bg-blue-600 text-white border-blue-500 shadow-xs' 
                            : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border-slate-700'
                        }`}
                      >
                        +{pct}%
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center space-x-2 max-w-xs">
                    <span className="text-xs text-slate-400 font-bold whitespace-nowrap">Custom Percentage:</span>
                    <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 flex-1">
                      <span className="text-xs font-bold text-slate-400 mr-1.5">+</span>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="100"
                        value={quickPercentValue}
                        onChange={(e) => applyQuickPercentHike(Number(e.target.value) || 0)}
                        className="w-full text-xs font-mono font-bold text-white bg-transparent focus:outline-hidden"
                      />
                      <span className="text-xs text-slate-400 font-mono">%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Manual Bracket Tuning Mode */
            <div className="bg-slate-950 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-4">
              <div className="text-xs font-bold text-slate-300">
                Direct Bracket Rates for <strong className="text-white uppercase">{targetScope}</strong>:
              </div>

              {(targetScope === 'both' || targetScope === 'Residential') && (
                <div className="space-y-2">
                  <span className="text-[11px] font-black uppercase text-emerald-400 tracking-wider flex items-center gap-1.5">
                    <Home className="h-3.5 w-3.5" />
                    <span>Residential Rates (₱/m³)</span>
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs">
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">0–10 m³ Base</span>
                      <input
                        type="number"
                        step="0.25"
                        value={formConfig.residential.ratePerM3 ?? formConfig.residential.baseMinCharge}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setFormConfig({
                            ...formConfig,
                            residential: { ...formConfig.residential, ratePerM3: val, baseMinCharge: val }
                          });
                        }}
                        className="w-full font-bold text-emerald-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">11–20 m³</span>
                      <input
                        type="number"
                        step="0.25"
                        value={formConfig.residential.tier1_rate}
                        onChange={(e) => setFormConfig({
                          ...formConfig,
                          residential: { ...formConfig.residential, tier1_rate: Number(e.target.value) || 0 }
                        })}
                        className="w-full font-bold text-emerald-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">21–30 m³</span>
                      <input
                        type="number"
                        step="0.25"
                        value={formConfig.residential.tier2_rate}
                        onChange={(e) => setFormConfig({
                          ...formConfig,
                          residential: { ...formConfig.residential, tier2_rate: Number(e.target.value) || 0 }
                        })}
                        className="w-full font-bold text-emerald-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">31–40 m³</span>
                      <input
                        type="number"
                        step="0.25"
                        value={formConfig.residential.tier3_rate}
                        onChange={(e) => setFormConfig({
                          ...formConfig,
                          residential: { ...formConfig.residential, tier3_rate: Number(e.target.value) || 0 }
                        })}
                        className="w-full font-bold text-emerald-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">41+ m³</span>
                      <input
                        type="number"
                        step="0.25"
                        value={formConfig.residential.tier4_rate}
                        onChange={(e) => setFormConfig({
                          ...formConfig,
                          residential: { ...formConfig.residential, tier4_rate: Number(e.target.value) || 0 }
                        })}
                        className="w-full font-bold text-emerald-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              {(targetScope === 'both' || targetScope === 'Commercial') && (
                <div className="space-y-2 pt-2">
                  <span className="text-[11px] font-black uppercase text-blue-400 tracking-wider flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>Commercial Rates (₱/m³)</span>
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs">
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">0–10 m³ Base</span>
                      <input
                        type="number"
                        step="0.50"
                        value={formConfig.commercial.ratePerM3 ?? formConfig.commercial.baseMinCharge}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setFormConfig({
                            ...formConfig,
                            commercial: { ...formConfig.commercial, ratePerM3: val, baseMinCharge: val }
                          });
                        }}
                        className="w-full font-bold text-blue-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">11–20 m³</span>
                      <input
                        type="number"
                        step="0.50"
                        value={formConfig.commercial.tier1_rate}
                        onChange={(e) => setFormConfig({
                          ...formConfig,
                          commercial: { ...formConfig.commercial, tier1_rate: Number(e.target.value) || 0 }
                        })}
                        className="w-full font-bold text-blue-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">21–30 m³</span>
                      <input
                        type="number"
                        step="0.50"
                        value={formConfig.commercial.tier2_rate}
                        onChange={(e) => setFormConfig({
                          ...formConfig,
                          commercial: { ...formConfig.commercial, tier2_rate: Number(e.target.value) || 0 }
                        })}
                        className="w-full font-bold text-blue-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">31–40 m³</span>
                      <input
                        type="number"
                        step="0.50"
                        value={formConfig.commercial.tier3_rate}
                        onChange={(e) => setFormConfig({
                          ...formConfig,
                          commercial: { ...formConfig.commercial, tier3_rate: Number(e.target.value) || 0 }
                        })}
                        className="w-full font-bold text-blue-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">41+ m³</span>
                      <input
                        type="number"
                        step="0.50"
                        value={formConfig.commercial.tier4_rate}
                        onChange={(e) => setFormConfig({
                          ...formConfig,
                          commercial: { ...formConfig.commercial, tier4_rate: Number(e.target.value) || 0 }
                        })}
                        className="w-full font-bold text-blue-300 bg-transparent focus:outline-hidden mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* STEP 3: Live Bill Impact Simulator & Comparison */}
        <div className="space-y-3 pb-5 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <span className="h-6 w-6 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center">3</span>
            <h3 className="text-sm font-black text-white uppercase tracking-wider">
              Live Consumer Bill Impact Preview
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[10, 18, 30].map(vol => {
              const bOld = calculateWaterTariff(vol, simClass, activeTariff);
              const tOld = calculateFranchiseTax(bOld, activeTariff);
              const totOld = Math.round((bOld + tOld) * 100) / 100;

              const bNew = calculateWaterTariff(vol, simClass, formConfig);
              const tNew = calculateFranchiseTax(bNew, formConfig);
              const totNew = Math.round((bNew + tNew) * 100) / 100;

              const diff = Math.round((totNew - totOld) * 100) / 100;

              return (
                <div key={`sim-${vol}`} className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs font-bold text-white">
                      {vol === 10 ? '10 m³ (Base Lifeline)' : vol === 18 ? '18 m³ (Avg Household)' : '30 m³ (Heavy Usage)'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{vol} m³</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">Current: ₱{totOld.toFixed(2)}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                    <span className="font-bold text-white">New: ₱{totNew.toFixed(2)}</span>
                  </div>
                  <div className="pt-1.5 border-t border-slate-800/80 flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">Net Difference:</span>
                    <span className={`font-mono font-bold ${diff > 0 ? 'text-amber-400' : diff < 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {diff >= 0 ? `+₱${diff.toFixed(2)}` : `-₱${Math.abs(diff).toFixed(2)}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Implementation Details & Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="space-y-3">
            <div>
              <label htmlFor={formEffectiveDateId} className="block text-[11px] font-bold text-slate-300 uppercase mb-1">
                Effective Date
              </label>
              <input
                id={formEffectiveDateId}
                type="text"
                value={formConfig.effectiveDate}
                onChange={(e) => setFormConfig({ ...formConfig, effectiveDate: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-white focus:outline-hidden focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor={formResolutionNumberId} className="block text-[11px] font-bold text-slate-300 uppercase mb-1">
                Board Resolution Number
              </label>
              <input
                id={formResolutionNumberId}
                type="text"
                value={formConfig.resolutionNumber}
                onChange={(e) => setFormConfig({ ...formConfig, resolutionNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono font-bold text-white focus:outline-hidden focus:border-blue-500"
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-start space-x-2.5 cursor-pointer hover:border-slate-700 transition">
              <input
                type="checkbox"
                checked={notifyAllConsumers}
                onChange={(e) => setNotifyAllConsumers(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded-sm text-emerald-600 accent-emerald-600"
              />
              <span className="text-xs text-slate-300 leading-snug">
                Send automatic in-app price adjustment notice to affected consumers ({targetScope === 'both' ? 'All' : targetScope}).
              </span>
            </label>

            <label className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-start space-x-2.5 cursor-pointer hover:border-slate-700 transition">
              <input
                type="checkbox"
                checked={postAnnouncement}
                onChange={(e) => setPostAnnouncement(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded-sm text-blue-600 accent-blue-600"
              />
              <span className="text-xs text-slate-300 leading-snug">
                Publish official public advisory on consumer portal announcements bulletin.
              </span>
            </label>
          </div>
        </div>

        {/* SINGLE UNIFIED SAVE BUTTON */}
        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-400">
            Applying to: <strong className="text-white uppercase">{targetScope}</strong> • Effective: <strong className="text-white">{formConfig.effectiveDate}</strong>
          </div>

          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            className="w-full sm:w-auto px-8 py-3.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider rounded-2xl shadow-lg shadow-blue-600/30 transition flex items-center justify-center space-x-2 cursor-pointer"
            id="apply-tariff-adjustment-btn"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>Review &amp; Apply Tariff Adjustment</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div 
          className="fixed inset-0 z-[120] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
          onClick={() => setShowConfirmModal(false)}
        >
          <div 
            className="bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-800 shadow-2xl p-6 sm:p-7 space-y-5 text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center space-x-3 text-amber-400">
              <div className="p-3 bg-amber-950/80 rounded-2xl border border-amber-800/80">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white tracking-tight">Confirm Water Tariff Adjustment</h3>
                <p className="text-xs text-slate-400 font-mono">{formConfig.resolutionNumber}</p>
              </div>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Target Classification:</span>
                <span className="font-bold text-white uppercase">{targetScope}</span>
              </div>
              {(targetScope === 'both' || targetScope === 'Residential') && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Residential Base (0–10 m³):</span>
                  <span className="font-mono font-bold text-emerald-400">
                    ₱{activeResRate.toFixed(2)}/m³ → ₱{effectiveResRate.toFixed(2)}/m³
                  </span>
                </div>
              )}
              {(targetScope === 'both' || targetScope === 'Commercial') && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Commercial Base (0–10 m³):</span>
                  <span className="font-mono font-bold text-blue-400">
                    ₱{activeCommRate.toFixed(2)}/m³ → ₱{effectiveCommRate.toFixed(2)}/m³
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">Effective Date:</span>
                <span className="font-bold text-white">{formConfig.effectiveDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Historical Readings:</span>
                <span className="font-bold text-emerald-400">Preserved &amp; Locked ({readings.length} bills)</span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              New rates will automatically apply to all NEW water meter readings going forward. Existing and historical bills remain protected at their original rates.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs uppercase rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyTariff}
                disabled={isApplying}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 cursor-pointer shadow-lg shadow-blue-600/30"
              >
                {isApplying ? <span>Applying...</span> : <span>Confirm &amp; Implement</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TariffRateManager;

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
  Calculator, 
  RotateCcw, 
  ShieldCheck, 
  Users, 
  Radio, 
  Sliders, 
  FileText, 
  Calendar, 
  Building2, 
  Home, 
  HelpCircle,
  Clock,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Flame,
  Layers,
  Zap,
  Check
} from 'lucide-react';
import { 
  WaterTariffConfig, 
  DEFAULT_TARIFF_CONFIG, 
  getActiveTariffConfig, 
  calculateWaterTariff, 
  calculateFranchiseTax 
} from '../../utils/tariffCalculator';
import { mockDb } from '../../mockDb';
import { User, Consumer, MeterReading, Announcement } from '../../types';
import { sendRealtimeMessage } from '../../services/realtimeSocket';
import { syncBatchToFirestore, COLLECTIONS } from '../../services/firebaseDb';
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
  setConsumers,
  readings,
  setReadings,
  setAnnouncements,
  onTariffApplied
}) => {
  const toast = useToast();

  // Active saved tariff
  const [activeTariff, setActiveTariff] = useState<WaterTariffConfig>(() => getActiveTariffConfig());

  // Form state for editing / proposing price hike
  const [formConfig, setFormConfig] = useState<WaterTariffConfig>(() => ({
    ...activeTariff,
    version: (activeTariff.version || 1) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser.name || 'Admin Operations Staff',
    effectiveDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    resolutionNumber: `TWD-BR-${new Date().getFullYear()}-${String(Math.floor(10 + Math.random() * 90))}`,
    memoNotes: 'Official Tagoloan Water District price hike adjustment to cover escalating electricity tariff, water treatment inputs, and municipal transmission pipeline maintenance.'
  }));

  // Target classification state: 'Residential' (Regular community / single account) | 'Commercial' (Private high-consumption accounts) | 'both'
  const [targetScope, setTargetScope] = useState<'Residential' | 'Commercial' | 'both'>('Residential');

  // Options toggles
  const [recalculateUnbilledReadings, setRecalculateUnbilledReadings] = useState(true);
  const [notifyAllConsumers, setNotifyAllConsumers] = useState(true);
  const [postAnnouncement, setPostAnnouncement] = useState(true);
  const [broadcastWebSocket, setBroadcastWebSocket] = useState(true);

  // Quick hike preset helpers
  const [percentageInput, setPercentageInput] = useState<number>(10);
  const [perM3HikeInput, setPerM3HikeInput] = useState<number>(2.00);
  const [baseHikeInput, setBaseHikeInput] = useState<number>(10.00);

  // Live impact simulator state
  const [simUsage, setSimUsage] = useState<number>(18);
  const [simType, setSimType] = useState<'Residential' | 'Commercial'>('Residential');

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Filtered account and statement counts
  const residentialConsumersCount = consumers.filter(
    c => c.consumerType !== 'Commercial' && c.accountNumber && !c.accountNumber.toUpperCase().startsWith('PENDING')
  ).length;
  const commercialConsumersCount = consumers.filter(
    c => c.consumerType === 'Commercial' && c.accountNumber && !c.accountNumber.toUpperCase().startsWith('PENDING')
  ).length;

  const residentialUnpaidCount = readings.filter(
    r => r.paymentStatus !== 'paid' && r.consumption > 0 && r.classification !== 'Commercial'
  ).length;
  const commercialUnpaidCount = readings.filter(
    r => r.paymentStatus !== 'paid' && r.consumption > 0 && r.classification === 'Commercial'
  ).length;

  // Quick percentage adjuster respecting targetScope (Residential vs Commercial)
  const handleApplyPercentageHike = (pct: number) => {
    const multiplier = 1 + (pct / 100);
    setFormConfig(prev => {
      const updated = { ...prev };
      if (targetScope === 'both' || targetScope === 'Residential') {
        updated.residential = {
          baseMinCharge: Math.round(prev.residential.baseMinCharge * multiplier * 100) / 100,
          tier1_rate: Math.round(prev.residential.tier1_rate * multiplier * 100) / 100,
          tier2_rate: Math.round(prev.residential.tier2_rate * multiplier * 100) / 100,
          tier3_rate: Math.round(prev.residential.tier3_rate * multiplier * 100) / 100,
          tier4_rate: Math.round(prev.residential.tier4_rate * multiplier * 100) / 100,
        };
      }
      if (targetScope === 'both' || targetScope === 'Commercial') {
        updated.commercial = {
          baseMinCharge: Math.round(prev.commercial.baseMinCharge * multiplier * 100) / 100,
          tier1_rate: Math.round(prev.commercial.tier1_rate * multiplier * 100) / 100,
          tier2_rate: Math.round(prev.commercial.tier2_rate * multiplier * 100) / 100,
          tier3_rate: Math.round(prev.commercial.tier3_rate * multiplier * 100) / 100,
          tier4_rate: Math.round(prev.commercial.tier4_rate * multiplier * 100) / 100,
          tier5_rate: Math.round(prev.commercial.tier5_rate * multiplier * 100) / 100,
        };
      }
      return updated;
    });

    if (targetScope === 'Residential') {
      toast.info(`Applied +${pct}% price hike to Residential (regular community / single-account) tiers only.`);
    } else if (targetScope === 'Commercial') {
      toast.info(`Applied +${pct}% price hike to Commercial (private high-consumption) tiers only.`);
    } else {
      toast.info(`Applied +${pct}% price hike across all meter reading tiers.`);
    }
  };

  // Quick per-cubic-meter hike respecting targetScope (Residential vs Commercial)
  const handleApplyPerM3Hike = (hikePerM3: number) => {
    setFormConfig(prev => {
      const updated = { ...prev };
      if (targetScope === 'both' || targetScope === 'Residential') {
        updated.residential = {
          ...prev.residential,
          tier1_rate: Math.round((prev.residential.tier1_rate + hikePerM3) * 100) / 100,
          tier2_rate: Math.round((prev.residential.tier2_rate + hikePerM3) * 100) / 100,
          tier3_rate: Math.round((prev.residential.tier3_rate + hikePerM3) * 100) / 100,
          tier4_rate: Math.round((prev.residential.tier4_rate + hikePerM3) * 100) / 100,
        };
      }
      if (targetScope === 'both' || targetScope === 'Commercial') {
        const commHike = targetScope === 'Commercial' ? hikePerM3 : Math.round((hikePerM3 * 1.5) * 100) / 100;
        updated.commercial = {
          ...prev.commercial,
          tier1_rate: Math.round((prev.commercial.tier1_rate + commHike) * 100) / 100,
          tier2_rate: Math.round((prev.commercial.tier2_rate + commHike) * 100) / 100,
          tier3_rate: Math.round((prev.commercial.tier3_rate + commHike) * 100) / 100,
          tier4_rate: Math.round((prev.commercial.tier4_rate + commHike) * 100) / 100,
          tier5_rate: Math.round((prev.commercial.tier5_rate + commHike) * 100) / 100,
        };
      }
      return updated;
    });

    if (targetScope === 'Residential') {
      toast.info(`Applied +₱${hikePerM3.toFixed(2)}/m³ hike to Residential (regular community / single-account) tiers only.`);
    } else if (targetScope === 'Commercial') {
      toast.info(`Applied +₱${hikePerM3.toFixed(2)}/m³ hike to Commercial (private high-consumption) tiers only.`);
    } else {
      toast.info(`Applied volumetric price hike (+₱${hikePerM3.toFixed(2)}/m³ Res, +₱${(hikePerM3 * 1.5).toFixed(2)}/m³ Comm).`);
    }
  };

  // Quick baseline minimum charge hike respecting targetScope
  const handleApplyBaseHike = (baseHike: number) => {
    setFormConfig(prev => {
      const updated = { ...prev };
      if (targetScope === 'both' || targetScope === 'Residential') {
        updated.residential = {
          ...prev.residential,
          baseMinCharge: Math.round((prev.residential.baseMinCharge + baseHike) * 100) / 100
        };
      }
      if (targetScope === 'both' || targetScope === 'Commercial') {
        const commBaseHike = targetScope === 'Commercial' ? baseHike : Math.round((baseHike * 1.5) * 100) / 100;
        updated.commercial = {
          ...prev.commercial,
          baseMinCharge: Math.round((prev.commercial.baseMinCharge + commBaseHike) * 100) / 100
        };
      }
      return updated;
    });

    if (targetScope === 'Residential') {
      toast.info(`Applied +₱${baseHike.toFixed(2)} lifeline minimum charge hike to Residential community accounts only.`);
    } else if (targetScope === 'Commercial') {
      toast.info(`Applied +₱${baseHike.toFixed(2)} lifeline minimum charge hike to Commercial private accounts only.`);
    } else {
      toast.info(`Applied +₱${baseHike.toFixed(2)} lifeline minimum charge hike.`);
    }
  };

  // Reset to default baseline
  const handleResetToBaseline = () => {
    setFormConfig({
      ...DEFAULT_TARIFF_CONFIG,
      version: (activeTariff.version || 1) + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name || 'Admin Operations Staff',
      effectiveDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      resolutionNumber: 'TWD-LWUA-RESTORED',
      memoNotes: 'Standard baseline rates under PD 198 and LWUA guidelines restored.'
    });
    toast.info('Reset form rates to Tagoloan standard baseline.');
  };

  // Calculation for live simulation
  const currentSimBill = calculateWaterTariff(simUsage, simType, activeTariff);
  const currentSimTax = calculateFranchiseTax(currentSimBill, activeTariff);
  const currentSimTotal = Math.round((currentSimBill + currentSimTax) * 100) / 100;

  const proposedSimBill = calculateWaterTariff(simUsage, simType, formConfig);
  const proposedSimTax = calculateFranchiseTax(proposedSimBill, formConfig);
  const proposedSimTotal = Math.round((proposedSimBill + proposedSimTax) * 100) / 100;

  const simDiff = Math.round((proposedSimTotal - currentSimTotal) * 100) / 100;
  const simPercentDiff = currentSimTotal > 0 ? Math.round(((proposedSimTotal - currentSimTotal) / currentSimTotal) * 100) : 0;

  // Unpaid readings count according to current target scope
  const isResTargeted = targetScope === 'both' || targetScope === 'Residential';
  const isCommTargeted = targetScope === 'both' || targetScope === 'Commercial';

  const targetedUnpaidReadingsCount = readings.filter(r => {
    if (r.paymentStatus === 'paid' || r.consumption <= 0) return false;
    const isComm = r.classification === 'Commercial';
    return (isComm && isCommTargeted) || (!isComm && isResTargeted);
  }).length;

  const targetedConsumersCount = consumers.filter(c => {
    if (!c.accountNumber || c.accountNumber.toUpperCase().startsWith('PENDING')) return false;
    const isComm = c.consumerType === 'Commercial';
    return (isComm && isCommTargeted) || (!isComm && isResTargeted);
  }).length;

  // Commit and Implement Price Hike with Identification of Residential vs Commercial
  const handleCommitTariffHike = () => {
    setIsApplying(true);

    try {
      const finalConfig: WaterTariffConfig = {
        ...formConfig,
        residential: isResTargeted ? formConfig.residential : activeTariff.residential,
        commercial: isCommTargeted ? formConfig.commercial : activeTariff.commercial,
        version: (activeTariff.version || 1) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name || 'Administrator',
      };

      // 1. Save active tariff config in mockDb, localStorage, and Firestore
      mockDb.saveTariffConfig(finalConfig);
      setActiveTariff(finalConfig);

      let updatedReadingsCount = 0;

      // 2. Automatically recalculate price hike in unbilled readings for targeted classification only
      if (recalculateUnbilledReadings) {
        const allReadings = mockDb.getReadings();
        const updated = allReadings.map(r => {
          if (r.paymentStatus !== 'paid' && r.consumption > 0) {
            const isCommReading = r.classification === 'Commercial';
            const shouldRecalculate = (isCommReading && isCommTargeted) || (!isCommReading && isResTargeted);

            if (shouldRecalculate) {
              updatedReadingsCount++;
              const newBasicBill = calculateWaterTariff(r.consumption, r.classification || 'Residential', finalConfig);
              const newTax = calculateFranchiseTax(newBasicBill, finalConfig);
              const oldPaid = r.paidAmount || 0;
              const newTotal = Math.round((newBasicBill + newTax + (r.arrears || 0)) * 100) / 100;
              const newRemaining = Math.max(0, newTotal - oldPaid);
              return {
                ...r,
                billAmount: newBasicBill,
                franchiseTax: newTax,
                totalAmount: newTotal,
                remainingBalance: newRemaining
              };
            }
          }
          return r;
        });
        mockDb.saveReadings(updated);
        setReadings(updated);

        // Update each consumer's total outstandingBalance to match their updated readings
        const allConsumers = mockDb.getConsumers();
        const consumerBalanceMap: Record<string, number> = {};
        updated.forEach(r => {
          if (r.paymentStatus !== 'paid' && r.remainingBalance !== undefined) {
            consumerBalanceMap[r.accountNumber] = (consumerBalanceMap[r.accountNumber] || 0) + (r.remainingBalance || 0);
          }
        });

        const updatedConsumers = allConsumers.map(c => {
          if (consumerBalanceMap[c.accountNumber] !== undefined) {
            return { ...c, outstandingBalance: Math.round(consumerBalanceMap[c.accountNumber] * 100) / 100 };
          }
          return c;
        });
        mockDb.saveConsumers(updatedConsumers);
        if (setConsumers) {
          setConsumers(updatedConsumers);
        }

        // Batch sync updated readings and consumers to Firestore
        syncBatchToFirestore(COLLECTIONS.READINGS, updated, 'id');
        syncBatchToFirestore(COLLECTIONS.CONSUMERS, updatedConsumers, 'id');
      }

      // 3. Automatically notify consumers of the targeted classification
      let notifiedConsumersCount = 0;
      if (notifyAllConsumers) {
        const allConsumers = mockDb.getConsumers();
        const resBase = finalConfig.residential.baseMinCharge;
        const commBase = finalConfig.commercial.baseMinCharge;
        const oldResBase = activeTariff.residential.baseMinCharge;
        const oldCommBase = activeTariff.commercial.baseMinCharge;

        allConsumers.forEach(consumer => {
          if (!consumer.accountNumber || consumer.accountNumber.toUpperCase().startsWith('PENDING')) {
            return;
          }
          const isComm = consumer.consumerType === 'Commercial';

          // Strictly filter notification by target classification
          if (isComm && !isCommTargeted) return;
          if (!isComm && !isResTargeted) return;

          notifiedConsumersCount++;

          if (isComm) {
            // Tailored Commercial Private Account Notification
            mockDb.addNotification({
              accountNumber: consumer.accountNumber,
              consumerId: consumer.id,
              userId: consumer.linkedUserId,
              consumerEmail: consumer.email,
              title: `Official Advisory: Commercial Water Tariff Adjustment (${finalConfig.resolutionNumber})`,
              message: `Notice to Commercial Private Account #${consumer.accountNumber} (${consumer.name}): Pursuant to Board Resolution ${finalConfig.resolutionNumber}, Tagoloan Water District has adjusted commercial private account rates effective ${finalConfig.effectiveDate} to reflect heavy volume water consumption. Your commercial lifeline base charge (1-10 m³) is adjusted from ₱${oldCommBase.toFixed(2)} to ₱${commBase.toFixed(2)}, with Tier 1 consumption at ₱${finalConfig.commercial.tier1_rate.toFixed(2)}/m³. Unbilled commercial readings have been recalculated. Justification: ${finalConfig.memoNotes}`,
              type: 'billing'
            });
          } else {
            // Tailored Residential Community Household Notification (Individual / Single Account)
            mockDb.addNotification({
              accountNumber: consumer.accountNumber,
              consumerId: consumer.id,
              userId: consumer.linkedUserId,
              consumerEmail: consumer.email,
              title: `Official Advisory: Residential Water Tariff Adjustment (${finalConfig.resolutionNumber})`,
              message: `Notice to Account #${consumer.accountNumber} (${consumer.name}): Pursuant to Board Resolution ${finalConfig.resolutionNumber}, Tagoloan Water District has adjusted regular Residential community water rates effective ${finalConfig.effectiveDate}. Your Residential lifeline base charge (1-10 m³) is adjusted from ₱${oldResBase.toFixed(2)} to ₱${resBase.toFixed(2)}, with Tier 1 domestic consumption at ₱${finalConfig.residential.tier1_rate.toFixed(2)}/m³. Handled on your individual account holder record. (Commercial private rates remain separate). Justification: ${finalConfig.memoNotes}`,
              type: 'billing'
            });
          }
        });

        // Broadcast real-time notification alert to connected consumers
        const scopeLabel = targetScope === 'Residential' ? 'Residential Community' : targetScope === 'Commercial' ? 'Commercial Private' : 'Residential and Commercial';
        sendRealtimeMessage('notification:new', {
          title: `Official Advisory: ${scopeLabel} Water Tariff Adjustment (${finalConfig.resolutionNumber})`,
          message: `Water service rates for ${scopeLabel} accounts have been officially updated under ${finalConfig.resolutionNumber} effective ${finalConfig.effectiveDate}.`,
          type: 'billing'
        });
      }

      // 4. Publish official public advisory announcement
      if (postAnnouncement) {
        let annTitle = `District Advisory: Water Tariff Rate Adjustment (${finalConfig.resolutionNumber})`;
        let annContent = '';

        if (targetScope === 'Residential') {
          annTitle = `District Advisory: Residential Water Tariff Adjustment (${finalConfig.resolutionNumber})`;
          annContent = `Notice to Tagoloan Residential Community Consumers: Effective ${finalConfig.effectiveDate}, an official water tariff adjustment has been implemented for regular Residential community accounts under Board Resolution ${finalConfig.resolutionNumber}. Residential Lifeline (1-10 m³): ₱${finalConfig.residential.baseMinCharge.toFixed(2)} (adjusted from ₱${activeTariff.residential.baseMinCharge.toFixed(2)}). Handled per individual single-account holder. Commercial private rates remain unchanged. Justification: ${finalConfig.memoNotes}`;
        } else if (targetScope === 'Commercial') {
          annTitle = `District Advisory: Commercial Private Account Tariff Adjustment (${finalConfig.resolutionNumber})`;
          annContent = `Notice to Tagoloan Commercial & Private Enterprise Accounts: Effective ${finalConfig.effectiveDate}, an official water tariff adjustment has been implemented for Commercial accounts under Board Resolution ${finalConfig.resolutionNumber} to cover high-volume water consumption. Commercial Lifeline (1-10 m³): ₱${finalConfig.commercial.baseMinCharge.toFixed(2)} (adjusted from ₱${activeTariff.commercial.baseMinCharge.toFixed(2)}). Regular Residential community rates remain unchanged. Justification: ${finalConfig.memoNotes}`;
        } else {
          annContent = `Notice to all Tagoloan Water District Consumers: Effective ${finalConfig.effectiveDate}, an official water tariff rate adjustment has been implemented under ${finalConfig.resolutionNumber}. Residential Lifeline (1-10 m³): ₱${finalConfig.residential.baseMinCharge.toFixed(2)} | Commercial Lifeline (1-10 m³): ₱${finalConfig.commercial.baseMinCharge.toFixed(2)}. ${finalConfig.memoNotes}`;
        }

        const newAnn: Announcement = {
          id: `ann-tariff-${Date.now()}`,
          title: annTitle,
          content: annContent,
          date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          category: 'info',
          postedBy: currentUser.name || 'Board of Directors / General Manager'
        };
        const currentAnns = mockDb.getAnnouncements();
        mockDb.saveAnnouncements([newAnn, ...currentAnns]);
        setAnnouncements(prev => [newAnn, ...prev]);
      }

      // 5. Real-time WebSocket broadcast to all connected consumers and reader tabs
      if (broadcastWebSocket) {
        sendRealtimeMessage('tariff:updated', {
          targetScope,
          resolutionNumber: finalConfig.resolutionNumber,
          effectiveDate: finalConfig.effectiveDate,
          residentialBase: finalConfig.residential.baseMinCharge,
          commercialBase: finalConfig.commercial.baseMinCharge,
          updatedBy: currentUser.name,
          message: `Official price adjustment implemented for ${targetScope.toUpperCase()} under ${finalConfig.resolutionNumber}.`
        });
      }

      // 6. Record official System Audit Log
      mockDb.addAuditLog(
        currentUser.id,
        currentUser.name,
        'admin',
        `Water Tariff Price Adjustment (${targetScope.toUpperCase()})`,
        `Adjusted ${targetScope} water tariff under ${finalConfig.resolutionNumber}. Res Base: ₱${finalConfig.residential.baseMinCharge}, Comm Base: ₱${finalConfig.commercial.baseMinCharge}. Effective ${finalConfig.effectiveDate}. Recalculated ${updatedReadingsCount} readings. Dispatched notifications to ${notifiedConsumersCount} ${targetScope} consumers.`
      );

      // 7. Dispatch local cross-tab event
      window.dispatchEvent(new CustomEvent('twd_database_updated'));
      window.dispatchEvent(new CustomEvent('twd_tariff_updated', { detail: finalConfig }));

      if (onTariffApplied) {
        onTariffApplied(finalConfig);
      }

      setShowConfirmModal(false);
      const scopeSummary = targetScope === 'Residential' ? 'Residential (Regular Community)' : targetScope === 'Commercial' ? 'Commercial (Private Accounts)' : 'All (Residential & Commercial)';
      toast.success(
        `Price adjustment successfully applied for ${scopeSummary}! ${notifiedConsumersCount} accounts notified and ${updatedReadingsCount} active statements updated.`
      );
    } catch (err: any) {
      toast.error(`Failed to implement price hike: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsApplying(false);
    }
  };

  const formEffectiveDateId = useId();
  const formResolutionNumberId = useId();
  const formMemoNotesId = useId();
  const formFranchiseTaxId = useId();
  const formLatePenaltyId = useId();

  return (
    <div className="space-y-6 animate-fade-in" id="tariff-rate-manager">
      
      {/* 1. Header Banner & Active Status */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white border border-blue-900/50 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 bg-blue-500/20 border border-blue-400/40 text-blue-300 font-black text-[10px] uppercase tracking-wider rounded-xl flex items-center space-x-1.5 shadow-xs">
                <Sparkles className="h-3.5 w-3.5 text-blue-400" />
                <span>LWUA & PD 198 RATE ENGINE</span>
              </span>
              <span className="px-3 py-1 bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-black text-[10px] uppercase tracking-wider rounded-xl flex items-center space-x-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Version {activeTariff.version || 1} Active</span>
              </span>
              <span className="px-3 py-1 bg-slate-800 text-slate-300 font-mono text-[10px] rounded-xl border border-slate-700">
                {activeTariff.resolutionNumber}
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Water Tariff Schedule & Price Hike Implementation Center
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              Authorized staff can configure baseline lifeline charges, progressive volumetric brackets, and statutory taxes. 
              Price hike adjustments automatically recalculate active meter readings and dispatch instant official notifications to all consumer accounts.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0 w-full sm:w-auto">
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 text-center min-w-[200px]">
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Current Residential Lifeline</span>
              <div className="text-2xl font-black text-emerald-400 font-mono mt-0.5">
                ₱{activeTariff.residential.baseMinCharge.toFixed(2)}
              </div>
              <span className="text-[10px] text-slate-400">1 – 10 m³ Baseline</span>
            </div>
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 text-center min-w-[200px]">
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Current Commercial Lifeline</span>
              <div className="text-2xl font-black text-blue-400 font-mono mt-0.5">
                ₱{activeTariff.commercial.baseMinCharge.toFixed(2)}
              </div>
              <span className="text-[10px] text-slate-400">1 – 10 m³ Baseline</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Meter Reading Price Hike Controller & Quick Surcharge Tools */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5 text-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2">
              <span className="p-1.5 bg-blue-950 text-blue-400 rounded-lg border border-blue-800/80">
                <Flame className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Meter Reading Price Hike Controller & Quick Surcharge Tools
              </h3>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              Set or adjust price hikes that directly apply to every consumer meter reading. Changes automatically recalculate active statements and notify all registered accounts.
            </p>
          </div>
          <button
            onClick={handleResetToBaseline}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center space-x-1.5 self-start sm:self-auto cursor-pointer border border-slate-700"
            title="Reset form values to standard LWUA base rates"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset to Standard Baseline</span>
          </button>
        </div>

        {/* CLASSIFICATION IDENTIFIER: Residential vs Commercial */}
        <div className="bg-slate-950 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
            <div>
              <div className="flex items-center space-x-2">
                <Sliders className="h-4 w-4 text-sky-400" />
                <h4 className="text-xs font-black uppercase text-white tracking-wider">
                  Identify Target Account Classification for Price Adjustment
                </h4>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Residential and Commercial accounts do not share the same pricing. Commercial accounts are private entities with expensive, high-volume water consumption, while Residential is community use water consumption handled per single individual account holder.
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-700 text-[10px] font-black uppercase tracking-wider text-slate-300 shrink-0 self-start sm:self-auto">
              <span>Active Target:</span>
              <strong className={targetScope === 'Residential' ? 'text-emerald-400' : targetScope === 'Commercial' ? 'text-blue-400' : 'text-purple-400'}>
                {targetScope === 'Residential' ? 'Residential (Regular Community)' : targetScope === 'Commercial' ? 'Commercial (Private Accounts)' : 'Both Classifications'}
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {/* Option 1: Residential Only */}
            <button
              type="button"
              onClick={() => {
                setTargetScope('Residential');
                setSimType('Residential');
              }}
              className={`p-3.5 rounded-2xl border text-left transition cursor-pointer relative flex flex-col justify-between ${
                targetScope === 'Residential'
                  ? 'bg-emerald-950/70 border-emerald-500 ring-2 ring-emerald-500/30 shadow-md'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 opacity-80 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="inline-flex items-center space-x-1.5 text-xs font-black text-emerald-300">
                    <Home className="h-4 w-4 text-emerald-400" />
                    <span>Residential Accounts</span>
                  </span>
                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300">
                    Regular Price
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  Community use water consumption. Handled with single / individual account persons (not company or group based). Standard affordable domestic rate.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-emerald-900/60 flex items-center justify-between text-[10px] font-mono text-emerald-200">
                <span>{residentialConsumersCount} accounts • {residentialUnpaidCount} unbilled</span>
                <span className="font-bold text-white">₱{formConfig.residential.baseMinCharge.toFixed(2)} Base</span>
              </div>
            </button>

            {/* Option 2: Commercial Only */}
            <button
              type="button"
              onClick={() => {
                setTargetScope('Commercial');
                setSimType('Commercial');
              }}
              className={`p-3.5 rounded-2xl border text-left transition cursor-pointer relative flex flex-col justify-between ${
                targetScope === 'Commercial'
                  ? 'bg-blue-950/70 border-blue-500 ring-2 ring-blue-500/30 shadow-md'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 opacity-80 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="inline-flex items-center space-x-1.5 text-xs font-black text-blue-300">
                    <Building2 className="h-4 w-4 text-blue-400" />
                    <span>Commercial Accounts</span>
                  </span>
                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-blue-950 border border-blue-700 text-blue-300">
                    Private / Heavy Use
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  Private commercial accounts with the most expensive water consumption rates. Designed for business operations and high volumetric demand.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-blue-900/60 flex items-center justify-between text-[10px] font-mono text-blue-200">
                <span>{commercialConsumersCount} accounts • {commercialUnpaidCount} unbilled</span>
                <span className="font-bold text-white">₱{formConfig.commercial.baseMinCharge.toFixed(2)} Base</span>
              </div>
            </button>

            {/* Option 3: Both Residential & Commercial */}
            <button
              type="button"
              onClick={() => {
                setTargetScope('both');
              }}
              className={`p-3.5 rounded-2xl border text-left transition cursor-pointer relative flex flex-col justify-between ${
                targetScope === 'both'
                  ? 'bg-purple-950/70 border-purple-500 ring-2 ring-purple-500/30 shadow-md'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 opacity-80 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="inline-flex items-center space-x-1.5 text-xs font-black text-purple-300">
                    <Layers className="h-4 w-4 text-purple-400" />
                    <span>Both Classifications</span>
                  </span>
                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-purple-950 border border-purple-700 text-purple-300">
                    Dual Scope
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  Configure and apply price adjustments across both Residential and Commercial tiers simultaneously with distinct rates for each.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-purple-900/60 flex items-center justify-between text-[10px] font-mono text-purple-200">
                <span>{consumers.length} total accounts</span>
                <span className="font-bold text-white">Separate Rates</span>
              </div>
            </button>
          </div>
        </div>

        {/* 3 Quick Action Blocks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* A. Per-Cubic-Meter Hike */}
          <div className="p-4 bg-slate-950/80 border border-blue-900/60 rounded-2xl space-y-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-blue-300 flex items-center space-x-1.5">
                  <Zap className="h-3.5 w-3.5 text-blue-400" />
                  <span>Price Hike on Reading (+₱/m³)</span>
                </span>
                <span className="text-[10px] font-bold uppercase text-blue-300 bg-blue-950 border border-blue-800 px-2 py-0.5 rounded">Per m³</span>
              </div>
              <p className="text-[11px] text-slate-300 mt-1">
                Adds flat amount per cubic meter to progressive tiers.
              </p>
              <div className="mt-2 text-[10px] font-mono font-bold text-slate-300 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                Target: <strong className={targetScope === 'Residential' ? 'text-emerald-400' : targetScope === 'Commercial' ? 'text-blue-400' : 'text-purple-400'}>
                  {targetScope === 'Residential' ? 'Residential Only' : targetScope === 'Commercial' ? 'Commercial Only' : 'Both'}
                </strong>
              </div>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-1.5">
                {[1.00, 1.50, 2.00, 3.00].map(amt => (
                  <button
                    key={`m3-${amt}`}
                    type="button"
                    onClick={() => handleApplyPerM3Hike(amt)}
                    className="py-1.5 px-1 bg-slate-900 hover:bg-blue-600 hover:text-white border border-blue-800/80 text-blue-200 rounded-lg text-xs font-black transition cursor-pointer text-center"
                  >
                    +₱{amt.toFixed(amt % 1 === 0 ? 0 : 2)}
                  </button>
                ))}
              </div>

              <div className="flex items-center space-x-1.5 pt-1">
                <div className="flex items-center bg-slate-900 border border-blue-700/80 rounded-xl px-2 py-1 flex-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="50"
                    value={perM3HikeInput}
                    onChange={(e) => setPerM3HikeInput(Number(e.target.value) || 0)}
                    className="w-full text-xs font-mono font-bold text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 font-mono">/m³</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyPerM3Hike(perM3HikeInput)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shadow-sm"
                >
                  Apply Hike
                </button>
              </div>
            </div>
          </div>

          {/* B. Lifeline Base Minimum Charge Hike */}
          <div className="p-4 bg-slate-950/80 border border-emerald-900/60 rounded-2xl space-y-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-300 flex items-center space-x-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Lifeline Base Price Hike (+₱ Base)</span>
                </span>
                <span className="text-[10px] font-bold uppercase text-emerald-300 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">1-10 m³</span>
              </div>
              <p className="text-[11px] text-slate-300 mt-1">
                Adjusts minimum readiness charge for initial 10 m³.
              </p>
              <div className="mt-2 text-[10px] font-mono font-bold text-slate-300 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                Target: <strong className={targetScope === 'Residential' ? 'text-emerald-400' : targetScope === 'Commercial' ? 'text-blue-400' : 'text-purple-400'}>
                  {targetScope === 'Residential' ? 'Residential Only' : targetScope === 'Commercial' ? 'Commercial Only' : 'Both'}
                </strong>
              </div>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-1.5">
                {[5.00, 10.00, 15.00, 20.00].map(amt => (
                  <button
                    key={`base-${amt}`}
                    type="button"
                    onClick={() => handleApplyBaseHike(amt)}
                    className="py-1.5 px-1 bg-slate-900 hover:bg-emerald-600 hover:text-white border border-emerald-800/80 text-emerald-200 rounded-lg text-xs font-black transition cursor-pointer text-center"
                  >
                    +₱{amt.toFixed(0)}
                  </button>
                ))}
              </div>

              <div className="flex items-center space-x-1.5 pt-1">
                <div className="flex items-center bg-slate-900 border border-emerald-700/80 rounded-xl px-2 py-1 flex-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="100"
                    value={baseHikeInput}
                    onChange={(e) => setBaseHikeInput(Number(e.target.value) || 0)}
                    className="w-full text-xs font-mono font-bold text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 font-mono">Base</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyBaseHike(baseHikeInput)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shadow-sm"
                >
                  Apply Base
                </button>
              </div>
            </div>
          </div>

          {/* C. Percentage Price Hike */}
          <div className="p-4 bg-slate-950/80 border border-indigo-900/60 rounded-2xl space-y-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-indigo-300 flex items-center space-x-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Percentage Price Hike (+% Tiers)</span>
                </span>
                <span className="text-[10px] font-bold uppercase text-indigo-300 bg-indigo-950 border border-indigo-800 px-2 py-0.5 rounded">Proportional</span>
              </div>
              <p className="text-[11px] text-slate-300 mt-1">
                Escalates lifeline base and progressive volumetric brackets.
              </p>
              <div className="mt-2 text-[10px] font-mono font-bold text-slate-300 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                Target: <strong className={targetScope === 'Residential' ? 'text-emerald-400' : targetScope === 'Commercial' ? 'text-blue-400' : 'text-purple-400'}>
                  {targetScope === 'Residential' ? 'Residential Only' : targetScope === 'Commercial' ? 'Commercial Only' : 'Both'}
                </strong>
              </div>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-1.5">
                {[5, 10, 15, 20].map(pct => (
                  <button
                    key={`pct-${pct}`}
                    type="button"
                    onClick={() => handleApplyPercentageHike(pct)}
                    className="py-1.5 px-1 bg-slate-900 hover:bg-indigo-600 hover:text-white border border-indigo-800/80 text-indigo-200 rounded-lg text-xs font-black transition cursor-pointer text-center"
                  >
                    +{pct}%
                  </button>
                ))}
              </div>

              <div className="flex items-center space-x-1.5 pt-1">
                <div className="flex items-center bg-slate-900 border border-indigo-700/80 rounded-xl px-2 py-1 flex-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">+</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={percentageInput}
                    onChange={(e) => setPercentageInput(Number(e.target.value) || 0)}
                    className="w-full text-xs font-mono font-bold text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-xs font-bold text-slate-400 mr-1">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyPercentageHike(percentageInput)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shadow-sm"
                >
                  Apply %
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Live Reading Impact Matrix: Sample Consumers */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-xs font-black text-white uppercase tracking-wider flex items-center space-x-1.5">
                <Layers className="h-3.5 w-3.5 text-blue-400" />
                <span>Reading Impact Matrix: Before vs After Price Hike on Sample Meters</span>
              </span>
              <span className="text-[11px] text-slate-300">Live preview of how proposed rates alter bills across typical consumption volumes.</span>
            </div>
            <span className="text-[10px] font-bold text-slate-300 bg-slate-900 px-2.5 py-1 rounded-md border border-slate-700">
              Includes 2% Franchise Tax
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60">
                  <th className="py-2.5 px-3">Consumption Volume</th>
                  <th className="py-2.5 px-3">Customer Category</th>
                  <th className="py-2.5 px-3">Current Active Bill</th>
                  <th className="py-2.5 px-3">Proposed Price Hike Bill</th>
                  <th className="py-2.5 px-3 text-right">Net Price Increase</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                {[
                  { volume: 10, label: '10 m³ (Lifeline Minimum)', type: 'Residential' as const },
                  { volume: 16, label: '16 m³ (Average Domestic)', type: 'Residential' as const },
                  { volume: 25, label: '25 m³ (Standard Household)', type: 'Residential' as const },
                  { volume: 38, label: '38 m³ (High Domestic)', type: 'Residential' as const },
                  { volume: 30, label: '30 m³ (Small Business)', type: 'Commercial' as const },
                  { volume: 65, label: '65 m³ (Commercial Establishment)', type: 'Commercial' as const },
                ].map((sample, idx) => {
                  const currBasic = calculateWaterTariff(sample.volume, sample.type, activeTariff);
                  const currTax = calculateFranchiseTax(currBasic, activeTariff);
                  const currTotal = Math.round((currBasic + currTax) * 100) / 100;

                  const propBasic = calculateWaterTariff(sample.volume, sample.type, formConfig);
                  const propTax = calculateFranchiseTax(propBasic, formConfig);
                  const propTotal = Math.round((propBasic + propTax) * 100) / 100;

                  const diff = Math.round((propTotal - currTotal) * 100) / 100;
                  const pctChange = currTotal > 0 ? Math.round(((propTotal - currTotal) / currTotal) * 100) : 0;

                  return (
                    <tr key={`sample-read-${idx}`} className="hover:bg-slate-900/70 transition">
                      <td className="py-2.5 px-3 font-sans font-bold text-slate-100">{sample.label}</td>
                      <td className="py-2.5 px-3 font-sans">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                          sample.type === 'Commercial' ? 'bg-blue-950 text-blue-300 border-blue-800' : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        }`}>
                          {sample.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">₱{currTotal.toFixed(2)}</td>
                      <td className="py-2.5 px-3 font-bold text-white">₱{propTotal.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={`inline-flex items-center space-x-1 font-bold ${
                          diff > 0 ? 'text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/80' : 'text-slate-400'
                        }`}>
                          <span>{diff >= 0 ? `+₱${diff.toFixed(2)}` : `-₱${Math.abs(diff).toFixed(2)}`}</span>
                          <span className="text-[10px] opacity-75">({pctChange >= 0 ? `+${pctChange}%` : `${pctChange}%`})</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 3. Granular Tariff Brackets Form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* RESIDENTIAL TARIFF SCHEDULE */}
        <div className={`bg-slate-900 border rounded-3xl p-6 shadow-xl space-y-5 text-slate-100 transition-all ${
          targetScope === 'Residential' ? 'border-emerald-500/80 ring-2 ring-emerald-500/20' : 'border-slate-800'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-emerald-950 text-emerald-400 rounded-xl border border-emerald-800/80">
                <Home className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-black text-white uppercase tracking-wider">
                  Residential Tariff Schedule (Regular Community)
                </h4>
                <p className="text-[11px] text-slate-300">Single individual / family community consumption</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-black uppercase rounded-lg">
                Regular Price
              </span>
              <button
                type="button"
                onClick={() => {
                  setTargetScope('Residential');
                  setShowConfirmModal(true);
                }}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center space-x-1 shadow-xs"
                title="Apply changes to Residential community accounts only"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Apply Residential</span>
              </button>
            </div>
          </div>

          <div className="p-3 bg-emerald-950/40 border border-emerald-900/60 rounded-2xl text-[11px] text-emerald-200/90 leading-relaxed">
            <strong className="text-emerald-300 font-bold block mb-0.5">Community Use Water Consumption:</strong>
            Handled on an individual/single-account person basis (not based on a company or groups). Standard affordable regular pricing under municipal utility regulations.
          </div>

          <div className="space-y-4">
            {/* Lifeline Base */}
            <div className="p-3.5 bg-slate-950/80 border border-emerald-900/60 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-black text-white block">Lifeline Base (1 – 10 m³)</span>
                <span className="text-[10px] text-slate-300">Readiness-to-serve minimum charge</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">Current: ₱{activeTariff.residential.baseMinCharge.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-emerald-700/80 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.25"
                    min="1"
                    value={formConfig.residential.baseMinCharge}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      residential: { ...formConfig.residential, baseMinCharge: Number(e.target.value) || 0 }
                    })}
                    className="w-20 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* Tier 1: 11 - 20 m³ */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Tier 1: 11 – 20 m³</span>
                <span className="text-[10px] text-slate-300">Incremental volumetric rate per m³</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">₱{activeTariff.residential.tier1_rate.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    value={formConfig.residential.tier1_rate}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      residential: { ...formConfig.residential, tier1_rate: Number(e.target.value) || 0 }
                    })}
                    className="w-16 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 ml-1">/m³</span>
                </div>
              </div>
            </div>

            {/* Tier 2: 21 - 30 m³ */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Tier 2: 21 – 30 m³</span>
                <span className="text-[10px] text-slate-300">Incremental volumetric rate per m³</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">₱{activeTariff.residential.tier2_rate.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    value={formConfig.residential.tier2_rate}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      residential: { ...formConfig.residential, tier2_rate: Number(e.target.value) || 0 }
                    })}
                    className="w-16 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 ml-1">/m³</span>
                </div>
              </div>
            </div>

            {/* Tier 3: 31 - 40 m³ */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Tier 3: 31 – 40 m³</span>
                <span className="text-[10px] text-slate-300">Incremental volumetric rate per m³</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">₱{activeTariff.residential.tier3_rate.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    value={formConfig.residential.tier3_rate}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      residential: { ...formConfig.residential, tier3_rate: Number(e.target.value) || 0 }
                    })}
                    className="w-16 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 ml-1">/m³</span>
                </div>
              </div>
            </div>

            {/* Tier 4: 41+ m³ */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Tier 4: 41+ m³</span>
                <span className="text-[10px] text-slate-300">Heavy residential consumption per m³</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">₱{activeTariff.residential.tier4_rate.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    value={formConfig.residential.tier4_rate}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      residential: { ...formConfig.residential, tier4_rate: Number(e.target.value) || 0 }
                    })}
                    className="w-16 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 ml-1">/m³</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* COMMERCIAL TARIFF SCHEDULE */}
        <div className={`bg-slate-900 border rounded-3xl p-6 shadow-xl space-y-5 text-slate-100 transition-all ${
          targetScope === 'Commercial' ? 'border-blue-500/80 ring-2 ring-blue-500/20' : 'border-slate-800'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-blue-950 text-blue-400 rounded-xl border border-blue-800/80">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-black text-white uppercase tracking-wider">
                  Commercial Tariff Schedule (Private Accounts)
                </h4>
                <p className="text-[11px] text-slate-300">Private business & heavy-volume water consumption</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-1 bg-blue-950 text-blue-300 border border-blue-800 text-[10px] font-black uppercase rounded-lg">
                Private / Premium
              </span>
              <button
                type="button"
                onClick={() => {
                  setTargetScope('Commercial');
                  setShowConfirmModal(true);
                }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center space-x-1 shadow-xs"
                title="Apply changes to Commercial private accounts only"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Apply Commercial</span>
              </button>
            </div>
          </div>

          <div className="p-3 bg-blue-950/40 border border-blue-900/60 rounded-2xl text-[11px] text-blue-200/90 leading-relaxed">
            <strong className="text-blue-300 font-bold block mb-0.5">Private Commercial Accounts:</strong>
            Commercial users are private accounts with the highest volume and most expensive water consumption rates. Progressive brackets reflect heavier volumetric usage.
          </div>

          <div className="space-y-4">
            {/* Lifeline Base */}
            <div className="p-3.5 bg-slate-950/80 border border-blue-900/60 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-black text-white block">Lifeline Base (1 – 10 m³)</span>
                <span className="text-[10px] text-slate-300">Readiness-to-serve minimum charge</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">Current: ₱{activeTariff.commercial.baseMinCharge.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-blue-700/80 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.50"
                    min="1"
                    value={formConfig.commercial.baseMinCharge}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      commercial: { ...formConfig.commercial, baseMinCharge: Number(e.target.value) || 0 }
                    })}
                    className="w-20 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* Tier 1: 11 - 20 m³ */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Tier 1: 11 – 20 m³</span>
                <span className="text-[10px] text-slate-300">Incremental volumetric rate per m³</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">₱{activeTariff.commercial.tier1_rate.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.10"
                    min="0"
                    value={formConfig.commercial.tier1_rate}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      commercial: { ...formConfig.commercial, tier1_rate: Number(e.target.value) || 0 }
                    })}
                    className="w-16 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 ml-1">/m³</span>
                </div>
              </div>
            </div>

            {/* Tier 2: 21 - 30 m³ */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Tier 2: 21 – 30 m³</span>
                <span className="text-[10px] text-slate-300">Incremental volumetric rate per m³</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">₱{activeTariff.commercial.tier2_rate.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.10"
                    min="0"
                    value={formConfig.commercial.tier2_rate}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      commercial: { ...formConfig.commercial, tier2_rate: Number(e.target.value) || 0 }
                    })}
                    className="w-16 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 ml-1">/m³</span>
                </div>
              </div>
            </div>

            {/* Tier 3: 31 - 40 m³ */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Tier 3: 31 – 40 m³</span>
                <span className="text-[10px] text-slate-300">Incremental volumetric rate per m³</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">₱{activeTariff.commercial.tier3_rate.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.10"
                    min="0"
                    value={formConfig.commercial.tier3_rate}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      commercial: { ...formConfig.commercial, tier3_rate: Number(e.target.value) || 0 }
                    })}
                    className="w-16 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 ml-1">/m³</span>
                </div>
              </div>
            </div>

            {/* Tier 4 & 5: 41+ m³ */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Tier 4: 41 – 50 m³</span>
                <span className="text-[10px] text-slate-300">High-volume commercial rate</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold text-slate-400">₱{activeTariff.commercial.tier4_rate.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1">
                  <span className="text-xs font-bold text-slate-400 mr-1">₱</span>
                  <input
                    type="number"
                    step="0.10"
                    min="0"
                    value={formConfig.commercial.tier4_rate}
                    onChange={(e) => setFormConfig({
                      ...formConfig,
                      commercial: { ...formConfig.commercial, tier4_rate: Number(e.target.value) || 0 }
                    })}
                    className="w-16 font-mono font-black text-xs text-white bg-transparent focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 ml-1">/m³</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Statutory Taxes & Regulatory Mandate Metadata */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4 text-slate-100">
        <h4 className="text-xs font-black uppercase text-white tracking-wider flex items-center space-x-2">
          <FileText className="h-4 w-4 text-blue-400" />
          <span>Statutory Taxes & Board Resolution Mandate</span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor={formEffectiveDateId} className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Effective Date</label>
            <input
              id={formEffectiveDateId}
              type="text"
              value={formConfig.effectiveDate}
              onChange={(e) => setFormConfig({ ...formConfig, effectiveDate: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs font-bold text-white focus:border-blue-500 focus:outline-hidden"
              placeholder="e.g. October 1, 2026"
            />
          </div>

          <div>
            <label htmlFor={formResolutionNumberId} className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Board Resolution / Memo No.</label>
            <input
              id={formResolutionNumberId}
              type="text"
              value={formConfig.resolutionNumber}
              onChange={(e) => setFormConfig({ ...formConfig, resolutionNumber: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs font-mono font-bold text-white focus:border-blue-500 focus:outline-hidden"
              placeholder="e.g. TWD-BR-2026-08"
            />
          </div>

          <div>
            <label htmlFor={formFranchiseTaxId} className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Local Franchise Tax Rate</label>
            <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl px-3 py-2">
              <input
                id={formFranchiseTaxId}
                type="number"
                step="0.005"
                min="0"
                max="0.10"
                value={formConfig.franchiseTaxRate}
                onChange={(e) => setFormConfig({ ...formConfig, franchiseTaxRate: Number(e.target.value) || 0.02 })}
                className="w-full bg-transparent font-mono text-xs font-bold text-white focus:outline-hidden"
              />
              <span className="text-xs font-bold text-slate-400">({(formConfig.franchiseTaxRate * 100).toFixed(1)}%)</span>
            </div>
          </div>

          <div>
            <label htmlFor={formLatePenaltyId} className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Late Payment Surcharge</label>
            <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl px-3 py-2">
              <input
                id={formLatePenaltyId}
                type="number"
                step="0.01"
                min="0"
                max="0.50"
                value={formConfig.latePaymentSurchargeRate}
                onChange={(e) => setFormConfig({ ...formConfig, latePaymentSurchargeRate: Number(e.target.value) || 0.10 })}
                className="w-full bg-transparent font-mono text-xs font-bold text-white focus:outline-hidden"
              />
              <span className="text-xs font-bold text-slate-400">({(formConfig.latePaymentSurchargeRate * 100).toFixed(1)}%)</span>
            </div>
          </div>

          <div className="lg:col-span-4">
            <label htmlFor={formMemoNotesId} className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Official Justification / Consumer Memo</label>
            <textarea
              id={formMemoNotesId}
              rows={2}
              value={formConfig.memoNotes}
              onChange={(e) => setFormConfig({ ...formConfig, memoNotes: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 focus:outline-hidden focus:border-blue-400"
              placeholder="Provide the reason for the tariff hike to be displayed in consumer notifications and public advisories..."
            />
          </div>
        </div>
      </div>

      {/* 5. Interactive Impact Simulator & Consumer Calculation Preview */}
      <div className="bg-slate-900 text-white border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center space-x-2">
              <Calculator className="h-4 w-4 text-emerald-400" />
              <span>Interactive Consumer Bill Impact Simulator</span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Simulate any consumer consumption volume to preview the exact Before vs After bill difference before saving.
            </p>
          </div>

          <div className="flex items-center space-x-2 p-1 bg-slate-800 rounded-2xl border border-slate-700">
            <button
              onClick={() => setSimType('Residential')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                simType === 'Residential' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              Residential
            </button>
            <button
              onClick={() => setSimType('Commercial')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                simType === 'Commercial' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              Commercial
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
          
          {/* Slider input */}
          <div className="space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-slate-300">Monthly Usage Volume:</span>
              <span className="font-mono font-black text-emerald-400 text-sm">{simUsage} cu.m (m³)</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              value={simUsage}
              onChange={(e) => setSimUsage(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>1 m³ (Min)</span>
              <span>25 m³</span>
              <span>50 m³</span>
              <span>100 m³</span>
            </div>
          </div>

          {/* Before vs After Cards */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Current Tariff Bill</span>
              <div className="text-xl font-black text-slate-100 font-mono mt-1">
                ₱{currentSimTotal.toFixed(2)}
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                Basic: ₱{currentSimBill.toFixed(2)} + Tax: ₱{currentSimTax.toFixed(2)}
              </span>
            </div>

            <div className="bg-blue-950/70 border border-blue-800/80 rounded-2xl p-4">
              <span className="text-[10px] font-bold text-blue-300 uppercase tracking-wider block">Proposed Price Hike Bill</span>
              <div className="text-xl font-black text-emerald-400 font-mono mt-1">
                ₱{proposedSimTotal.toFixed(2)}
              </div>
              <span className="text-[10px] text-blue-300 font-mono">
                Basic: ₱{proposedSimBill.toFixed(2)} + Tax: ₱{proposedSimTax.toFixed(2)}
              </span>
            </div>

            <div className={`rounded-2xl p-4 border ${
              simDiff > 0 ? 'bg-amber-950/60 border-amber-800/80 text-amber-300' : 'bg-slate-950 border-slate-800 text-slate-300'
            }`}>
              <span className="text-[10px] font-bold uppercase tracking-wider block opacity-90">Consumer Surcharge Impact</span>
              <div className="text-xl font-black font-mono mt-1">
                {simDiff >= 0 ? `+₱${simDiff.toFixed(2)}` : `-₱${Math.abs(simDiff).toFixed(2)}`}
              </div>
              <span className="text-[10px] font-bold">
                {simPercentDiff > 0 ? `+${simPercentDiff}% adjustment` : 'No net change'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Implementation & Notification Options */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4 text-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <h4 className="text-xs font-black uppercase text-white tracking-wider flex items-center space-x-2">
            <Bell className="h-4 w-4 text-blue-400" />
            <span>Automated Implementation & Notification Actions</span>
          </h4>
          <span className="text-[10px] font-bold text-slate-400">
            Applying to: <strong className={targetScope === 'Residential' ? 'text-emerald-400' : targetScope === 'Commercial' ? 'text-blue-400' : 'text-purple-400'}>
              {targetScope === 'Residential' ? 'Residential (Regular Community)' : targetScope === 'Commercial' ? 'Commercial (Private Accounts)' : 'Both Classifications'}
            </strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="p-4 bg-slate-950/80 border border-blue-900/60 rounded-2xl flex items-start space-x-3 cursor-pointer hover:border-blue-700 transition">
            <input
              type="checkbox"
              checked={recalculateUnbilledReadings}
              onChange={(e) => setRecalculateUnbilledReadings(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-sm text-blue-600 accent-blue-600"
            />
            <div>
              <span className="text-xs font-black text-white block">
                Automatically recalculate targeted unpaid & unbilled readings
              </span>
              <span className="text-[11px] text-slate-300 leading-relaxed block mt-0.5">
                Instantly recalculates <strong className="text-blue-400">{targetedUnpaidReadingsCount} unpaid {targetScope === 'both' ? 'statements' : `${targetScope} statements`}</strong> across the consumer ledger so accounts see updated bills immediately.
              </span>
            </div>
          </label>

          <label className="p-4 bg-slate-950/80 border border-emerald-900/60 rounded-2xl flex items-start space-x-3 cursor-pointer hover:border-emerald-700 transition">
            <input
              type="checkbox"
              checked={notifyAllConsumers}
              onChange={(e) => setNotifyAllConsumers(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-sm text-emerald-600 accent-emerald-600"
            />
            <div>
              <span className="text-xs font-black text-white block">
                Notify targeted registered consumers with official Price Notice
              </span>
              <span className="text-[11px] text-slate-300 leading-relaxed block mt-0.5">
                Dispatches a tailored notification to <strong className="text-emerald-400">{targetedConsumersCount} registered {targetScope === 'both' ? 'consumer accounts' : `${targetScope} accounts`}</strong> explaining new rates, effective date, and resolution number.
              </span>
            </div>
          </label>

          <label className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-start space-x-3 cursor-pointer hover:border-slate-700 transition">
            <input
              type="checkbox"
              checked={postAnnouncement}
              onChange={(e) => setPostAnnouncement(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-sm text-blue-600 accent-blue-600"
            />
            <div>
              <span className="text-xs font-black text-white block">
                Publish Official Public Advisory Announcement
              </span>
              <span className="text-[11px] text-slate-300 leading-relaxed block mt-0.5">
                Pins an announcement banner to the public district bulletin and consumer dashboards.
              </span>
            </div>
          </label>

          <label className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-start space-x-3 cursor-pointer hover:border-slate-700 transition">
            <input
              type="checkbox"
              checked={broadcastWebSocket}
              onChange={(e) => setBroadcastWebSocket(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-sm text-blue-600 accent-blue-600"
            />
            <div>
              <span className="text-xs font-black text-white block">
                Broadcast live real-time WebSocket sync event
              </span>
              <span className="text-[11px] text-slate-300 leading-relaxed block mt-0.5">
                Instantly refreshes connected consumer portals and mobile meter reader apps.
              </span>
            </div>
          </label>
        </div>

        {/* Primary Commit Button */}
        <div className="pt-4 flex flex-col sm:flex-row justify-between items-center gap-4 border-t border-slate-800">
          <div className="text-xs text-slate-400">
            Resolution: <strong className="text-white font-mono">{formConfig.resolutionNumber}</strong> • Effective: <strong className="text-white">{formConfig.effectiveDate}</strong> • Target: <strong className="text-amber-300 uppercase">{targetScope}</strong>
          </div>

          <button
            onClick={() => setShowConfirmModal(true)}
            className={`w-full sm:w-auto px-8 py-3.5 text-white font-black text-xs uppercase tracking-wider rounded-2xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer ${
              targetScope === 'Residential'
                ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                : targetScope === 'Commercial'
                ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30'
                : 'bg-purple-600 hover:bg-purple-500 shadow-purple-600/30'
            }`}
          >
            <ShieldCheck className="h-4.5 w-4.5" />
            <span>
              {targetScope === 'Residential'
                ? 'Apply Residential Price Adjustment (Community Accounts)'
                : targetScope === 'Commercial'
                ? 'Apply Commercial Price Adjustment (Private Accounts)'
                : 'Implement Both Price Adjustments & Broadcast'}
            </span>
          </button>
        </div>
      </div>

      {/* 7. Confirmation Modal with Scope Isolation Details */}
      {showConfirmModal && (
        <div 
          className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-fade-in select-none"
          onClick={() => setShowConfirmModal(false)}
        >
          <div 
            className="bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6 select-text text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center space-x-3 text-amber-400">
              <div className="p-3 bg-amber-950/80 rounded-2xl border border-amber-800/80">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white tracking-tight">Confirm Water Tariff Price Adjustment</h3>
                <p className="text-xs text-slate-400 font-mono">Mandate: {formConfig.resolutionNumber}</p>
              </div>
            </div>

            {/* Scope Identifier Callout */}
            <div className={`p-3.5 rounded-2xl border text-xs leading-relaxed ${
              targetScope === 'Residential'
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-200'
                : targetScope === 'Commercial'
                ? 'bg-blue-950/60 border-blue-800/80 text-blue-200'
                : 'bg-purple-950/60 border-purple-800/80 text-purple-200'
            }`}>
              <div className="font-black uppercase tracking-wider text-[11px] mb-1 flex items-center space-x-1.5">
                <span>Identified Scope:</span>
                <span className="underline">
                  {targetScope === 'Residential'
                    ? 'Residential Only (Regular Community)'
                    : targetScope === 'Commercial'
                    ? 'Commercial Only (Private Accounts)'
                    : 'Both Residential & Commercial'}
                </span>
              </div>
              {targetScope === 'Residential' && (
                <p>
                  This adjustment applies <strong>ONLY</strong> to regular Residential community water consumption (single/individual account persons). Commercial private accounts and their high-consumption pricing will <strong>remain completely unchanged</strong>.
                </p>
              )}
              {targetScope === 'Commercial' && (
                <p>
                  This adjustment applies <strong>ONLY</strong> to Commercial private accounts (which have the most expensive water consumption rates). Regular Residential community households and their lifeline rates will <strong>remain completely unchanged</strong>.
                </p>
              )}
              {targetScope === 'both' && (
                <p>
                  Both Residential community and Commercial private accounts will be updated under their respective distinct schedules.
                </p>
              )}
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3 text-xs">
              {(targetScope === 'both' || targetScope === 'Residential') && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Residential Lifeline (1-10 m³):</span>
                  <span className="font-mono font-bold text-emerald-400">
                    ₱{activeTariff.residential.baseMinCharge.toFixed(2)} → ₱{formConfig.residential.baseMinCharge.toFixed(2)}
                  </span>
                </div>
              )}
              {(targetScope === 'both' || targetScope === 'Commercial') && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Commercial Lifeline (1-10 m³):</span>
                  <span className="font-mono font-bold text-blue-400">
                    ₱{activeTariff.commercial.baseMinCharge.toFixed(2)} → ₱{formConfig.commercial.baseMinCharge.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">Effective Date:</span>
                <span className="font-bold text-white">{formConfig.effectiveDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Target Accounts to Notify:</span>
                <span className="font-bold text-sky-400">{notifyAllConsumers ? `${targetedConsumersCount} accounts (${targetScope})` : 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Unpaid Statements Recalculated:</span>
                <span className="font-bold text-emerald-400">{recalculateUnbilledReadings ? `${targetedUnpaidReadingsCount} statements (${targetScope})` : 'None'}</span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This action will update the active water tariff engine. Unbilled statements and subsequent meter readings for the targeted classification will immediately reflect these rates.
            </p>

            <div className="flex justify-end space-x-3 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={isApplying}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl cursor-pointer transition border border-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCommitTariffHike}
                disabled={isApplying}
                className={`px-6 py-2.5 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md cursor-pointer flex items-center space-x-2 ${
                  targetScope === 'Residential'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : targetScope === 'Commercial'
                    ? 'bg-blue-600 hover:bg-blue-500'
                    : 'bg-purple-600 hover:bg-purple-500'
                }`}
              >
                {isApplying ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Implementing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Confirm & Apply Price Adjustment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

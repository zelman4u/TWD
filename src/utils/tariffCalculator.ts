/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Official Tagoloan Water District Tariff & Billing Notice Engine
 *
 * OFFICIAL BASELINE PRICE SCHEDULE:
 * - Customer Type | Rate per Cubic Meter
 *   • Residential : ₱10.00 / m³ (0 m³ = ₱0.00)
 *   • Commercial  : ₱25.00 / m³ (0 m³ = ₱0.00)
 * - Franchise Tax : 2% of Basic Water Charge (round(billAmount * 0.02, 2))
 * - Late Penalty  : 10% of Basic Water Charge after Due Date (round(billAmount * 0.10, 2))
 * - Total Amount Due (On/Before Due Date): Basic Water Charge + 2% Franchise Tax + Arrears
 * - Amount After Due Date: Total Amount Due + 10% Penalty
 */

import { computeOdometerConsumption } from './odometer';

export const OFFICIAL_TARIFF_BASELINE_SCHEMA = 'twd_per_m3_v2';

export interface WaterTariffConfig {
  baselineSchema?: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  effectiveDate: string;
  resolutionNumber: string;
  memoNotes: string;
  residential: {
    ratePerM3?: number;    // Official baseline per-m³ rate (₱10.00/m³)
    baseMinCharge: number; // 1-10 m³ per-m³ rate (₱10.00/m³)
    tier1_rate: number;    // 11-20 m³ per-m³ rate
    tier2_rate: number;    // 21-30 m³ per-m³ rate
    tier3_rate: number;    // 31-40 m³ per-m³ rate
    tier4_rate: number;    // 41+ m³ per-m³ rate
  };
  commercial: {
    ratePerM3?: number;    // Official baseline per-m³ rate (₱25.00/m³)
    baseMinCharge: number; // 1-10 m³ per-m³ rate (₱25.00/m³)
    tier1_rate: number;    // 11-20 m³ per-m³ rate
    tier2_rate: number;    // 21-30 m³ per-m³ rate
    tier3_rate: number;    // 31-40 m³ per-m³ rate
    tier4_rate: number;    // 41-50 m³ per-m³ rate
    tier5_rate: number;    // 51+ m³ per-m³ rate
  };
  franchiseTaxRate: number; // 0.02 (2%)
  latePaymentSurchargeRate: number; // 0.10 (10%)
}

export const DEFAULT_TARIFF_CONFIG: WaterTariffConfig = {
  baselineSchema: OFFICIAL_TARIFF_BASELINE_SCHEMA,
  version: 1,
  updatedAt: '2024-10-01T00:00:00.000Z',
  updatedBy: 'Tagoloan Water District Board',
  effectiveDate: 'October 1, 2024',
  resolutionNumber: 'TWD-LWUA-2024-001',
  memoNotes:
    'Official Tagoloan Water District Baseline Tariff Schedule: Residential ₱10.00/m³, Commercial ₱25.00/m³, 2% Franchise Tax, and 10% Late Payment Penalty.',
  residential: {
    ratePerM3: 10.00,
    baseMinCharge: 10.00,
    tier1_rate: 10.00,
    tier2_rate: 10.00,
    tier3_rate: 10.00,
    tier4_rate: 10.00,
  },
  commercial: {
    ratePerM3: 25.00,
    baseMinCharge: 25.00,
    tier1_rate: 25.00,
    tier2_rate: 25.00,
    tier3_rate: 25.00,
    tier4_rate: 25.00,
    tier5_rate: 25.00,
  },
  franchiseTaxRate: 0.02,
  latePaymentSurchargeRate: 0.10,
};

export const TARIFF_STORAGE_KEY = 'twd_live_v4_tariff_config';

let memoryTariffConfig: WaterTariffConfig = { ...DEFAULT_TARIFF_CONFIG };

export function isOfficialBaselineSchemaConfig(config: any): config is WaterTariffConfig {
  return Boolean(
    config &&
      config.baselineSchema === OFFICIAL_TARIFF_BASELINE_SCHEMA &&
      config.residential &&
      config.commercial
  );
}

export function getActiveTariffConfig(): WaterTariffConfig {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = localStorage.getItem(TARIFF_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (isOfficialBaselineSchemaConfig(parsed)) {
          memoryTariffConfig = parsed;
          return parsed;
        }
        // Auto-migrate stale legacy (pre-v2) cached tariff schedules to the official ₱10/m³ & ₱25/m³ baseline
        const migrated = { ...DEFAULT_TARIFF_CONFIG };
        localStorage.setItem(TARIFF_STORAGE_KEY, JSON.stringify(migrated));
        memoryTariffConfig = migrated;
        return migrated;
      }
    } catch {}
  }
  return memoryTariffConfig;
}

export function saveActiveTariffConfig(config: WaterTariffConfig): void {
  const normalized: WaterTariffConfig = {
    ...config,
    baselineSchema: OFFICIAL_TARIFF_BASELINE_SCHEMA,
    residential: {
      ...config.residential,
      ratePerM3: config.residential.ratePerM3 ?? config.residential.baseMinCharge,
    },
    commercial: {
      ...config.commercial,
      ratePerM3: config.commercial.ratePerM3 ?? config.commercial.baseMinCharge,
    },
    franchiseTaxRate: config.franchiseTaxRate ?? 0.02,
    latePaymentSurchargeRate: config.latePaymentSurchargeRate ?? 0.10,
  };
  memoryTariffConfig = normalized;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(TARIFF_STORAGE_KEY, JSON.stringify(normalized));
      window.dispatchEvent(new CustomEvent('twd_tariff_updated', { detail: normalized }));
      window.dispatchEvent(new CustomEvent('twd_database_updated'));
    } catch {}
  }
}

export function resetToDefaultTariffConfig(): WaterTariffConfig {
  saveActiveTariffConfig(DEFAULT_TARIFF_CONFIG);
  return DEFAULT_TARIFF_CONFIG;
}

export interface TariffTierBreakdown {
  tierNumber: number;
  name: string;
  range: string;
  volumeUsed: number;
  ratePerM3: number;
  isFixed: boolean;
  subtotal: number;
  isActive: boolean;
}

export interface OfficialBillingNoticeData {
  accountNumber: string;
  customerName: string;
  address: string;
  addressZone?: string;
  billingMonth: string;
  dueDate: string;
  classification: 'Residential' | 'Commercial' | 'RES' | 'COMM';
  meterBrand: string;
  meterNumber: string;
  sequenceNo: string | number;
  meterReader: string;
  previousReading: number;
  presentReading: number;
  usage: number;
  billAmount: number;
  franchiseTax: number;
  arrears: number;
  totalAmount: number;
  penaltyAmount: number;
  amountAfterDueDate: number;
  isOverdue: boolean;
  readingDate?: string;
}

export function getEffectiveRatePerM3(
  classification: 'Residential' | 'Commercial' | 'RES' | 'COMM' = 'Residential',
  customTariff?: WaterTariffConfig
): number {
  const tariff = customTariff || getActiveTariffConfig();
  const isComm = classification === 'Commercial' || classification === 'COMM';
  if (isComm) {
    return tariff.commercial.ratePerM3 ?? tariff.commercial.baseMinCharge ?? 25.00;
  }
  return tariff.residential.ratePerM3 ?? tariff.residential.baseMinCharge ?? 10.00;
}

/**
 * Calculates basic water charge (Bill Amt.) based on cubic meter usage and classification.
 * Baseline: Residential = ₱10.00/m³, Commercial = ₱25.00/m³ (0 m³ = ₱0.00).
 * Supports per-tier rate adjustments when configured via Admin Tariff Rate Manager.
 */
export function calculateWaterTariff(
  usage: number,
  classification: 'Residential' | 'Commercial' | 'RES' | 'COMM' = 'Residential',
  customTariff?: WaterTariffConfig
): number {
  const consumption = Math.max(0, Number(usage) || 0);

  if (consumption <= 0) {
    return 0;
  }

  const tariff = customTariff || getActiveTariffConfig();
  const isComm = classification === 'Commercial' || classification === 'COMM';

  if (!isComm) {
    const res = tariff.residential;
    const baseRate = res.ratePerM3 ?? res.baseMinCharge ?? 10.00;

    // 1 - 10 m³ billed per cubic meter
    const block0 = Math.min(consumption, 10);
    let total = block0 * baseRate;
    let remaining = consumption - block0;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 11 - 20 m³
    const block1 = Math.min(remaining, 10);
    total += block1 * res.tier1_rate;
    remaining -= block1;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 21 - 30 m³
    const block2 = Math.min(remaining, 10);
    total += block2 * res.tier2_rate;
    remaining -= block2;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 31 - 40 m³
    const block3 = Math.min(remaining, 10);
    total += block3 * res.tier3_rate;
    remaining -= block3;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 41+ m³
    total += remaining * res.tier4_rate;
    return Math.round(total * 100) / 100;
  } else {
    const comm = tariff.commercial;
    const baseRate = comm.ratePerM3 ?? comm.baseMinCharge ?? 25.00;

    // 1 - 10 m³ billed per cubic meter
    const block0 = Math.min(consumption, 10);
    let total = block0 * baseRate;
    let remaining = consumption - block0;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 11 - 20 m³
    const block1 = Math.min(remaining, 10);
    total += block1 * comm.tier1_rate;
    remaining -= block1;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 21 - 30 m³
    const block2 = Math.min(remaining, 10);
    total += block2 * comm.tier2_rate;
    remaining -= block2;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 31 - 40 m³
    const block3 = Math.min(remaining, 10);
    total += block3 * comm.tier3_rate;
    remaining -= block3;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 41 - 50 m³
    const block4 = Math.min(remaining, 10);
    total += block4 * comm.tier4_rate;
    remaining -= block4;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 51+ m³
    total += remaining * comm.tier5_rate;
    return Math.round(total * 100) / 100;
  }
}

/**
 * Returns the authoritative basic water charge for a specific MeterReading:
 * - Honors locked-in `reading.billAmount` when stamped under the official v2 baseline schema (or paid).
 * - Recalculates legacy pre-v2 unpaid readings against the official ₱10/m³ & ₱25/m³ baseline.
 */
export function getReadingEffectiveBillAmount(
  reading:
    | {
        consumption: number;
        classification?: string;
        billAmount?: number;
        readingDate?: string;
        appliedTariffVersion?: number;
        tariffBaselineSchema?: string;
        paymentStatus?: string;
      }
    | null
    | undefined,
  fallbackClassification: 'Residential' | 'Commercial' | 'RES' | 'COMM' = 'Residential'
): number {
  if (!reading) return 0;

  const rawClass = reading.classification || fallbackClassification;
  const cls: 'Residential' | 'Commercial' =
    rawClass === 'Commercial' || rawClass === 'COMM' ? 'Commercial' : 'Residential';

  const isLegacyUnpaidBaseline =
    reading.tariffBaselineSchema !== OFFICIAL_TARIFF_BASELINE_SCHEMA &&
    reading.paymentStatus !== 'paid' &&
    (reading.appliedTariffVersion === undefined || reading.appliedTariffVersion <= 1);

  if (
    !isLegacyUnpaidBaseline &&
    typeof reading.billAmount === 'number' &&
    !Number.isNaN(reading.billAmount) &&
    reading.billAmount >= 0
  ) {
    return Math.round(reading.billAmount * 100) / 100;
  }

  const activeTariff = getActiveTariffConfig();
  if (reading.appliedTariffVersion !== undefined && reading.appliedTariffVersion <= 1) {
    return calculateWaterTariff(reading.consumption, cls, DEFAULT_TARIFF_CONFIG);
  }

  if ((activeTariff.version || 1) > 1 && activeTariff.updatedAt && reading.readingDate) {
    const readTs = new Date(reading.readingDate).getTime();
    const tariffTs = new Date(activeTariff.updatedAt).getTime();
    const tariffDayStart = new Date(activeTariff.updatedAt);
    tariffDayStart.setHours(0, 0, 0, 0);
    if (!Number.isNaN(readTs) && !Number.isNaN(tariffTs) && readTs < tariffDayStart.getTime()) {
      return calculateWaterTariff(reading.consumption, cls, DEFAULT_TARIFF_CONFIG);
    }
  }

  return calculateWaterTariff(reading.consumption, cls, activeTariff);
}

/**
 * Calculates 2% Franchise Tax on basic Bill Amount: round(Bill Amt × rate, 2)
 */
export function calculateFranchiseTax(billAmount: number, customTariff?: WaterTariffConfig): number {
  if (billAmount <= 0) return 0;
  const tariff = customTariff || getActiveTariffConfig();
  const rate = tariff.franchiseTaxRate ?? 0.02;
  return Math.round(billAmount * rate * 100) / 100;
}

/**
 * Calculates Late Payment Penalty on basic Bill Amount (10%): round(Bill Amt × rate, 2)
 */
export function calculateLatePenalty(billAmount: number, customTariff?: WaterTariffConfig): number {
  if (billAmount <= 0) return 0;
  const tariff = customTariff || getActiveTariffConfig();
  const rate = tariff.latePaymentSurchargeRate ?? 0.10;
  return Math.round(billAmount * rate * 100) / 100;
}

/**
 * Computes authoritative total assessment for a MeterReading (Basic + 2% Franchise Tax + Arrears, plus 10% Penalty after due date).
 */
export function getReadingTotalAssessment(
  reading:
    | {
        consumption: number;
        classification?: string;
        billAmount?: number;
        franchiseTax?: number;
        arrears?: number;
        totalAmount?: number;
        penaltyAmount?: number;
        amountAfterDueDate?: number;
        readingDate?: string;
        dueDate?: string;
        appliedTariffVersion?: number;
        tariffBaselineSchema?: string;
        paymentStatus?: string;
        paidAmount?: number;
      }
    | null
    | undefined,
  fallbackClassification: 'Residential' | 'Commercial' | 'RES' | 'COMM' = 'Residential'
) {
  const rawClass = reading?.classification || fallbackClassification;
  const cls: 'Residential' | 'Commercial' =
    rawClass === 'Commercial' || rawClass === 'COMM' ? 'Commercial' : 'Residential';
  const ratePerM3 = getEffectiveRatePerM3(cls);

  if (!reading) {
    return {
      classification: cls,
      ratePerM3,
      basicCharge: 0,
      franchiseTax: 0,
      arrears: 0,
      totalBeforeDue: 0,
      penaltyAmount: 0,
      amountAfterDueDate: 0,
    };
  }

  const isLegacyUnpaid =
    reading.tariffBaselineSchema !== OFFICIAL_TARIFF_BASELINE_SCHEMA &&
    reading.paymentStatus !== 'paid' &&
    (reading.appliedTariffVersion === undefined || reading.appliedTariffVersion <= 1);

  const basicCharge = getReadingEffectiveBillAmount(reading, cls);
  const franchiseTax =
    !isLegacyUnpaid && typeof reading.franchiseTax === 'number' && !Number.isNaN(reading.franchiseTax)
      ? Math.round(reading.franchiseTax * 100) / 100
      : calculateFranchiseTax(basicCharge);
  const arrears =
    typeof reading.arrears === 'number' && !Number.isNaN(reading.arrears)
      ? Math.max(0, Math.round(reading.arrears * 100) / 100)
      : 0;
  const totalBeforeDue =
    !isLegacyUnpaid && typeof reading.totalAmount === 'number' && !Number.isNaN(reading.totalAmount)
      ? Math.round(reading.totalAmount * 100) / 100
      : Math.round((basicCharge + franchiseTax + arrears) * 100) / 100;
  const penaltyAmount =
    !isLegacyUnpaid && typeof reading.penaltyAmount === 'number' && !Number.isNaN(reading.penaltyAmount)
      ? Math.round(reading.penaltyAmount * 100) / 100
      : calculateLatePenalty(basicCharge);
  const amountAfterDueDate =
    !isLegacyUnpaid && typeof reading.amountAfterDueDate === 'number' && !Number.isNaN(reading.amountAfterDueDate)
      ? Math.round(reading.amountAfterDueDate * 100) / 100
      : Math.round((totalBeforeDue + penaltyAmount) * 100) / 100;

  return {
    classification: cls,
    ratePerM3,
    basicCharge,
    franchiseTax,
    arrears,
    totalBeforeDue,
    penaltyAmount,
    amountAfterDueDate,
  };
}

/**
 * Normalizes a MeterReading record to the official ₱10/m³ (Residential) & ₱25/m³ (Commercial) + 2% Franchise Tax + 10% Penalty baseline.
 * Preserves settled ('paid') historical payments while upgrading unsettled legacy v1 statements.
 */
export function normalizeReadingToOfficialBaseline<
  T extends {
    consumption?: number;
    previousReading?: number;
    currentReading?: number;
    presentReading?: number;
    classification?: string;
    billAmount?: number;
    franchiseTax?: number;
    arrears?: number;
    totalAmount?: number;
    penaltyAmount?: number;
    amountAfterDueDate?: number;
    paidAmount?: number;
    remainingBalance?: number;
    paymentStatus?: string;
    appliedTariffVersion?: number;
    tariffBaselineSchema?: string;
    status?: string;
    isBillingIssued?: boolean;
    isAnomaly?: boolean;
    anomalyReason?: string;
    meterCondition?: string;
  }
>(reading: T): T {
  if (!reading) {
    return reading;
  }

  const odo = computeOdometerConsumption(
    reading.previousReading,
    reading.currentReading ?? reading.presentReading,
    reading.consumption
  );
  const prev = odo.previousReading;
  const curr = odo.currentReading;
  const m3 = odo.consumption;

  const hasConditionAlert = Boolean(
    reading.isAnomaly ||
      (reading.meterCondition && reading.meterCondition.trim().toUpperCase() !== 'NORMAL')
  );
  const shouldFlagHighUsage =
    (reading.status === 'pending' || reading.status === 'flagged_abnormal') &&
    (m3 >= 20 || hasConditionAlert);
  const resolvedUnbilledStatus = shouldFlagHighUsage ? 'flagged_abnormal' : reading.status;
  const resolvedAnomalyReason = shouldFlagHighUsage
    ? reading.anomalyReason || 'High Usage / Condition Alert — Verify'
    : reading.anomalyReason;

  if (reading.tariffBaselineSchema === OFFICIAL_TARIFF_BASELINE_SCHEMA) {
    const needsAnomalyUpgrade =
      shouldFlagHighUsage &&
      (reading.status !== 'flagged_abnormal' || !reading.isAnomaly || !reading.anomalyReason);
    if (
      !needsAnomalyUpgrade &&
      reading.previousReading === prev &&
      reading.presentReading === curr &&
      reading.currentReading === curr &&
      reading.consumption === m3
    ) {
      return reading;
    }
    return {
      ...reading,
      ...(shouldFlagHighUsage
        ? { status: resolvedUnbilledStatus, isAnomaly: true, anomalyReason: resolvedAnomalyReason }
        : {}),
      previousReading: prev,
      presentReading: curr,
      currentReading: curr,
      consumption: m3,
    };
  }

  // Keep already-paid historical receipts intact, just normalize 5-digit odometer indices and stamp schema
  if (reading.paymentStatus === 'paid') {
    return {
      ...reading,
      previousReading: prev,
      presentReading: curr,
      currentReading: curr,
      consumption: m3,
      tariffBaselineSchema: OFFICIAL_TARIFF_BASELINE_SCHEMA,
    };
  }

  // If reading was billed under a custom future admin version (>1), keep its locked amounts
  if (reading.appliedTariffVersion !== undefined && reading.appliedTariffVersion > 1) {
    return {
      ...reading,
      previousReading: prev,
      presentReading: curr,
      currentReading: curr,
      consumption: m3,
      tariffBaselineSchema: OFFICIAL_TARIFF_BASELINE_SCHEMA,
    };
  }

  const cls: 'Residential' | 'Commercial' =
    reading.classification === 'Commercial' || reading.classification === 'COMM'
      ? 'Commercial'
      : 'Residential';

  // Unbilled pending readings without billAmount yet
  if (
    reading.billAmount === undefined &&
    !reading.isBillingIssued &&
    (reading.status === 'pending' || reading.status === 'flagged_abnormal')
  ) {
    return {
      ...reading,
      status: resolvedUnbilledStatus,
      ...(shouldFlagHighUsage ? { isAnomaly: true, anomalyReason: resolvedAnomalyReason } : {}),
      previousReading: prev,
      presentReading: curr,
      currentReading: curr,
      consumption: m3,
      tariffBaselineSchema: OFFICIAL_TARIFF_BASELINE_SCHEMA,
    };
  }

  const basic = calculateWaterTariff(m3, cls, DEFAULT_TARIFF_CONFIG);
  const fTax = calculateFranchiseTax(basic, DEFAULT_TARIFF_CONFIG);
  const arr = Math.max(0, Math.round((Number(reading.arrears) || 0) * 100) / 100);
  const total = Math.round((basic + fTax + arr) * 100) / 100;
  const pen = calculateLatePenalty(basic, DEFAULT_TARIFF_CONFIG);
  const afterDue = Math.round((total + pen) * 100) / 100;
  const paid = Math.max(0, Math.round((Number(reading.paidAmount) || 0) * 100) / 100);
  const rem = Math.round(Math.max(0, total - paid) * 100) / 100;
  const nextPaymentStatus =
    paid > 0 && rem <= 0.009 ? 'paid' : paid > 0 ? 'partial' : reading.paymentStatus || 'unpaid';

  return {
    ...reading,
    status: resolvedUnbilledStatus,
    ...(shouldFlagHighUsage ? { isAnomaly: true, anomalyReason: resolvedAnomalyReason } : {}),
    previousReading: prev,
    presentReading: curr,
    currentReading: curr,
    consumption: m3,
    billAmount: basic,
    franchiseTax: fTax,
    arrears: arr,
    totalAmount: total,
    penaltyAmount: pen,
    amountAfterDueDate: afterDue,
    remainingBalance: nextPaymentStatus === 'paid' ? 0 : rem,
    paymentStatus: nextPaymentStatus,
    tariffBaselineSchema: OFFICIAL_TARIFF_BASELINE_SCHEMA,
  };
}

/**
 * Computes complete official Tagoloan Water District Billing Notice assessment
 */
export function calculateOfficialBillingNotice(params: {
  accountNumber: string;
  customerName: string;
  address: string;
  addressZone?: string;
  billingMonth?: string;
  dueDate?: string;
  classification?: 'Residential' | 'Commercial' | 'RES' | 'COMM';
  meterBrand?: string;
  meterNumber?: string;
  sequenceNo?: string | number;
  meterReader?: string;
  previousReading: number;
  presentReading: number;
  arrears?: number;
  readingDate?: string;
}): OfficialBillingNoticeData {
  const odo = computeOdometerConsumption(params.previousReading, params.presentReading);
  const previousReading = odo.previousReading;
  const presentReading = odo.currentReading;
  const usage = odo.consumption;
  const classification = params.classification || 'Residential';

  const billAmount = calculateWaterTariff(usage, classification);
  const franchiseTax = calculateFranchiseTax(billAmount);
  const arrears = Math.max(0, Number(params.arrears) || 0);
  const totalAmount = Math.round((billAmount + franchiseTax + arrears) * 100) / 100;
  const penaltyAmount = calculateLatePenalty(billAmount);
  const amountAfterDueDate = Math.round((totalAmount + penaltyAmount) * 100) / 100;

  const dueDate = params.dueDate || 'December 12, 2024';
  const isOverdue = false;

  return {
    accountNumber: params.accountNumber,
    customerName: params.customerName,
    address: params.address,
    addressZone: params.addressZone,
    billingMonth: params.billingMonth || 'October 2024',
    dueDate,
    classification,
    meterBrand: params.meterBrand || 'EVER',
    meterNumber: params.meterNumber || '150307143',
    sequenceNo: params.sequenceNo || '135',
    meterReader: params.meterReader || 'MARCO POLO',
    previousReading,
    presentReading,
    usage,
    billAmount,
    franchiseTax,
    arrears,
    totalAmount,
    penaltyAmount,
    amountAfterDueDate,
    isOverdue,
    readingDate: params.readingDate || new Date().toISOString().split('T')[0],
  };
}

/**
 * Returns itemized tier calculation breakdown for transparency & explanation
 */
export function getTariffBreakdown(
  usage: number,
  classification: 'Residential' | 'Commercial' | 'RES' | 'COMM' = 'Residential',
  customTariff?: WaterTariffConfig
) {
  const consumption = Math.max(0, Number(usage) || 0);
  const isComm = classification === 'Commercial' || classification === 'COMM';
  const tariff = customTariff || getActiveTariffConfig();
  const tiers: TariffTierBreakdown[] = [];

  const baseRate = isComm
    ? tariff.commercial.ratePerM3 ?? tariff.commercial.baseMinCharge ?? 25.00
    : tariff.residential.ratePerM3 ?? tariff.residential.baseMinCharge ?? 10.00;
  const tier1Rate = isComm ? tariff.commercial.tier1_rate : tariff.residential.tier1_rate;
  const tier2Rate = isComm ? tariff.commercial.tier2_rate : tariff.residential.tier2_rate;
  const tier3Rate = isComm ? tariff.commercial.tier3_rate : tariff.residential.tier3_rate;
  const tier4Rate = isComm ? tariff.commercial.tier4_rate : tariff.residential.tier4_rate;
  const tier5Rate = isComm ? tariff.commercial.tier5_rate : 0;

  const v0 = Math.min(consumption, 10);
  tiers.push({
    tierNumber: 1,
    name: 'Baseline Block (1 – 10 m³)',
    range: '1 – 10 m³',
    volumeUsed: v0,
    ratePerM3: baseRate,
    isFixed: false,
    subtotal: Math.round(v0 * baseRate * 100) / 100,
    isActive: consumption > 0,
  });

  if (consumption > 10) {
    const v1 = Math.min(consumption - 10, 10);
    tiers.push({
      tierNumber: 2,
      name: 'Tier 2 (11 – 20 m³)',
      range: '11 – 20 m³',
      volumeUsed: v1,
      ratePerM3: tier1Rate,
      isFixed: false,
      subtotal: Math.round(v1 * tier1Rate * 100) / 100,
      isActive: true,
    });
  }

  if (consumption > 20) {
    const v2 = Math.min(consumption - 20, 10);
    tiers.push({
      tierNumber: 3,
      name: 'Tier 3 (21 – 30 m³)',
      range: '21 – 30 m³',
      volumeUsed: v2,
      ratePerM3: tier2Rate,
      isFixed: false,
      subtotal: Math.round(v2 * tier2Rate * 100) / 100,
      isActive: true,
    });
  }

  if (consumption > 30) {
    const v3 = Math.min(consumption - 30, isComm ? 10 : 99999);
    tiers.push({
      tierNumber: 4,
      name: isComm ? 'Tier 4 (31 – 40 m³)' : 'Tier 4 (31+ m³)',
      range: isComm ? '31 – 40 m³' : '31+ m³',
      volumeUsed: v3,
      ratePerM3: tier3Rate,
      isFixed: false,
      subtotal: Math.round(v3 * tier3Rate * 100) / 100,
      isActive: true,
    });
  }

  if (isComm && consumption > 40) {
    const v4 = Math.min(consumption - 40, 10);
    tiers.push({
      tierNumber: 5,
      name: 'Tier 5 (41 – 50 m³)',
      range: '41 – 50 m³',
      volumeUsed: v4,
      ratePerM3: tier4Rate,
      isFixed: false,
      subtotal: Math.round(v4 * tier4Rate * 100) / 100,
      isActive: true,
    });
  }

  if (isComm && consumption > 50) {
    const v5 = consumption - 50;
    tiers.push({
      tierNumber: 6,
      name: 'Tier 6 (51+ m³)',
      range: '51+ m³',
      volumeUsed: v5,
      ratePerM3: tier5Rate,
      isFixed: false,
      subtotal: Math.round(v5 * tier5Rate * 100) / 100,
      isActive: true,
    });
  }

  const billAmount = calculateWaterTariff(consumption, classification, tariff);
  const franchiseTax = calculateFranchiseTax(billAmount, tariff);
  const latePenalty = calculateLatePenalty(billAmount, tariff);

  return {
    consumption,
    classification: isComm ? 'Commercial' : 'Residential',
    ratePerM3: baseRate,
    baseFixedCharge: Math.round(v0 * baseRate * 100) / 100,
    totalBill: billAmount,
    franchiseTax,
    latePenalty,
    tiers,
    explanation: `Tagoloan Water District ${isComm ? 'COMM' : 'RES'} Tariff (${tariff.resolutionNumber}): Net consumption of ${consumption} m³ @ ₱${baseRate.toFixed(2)}/m³ = ₱${billAmount.toFixed(2)} basic bill + ₱${franchiseTax.toFixed(2)} franchise tax (${(tariff.franchiseTaxRate * 100).toFixed(0)}%). Late penalty after due date: +₱${latePenalty.toFixed(2)} (${(tariff.latePaymentSurchargeRate * 100).toFixed(0)}%).`,
  };
}

/**
 * Determines whether a MeterReading has an official billing statement issued by Administration.
 */
export function isOfficialBillIssued(
  reading:
    | {
        status?: string;
        isBillingIssued?: boolean;
        billingIssuedAt?: string;
        invoiceNumber?: string;
        paymentStatus?: string;
        paidAmount?: number;
        orNumber?: string;
        billAmount?: number;
        dueDate?: string;
      }
    | null
    | undefined
): boolean {
  if (!reading) return false;
  if (
    reading.status === 'cancelled' ||
    reading.status === 'pending' ||
    reading.status === 'flagged_abnormal'
  ) {
    return false;
  }
  if (
    reading.paymentStatus === 'paid' ||
    reading.paymentStatus === 'partial' ||
    (typeof reading.paidAmount === 'number' && reading.paidAmount > 0) ||
    Boolean(reading.orNumber) ||
    Boolean(reading.billingIssuedAt) ||
    Boolean(reading.invoiceNumber)
  ) {
    return true;
  }
  if (reading.status !== 'verified') return false;
  if (typeof reading.isBillingIssued === 'boolean') {
    return reading.isBillingIssued;
  }
  return typeof reading.billAmount === 'number' && Boolean(reading.dueDate);
}

/**
 * Computes a clean formatted default due date (15 calendar days after reading/billing date).
 */
export function computeDefaultDueDate(referenceDate?: string): string {
  const base = referenceDate ? new Date(referenceDate) : new Date();
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  const due = new Date(safeBase.getTime());
  due.setDate(due.getDate() + 15);
  return due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

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

  const hasOfficialLock =
    reading.paymentStatus === 'paid' ||
    reading.paymentStatus === 'partial' ||
    (typeof (reading as any).paidAmount === 'number' && (reading as any).paidAmount > 0) ||
    Boolean(
      (reading as any).isBillingIssued ||
        (reading as any).billingIssuedAt ||
        (reading as any).invoiceNumber ||
        (reading as any).orNumber ||
        ((reading as any).status === 'verified' && (reading as any).dueDate)
    );

  // If the bill has already been issued or paid, always preserve its stored billAmount
  if (
    hasOfficialLock &&
    typeof reading.billAmount === 'number' &&
    !Number.isNaN(reading.billAmount) &&
    reading.billAmount >= 0
  ) {
    return Math.round(reading.billAmount * 100) / 100;
  }

  const isLegacyUnpaidBaseline =
    reading.tariffBaselineSchema !== OFFICIAL_TARIFF_BASELINE_SCHEMA &&
    !hasOfficialLock &&
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

  const hasOfficialLock =
    reading.paymentStatus === 'paid' ||
    reading.paymentStatus === 'partial' ||
    (typeof reading.paidAmount === 'number' && reading.paidAmount > 0) ||
    Boolean(
      (reading as any).isBillingIssued ||
        (reading as any).billingIssuedAt ||
        (reading as any).invoiceNumber ||
        (reading as any).orNumber ||
        ((reading as any).status === 'verified' && (reading as any).dueDate)
    );

  const isLegacyUnpaid =
    reading.tariffBaselineSchema !== OFFICIAL_TARIFF_BASELINE_SCHEMA &&
    !hasOfficialLock &&
    (reading.appliedTariffVersion === undefined || reading.appliedTariffVersion <= 1);

  const basicCharge = getReadingEffectiveBillAmount(reading, cls);
  const franchiseTax =
    !isLegacyUnpaid &&
    typeof reading.franchiseTax === 'number' &&
    !Number.isNaN(reading.franchiseTax) &&
    reading.franchiseTax >= 0
      ? Math.round(reading.franchiseTax * 100) / 100
      : calculateFranchiseTax(basicCharge);
  const arrears =
    typeof reading.arrears === 'number' && !Number.isNaN(reading.arrears)
      ? Math.max(0, Math.round(reading.arrears * 100) / 100)
      : 0;
  const canonicalTotalBeforeDue = Math.round((basicCharge + franchiseTax + arrears) * 100) / 100;

  let totalBeforeDue = canonicalTotalBeforeDue;
  if (!isLegacyUnpaid && typeof reading.totalAmount === 'number' && !Number.isNaN(reading.totalAmount) && reading.totalAmount > 0) {
    const roundedStoredTotal = Math.round(reading.totalAmount * 100) / 100;
    // Heal records where totalAmount was accidentally stored as bare basicCharge without 2% franchiseTax
    const droppedFranchiseTax =
      franchiseTax > 0 &&
      Math.abs(roundedStoredTotal - basicCharge) < 0.015 &&
      Math.abs(canonicalTotalBeforeDue - roundedStoredTotal) >= 0.01;
    if (!droppedFranchiseTax) {
      totalBeforeDue = roundedStoredTotal;
    }
  }

  const penaltyAmount =
    !isLegacyUnpaid && typeof reading.penaltyAmount === 'number' && !Number.isNaN(reading.penaltyAmount)
      ? Math.round(reading.penaltyAmount * 100) / 100
      : calculateLatePenalty(basicCharge);
  const amountAfterDueDate =
    !isLegacyUnpaid &&
    typeof reading.amountAfterDueDate === 'number' &&
    !Number.isNaN(reading.amountAfterDueDate) &&
    reading.amountAfterDueDate >= totalBeforeDue
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
 * Preserves settled ('paid') and partial ('partial') payments and locked issued bills, ensuring `paidAmount + remainingBalance === totalAmount`.
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
    billingIssuedAt?: string;
    invoiceNumber?: string;
    orNumber?: string;
    dueDate?: string;
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

  const isIssuedOrPaid =
    isOfficialBillIssued(reading) ||
    reading.paymentStatus === 'paid' ||
    reading.paymentStatus === 'partial' ||
    (typeof reading.paidAmount === 'number' && reading.paidAmount > 0);

  if (reading.tariffBaselineSchema === OFFICIAL_TARIFF_BASELINE_SCHEMA) {
    const needsAnomalyUpgrade =
      shouldFlagHighUsage &&
      (reading.status !== 'flagged_abnormal' || !reading.isAnomaly || !reading.anomalyReason);

    if (isIssuedOrPaid && reading.status !== 'cancelled') {
      const assessment = getReadingTotalAssessment(
        { ...reading, consumption: m3 },
        (reading.classification as 'Residential' | 'Commercial') || 'Residential'
      );
      const rawPaid = Math.max(0, Math.round((Number(reading.paidAmount) || 0) * 100) / 100);
      const isCleared =
        reading.paymentStatus === 'paid' ||
        (assessment.totalBeforeDue > 0 && assessment.totalBeforeDue - rawPaid <= 0.01);
      const nextPaid = isCleared ? Math.max(rawPaid, assessment.totalBeforeDue) : rawPaid;
      const nextRem = isCleared
        ? 0
        : Math.max(0, Math.round((assessment.totalBeforeDue - nextPaid) * 100) / 100);
      const nextPayStatus = isCleared ? 'paid' : nextPaid > 0 ? 'partial' : reading.paymentStatus || 'unpaid';

      if (
        !needsAnomalyUpgrade &&
        reading.previousReading === prev &&
        reading.presentReading === curr &&
        reading.currentReading === curr &&
        reading.consumption === m3 &&
        reading.billAmount === assessment.basicCharge &&
        reading.franchiseTax === assessment.franchiseTax &&
        reading.totalAmount === assessment.totalBeforeDue &&
        reading.remainingBalance === nextRem &&
        reading.paymentStatus === nextPayStatus &&
        (nextPaid === 0 || reading.paidAmount === nextPaid)
      ) {
        return reading;
      }

      return {
        ...reading,
        previousReading: prev,
        presentReading: curr,
        currentReading: curr,
        consumption: m3,
        status: reading.status === 'cancelled' ? 'cancelled' : 'verified',
        isBillingIssued: true,
        billAmount: assessment.basicCharge,
        franchiseTax: assessment.franchiseTax,
        arrears: assessment.arrears,
        totalAmount: assessment.totalBeforeDue,
        penaltyAmount: assessment.penaltyAmount,
        amountAfterDueDate: assessment.amountAfterDueDate,
        ...(nextPaid > 0 ? { paidAmount: nextPaid } : {}),
        remainingBalance: nextRem,
        paymentStatus: nextPayStatus,
      };
    }

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

  const cls: 'Residential' | 'Commercial' =
    reading.classification === 'Commercial' || reading.classification === 'COMM'
      ? 'Commercial'
      : 'Residential';

  // Unbilled pending readings without billAmount yet
  if (
    reading.billAmount === undefined &&
    !isIssuedOrPaid &&
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

  // Preserve locked billAmount on paid, partial, issued, or v2+ readings; otherwise compute from active/default baseline
  const hasLockedBill =
    (isIssuedOrPaid || (reading.appliedTariffVersion !== undefined && reading.appliedTariffVersion > 1)) &&
    typeof reading.billAmount === 'number' &&
    !Number.isNaN(reading.billAmount) &&
    reading.billAmount > 0;

  const activeCfg = getActiveTariffConfig();
  const basic = hasLockedBill
    ? Math.round(reading.billAmount! * 100) / 100
    : calculateWaterTariff(
        m3,
        cls,
        reading.appliedTariffVersion && reading.appliedTariffVersion > 1 ? activeCfg : DEFAULT_TARIFF_CONFIG
      );
  const fTax =
    hasLockedBill && typeof reading.franchiseTax === 'number' && !Number.isNaN(reading.franchiseTax)
      ? Math.round(reading.franchiseTax * 100) / 100
      : calculateFranchiseTax(basic, DEFAULT_TARIFF_CONFIG);
  const arr = Math.max(0, Math.round((Number(reading.arrears) || 0) * 100) / 100);
  const canonicalTotal = Math.round((basic + fTax + arr) * 100) / 100;
  const total =
    reading.paymentStatus === 'paid' &&
    typeof reading.totalAmount === 'number' &&
    !Number.isNaN(reading.totalAmount) &&
    reading.totalAmount > 0 &&
    !(fTax > 0 && Math.abs(reading.totalAmount - basic) < 0.015)
      ? Math.round(reading.totalAmount * 100) / 100
      : canonicalTotal;
  const pen =
    hasLockedBill && typeof reading.penaltyAmount === 'number' && !Number.isNaN(reading.penaltyAmount)
      ? Math.round(reading.penaltyAmount * 100) / 100
      : calculateLatePenalty(basic, DEFAULT_TARIFF_CONFIG);
  const afterDue = Math.round((total + pen) * 100) / 100;
  const rawPaid = Math.max(0, Math.round((Number(reading.paidAmount) || 0) * 100) / 100);
  const isCleared =
    reading.paymentStatus === 'paid' || (total > 0 && total - rawPaid <= 0.01);
  const effectivePaid = isCleared ? Math.max(rawPaid, total) : rawPaid;
  const rem = isCleared ? 0 : Math.round(Math.max(0, total - effectivePaid) * 100) / 100;
  const nextPaymentStatus = isCleared
    ? 'paid'
    : effectivePaid > 0
      ? 'partial'
      : reading.paymentStatus || 'unpaid';

  return {
    ...reading,
    status: isIssuedOrPaid && reading.status !== 'cancelled' ? 'verified' : resolvedUnbilledStatus,
    ...(isIssuedOrPaid ? { isBillingIssued: true } : {}),
    ...(shouldFlagHighUsage && !isIssuedOrPaid
      ? { isAnomaly: true, anomalyReason: resolvedAnomalyReason }
      : {}),
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
    ...(effectivePaid > 0 ? { paidAmount: effectivePaid } : {}),
    remainingBalance: rem,
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

/**
 * Canonical single-source-of-truth settlement summary for any MeterReading.
 * Guarantees `paidAmount + remainingBalance === grossTotal` (within 1 centavo) across Admin & Consumer portals.
 */
export function getCanonicalBillSettlement(
  reading: any,
  fallbackClassification: 'Residential' | 'Commercial' | 'RES' | 'COMM' | string = 'Residential'
) {
  const cls: 'Residential' | 'Commercial' =
    (reading?.classification || fallbackClassification) === 'Commercial' ||
    (reading?.classification || fallbackClassification) === 'COMM'
      ? 'Commercial'
      : 'Residential';

  if (!reading || reading.status === 'cancelled') {
    const cancelledGross = reading ? getReadingTotalAssessment(reading, cls).totalBeforeDue : 0;
    return {
      grossTotal: cancelledGross,
      basicCharge: 0,
      franchiseTax: 0,
      arrears: 0,
      penaltyAmount: 0,
      amountAfterDueDate: 0,
      paidAmount: 0,
      remainingBalance: 0,
      paymentStatus: 'unpaid' as const,
      isCleared: false,
      isPaid: false,
      isPartial: false,
      isUnpaid: true,
    };
  }

  const assessment = getReadingTotalAssessment(reading, cls);
  const grossTotal = assessment.totalBeforeDue;
  const rawPaid = Math.max(0, Math.round((Number(reading.paidAmount) || 0) * 100) / 100);
  const isCleared =
    reading.paymentStatus === 'paid' || (grossTotal > 0 && grossTotal - rawPaid <= 0.01);
  const paidAmount = isCleared ? Math.max(rawPaid, grossTotal) : rawPaid;
  const remainingBalance = isCleared
    ? 0
    : Math.max(0, Math.round((grossTotal - paidAmount) * 100) / 100);
  const isPartial = !isCleared && (paidAmount > 0 || reading.paymentStatus === 'partial');
  const isUnpaid = !isCleared && !isPartial;
  const paymentStatus: 'paid' | 'partial' | 'unpaid' = isCleared
    ? 'paid'
    : isPartial
      ? 'partial'
      : 'unpaid';

  return {
    grossTotal,
    basicCharge: assessment.basicCharge,
    franchiseTax: assessment.franchiseTax,
    arrears: assessment.arrears,
    penaltyAmount: assessment.penaltyAmount,
    amountAfterDueDate: assessment.amountAfterDueDate,
    paidAmount,
    remainingBalance,
    paymentStatus,
    isCleared,
    isPaid: isCleared,
    isPartial,
    isUnpaid,
  };
}

/**
 * Strips duplicate rolled-over `arrears` on newer cycle bills when prior issued cycle bills
 * for the same account ALREADY exist as separate rows in the ledger, preventing 2x double-counting
/**
 * Harmonizes multi-bill ledgers for accounts so that:
 * 1. Historical legacy bills remain intact as their own historical records.
 * 2. Unpaid balances from previous billing periods correctly carry forward into subsequent bills as 'Arrears'.
 * 3. Total amounts and remaining balances reconcile cleanly without data duplication or loss.
 */
export function sanitizeMultiBillDuplicateArrears<T extends Record<string, any>>(readings: T[]): T[] {
  if (!Array.isArray(readings) || readings.length <= 1) return readings;

  const issuedByAccount = new Map<string, T[]>();
  for (const r of readings) {
    if (!r || r.status === 'cancelled' || !isOfficialBillIssued(r as any)) continue;
    const acc = String(r.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
    if (!acc) continue;
    const bucket = issuedByAccount.get(acc) || [];
    bucket.push(r);
    issuedByAccount.set(acc, bucket);
  }

  const adjustedById = new Map<string, T>();
  issuedByAccount.forEach((bucket) => {
    if (bucket.length <= 1) return;
    // Sort oldest -> newest
    const chronological = [...bucket].sort(
      (a, b) =>
        new Date(a.readingDate || a.billingIssuedAt || 0).getTime() -
        new Date(b.readingDate || b.billingIssuedAt || 0).getTime()
    );

    // Track cumulative carried forward arrears across bills
    for (let i = 0; i < chronological.length; i++) {
      const item = chronological[i];
      const cls =
        item.classification === 'Commercial' || item.classification === 'COMM'
          ? 'Commercial'
          : 'Residential';
      const basic = getReadingEffectiveBillAmount(item as any, cls);
      const fTax =
        typeof item.franchiseTax === 'number' && !Number.isNaN(item.franchiseTax)
          ? Math.round(item.franchiseTax * 100) / 100
          : calculateFranchiseTax(basic);

      const paidSoFar = Math.max(0, Math.round((Number(item.paidAmount) || 0) * 100) / 100);

      // For bill i, compute the unpaid legacy balance from prior bills (0 .. i-1)
      let priorUnpaidArrears = 0;
      if (i > 0) {
        // Look at previous bills to calculate carried forward arrears
        for (let j = 0; j < i; j++) {
          const prior = adjustedById.get(String(chronological[j].id)) || chronological[j];
          const priorSettlement = getCanonicalBillSettlement(prior, prior.classification || cls);
          if (!priorSettlement.isCleared && priorSettlement.remainingBalance > 0) {
            // Take the cycle remaining balance of the prior bill
            const priorCycle = Math.round((priorSettlement.basicCharge + priorSettlement.franchiseTax) * 100) / 100;
            const priorCycleRem = Math.max(0, Math.round((priorCycle - priorSettlement.paidAmount) * 100) / 100);
            priorUnpaidArrears += priorCycleRem;
          }
        }
      }

      // Preserve explicitly recorded arrears or use computed prior unpaid arrears
      const effectiveArrears = item.arrears !== undefined && Number(item.arrears) > 0
        ? Math.round(Number(item.arrears) * 100) / 100
        : Math.round(priorUnpaidArrears * 100) / 100;

      const grossTotal = Math.round((basic + fTax + effectiveArrears) * 100) / 100;
      const isNowCleared = item.paymentStatus === 'paid' || (grossTotal > 0 && grossTotal - paidSoFar <= 0.01);
      const rem = isNowCleared ? 0 : Math.max(0, Math.round((grossTotal - paidSoFar) * 100) / 100);
      const pen =
        typeof item.penaltyAmount === 'number' && !Number.isNaN(item.penaltyAmount)
          ? Math.round(item.penaltyAmount * 100) / 100
          : calculateLatePenalty(basic);

      adjustedById.set(String(item.id), {
        ...item,
        arrears: effectiveArrears,
        billAmount: basic,
        franchiseTax: fTax,
        totalAmount: grossTotal,
        amountAfterDueDate: Math.round((grossTotal + pen) * 100) / 100,
        paidAmount: isNowCleared ? Math.max(paidSoFar, grossTotal) : paidSoFar,
        remainingBalance: rem,
        paymentStatus: isNowCleared ? 'paid' : paidSoFar > 0 ? 'partial' : item.paymentStatus || 'unpaid',
      });
    }
  });

  if (adjustedById.size === 0) return readings;
  return readings.map((r) => (r && r.id && adjustedById.has(String(r.id)) ? adjustedById.get(String(r.id))! : r));
}

/**
 * Computes exact total unsettled balance across an account's bills without double-counting.
 * When the latest bill carries forward previous unpaid balances as 'Arrears',
 * its remaining balance represents the cumulative total balance.
 */
export function computeAccountOutstandingBalance(
  readings: any[],
  accountNumber?: string | null,
  fallbackClassification: 'Residential' | 'Commercial' | string = 'Residential'
): number {
  if (!Array.isArray(readings) || readings.length === 0) return 0;
  const cleanTargetAcc = accountNumber
    ? String(accountNumber).replace(/^#/, '').trim().toUpperCase()
    : '';

  // Filter valid officially issued bills
  const validBills = readings.filter(r => {
    if (!r || r.status === 'cancelled' || !isOfficialBillIssued(r)) return false;
    if (cleanTargetAcc) {
      const rAcc = String(r.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
      if (rAcc !== cleanTargetAcc) return false;
    }
    return true;
  });

  if (validBills.length === 0) return 0;

  // If calculating for a specific account:
  if (cleanTargetAcc) {
    const chronological = [...validBills].sort(
      (a, b) =>
        new Date(a.readingDate || a.billingIssuedAt || 0).getTime() -
        new Date(b.readingDate || b.billingIssuedAt || 0).getTime()
    );

    const latest = chronological[chronological.length - 1];
    const latestSettlement = getCanonicalBillSettlement(latest, latest.classification || fallbackClassification);

    // If the latest bill carries forward prior arrears, its remainingBalance encapsulates the entire balance
    if (latest.arrears !== undefined && Number(latest.arrears) > 0) {
      return latestSettlement.isCleared ? 0 : latestSettlement.remainingBalance;
    }

    // Otherwise, sum the cycle remaining balances across all unpaid bills
    let totalUnsettled = 0;
    for (const b of chronological) {
      const settlement = getCanonicalBillSettlement(b, b.classification || fallbackClassification);
      if (settlement.isCleared) continue;
      const cycleCharge = Math.round((settlement.basicCharge + settlement.franchiseTax) * 100) / 100;
      const cycleRem = Math.max(0, Math.round((cycleCharge - settlement.paidAmount) * 100) / 100);
      totalUnsettled += cycleRem;
    }
    return Math.round(totalUnsettled * 100) / 100;
  }

  // Across all accounts: group and aggregate per account
  const byAccount = new Map<string, any[]>();
  for (const b of validBills) {
    const acc = String(b.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
    if (!acc) continue;
    const bucket = byAccount.get(acc) || [];
    bucket.push(b);
    byAccount.set(acc, bucket);
  }

  let grandTotal = 0;
  byAccount.forEach((bills, acc) => {
    grandTotal += computeAccountOutstandingBalance(bills, acc, fallbackClassification);
  });
  return Math.round(grandTotal * 100) / 100;
}

/**
 * Computes official historical arrears for an account strictly prior to a target reading / cycle.
 * Arrears represent the customer's unpaid balance from previous billing periods.
 * Carries forward until fully paid, without double-counting previous cycles.
 */
export function computeHistoricalArrearsForReading(
  allReadings: any[],
  accountNumber?: string | null,
  targetReadingDateOrPeriod?: string | null,
  targetReadingId?: string | null,
  fallbackClassification: 'Residential' | 'Commercial' | string = 'Residential'
): number {
  if (!Array.isArray(allReadings) || allReadings.length === 0 || !accountNumber) return 0;
  const cleanTargetAcc = String(accountNumber).replace(/^#/, '').trim().toUpperCase();

  // Parse target date/timestamp
  let targetTime = Infinity;
  if (targetReadingDateOrPeriod) {
    const parsed = new Date(targetReadingDateOrPeriod).getTime();
    if (!isNaN(parsed)) {
      targetTime = parsed;
    } else {
      const monthParsed = Date.parse(targetReadingDateOrPeriod + ' 1');
      if (!isNaN(monthParsed)) targetTime = monthParsed;
    }
  }

  // Filter bills strictly prior to targetTime
  const priorBills = allReadings
    .filter(r => {
      if (!r || r.status === 'cancelled' || !isOfficialBillIssued(r)) return false;
      if (targetReadingId && String(r.id) === String(targetReadingId)) return false;
      const rAcc = String(r.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
      if (rAcc !== cleanTargetAcc) return false;

      const rDate = r.readingDate || r.billingIssuedAt;
      const rTime = rDate ? new Date(rDate).getTime() : 0;
      if (targetTime !== Infinity && rTime && !isNaN(rTime) && rTime >= targetTime) {
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        new Date(a.readingDate || a.billingIssuedAt || 0).getTime() -
        new Date(b.readingDate || b.billingIssuedAt || 0).getTime()
    );

  if (priorBills.length === 0) return 0;

  // The latest prior bill, if it already carried forward older arrears, contains the cumulative balance
  const latestPrior = priorBills[priorBills.length - 1];
  const latestPriorSettlement = getCanonicalBillSettlement(latestPrior, latestPrior.classification || fallbackClassification);
  if (latestPrior.arrears !== undefined && Number(latestPrior.arrears) > 0) {
    return latestPriorSettlement.isCleared ? 0 : latestPriorSettlement.remainingBalance;
  }

  // Otherwise, sum the cycle remaining balances across all prior unpaid bills
  let totalArrears = 0;
  for (const r of priorBills) {
    const settlement = getCanonicalBillSettlement(r, r.classification || fallbackClassification);
    if (!settlement.isCleared && settlement.remainingBalance > 0) {
      const cycleTotal = Math.round((settlement.basicCharge + settlement.franchiseTax) * 100) / 100;
      const cycleRem = Math.max(0, Math.round((cycleTotal - settlement.paidAmount) * 100) / 100);
      totalArrears += cycleRem;
    }
  }

  return Math.round(totalArrears * 100) / 100;
}

export interface PaymentAllocationResult {
  allocations: Array<{
    readingId: string;
    allocatedAmount: number;
    newPaidAmount: number;
    newRemainingBalance: number;
    newPaymentStatus: 'paid' | 'partial';
  }>;
  totalAllocated: number;
  excessCash: number;
  updatedReadings: any[];
}

/**
 * Allocates a payment across an account's bills, oldest outstanding bill first.
 * If payment is greater than oldest bill, cascades to the next oldest until payment is exhausted.
 */
export function allocatePaymentOldestFirst(
  allReadings: any[],
  accountNumber: string,
  paymentAmount: number,
  paymentMeta: {
    orNumber?: string;
    paymentMethod?: string;
    cashierName?: string;
    paymentDate?: string;
  } = {}
): PaymentAllocationResult {
  const cleanTargetAcc = String(accountNumber).replace(/^#/, '').trim().toUpperCase();
  const nowIso = new Date().toISOString();
  const payDateStr = paymentMeta.paymentDate || nowIso.split('T')[0];
  const orNo = paymentMeta.orNumber || `OR-2026-${Math.floor(100000 + Math.random() * 900000)}`;

  // Find all unpaid or partially paid issued bills for this account, sorted oldest to newest
  const accountBills = allReadings
    .filter((r) => {
      if (!r || r.status === 'cancelled' || !isOfficialBillIssued(r)) return false;
      const rAcc = String(r.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
      if (rAcc !== cleanTargetAcc) return false;
      const settlement = getCanonicalBillSettlement(r, r.classification);
      return !settlement.isCleared && settlement.remainingBalance > 0;
    })
    .sort((a, b) => {
      const timeA = new Date(a.readingDate || a.billingIssuedAt || 0).getTime();
      const timeB = new Date(b.readingDate || b.billingIssuedAt || 0).getTime();
      return timeA - timeB;
    });

  let remainingCash = Math.max(0, Math.round(paymentAmount * 100) / 100);
  const allocations: PaymentAllocationResult['allocations'] = [];
  const allocationMap = new Map<string, (typeof allocations)[0]>();

  for (const bill of accountBills) {
    if (remainingCash <= 0) break;
    const settlement = getCanonicalBillSettlement(bill, bill.classification);
    const dueOnBill = settlement.remainingBalance;
    const allocAmount = Math.min(dueOnBill, remainingCash);

    remainingCash = Math.max(0, Math.round((remainingCash - allocAmount) * 100) / 100);

    const prevPaid = settlement.paidAmount;
    const newPaid = Math.round((prevPaid + allocAmount) * 100) / 100;
    const newRem = Math.max(0, Math.round((settlement.grossTotal - newPaid) * 100) / 100);
    const newStatus: 'paid' | 'partial' = newRem <= 0.01 ? 'paid' : 'partial';

    const allocRecord = {
      readingId: String(bill.id),
      allocatedAmount: allocAmount,
      newPaidAmount: newStatus === 'paid' ? settlement.grossTotal : newPaid,
      newRemainingBalance: newStatus === 'paid' ? 0 : newRem,
      newPaymentStatus: newStatus,
    };
    allocations.push(allocRecord);
    allocationMap.set(String(bill.id), allocRecord);
  }

  const totalAllocated = Math.round((paymentAmount - remainingCash) * 100) / 100;

  const updatedReadings = allReadings.map((r) => {
    if (!r || !allocationMap.has(String(r.id))) return r;
    const alloc = allocationMap.get(String(r.id))!;
    const settlement = getCanonicalBillSettlement(r, r.classification);
    return {
      ...r,
      status: 'verified',
      isBillingIssued: true,
      tariffBaselineSchema: OFFICIAL_TARIFF_BASELINE_SCHEMA,
      billAmount: settlement.basicCharge,
      franchiseTax: settlement.franchiseTax,
      arrears: settlement.arrears,
      totalAmount: settlement.grossTotal,
      paidAmount: alloc.newPaidAmount,
      remainingBalance: alloc.newRemainingBalance,
      paymentStatus: alloc.newPaymentStatus,
      paymentDate: payDateStr,
      paymentMethod: paymentMeta.paymentMethod || r.paymentMethod || 'Cash',
      orNumber: orNo,
      paymentReference: orNo,
      cashierName: paymentMeta.cashierName || r.cashierName || 'TWD Cashier',
      isDisconnectionNoticeIssued: false,
      penaltyAmount: alloc.newPaymentStatus === 'paid' ? 0 : r.penaltyAmount,
    };
  });

  return {
    allocations,
    totalAllocated,
    excessCash: remainingCash,
    updatedReadings,
  };
}

/**
 * Merges two snapshots of the same MeterReading (e.g. local vs server/Firestore) without ever
 * dropping 2% Franchise Tax, losing partial payments, or causing sudden number jumps.
 */
export function mergeReadingRecordCanonical<T extends Record<string, any>>(prev: T | null | undefined, incoming: T): T {
  if (!prev) {
    const odo = computeOdometerConsumption(
      incoming.previousReading,
      incoming.currentReading ?? incoming.presentReading,
      incoming.consumption
    );
    return normalizeReadingToOfficialBaseline({
      ...incoming,
      previousReading: odo.previousReading,
      presentReading: odo.currentReading,
      currentReading: odo.currentReading,
      consumption: odo.consumption,
    } as any) as unknown as T;
  }

  const prevPaidVal = Math.max(0, Math.round((Number(prev.paidAmount) || 0) * 100) / 100);
  const incPaidVal = Math.max(0, Math.round((Number(incoming.paidAmount) || 0) * 100) / 100);
  const maxPaid = Math.max(prevPaidVal, incPaidVal);

  const prevBilled = Boolean(
    prev.isBillingIssued ||
      prev.billingIssuedAt ||
      prev.invoiceNumber ||
      prev.paymentStatus === 'paid' ||
      prev.paymentStatus === 'partial' ||
      prevPaidVal > 0
  );
  const incBilled = Boolean(
    incoming.isBillingIssued ||
      incoming.billingIssuedAt ||
      incoming.invoiceNumber ||
      incoming.paymentStatus === 'paid' ||
      incoming.paymentStatus === 'partial' ||
      incPaidVal > 0
  );
  const mergedBillingIssued = prevBilled || incBilled;

  const billedSource = incBilled ? incoming : prevBilled ? prev : incoming;
  const fallbackBilled = billedSource === incoming ? prev : incoming;

  // Prefer payment metadata from whichever snapshot has higher paidAmount (or incoming on tie when incoming has payment metadata)
  const paymentPrimary =
    incPaidVal > prevPaidVal ||
    (incPaidVal === prevPaidVal &&
      (incoming.paymentStatus === 'paid' ||
        (incoming.paymentStatus === 'partial' && prev.paymentStatus !== 'paid') ||
        Boolean(incoming.orNumber)))
      ? incoming
      : prev;
  const paymentSecondary = paymentPrimary === incoming ? prev : incoming;

  const rawCurr =
    billedSource.currentReading ??
    billedSource.presentReading ??
    fallbackBilled.currentReading ??
    fallbackBilled.presentReading ??
    0;
  const candPrev = billedSource.previousReading ?? fallbackBilled.previousReading ?? 0;
  const odoMerged = computeOdometerConsumption(
    candPrev,
    rawCurr,
    billedSource.consumption ?? fallbackBilled.consumption
  );

  const cls: 'Residential' | 'Commercial' =
    (billedSource.classification || fallbackBilled.classification) === 'Commercial' ||
    (billedSource.classification || fallbackBilled.classification) === 'COMM'
      ? 'Commercial'
      : 'Residential';

  const mergedBillAmountRaw =
    Number(billedSource.billAmount || fallbackBilled.billAmount || 0) ||
    prev.billAmount ||
    incoming.billAmount;
  const basicCharge =
    typeof mergedBillAmountRaw === 'number' && !Number.isNaN(mergedBillAmountRaw) && mergedBillAmountRaw > 0
      ? Math.round(mergedBillAmountRaw * 100) / 100
      : calculateWaterTariff(odoMerged.consumption, cls);

  const rawFTax = billedSource.franchiseTax ?? fallbackBilled.franchiseTax;
  const franchiseTax =
    typeof rawFTax === 'number' && !Number.isNaN(rawFTax) && rawFTax >= 0
      ? Math.round(rawFTax * 100) / 100
      : calculateFranchiseTax(basicCharge);

  const rawArrears = billedSource.arrears ?? fallbackBilled.arrears ?? 0;
  const arrears = Math.max(0, Math.round((Number(rawArrears) || 0) * 100) / 100);
  const canonicalGross = Math.round((basicCharge + franchiseTax + arrears) * 100) / 100;

  const candidateTotal = Number(billedSource.totalAmount || fallbackBilled.totalAmount || 0);
  const mergedTotalAmount =
    candidateTotal > 0 && !(franchiseTax > 0 && Math.abs(candidateTotal - basicCharge) < 0.015)
      ? Math.round(candidateTotal * 100) / 100
      : canonicalGross;

  const penaltyAmount =
    typeof (billedSource.penaltyAmount ?? fallbackBilled.penaltyAmount) === 'number'
      ? Math.round(Number(billedSource.penaltyAmount ?? fallbackBilled.penaltyAmount) * 100) / 100
      : calculateLatePenalty(basicCharge);
  const amountAfterDueDate = Math.round((mergedTotalAmount + penaltyAmount) * 100) / 100;

  const isPaid =
    prev.paymentStatus === 'paid' ||
    incoming.paymentStatus === 'paid' ||
    (mergedTotalAmount > 0 && mergedTotalAmount - maxPaid <= 0.01);
  const effectivePaid = isPaid ? Math.max(maxPaid, mergedTotalAmount) : maxPaid;
  const isPartial =
    !isPaid &&
    (effectivePaid > 0 || prev.paymentStatus === 'partial' || incoming.paymentStatus === 'partial');
  const computedRemaining = isPaid
    ? 0
    : Math.max(0, Math.round((mergedTotalAmount - effectivePaid) * 100) / 100);

  const mergedRecord = {
    ...prev,
    ...incoming,
    classification: billedSource.classification || fallbackBilled.classification || cls,
    previousReading: odoMerged.previousReading,
    presentReading: odoMerged.currentReading,
    currentReading: odoMerged.currentReading,
    consumption: odoMerged.consumption,
    submittedAt: incoming.submittedAt || prev.submittedAt,
    isBillingIssued: mergedBillingIssued ? true : Boolean(incoming.isBillingIssued ?? prev.isBillingIssued),
    billingIssuedAt: incoming.billingIssuedAt || prev.billingIssuedAt,
    billingIssuedBy: incoming.billingIssuedBy || prev.billingIssuedBy,
    invoiceNumber: incoming.invoiceNumber || prev.invoiceNumber,
    dueDate: billedSource.dueDate || fallbackBilled.dueDate,
    billAmount: basicCharge,
    franchiseTax,
    arrears,
    totalAmount: mergedTotalAmount,
    penaltyAmount,
    amountAfterDueDate,
    tariffBaselineSchema: OFFICIAL_TARIFF_BASELINE_SCHEMA,
    status:
      prev.status === 'cancelled' || incoming.status === 'cancelled'
        ? 'cancelled'
        : mergedBillingIssued || prev.status === 'verified' || incoming.status === 'verified'
          ? 'verified'
          : incoming.status || prev.status,
    paymentStatus: isPaid ? 'paid' : isPartial ? 'partial' : incoming.paymentStatus || prev.paymentStatus || 'unpaid',
    paidAmount: effectivePaid > 0 ? effectivePaid : prev.paidAmount ?? incoming.paidAmount,
    remainingBalance: computedRemaining,
    orNumber: paymentPrimary.orNumber || paymentSecondary.orNumber,
    paymentReference: paymentPrimary.paymentReference || paymentSecondary.paymentReference,
    paymentDate: paymentPrimary.paymentDate || paymentSecondary.paymentDate,
    paymentMethod: paymentPrimary.paymentMethod || paymentSecondary.paymentMethod,
    cashierName: paymentPrimary.cashierName || paymentSecondary.cashierName,
    transactionId: paymentPrimary.transactionId || paymentSecondary.transactionId,
    paymentReceiptUrl: paymentPrimary.paymentReceiptUrl || paymentSecondary.paymentReceiptUrl,
    receiptUploadDate: paymentPrimary.receiptUploadDate || paymentSecondary.receiptUploadDate,
    receiptStatus: paymentPrimary.receiptStatus || paymentSecondary.receiptStatus,
    receiptNotes: paymentPrimary.receiptNotes || paymentSecondary.receiptNotes,
    imageUrl: incoming.imageUrl || prev.imageUrl,
    meterImageUrl: incoming.meterImageUrl || prev.meterImageUrl,
  };

  return normalizeReadingToOfficialBaseline(mergedRecord as any) as unknown as T;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Official Tagoloan Water District Tariff & Billing Notice Engine
 * Modeled from authentic Tagoloan Water District billing notices (Oct 2024 - Present).
 * 
 * KEY BILLING FIELDS:
 * 1. Prev. Rdg. (Previous Meter Reading)
 * 2. Pres. Rdg. (Present Meter Reading)
 * 3. Usage (Present Reading - Previous Reading) in cu.m (m³)
 * 4. Bill Amt. (Basic water charge according to classification)
 *    - Residential (RES): Minimum 10 m³ @ ₱75.00; 11-20 m³ @ ₱8.25/m³; 21-30 m³ @ ₱9.75/m³; etc.
 *      • Example: 16 m³ = ₱75.00 + (6 × ₱8.25) = ₱124.50
 *      • Example: 17 m³ = ₱75.00 + (7 × ₱8.25) = ₱132.75
 *    - Commercial (COMM): Minimum 10 m³ @ ₱150.00; 11-20 m³ @ ₱16.50/m³; 21-30 m³ @ ₱20.00/m³;
 *      31-40 m³ @ ₱24.00/m³; 41-50 m³ @ ₱28.00/m³; 51-65 m³ @ ₱23.50/m³ (65 m³ = ₱1,387.50)
 * 5. Franchise Tax: 2% Local Franchise Tax on net water service: round((Bill Amt × 0.02) / 0.98, 2)
 *    • Example: ₱124.50 → ₱2.54
 *    • Example: ₱1,387.50 → ₱28.32
 *    • Example: ₱132.75 → ₱2.71
 * 6. Arrears: Unpaid balance from previous billing notices (e.g. ₱205.03)
 * 7. Total Amount Due: Bill Amt. + Franchise Tax + Arrears
 * 8. Amount After Due Date: Total + 10% Late Payment Surcharge on basic Bill Amt.
 *    • Example: ₱332.07 + ₱12.45 = ₱344.52
 *    • Example: ₱1,415.82 + ₱138.75 = ₱1,554.57
 *    • Example: ₱135.46 + ₱13.30 = ₱148.76
 */

export interface WaterTariffConfig {
  version: number;
  updatedAt: string;
  updatedBy: string;
  effectiveDate: string;
  resolutionNumber: string;
  memoNotes: string;
  residential: {
    baseMinCharge: number; // 1-10 m³
    tier1_rate: number;    // 11-20 m³
    tier2_rate: number;    // 21-30 m³
    tier3_rate: number;    // 31-40 m³
    tier4_rate: number;    // 41+ m³
  };
  commercial: {
    baseMinCharge: number; // 1-10 m³
    tier1_rate: number;    // 11-20 m³
    tier2_rate: number;    // 21-30 m³
    tier3_rate: number;    // 31-40 m³
    tier4_rate: number;    // 41-50 m³
    tier5_rate: number;    // 51+ m³
  };
  franchiseTaxRate: number; // e.g. 0.02 (2%)
  latePaymentSurchargeRate: number; // e.g. 0.10 (10%)
}

export const DEFAULT_TARIFF_CONFIG: WaterTariffConfig = {
  version: 1,
  updatedAt: '2024-10-01T00:00:00.000Z',
  updatedBy: 'Tagoloan Water District Board',
  effectiveDate: 'October 1, 2024',
  resolutionNumber: 'TWD-LWUA-2024-001',
  memoNotes: 'Standard Tagoloan Water District Tariff Schedule under PD 198 and LWUA guidelines.',
  residential: {
    baseMinCharge: 75.00,
    tier1_rate: 8.25,
    tier2_rate: 9.75,
    tier3_rate: 11.50,
    tier4_rate: 13.50,
  },
  commercial: {
    baseMinCharge: 150.00,
    tier1_rate: 16.50,
    tier2_rate: 20.00,
    tier3_rate: 24.00,
    tier4_rate: 28.00,
    tier5_rate: 23.50,
  },
  franchiseTaxRate: 0.02,
  latePaymentSurchargeRate: 0.10,
};

export const TARIFF_STORAGE_KEY = 'twd_live_v4_tariff_config';

let memoryTariffConfig: WaterTariffConfig = { ...DEFAULT_TARIFF_CONFIG };

export function getActiveTariffConfig(): WaterTariffConfig {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = localStorage.getItem(TARIFF_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.residential && parsed.commercial) {
          memoryTariffConfig = parsed;
          return parsed;
        }
      }
    } catch {}
  }
  return memoryTariffConfig;
}

export function saveActiveTariffConfig(config: WaterTariffConfig): void {
  memoryTariffConfig = config;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(TARIFF_STORAGE_KEY, JSON.stringify(config));
      window.dispatchEvent(new CustomEvent('twd_tariff_updated', { detail: config }));
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

/**
 * Calculates basic water charge (Bill Amt.) based on usage and classification.
 * Dynamically uses the active Tagoloan Water District tariff configuration.
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
    // RESIDENTIAL (RES)
    const res = tariff.residential;
    if (consumption <= 10) return res.baseMinCharge;

    let total = res.baseMinCharge;
    let remaining = consumption - 10;

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
    // COMMERCIAL (COMM)
    const comm = tariff.commercial;
    if (consumption <= 10) return comm.baseMinCharge;

    let total = comm.baseMinCharge;
    let remaining = consumption - 10;

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
 * Calculates 2% Franchise Tax: round((Bill Amt × rate) / (1 - rate), 2)
 */
export function calculateFranchiseTax(billAmount: number, customTariff?: WaterTariffConfig): number {
  if (billAmount <= 0) return 0;
  const tariff = customTariff || getActiveTariffConfig();
  const rate = tariff.franchiseTaxRate ?? 0.02;
  return Math.round(((billAmount * rate) / (1 - rate)) * 100) / 100;
}

/**
 * Calculates Late Payment Surcharge on basic Bill Amount (default 10%)
 */
export function calculateLatePenalty(billAmount: number, customTariff?: WaterTariffConfig): number {
  if (billAmount <= 0) return 0;
  const tariff = customTariff || getActiveTariffConfig();
  const rate = tariff.latePaymentSurchargeRate ?? 0.10;
  return Math.round(billAmount * rate * 100) / 100;
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
  const previousReading = Math.max(0, Number(params.previousReading) || 0);
  const presentReading = Math.max(0, Number(params.presentReading) || 0);
  const usage = Math.max(0, presentReading - previousReading);
  const classification = params.classification || 'Residential';

  const billAmount = calculateWaterTariff(usage, classification);
  const franchiseTax = calculateFranchiseTax(billAmount);
  const arrears = Math.max(0, Number(params.arrears) || 0);
  const totalAmount = Math.round((billAmount + franchiseTax + arrears) * 100) / 100;
  const penaltyAmount = calculateLatePenalty(billAmount);
  const amountAfterDueDate = Math.round((totalAmount + penaltyAmount) * 100) / 100;

  const dueDate = params.dueDate || 'December 12, 2024';
  const isOverdue = false; // Evaluated dynamically based on current date vs dueDate if needed

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

  const baseCharge = isComm ? tariff.commercial.baseMinCharge : tariff.residential.baseMinCharge;
  const tier1Rate = isComm ? tariff.commercial.tier1_rate : tariff.residential.tier1_rate;
  const tier2Rate = isComm ? tariff.commercial.tier2_rate : tariff.residential.tier2_rate;
  const tier3Rate = isComm ? tariff.commercial.tier3_rate : tariff.residential.tier3_rate;
  const tier4Rate = isComm ? tariff.commercial.tier4_rate : tariff.residential.tier4_rate;
  const tier5Rate = isComm ? tariff.commercial.tier5_rate : 0;

  tiers.push({
    tierNumber: 1,
    name: 'Minimum Charge (Lifeline Block)',
    range: '1 – 10 m³',
    volumeUsed: Math.min(consumption, 10),
    ratePerM3: baseCharge,
    isFixed: true,
    subtotal: consumption > 0 ? baseCharge : 0,
    isActive: consumption > 0,
  });

  if (consumption > 10) {
    const v1 = Math.min(consumption - 10, 10);
    tiers.push({
      tierNumber: 2,
      name: 'Tier 2 (11-20 m³)',
      range: '11 – 20 m³',
      volumeUsed: v1,
      ratePerM3: tier1Rate,
      isFixed: false,
      subtotal: v1 * tier1Rate,
      isActive: true,
    });
  }

  if (consumption > 20) {
    const v2 = Math.min(consumption - 20, 10);
    tiers.push({
      tierNumber: 3,
      name: 'Tier 3 (21-30 m³)',
      range: '21 – 30 m³',
      volumeUsed: v2,
      ratePerM3: tier2Rate,
      isFixed: false,
      subtotal: v2 * tier2Rate,
      isActive: true,
    });
  }

  if (consumption > 30) {
    const v3 = Math.min(consumption - 30, isComm ? 10 : 99999);
    tiers.push({
      tierNumber: 4,
      name: isComm ? 'Tier 4 (31-40 m³)' : 'Tier 4 (31+ m³)',
      range: isComm ? '31 – 40 m³' : '31+ m³',
      volumeUsed: v3,
      ratePerM3: tier3Rate,
      isFixed: false,
      subtotal: v3 * tier3Rate,
      isActive: true,
    });
  }

  if (isComm && consumption > 40) {
    const v4 = Math.min(consumption - 40, 10);
    tiers.push({
      tierNumber: 5,
      name: 'Tier 5 (41-50 m³)',
      range: '41 – 50 m³',
      volumeUsed: v4,
      ratePerM3: tier4Rate,
      isFixed: false,
      subtotal: v4 * tier4Rate,
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
      subtotal: v5 * tier5Rate,
      isActive: true,
    });
  }

  const billAmount = calculateWaterTariff(consumption, classification, tariff);
  const franchiseTax = calculateFranchiseTax(billAmount, tariff);

  return {
    consumption,
    classification: isComm ? 'Commercial' : 'Residential',
    baseFixedCharge: consumption > 0 ? baseCharge : 0,
    totalBill: billAmount,
    franchiseTax,
    tiers,
    explanation: `Tagoloan Water District ${isComm ? 'COMM' : 'RES'} Tariff (${tariff.resolutionNumber}): Net consumption of ${consumption} m³ assessed at ₱${billAmount.toFixed(2)} basic bill + ₱${franchiseTax.toFixed(2)} franchise tax (${(tariff.franchiseTaxRate * 100).toFixed(0)}%).`,
  };
}

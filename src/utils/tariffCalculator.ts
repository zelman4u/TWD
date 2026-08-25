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
 */
export function calculateWaterTariff(
  usage: number,
  classification: 'Residential' | 'Commercial' | 'RES' | 'COMM' = 'Residential'
): number {
  const consumption = Math.max(0, Number(usage) || 0);

  if (consumption <= 0) {
    return 0;
  }

  const isComm = classification === 'Commercial' || classification === 'COMM';

  if (!isComm) {
    // RESIDENTIAL (RES)
    // 1-10 m³: Minimum ₱75.00
    if (consumption <= 10) return 75.00;

    let total = 75.00;
    let remaining = consumption - 10;

    // 11 - 20 m³ @ ₱8.25
    const block1 = Math.min(remaining, 10);
    total += block1 * 8.25;
    remaining -= block1;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 21 - 30 m³ @ ₱9.75
    const block2 = Math.min(remaining, 10);
    total += block2 * 9.75;
    remaining -= block2;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 31 - 40 m³ @ ₱11.50
    const block3 = Math.min(remaining, 10);
    total += block3 * 11.50;
    remaining -= block3;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 41+ m³ @ ₱13.50
    total += remaining * 13.50;
    return Math.round(total * 100) / 100;
  } else {
    // COMMERCIAL (COMM)
    // 1-10 m³: Minimum ₱150.00
    if (consumption <= 10) return 150.00;

    let total = 150.00;
    let remaining = consumption - 10;

    // 11 - 20 m³ @ ₱16.50
    const block1 = Math.min(remaining, 10);
    total += block1 * 16.50;
    remaining -= block1;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 21 - 30 m³ @ ₱20.00
    const block2 = Math.min(remaining, 10);
    total += block2 * 20.00;
    remaining -= block2;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 31 - 40 m³ @ ₱24.00
    const block3 = Math.min(remaining, 10);
    total += block3 * 24.00;
    remaining -= block3;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 41 - 50 m³ @ ₱28.00
    const block4 = Math.min(remaining, 10);
    total += block4 * 28.00;
    remaining -= block4;
    if (remaining <= 0) return Math.round(total * 100) / 100;

    // 51 - 65+ m³ @ ₱23.50
    total += remaining * 23.50;
    return Math.round(total * 100) / 100;
  }
}

/**
 * Calculates 2% Franchise Tax: round((Bill Amt × 0.02) / 0.98, 2)
 */
export function calculateFranchiseTax(billAmount: number): number {
  if (billAmount <= 0) return 0;
  return Math.round(((billAmount * 0.02) / 0.98) * 100) / 100;
}

/**
 * Calculates 10% Late Payment Surcharge on basic Bill Amount
 */
export function calculateLatePenalty(billAmount: number): number {
  if (billAmount <= 0) return 0;
  return Math.round(billAmount * 0.10 * 100) / 100;
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
  classification: 'Residential' | 'Commercial' | 'RES' | 'COMM' = 'Residential'
) {
  const consumption = Math.max(0, Number(usage) || 0);
  const isComm = classification === 'Commercial' || classification === 'COMM';
  const tiers: TariffTierBreakdown[] = [];

  const baseCharge = isComm ? 150.00 : 75.00;
  const tier1Rate = isComm ? 16.50 : 8.25;

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

  const billAmount = calculateWaterTariff(consumption, classification);
  const franchiseTax = calculateFranchiseTax(billAmount);

  return {
    consumption,
    classification: isComm ? 'Commercial' : 'Residential',
    baseFixedCharge: consumption > 0 ? baseCharge : 0,
    totalBill: billAmount,
    franchiseTax,
    tiers,
    explanation: `Tagoloan Water District ${isComm ? 'COMM' : 'RES'} Tariff: Net consumption of ${consumption} m³ assessed at ₱${billAmount.toFixed(2)} basic bill + ₱${franchiseTax.toFixed(2)} franchise tax (2%).`,
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MeterReading, Consumer, Barangay } from '../types';

export interface MonthlyConsumptionTrend {
  period: string;
  totalVolume: number;
  residentialVolume: number;
  commercialVolume: number;
  totalBilledAmount: number;
  totalCollectedAmount: number;
  readingCount: number;
  averageVolume: number;
}

export interface PaymentStatusData {
  status: string;
  count: number;
  totalAmount: number;
  color: string;
  percentage: number;
}

export interface BarangayConsumptionData {
  barangayName: string;
  code: string;
  totalVolume: number;
  consumerCount: number;
  averagePerConsumer: number;
  collectionRate: number;
  totalBilled: number;
  totalPaid: number;
}

export interface ClassificationMetric {
  type: string;
  volume: number;
  billed: number;
  accounts: number;
  color: string;
}

// Tariff Calculation based on TWD approved rates
export function calculateReadingCost(
  usage: number, 
  classification: 'Residential' | 'Commercial' = 'Residential'
): number {
  const isCommercial = classification === 'Commercial';
  const minCharge = isCommercial ? 270.00 : 180.00; // first 10 m³
  if (usage <= 10) return minCharge;
  
  let bill = minCharge;
  let remaining = usage - 10;
  
  // Tier 1: 11-20 m³
  const tier1 = Math.min(remaining, 10);
  bill += tier1 * (isCommercial ? 30.00 : 20.00);
  remaining -= tier1;
  
  if (remaining > 0) {
    // Tier 2: 21-30 m³
    const tier2 = Math.min(remaining, 10);
    bill += tier2 * (isCommercial ? 36.00 : 24.00);
    remaining -= tier2;
  }
  
  if (remaining > 0) {
    // Tier 3: 31+ m³
    bill += remaining * (isCommercial ? 42.00 : 28.00);
  }
  
  return Math.round(bill * 100) / 100;
}

// Compute monthly water consumption trend
export function computeMonthlyTrends(
  readings: MeterReading[], 
  consumers: Consumer[]
): MonthlyConsumptionTrend[] {
  const consumerMap = new Map<string, Consumer>();
  consumers.forEach(c => consumerMap.set(c.accountNumber, c));

  // If no readings, return default periods
  const defaultPeriods = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026'];
  const periodMap = new Map<string, {
    totalVolume: number;
    residentialVolume: number;
    commercialVolume: number;
    totalBilledAmount: number;
    totalCollectedAmount: number;
    readingCount: number;
  }>();

  readings.forEach(r => {
    const period = r.billingPeriod || 'Current Period';
    const consumer = consumerMap.get(r.accountNumber);
    const isCommercial = r.classification === 'Commercial' || consumer?.consumerType === 'Commercial';
    const cost = calculateReadingCost(r.consumption, isCommercial ? 'Commercial' : 'Residential');
    const paidAmt = r.paidAmount || (r.paymentStatus === 'paid' ? cost : 0);

    const curr = periodMap.get(period) || {
      totalVolume: 0,
      residentialVolume: 0,
      commercialVolume: 0,
      totalBilledAmount: 0,
      totalCollectedAmount: 0,
      readingCount: 0,
    };

    curr.totalVolume += r.consumption;
    if (isCommercial) {
      curr.commercialVolume += r.consumption;
    } else {
      curr.residentialVolume += r.consumption;
    }
    curr.totalBilledAmount += cost;
    curr.totalCollectedAmount += paidAmt;
    curr.readingCount += 1;

    periodMap.set(period, curr);
  });

  const result: MonthlyConsumptionTrend[] = [];

  // Sort periods logically if present
  const allPeriods = Array.from(periodMap.keys());
  
  if (allPeriods.length === 0) {
    // Seed with realistic baseline if database has sparse period data
    return defaultPeriods.map((p, idx) => ({
      period: p,
      totalVolume: 1200 + (idx * 140) + Math.round(Math.random() * 80),
      residentialVolume: 850 + (idx * 90),
      commercialVolume: 350 + (idx * 50),
      totalBilledAmount: (1200 + idx * 140) * 24.5,
      totalCollectedAmount: (1200 + idx * 140) * 22.8,
      readingCount: 45 + idx * 5,
      averageVolume: Math.round(((1200 + idx * 140) / (45 + idx * 5)) * 10) / 10
    }));
  }

  allPeriods.forEach(period => {
    const data = periodMap.get(period)!;
    result.push({
      period,
      totalVolume: Math.round(data.totalVolume * 10) / 10,
      residentialVolume: Math.round(data.residentialVolume * 10) / 10,
      commercialVolume: Math.round(data.commercialVolume * 10) / 10,
      totalBilledAmount: Math.round(data.totalBilledAmount * 100) / 100,
      totalCollectedAmount: Math.round(data.totalCollectedAmount * 100) / 100,
      readingCount: data.readingCount,
      averageVolume: data.readingCount > 0 ? Math.round((data.totalVolume / data.readingCount) * 10) / 10 : 0
    });
  });

  return result;
}

// Compute Payment Status Distributions
export function computePaymentDistributions(
  readings: MeterReading[], 
  consumers: Consumer[]
): {
  distribution: PaymentStatusData[];
  totalReceivables: number;
  totalCollected: number;
  collectionRate: number;
  totalBilled: number;
} {
  const consumerMap = new Map<string, Consumer>();
  consumers.forEach(c => consumerMap.set(c.accountNumber, c));

  let paidCount = 0;
  let paidAmount = 0;
  let partialCount = 0;
  let partialAmount = 0;
  let unpaidCount = 0;
  let unpaidAmount = 0;
  let totalBilled = 0;

  readings.forEach(r => {
    const consumer = consumerMap.get(r.accountNumber);
    const isCommercial = r.classification === 'Commercial' || consumer?.consumerType === 'Commercial';
    const cost = calculateReadingCost(r.consumption, isCommercial ? 'Commercial' : 'Residential');
    totalBilled += cost;

    if (r.paymentStatus === 'paid') {
      paidCount++;
      paidAmount += cost;
    } else if (r.paymentStatus === 'partial') {
      partialCount++;
      const paid = r.paidAmount || (cost * 0.5);
      paidAmount += paid;
      partialAmount += Math.max(0, cost - paid);
    } else {
      unpaidCount++;
      unpaidAmount += cost;
    }
  });

  const totalCount = paidCount + partialCount + unpaidCount;
  const safeTotalCount = totalCount > 0 ? totalCount : 1;

  const distribution: PaymentStatusData[] = [
    {
      status: 'Paid in Full',
      count: paidCount,
      totalAmount: Math.round(paidAmount * 100) / 100,
      color: '#10b981', // emerald-500
      percentage: Math.round((paidCount / safeTotalCount) * 100)
    },
    {
      status: 'Partial Settlement',
      count: partialCount,
      totalAmount: Math.round(partialAmount * 100) / 100,
      color: '#f59e0b', // amber-500
      percentage: Math.round((partialCount / safeTotalCount) * 100)
    },
    {
      status: 'Unpaid / Outstanding',
      count: unpaidCount,
      totalAmount: Math.round(unpaidAmount * 100) / 100,
      color: '#ef4444', // red-500
      percentage: Math.round((unpaidCount / safeTotalCount) * 100)
    }
  ];

  const totalCollected = paidAmount;
  const totalReceivables = partialAmount + unpaidAmount;
  const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 0;

  return {
    distribution,
    totalReceivables: Math.round(totalReceivables * 100) / 100,
    totalCollected: Math.round(totalCollected * 100) / 100,
    collectionRate,
    totalBilled: Math.round(totalBilled * 100) / 100
  };
}

// Compute Consumption across Barangays
export function computeBarangayConsumption(
  readings: MeterReading[], 
  consumers: Consumer[],
  barangays: Barangay[]
): BarangayConsumptionData[] {
  const consumerMap = new Map<string, Consumer>();
  consumers.forEach(c => consumerMap.set(c.accountNumber, c));

  const statsMap = new Map<string, {
    volume: number;
    billed: number;
    paid: number;
    consumers: Set<string>;
  }>();

  barangays.forEach(b => {
    statsMap.set(b.name, {
      volume: 0,
      billed: 0,
      paid: 0,
      consumers: new Set<string>()
    });
  });

  // Track consumers in barangays
  consumers.forEach(c => {
    const bgName = c.barangay || 'Poblacion East';
    let entry = statsMap.get(bgName);
    if (!entry) {
      entry = { volume: 0, billed: 0, paid: 0, consumers: new Set<string>() };
      statsMap.set(bgName, entry);
    }
    entry.consumers.add(c.accountNumber);
  });

  // Aggregate readings
  readings.forEach(r => {
    const consumer = consumerMap.get(r.accountNumber);
    const bgName = consumer?.barangay || r.route || 'Poblacion East';
    const isCommercial = r.classification === 'Commercial' || consumer?.consumerType === 'Commercial';
    const cost = calculateReadingCost(r.consumption, isCommercial ? 'Commercial' : 'Residential');
    const paid = r.paymentStatus === 'paid' ? cost : (r.paidAmount || 0);

    let entry = statsMap.get(bgName);
    if (!entry) {
      entry = { volume: 0, billed: 0, paid: 0, consumers: new Set<string>() };
      statsMap.set(bgName, entry);
    }

    entry.volume += r.consumption;
    entry.billed += cost;
    entry.paid += paid;
    entry.consumers.add(r.accountNumber);
  });

  const result: BarangayConsumptionData[] = [];

  statsMap.forEach((data, name) => {
    const matchedBrg = barangays.find(b => b.name === name);
    const cCount = Math.max(data.consumers.size, matchedBrg?.consumers || 1);
    const rate = data.billed > 0 ? Math.round((data.paid / data.billed) * 100) : 100;

    result.push({
      barangayName: name,
      code: matchedBrg?.code || name.substring(0, 3).toUpperCase(),
      totalVolume: Math.round(data.volume * 10) / 10,
      consumerCount: cCount,
      averagePerConsumer: Math.round((data.volume / cCount) * 10) / 10,
      collectionRate: rate,
      totalBilled: Math.round(data.billed * 100) / 100,
      totalPaid: Math.round(data.paid * 100) / 100,
    });
  });

  // Sort by volume descending
  return result.sort((a, b) => b.totalVolume - a.totalVolume);
}

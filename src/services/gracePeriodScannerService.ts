/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { mockDb } from '../mockDb';
import { Consumer, MeterReading, AuditLog } from '../types';

export interface GracePeriodEvaluation {
  isExceeded: boolean;
  maxDaysOverdue: number;
  unpaidCycles: number;
  totalOverdueAmount: number;
  oldestDueDate: string | null;
  unpaidBills: MeterReading[];
}

export interface AccountScanItem {
  accountNumber: string;
  name: string;
  barangay?: string;
  previousStatus: string;
  newStatus: string;
  maxDaysOverdue: number;
  unpaidCycles: number;
  totalOverdueAmount: number;
  actionTaken: 'updated_to_disconnection' | 'restored_to_active' | 'retained_disconnection' | 'retained_active' | 'skipped';
  reason: string;
}

export interface ScanSummary {
  timestamp: string;
  scannedCount: number;
  updatedToDisconnectionCount: number;
  restoredToActiveCount: number;
  activeDisconnectionCount: number;
  items: AccountScanItem[];
}

export interface ScannerStatus {
  isRunning: boolean;
  intervalMs: number;
  lastScanTimestamp: string | null;
  lastScanSummary: ScanSummary | null;
  totalScanCycles: number;
}

/**
 * Evaluates whether a consumer account has exceeded the 3-month (90 days) payment grace period.
 * 
 * Criteria (Standard Tagoloan Water District Policy):
 * 1. An unpaid verified bill has exceeded 90 days past its due date (3 months grace period)
 * 2. Or 3 or more consecutive monthly billing cycles remain unpaid with outstanding balance
 * 3. Or an explicit disconnection notice is already issued on delinquent bill
 */
export function evaluateAccountGracePeriod(
  consumer: Consumer,
  allReadings: MeterReading[]
): GracePeriodEvaluation {
  if (!consumer.accountNumber || consumer.accountNumber.toUpperCase().startsWith('PENDING')) {
    return {
      isExceeded: false,
      maxDaysOverdue: 0,
      unpaidCycles: 0,
      totalOverdueAmount: 0,
      oldestDueDate: null,
      unpaidBills: []
    };
  }

  // Find all verified bills for this account
  const consumerBills = allReadings.filter(r => 
    r.status === 'verified' &&
    (r.accountNumber === consumer.accountNumber || (r.consumerName && r.consumerName.toLowerCase() === consumer.name.toLowerCase()))
  );

  // Filter for genuine unpaid balances
  const unpaidBills = consumerBills.filter(r => {
    if (r.paymentStatus === 'paid') return false;
    const gross = r.totalAmount || r.billAmount || 0;
    const paid = r.paidAmount || 0;
    return (gross - paid) > 0.5; // Has outstanding balance
  });

  if (unpaidBills.length === 0) {
    return {
      isExceeded: false,
      maxDaysOverdue: 0,
      unpaidCycles: 0,
      totalOverdueAmount: 0,
      oldestDueDate: null,
      unpaidBills: []
    };
  }

  const now = Date.now();
  let maxDaysOverdue = 0;
  let totalOverdueAmount = 0;
  let oldestDueDate: string | null = null;
  let oldestTime = Infinity;

  unpaidBills.forEach(bill => {
    let dueDateObj: Date;
    if (bill.dueDate) {
      dueDateObj = new Date(bill.dueDate);
      if (isNaN(dueDateObj.getTime())) {
        dueDateObj = new Date('2024-10-15');
      }
    } else if (bill.readingDate) {
      dueDateObj = new Date(bill.readingDate);
      if (!isNaN(dueDateObj.getTime())) {
        dueDateObj.setDate(dueDateObj.getDate() + 15);
      } else {
        dueDateObj = new Date('2024-10-15');
      }
    } else {
      dueDateObj = new Date('2024-10-15');
    }

    const dueTime = dueDateObj.getTime();
    if (dueTime < oldestTime) {
      oldestTime = dueTime;
      oldestDueDate = dueDateObj.toISOString().split('T')[0];
    }

    const diffDays = Math.max(0, Math.floor((now - dueTime) / (1000 * 60 * 60 * 24)));
    if (diffDays > maxDaysOverdue) {
      maxDaysOverdue = diffDays;
    }

    const gross = bill.totalAmount || bill.billAmount || 0;
    const paid = bill.paidAmount || 0;
    totalOverdueAmount += Math.max(0, gross - paid);
  });

  const unpaidCycles = unpaidBills.length;
  // 3 months grace period check: >= 90 days overdue OR >= 3 unpaid cycles OR explicit notice issued
  const isExceeded = maxDaysOverdue >= 90 || unpaidCycles >= 3 || unpaidBills.some(r => r.isDisconnectionNoticeIssued === true);

  return {
    isExceeded,
    maxDaysOverdue,
    unpaidCycles,
    totalOverdueAmount,
    oldestDueDate,
    unpaidBills
  };
}

// Background scanner internal state
let scannerIntervalId: any = null;
let totalScanCycles = 0;
let lastScanTimestamp: string | null = null;
let lastScanSummary: ScanSummary | null = null;
const statusListeners = new Set<(status: ScannerStatus) => void>();

function notifyListeners() {
  const currentStatus: ScannerStatus = {
    isRunning: Boolean(scannerIntervalId),
    intervalMs: 60000,
    lastScanTimestamp,
    lastScanSummary,
    totalScanCycles
  };
  statusListeners.forEach(listener => {
    try {
      listener(currentStatus);
    } catch (e) {
      console.error('[GracePeriodScanner] Listener error:', e);
    }
  });
}

/**
 * Scans all consumer accounts and automatically updates delinquent accounts exceeding 
 * the 3-month grace period to 'Disconnection Notice' status.
 */
export function scanAndUpdateAccounts(): ScanSummary {
  const consumers = mockDb.getConsumers();
  const readings = mockDb.getReadings();
  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let hasConsumerChanges = false;
  let hasReadingChanges = false;
  const items: AccountScanItem[] = [];
  let updatedToDisconnectionCount = 0;
  let restoredToActiveCount = 0;

  const updatedConsumers = consumers.map(consumer => {
    // Skip accounts that are pending ID issuance or already blocked/archived manually
    if (!consumer.accountNumber || consumer.accountNumber.toUpperCase().startsWith('PENDING') || consumer.status === 'pending_approval') {
      items.push({
        accountNumber: consumer.accountNumber || 'PENDING',
        name: consumer.name,
        barangay: consumer.barangay,
        previousStatus: consumer.status,
        newStatus: consumer.status,
        maxDaysOverdue: 0,
        unpaidCycles: 0,
        totalOverdueAmount: 0,
        actionTaken: 'skipped',
        reason: 'Pending ID issuance'
      });
      return consumer;
    }

    if (consumer.status === 'archived' || consumer.status === 'blocked') {
      items.push({
        accountNumber: consumer.accountNumber,
        name: consumer.name,
        barangay: consumer.barangay,
        previousStatus: consumer.status,
        newStatus: consumer.status,
        maxDaysOverdue: 0,
        unpaidCycles: 0,
        totalOverdueAmount: 0,
        actionTaken: 'skipped',
        reason: `Account is manually ${consumer.status}`
      });
      return consumer;
    }

    const evalResult = evaluateAccountGracePeriod(consumer, readings);
    const prevStatus = consumer.status;

    if (evalResult.isExceeded) {
      if (prevStatus !== 'Disconnection Notice') {
        // AUTOMATICALLY UPDATE STATUS TO 'Disconnection Notice'
        hasConsumerChanges = true;
        updatedToDisconnectionCount++;

        // Flag unpaid readings as notice issued
        evalResult.unpaidBills.forEach(b => {
          if (!b.isDisconnectionNoticeIssued) {
            b.isDisconnectionNoticeIssued = true;
            b.disconnectionDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            hasReadingChanges = true;
          }
        });

        // Issue automated consumer notification
        const existingNotifs = mockDb.getNotifications(consumer.accountNumber);
        const hasNoticeNotif = existingNotifs.some(n => 
          n.type === 'disconnection' || (n.title || '').includes('Disconnection Notice')
        );

        if (!hasNoticeNotif) {
          mockDb.addNotification({
            accountNumber: consumer.accountNumber,
            title: 'CRITICAL: Water Service Disconnection Notice Issued',
            message: `Official Notice from Tagoloan Water District: Account #${consumer.accountNumber} has exceeded the 3-month payment grace period (${evalResult.maxDaysOverdue} days overdue, ${evalResult.unpaidCycles} unpaid statements, ₱${evalResult.totalOverdueAmount.toFixed(2)} arrears). A physical curb-stop disconnection order is scheduled within 5 working days unless settled.`,
            type: 'disconnection',
            billingPeriod: evalResult.unpaidBills[0]?.billingPeriod || 'Delinquent Arrears',
            remainingBalance: evalResult.totalOverdueAmount
          });
        }

        // Add official system audit log entry
        mockDb.addAuditLog(
          'system-background-service',
          'Automated Grace Period Scanner',
          'system',
          'AUTOMATED_DISCONNECTION_NOTICE_ISSUED',
          `Background Service: Automatically updated account #${consumer.accountNumber} (${consumer.name}) to 'Disconnection Notice' status. Exceeded 3-month payment grace period with ${evalResult.maxDaysOverdue} days overdue (${evalResult.unpaidCycles} cycles, ₱${evalResult.totalOverdueAmount.toFixed(2)} arrears).`
        );

        items.push({
          accountNumber: consumer.accountNumber,
          name: consumer.name,
          barangay: consumer.barangay,
          previousStatus: prevStatus,
          newStatus: 'Disconnection Notice',
          maxDaysOverdue: evalResult.maxDaysOverdue,
          unpaidCycles: evalResult.unpaidCycles,
          totalOverdueAmount: evalResult.totalOverdueAmount,
          actionTaken: 'updated_to_disconnection',
          reason: `Exceeded 3-month grace period (${evalResult.maxDaysOverdue}d overdue, ${evalResult.unpaidCycles} cycles)`
        });

        return {
          ...consumer,
          status: 'Disconnection Notice' as const,
          disconnectionNoticeDate: new Date().toISOString(),
          gracePeriodOverdueDays: evalResult.maxDaysOverdue,
          unpaidCyclesCount: evalResult.unpaidCycles,
          blockReason: `Exceeded 3-month payment grace period (${evalResult.maxDaysOverdue} days overdue, ${evalResult.unpaidCycles} unpaid cycles). Disconnection Notice issued.`
        };
      } else {
        // Retained in Disconnection Notice
        items.push({
          accountNumber: consumer.accountNumber,
          name: consumer.name,
          barangay: consumer.barangay,
          previousStatus: prevStatus,
          newStatus: 'Disconnection Notice',
          maxDaysOverdue: evalResult.maxDaysOverdue,
          unpaidCycles: evalResult.unpaidCycles,
          totalOverdueAmount: evalResult.totalOverdueAmount,
          actionTaken: 'retained_disconnection',
          reason: `Still exceeds 3-month grace period (${evalResult.maxDaysOverdue}d overdue)`
        });

        return {
          ...consumer,
          status: 'Disconnection Notice' as const,
          gracePeriodOverdueDays: evalResult.maxDaysOverdue,
          unpaidCyclesCount: evalResult.unpaidCycles
        };
      }
    } else {
      // Account is within grace period
      if (prevStatus === 'Disconnection Notice') {
        // Arrears settled! Restore account to 'active'
        hasConsumerChanges = true;
        restoredToActiveCount++;

        mockDb.addAuditLog(
          'system-background-service',
          'Automated Grace Period Scanner',
          'system',
          'DISCONNECTION_NOTICE_RESOLVED',
          `Background Service: Account #${consumer.accountNumber} (${consumer.name}) resolved delinquent arrears and was automatically restored from Disconnection Notice to Active status.`
        );

        items.push({
          accountNumber: consumer.accountNumber,
          name: consumer.name,
          barangay: consumer.barangay,
          previousStatus: prevStatus,
          newStatus: 'active',
          maxDaysOverdue: evalResult.maxDaysOverdue,
          unpaidCycles: evalResult.unpaidCycles,
          totalOverdueAmount: evalResult.totalOverdueAmount,
          actionTaken: 'restored_to_active',
          reason: 'Arrears settled, account restored within grace period'
        });

        return {
          ...consumer,
          status: 'active' as const,
          blockReason: undefined,
          disconnectionNoticeDate: undefined,
          gracePeriodOverdueDays: 0,
          unpaidCyclesCount: 0
        };
      }

      items.push({
        accountNumber: consumer.accountNumber,
        name: consumer.name,
        barangay: consumer.barangay,
        previousStatus: prevStatus,
        newStatus: prevStatus,
        maxDaysOverdue: evalResult.maxDaysOverdue,
        unpaidCycles: evalResult.unpaidCycles,
        totalOverdueAmount: evalResult.totalOverdueAmount,
        actionTaken: 'retained_active',
        reason: 'Within standard payment terms'
      });

      return consumer;
    }
  });

  // Save changes if any status or readings changed
  if (hasConsumerChanges) {
    mockDb.saveConsumers(updatedConsumers);
  }
  if (hasReadingChanges) {
    mockDb.saveReadings(readings);
  }

  // Trigger UI database update event if any modifications occurred
  if (hasConsumerChanges || hasReadingChanges) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('twd_database_updated', {
        detail: { key: 'grace_period_scan', timestamp: Date.now() }
      }));
    }
  }

  const activeDisconnectionCount = updatedConsumers.filter(c => c.status === 'Disconnection Notice').length;

  const summary: ScanSummary = {
    timestamp,
    scannedCount: consumers.length,
    updatedToDisconnectionCount,
    restoredToActiveCount,
    activeDisconnectionCount,
    items
  };

  lastScanTimestamp = timestamp;
  lastScanSummary = summary;
  totalScanCycles++;

  notifyListeners();
  return summary;
}

/**
 * Starts the continuous background scanning service (defaults to 60 second intervals)
 */
export function startGracePeriodScanner(intervalMs = 60000): void {
  if (scannerIntervalId) {
    return; // Already running
  }

  // Run initial scan immediately on service startup
  try {
    scanAndUpdateAccounts();
  } catch (err) {
    console.error('[GracePeriodScanner] Initial scan error:', err);
  }

  // Set periodic background interval
  scannerIntervalId = setInterval(() => {
    try {
      scanAndUpdateAccounts();
    } catch (err) {
      console.error('[GracePeriodScanner] Background interval scan error:', err);
    }
  }, intervalMs);

  notifyListeners();
}

/**
 * Stops the continuous background scanning service
 */
export function stopGracePeriodScanner(): void {
  if (scannerIntervalId) {
    clearInterval(scannerIntervalId);
    scannerIntervalId = null;
    notifyListeners();
  }
}

/**
 * Retrieves the current status of the background scanning service
 */
export function getScannerStatus(): ScannerStatus {
  return {
    isRunning: Boolean(scannerIntervalId),
    intervalMs: 60000,
    lastScanTimestamp,
    lastScanSummary,
    totalScanCycles
  };
}

/**
 * Subscribes a React component or listener to background scanner updates
 */
export function subscribeToScanner(listener: (status: ScannerStatus) => void): () => void {
  statusListeners.add(listener);
  // Send current status immediately
  listener(getScannerStatus());
  return () => {
    statusListeners.delete(listener);
  };
}

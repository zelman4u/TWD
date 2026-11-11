/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { mockDb } from '../mockDb';
import { apiClient } from './apiClient';
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
 * Evaluates whether a consumer account has exceeded the 2-month (60 days) payment grace period.
 * 
 * Criteria (Standard Tagoloan Water District Policy):
 * 1. An unpaid verified bill has exceeded 60 days past its due date (2 months grace period)
 * 2. Or 2 or more consecutive monthly billing cycles remain unpaid with outstanding balance
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

  // Check if consumer has an active partial payment on any bill
  const hasPartialPayment = unpaidBills.some(b => b.paymentStatus === 'partial' || (b.paidAmount && b.paidAmount > 0));
  if (hasPartialPayment) {
    unpaidBills.forEach(b => {
      b.isDisconnectionNoticeIssued = false;
    });
  }

  // Count only completely unpaid cycles without partial payments for strict disconnection threshold
  const fullyUnpaidBills = unpaidBills.filter(b => b.paymentStatus !== 'partial' && (!b.paidAmount || b.paidAmount <= 0));
  const unpaidCycles = fullyUnpaidBills.length;

  // 2 months grace period check: >= 60 days overdue OR >= 2 fully unpaid cycles OR explicit notice issued
  // When a consumer makes a partial payment, the disconnection order is suspended (halted) while maintaining the remaining balance!
  const isExceeded = !hasPartialPayment && (maxDaysOverdue >= 60 || unpaidCycles >= 2 || unpaidBills.some(r => r.isDisconnectionNoticeIssued === true));

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

    // Check if account is already disconnected (check 6 months inactivity for Account Assumption)
    if (consumer.status === 'disconnected') {
      const discDate = consumer.disconnectedAt ? new Date(consumer.disconnectedAt) : new Date(Date.now() - 181 * 86400000);
      const daysDisconnected = Math.max(0, Math.floor((Date.now() - discDate.getTime()) / (1000 * 60 * 60 * 24)));
      const isAvailableForAssumption = daysDisconnected >= 180 || Boolean(consumer.isAvailableForAssumption);
      
      if (isAvailableForAssumption && !consumer.isAvailableForAssumption) {
        hasConsumerChanges = true;
      }

      items.push({
        accountNumber: consumer.accountNumber,
        name: consumer.name,
        barangay: consumer.barangay,
        previousStatus: 'disconnected',
        newStatus: 'disconnected',
        maxDaysOverdue: evalResult.maxDaysOverdue,
        unpaidCycles: evalResult.unpaidCycles,
        totalOverdueAmount: evalResult.totalOverdueAmount,
        actionTaken: 'skipped',
        reason: isAvailableForAssumption 
          ? `Disconnected for ${daysDisconnected} days — Available for Assumption (Account Transfer)`
          : `Disconnected for ${daysDisconnected} days (Inactive line)`
      });

      return {
        ...consumer,
        isDisconnected: true,
        isAvailableForAssumption: Boolean(isAvailableForAssumption),
        assumptionEligibleDate: consumer.assumptionEligibleDate || (isAvailableForAssumption ? new Date().toISOString() : undefined),
        gracePeriodOverdueDays: evalResult.maxDaysOverdue,
        unpaidCyclesCount: evalResult.unpaidCycles
      };
    }

    if (evalResult.isExceeded) {
      const nowMs = Date.now();
      const hasExtension = Boolean(consumer.extensionGrantedUntil);
      const extDateMs = consumer.extensionGrantedUntil ? new Date(consumer.extensionGrantedUntil).getTime() : 0;
      const isExtensionActive = hasExtension && extDateMs > nowMs;
      const isExtensionExpired = hasExtension && extDateMs <= nowMs;

      // If consumer had an extension and STILL did not pay after extension expired -> DISCONNECT
      if (isExtensionExpired) {
        hasConsumerChanges = true;
        const discDate = new Date().toISOString();
        
        mockDb.addAuditLog(
          'system-background-service',
          'Automated Grace Period Scanner',
          'system',
          'ACCOUNT_DISCONNECTED_EXTENSION_EXPIRED',
          `Background Service: Account #${consumer.accountNumber} (${consumer.name}) failed to settle arrears after extension expired (${consumer.extensionGrantedUntil}). Status updated to Disconnected.`
        );

        items.push({
          accountNumber: consumer.accountNumber,
          name: consumer.name,
          barangay: consumer.barangay,
          previousStatus: prevStatus,
          newStatus: 'disconnected',
          maxDaysOverdue: evalResult.maxDaysOverdue,
          unpaidCycles: evalResult.unpaidCycles,
          totalOverdueAmount: evalResult.totalOverdueAmount,
          actionTaken: 'updated_to_disconnection',
          reason: `Extension expired on ${consumer.extensionGrantedUntil} without payment — Line Disconnected`
        });

        return {
          ...consumer,
          status: 'disconnected' as const,
          isDisconnected: true,
          disconnectedAt: discDate,
          extensionStatus: 'expired' as const,
          gracePeriodOverdueDays: evalResult.maxDaysOverdue,
          unpaidCyclesCount: evalResult.unpaidCycles,
          blockReason: `Water service disconnected on ${new Date().toLocaleDateString('en-US')}. Extension expired without full settlement.`
        };
      }

      if (isExtensionActive) {
        // Retained under active extension protection
        items.push({
          accountNumber: consumer.accountNumber,
          name: consumer.name,
          barangay: consumer.barangay,
          previousStatus: prevStatus,
          newStatus: prevStatus,
          maxDaysOverdue: evalResult.maxDaysOverdue,
          unpaidCycles: evalResult.unpaidCycles,
          totalOverdueAmount: evalResult.totalOverdueAmount,
          actionTaken: 'retained_disconnection',
          reason: `Extension active until ${consumer.extensionGrantedUntil} (${consumer.extensionDays || 'N/A'} days granted)`
        });

        return consumer;
      }

      if (prevStatus !== 'Disconnection Notice') {
        // AUTOMATICALLY UPDATE STATUS TO 'Disconnection Notice' (2 months unpaid)
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
            consumerId: consumer.id,
            userId: consumer.linkedUserId,
            consumerEmail: consumer.email,
            title: 'CRITICAL: Water Service Disconnection Notice Issued (2 Months Overdue)',
            message: `Official Notice from Tagoloan Water District: Account #${consumer.accountNumber} has exceeded the 2-month payment grace period (${evalResult.maxDaysOverdue} days overdue, ${evalResult.unpaidCycles} unpaid statements, ₱${evalResult.totalOverdueAmount.toFixed(2)} arrears). A physical curb-stop disconnection order is scheduled within 5 working days unless settled or extension requested.`,
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
          `Background Service: Automatically updated account #${consumer.accountNumber} (${consumer.name}) to 'Disconnection Notice' status. Exceeded 2-month payment grace period with ${evalResult.maxDaysOverdue} days overdue (${evalResult.unpaidCycles} cycles, ₱${evalResult.totalOverdueAmount.toFixed(2)} arrears).`
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
          reason: `Exceeded 2-month grace period (${evalResult.maxDaysOverdue}d overdue, ${evalResult.unpaidCycles} cycles)`
        });

        return {
          ...consumer,
          status: 'Disconnection Notice' as const,
          disconnectionNoticeDate: new Date().toISOString(),
          gracePeriodOverdueDays: evalResult.maxDaysOverdue,
          unpaidCyclesCount: evalResult.unpaidCycles,
          blockReason: `Exceeded 2-month payment grace period (${evalResult.maxDaysOverdue} days overdue, ${evalResult.unpaidCycles} unpaid cycles). Disconnection Notice issued.`
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
          reason: `Still exceeds 2-month grace period (${evalResult.maxDaysOverdue}d overdue)`
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
    apiClient.reconcileConsumers(updatedConsumers).catch(() => {});
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

let initialScanTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts the continuous background scanning service (defaults to 60 second intervals)
 */
export function startGracePeriodScanner(intervalMs = 60000): void {
  if (scannerIntervalId) {
    return; // Already running
  }

  // Defer initial scan off critical startup tick to prevent main-thread timer violations
  if (initialScanTimeoutId) clearTimeout(initialScanTimeoutId);
  initialScanTimeoutId = setTimeout(() => {
    initialScanTimeoutId = null;
    try {
      scanAndUpdateAccounts();
    } catch (err) {
      console.error('[GracePeriodScanner] Initial scan error:', err);
    }
  }, 1500);

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
  if (initialScanTimeoutId) {
    clearTimeout(initialScanTimeoutId);
    initialScanTimeoutId = null;
  }
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

/**
 * Admin grants an extension for an account under Disconnection Notice
 */
export function grantAccountExtension(
  accountNumber: string,
  extensionDays: number,
  extensionReason: string,
  adminName: string
): { success: boolean; message: string; updatedConsumer?: Consumer } {
  const consumers = mockDb.getConsumers();
  const index = consumers.findIndex(c => c.accountNumber === accountNumber);
  if (index === -1) {
    return { success: false, message: `Account #${accountNumber} not found.` };
  }
  const consumer = consumers[index];
  const extensionDate = new Date(Date.now() + extensionDays * 24 * 60 * 60 * 1000);
  const extensionDateStr = extensionDate.toISOString().split('T')[0];

  const updated: Consumer = {
    ...consumer,
    extensionDays,
    extensionReason,
    extensionGrantedUntil: extensionDateStr,
    extensionStatus: 'approved',
    disconnectionCutoffDate: extensionDateStr,
    blockReason: `Extension granted for ${extensionDays} days until ${extensionDateStr}. Reason: ${extensionReason}`
  };

  consumers[index] = updated;
  mockDb.saveConsumers(consumers);
  apiClient.reconcileConsumers(consumers).catch(() => {});

  mockDb.addNotification({
    accountNumber: consumer.accountNumber,
    consumerId: consumer.id,
    userId: consumer.linkedUserId,
    consumerEmail: consumer.email,
    title: `Extension Granted: Disconnection Cutoff Extended to ${extensionDateStr}`,
    message: `Your request for a ${extensionDays}-day extension on Account #${consumer.accountNumber} has been approved by Tagoloan Water District Administration. Your disconnection deadline is now deferred until ${extensionDateStr}. Please ensure payment is remitted on or before this date to prevent service disruption.`,
    type: 'disconnection',
    remainingBalance: consumer.outstandingBalance
  });

  mockDb.addAuditLog(
    'admin-operations',
    adminName,
    'admin',
    'DISCONNECTION_EXTENSION_GRANTED',
    `Granted ${extensionDays}-day extension for Account #${accountNumber} (${consumer.name}) until ${extensionDateStr}. Reason: ${extensionReason}`
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('twd_database_updated', {
      detail: { key: 'extension_granted', accountNumber, timestamp: Date.now() }
    }));
  }

  return {
    success: true,
    message: `Extension of ${extensionDays} days granted until ${extensionDateStr}.`,
    updatedConsumer: updated
  };
}

/**
 * Consumer submits an extension request
 */
export function requestAccountExtension(
  accountNumber: string,
  extensionDays: number,
  extensionReason: string
): { success: boolean; message: string; updatedConsumer?: Consumer } {
  const consumers = mockDb.getConsumers();
  const index = consumers.findIndex(c => c.accountNumber === accountNumber);
  if (index === -1) {
    return { success: false, message: `Account #${accountNumber} not found.` };
  }
  const consumer = consumers[index];
  const proposedDate = new Date(Date.now() + extensionDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const updated: Consumer = {
    ...consumer,
    extensionDays,
    extensionReason,
    extensionRequestedAt: new Date().toISOString(),
    extensionStatus: 'pending',
    extensionGrantedUntil: proposedDate
  };

  consumers[index] = updated;
  mockDb.saveConsumers(consumers);
  apiClient.reconcileConsumers(consumers).catch(() => {});

  mockDb.addAuditLog(
    'consumer-portal',
    consumer.name,
    'consumer',
    'DISCONNECTION_EXTENSION_REQUESTED',
    `Consumer requested ${extensionDays}-day extension for Account #${accountNumber}. Reason: ${extensionReason}`
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('twd_database_updated', {
      detail: { key: 'extension_requested', accountNumber, timestamp: Date.now() }
    }));
  }

  return {
    success: true,
    message: `Extension request submitted successfully for ${extensionDays} days until ${proposedDate}.`,
    updatedConsumer: updated
  };
}

/**
 * Physically disconnect an account (service suspended; account accessible in inactive state, ledger remains accountable)
 */
export function disconnectAccount(
  accountNumber: string,
  adminName: string,
  reason: string = 'Non-payment of delinquent water bill'
): { success: boolean; message: string; updatedConsumer?: Consumer } {
  const consumers = mockDb.getConsumers();
  const index = consumers.findIndex(c => c.accountNumber === accountNumber);
  if (index === -1) {
    return { success: false, message: `Account #${accountNumber} not found.` };
  }
  const consumer = consumers[index];
  const now = new Date().toISOString();

  const updated: Consumer = {
    ...consumer,
    status: 'disconnected',
    isDisconnected: true,
    disconnectedAt: now,
    extensionStatus: 'expired',
    blockReason: `Water service physically disconnected on ${new Date().toLocaleDateString('en-US')}. ${reason}`
  };

  consumers[index] = updated;
  mockDb.saveConsumers(consumers);
  apiClient.reconcileConsumers(consumers).catch(() => {});

  // Update water meter status to inactive
  const meters = mockDb.getMeters().map(m => {
    if (m.linkedAccountNumber === accountNumber || m.meterNumber === consumer.meterNumber) {
      return {
        ...m,
        status: 'inactive' as const,
        remarks: `Disconnected due to unpaid balance on ${new Date().toLocaleDateString('en-US')}`
      };
    }
    return m;
  });
  mockDb.saveMeters(meters);

  mockDb.addNotification({
    accountNumber: consumer.accountNumber,
    consumerId: consumer.id,
    userId: consumer.linkedUserId,
    consumerEmail: consumer.email,
    title: 'NOTICE: Water Service Connection Disconnected',
    message: `Official Notice: Water service connection for Account #${consumer.accountNumber} has been disconnected. All past billing statements and payments remain accountable to your account. To restore service, visit the Tagoloan Water District cashier to settle your balance and request reconnection.`,
    type: 'disconnection',
    remainingBalance: consumer.outstandingBalance
  });

  mockDb.addAuditLog(
    'admin-operations',
    adminName,
    'admin',
    'ACCOUNT_DISCONNECTED',
    `Physically disconnected Account #${accountNumber} (${consumer.name}). Reason: ${reason}. Ledger remains accountable.`
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('twd_database_updated', {
      detail: { key: 'account_disconnected', accountNumber, timestamp: Date.now() }
    }));
  }

  return {
    success: true,
    message: `Account #${accountNumber} successfully set to Disconnected. Meter marked inactive.`,
    updatedConsumer: updated
  };
}

/**
 * Reconnect a disconnected account once settled
 */
export function reconnectAccount(
  accountNumber: string,
  adminName: string
): { success: boolean; message: string; updatedConsumer?: Consumer } {
  const consumers = mockDb.getConsumers();
  const index = consumers.findIndex(c => c.accountNumber === accountNumber);
  if (index === -1) {
    return { success: false, message: `Account #${accountNumber} not found.` };
  }
  const consumer = consumers[index];

  const updated: Consumer = {
    ...consumer,
    status: 'active',
    isDisconnected: false,
    disconnectedAt: undefined,
    blockReason: undefined,
    disconnectionNoticeDate: undefined,
    extensionGrantedUntil: undefined
  };

  consumers[index] = updated;
  mockDb.saveConsumers(consumers);
  apiClient.reconcileConsumers(consumers).catch(() => {});

  // Update water meter status to active
  const meters = mockDb.getMeters().map(m => {
    if (m.linkedAccountNumber === accountNumber || m.meterNumber === consumer.meterNumber) {
      return {
        ...m,
        status: 'active' as const,
        remarks: `Reconnected on ${new Date().toLocaleDateString('en-US')}`
      };
    }
    return m;
  });
  mockDb.saveMeters(meters);

  mockDb.addAuditLog(
    'admin-operations',
    adminName,
    'admin',
    'ACCOUNT_RECONNECTED',
    `Reconnected water service for Account #${accountNumber} (${consumer.name}). Status restored to Active.`
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('twd_database_updated', {
      detail: { key: 'account_reconnected', accountNumber, timestamp: Date.now() }
    }));
  }

  return {
    success: true,
    message: `Account #${accountNumber} successfully reconnected to Active.`,
    updatedConsumer: updated
  };
}

/**
 * Allows a new applicant to assume an account that has been inactive/disconnected for 6+ months.
 * Changes consumer name, contact, and account details while preserving historical billing & payment accountability.
 */
export function assumeAccount(
  targetAccountNumber: string,
  newOwnerData: {
    name: string;
    contactNumber: string;
    email: string;
    address?: string;
    sitioZone?: string;
    newAccountNumber?: string;
    consumerType?: 'Residential' | 'Commercial';
  },
  adminName: string
): { success: boolean; message: string; updatedConsumer?: Consumer } {
  const consumers = mockDb.getConsumers();
  const index = consumers.findIndex(c => c.accountNumber === targetAccountNumber);
  if (index === -1) {
    return { success: false, message: `Account #${targetAccountNumber} not found.` };
  }
  const original = consumers[index];
  const oldOwnerName = original.name;
  const targetAcc = newOwnerData.newAccountNumber?.trim() || original.accountNumber;
  const now = new Date().toISOString();

  const updated: Consumer = {
    ...original,
    accountNumber: targetAcc,
    name: newOwnerData.name.trim(),
    contactNumber: newOwnerData.contactNumber.trim(),
    email: newOwnerData.email.trim(),
    address: newOwnerData.address?.trim() || original.address,
    sitioZone: newOwnerData.sitioZone?.trim() || original.sitioZone,
    consumerType: newOwnerData.consumerType || original.consumerType,
    status: 'active',
    isDisconnected: false,
    disconnectedAt: undefined,
    isAvailableForAssumption: false,
    previousAccountOwnerName: oldOwnerName,
    assumedByConsumerName: newOwnerData.name.trim(),
    assumedAt: now,
    blockReason: undefined,
    disconnectionNoticeDate: undefined,
    extensionGrantedUntil: undefined,
    assumptionNotes: `Account assumed by ${newOwnerData.name.trim()} from ${oldOwnerName} approved by ${adminName} on ${new Date().toLocaleDateString('en-US')}. Previous bills remain accounted in historical records.`
  };

  consumers[index] = updated;
  mockDb.saveConsumers(consumers);
  apiClient.reconcileConsumers(consumers).catch(() => {});

  // If account number changed, update linked readings' accountNumber mapping
  if (targetAcc !== original.accountNumber) {
    const readings = mockDb.getReadings().map(r => {
      if (r.accountNumber === original.accountNumber) {
        return {
          ...r,
          accountNumber: targetAcc,
          notes: (r.notes ? `${r.notes} • ` : '') + `Transferred from Acc #${original.accountNumber} (Prev: ${oldOwnerName})`
        };
      }
      return r;
    });
    mockDb.saveReadings(readings);
  }

  // Update meter linked account
  const meters = mockDb.getMeters().map(m => {
    if (m.linkedAccountNumber === original.accountNumber || m.meterNumber === original.meterNumber) {
      return {
        ...m,
        linkedAccountNumber: targetAcc,
        status: 'active' as const,
        remarks: `Assumed by ${newOwnerData.name.trim()} on ${new Date().toLocaleDateString('en-US')}`
      };
    }
    return m;
  });
  mockDb.saveMeters(meters);

  mockDb.addAuditLog(
    'admin-operations',
    adminName,
    'admin',
    'ACCOUNT_ASSUMPTION_APPROVED',
    `Account #${original.accountNumber} (6-month inactive line) assumed by ${newOwnerData.name.trim()}. Previous registered owner: ${oldOwnerName}. Updated account #${targetAcc}. Historical payments remain accountable.`
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('twd_database_updated', {
      detail: { key: 'account_assumed', accountNumber: targetAcc, timestamp: Date.now() }
    }));
  }

  return {
    success: true,
    message: `Account successfully assumed by ${newOwnerData.name}. Service restored to Active with updated account details.`,
    updatedConsumer: updated
  };
}

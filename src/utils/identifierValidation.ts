/**
 * Identifier Validation Utilities for Consumers Module
 * Strictly prohibits duplicate Account Numbers and Tag Numbers (RFID and Meter Serial Tags).
 */
import { mockDb } from '../mockDb';
import { Consumer } from '../types';

export interface DuplicateIdentifierResult {
  isDuplicate: boolean;
  field: 'accountNumber' | 'rfidTag' | 'meterNumber';
  value: string;
  assignedToName?: string;
  assignedToAccount?: string;
  message: string;
}

/**
 * Checks whether an Account Number is already assigned to another consumer.
 * Strictly prohibits duplicates in Tagoloan Water District.
 */
export function checkDuplicateAccountNumber(
  accountNumber: string,
  currentConsumer?: Consumer | null
): DuplicateIdentifierResult | null {
  const cleanAcc = (accountNumber || '').trim().toUpperCase();
  if (!cleanAcc || cleanAcc.startsWith('PENDING') || cleanAcc === 'PENDING ADMIN ISSUANCE') {
    return null;
  }

  const allConsumers = mockDb.getConsumers();
  for (const c of allConsumers) {
    // Skip if it represents the exact same consumer being edited
    if (currentConsumer) {
      if (currentConsumer === c) continue;
      if (currentConsumer.accountNumber && c.accountNumber && currentConsumer.accountNumber === c.accountNumber) continue;
      if (currentConsumer.linkedUserId && c.linkedUserId && currentConsumer.linkedUserId === c.linkedUserId) continue;
      if (currentConsumer.email && c.email && currentConsumer.email.toLowerCase() === c.email.toLowerCase()) continue;
    }

    const otherAcc = (c.accountNumber || '').trim().toUpperCase();
    if (otherAcc && !otherAcc.startsWith('PENDING') && otherAcc === cleanAcc) {
      return {
        isDuplicate: true,
        field: 'accountNumber',
        value: cleanAcc,
        assignedToName: c.name || 'Another Consumer',
        assignedToAccount: c.accountNumber,
        message: `Account Number #${cleanAcc} is already assigned to "${c.name || 'Another Consumer'}". Duplicate account numbers are strictly prohibited.`
      };
    }
  }

  return null;
}

/**
 * Checks whether an RFID Tag Number is already assigned to another consumer.
 * Strictly prohibits duplicate tag numbers.
 */
export function checkDuplicateRfidTag(
  rfidTag: string,
  currentConsumer?: Consumer | null
): DuplicateIdentifierResult | null {
  const cleanTag = (rfidTag || '').trim().toUpperCase();
  if (!cleanTag || cleanTag.startsWith('PENDING')) {
    return null;
  }

  const allConsumers = mockDb.getConsumers();
  for (const c of allConsumers) {
    if (currentConsumer) {
      if (currentConsumer === c) continue;
      if (currentConsumer.accountNumber && c.accountNumber && currentConsumer.accountNumber === c.accountNumber) continue;
      if (currentConsumer.linkedUserId && c.linkedUserId && currentConsumer.linkedUserId === c.linkedUserId) continue;
      if (currentConsumer.email && c.email && currentConsumer.email.toLowerCase() === c.email.toLowerCase()) continue;
    }

    const otherTag = (c.rfidTag || '').trim().toUpperCase();
    if (otherTag && otherTag === cleanTag) {
      return {
        isDuplicate: true,
        field: 'rfidTag',
        value: cleanTag,
        assignedToName: c.name || 'Another Consumer',
        assignedToAccount: c.accountNumber,
        message: `RFID Tag "${cleanTag}" is already assigned to "${c.name || 'Another Consumer'}" (Account #${c.accountNumber || 'Pending'}). Duplicate tag numbers are strictly prohibited.`
      };
    }
  }

  return null;
}

/**
 * Checks whether a physical Meter Serial / Tag Number is already registered
 * to another consumer or assigned in the water meters registry.
 */
export function checkDuplicateMeterTag(
  meterNumber: string,
  currentConsumer?: Consumer | null
): DuplicateIdentifierResult | null {
  const cleanMeter = (meterNumber || '').trim().toUpperCase();
  if (!cleanMeter || cleanMeter.startsWith('PENDING')) {
    return null;
  }

  // 1. Check Consumers registry
  const allConsumers = mockDb.getConsumers();
  for (const c of allConsumers) {
    if (currentConsumer) {
      if (currentConsumer === c) continue;
      if (currentConsumer.accountNumber && c.accountNumber && currentConsumer.accountNumber === c.accountNumber) continue;
      if (currentConsumer.linkedUserId && c.linkedUserId && currentConsumer.linkedUserId === c.linkedUserId) continue;
      if (currentConsumer.email && c.email && currentConsumer.email.toLowerCase() === c.email.toLowerCase()) continue;
    }

    const otherMeter = (c.meterNumber || '').trim().toUpperCase();
    if (otherMeter && otherMeter === cleanMeter) {
      return {
        isDuplicate: true,
        field: 'meterNumber',
        value: cleanMeter,
        assignedToName: c.name || 'Another Consumer',
        assignedToAccount: c.accountNumber,
        message: `Meter Tag #${cleanMeter} is already registered to "${c.name || 'Another Consumer'}" (Account #${c.accountNumber || 'Pending'}). Duplicate tag numbers are strictly prohibited.`
      };
    }
  }

  // 2. Check Physical Water Meters registry
  const allMeters = mockDb.getMeters();
  for (const m of allMeters) {
    const meterNum = (m.meterNumber || '').trim().toUpperCase();
    if (meterNum === cleanMeter && m.linkedAccountNumber && !m.linkedAccountNumber.toUpperCase().startsWith('PENDING')) {
      if (currentConsumer && currentConsumer.accountNumber && currentConsumer.accountNumber.trim().toUpperCase() === m.linkedAccountNumber.trim().toUpperCase()) {
        continue; // Linked to this consumer
      }
      return {
        isDuplicate: true,
        field: 'meterNumber',
        value: cleanMeter,
        assignedToAccount: m.linkedAccountNumber,
        message: `Meter Tag #${cleanMeter} is already linked to Account #${m.linkedAccountNumber} in the physical water meters registry. Duplicate tag numbers are strictly prohibited.`
      };
    }
  }

  return null;
}

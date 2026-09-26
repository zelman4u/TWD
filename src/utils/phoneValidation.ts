/**
 * Phone Number Validation & Detection Utilities
 * Strictly enforces 11-digit mobile numbers (e.g. 09XXXXXXXXX)
 * and detects duplicates across existing Consumer, User, and Meter Reader accounts.
 */
import { mockDb } from '../mockDb';

/**
 * Normalizes any phone string to clean digits.
 * Converts +639171234567 -> 09171234567
 * Converts 9171234567 -> 09171234567
 * Converts 0917-123-4567 -> 09171234567
 */
export function normalizePhoneNumber(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) {
    digits = '0' + digits.slice(2);
  }
  if (digits.length === 10 && digits.startsWith('9')) {
    digits = '0' + digits;
  }
  return digits;
}

/**
 * Validates that phone is strictly 11 digits and starts with '09'
 */
export function isValid11DigitPhone(phone: string | null | undefined): boolean {
  const norm = normalizePhoneNumber(phone);
  return norm.length === 11 && norm.startsWith('09');
}

export interface ExistingPhoneAccountMatch {
  found: boolean;
  type: 'consumer' | 'user' | 'reader';
  name: string;
  accountNumber?: string;
  phone: string;
  email?: string;
  barangay?: string;
}

/**
 * Automatically detects whether an 11-digit mobile number is already connected
 * to an existing account across the system (Consumers, Users, and Meter Readers).
 */
export function detectExistingPhoneAccount(
  rawPhone: string,
  excludeIdentifier?: {
    email?: string;
    linkedUserId?: string;
    accountNumber?: string;
    id?: string;
  }
): ExistingPhoneAccountMatch | null {
  const targetNorm = normalizePhoneNumber(rawPhone);
  if (!targetNorm || targetNorm.length < 11) {
    return null;
  }

  // 1. Check Consumers registry
  const consumers = mockDb.getConsumers();
  for (const c of consumers) {
    // Skip if it's the same consumer being excluded
    if (excludeIdentifier) {
      if (excludeIdentifier.accountNumber && c.accountNumber && c.accountNumber === excludeIdentifier.accountNumber) continue;
      if (excludeIdentifier.linkedUserId && c.linkedUserId && c.linkedUserId === excludeIdentifier.linkedUserId) continue;
      if (excludeIdentifier.email && c.email && c.email.toLowerCase() === excludeIdentifier.email.toLowerCase()) continue;
    }

    const cNorm = normalizePhoneNumber(c.contactNumber);
    if (cNorm && cNorm === targetNorm) {
      return {
        found: true,
        type: 'consumer',
        name: c.name || 'Registered Consumer',
        accountNumber: c.accountNumber || undefined,
        phone: cNorm,
        email: c.email,
        barangay: c.barangay
      };
    }
  }

  // 2. Check Users registry
  const users = mockDb.getUsers();
  for (const u of users) {
    if (excludeIdentifier) {
      if (excludeIdentifier.id && u.id === excludeIdentifier.id) continue;
      if (excludeIdentifier.email && u.email && u.email.toLowerCase() === excludeIdentifier.email.toLowerCase()) continue;
    }

    const uPhone = (u as any).contactNumber || (u as any).phone || '';
    const uNorm = normalizePhoneNumber(uPhone);
    if (uNorm && uNorm === targetNorm) {
      return {
        found: true,
        type: 'user',
        name: u.name || 'System User',
        accountNumber: u.linkedAccountNumber || undefined,
        phone: uNorm,
        email: u.email
      };
    }
  }

  // 3. Check Meter Readers registry
  const readers = mockDb.getReaders();
  for (const r of readers) {
    if (excludeIdentifier) {
      if (excludeIdentifier.id && (r.id === excludeIdentifier.id || r.employeeId === excludeIdentifier.id)) continue;
      if (excludeIdentifier.email && r.email && r.email.toLowerCase() === excludeIdentifier.email.toLowerCase()) continue;
    }

    const rNorm = normalizePhoneNumber(r.contactNumber);
    if (rNorm && rNorm === targetNorm) {
      return {
        found: true,
        type: 'reader',
        name: r.name || 'Meter Reader Staff',
        phone: rNorm,
        email: r.email
      };
    }
  }

  return null;
}

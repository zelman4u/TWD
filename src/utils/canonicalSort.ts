import type { Dispatch, SetStateAction } from 'react';
import type {
  Announcement,
  AuditLog,
  Barangay,
  Consumer,
  ConsumerReport,
  MeterReader,
  MeterReading,
  RouteAssignment,
  User,
  WaterMeter,
  WaterMeterInstallationRequest,
} from '../types';

function safeTime(val?: string | number | null): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const parsed = new Date(val).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPendingAccountIdentifier(acc?: string, status?: string): boolean {
  const cleanAcc = String(acc || '').trim().toUpperCase();
  const cleanStatus = String(status || '').trim().toLowerCase();
  if (
    !cleanAcc ||
    cleanAcc.startsWith('PENDING') ||
    cleanAcc === 'PENDING ADMIN ISSUANCE' ||
    cleanAcc === 'UNASSIGNED' ||
    cleanAcc === 'UNISSUED'
  ) {
    return true;
  }
  return (
    cleanStatus === 'pending' ||
    cleanStatus === 'pending_approval' ||
    cleanStatus === 'pending_installation' ||
    cleanStatus === 'installation_not_scheduled'
  );
}

export function compareReadingsCanonical(a: Partial<MeterReading>, b: Partial<MeterReading>): number {
  return (
    safeTime(b?.readingDate) - safeTime(a?.readingDate) ||
    Number(b?.currentReading ?? b?.presentReading ?? 0) - Number(a?.currentReading ?? a?.presentReading ?? 0) ||
    safeTime(b?.billingIssuedAt || b?.submittedAt) - safeTime(a?.billingIssuedAt || a?.submittedAt) ||
    String(a?.accountNumber || '').localeCompare(String(b?.accountNumber || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) ||
    String(a?.id || '').localeCompare(String(b?.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

export function compareConsumersCanonical(a: Partial<Consumer>, b: Partial<Consumer>): number {
  const aPending = isPendingAccountIdentifier(a?.accountNumber, a?.status);
  const bPending = isPendingAccountIdentifier(b?.accountNumber, b?.status);
  if (aPending !== bPending) return aPending ? -1 : 1;

  const aTime = safeTime(a?.createdAt) || safeTime(a?.registrationDate);
  const bTime = safeTime(b?.createdAt) || safeTime(b?.registrationDate);
  if (bTime !== aTime) return bTime - aTime;

  return (
    String(a?.accountNumber || '').localeCompare(String(b?.accountNumber || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) ||
    String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
      sensitivity: 'base',
    }) ||
    String(a?.email || a?.linkedUserId || '').localeCompare(String(b?.email || b?.linkedUserId || ''), undefined, {
      sensitivity: 'base',
    })
  );
}

export function compareMetersCanonical(a: Partial<WaterMeter>, b: Partial<WaterMeter>): number {
  return (
    String(a?.meterNumber || '').localeCompare(String(b?.meterNumber || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) ||
    String(a?.serialNumber || '').localeCompare(String(b?.serialNumber || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

export function ensureMeterSerialNumber(m: WaterMeter): WaterMeter {
  if (!m.serialNumber && m.meterNumber) {
    const brandPrefix = (m.brand || 'TWD').slice(0, 3).toUpperCase();
    const suffix = String(m.meterNumber).replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase() || '00001';
    return {
      ...m,
      serialNumber: `SN-${brandPrefix}-2024-${suffix}`,
    };
  }
  return m;
}

export function compareReadersCanonical(a: Partial<MeterReader>, b: Partial<MeterReader>): number {
  return (
    String(a?.employeeId || a?.id || '').localeCompare(String(b?.employeeId || b?.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) ||
    String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
      sensitivity: 'base',
    })
  );
}

export function compareUsersCanonical(a: Partial<User>, b: Partial<User>): number {
  return (
    String(a?.id || '').localeCompare(String(b?.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) ||
    String(a?.email || '').localeCompare(String(b?.email || ''), undefined, {
      sensitivity: 'base',
    })
  );
}

export function compareReportsCanonical(a: Partial<ConsumerReport>, b: Partial<ConsumerReport>): number {
  return (
    safeTime(b?.createdAt) - safeTime(a?.createdAt) ||
    safeTime(b?.updatedAt) - safeTime(a?.updatedAt) ||
    String(a?.id || a?.ticketNumber || '').localeCompare(String(b?.id || b?.ticketNumber || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

export function compareInstallationsCanonical(
  a: Partial<WaterMeterInstallationRequest>,
  b: Partial<WaterMeterInstallationRequest>
): number {
  return (
    safeTime(b?.submissionDate) - safeTime(a?.submissionDate) ||
    safeTime(b?.updatedAt) - safeTime(a?.updatedAt) ||
    String(a?.id || a?.applicationNumber || '').localeCompare(String(b?.id || b?.applicationNumber || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

export function compareAnnouncementsCanonical(a: Partial<Announcement>, b: Partial<Announcement>): number {
  return (
    safeTime(b?.date) - safeTime(a?.date) ||
    String(a?.id || '').localeCompare(String(b?.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

export function compareBarangaysCanonical(a: Partial<Barangay>, b: Partial<Barangay>): number {
  return (
    String(a?.id || '').localeCompare(String(b?.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) ||
    String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
      sensitivity: 'base',
    })
  );
}

export function compareRoutesCanonical(a: Partial<RouteAssignment>, b: Partial<RouteAssignment>): number {
  return (
    String(a?.id || '').localeCompare(String(b?.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) ||
    String(a?.routeName || '').localeCompare(String(b?.routeName || ''), undefined, {
      sensitivity: 'base',
    })
  );
}

export function compareAuditLogsCanonical(a: Partial<AuditLog>, b: Partial<AuditLog>): number {
  return (
    safeTime(b?.timestamp) - safeTime(a?.timestamp) ||
    String(a?.id || '').localeCompare(String(b?.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

export function applyIfChanged<T>(setter: Dispatch<SetStateAction<T>>, nextValue: T): void {
  setter((prev) => {
    try {
      return JSON.stringify(prev) === JSON.stringify(nextValue) ? prev : nextValue;
    } catch {
      return nextValue;
    }
  });
}

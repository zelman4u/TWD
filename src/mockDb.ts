/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User, Consumer, MeterReader, WaterMeter, MeterReading, RouteAssignment, Announcement, AuditLog, ConsumerNotification, Barangay } from './types';
import { initializeFirestoreSeed, syncBatchToFirestore, syncDocToFirestore, COLLECTIONS } from './services/firebaseDb';

// Purge all legacy storage keys containing old mock data
try {
  const legacyPrefixes = ['twd_', 'twd_v1_', 'twd_v2_', 'water_district_', 'twd_live_v1_', 'twd_live_v2_', 'twd_live_v3_'];
  const keysToPurge: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && legacyPrefixes.some(p => k.startsWith(p)) && !k.startsWith('twd_live_v4_')) {
      keysToPurge.push(k);
    }
  }
  keysToPurge.forEach(k => localStorage.removeItem(k));
} catch (e) {
  // Safe failover
}

// Storage keys
const STORAGE_PREFIX = 'twd_live_v4_';
const KEYS = {
  USERS: `${STORAGE_PREFIX}users`,
  CONSUMERS: `${STORAGE_PREFIX}consumers`,
  READERS: `${STORAGE_PREFIX}readers`,
  METERS: `${STORAGE_PREFIX}meters`,
  READINGS: `${STORAGE_PREFIX}readings`,
  ROUTES: `${STORAGE_PREFIX}routes`,
  ANNOUNCEMENTS: `${STORAGE_PREFIX}announcements`,
  AUDIT_LOGS: `${STORAGE_PREFIX}audit_logs`,
  NOTIFICATIONS: `${STORAGE_PREFIX}notifications`,
  CURRENT_USER: `${STORAGE_PREFIX}current_user`,
  BARANGAYS: `${STORAGE_PREFIX}barangays`,
};

// Initial Clean Seed Data - Tagoloan Municipal Barangays
const INITIAL_BARANGAYS: Barangay[] = [
  { id: 'BRG-01', name: 'Poblacion', code: 'PB-01', consumers: 0, activeMeters: 0, schedule: '1st - 5th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-02', name: 'Natumolan', code: 'NT-02', consumers: 0, activeMeters: 0, schedule: '6th - 10th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-03', name: 'Baluarte', code: 'BL-03', consumers: 0, activeMeters: 0, schedule: '11th - 15th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-04', name: 'Sta. Ana', code: 'SA-04', consumers: 0, activeMeters: 0, schedule: '16th - 20th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-05', name: 'Sta. Cruz', code: 'SC-05', consumers: 0, activeMeters: 0, schedule: '21st - 25th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-06', name: 'Mohon', code: 'MH-06', consumers: 0, activeMeters: 0, schedule: '26th - End of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-07', name: 'Gracia', code: 'GR-07', consumers: 0, activeMeters: 0, schedule: '1st - 5th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-08', name: 'Casinglot', code: 'CS-08', consumers: 0, activeMeters: 0, schedule: '6th - 10th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-09', name: 'Sugbongcogon', code: 'SG-09', consumers: 0, activeMeters: 0, schedule: '11th - 15th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
];

const INITIAL_USERS: User[] = [
  {
    id: 'admin-1',
    email: 'admin@tagoloanwater.gov.ph',
    name: 'Admin',
    role: 'admin',
    status: 'active',
    password: 'AdminWater2025!',
  }
];

const INITIAL_CONSUMERS: Consumer[] = [
  {
    accountNumber: '011-102-056',
    name: 'FIGUEROA, GINA O.',
    address: 'SIHAYON-LEFT (ZONE-11A)',
    barangay: 'Poblacion',
    sitioZone: 'ZONE-11A',
    contactNumber: '+63 917 123 4567',
    email: 'gina.figueroa@gmail.com',
    meterNumber: '150307143',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-01-15',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '4 members',
    outstandingBalance: 205.03,
    rfidTag: 'RFID-150307143',
    sequenceNo: 135,
  },
  {
    accountNumber: '011-302-053',
    name: 'ELLO, CARMEN',
    address: 'SIHAYON-LEFT',
    barangay: 'Poblacion',
    sitioZone: 'Sihayon-Left',
    contactNumber: '+63 918 234 5678',
    email: 'carmen.ello@gmail.com',
    meterNumber: 'E180103545',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-10',
    consumerType: 'Commercial',
    businessName: 'Ello Enterprise / Store',
    businessType: 'Retail & Commercial',
    meterSize: '3/4"',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-E180103545',
    sequenceNo: 136,
  },
  {
    accountNumber: '011-102-042',
    name: 'OKLAND AIDALIN 1 / LLERA',
    address: 'SIHAYON-LEFT',
    barangay: 'Poblacion',
    sitioZone: 'Sihayon-Left',
    contactNumber: '+63 919 345 6789',
    email: 'aidalin.llera@gmail.com',
    meterNumber: '121111102',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-03-05',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '3 members',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-121111102',
    sequenceNo: 137,
  }
];

const INITIAL_READERS: MeterReader[] = [
  {
    id: 'reader-1',
    employeeId: 'TWD-MR-01',
    name: 'Marco Polo',
    email: 'reader@tagoloanwater.gov.ph',
    contactNumber: '+63 917 555 0199',
    employmentStatus: 'active',
    assignedRoutes: ['Zone 1 - Sihayon Left', 'Poblacion'],
    completedReadings: 142,
    pendingReadings: 3,
    performanceRating: 4.9
  }
];

const INITIAL_METERS: WaterMeter[] = [
  {
    meterNumber: '150307143',
    rfidTag: 'RFID-150307143',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-01-15',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 4393,
    status: 'active',
    linkedAccountNumber: '011-102-056'
  },
  {
    meterNumber: 'E180103545',
    rfidTag: 'RFID-E180103545',
    brand: 'EVER',
    type: 'mechanical',
    size: '3/4"',
    installationDate: '2024-02-10',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 2204,
    status: 'active',
    linkedAccountNumber: '011-302-053'
  },
  {
    meterNumber: '121111102',
    rfidTag: 'RFID-121111102',
    brand: 'EVJET',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-03-05',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 2100,
    status: 'active',
    linkedAccountNumber: '011-102-042'
  }
];

const INITIAL_READINGS: MeterReading[] = [
  {
    id: 'R-011-102-056-202410',
    accountNumber: '011-102-056',
    consumerName: 'FIGUEROA, GINA O.',
    meterNumber: '150307143',
    meterBrand: 'EVER',
    sequenceNo: 135,
    address: 'SIHAYON-LEFT (ZONE-11A)',
    addressZone: 'ZONE-11A',
    route: 'Sihayon-Left Route',
    previousReading: 4377,
    currentReading: 4393,
    consumption: 16,
    readingDate: '2024-10-15',
    meterReaderDate: '2024-10-15',
    status: 'verified',
    meterReaderName: 'MARCO POLO',
    imageUrl: 'https://images.unsplash.com/photo-1584467735815-f778f274e296?w=600&auto=format&fit=crop&q=80',
    billingPeriod: 'October 2024',
    dueDate: 'December 12, 2024',
    classification: 'Residential',
    billAmount: 124.50,
    franchiseTax: 2.54,
    arrears: 205.03,
    totalAmount: 332.07,
    penaltyAmount: 12.45,
    amountAfterDueDate: 344.52,
    paymentStatus: 'unpaid',
  },
  {
    id: 'R-011-302-053-202410',
    accountNumber: '011-302-053',
    consumerName: 'ELLO, CARMEN',
    meterNumber: 'E180103545',
    meterBrand: 'EVER',
    sequenceNo: 136,
    address: 'SIHAYON-LEFT',
    addressZone: 'Sihayon-Left',
    route: 'Sihayon-Left Route',
    previousReading: 2139,
    currentReading: 2204,
    consumption: 65,
    readingDate: '2024-10-15',
    meterReaderDate: '2024-10-15',
    status: 'verified',
    meterReaderName: 'MARCO POLO',
    imageUrl: 'https://images.unsplash.com/photo-1584467735815-f778f274e296?w=600&auto=format&fit=crop&q=80',
    billingPeriod: 'October 2024',
    dueDate: 'December 12, 2024',
    classification: 'Commercial',
    billAmount: 1387.50,
    franchiseTax: 28.32,
    arrears: 0.00,
    totalAmount: 1415.82,
    penaltyAmount: 138.75,
    amountAfterDueDate: 1554.57,
    paymentStatus: 'unpaid',
  },
  {
    id: 'R-011-102-042-202410',
    accountNumber: '011-102-042',
    consumerName: 'OKLAND AIDALIN 1 / LLERA',
    meterNumber: '121111102',
    meterBrand: 'EVJET',
    sequenceNo: 137,
    address: 'SIHAYON-LEFT',
    addressZone: 'Sihayon-Left',
    route: 'Sihayon-Left Route',
    previousReading: 2083,
    currentReading: 2100,
    consumption: 17,
    readingDate: '2024-10-15',
    meterReaderDate: '2024-10-15',
    status: 'verified',
    meterReaderName: 'MARCO POLO',
    imageUrl: 'https://images.unsplash.com/photo-1584467735815-f778f274e296?w=600&auto=format&fit=crop&q=80',
    billingPeriod: 'October 2024',
    dueDate: 'December 12, 2024',
    classification: 'Residential',
    billAmount: 132.75,
    franchiseTax: 2.71,
    arrears: 0.00,
    totalAmount: 135.46,
    penaltyAmount: 13.30,
    amountAfterDueDate: 148.76,
    paymentStatus: 'unpaid',
  }
];
const INITIAL_ROUTES: RouteAssignment[] = [];
const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'ann-1',
    title: 'Tagoloan Water District Live System Online',
    content: 'Welcome to the official Tagoloan Water District utility management system. Register your water service account or authenticate using municipal administration credentials.',
    date: '2026-08-18',
    category: 'info',
    postedBy: 'Administrative Office',
  }
];

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    timestamp: new Date().toISOString(),
    userId: 'system',
    userName: 'TWD Core System',
    userRole: 'system',
    action: 'Database Initialized',
    details: 'System initialized with clean municipal registry and official administrator credentials.',
    ipAddress: '127.0.0.1',
  }
];

// Helper functions to fetch and save from/to localStorage
function getStored<T>(key: string, initial: T): T {
  const data = localStorage.getItem(key);
  if (!data) {
    localStorage.setItem(key, JSON.stringify(initial));
    return initial;
  }
  try {
    const parsed = JSON.parse(data);
    // Automatic cleanup of legacy mock test accounts & name normalization
    if (key === KEYS.READERS) {
      const readers = parsed as MeterReader[];
      const seenIds = new Set<string>();
      const deduplicatedReaders: MeterReader[] = [];
      readers.forEach(r => {
        const idKey = (r.id || r.employeeId || r.email || '').trim().toLowerCase();
        if (idKey && !seenIds.has(idKey)) {
          seenIds.add(idKey);
          if (r.employeeId) seenIds.add(r.employeeId.trim().toLowerCase());
          if (r.id) seenIds.add(r.id.trim().toLowerCase());
          deduplicatedReaders.push(r);
        }
      });
      if (deduplicatedReaders.length !== readers.length) {
        localStorage.setItem(key, JSON.stringify(deduplicatedReaders));
        return deduplicatedReaders as unknown as T;
      }
    }
    if (key === KEYS.USERS) {
      const users = parsed as User[];
      let modified = false;
      const seenUsers = new Set<string>();
      const deduplicatedUsers: User[] = [];
      users.forEach(u => {
        const userKey = (u.id || u.email || '').trim().toLowerCase();
        if (userKey && !seenUsers.has(userKey)) {
          seenUsers.add(userKey);
          if (u.email) seenUsers.add(u.email.trim().toLowerCase());
          deduplicatedUsers.push(u);
        }
      });
      if (deduplicatedUsers.length !== users.length) {
        modified = true;
      }
      deduplicatedUsers.forEach(u => {
        if (u.email && u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph') {
          if (u.name !== 'Admin') {
            u.name = 'Admin';
            modified = true;
          }
          if (u.password !== 'AdminWater2025!') {
            u.password = 'AdminWater2025!';
            modified = true;
          }
        }
      });
      const hasMockUsers = deduplicatedUsers.some(u => u.email === 'john@example.com' || u.email === 'maria@example.com');
      const adminExists = deduplicatedUsers.some(u => u.email && u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph');
      if (hasMockUsers || !adminExists || modified) {
        const cleanedUsers = deduplicatedUsers.filter(u => u.email !== 'john@example.com' && u.email !== 'maria@example.com');
        if (!cleanedUsers.some(u => u.email && u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph')) {
          cleanedUsers.unshift(INITIAL_USERS[0]);
        }
        localStorage.setItem(key, JSON.stringify(cleanedUsers));
        return cleanedUsers as unknown as T;
      }
    }
    if (key === KEYS.BARANGAYS) {
      const brgs = parsed as Barangay[];
      const hasLegacyPoblacionEast = brgs.some(b => b.name === 'Poblacion East' || b.name === 'Poblacion West');
      if (hasLegacyPoblacionEast) {
        localStorage.setItem(key, JSON.stringify(INITIAL_BARANGAYS));
        return INITIAL_BARANGAYS as unknown as T;
      }
    }
    if (key === KEYS.CONSUMERS) {
      let cons = parsed as Consumer[];
      const hasMockConsumers = cons.some(c => c.accountNumber === '1001-A' && c.name === 'John Doe');
      if (hasMockConsumers) {
        cons = cons.filter(c => c.accountNumber !== '1001-A' && c.accountNumber !== '1002-B' && c.accountNumber !== '1003-C');
      }
      // Ensure authentic example consumers exist
      let changed = hasMockConsumers;
      INITIAL_CONSUMERS.forEach(ic => {
        if (!cons.some(c => c.accountNumber === ic.accountNumber)) {
          cons.push(ic);
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(key, JSON.stringify(cons));
        return cons as unknown as T;
      }
    }
    if (key === KEYS.METERS) {
      let meters = parsed as WaterMeter[];
      let changed = false;
      INITIAL_METERS.forEach(im => {
        if (!meters.some(m => m.meterNumber === im.meterNumber)) {
          meters.push(im);
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(key, JSON.stringify(meters));
        return meters as unknown as T;
      }
    }
    if (key === KEYS.READINGS) {
      let reads = parsed as MeterReading[];
      const hasMockReads = reads.some(r => r.id.startsWith('R-1001-A') || r.id.startsWith('R-1002-B'));
      if (hasMockReads) {
        reads = reads.filter(r => !r.id.startsWith('R-1001-A') && !r.id.startsWith('R-1002-B'));
      }
      let changed = hasMockReads;
      INITIAL_READINGS.forEach(ir => {
        if (!reads.some(r => r.id === ir.id || (r.accountNumber === ir.accountNumber && r.billingPeriod === ir.billingPeriod))) {
          reads.push(ir);
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(key, JSON.stringify(reads));
        return reads as unknown as T;
      }
    }
    return parsed;
  } catch (e) {
    return initial;
  }
}

function setStored<T>(key: string, value: T): void {
  try {
    const json = JSON.stringify(value);
    const existing = localStorage.getItem(key);
    if (existing === json) {
      return; // Data has not changed, do not trigger event loops
    }
    localStorage.setItem(key, json);
    if (typeof window !== 'undefined') {
      // Notify mounted components in same window immediately
      window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key, timestamp: Date.now() } }));
      // Cross-tab synchronization ping
      try {
        localStorage.setItem('twd_sync_ping', `${Date.now()}_${key}`);
      } catch {}
    }
  } catch (e) {
    console.warn(`[mockDb] Error persisting key "${key}":`, e);
  }
}

export const mockDb = {
  // Get all datasets
  getUsers: (): User[] => getStored<User[]>(KEYS.USERS, INITIAL_USERS),
  getConsumers: (): Consumer[] => getStored<Consumer[]>(KEYS.CONSUMERS, INITIAL_CONSUMERS),
  getReaders: (): MeterReader[] => getStored<MeterReader[]>(KEYS.READERS, INITIAL_READERS),
  getMeters: (): WaterMeter[] => getStored<WaterMeter[]>(KEYS.METERS, INITIAL_METERS),
  getReadings: (): MeterReading[] => getStored<MeterReading[]>(KEYS.READINGS, INITIAL_READINGS),
  getRoutes: (): RouteAssignment[] => getStored<RouteAssignment[]>(KEYS.ROUTES, INITIAL_ROUTES),
  getAnnouncements: (): Announcement[] => getStored<Announcement[]>(KEYS.ANNOUNCEMENTS, INITIAL_ANNOUNCEMENTS),
  getAuditLogs: (): AuditLog[] => getStored<AuditLog[]>(KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ),
  getBarangays: (): Barangay[] => getStored<Barangay[]>(KEYS.BARANGAYS, INITIAL_BARANGAYS),
  getCurrentUser: (): User | null => {
    try {
      const u = localStorage.getItem(KEYS.CURRENT_USER);
      if (!u) return null;
      const user = JSON.parse(u) as User;
      if (user && user.email && user.email.toLowerCase() === 'admin@tagoloanwater.gov.ph') {
        if (user.name !== 'Admin') {
          user.name = 'Admin';
          localStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
        }
      }
      return user;
    } catch {
      return null;
    }
  },

  // State Updates
  setCurrentUser: (user: User | null): void => {
    if (user) {
      localStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(KEYS.CURRENT_USER);
    }
  },

  saveUsers: (users: User[]): void => {
    setStored(KEYS.USERS, users);
    syncBatchToFirestore(COLLECTIONS.USERS, users, 'id');
    // Also individually ensure each user is in Firestore
    users.forEach(u => {
      if (u.id) {
        syncDocToFirestore(COLLECTIONS.USERS, u.id, u);
      }
      if (u.email) {
        // Also index by email-based ID for direct lookup
        const emailDocId = `email_${u.email.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        syncDocToFirestore(COLLECTIONS.USERS, emailDocId, u);
      }
    });
  },
  saveConsumers: (consumers: Consumer[]): void => {
    // Deduplicate consumers: if an active record with issued accountNumber exists, drop stale pending placeholders for same user/email/name
    const deduplicated = consumers.filter((c, idx, arr) => {
      const isPending = !c.accountNumber || c.accountNumber.toUpperCase().startsWith('PENDING') || c.status === 'pending_approval';
      if (isPending) {
        const hasActiveTwin = arr.some(o => o !== c && (
          (c.linkedUserId && o.linkedUserId && o.linkedUserId === c.linkedUserId && o.status === 'active') ||
          (c.email && o.email && o.email.toLowerCase() === c.email.toLowerCase() && o.status === 'active') ||
          (c.name && o.name && o.name.toLowerCase() === c.name.toLowerCase() && c.barangay === o.barangay && o.status === 'active')
        ));
        if (hasActiveTwin) return false;
      }
      return true;
    });

    setStored(KEYS.CONSUMERS, deduplicated);
    syncBatchToFirestore(COLLECTIONS.CONSUMERS, deduplicated, 'accountNumber');
    // Ensure every pending or active consumer is synced to Firestore
    deduplicated.forEach(c => {
      const docId = (c.accountNumber && !c.accountNumber.startsWith('PENDING')) 
        ? c.accountNumber 
        : (c.linkedUserId || (c.email ? `email_${c.email.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_')}` : '') || (c as any).id);
      if (docId) {
        syncDocToFirestore(COLLECTIONS.CONSUMERS, docId, c);
      }
    });
  },
  saveReaders: (readers: MeterReader[]): void => {
    const seen = new Set<string>();
    const deduplicated: MeterReader[] = [];
    readers.forEach(r => {
      const key = (r.id || r.employeeId || r.email || '').trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        if (r.id) seen.add(r.id.trim().toLowerCase());
        if (r.employeeId) seen.add(r.employeeId.trim().toLowerCase());
        deduplicated.push(r);
      }
    });
    setStored(KEYS.READERS, deduplicated);
    syncBatchToFirestore(COLLECTIONS.READERS, deduplicated, 'id');
    deduplicated.forEach(r => {
      if (r.id) {
        syncDocToFirestore(COLLECTIONS.READERS, r.id, r);
      }
      if (r.employeeId && r.employeeId !== r.id) {
        syncDocToFirestore(COLLECTIONS.READERS, r.employeeId, r);
      }
    });
  },
  saveMeters: (meters: WaterMeter[]): void => {
    setStored(KEYS.METERS, meters);
    syncBatchToFirestore(COLLECTIONS.METERS, meters, 'meterNumber');
  },
  saveReadings: (readings: MeterReading[]): void => {
    setStored(KEYS.READINGS, readings);
    syncBatchToFirestore(COLLECTIONS.READINGS, readings, 'id');
  },
  saveRoutes: (routes: RouteAssignment[]): void => {
    setStored(KEYS.ROUTES, routes);
    syncBatchToFirestore(COLLECTIONS.ROUTES, routes, 'id');
  },
  saveAnnouncements: (anns: Announcement[]): void => {
    setStored(KEYS.ANNOUNCEMENTS, anns);
    syncBatchToFirestore(COLLECTIONS.ANNOUNCEMENTS, anns, 'id');
  },
  saveAuditLogs: (logs: AuditLog[]): void => {
    setStored(KEYS.AUDIT_LOGS, logs);
    syncBatchToFirestore(COLLECTIONS.AUDIT_LOGS, logs, 'id');
  },
  saveBarangays: (barangays: Barangay[]): void => {
    setStored(KEYS.BARANGAYS, barangays);
    syncBatchToFirestore(COLLECTIONS.BARANGAYS, barangays, 'id');
  },

  findOrCreateBarangay: (barangayName: string): Barangay => {
    const list = mockDb.getBarangays();
    const cleanName = barangayName.trim();
    const existing = list.find(b => (b.name || '').toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      return existing;
    }
    const nextNum = list.length + 1;
    const generatedId = `BRG-${String(nextNum).padStart(2, '0')}`;
    const codePrefix = cleanName.replace(/[^a-zA-Z]/g, '').substring(0, 2).toUpperCase() || 'BG';
    const generatedCode = `${codePrefix}-${String(nextNum).padStart(2, '0')}`;
    
    const newBarangay: Barangay = {
      id: generatedId,
      name: cleanName,
      code: generatedCode,
      consumers: 1,
      activeMeters: 1,
      schedule: '1st - 15th of Month',
      supervisor: 'District Operations Supervisor',
      ratePerM3: 24.50
    };
    
    list.push(newBarangay);
    mockDb.saveBarangays(list);
    return newBarangay;
  },

  getNotifications: (accountNumber?: string): ConsumerNotification[] => {
    const list = getStored<ConsumerNotification[]>(KEYS.NOTIFICATIONS, []);
    if (accountNumber) {
      return list.filter(n => n.accountNumber === accountNumber).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }
    return list.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  addNotification: (notif: Omit<ConsumerNotification, 'id' | 'timestamp' | 'read'>): ConsumerNotification => {
    const list = getStored<ConsumerNotification[]>(KEYS.NOTIFICATIONS, []);
    const newNotif: ConsumerNotification = {
      ...notif,
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      read: false
    };
    list.push(newNotif);
    setStored(KEYS.NOTIFICATIONS, list);
    syncDocToFirestore(COLLECTIONS.NOTIFICATIONS, newNotif.id, newNotif as unknown as Record<string, unknown>);
    return newNotif;
  },

  markNotificationRead: (id: string): void => {
    const list = getStored<ConsumerNotification[]>(KEYS.NOTIFICATIONS, []);
    const updated = list.map(n => n.id === id ? { ...n, read: true } : n);
    setStored(KEYS.NOTIFICATIONS, updated);
    syncDocToFirestore(COLLECTIONS.NOTIFICATIONS, id, { read: true });
  },

  addAuditLog: (userId: string, userName: string, userRole: 'admin' | 'consumer' | 'system' | 'staff' | 'cashier' | 'meter_reader', action: string, details: string): void => {
    const logs = mockDb.getAuditLogs();
    const newLog: AuditLog = {
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId,
      userName,
      userRole,
      action,
      details,
      ipAddress: '192.168.1.' + Math.floor(Math.random() * 254 + 1),
    };
    logs.push(newLog);
    mockDb.saveAuditLogs(logs);
  },

  initFirestore: (): void => {
    initializeFirestoreSeed({
      users: INITIAL_USERS,
      consumers: INITIAL_CONSUMERS,
      readers: INITIAL_READERS,
      meters: INITIAL_METERS,
      readings: INITIAL_READINGS,
      routes: INITIAL_ROUTES,
      announcements: INITIAL_ANNOUNCEMENTS,
      barangays: INITIAL_BARANGAYS,
    });
  },

  resetDatabase: (): void => {
    localStorage.removeItem(KEYS.USERS);
    localStorage.removeItem(KEYS.CONSUMERS);
    localStorage.removeItem(KEYS.READERS);
    localStorage.removeItem(KEYS.METERS);
    localStorage.removeItem(KEYS.READINGS);
    localStorage.removeItem(KEYS.ROUTES);
    localStorage.removeItem(KEYS.ANNOUNCEMENTS);
    localStorage.removeItem(KEYS.AUDIT_LOGS);
    localStorage.removeItem(KEYS.CURRENT_USER);
    localStorage.removeItem(KEYS.BARANGAYS);
    localStorage.removeItem(KEYS.NOTIFICATIONS);
  }
};

// Auto initialize Firestore baseline data
mockDb.initFirestore();

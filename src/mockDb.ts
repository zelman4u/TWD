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

const INITIAL_CONSUMERS: Consumer[] = [];
const INITIAL_READERS: MeterReader[] = [];
const INITIAL_METERS: WaterMeter[] = [];
const INITIAL_READINGS: MeterReading[] = [];
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
    if (key === KEYS.USERS) {
      const users = parsed as User[];
      let modified = false;
      users.forEach(u => {
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
      const hasMockUsers = users.some(u => u.email === 'john@example.com' || u.email === 'maria@example.com');
      const adminExists = users.some(u => u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph');
      if (hasMockUsers || !adminExists || modified) {
        const cleanedUsers = users.filter(u => u.email !== 'john@example.com' && u.email !== 'maria@example.com');
        if (!cleanedUsers.some(u => u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph')) {
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
      const cons = parsed as Consumer[];
      const hasMockConsumers = cons.some(c => c.accountNumber === '1001-A' && c.name === 'John Doe');
      if (hasMockConsumers) {
        const cleanedCons = cons.filter(c => c.accountNumber !== '1001-A' && c.accountNumber !== '1002-B' && c.accountNumber !== '1003-C');
        localStorage.setItem(key, JSON.stringify(cleanedCons));
        return cleanedCons as unknown as T;
      }
    }
    if (key === KEYS.READINGS) {
      const reads = parsed as MeterReading[];
      const hasMockReads = reads.some(r => r.id.startsWith('R-1001-A') || r.id.startsWith('R-1002-B'));
      if (hasMockReads) {
        const cleanedReads = reads.filter(r => !r.id.startsWith('R-1001-A') && !r.id.startsWith('R-1002-B'));
        localStorage.setItem(key, JSON.stringify(cleanedReads));
        return cleanedReads as unknown as T;
      }
    }
    return parsed;
  } catch (e) {
    return initial;
  }
}

function setStored<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
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
  },
  saveConsumers: (consumers: Consumer[]): void => {
    setStored(KEYS.CONSUMERS, consumers);
    syncBatchToFirestore(COLLECTIONS.CONSUMERS, consumers, 'accountNumber');
  },
  saveReaders: (readers: MeterReader[]): void => {
    setStored(KEYS.READERS, readers);
    syncBatchToFirestore(COLLECTIONS.READERS, readers, 'id');
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
    const existing = list.find(b => b.name.toLowerCase() === cleanName.toLowerCase());
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

  addAuditLog: (userId: string, userName: string, userRole: 'admin' | 'consumer' | 'system' | 'staff' | 'cashier', action: string, details: string): void => {
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

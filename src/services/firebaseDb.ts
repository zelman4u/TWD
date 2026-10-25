import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  limit,
  where,
  onSnapshot,
  Unsubscribe,
  disableNetwork,
  enableNetwork,
} from 'firebase/firestore';
import { db, auth, QUOTA_STORAGE_KEY } from '../firebase';
import {
  User,
  Consumer,
  MeterReader,
  WaterMeter,
  MeterReading,
  RouteAssignment,
  Announcement,
  AuditLog,
  ConsumerNotification,
  Barangay,
  ConsumerReport,
} from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function isPermissionDeniedError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : String(err);
  return code === 'permission-denied' || msg.includes('Missing or insufficient permissions');
}

// Collection references in Firestore
export const COLLECTIONS = {
  USERS: 'users',
  CONSUMERS: 'consumers',
  READERS: 'readers',
  METERS: 'meters',
  READINGS: 'readings',
  ROUTES: 'routes',
  ANNOUNCEMENTS: 'announcements',
  AUDIT_LOGS: 'audit_logs',
  NOTIFICATIONS: 'notifications',
  BARANGAYS: 'barangays',
  SETTINGS: 'settings',
  REPORTS: 'consumer_reports',
};

// Storage prefix used by mockDb
const STORAGE_PREFIX = 'twd_live_v4_';
export const TERMINATED_ACCOUNTS_KEY = `${STORAGE_PREFIX}terminated_accounts`;

export const KEYS = {
  USERS: `${STORAGE_PREFIX}users`,
  CONSUMERS: `${STORAGE_PREFIX}consumers`,
  READERS: `${STORAGE_PREFIX}readers`,
  METERS: `${STORAGE_PREFIX}meters`,
  READINGS: `${STORAGE_PREFIX}readings`,
  ROUTES: `${STORAGE_PREFIX}routes`,
  ANNOUNCEMENTS: `${STORAGE_PREFIX}announcements`,
  AUDIT_LOGS: `${STORAGE_PREFIX}audit_logs`,
  NOTIFICATIONS: `${STORAGE_PREFIX}notifications`,
  REPORTS: `${STORAGE_PREFIX}consumer_reports`,
  BARANGAYS: `${STORAGE_PREFIX}barangays`,
  TARIFF_CONFIG: `${STORAGE_PREFIX}tariff_config`,
  CURRENT_USER: `${STORAGE_PREFIX}current_user`,
  TERMINATED: TERMINATED_ACCOUNTS_KEY,
};

export function isRealIssuedAccountNumber(acc?: string | null): boolean {
  if (!acc) return false;
  const clean = String(acc).replace(/^#/, '').trim().toUpperCase();
  if (!clean) return false;
  if (
    clean.startsWith('PENDING') ||
    clean === 'UNASSIGNED' ||
    clean === 'UNISSUED' ||
    clean === 'NONE' ||
    clean === 'N/A' ||
    clean === 'NULL' ||
    clean === 'UNDEFINED'
  ) {
    return false;
  }
  return true;
}

export function isIssuedActiveConsumer(c?: Partial<Consumer> | null): boolean {
  if (!c) return false;
  return isRealIssuedAccountNumber(c.accountNumber) && c.status !== 'pending_approval';
}

function normalizePhone11(phone?: string | null): string {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('639')) return '0' + digits.slice(2);
  if (digits.length === 10 && digits.startsWith('9')) return '0' + digits;
  return digits.length === 11 ? digits : '';
}

function sanitizeEmailDocId(email: string): string {
  return `email_${email.trim().toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 120);
}

function sanitizeDocId(rawId: string): string {
  return rawId.trim().replace(/\//g, '_').slice(0, 120);
}

function sanitizeForFirestore<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return (input.length > 2900 ? input.slice(0, 2900) : input) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input
      .filter((v) => v !== undefined)
      .slice(0, 100)
      .map((v) => sanitizeForFirestore(v)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(input as Record<string, unknown>).slice(0, 58);
    for (const [k, v] of entries) {
      if (v !== undefined) {
        out[k] = sanitizeForFirestore(v);
      }
    }
    return out as T;
  }
  return input;
}

// Payload hash deduplication cache so identical records are never re-written redundantly
const syncedPayloadCache = new Map<string, string>();

function shouldWritePayload(collectionName: string, docId: string, payload: unknown): boolean {
  try {
    const cacheKey = `${collectionName}/${docId}`;
    const serialized = JSON.stringify(payload);
    if (syncedPayloadCache.get(cacheKey) === serialized) {
      return false;
    }
    syncedPayloadCache.set(cacheKey, serialized);
    return true;
  } catch {
    return true;
  }
}

export function getTerminatedAccountKeys(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = localStorage.getItem(TERMINATED_ACCOUNTS_KEY);
    if (!raw) return new Set();
    const arr: string[] = JSON.parse(raw);
    return new Set(arr.map((s) => s.toLowerCase().trim()));
  } catch {
    return new Set();
  }
}

export function addTerminatedAccountKeys(keys: (string | undefined | null)[]) {
  try {
    if (typeof window === 'undefined') return;
    const current = getTerminatedAccountKeys();
    keys.forEach((k) => {
      if (k && typeof k === 'string' && k.trim()) {
        current.add(k.trim().toLowerCase());
      }
    });
    localStorage.setItem(TERMINATED_ACCOUNTS_KEY, JSON.stringify(Array.from(current)));
  } catch {}
}

export function removeTerminatedAccountKeys(keys: (string | undefined | null)[]) {
  try {
    if (typeof window === 'undefined') return;
    const current = getTerminatedAccountKeys();
    keys.forEach((k) => {
      if (k && typeof k === 'string' && k.trim()) {
        current.delete(k.trim().toLowerCase());
      }
    });
    localStorage.setItem(TERMINATED_ACCOUNTS_KEY, JSON.stringify(Array.from(current)));
  } catch {}
}

export function isAccountTerminated(account: {
  id?: string;
  employeeId?: string;
  username?: string;
  email?: string;
  name?: string;
}): boolean {
  const set = getTerminatedAccountKeys();
  if (set.size === 0) return false;
  const candidates = [account.id, account.employeeId, account.username, account.email, account.name].filter(
    Boolean
  ) as string[];
  return candidates.some((c) => set.has(c.trim().toLowerCase()));
}

function triggerLocalUpdateEvent(key: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key, timestamp: Date.now() } }));
    try {
      localStorage.setItem('twd_sync_ping', `${Date.now()}_${key}`);
    } catch {}
  }
}

// ============================================================================
// FIRESTORE QUOTA CIRCUIT BREAKER (DEFAULT ENABLED FOR LIVE CROSS-DEVICE SYNC)
// ============================================================================
let memoryQuotaExceeded = false;
try {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('twd_firestore_quota_exceeded');
    sessionStorage.removeItem('twd_firestore_quota_exceeded');
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY) || sessionStorage.getItem(QUOTA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.timestamp && Date.now() - parsed.timestamp < 4 * 60 * 60 * 1000) {
        memoryQuotaExceeded = true;
      } else {
        localStorage.removeItem(QUOTA_STORAGE_KEY);
        sessionStorage.removeItem(QUOTA_STORAGE_KEY);
      }
    }
  }
} catch {}

if (memoryQuotaExceeded) {
  try {
    disableNetwork(db).catch(() => {});
  } catch {}
} else {
  try {
    enableNetwork(db).catch(() => {});
  } catch {}
}

export function isQuotaError(err: any): boolean {
  if (!err) return false;
  const code = err?.code || '';
  const msg = err?.message || String(err);
  return (
    code === 'resource-exhausted' ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('Quota exceeded') ||
    msg.includes('resource-exhausted') ||
    msg.includes('Free daily write units') ||
    msg.includes('Free daily read units')
  );
}

export function isFirestoreQuotaExceeded(): boolean {
  if (typeof window === 'undefined') return false;
  if (!memoryQuotaExceeded) return false;
  try {
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY) || sessionStorage.getItem(QUOTA_STORAGE_KEY);
    if (!raw) {
      memoryQuotaExceeded = false;
      return false;
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > 4 * 60 * 60 * 1000) {
      localStorage.removeItem(QUOTA_STORAGE_KEY);
      sessionStorage.removeItem(QUOTA_STORAGE_KEY);
      memoryQuotaExceeded = false;
      enableNetwork(db).catch(() => {});
      return false;
    }
    return true;
  } catch {
    return memoryQuotaExceeded;
  }
}

export function markFirestoreQuotaExceeded(err?: any) {
  if (!memoryQuotaExceeded) {
    console.warn('[Firestore] Daily quota reached. Falling back to API + local storage.');
  }
  memoryQuotaExceeded = true;
  stopRealtimeFirestoreListeners();
  try {
    disableNetwork(db).catch(() => {});
  } catch {}
  try {
    if (typeof window !== 'undefined') {
      const payload = JSON.stringify({
        exceeded: true,
        timestamp: Date.now(),
        reason: err?.message || 'Quota limit exceeded',
      });
      localStorage.setItem(QUOTA_STORAGE_KEY, payload);
      sessionStorage.setItem(QUOTA_STORAGE_KEY, payload);
    }
  } catch {}
}

/**
 * Merges two User objects belonging to the same identity, preserving password
 * and always preferring active status + real issued linkedAccountNumber.
 */
function mergeUserPair(a: User, b: User): User {
  const aHasRealAcc = isRealIssuedAccountNumber(a.linkedAccountNumber);
  const bHasRealAcc = isRealIssuedAccountNumber(b.linkedAccountNumber);
  const preferredAcc = bHasRealAcc
    ? b.linkedAccountNumber!.trim().toUpperCase()
    : aHasRealAcc
      ? a.linkedAccountNumber!.trim().toUpperCase()
      : b.linkedAccountNumber || a.linkedAccountNumber;

  const preferredStatus =
    aHasRealAcc || bHasRealAcc || a.status === 'active' || b.status === 'active'
      ? a.status === 'inactive' && b.status === 'inactive'
        ? 'inactive'
        : 'active'
      : b.status || a.status || 'pending_approval';

  const preferredId =
    a.id && !a.id.startsWith('email_')
      ? a.id
      : b.id && !b.id.startsWith('email_')
        ? b.id
        : b.id || a.id;

  return {
    ...a,
    ...b,
    id: preferredId,
    email: (b.email || a.email || '').trim(),
    name: b.name || a.name,
    role: a.role === 'admin' || b.role === 'admin' ? 'admin' : b.role || a.role || 'consumer',
    status: preferredStatus,
    linkedAccountNumber: preferredAcc,
    password: b.password || a.password,
  };
}

/**
 * Merges two Consumer objects belonging to the same household/applicant,
 * preferring the issued active record while retaining user/contact links.
 */
function mergeConsumerPair(existing: Consumer, incoming: Consumer): Consumer {
  const exActive = isIssuedActiveConsumer(existing);
  const inActive = isIssuedActiveConsumer(incoming);

  const primary = inActive && !exActive ? incoming : exActive && !inActive ? existing : { ...existing, ...incoming };
  const secondary = primary === incoming ? existing : incoming;

  const mergedAcc = isRealIssuedAccountNumber(primary.accountNumber)
    ? primary.accountNumber.trim().toUpperCase()
    : isRealIssuedAccountNumber(secondary.accountNumber)
      ? secondary.accountNumber.trim().toUpperCase()
      : primary.accountNumber || secondary.accountNumber || '';

  const mergedMeter =
    primary.meterNumber && !primary.meterNumber.toUpperCase().startsWith('PENDING')
      ? primary.meterNumber
      : secondary.meterNumber && !secondary.meterNumber.toUpperCase().startsWith('PENDING')
        ? secondary.meterNumber
        : mergedAcc
          ? `MT-${mergedAcc}`
          : '';

  const mergedRfid =
    primary.rfidTag && !primary.rfidTag.toUpperCase().startsWith('PENDING')
      ? primary.rfidTag
      : secondary.rfidTag && !secondary.rfidTag.toUpperCase().startsWith('PENDING')
        ? secondary.rfidTag
        : mergedMeter
          ? `RFID-${mergedMeter}`
          : '';

  return {
    ...secondary,
    ...primary,
    accountNumber: mergedAcc,
    meterNumber: mergedMeter,
    rfidTag: mergedRfid,
    status: isRealIssuedAccountNumber(mergedAcc)
      ? primary.status === 'pending_approval'
        ? 'active'
        : primary.status || 'active'
      : primary.status || secondary.status || 'pending_approval',
    email: primary.email || secondary.email || '',
    linkedUserId: primary.linkedUserId || secondary.linkedUserId,
    contactNumber: primary.contactNumber || secondary.contactNumber || '',
    isRegistered: primary.isRegistered ?? secondary.isRegistered ?? true,
  };
}

// Active Firestore Realtime Unsubscribe handles
let realtimeUnsubscribes: Unsubscribe[] = [];

/**
 * Starts live real-time two-way Firestore synchronization across all devices
 */
export function startRealtimeFirestoreListeners() {
  if (isFirestoreQuotaExceeded()) {
    return;
  }
  stopRealtimeFirestoreListeners();

  try {
    // 1. Live USERS Listener
    const unsubUsers = onSnapshot(
      collection(db, COLLECTIONS.USERS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudUsers: User[] = [];
          snapshot.forEach((d) => {
            const u = d.data() as User;
            if (!u.id) u.id = d.id;
            if (!isAccountTerminated(u)) {
              cloudUsers.push(u);
            }
          });

          const localRaw = localStorage.getItem(KEYS.USERS);
          const localUsers: User[] = localRaw ? JSON.parse(localRaw) : [];
          const activeLocalUsers = localUsers.filter((u) => !isAccountTerminated(u));
          const mergedMap = new Map<string, User>();

          const adminUser: User = {
            id: 'admin-1',
            email: 'admin@tagoloanwater.gov.ph',
            name: 'Admin',
            role: 'admin',
            status: 'active',
            password: 'AdminWater2025!',
          };
          mergedMap.set('admin@tagoloanwater.gov.ph', adminUser);

          const upsertIntoMap = (u: User) => {
            if (isAccountTerminated(u)) return;
            const key = u.email ? u.email.trim().toLowerCase() : u.id;
            if (!key) return;
            const prev = mergedMap.get(key);
            mergedMap.set(key, prev ? mergeUserPair(prev, u) : u);
          };

          activeLocalUsers.forEach(upsertIntoMap);
          cloudUsers.forEach(upsertIntoMap);

          const finalUsers = Array.from(mergedMap.values()).filter((u) => !isAccountTerminated(u));
          localStorage.setItem(KEYS.USERS, JSON.stringify(finalUsers));

          // Also upgrade active session user if their account was confirmed on another device
          try {
            const currentRaw = localStorage.getItem(KEYS.CURRENT_USER);
            if (currentRaw) {
              const currentSession: User = JSON.parse(currentRaw);
              if (currentSession && currentSession.role !== 'admin') {
                const matched = finalUsers.find(
                  (u) =>
                    (currentSession.email && u.email && u.email.toLowerCase() === currentSession.email.toLowerCase()) ||
                    (currentSession.id && u.id === currentSession.id)
                );
                if (
                  matched &&
                  isRealIssuedAccountNumber(matched.linkedAccountNumber) &&
                  (currentSession.linkedAccountNumber !== matched.linkedAccountNumber ||
                    currentSession.status !== 'active')
                ) {
                  localStorage.setItem(
                    KEYS.CURRENT_USER,
                    JSON.stringify({
                      ...currentSession,
                      linkedAccountNumber: matched.linkedAccountNumber,
                      status: 'active',
                    })
                  );
                }
              }
            }
          } catch {}

          triggerLocalUpdateEvent(KEYS.USERS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
        else if (isPermissionDeniedError(err)) {
          try {
            handleFirestoreError(err, OperationType.LIST, COLLECTIONS.USERS);
          } catch {}
        }
      }
    );
    realtimeUnsubscribes.push(unsubUsers);

    // 2. Live CONSUMERS Listener
    const unsubConsumers = onSnapshot(
      collection(db, COLLECTIONS.CONSUMERS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudConsumers: Consumer[] = [];
          snapshot.forEach((d) => {
            const cData = d.data() as Consumer;
            if (!isAccountTerminated(cData)) {
              cloudConsumers.push(cData);
            }
          });

          const localRaw = localStorage.getItem(KEYS.CONSUMERS);
          const localConsumers: Consumer[] = localRaw ? JSON.parse(localRaw) : [];
          const activeLocal = localConsumers.filter((c) => !isAccountTerminated(c));

          const allList = [...cloudConsumers, ...activeLocal];
          const mergedList: Consumer[] = [];

          for (const c of allList) {
            const cAcc = isRealIssuedAccountNumber(c.accountNumber) ? c.accountNumber.trim().toUpperCase() : '';
            const cEmail = (c.email || '').trim().toLowerCase();
            const cUid = (c.linkedUserId || '').trim();
            const cPhone = normalizePhone11(c.contactNumber);
            const cName = (c.name || '').trim().toLowerCase();

            const existingIdx = mergedList.findIndex((m) => {
              const mAcc = isRealIssuedAccountNumber(m.accountNumber) ? m.accountNumber.trim().toUpperCase() : '';
              const mEmail = (m.email || '').trim().toLowerCase();
              const mUid = (m.linkedUserId || '').trim();
              const mPhone = normalizePhone11(m.contactNumber);
              const mName = (m.name || '').trim().toLowerCase();

              if (cAcc && mAcc && cAcc === mAcc) return true;
              if (cEmail && mEmail && cEmail === mEmail) return true;
              if (cUid && mUid && cUid === mUid) return true;
              if (cPhone && mPhone && cPhone === mPhone) return true;
              if (cName && mName && cName === mName && (!cEmail || !mEmail || cEmail === mEmail)) {
                if (!c.barangay || !m.barangay || c.barangay.toLowerCase() === m.barangay.toLowerCase()) {
                  return true;
                }
              }
              return false;
            });

            if (existingIdx === -1) {
              mergedList.push(c);
            } else {
              mergedList[existingIdx] = mergeConsumerPair(mergedList[existingIdx], c);
            }
          }

          localStorage.setItem(KEYS.CONSUMERS, JSON.stringify(mergedList));
          triggerLocalUpdateEvent(KEYS.CONSUMERS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
        else if (isPermissionDeniedError(err)) {
          try {
            handleFirestoreError(err, OperationType.LIST, COLLECTIONS.CONSUMERS);
          } catch {}
        }
      }
    );
    realtimeUnsubscribes.push(unsubConsumers);

    // 3. Live READERS Listener
    const unsubReaders = onSnapshot(
      collection(db, COLLECTIONS.READERS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudReaders: MeterReader[] = [];
          snapshot.forEach((d) => {
            const r = d.data() as MeterReader;
            if (!isAccountTerminated(r)) {
              cloudReaders.push(r);
            }
          });

          const localRaw = localStorage.getItem(KEYS.READERS);
          const localReaders: MeterReader[] = localRaw ? JSON.parse(localRaw) : [];
          const activeLocalReaders = localReaders.filter((r) => !isAccountTerminated(r));
          const mergedList: MeterReader[] = [];
          const seen = new Set<string>();

          const addUniqueReader = (r: MeterReader) => {
            if (isAccountTerminated(r)) return;
            const kId = (r.id || '').trim().toLowerCase();
            const kEmp = (r.employeeId || '').trim().toLowerCase();
            const kUser = (r.username || '').trim().toLowerCase();
            const kName = (r.name || '').trim().toLowerCase();
            const kEmail = (r.email || '').trim().toLowerCase();

            if (
              (kId && seen.has(kId)) ||
              (kEmp && seen.has(kEmp)) ||
              (kUser && seen.has(kUser)) ||
              (kName && seen.has(kName)) ||
              (kEmail && seen.has(kEmail))
            ) {
              return;
            }

            if (kId) seen.add(kId);
            if (kEmp) seen.add(kEmp);
            if (kUser) seen.add(kUser);
            if (kName) seen.add(kName);
            if (kEmail) seen.add(kEmail);
            mergedList.push({ ...r, employmentStatus: r.employmentStatus || 'active' });
          };

          cloudReaders.forEach(addUniqueReader);
          activeLocalReaders.forEach(addUniqueReader);

          localStorage.setItem(KEYS.READERS, JSON.stringify(mergedList));
          triggerLocalUpdateEvent(KEYS.READERS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
      }
    );
    realtimeUnsubscribes.push(unsubReaders);

    // 4. Live METERS Listener
    const unsubMeters = onSnapshot(
      collection(db, COLLECTIONS.METERS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudMeters: WaterMeter[] = [];
          snapshot.forEach((d) => cloudMeters.push(d.data() as WaterMeter));
          localStorage.setItem(KEYS.METERS, JSON.stringify(cloudMeters));
          triggerLocalUpdateEvent(KEYS.METERS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
      }
    );
    realtimeUnsubscribes.push(unsubMeters);

    // 5. Live READINGS Listener
    const unsubReadings = onSnapshot(
      collection(db, COLLECTIONS.READINGS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudReadings: MeterReading[] = [];
          snapshot.forEach((d) => cloudReadings.push(d.data() as MeterReading));

          const localRaw = localStorage.getItem(KEYS.READINGS);
          const localReadings: MeterReading[] = localRaw ? JSON.parse(localRaw) : [];
          const mergedMap = new Map<string, MeterReading>();

          cloudReadings.forEach((r) => {
            if (r.id) mergedMap.set(r.id, r);
          });

          localReadings.forEach((lr) => {
            if (!mergedMap.has(lr.id)) {
              mergedMap.set(lr.id, lr);
            } else {
              const cr = mergedMap.get(lr.id)!;
              const lrStatusStr = String(lr.status || '');
              const crStatusStr = String(cr.status || '');
              const isLocalMoreAdvanced =
                ((lrStatusStr === 'verified' || lrStatusStr === 'approved') &&
                  (crStatusStr === 'pending' || crStatusStr === 'pending_approval')) ||
                (lr.paymentStatus === 'paid' && cr.paymentStatus !== 'paid');
              if (isLocalMoreAdvanced) {
                mergedMap.set(lr.id, { ...cr, ...lr });
              }
            }
          });

          const finalReadings = Array.from(mergedMap.values());
          localStorage.setItem(KEYS.READINGS, JSON.stringify(finalReadings));
          triggerLocalUpdateEvent(KEYS.READINGS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
      }
    );
    realtimeUnsubscribes.push(unsubReadings);

    // 6. Live ANNOUNCEMENTS Listener
    const unsubAnnouncements = onSnapshot(
      collection(db, COLLECTIONS.ANNOUNCEMENTS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudAnns: Announcement[] = [];
          snapshot.forEach((d) => cloudAnns.push(d.data() as Announcement));
          localStorage.setItem(KEYS.ANNOUNCEMENTS, JSON.stringify(cloudAnns));
          triggerLocalUpdateEvent(KEYS.ANNOUNCEMENTS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
      }
    );
    realtimeUnsubscribes.push(unsubAnnouncements);

    // 7. Live BARANGAYS Listener
    const unsubBarangays = onSnapshot(
      collection(db, COLLECTIONS.BARANGAYS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudBrgs: Barangay[] = [];
          snapshot.forEach((d) => cloudBrgs.push(d.data() as Barangay));
          localStorage.setItem(KEYS.BARANGAYS, JSON.stringify(cloudBrgs));
          triggerLocalUpdateEvent(KEYS.BARANGAYS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
      }
    );
    realtimeUnsubscribes.push(unsubBarangays);

    // 8. Live NOTIFICATIONS Listener (merges cloud + local without wiping)
    const unsubNotifs = onSnapshot(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudNotifs: ConsumerNotification[] = [];
          snapshot.forEach((d) => cloudNotifs.push(d.data() as ConsumerNotification));

          const localRaw = localStorage.getItem(KEYS.NOTIFICATIONS);
          const localNotifs: ConsumerNotification[] = localRaw ? JSON.parse(localRaw) : [];
          const mergedMap = new Map<string, ConsumerNotification>();

          const makeKey = (n: ConsumerNotification) => {
            if (n.id) return n.id;
            return `${n.type}_${(n.accountNumber || '').toUpperCase()}_${(n.consumerEmail || '').toLowerCase()}_${n.title}`;
          };

          localNotifs.forEach((ln) => {
            mergedMap.set(makeKey(ln), ln);
          });

          cloudNotifs.forEach((cn) => {
            const k = makeKey(cn);
            const prev = mergedMap.get(k);
            if (!prev) {
              // Also check semantic duplicate for account_issue
              const dupEntry = Array.from(mergedMap.entries()).find(([, ex]) => {
                if (cn.type === 'account_issue' && ex.type === 'account_issue') {
                  const sameAcc =
                    isRealIssuedAccountNumber(cn.accountNumber) &&
                    (ex.accountNumber || '').toUpperCase() === cn.accountNumber.toUpperCase();
                  const sameTitle = (ex.title || '').toLowerCase() === (cn.title || '').toLowerCase();
                  return sameAcc && sameTitle;
                }
                return false;
              });
              if (dupEntry) {
                mergedMap.set(dupEntry[0], { ...dupEntry[1], ...cn, read: Boolean(dupEntry[1].read || cn.read) });
              } else {
                mergedMap.set(k, cn);
              }
            } else {
              mergedMap.set(k, { ...prev, ...cn, read: Boolean(prev.read || cn.read) });
            }
          });

          const finalNotifs = Array.from(mergedMap.values());
          localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(finalNotifs));
          triggerLocalUpdateEvent(KEYS.NOTIFICATIONS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
        else if (isPermissionDeniedError(err)) {
          try {
            handleFirestoreError(err, OperationType.LIST, COLLECTIONS.NOTIFICATIONS);
          } catch {}
        }
      }
    );
    realtimeUnsubscribes.push(unsubNotifs);

    // 9. Live CONSUMER REPORTS Listener
    const unsubReports = onSnapshot(
      collection(db, COLLECTIONS.REPORTS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudReports: ConsumerReport[] = [];
          snapshot.forEach((d) => cloudReports.push(d.data() as ConsumerReport));

          const localRaw = localStorage.getItem(KEYS.REPORTS);
          const localReports: ConsumerReport[] = localRaw ? JSON.parse(localRaw) : [];
          const mergedMap = new Map<string, ConsumerReport>();

          localReports.forEach((lr) => {
            if (lr.id) mergedMap.set(lr.id, lr);
          });
          cloudReports.forEach((cr) => {
            if (!cr.id) return;
            const prev = mergedMap.get(cr.id);
            if (!prev) {
              mergedMap.set(cr.id, cr);
            } else {
              const prevReplies = prev.replies?.length || 0;
              const crReplies = cr.replies?.length || 0;
              const crNewer =
                crReplies > prevReplies ||
                new Date(cr.updatedAt || 0).getTime() >= new Date(prev.updatedAt || 0).getTime();
              mergedMap.set(cr.id, crNewer ? cr : prev);
            }
          });

          localStorage.setItem(KEYS.REPORTS, JSON.stringify(Array.from(mergedMap.values())));
          triggerLocalUpdateEvent(KEYS.REPORTS);
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
      }
    );
    realtimeUnsubscribes.push(unsubReports);
  } catch (err) {
    console.warn('[Firestore Live Sync] Listener init notice:', err);
  }
}

export function stopRealtimeFirestoreListeners() {
  realtimeUnsubscribes.forEach((unsub) => {
    try {
      unsub();
    } catch {}
  });
  realtimeUnsubscribes = [];
}

/**
 * Direct Live Lookup for a User in Firestore (by Email or ID), merging all matching docs
 * so password AND issued linkedAccountNumber are both preserved.
 */
export async function directFindUserInFirestore(emailOrId: string): Promise<User | null> {
  if (isFirestoreQuotaExceeded()) return null;
  const cleanSearch = emailOrId.trim().toLowerCase();
  if (!cleanSearch) return null;

  try {
    const candidates: User[] = [];

    // 1. Check email_... doc ID
    if (cleanSearch.includes('@')) {
      const emailDoc = await getDoc(doc(db, COLLECTIONS.USERS, sanitizeEmailDocId(cleanSearch)));
      if (emailDoc.exists()) candidates.push(emailDoc.data() as User);
    }

    // 2. Check direct doc ID
    const directDoc = await getDoc(doc(db, COLLECTIONS.USERS, sanitizeDocId(cleanSearch)));
    if (directDoc.exists()) candidates.push(directDoc.data() as User);

    // 3. Query by email field (fetch all matching docs to merge user-... and email_...)
    const q = query(collection(db, COLLECTIONS.USERS), where('email', '==', cleanSearch), limit(5));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const u = d.data() as User;
      if (!u.id) u.id = d.id;
      candidates.push(u);
    });

    if (candidates.length === 0) return null;
    return candidates.reduce((acc, item) => mergeUserPair(acc, item));
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      try {
        handleFirestoreError(error, OperationType.GET, COLLECTIONS.USERS);
      } catch {}
    }
    return null;
  }
}

/**
 * Pushes an Admin-issued (or reconciled) Consumer record, linked User activation,
 * and Account Issuance Notification to Cloud Firestore across all lookup keys
 * so every other device immediately receives the confirmed IDs & notification.
 */
export async function pushIssuedConsumerToFirestore(
  consumer: Consumer,
  notification?: ConsumerNotification,
  matchedUser?: Partial<User>
): Promise<void> {
  if (isFirestoreQuotaExceeded()) return;
  if (!isRealIssuedAccountNumber(consumer.accountNumber)) return;

  const accNum = consumer.accountNumber.trim().toUpperCase();
  const meterNum =
    consumer.meterNumber && !consumer.meterNumber.toUpperCase().startsWith('PENDING')
      ? consumer.meterNumber.trim()
      : `MT-${accNum}`;
  const rfidTag =
    consumer.rfidTag && !consumer.rfidTag.toUpperCase().startsWith('PENDING')
      ? consumer.rfidTag.trim()
      : `RFID-${meterNum}`;
  const cleanEmail = (consumer.email || matchedUser?.email || '').trim().toLowerCase();
  const linkedUid = (consumer.linkedUserId || matchedUser?.id || '').trim();

  const normalizedConsumer: Consumer = sanitizeForFirestore({
    ...consumer,
    accountNumber: accNum,
    meterNumber: meterNum,
    rfidTag,
    status: consumer.status === 'pending_approval' ? 'active' : consumer.status || 'active',
    email: cleanEmail || consumer.email || '',
    linkedUserId: linkedUid || consumer.linkedUserId,
    isRegistered: true,
  });

  try {
    // 1. Write authoritative consumer record under Account Number, User ID, and Email doc IDs
    const consumerDocIds = new Set<string>([sanitizeDocId(accNum)]);
    if (linkedUid && !linkedUid.startsWith('email_')) {
      consumerDocIds.add(sanitizeDocId(linkedUid));
    }
    if (cleanEmail) {
      consumerDocIds.add(sanitizeEmailDocId(cleanEmail));
    }

    for (const cDocId of consumerDocIds) {
      if (shouldWritePayload(COLLECTIONS.CONSUMERS, cDocId, normalizedConsumer)) {
        await setDoc(doc(db, COLLECTIONS.CONSUMERS, cDocId), normalizedConsumer, { merge: true });
      }
    }

    // 2. Activate linked User docs in Firestore (preserving password via merge: true)
    const userPatch: Record<string, unknown> = sanitizeForFirestore({
      ...(matchedUser?.id ? { id: matchedUser.id } : linkedUid ? { id: linkedUid } : {}),
      ...(cleanEmail ? { email: cleanEmail } : {}),
      name: consumer.name || matchedUser?.name || 'Consumer',
      role: 'consumer',
      status: 'active',
      linkedAccountNumber: accNum,
      ...(matchedUser?.password ? { password: matchedUser.password } : {}),
    });

    if (linkedUid) {
      const uidDoc = sanitizeDocId(linkedUid);
      if (shouldWritePayload(COLLECTIONS.USERS, uidDoc, userPatch)) {
        await setDoc(doc(db, COLLECTIONS.USERS, uidDoc), userPatch, { merge: true });
      }
    }
    if (cleanEmail) {
      const emailDoc = sanitizeEmailDocId(cleanEmail);
      if (shouldWritePayload(COLLECTIONS.USERS, emailDoc, userPatch)) {
        await setDoc(doc(db, COLLECTIONS.USERS, emailDoc), userPatch, { merge: true });
      }
    }

    // 3. Ensure official Account Issuance Notification exists in Firestore
    const deterministicNotifId = `notif-issued-${accNum.replace(/[^a-zA-Z0-9]/g, '')}`;
    const notifToSync: ConsumerNotification = sanitizeForFirestore(
      notification || {
        id: deterministicNotifId,
        accountNumber: accNum,
        consumerId: consumer.id,
        userId: linkedUid || undefined,
        consumerEmail: cleanEmail || undefined,
        title: 'Official Account Number & Meter Issued!',
        message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${accNum} and Meter Serial is #${meterNum}. Smart RFID Tag: ${rfidTag}. Your full dashboard and telemetry are now active.`,
        timestamp: new Date().toISOString(),
        type: 'account_issue',
        read: false,
      }
    );

    const nDocId = sanitizeDocId(notifToSync.id || deterministicNotifId);
    if (shouldWritePayload(COLLECTIONS.NOTIFICATIONS, nDocId, notifToSync)) {
      await setDoc(doc(db, COLLECTIONS.NOTIFICATIONS, nDocId), notifToSync, { merge: true });
    }
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error);
    } else if (isPermissionDeniedError(error)) {
      try {
        handleFirestoreError(error, OperationType.WRITE, `${COLLECTIONS.CONSUMERS}/${accNum}`);
      } catch {}
    }
  }
}

/**
 * Resolves a Consumer's latest issued IDs, User profile, and Notifications directly
 * from Cloud Firestore so any phone, tablet, or secondary browser reflects Admin ID issuance immediately.
 */
export async function resolveConsumerAccountInFirestore(params: {
  email?: string;
  userId?: string;
  accountNumber?: string;
  name?: string;
  contactNumber?: string;
}): Promise<{
  isIssued: boolean;
  user: User | null;
  consumer: Consumer | null;
  notifications: ConsumerNotification[];
} | null> {
  if (isFirestoreQuotaExceeded()) return null;

  const cleanEmail = (params.email || '').trim().toLowerCase();
  const cleanUid = (params.userId || '').trim();
  const cleanAcc = isRealIssuedAccountNumber(params.accountNumber)
    ? params.accountNumber!.replace(/^#/, '').trim().toUpperCase()
    : '';
  const cleanName = (params.name || '').trim().toLowerCase();
  const cleanPhone = normalizePhone11(params.contactNumber);

  if (!cleanEmail && !cleanUid && !cleanAcc && !cleanName) return null;

  try {
    // 1. Resolve User docs
    let resolvedUser: User | null = null;
    if (cleanEmail) {
      resolvedUser = await directFindUserInFirestore(cleanEmail);
    } else if (cleanUid) {
      resolvedUser = await directFindUserInFirestore(cleanUid);
    }

    const effectiveAcc =
      cleanAcc ||
      (resolvedUser && isRealIssuedAccountNumber(resolvedUser.linkedAccountNumber)
        ? resolvedUser.linkedAccountNumber!.trim().toUpperCase()
        : '');
    const effectiveEmail = cleanEmail || (resolvedUser?.email || '').trim().toLowerCase();
    const effectiveUid = cleanUid || (resolvedUser?.id || '').trim();

    // 2. Collect candidate Consumer docs from Firestore
    const candidates: Consumer[] = [];

    if (effectiveAcc) {
      const accDoc = await getDoc(doc(db, COLLECTIONS.CONSUMERS, sanitizeDocId(effectiveAcc)));
      if (accDoc.exists()) candidates.push(accDoc.data() as Consumer);
      const qAcc = query(collection(db, COLLECTIONS.CONSUMERS), where('accountNumber', '==', effectiveAcc), limit(3));
      const snapAcc = await getDocs(qAcc);
      snapAcc.forEach((d) => candidates.push(d.data() as Consumer));
    }

    if (effectiveEmail) {
      const emailDoc = await getDoc(doc(db, COLLECTIONS.CONSUMERS, sanitizeEmailDocId(effectiveEmail)));
      if (emailDoc.exists()) candidates.push(emailDoc.data() as Consumer);
      const qEmail = query(collection(db, COLLECTIONS.CONSUMERS), where('email', '==', effectiveEmail), limit(5));
      const snapEmail = await getDocs(qEmail);
      snapEmail.forEach((d) => candidates.push(d.data() as Consumer));
    }

    if (effectiveUid) {
      const uidDoc = await getDoc(doc(db, COLLECTIONS.CONSUMERS, sanitizeDocId(effectiveUid)));
      if (uidDoc.exists()) candidates.push(uidDoc.data() as Consumer);
      const qUid = query(collection(db, COLLECTIONS.CONSUMERS), where('linkedUserId', '==', effectiveUid), limit(5));
      const snapUid = await getDocs(qUid);
      snapUid.forEach((d) => candidates.push(d.data() as Consumer));
    }

    if (candidates.length === 0 && (cleanName || cleanPhone)) {
      const allSnap = await getDocs(query(collection(db, COLLECTIONS.CONSUMERS), limit(150)));
      allSnap.forEach((d) => {
        const c = d.data() as Consumer;
        const cEmail = (c.email || '').trim().toLowerCase();
        const cPhone = normalizePhone11(c.contactNumber);
        const cName = (c.name || '').trim().toLowerCase();
        if (cleanPhone && cPhone && cleanPhone === cPhone) {
          candidates.push(c);
        } else if (cleanName && cName === cleanName && (!effectiveEmail || !cEmail || effectiveEmail === cEmail)) {
          candidates.push(c);
        }
      });
    }

    // Also check if resolvedUser had a linkedAccountNumber whose consumer wasn't fetched yet
    for (const cand of [...candidates]) {
      if (isRealIssuedAccountNumber(cand.accountNumber)) {
        const cAcc = cand.accountNumber.trim().toUpperCase();
        if (cAcc !== effectiveAcc) {
          const extraDoc = await getDoc(doc(db, COLLECTIONS.CONSUMERS, sanitizeDocId(cAcc)));
          if (extraDoc.exists()) candidates.push(extraDoc.data() as Consumer);
        }
      }
    }

    let resolvedConsumer: Consumer | null = null;
    if (candidates.length > 0) {
      // Sort active/issued first, then merge all matching candidates
      candidates.sort((a, b) => (isIssuedActiveConsumer(b) ? 1 : 0) - (isIssuedActiveConsumer(a) ? 1 : 0));
      resolvedConsumer = candidates.reduce((acc, item) => mergeConsumerPair(acc, item));
    }

    // If user already had linkedAccountNumber in Firestore but consumer doc only existed as pending, upgrade it!
    if (resolvedConsumer && !isIssuedActiveConsumer(resolvedConsumer) && effectiveAcc) {
      resolvedConsumer = {
        ...resolvedConsumer,
        accountNumber: effectiveAcc,
        meterNumber:
          resolvedConsumer.meterNumber && !resolvedConsumer.meterNumber.toUpperCase().startsWith('PENDING')
            ? resolvedConsumer.meterNumber
            : `MT-${effectiveAcc}`,
        rfidTag:
          resolvedConsumer.rfidTag && !resolvedConsumer.rfidTag.toUpperCase().startsWith('PENDING')
            ? resolvedConsumer.rfidTag
            : `RFID-MT-${effectiveAcc}`,
        status: 'active',
      };
    }

    const isIssued = isIssuedActiveConsumer(resolvedConsumer);
    const finalAcc = isIssued && resolvedConsumer ? resolvedConsumer.accountNumber.trim().toUpperCase() : effectiveAcc;

    // 3. Fetch Notifications for this consumer from Firestore
    const notifMap = new Map<string, ConsumerNotification>();
    const addNotifSnap = (snap: Awaited<ReturnType<typeof getDocs>>) => {
      snap.forEach((d) => {
        const n = d.data() as ConsumerNotification;
        if (n && n.title) {
          notifMap.set(n.id || d.id, { ...n, id: n.id || d.id });
        }
      });
    };

    if (finalAcc) {
      addNotifSnap(
        await getDocs(query(collection(db, COLLECTIONS.NOTIFICATIONS), where('accountNumber', '==', finalAcc), limit(30)))
      );
    }
    if (effectiveEmail) {
      addNotifSnap(
        await getDocs(
          query(collection(db, COLLECTIONS.NOTIFICATIONS), where('consumerEmail', '==', effectiveEmail), limit(30))
        )
      );
    }
    if (effectiveUid) {
      addNotifSnap(
        await getDocs(query(collection(db, COLLECTIONS.NOTIFICATIONS), where('userId', '==', effectiveUid), limit(30)))
      );
    }

    const notifications = Array.from(notifMap.values());

    // 4. Self-heal Firestore if consumer is issued so stale pending twins & missing notifications are fixed permanently
    if (isIssued && resolvedConsumer) {
      const hasIssuanceNotif = notifications.some(
        (n) =>
          n.type === 'account_issue' &&
          !(n.title || '').toLowerCase().includes('registration application submitted')
      );
      if (!hasIssuanceNotif) {
        const backfilled: ConsumerNotification = {
          id: `notif-issued-${finalAcc.replace(/[^a-zA-Z0-9]/g, '')}`,
          accountNumber: finalAcc,
          consumerId: resolvedConsumer.id,
          userId: effectiveUid || resolvedConsumer.linkedUserId,
          consumerEmail: effectiveEmail || resolvedConsumer.email,
          title: 'Official Account Number & Meter Issued!',
          message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${finalAcc} and Meter Serial is #${resolvedConsumer.meterNumber}. Smart RFID Tag: ${resolvedConsumer.rfidTag}. Your full dashboard and telemetry are now active.`,
          timestamp: new Date().toISOString(),
          type: 'account_issue',
          read: false,
        };
        notifications.unshift(backfilled);
        pushIssuedConsumerToFirestore(resolvedConsumer, backfilled, resolvedUser || undefined).catch(() => {});
      } else {
        pushIssuedConsumerToFirestore(resolvedConsumer, undefined, resolvedUser || undefined).catch(() => {});
      }

      if (resolvedUser) {
        resolvedUser = {
          ...resolvedUser,
          linkedAccountNumber: finalAcc,
          status: 'active',
        };
      }
    }

    return {
      isIssued,
      user: resolvedUser,
      consumer: resolvedConsumer,
      notifications,
    };
  } catch (error) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error);
    } else if (isPermissionDeniedError(error)) {
      try {
        handleFirestoreError(error, OperationType.GET, COLLECTIONS.CONSUMERS);
      } catch {}
    }
    return null;
  }
}

/**
 * Checks if a Firestore collection has documents safely
 */
async function isCollectionEmpty(collectionName: string): Promise<boolean> {
  try {
    const q = query(collection(db, collectionName), limit(1));
    const snap = await getDocs(q);
    return snap.empty;
  } catch {
    return false;
  }
}

/**
 * Initializes Firestore with baseline district seed data if not yet seeded
 */
export async function initializeFirestoreSeed(initialData: {
  users: User[];
  consumers: Consumer[];
  readers: MeterReader[];
  meters: WaterMeter[];
  readings: MeterReading[];
  routes: RouteAssignment[];
  announcements: Announcement[];
  barangays: Barangay[];
}) {
  if (isFirestoreQuotaExceeded()) {
    return;
  }

  try {
    setTimeout(async () => {
      if (isFirestoreQuotaExceeded()) {
        return;
      }
      try {
        const usersEmpty = await isCollectionEmpty(COLLECTIONS.USERS);
        if (usersEmpty) {
          const batch = writeBatch(db);

          initialData.users.forEach((u) => {
            batch.set(doc(db, COLLECTIONS.USERS, sanitizeDocId(u.id)), sanitizeForFirestore(u));
          });
          initialData.consumers.forEach((c) => {
            const rawDocId =
              c.accountNumber ||
              c.linkedUserId ||
              (c.email ? sanitizeEmailDocId(c.email) : `consumer-${Date.now()}`);
            batch.set(doc(db, COLLECTIONS.CONSUMERS, sanitizeDocId(rawDocId)), sanitizeForFirestore(c));
          });
          initialData.meters.forEach((m) => {
            batch.set(doc(db, COLLECTIONS.METERS, sanitizeDocId(m.meterNumber)), sanitizeForFirestore(m));
          });
          initialData.readings.forEach((r) => {
            batch.set(doc(db, COLLECTIONS.READINGS, sanitizeDocId(r.id)), sanitizeForFirestore(r));
          });
          initialData.routes.forEach((rt) => {
            batch.set(doc(db, COLLECTIONS.ROUTES, sanitizeDocId(rt.id)), sanitizeForFirestore(rt));
          });
          initialData.announcements.forEach((a) => {
            batch.set(doc(db, COLLECTIONS.ANNOUNCEMENTS, sanitizeDocId(a.id)), sanitizeForFirestore(a));
          });
          initialData.barangays.forEach((b) => {
            batch.set(doc(db, COLLECTIONS.BARANGAYS, sanitizeDocId(b.id)), sanitizeForFirestore(b));
          });

          await batch.commit();
        }

        startRealtimeFirestoreListeners();
      } catch (innerError: any) {
        if (isQuotaError(innerError)) {
          markFirestoreQuotaExceeded(innerError);
        }
        startRealtimeFirestoreListeners();
      }
    }, 300);
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error);
    }
  }
}

/**
 * Asynchronously sync an item to Firestore with payload deduplication
 */
export async function syncDocToFirestore<T extends object>(
  collectionName: string,
  docId: string,
  data: T
): Promise<void> {
  if (!docId || docId.trim() === '') return;
  if (isFirestoreQuotaExceeded()) return;
  const cleanId = sanitizeDocId(docId);
  const cleanData = sanitizeForFirestore(data);
  if (!shouldWritePayload(collectionName, cleanId, cleanData)) return;

  try {
    await setDoc(doc(db, collectionName, cleanId), cleanData, { merge: true });
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error);
    } else if (isPermissionDeniedError(error)) {
      try {
        handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${cleanId}`);
      } catch {}
    }
  }
}

/**
 * Asynchronously batch save changed documents to Firestore
 */
export async function syncBatchToFirestore<T extends object>(
  collectionName: string,
  items: T[],
  idKey: string = 'id'
): Promise<void> {
  if (!items || items.length === 0) return;
  if (isFirestoreQuotaExceeded()) return;
  try {
    const batch = writeBatch(db);
    let count = 0;
    items.forEach((item) => {
      if (count >= 400) return;
      const rec = item as Record<string, unknown>;
      const rawId = rec[idKey];
      const validRawId =
        (typeof rawId === 'string' && rawId.trim() !== '') || typeof rawId === 'number' ? String(rawId) : null;
      const validId = typeof rec.id === 'string' && rec.id.trim() !== '' ? rec.id : null;
      const validLinkedUser =
        typeof rec.linkedUserId === 'string' && rec.linkedUserId.trim() !== '' ? rec.linkedUserId : null;
      const validMeter =
        typeof rec.meterNumber === 'string' && rec.meterNumber.trim() !== '' ? rec.meterNumber : null;
      const validEmail =
        typeof rec.email === 'string' && rec.email.trim() !== '' ? sanitizeEmailDocId(rec.email) : null;
      const validAcc =
        typeof rec.accountNumber === 'string' && rec.accountNumber.trim() !== '' ? rec.accountNumber : null;

      const docId = validRawId || validId || validAcc || validLinkedUser || validMeter || validEmail;
      if (docId && String(docId).trim() !== '') {
        const cleanId = sanitizeDocId(String(docId));
        const cleanItem = sanitizeForFirestore(item);
        if (shouldWritePayload(collectionName, cleanId, cleanItem)) {
          batch.set(doc(db, collectionName, cleanId), cleanItem, { merge: true });
          count++;
        }
      }
    });
    if (count > 0) {
      await batch.commit();
    }
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error);
    } else if (isPermissionDeniedError(error)) {
      try {
        handleFirestoreError(error, OperationType.WRITE, collectionName);
      } catch {}
    }
  }
}

/**
 * Asynchronously delete a document from Firestore
 */
export async function deleteDocFromFirestore(collectionName: string, docId: string): Promise<void> {
  if (!docId || docId.trim() === '') return;
  if (isFirestoreQuotaExceeded()) return;
  const cleanId = sanitizeDocId(docId);
  try {
    syncedPayloadCache.delete(`${collectionName}/${cleanId}`);
    await deleteDoc(doc(db, collectionName, cleanId));
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error);
    } else if (isPermissionDeniedError(error)) {
      try {
        handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${cleanId}`);
      } catch {}
    }
  }
}

/**
 * Permanently and deeply erase an account across all Firestore collections and blacklist
 */
export async function eraseAccountFromFirestore(identifiers: {
  id?: string;
  employeeId?: string;
  username?: string;
  email?: string;
  name?: string;
}): Promise<void> {
  const { id, employeeId, username, email, name } = identifiers;

  addTerminatedAccountKeys([id, employeeId, username, email, name]);

  if (isFirestoreQuotaExceeded()) return;

  const docIdsToPurgeFromUsers = new Set<string>();
  const docIdsToPurgeFromReaders = new Set<string>();

  if (id) {
    docIdsToPurgeFromUsers.add(sanitizeDocId(id));
    docIdsToPurgeFromReaders.add(sanitizeDocId(id));
  }
  if (employeeId) {
    docIdsToPurgeFromUsers.add(sanitizeDocId(employeeId));
    docIdsToPurgeFromReaders.add(sanitizeDocId(employeeId));
  }
  if (username) {
    docIdsToPurgeFromUsers.add(sanitizeDocId(username));
    docIdsToPurgeFromReaders.add(sanitizeDocId(username));
  }
  if (email) {
    const cleanEmail = email.trim().toLowerCase();
    docIdsToPurgeFromUsers.add(sanitizeDocId(cleanEmail));
    docIdsToPurgeFromUsers.add(sanitizeEmailDocId(cleanEmail));
    docIdsToPurgeFromReaders.add(sanitizeDocId(cleanEmail));
  }

  for (const docId of docIdsToPurgeFromUsers) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.USERS, docId));
    } catch {}
  }
  for (const docId of docIdsToPurgeFromReaders) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.READERS, docId));
    } catch {}
  }

  const userQueries = [];
  if (id) userQueries.push(query(collection(db, COLLECTIONS.USERS), where('id', '==', id)));
  if (employeeId) userQueries.push(query(collection(db, COLLECTIONS.USERS), where('employeeId', '==', employeeId)));
  if (email) userQueries.push(query(collection(db, COLLECTIONS.USERS), where('email', '==', email.toLowerCase())));
  if (username) userQueries.push(query(collection(db, COLLECTIONS.USERS), where('username', '==', username)));
  if (name) userQueries.push(query(collection(db, COLLECTIONS.USERS), where('name', '==', name)));

  for (const q of userQueries) {
    try {
      const snap = await getDocs(q);
      snap.forEach(async (d) => {
        try {
          await deleteDoc(d.ref);
        } catch {}
      });
    } catch {}
  }

  const readerQueries = [];
  if (id) readerQueries.push(query(collection(db, COLLECTIONS.READERS), where('id', '==', id)));
  if (employeeId) readerQueries.push(query(collection(db, COLLECTIONS.READERS), where('employeeId', '==', employeeId)));
  if (email) readerQueries.push(query(collection(db, COLLECTIONS.READERS), where('email', '==', email.toLowerCase())));
  if (username) readerQueries.push(query(collection(db, COLLECTIONS.READERS), where('username', '==', username)));
  if (name) readerQueries.push(query(collection(db, COLLECTIONS.READERS), where('name', '==', name)));

  for (const q of readerQueries) {
    try {
      const snap = await getDocs(q);
      snap.forEach(async (d) => {
        try {
          await deleteDoc(d.ref);
        } catch {}
      });
    } catch {}
  }

  try {
    const routesSnap = await getDocs(collection(db, COLLECTIONS.ROUTES));
    routesSnap.forEach(async (d) => {
      const rData = d.data() as RouteAssignment;
      if (
        (id && rData.assignedReaderId === id) ||
        (employeeId && rData.assignedReaderId === employeeId) ||
        (name && rData.assignedReaderName === name)
      ) {
        try {
          await setDoc(
            d.ref,
            {
              ...rData,
              assignedReaderId: '',
              assignedReaderName: '',
              status: 'pending',
            },
            { merge: true }
          );
        } catch {}
      }
    });
  } catch {}
}

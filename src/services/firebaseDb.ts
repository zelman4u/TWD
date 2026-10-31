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
import {
  db,
  auth,
  QUOTA_STORAGE_KEY,
  WRITE_QUOTA_SESSION_KEY,
  READ_QUOTA_SESSION_KEY,
} from '../firebase';
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
  WaterMeterInstallationRequest,
} from '../types';
import { dedupeNotifications } from '../utils/notificationDeduper';
import {
  inferNotificationType,
  isPersonalNotificationType,
  isTransactionalPaymentOrReceiptItem,
  sanitizeAnnouncements,
} from '../utils/announcementSanitizer';
import { isPendingConsumerStatus } from '../utils/installationWorkflow';
import { STANDARD_BARANGAYS } from '../constants';

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
  INSTALLATIONS: 'installation_requests',
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
  INSTALLATIONS: `${STORAGE_PREFIX}installations`,
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

export function normalizeConsumerRecord(c: Consumer): Consumer {
  if (!c) return c;
  if (isRealIssuedAccountNumber(c.accountNumber)) {
    const accNum = String(c.accountNumber).replace(/^#/, '').trim().toUpperCase();
    const meterNum =
      c.meterNumber && !String(c.meterNumber).toUpperCase().startsWith('PENDING')
        ? String(c.meterNumber).trim()
        : `MT-${accNum}`;
    const rawStatus = String(c.status || '');
    const normalizedStatus: Consumer['status'] =
      !rawStatus || isPendingConsumerStatus(rawStatus)
        ? 'active'
        : c.status;
    return {
      ...c,
      accountNumber: accNum,
      meterNumber: meterNum,
      status: normalizedStatus,
      accountValidationStatus: c.accountValidationStatus || 'validated',
      isRegistered: c.isRegistered ?? true,
    };
  }
  return c;
}

export function isIssuedActiveConsumer(c?: Partial<Consumer> | null): boolean {
  if (!c) return false;
  return isRealIssuedAccountNumber(c.accountNumber);
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

const STRING_SCHEMA_KEYS: Record<string, number> = {
  id: 128,
  email: 256,
  name: 200,
  role: 64,
  status: 64,
  linkedAccountNumber: 64,
  password: 256,
  accountNumber: 64,
  address: 500,
  barangay: 128,
  barangayId: 64,
  sitioZone: 200,
  contactNumber: 64,
  meterNumber: 64,
  rfidTag: 64,
  linkedUserId: 128,
  consumerType: 64,
  userId: 128,
  consumerEmail: 256,
  title: 300,
  message: 2900,
  type: 64,
  applicationNumber: 64,
  consumerName: 200,
  preferredInstallationDate: 64,
  confirmedInstallationDate: 64,
  submissionDate: 64,
  adminRemarks: 1200,
  consumerRemarks: 1200,
  completionDate: 64,
  responsiblePersonnel: 200,
  accountValidationStatus: 64,
  assignedAccountNumber: 64,
  assignedMeterTagNumber: 64,
  meterSerialNumber: 64,
  serialNumber: 64,
  installedBy: 200,
};

function sanitizeForFirestore<T>(input: T, keyName?: string): T {
  if (input === null || input === undefined) return input;
  if (keyName && STRING_SCHEMA_KEYS[keyName] !== undefined) {
    return String(input).slice(0, STRING_SCHEMA_KEYS[keyName]) as unknown as T;
  }
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
        out[k] = sanitizeForFirestore(v, k);
      }
    }
    return out as T;
  }
  return input;
}

// Payload hash deduplication cache: ONLY marked AFTER Firestore write/read succeeds
const syncedPayloadCache = new Map<string, string>();

function isPayloadAlreadySynced(collectionName: string, docId: string, payload: unknown): boolean {
  try {
    const cacheKey = `${collectionName}/${docId}`;
    return syncedPayloadCache.get(cacheKey) === JSON.stringify(payload);
  } catch {
    return false;
  }
}

function markPayloadSynced(collectionName: string, docId: string, payload: unknown): void {
  try {
    const cacheKey = `${collectionName}/${docId}`;
    syncedPayloadCache.set(cacheKey, JSON.stringify(payload));
  } catch {}
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
// FIRESTORE QUOTA CIRCUIT BREAKER (SEPARATE WRITE VS READ QUOTA PROTECTION)
// ============================================================================
const SEEDED_STORAGE_KEY = 'twd_fs_seeded_v4';
const DELETED_ANNOUNCEMENTS_KEY = 'twd_live_v4_deleted_announcements';

let memoryWriteQuotaUntil = 0;
let memoryReadQuotaUntil = 0;

try {
  if (typeof window !== 'undefined') {
    [
      'twd_firestore_quota_exceeded',
      'twd_firestore_quota_exceeded_v1',
      'twd_firestore_quota_v2',
      QUOTA_STORAGE_KEY,
    ].forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    const savedWriteUntil = Math.max(
      Number(sessionStorage.getItem(WRITE_QUOTA_SESSION_KEY) || '0'),
      Number(localStorage.getItem(WRITE_QUOTA_SESSION_KEY) || '0')
    );
    if (savedWriteUntil > Date.now()) {
      memoryWriteQuotaUntil = savedWriteUntil;
    }
    const savedReadUntil = Math.max(
      Number(sessionStorage.getItem(READ_QUOTA_SESSION_KEY) || '0'),
      Number(localStorage.getItem(READ_QUOTA_SESSION_KEY) || '0')
    );
    if (savedReadUntil > Date.now()) {
      memoryReadQuotaUntil = savedReadUntil;
    }
    if (memoryWriteQuotaUntil > Date.now() || memoryReadQuotaUntil > Date.now()) {
      disableNetwork(db).catch(() => {});
    } else {
      enableNetwork(db).catch(() => {});
    }
  }
} catch {}

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

export function isFirestoreWriteQuotaExceeded(): boolean {
  if (Date.now() < memoryWriteQuotaUntil) return true;
  if (memoryWriteQuotaUntil !== 0) {
    memoryWriteQuotaUntil = 0;
    try {
      sessionStorage.removeItem(WRITE_QUOTA_SESSION_KEY);
      localStorage.removeItem(WRITE_QUOTA_SESSION_KEY);
    } catch {}
  }
  return false;
}

export function isFirestoreReadQuotaExceeded(): boolean {
  if (Date.now() < memoryReadQuotaUntil) return true;
  if (memoryReadQuotaUntil !== 0) {
    memoryReadQuotaUntil = 0;
    try {
      sessionStorage.removeItem(READ_QUOTA_SESSION_KEY);
      localStorage.removeItem(READ_QUOTA_SESSION_KEY);
    } catch {}
  }
  return false;
}

export function isFirestoreQuotaExceeded(): boolean {
  return isFirestoreWriteQuotaExceeded();
}

export function markFirestoreQuotaExceeded(err?: any, mode: 'write' | 'read' = 'write') {
  const msg = err?.message || String(err || '');
  const isDailyLimit =
    msg.includes('Free daily write units') ||
    msg.includes('Free daily read units') ||
    msg.includes('write stream stalled');
  const cooldownMs = isDailyLimit ? 30 * 60 * 1000 : 2 * 60 * 1000;
  const until = Date.now() + cooldownMs;

  if (mode === 'read' || msg.includes('Free daily read units')) {
    memoryReadQuotaUntil = until;
    try {
      sessionStorage.setItem(READ_QUOTA_SESSION_KEY, String(until));
      localStorage.setItem(READ_QUOTA_SESSION_KEY, String(until));
    } catch {}
  } else {
    memoryWriteQuotaUntil = until;
    try {
      sessionStorage.setItem(WRITE_QUOTA_SESSION_KEY, String(until));
      localStorage.setItem(WRITE_QUOTA_SESSION_KEY, String(until));
    } catch {}
  }

  // Detach active listeners & disable Firestore network transport during quota cooldown so SDK stops exponential backoff retry storms
  stopRealtimeFirestoreListeners();
  disableNetwork(db).catch(() => {});
}

function withWriteTimeout<T>(promise: Promise<T>, timeoutMs = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutErr: any = new Error('Firestore write stream stalled / Free daily write units quota protection');
      timeoutErr.code = 'resource-exhausted';
      reject(timeoutErr);
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function applyUserPasswordOverride(u: User): User {
  try {
    if (typeof window === 'undefined') return u;
    const raw = localStorage.getItem('twd_live_v4_password_overrides');
    if (!raw) return u;
    const ovMap = JSON.parse(raw) || {};
    const keys = [
      u.email ? u.email.trim().toLowerCase() : '',
      u.id ? u.id.trim().toLowerCase() : '',
      u.linkedAccountNumber ? u.linkedAccountNumber.trim().toLowerCase() : '',
    ].filter(Boolean);
    let bestPw = u.password;
    let bestTs = u.passwordUpdatedAt || 0;
    for (const k of keys) {
      const ov = ovMap[k];
      if (ov && ov.password && ov.passwordUpdatedAt >= bestTs) {
        bestPw = ov.password;
        bestTs = ov.passwordUpdatedAt;
      }
    }
    return bestTs > 0 ? { ...u, password: bestPw, passwordUpdatedAt: bestTs } : { ...u, password: bestPw };
  } catch {
    return u;
  }
}

/**
 * Merges two User objects belonging to the same identity, ALWAYS preferring
 * the newer passwordUpdatedAt (and local password override) plus active issued linkedAccountNumber.
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

  const aPwTs = a.passwordUpdatedAt || 0;
  const bPwTs = b.passwordUpdatedAt || 0;
  // Prefer whichever record has a strictly newer passwordUpdatedAt; on tie (both 0), prefer `a` (local state) if it has a password!
  const chooseBPassword = bPwTs > aPwTs || (bPwTs === aPwTs && !a.password && Boolean(b.password));
  const chosenPassword = chooseBPassword ? b.password || a.password : a.password || b.password;
  const chosenPwTs = Math.max(aPwTs, bPwTs);

  return applyUserPasswordOverride({
    ...a,
    ...b,
    id: preferredId,
    email: (b.email || a.email || '').trim(),
    name: b.name || a.name,
    role: a.role === 'admin' || b.role === 'admin' ? 'admin' : b.role || a.role || 'consumer',
    status: preferredStatus,
    linkedAccountNumber: preferredAcc,
    password: chosenPassword,
    ...(chosenPwTs > 0 ? { passwordUpdatedAt: chosenPwTs } : {}),
  });
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

  return {
    ...secondary,
    ...primary,
    accountNumber: mergedAcc,
    meterNumber: mergedMeter,
    status: isRealIssuedAccountNumber(mergedAcc)
      ? isPendingConsumerStatus(primary.status)
        ? 'active'
        : primary.status || 'active'
      : primary.status || secondary.status || 'pending_approval',
    email: primary.email || secondary.email || '',
    linkedUserId: primary.linkedUserId || secondary.linkedUserId,
    contactNumber: primary.contactNumber || secondary.contactNumber || '',
    applicationNumber: primary.applicationNumber || secondary.applicationNumber,
    hasExistingMeter: primary.hasExistingMeter ?? secondary.hasExistingMeter,
    installationRequestId: primary.installationRequestId || secondary.installationRequestId,
    installationStatus: primary.installationStatus || secondary.installationStatus,
    accountValidationStatus: isRealIssuedAccountNumber(mergedAcc)
      ? 'validated'
      : primary.accountValidationStatus || secondary.accountValidationStatus,
    isRegistered: primary.isRegistered ?? secondary.isRegistered ?? true,
  };
}

// Active Firestore Realtime Unsubscribe handles
let realtimeUnsubscribes: Unsubscribe[] = [];

export function ensureRealtimeFirestoreListeners() {
  if (realtimeUnsubscribes.length > 0) return;
  startRealtimeFirestoreListeners();
}

/**
 * Starts live real-time two-way Firestore synchronization across all devices
 */
export function startRealtimeFirestoreListeners() {
  if (isFirestoreReadQuotaExceeded() || isFirestoreWriteQuotaExceeded()) {
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
            if (isRealIssuedAccountNumber(u.linkedAccountNumber) && isPendingConsumerStatus(u.status)) {
              u.status = 'active';
            }
            markPayloadSynced(COLLECTIONS.USERS, d.id, sanitizeForFirestore(u));
            if (!isAccountTerminated(u)) {
              cloudUsers.push(u);
            }
          });

          const localRaw = localStorage.getItem(KEYS.USERS);
          const localUsers: User[] = localRaw ? JSON.parse(localRaw) : [];
          // Only retain local users that aren't stale pending ghosts superseded by cloudUsers
          const activeLocalUsers = localUsers.filter((u) => {
            if (isAccountTerminated(u)) return false;
            if (u.role === 'admin') return true;
            if (!isRealIssuedAccountNumber(u.linkedAccountNumber) && isPendingConsumerStatus(u.status)) {
              const existsInCloud = cloudUsers.some(
                (cu) =>
                  (u.email && cu.email && u.email.toLowerCase() === cu.email.toLowerCase()) ||
                  (u.id && cu.id === u.id)
              );
              return existsInCloud;
            }
            return true;
          });
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
            const rawData = d.data() as Consumer;
            const cData = normalizeConsumerRecord(rawData);
            markPayloadSynced(COLLECTIONS.CONSUMERS, d.id, sanitizeForFirestore(cData));
            if (!isAccountTerminated(cData)) {
              cloudConsumers.push(cData);
            }
          });

          const localUsersRaw = localStorage.getItem(KEYS.USERS);
          const localUsersAll: User[] = localUsersRaw ? JSON.parse(localUsersRaw) : [];

          const localRaw = localStorage.getItem(KEYS.CONSUMERS);
          const localConsumers: Consumer[] = localRaw ? JSON.parse(localRaw) : [];

          // Filter out stale local pending records that no longer exist as pending in Cloud Firestore
          const nowMs = Date.now();
          const activeLocal = localConsumers
            .filter((c) => !isAccountTerminated(c))
            .map((c) => normalizeConsumerRecord(c))
            .filter((lc) => {
              if (isIssuedActiveConsumer(lc)) return true;

              const lcEmail = (lc.email || '').trim().toLowerCase();
              const lcUid = (lc.linkedUserId || '').trim();
              const lcPhone = normalizePhone11(lc.contactNumber);
              const lcName = (lc.name || '').trim().toLowerCase();

              // Drop immediately if Cloud Firestore already has an issued record for this person
              const cloudHasIssued = cloudConsumers.some((cc) => {
                if (!isIssuedActiveConsumer(cc)) return false;
                const ccEmail = (cc.email || '').trim().toLowerCase();
                const ccUid = (cc.linkedUserId || '').trim();
                const ccPhone = normalizePhone11(cc.contactNumber);
                const ccName = (cc.name || '').trim().toLowerCase();
                if (lcEmail && ccEmail && lcEmail === ccEmail) return true;
                if (lcUid && ccUid && lcUid === ccUid) return true;
                if (lcPhone && ccPhone && lcPhone === ccPhone) return true;
                if (lcName && ccName && lcName === ccName && (!lcEmail || !ccEmail || lcEmail === ccEmail)) return true;
                return false;
              });
              if (cloudHasIssued) return false;

              // Keep local pending record ONLY if it still exists as pending in Cloud Firestore OR was just created locally (<45s ago)
              const stillPendingInCloud = cloudConsumers.some((cc) => {
                if (isIssuedActiveConsumer(cc)) return false;
                const ccEmail = (cc.email || '').trim().toLowerCase();
                const ccUid = (cc.linkedUserId || '').trim();
                const ccPhone = normalizePhone11(cc.contactNumber);
                const ccName = (cc.name || '').trim().toLowerCase();
                return (
                  (lcEmail && ccEmail && lcEmail === ccEmail) ||
                  (lcUid && ccUid && lcUid === ccUid) ||
                  (lcPhone && ccPhone && lcPhone === ccPhone) ||
                  (lcName && ccName && lcName === ccName)
                );
              });
              if (stillPendingInCloud) return true;

              const isFreshlyCreatedLocally = Boolean(lc.createdAt && nowMs - lc.createdAt < 45000);
              return isFreshlyCreatedLocally;
            });

          const allList = [...cloudConsumers, ...activeLocal];
          const mergedList: Consumer[] = [];

          for (const rawItem of allList) {
            // Also upgrade unissued consumer if linked User in localUsersAll already has an issued accountNumber
            let c = normalizeConsumerRecord(rawItem);
            if (!isIssuedActiveConsumer(c)) {
              const cEmail = (c.email || '').trim().toLowerCase();
              const cUid = (c.linkedUserId || '').trim();
              const matchedActiveUser = localUsersAll.find(
                (u) =>
                  u.role !== 'admin' &&
                  isRealIssuedAccountNumber(u.linkedAccountNumber) &&
                  ((cEmail && u.email && u.email.trim().toLowerCase() === cEmail) || (cUid && u.id === cUid))
              );
              if (matchedActiveUser && matchedActiveUser.linkedAccountNumber) {
                c = normalizeConsumerRecord({
                  ...c,
                  accountNumber: matchedActiveUser.linkedAccountNumber,
                  status: 'active',
                });
              }
            }

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
              if (cPhone && mPhone && cPhone === mPhone && (!cEmail || !mEmail || cEmail === mEmail)) return true;
              if (
                cName &&
                mName &&
                cName === mName &&
                (!cEmail || !mEmail || cEmail === mEmail) &&
                (!cUid || !mUid || cUid === mUid || !cAcc || !mAcc)
              ) {
                if (!c.barangay || !m.barangay || c.barangay.toLowerCase() === m.barangay.toLowerCase()) {
                  return true;
                }
              }
              return false;
            });

            if (existingIdx === -1) {
              mergedList.push(c);
            } else {
              mergedList[existingIdx] = normalizeConsumerRecord(mergeConsumerPair(mergedList[existingIdx], c));
            }
          }

          // Final strict deduplication: ensure zero unissued pending records survive alongside an issued twin
          const finalMergedConsumers = mergedList.filter((item, _i, arr) => {
            if (isIssuedActiveConsumer(item)) return true;
            const iEmail = (item.email || '').trim().toLowerCase();
            const iUid = (item.linkedUserId || '').trim();
            const iPhone = normalizePhone11(item.contactNumber);
            const iName = (item.name || '').trim().toLowerCase();
            const hasIssuedTwin = arr.some((o) => {
              if (o === item || !isIssuedActiveConsumer(o)) return false;
              const oEmail = (o.email || '').trim().toLowerCase();
              const oUid = (o.linkedUserId || '').trim();
              const oPhone = normalizePhone11(o.contactNumber);
              const oName = (o.name || '').trim().toLowerCase();
              if (iEmail && oEmail && iEmail === oEmail) return true;
              if (iUid && oUid && iUid === oUid) return true;
              if (iPhone && oPhone && iPhone === oPhone) return true;
              if (iName && oName && iName === oName && (!iEmail || !oEmail || iEmail === oEmail)) return true;
              return false;
            });
            return !hasIssuedTwin;
          });

          // Upgrade active session user if their consumer record in finalMergedConsumers is now issued
          try {
            const currentRaw = localStorage.getItem(KEYS.CURRENT_USER);
            if (currentRaw) {
              const currentSession: User = JSON.parse(currentRaw);
              if (currentSession && currentSession.role !== 'admin') {
                const sEmail = (currentSession.email || '').trim().toLowerCase();
                const sUid = (currentSession.id || '').trim();
                const matchedIssuedConsumer = finalMergedConsumers.find(
                  (mc) =>
                    isIssuedActiveConsumer(mc) &&
                    ((sEmail && mc.email && mc.email.trim().toLowerCase() === sEmail) ||
                      (sUid && mc.linkedUserId === sUid))
                );
                if (
                  matchedIssuedConsumer &&
                  (currentSession.linkedAccountNumber !== matchedIssuedConsumer.accountNumber ||
                    currentSession.status !== 'active')
                ) {
                  localStorage.setItem(
                    KEYS.CURRENT_USER,
                    JSON.stringify({
                      ...currentSession,
                      linkedAccountNumber: matchedIssuedConsumer.accountNumber,
                      status: 'active',
                    })
                  );
                }
              }
            }
          } catch {}

          // Auto-heal Cloud Firestore if localStorage has an Admin-issued consumer that still has pending twins in Cloud Firestore
          const localNotifsRaw = localStorage.getItem(KEYS.NOTIFICATIONS);
          const localNotifsAll: ConsumerNotification[] = localNotifsRaw ? JSON.parse(localNotifsRaw) : [];

          finalMergedConsumers.forEach((lc) => {
            if (!isIssuedActiveConsumer(lc)) return;
            const lcAcc = lc.accountNumber.trim().toUpperCase();
            const lcEmail = (lc.email || '').trim().toLowerCase();
            const lcUid = (lc.linkedUserId || '').trim();
            if (!lcEmail && !lcUid && !lcAcc.startsWith('BRG-')) return;

            const cloudHasIssuedAcc = cloudConsumers.some(
              (cc) =>
                isIssuedActiveConsumer(cc) &&
                cc.accountNumber.trim().toUpperCase() === lcAcc &&
                !isPendingConsumerStatus(cc.status)
            );
            const cloudHasStalePendingTwin = snapshot.docs.some((d) => {
              const raw = d.data() as Consumer;
              const isRawPending = !isRealIssuedAccountNumber(raw.accountNumber) || isPendingConsumerStatus(raw.status);
              if (!isRawPending) return false;
              const rEmail = (raw.email || '').trim().toLowerCase();
              const rUid = (raw.linkedUserId || '').trim();
              return (lcUid && rUid === lcUid) || (lcEmail && rEmail === lcEmail) || raw.accountNumber === lcAcc;
            });

            if (!cloudHasIssuedAcc && !isFirestoreWriteQuotaExceeded()) {
              const matchedU = localUsersAll.find(
                (u) =>
                  (lcUid && u.id === lcUid) ||
                  (lcEmail && (u.email || '').trim().toLowerCase() === lcEmail) ||
                  u.linkedAccountNumber === lcAcc
              );
              const matchedN = localNotifsAll.find(
                (n) =>
                  n.type === 'account_issue' &&
                  !(n.title || '').toLowerCase().includes('registration application submitted') &&
                  ((n.accountNumber || '').toUpperCase() === lcAcc ||
                    (lcEmail && (n.consumerEmail || '').trim().toLowerCase() === lcEmail))
              );
              pushIssuedConsumerToFirestore(lc, matchedN, matchedU, false).catch(() => {});
            }
          });

          localStorage.setItem(KEYS.CONSUMERS, JSON.stringify(finalMergedConsumers));
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
              const isPaid = lr.paymentStatus === 'paid' || cr.paymentStatus === 'paid';
              const isPartial = !isPaid && (lr.paymentStatus === 'partial' || cr.paymentStatus === 'partial');
              const lrBilled = Boolean(lr.isBillingIssued || lr.billingIssuedAt || lr.invoiceNumber || lr.paymentStatus === 'paid' || lr.paymentStatus === 'partial');
              const crBilled = Boolean(cr.isBillingIssued || cr.billingIssuedAt || cr.invoiceNumber || cr.paymentStatus === 'paid' || cr.paymentStatus === 'partial');
              const mergedBillingIssued =
                lrBilled || crBilled
                  ? true
                  : typeof lr.isBillingIssued === 'boolean'
                    ? lr.isBillingIssued
                    : cr.isBillingIssued;
              const isLocalMoreAdvanced =
                ((lrStatusStr === 'verified' || lrStatusStr === 'approved') &&
                  (crStatusStr === 'pending' || crStatusStr === 'pending_approval')) ||
                (lrBilled && !crBilled) ||
                (lr.paymentStatus === 'paid' && cr.paymentStatus !== 'paid') ||
                (lr.paymentStatus === 'partial' && cr.paymentStatus === 'unpaid') ||
                (lr.paidAmount || 0) > (cr.paidAmount || 0);
              const base = isLocalMoreAdvanced ? { ...cr, ...lr } : { ...lr, ...cr };
              const billedSrc = crBilled && !isLocalMoreAdvanced ? cr : lrBilled ? lr : cr;
              const altSrc = billedSrc === cr ? lr : cr;
              const maxPaid = Math.max(Number(lr.paidAmount || 0), Number(cr.paidAmount || 0));
              const effBillAmt = Number(billedSrc.billAmount || altSrc.billAmount || 0) || base.billAmount;
              const effTotalAmt = Number(billedSrc.totalAmount || altSrc.totalAmount || effBillAmt || 0) || base.totalAmount;
              mergedMap.set(lr.id, {
                ...base,
                ...(typeof mergedBillingIssued === 'boolean' ? { isBillingIssued: mergedBillingIssued } : {}),
                status:
                  lrStatusStr === 'cancelled' || crStatusStr === 'cancelled'
                    ? 'cancelled'
                    : mergedBillingIssued || lrStatusStr === 'verified' || crStatusStr === 'verified'
                      ? 'verified'
                      : base.status,
                paymentStatus: isPaid ? 'paid' : isPartial ? 'partial' : base.paymentStatus,
                billingIssuedAt: lr.billingIssuedAt || cr.billingIssuedAt,
                billingIssuedBy: lr.billingIssuedBy || cr.billingIssuedBy,
                invoiceNumber: lr.invoiceNumber || cr.invoiceNumber,
                dueDate: billedSrc.dueDate || altSrc.dueDate,
                billAmount: effBillAmt,
                totalAmount: effTotalAmt,
                orNumber: lr.orNumber || cr.orNumber,
                paymentDate: lr.paymentDate || cr.paymentDate,
                paymentMethod: lr.paymentMethod || cr.paymentMethod,
                cashierName: lr.cashierName || cr.cashierName,
                transactionId: lr.transactionId || cr.transactionId,
                paidAmount: maxPaid > 0 ? maxPaid : base.paidAmount,
                remainingBalance: isPaid
                  ? 0
                  : isPartial
                    ? Math.max(0, Number(effTotalAmt || effBillAmt || 0) - maxPaid)
                    : (typeof billedSrc.remainingBalance === 'number' ? billedSrc.remainingBalance : base.remainingBalance),
              });
            }
          });

          const finalReadings = Array.from(mergedMap.values());
          const nextJson = JSON.stringify(finalReadings);
          const prevJson = localStorage.getItem(KEYS.READINGS) || '';
          if (prevJson !== nextJson) {
            localStorage.setItem(KEYS.READINGS, nextJson);
            triggerLocalUpdateEvent(KEYS.READINGS);
          }
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
      }
    );
    realtimeUnsubscribes.push(unsubReadings);

    // 6. Live ANNOUNCEMENTS Listener (merges cloud + local without wiping newly published local advisories)
    const unsubAnnouncements = onSnapshot(
      collection(db, COLLECTIONS.ANNOUNCEMENTS),
      (snapshot) => {
        if (!snapshot.empty) {
          let deletedIds = new Set<string>();
          try {
            const rawDel = localStorage.getItem(DELETED_ANNOUNCEMENTS_KEY);
            if (rawDel) deletedIds = new Set(JSON.parse(rawDel));
          } catch {}

          const cloudAnns: Announcement[] = [];
          snapshot.forEach((d) => {
            const a = d.data() as Announcement;
            const id = a.id || d.id;
            if (isTransactionalPaymentOrReceiptItem(a as unknown as Record<string, unknown>)) {
              if (!isFirestoreWriteQuotaExceeded()) {
                deleteDoc(d.ref).catch(() => {});
              }
              return;
            }
            if (id && !deletedIds.has(id)) {
              cloudAnns.push({ ...a, id });
            }
          });

          const localRaw = localStorage.getItem(KEYS.ANNOUNCEMENTS);
          const localAnns: Announcement[] = sanitizeAnnouncements(localRaw ? JSON.parse(localRaw) : []);
          const mergedMap = new Map<string, Announcement>();

          localAnns.forEach((la) => {
            if (la?.id && !deletedIds.has(la.id)) mergedMap.set(la.id, la);
          });
          cloudAnns.forEach((ca) => {
            if (ca?.id && !deletedIds.has(ca.id)) {
              const prev = mergedMap.get(ca.id);
              mergedMap.set(ca.id, prev ? { ...prev, ...ca } : ca);
            }
          });

          const finalAnns = sanitizeAnnouncements(
            Array.from(mergedMap.values()).sort(
              (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
            )
          );
          const nextJson = JSON.stringify(finalAnns);
          if (localRaw !== nextJson) {
            localStorage.setItem(KEYS.ANNOUNCEMENTS, nextJson);
            triggerLocalUpdateEvent(KEYS.ANNOUNCEMENTS);
          }
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err, 'read');
      }
    );
    realtimeUnsubscribes.push(unsubAnnouncements);

    // 7. Live BARANGAYS Listener (auto-heals newly added standard barangays like Rosario into cloud & local)
    const unsubBarangays = onSnapshot(
      collection(db, COLLECTIONS.BARANGAYS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudBrgs: Barangay[] = [];
          snapshot.forEach((d) => cloudBrgs.push(d.data() as Barangay));

          let deletedBrgIds = new Set<string>();
          try {
            const rawDel = localStorage.getItem('twd_live_v4_deleted_barangays');
            if (rawDel) deletedBrgIds = new Set(JSON.parse(rawDel));
          } catch {}

          const defaultSchedules: Record<string, string> = {
            'BRG-01': '1st - 5th of Month',
            'BRG-02': '6th - 10th of Month',
            'BRG-03': '11th - 15th of Month',
            'BRG-04': '16th - 20th of Month',
            'BRG-05': '21st - 25th of Month',
            'BRG-06': '26th - End of Month',
            'BRG-07': '1st - 5th of Month',
            'BRG-08': '6th - 10th of Month',
            'BRG-09': '11th - 15th of Month',
            'BRG-10': '16th - 20th of Month',
          };

          STANDARD_BARANGAYS.forEach((sb) => {
            if (deletedBrgIds.has(sb.id)) return;
            const exists = cloudBrgs.some(
              (b) =>
                (b.id && b.id.toLowerCase() === sb.id.toLowerCase()) ||
                (b.name && b.name.trim().toLowerCase() === sb.name.trim().toLowerCase())
            );
            if (!exists) {
              const missingBrg: Barangay = {
                id: sb.id,
                name: sb.name,
                code: sb.code,
                consumers: 0,
                activeMeters: 0,
                schedule: defaultSchedules[sb.id] || '16th - 20th of Month',
                supervisor: 'District Operations Supervisor',
                ratePerM3: sb.ratePerM3,
              };
              cloudBrgs.push(missingBrg);
              syncDocToFirestore(COLLECTIONS.BARANGAYS, sb.id, missingBrg).catch(() => {});
            }
          });

          cloudBrgs.sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true }));

          const prevRaw = localStorage.getItem(KEYS.BARANGAYS);
          const nextJson = JSON.stringify(cloudBrgs);
          if (prevRaw !== nextJson) {
            localStorage.setItem(KEYS.BARANGAYS, nextJson);
            triggerLocalUpdateEvent(KEYS.BARANGAYS);
          }
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err);
      }
    );
    realtimeUnsubscribes.push(unsubBarangays);

    // 8. Live NOTIFICATIONS Listener (merges & deduplicates cloud + local without loop triggers)
    const unsubNotifs = onSnapshot(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudNotifs: ConsumerNotification[] = [];
          snapshot.forEach((d) => cloudNotifs.push(d.data() as ConsumerNotification));

          const localRaw = localStorage.getItem(KEYS.NOTIFICATIONS);
          const localNotifs: ConsumerNotification[] = localRaw ? JSON.parse(localRaw) : [];
          const finalNotifs = dedupeNotifications([...localNotifs, ...cloudNotifs]);
          const nextJson = JSON.stringify(finalNotifs);
          if (localRaw !== nextJson) {
            localStorage.setItem(KEYS.NOTIFICATIONS, nextJson);
            triggerLocalUpdateEvent(KEYS.NOTIFICATIONS);
          }
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

    // 9. Live CONSUMER REPORTS Listener (merges replies without overwriting newer local/API replies)
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
            if (lr && lr.id) mergedMap.set(lr.id, lr);
          });
          cloudReports.forEach((cr) => {
            if (!cr || (!cr.id && !cr.ticketNumber)) return;
            let key = cr.id && mergedMap.has(cr.id) ? cr.id : undefined;
            if (!key && cr.ticketNumber) {
              const found = Array.from(mergedMap.entries()).find(([, v]) => v.ticketNumber === cr.ticketNumber);
              if (found) key = found[0];
            }
            if (!key) {
              const newKey = cr.id || cr.ticketNumber;
              mergedMap.set(newKey, { ...cr, id: newKey, replies: Array.isArray(cr.replies) ? cr.replies : [] });
            } else {
              const prev = mergedMap.get(key)!;
              const combined = [...(prev.replies || []), ...(cr.replies || [])]
                .filter(Boolean)
                .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
              const mergedReplies: any[] = [];
              const seenIds = new Set<string>();
              let hasAck = false;
              for (const rep of combined) {
                const rid = (rep.id || '').trim();
                if (rid && seenIds.has(rid)) continue;
                const isAck =
                  rid.startsWith('ACK-') ||
                  rep.senderId === 'system-admin-ack' ||
                  (rep.senderRole === 'admin' &&
                    (rep.message || '').toLowerCase().includes('successfully delivered to the tagoloan water district'));
                if (isAck) {
                  if (hasAck) continue;
                  hasAck = true;
                  if (rid) seenIds.add(rid);
                  mergedReplies.push(rep);
                  continue;
                }
                const normMsg = (rep.message || '').trim().replace(/\s+/g, ' ').toLowerCase();
                const repTime = new Date(rep.timestamp || 0).getTime();
                const isDup = mergedReplies.some((ex) => {
                  if (ex.senderRole !== rep.senderRole) return false;
                  const exMsg = (ex.message || '').trim().replace(/\s+/g, ' ').toLowerCase();
                  if (exMsg !== normMsg) return false;
                  return Math.abs(repTime - new Date(ex.timestamp || 0).getTime()) <= 5 * 60 * 1000;
                });
                if (!isDup) {
                  if (rid) seenIds.add(rid);
                  mergedReplies.push(rep);
                }
              }
              const crNewer = new Date(cr.updatedAt || 0).getTime() >= new Date(prev.updatedAt || 0).getTime();
              const primary = crNewer ? cr : prev;
              const secondary = crNewer ? prev : cr;
              mergedMap.set(key, {
                ...secondary,
                ...primary,
                id: key,
                replies: mergedReplies,
              });
            }
          });

          const nextJson = JSON.stringify(Array.from(mergedMap.values()));
          if (localRaw !== nextJson) {
            localStorage.setItem(KEYS.REPORTS, nextJson);
            triggerLocalUpdateEvent(KEYS.REPORTS);
          }
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err, 'read');
      }
    );
    realtimeUnsubscribes.push(unsubReports);

    // 10. Live TARIFF CONFIG Listener (propagates Admin rate adjustments automatically to all Consumer devices)
    const unsubTariff = onSnapshot(
      doc(db, COLLECTIONS.SETTINGS, 'tariff_config'),
      (snap) => {
        if (snap.exists()) {
          const cloudCfg = snap.data() as Record<string, any>;
          if (cloudCfg && cloudCfg.residential && cloudCfg.commercial) {
            try {
              const localRaw = localStorage.getItem(KEYS.TARIFF_CONFIG);
              const localCfg = localRaw ? JSON.parse(localRaw) : null;
              const cloudVer = Number(cloudCfg.version || 1);
              const localVer = Number(localCfg?.version || 0);
              const cloudTime = new Date(cloudCfg.updatedAt || 0).getTime();
              const localTime = new Date(localCfg?.updatedAt || 0).getTime();
              if (!localCfg || cloudVer > localVer || (cloudVer === localVer && cloudTime > localTime)) {
                const nextJson = JSON.stringify(cloudCfg);
                if (localRaw !== nextJson) {
                  localStorage.setItem(KEYS.TARIFF_CONFIG, nextJson);
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('twd_tariff_updated', { detail: cloudCfg }));
                  }
                  triggerLocalUpdateEvent(KEYS.TARIFF_CONFIG);
                }
              }
            } catch {}
          }
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err, 'read');
      }
    );
    realtimeUnsubscribes.push(unsubTariff);

    // 11. Live INSTALLATION REQUESTS Listener (propagates new installation scheduling & Admin validations live)
    const unsubInstallations = onSnapshot(
      collection(db, COLLECTIONS.INSTALLATIONS),
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudReqs: WaterMeterInstallationRequest[] = [];
          snapshot.forEach((d) => {
            const item = d.data() as WaterMeterInstallationRequest;
            if (item && (item.id || d.id)) {
              cloudReqs.push({ ...item, id: item.id || d.id });
            }
          });

          const localRaw = localStorage.getItem(KEYS.INSTALLATIONS);
          const localReqs: WaterMeterInstallationRequest[] = localRaw ? JSON.parse(localRaw) : [];
          const mergedMap = new Map<string, WaterMeterInstallationRequest>();

          localReqs.forEach((lr) => {
            if (lr && lr.id) mergedMap.set(lr.id, lr);
          });

          cloudReqs.forEach((cr) => {
            if (!cr || (!cr.id && !cr.applicationNumber)) return;
            let key = cr.id && mergedMap.has(cr.id) ? cr.id : undefined;
            if (!key && cr.applicationNumber) {
              const found = Array.from(mergedMap.entries()).find(([, v]) => v.applicationNumber === cr.applicationNumber);
              if (found) key = found[0];
            }
            if (!key) {
              const newKey = cr.id || cr.applicationNumber;
              mergedMap.set(newKey, { ...cr, id: newKey, history: Array.isArray(cr.history) ? cr.history : [] });
            } else {
              const prev = mergedMap.get(key)!;
              const crNewer = new Date(cr.updatedAt || 0).getTime() >= new Date(prev.updatedAt || 0).getTime();
              const primary = crNewer ? cr : prev;
              const secondary = crNewer ? prev : cr;
              const histMap = new Map<string, any>();
              [...(prev.history || []), ...(cr.history || [])].forEach((h) => {
                if (h && h.id) histMap.set(h.id, h);
              });
              const mergedHistory = Array.from(histMap.values()).sort(
                (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
              );
              mergedMap.set(key, {
                ...secondary,
                ...primary,
                id: key,
                meterSerialNumber: primary.meterSerialNumber || secondary.meterSerialNumber,
                assignedAccountNumber: primary.assignedAccountNumber || secondary.assignedAccountNumber,
                assignedMeterTagNumber: primary.assignedMeterTagNumber || secondary.assignedMeterTagNumber,
                history: mergedHistory,
              });
            }
          });

          const sorted = Array.from(mergedMap.values()).sort(
            (a, b) => new Date(b.submissionDate || 0).getTime() - new Date(a.submissionDate || 0).getTime()
          );
          const nextJson = JSON.stringify(sorted);
          if (localRaw !== nextJson) {
            localStorage.setItem(KEYS.INSTALLATIONS, nextJson);
            triggerLocalUpdateEvent(KEYS.INSTALLATIONS);
          }
        }
      },
      (err) => {
        if (isQuotaError(err)) markFirestoreQuotaExceeded(err, 'read');
      }
    );
    realtimeUnsubscribes.push(unsubInstallations);
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
  if (isFirestoreReadQuotaExceeded() || isFirestoreWriteQuotaExceeded()) return null;
  const rawInput = emailOrId.trim();
  const cleanSearch = rawInput.toLowerCase();
  if (!cleanSearch) return null;

  try {
    const candidates: User[] = [];

    // 1. Check email_... doc ID
    if (cleanSearch.includes('@')) {
      const emailDoc = await getDoc(doc(db, COLLECTIONS.USERS, sanitizeEmailDocId(cleanSearch)));
      if (emailDoc.exists()) candidates.push(emailDoc.data() as User);
    }

    // 2. Check direct doc ID
    const directDoc = await getDoc(doc(db, COLLECTIONS.USERS, sanitizeDocId(rawInput)));
    if (directDoc.exists()) candidates.push(directDoc.data() as User);

    // 3. Query by email field (lowercase + raw casing if different)
    const q = query(collection(db, COLLECTIONS.USERS), where('email', '==', cleanSearch), limit(5));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const u = d.data() as User;
      if (!u.id) u.id = d.id;
      candidates.push(u);
    });

    if (rawInput.includes('@') && rawInput !== cleanSearch) {
      const qRaw = query(collection(db, COLLECTIONS.USERS), where('email', '==', rawInput), limit(5));
      const snapRaw = await getDocs(qRaw);
      snapRaw.forEach((d) => {
        const u = d.data() as User;
        if (!u.id) u.id = d.id;
        candidates.push(u);
      });
    }

    // 4. Case-insensitive fallback scan across users if still empty
    if (candidates.length === 0 && cleanSearch.includes('@')) {
      const allUsersSnap = await getDocs(query(collection(db, COLLECTIONS.USERS), limit(250)));
      allUsersSnap.forEach((d) => {
        const u = d.data() as User;
        if ((u.email || '').trim().toLowerCase() === cleanSearch) {
          if (!u.id) u.id = d.id;
          candidates.push(u);
        }
      });
    }

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
  matchedUser?: Partial<User>,
  force: boolean = false,
  previousAccountNumber?: string
): Promise<void> {
  if (isFirestoreWriteQuotaExceeded()) return;
  if (!isRealIssuedAccountNumber(consumer.accountNumber)) return;

  const accNum = consumer.accountNumber.replace(/^#/, '').trim().toUpperCase();
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
  const cleanPhone = normalizePhone11(consumer.contactNumber);
  const cleanName = (consumer.name || matchedUser?.name || '').trim().toLowerCase();
  const cleanPrevAcc = (previousAccountNumber || '').replace(/^#/, '').trim().toUpperCase();

  const normalizedConsumer: Consumer = sanitizeForFirestore({
    ...consumer,
    accountNumber: accNum,
    meterNumber: meterNum,
    rfidTag,
    status:
      !consumer.status || isPendingConsumerStatus(consumer.status)
        ? 'active'
        : consumer.status,
    accountValidationStatus: 'validated',
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
      if (force || !isPayloadAlreadySynced(COLLECTIONS.CONSUMERS, cDocId, normalizedConsumer)) {
        await withWriteTimeout(setDoc(doc(db, COLLECTIONS.CONSUMERS, cDocId), normalizedConsumer, { merge: true }));
        markPayloadSynced(COLLECTIONS.CONSUMERS, cDocId, normalizedConsumer);
      }
    }

    // 1b. Purge any stale pending or previousAccountNumber duplicate docs in Firestore `consumers`
    if (cleanPrevAcc && cleanPrevAcc !== accNum) {
      const prevDocId = sanitizeDocId(cleanPrevAcc);
      if (!consumerDocIds.has(prevDocId)) {
        syncedPayloadCache.delete(`${COLLECTIONS.CONSUMERS}/${prevDocId}`);
        await deleteDoc(doc(db, COLLECTIONS.CONSUMERS, prevDocId)).catch(() => {});
      }
    }

    const twinCleanupQueries = [];
    if (cleanEmail) {
      twinCleanupQueries.push(query(collection(db, COLLECTIONS.CONSUMERS), where('email', '==', cleanEmail), limit(15)));
    }
    if (linkedUid) {
      twinCleanupQueries.push(
        query(collection(db, COLLECTIONS.CONSUMERS), where('linkedUserId', '==', linkedUid), limit(15))
      );
    }

    for (const tq of twinCleanupQueries) {
      try {
        const snap = await getDocs(tq);
        for (const d of snap.docs) {
          if (consumerDocIds.has(d.id)) continue;
          const dData = d.data() as Consumer;
          const dAcc = (dData.accountNumber || '').trim().toUpperCase();
          const isStaleOrPending =
            !isRealIssuedAccountNumber(dAcc) ||
            isPendingConsumerStatus(dData.status) ||
            (cleanPrevAcc && dAcc === cleanPrevAcc) ||
            d.id.startsWith('user-') ||
            d.id.startsWith('email_');
          if (isStaleOrPending) {
            syncedPayloadCache.delete(`${COLLECTIONS.CONSUMERS}/${d.id}`);
            await deleteDoc(d.ref).catch(() => {});
          }
        }
      } catch {}
    }

    // When force === true (explicit Admin ID issuance or auto-heal), also purge any case-insensitive / phone / name pending twins
    if (force && (cleanEmail || cleanPhone || cleanName)) {
      try {
        const allConsSnap = await getDocs(query(collection(db, COLLECTIONS.CONSUMERS), limit(300)));
        for (const d of allConsSnap.docs) {
          if (consumerDocIds.has(d.id)) continue;
          const dData = d.data() as Consumer;
          const dAcc = (dData.accountNumber || '').trim().toUpperCase();
          const dIsPending = !isRealIssuedAccountNumber(dAcc) || isPendingConsumerStatus(dData.status);
          if (!dIsPending) continue;

          const dEmail = (dData.email || '').trim().toLowerCase();
          const dUid = (dData.linkedUserId || '').trim();
          const dPhone = normalizePhone11(dData.contactNumber);
          const dName = (dData.name || '').trim().toLowerCase();

          const sameApplicant =
            (cleanEmail && dEmail && cleanEmail === dEmail) ||
            (linkedUid && dUid && linkedUid === dUid) ||
            (cleanPhone && dPhone && cleanPhone === dPhone && (!cleanEmail || !dEmail || cleanEmail === dEmail)) ||
            (cleanName &&
              dName &&
              cleanName === dName &&
              (!cleanEmail || !dEmail || cleanEmail === dEmail) &&
              (!consumer.barangay || !dData.barangay || consumer.barangay.toLowerCase() === dData.barangay.toLowerCase()));

          if (sameApplicant) {
            if (dAcc === accNum) {
              await setDoc(d.ref, normalizedConsumer, { merge: true }).catch(() => {});
            } else {
              syncedPayloadCache.delete(`${COLLECTIONS.CONSUMERS}/${d.id}`);
              await deleteDoc(d.ref).catch(() => {});
            }
          }
        }
      } catch {}
    }

    // 2. Activate ALL matching User docs in Firestore (preserving password via merge: true)
    const userPatch: Record<string, unknown> = sanitizeForFirestore({
      ...(matchedUser?.id ? { id: matchedUser.id } : linkedUid ? { id: linkedUid } : {}),
      ...(cleanEmail ? { email: cleanEmail } : {}),
      name: consumer.name || matchedUser?.name || 'Consumer',
      role: 'consumer',
      status: 'active',
      linkedAccountNumber: accNum,
      ...(matchedUser?.password ? { password: matchedUser.password } : {}),
    });

    if (linkedUid && !linkedUid.startsWith('email_')) {
      const uidDoc = sanitizeDocId(linkedUid);
      if (force || !isPayloadAlreadySynced(COLLECTIONS.USERS, uidDoc, userPatch)) {
        await withWriteTimeout(setDoc(doc(db, COLLECTIONS.USERS, uidDoc), userPatch, { merge: true }));
        markPayloadSynced(COLLECTIONS.USERS, uidDoc, userPatch);
      }
    }
    if (cleanEmail) {
      const emailDoc = sanitizeEmailDocId(cleanEmail);
      if (force || !isPayloadAlreadySynced(COLLECTIONS.USERS, emailDoc, userPatch)) {
        await withWriteTimeout(setDoc(doc(db, COLLECTIONS.USERS, emailDoc), userPatch, { merge: true }));
        markPayloadSynced(COLLECTIONS.USERS, emailDoc, userPatch);
      }
      // Also update any additional user-* documents sharing this email so every device session gets activated
      if (force) {
        try {
          const uSnap = await getDocs(query(collection(db, COLLECTIONS.USERS), where('email', '==', cleanEmail), limit(10)));
          for (const ud of uSnap.docs) {
            const uData = ud.data() as User;
            if (uData.role === 'admin') continue;
            if (uData.linkedAccountNumber !== accNum || uData.status !== 'active') {
              await setDoc(
                ud.ref,
                sanitizeForFirestore({
                  status: 'active',
                  linkedAccountNumber: accNum,
                }),
                { merge: true }
              ).catch(() => {});
            }
          }
        } catch {}
      }
    }

    // 3. Ensure official Account Issuance Notification exists in Firestore (deterministic timestamp for payload dedupe)
    const deterministicNotifId = `notif-issued-${accNum.replace(/[^a-zA-Z0-9]/g, '')}`;
    const stableIssuedTimestamp = consumer.registrationDate
      ? `${consumer.registrationDate.split('T')[0]}T00:00:00.000Z`
      : '2026-01-01T00:00:00.000Z';
    const notifToSync: ConsumerNotification = sanitizeForFirestore(
      notification
        ? {
            ...notification,
            consumerEmail: notification.consumerEmail
              ? notification.consumerEmail.trim().toLowerCase()
              : cleanEmail || undefined,
          }
        : {
            id: deterministicNotifId,
            accountNumber: accNum,
            consumerId: consumer.id,
            userId: linkedUid || undefined,
            consumerEmail: cleanEmail || undefined,
            title: 'Official Account Number & Meter Issued!',
            message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${accNum} and Meter Tag Number is #${meterNum}. Smart RFID Tag: ${rfidTag}. Your full dashboard and telemetry are now active.`,
            timestamp: stableIssuedTimestamp,
            type: 'account_issue',
            read: false,
          }
    );

    const nDocId = sanitizeDocId(notifToSync.id || deterministicNotifId);
    if (force || !isPayloadAlreadySynced(COLLECTIONS.NOTIFICATIONS, nDocId, notifToSync)) {
      await withWriteTimeout(setDoc(doc(db, COLLECTIONS.NOTIFICATIONS, nDocId), notifToSync, { merge: true }));
      markPayloadSynced(COLLECTIONS.NOTIFICATIONS, nDocId, notifToSync);
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
  const rawEmail = (params.email || '').trim();
  const cleanEmail = rawEmail.toLowerCase();
  const cleanUid = (params.userId || '').trim();
  const cleanAcc = isRealIssuedAccountNumber(params.accountNumber)
    ? params.accountNumber!.replace(/^#/, '').trim().toUpperCase()
    : '';
  const cleanName = (params.name || '').trim().toLowerCase();
  const cleanPhone = normalizePhone11(params.contactNumber);

  if (!cleanEmail && !cleanUid && !cleanAcc && !cleanName) return null;
  if (isFirestoreReadQuotaExceeded() || isFirestoreWriteQuotaExceeded()) return null;

  try {
    // 1. Resolve User docs
    let resolvedUser: User | null = null;
    if (rawEmail) {
      resolvedUser = await directFindUserInFirestore(rawEmail);
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
      if (rawEmail && rawEmail !== effectiveEmail) {
        const qRawEmail = query(collection(db, COLLECTIONS.CONSUMERS), where('email', '==', rawEmail), limit(5));
        const snapRawEmail = await getDocs(qRawEmail);
        snapRawEmail.forEach((d) => candidates.push(d.data() as Consumer));
      }
    }

    if (effectiveUid) {
      const uidDoc = await getDoc(doc(db, COLLECTIONS.CONSUMERS, sanitizeDocId(effectiveUid)));
      if (uidDoc.exists()) candidates.push(uidDoc.data() as Consumer);
      const qUid = query(collection(db, COLLECTIONS.CONSUMERS), where('linkedUserId', '==', effectiveUid), limit(5));
      const snapUid = await getDocs(qUid);
      snapUid.forEach((d) => candidates.push(d.data() as Consumer));
    }

    // Case-insensitive scan across consumers if no active issued candidate found yet (handles mixed-case emails & name/phone links)
    const foundIssuedAlready = candidates.some((c) => isIssuedActiveConsumer(c));
    if (!foundIssuedAlready && (effectiveEmail || cleanName || cleanPhone || effectiveUid)) {
      const allSnap = await getDocs(query(collection(db, COLLECTIONS.CONSUMERS), limit(300)));
      allSnap.forEach((d) => {
        const c = d.data() as Consumer;
        const cEmail = (c.email || '').trim().toLowerCase();
        const cPhone = normalizePhone11(c.contactNumber);
        const cName = (c.name || '').trim().toLowerCase();
        if (effectiveEmail && cEmail && cEmail === effectiveEmail) {
          candidates.push(c);
        } else if (effectiveUid && c.linkedUserId && c.linkedUserId === effectiveUid) {
          candidates.push(c);
        } else if (cleanPhone && cPhone && cleanPhone === cPhone) {
          candidates.push(c);
        } else if (cleanName && cName === cleanName && (!effectiveEmail || !cEmail || effectiveEmail === cEmail)) {
          candidates.push(c);
        }
      });
    }

    // Also fetch any referenced issued account doc
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

    // Synthesize User profile if Consumer exists in Firestore `consumers` while `users` doc was missing
    if (!resolvedUser && resolvedConsumer && (effectiveEmail || resolvedConsumer.email || resolvedConsumer.linkedUserId)) {
      const pendingStatus: User['status'] =
        resolvedConsumer.status === 'pending_installation' || resolvedConsumer.status === 'installation_not_scheduled'
          ? resolvedConsumer.status
          : 'pending_approval';
      resolvedUser = {
        id: resolvedConsumer.linkedUserId || effectiveUid || `user-${Date.now()}`,
        email: (resolvedConsumer.email || effectiveEmail || '').trim().toLowerCase(),
        name: resolvedConsumer.name,
        role: 'consumer',
        status: isIssued ? 'active' : pendingStatus,
        linkedAccountNumber: isIssued ? finalAcc : undefined,
        registrationDate: resolvedConsumer.registrationDate,
      };
    }

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
      if (rawEmail && rawEmail !== effectiveEmail) {
        addNotifSnap(
          await getDocs(
            query(collection(db, COLLECTIONS.NOTIFICATIONS), where('consumerEmail', '==', rawEmail), limit(30))
          )
        );
      }
    }
    const targetNotifUid = effectiveUid || resolvedConsumer?.linkedUserId || '';
    if (targetNotifUid) {
      addNotifSnap(
        await getDocs(query(collection(db, COLLECTIONS.NOTIFICATIONS), where('userId', '==', targetNotifUid), limit(30)))
      );
    }
    // Also include district-wide broadcast notifications (ONLY official announcements & tariff advisories)
    const broadcastSnap = await getDocs(
      query(collection(db, COLLECTIONS.NOTIFICATIONS), where('accountNumber', '==', 'ALL'), limit(20))
    );
    broadcastSnap.forEach((d) => {
      const n = d.data() as ConsumerNotification;
      if (!n || !n.title) return;
      const inferred = inferNotificationType(n);
      if (
        isPersonalNotificationType(inferred) ||
        isTransactionalPaymentOrReceiptItem(n as unknown as Record<string, unknown>)
      ) {
        return;
      }
      notifMap.set(n.id || d.id, { ...n, id: n.id || d.id, type: inferred });
    });

    const notifications = dedupeNotifications(Array.from(notifMap.values()));

    // 4. Synthesize issuance notification in-memory if missing (NEVER perform Firestore writes inside a read resolver!)
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
          userId: targetNotifUid || undefined,
          consumerEmail: (effectiveEmail || resolvedConsumer.email || '').trim().toLowerCase() || undefined,
          title: 'Official Account Number & Meter Issued!',
          message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${finalAcc} and Meter Tag Number is #${resolvedConsumer.meterNumber}. Smart RFID Tag: ${resolvedConsumer.rfidTag}. Your full dashboard and telemetry are now active.`,
          timestamp: resolvedConsumer.registrationDate
            ? `${resolvedConsumer.registrationDate.split('T')[0]}T00:00:00.000Z`
            : '2026-01-01T00:00:00.000Z',
          type: 'account_issue',
          read: false,
        };
        notifications.unshift(backfilled);
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
      consumer: resolvedConsumer ? normalizeConsumerRecord(resolvedConsumer) : null,
      notifications,
    };
  } catch (error) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error, 'read');
    } else if (isPermissionDeniedError(error)) {
      try {
        handleFirestoreError(error, OperationType.GET, COLLECTIONS.CONSUMERS);
      } catch {}
    }
    return null;
  }
}

/**
 * Attaches targeted real-time Cloud Firestore push listeners for a specific logged-in Consumer
 * so that the instant Admin issues IDs on any other device/browser (including Vercel serverless),
 * this Consumer Portal receives sub-second push confirmation without waiting for polling or WebSockets.
 */
export function subscribeToConsumerIdentityInFirestore(
  params: {
    userId?: string;
    email?: string;
    accountNumber?: string;
    name?: string;
    contactNumber?: string;
  },
  onResolved: (data: {
    isIssued: boolean;
    user: User | null;
    consumer: Consumer | null;
    notifications: ConsumerNotification[];
  }) => void
): () => void {
  if (isFirestoreReadQuotaExceeded()) return () => {};

  const cleanEmail = (params.email || '').trim().toLowerCase();
  const cleanUid = (params.userId || '').trim();
  const unsubs: Unsubscribe[] = [];
  let resolveTimer: ReturnType<typeof setTimeout> | null = null;

  const triggerResolve = () => {
    if (resolveTimer) clearTimeout(resolveTimer);
    resolveTimer = setTimeout(() => {
      resolveConsumerAccountInFirestore(params)
        .then((res) => {
          if (res) onResolved(res);
        })
        .catch(() => {});
    }, 120);
  };

  try {
    if (cleanUid && !cleanUid.startsWith('email_')) {
      unsubs.push(
        onSnapshot(
          doc(db, COLLECTIONS.USERS, sanitizeDocId(cleanUid)),
          (snap) => {
            if (snap.exists()) triggerResolve();
          },
          () => {}
        )
      );
      unsubs.push(
        onSnapshot(
          doc(db, COLLECTIONS.CONSUMERS, sanitizeDocId(cleanUid)),
          (snap) => {
            if (snap.exists()) triggerResolve();
          },
          () => {}
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, COLLECTIONS.CONSUMERS), where('linkedUserId', '==', cleanUid), limit(5)),
          (snap) => {
            if (!snap.empty) triggerResolve();
          },
          () => {}
        )
      );
    }

    if (cleanEmail) {
      const emailDocId = sanitizeEmailDocId(cleanEmail);
      unsubs.push(
        onSnapshot(
          doc(db, COLLECTIONS.USERS, emailDocId),
          (snap) => {
            if (snap.exists()) triggerResolve();
          },
          () => {}
        )
      );
      unsubs.push(
        onSnapshot(
          doc(db, COLLECTIONS.CONSUMERS, emailDocId),
          (snap) => {
            if (snap.exists()) triggerResolve();
          },
          () => {}
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, COLLECTIONS.CONSUMERS), where('email', '==', cleanEmail), limit(5)),
          (snap) => {
            if (!snap.empty) triggerResolve();
          },
          () => {}
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, COLLECTIONS.NOTIFICATIONS), where('consumerEmail', '==', cleanEmail), limit(15)),
          (snap) => {
            if (!snap.empty) triggerResolve();
          },
          () => {}
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, COLLECTIONS.INSTALLATIONS), where('consumerEmail', '==', cleanEmail), limit(10)),
          (snap) => {
            if (!snap.empty) {
              try {
                const localRaw = localStorage.getItem(KEYS.INSTALLATIONS);
                const localList: WaterMeterInstallationRequest[] = localRaw ? JSON.parse(localRaw) : [];
                const map = new Map<string, WaterMeterInstallationRequest>();
                localList.forEach((r) => {
                  if (r && r.id) map.set(r.id, r);
                });
                snap.forEach((d) => {
                  const cr = d.data() as WaterMeterInstallationRequest;
                  if (cr && (cr.id || d.id)) {
                    const k = cr.id || d.id;
                    const prev = map.get(k);
                    map.set(k, prev ? { ...prev, ...cr, id: k } : { ...cr, id: k });
                  }
                });
                const nextJson = JSON.stringify(Array.from(map.values()));
                if (localRaw !== nextJson) {
                  localStorage.setItem(KEYS.INSTALLATIONS, nextJson);
                  triggerLocalUpdateEvent(KEYS.INSTALLATIONS);
                }
              } catch {}
              triggerResolve();
            }
          },
          () => {}
        )
      );
    }
  } catch {}

  return () => {
    if (resolveTimer) clearTimeout(resolveTimer);
    unsubs.forEach((u) => {
      try {
        u();
      } catch {}
    });
  };
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
  if (!isFirestoreReadQuotaExceeded()) {
    startRealtimeFirestoreListeners();
  }
  if (isFirestoreWriteQuotaExceeded()) {
    return;
  }
  try {
    if (typeof window !== 'undefined' && localStorage.getItem(SEEDED_STORAGE_KEY) === '1') {
      return;
    }
  } catch {}

  try {
    setTimeout(async () => {
      if (isFirestoreWriteQuotaExceeded()) {
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

          await withWriteTimeout(batch.commit());
        }
        try {
          localStorage.setItem(SEEDED_STORAGE_KEY, '1');
        } catch {}
      } catch (innerError: any) {
        if (isQuotaError(innerError)) {
          markFirestoreQuotaExceeded(innerError, 'write');
        }
      }
    }, 300);
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error, 'write');
    }
  }
}

/**
 * Asynchronously sync an item to Firestore with payload deduplication
 */
export async function syncDocToFirestore<T extends object>(
  collectionName: string,
  docId: string,
  data: T,
  force: boolean = false
): Promise<void> {
  if (!docId || docId.trim() === '') return;
  if (isFirestoreWriteQuotaExceeded()) return;
  const cleanId = sanitizeDocId(docId);
  const cleanData = sanitizeForFirestore(data);
  if (!force && isPayloadAlreadySynced(collectionName, cleanId, cleanData)) return;

  try {
    await withWriteTimeout(setDoc(doc(db, collectionName, cleanId), cleanData, { merge: true }));
    markPayloadSynced(collectionName, cleanId, cleanData);
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error, 'write');
    } else if (isPermissionDeniedError(error)) {
      try {
        handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${cleanId}`);
      } catch {}
    }
  }
}

/**
 * Asynchronously batch save changed documents to Firestore (marking cache ONLY after commit succeeds)
 */
export async function syncBatchToFirestore<T extends object>(
  collectionName: string,
  items: T[],
  idKey: string = 'id'
): Promise<void> {
  if (!items || items.length === 0) return;
  if (isFirestoreQuotaExceeded()) return;

  const staged: Array<{ cleanId: string; cleanItem: T }> = [];
  items.forEach((item) => {
    if (staged.length >= 400) return;
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
      if (!isPayloadAlreadySynced(collectionName, cleanId, cleanItem)) {
        staged.push({ cleanId, cleanItem });
      }
    }
  });

  if (staged.length === 0) return;

  try {
    const batch = writeBatch(db);
    staged.forEach(({ cleanId, cleanItem }) => {
      batch.set(doc(db, collectionName, cleanId), cleanItem, { merge: true });
    });
    await withWriteTimeout(batch.commit());
    staged.forEach(({ cleanId, cleanItem }) => {
      markPayloadSynced(collectionName, cleanId, cleanItem);
    });
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error, 'write');
      return;
    }
    // Fallback: write changed items individually so one legacy invalid record never blocks new users/IDs
    for (const { cleanId, cleanItem } of staged) {
      if (isFirestoreWriteQuotaExceeded()) break;
      try {
        await withWriteTimeout(setDoc(doc(db, collectionName, cleanId), cleanItem, { merge: true }));
        markPayloadSynced(collectionName, cleanId, cleanItem);
      } catch (innerErr: any) {
        if (isQuotaError(innerErr)) {
          markFirestoreQuotaExceeded(innerErr, 'write');
          break;
        }
      }
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
    await withWriteTimeout(deleteDoc(doc(db, collectionName, cleanId)));
  } catch (error: any) {
    if (isQuotaError(error)) {
      markFirestoreQuotaExceeded(error, 'write');
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

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  doc,
  getDocFromServer,
  setLogLevel,
  disableNetwork,
  enableNetwork,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Silence internal Firestore WebChannel backoff spam when free-tier daily quota is exhausted
try {
  setLogLevel('silent');
} catch {}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const dbId = firebaseConfig.firestoreDatabaseId;

let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(
    app,
    {
      experimentalAutoDetectLongPolling: true,
      ignoreUndefinedProperties: true,
    },
    dbId || undefined
  );
} catch {
  firestoreInstance = dbId ? getFirestore(app, dbId) : getFirestore(app);
}

try {
  setLogLevel('silent');
} catch {}

export const db = firestoreInstance;

export const QUOTA_STORAGE_KEY = 'twd_firestore_quota_v3';
export const WRITE_QUOTA_SESSION_KEY = 'twd_fs_write_quota_until_v4';
export const READ_QUOTA_SESSION_KEY = 'twd_fs_read_quota_until_v4';

export function isSessionQuotaCooldownActive(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const now = Date.now();
    const wUntil = Math.max(
      Number(sessionStorage.getItem(WRITE_QUOTA_SESSION_KEY) || '0'),
      Number(localStorage.getItem(WRITE_QUOTA_SESSION_KEY) || '0')
    );
    const rUntil = Math.max(
      Number(sessionStorage.getItem(READ_QUOTA_SESSION_KEY) || '0'),
      Number(localStorage.getItem(READ_QUOTA_SESSION_KEY) || '0')
    );
    return wUntil > now || rUntil > now;
  } catch {
    return false;
  }
}

// Purge legacy sticky quota locks while respecting active cooldowns
try {
  if (typeof window !== 'undefined') {
    const legacyQuotaKeys = [
      'twd_firestore_quota_exceeded',
      'twd_firestore_quota_exceeded_v1',
      'twd_firestore_quota_v2',
      QUOTA_STORAGE_KEY,
    ];
    legacyQuotaKeys.forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    if (isSessionQuotaCooldownActive()) {
      disableNetwork(db).catch(() => {});
    } else {
      enableNetwork(db).catch(() => {});
    }
  }
} catch {}

export const auth = getAuth(app);

// Validate connection to Firestore server on initial application boot
export async function validateFirestoreConnection(): Promise<boolean> {
  if (isSessionQuotaCooldownActive()) {
    await disableNetwork(db).catch(() => {});
    return false;
  }
  try {
    await enableNetwork(db).catch(() => {});
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error || '');
    const code = (error as { code?: string })?.code || '';
    if (
      code === 'resource-exhausted' ||
      msg.includes('Quota limit exceeded') ||
      msg.includes('Quota exceeded') ||
      msg.includes('resource-exhausted')
    ) {
      const until = String(Date.now() + 30 * 60 * 1000);
      try {
        sessionStorage.setItem(READ_QUOTA_SESSION_KEY, until);
        localStorage.setItem(READ_QUOTA_SESSION_KEY, until);
      } catch {}
      await disableNetwork(db).catch(() => {});
      return false;
    }
    return false;
  }
}

if (typeof window !== 'undefined') {
  validateFirestoreConnection().catch(() => {});
}

export default app;

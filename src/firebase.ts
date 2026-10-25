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

// Silence verbose internal backoff logs while preserving explicit application error handlers
try {
  setLogLevel('error');
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

export const db = firestoreInstance;

export const QUOTA_STORAGE_KEY = 'twd_firestore_quota_v2';

// Purge legacy sticky quota lock so cross-device real-time sync is active
try {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('twd_firestore_quota_exceeded');
    sessionStorage.removeItem('twd_firestore_quota_exceeded');

    const rawQuota = localStorage.getItem(QUOTA_STORAGE_KEY) || sessionStorage.getItem(QUOTA_STORAGE_KEY);
    let activeQuotaBlock = false;
    if (rawQuota) {
      try {
        const parsed = JSON.parse(rawQuota);
        if (parsed?.timestamp && Date.now() - parsed.timestamp < 4 * 60 * 60 * 1000) {
          activeQuotaBlock = true;
        } else {
          localStorage.removeItem(QUOTA_STORAGE_KEY);
          sessionStorage.removeItem(QUOTA_STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(QUOTA_STORAGE_KEY);
        sessionStorage.removeItem(QUOTA_STORAGE_KEY);
      }
    }

    if (activeQuotaBlock) {
      disableNetwork(db).catch(() => {});
    } else {
      enableNetwork(db).catch(() => {});
    }
  }
} catch {}

export const auth = getAuth(app);

// Validate connection to Firestore server on initial application boot
export async function validateFirestoreConnection(): Promise<boolean> {
  try {
    await enableNetwork(db).catch(() => {});
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return false;
  }
}

if (typeof window !== 'undefined') {
  validateFirestoreConnection().catch(() => {});
}

export default app;

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

export const QUOTA_STORAGE_KEY = 'twd_firestore_quota_v3';

// Purge all legacy sticky quota locks so cross-device real-time sync is always active on boot
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
    enableNetwork(db).catch(() => {});
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

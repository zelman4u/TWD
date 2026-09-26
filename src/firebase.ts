import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore, doc, getDoc, setLogLevel, disableNetwork } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Silence verbose internal backoff and quota logs to prevent console clutter
try {
  setLogLevel('silent');
} catch {}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const dbId = firebaseConfig.firestoreDatabaseId;

let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true,
  }, dbId || undefined);
} catch (e) {
  firestoreInstance = dbId ? getFirestore(app, dbId) : getFirestore(app);
}

export const db = firestoreInstance;

// Check if free daily write quota is exhausted; disable network to prevent endless backoff loops
try {
  if (typeof window !== 'undefined') {
    const quotaExceeded = localStorage.getItem('twd_firestore_quota_exceeded') || sessionStorage.getItem('twd_firestore_quota_exceeded');
    if (quotaExceeded) {
      disableNetwork(db).catch(() => {});
    }
  } else {
    disableNetwork(db).catch(() => {});
  }
} catch {}

export const auth = getAuth(app);

// Safe connectivity validation without throwing unhandled network errors
export async function validateFirestoreConnection(): Promise<boolean> {
  try {
    const testDoc = await getDoc(doc(db, 'test', 'connection'));
    console.info('[Firebase] Firestore initialized. Connection state:', testDoc.exists() ? 'online-synced' : 'local-ready');
    return true;
  } catch (error) {
    // Firestore operates automatically in offline mode with cached local storage
    console.warn('[Firebase] Firestore operating in resilient local-first mode.');
    return false;
  }
}

export default app;

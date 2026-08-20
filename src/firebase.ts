import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db = firebaseConfig.firestoreDatabaseId 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

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

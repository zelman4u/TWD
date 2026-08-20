import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  query,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  User,
  Consumer,
  MeterReader,
  WaterMeter,
  MeterReading,
  RouteAssignment,
  Announcement,
  Barangay,
} from '../types';

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
};

/**
 * Checks if a Firestore collection has documents safely
 */
async function isCollectionEmpty(collectionName: string): Promise<boolean> {
  try {
    const q = query(collection(db, collectionName), limit(1));
    const snap = await getDocs(q);
    return snap.empty;
  } catch {
    // If offline or network unavailable, assume false to avoid overwriting local cache
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
  try {
    // Run seed check asynchronously without blocking main thread
    setTimeout(async () => {
      try {
        const usersEmpty = await isCollectionEmpty(COLLECTIONS.USERS);
        if (usersEmpty) {
          console.info('[Firestore] Seeding baseline Tagoloan Water District data...');
          const batch = writeBatch(db);

          initialData.users.forEach((u) => {
            batch.set(doc(db, COLLECTIONS.USERS, u.id), u);
          });
          initialData.consumers.forEach((c) => {
            batch.set(doc(db, COLLECTIONS.CONSUMERS, c.accountNumber), c);
          });
          initialData.meters.forEach((m) => {
            batch.set(doc(db, COLLECTIONS.METERS, m.meterNumber), m);
          });
          initialData.readings.forEach((r) => {
            batch.set(doc(db, COLLECTIONS.READINGS, r.id), r);
          });
          initialData.routes.forEach((rt) => {
            batch.set(doc(db, COLLECTIONS.ROUTES, rt.id), rt);
          });
          initialData.announcements.forEach((a) => {
            batch.set(doc(db, COLLECTIONS.ANNOUNCEMENTS, a.id), a);
          });
          initialData.barangays.forEach((b) => {
            batch.set(doc(db, COLLECTIONS.BARANGAYS, b.id), b);
          });

          await batch.commit();
          console.info('[Firestore] Seed data populated successfully.');
        }
      } catch (innerError) {
        // Graceful catch for offline operation
        console.warn('[Firestore] Background seed sync deferred (offline-mode active).');
      }
    }, 1500);
  } catch (error) {
    console.warn('[Firestore] Sync notice:', error);
  }
}

/**
 * Asynchronously sync an item to Firestore in the background
 */
export async function syncDocToFirestore<T extends object>(
  collectionName: string,
  docId: string,
  data: T
): Promise<void> {
  try {
    await setDoc(doc(db, collectionName, docId), data, { merge: true });
  } catch (error) {
    console.warn(`[Firestore] Sync to ${collectionName}/${docId} cached locally.`);
  }
}

/**
 * Asynchronously batch save array of documents to Firestore
 */
export async function syncBatchToFirestore<T extends object>(
  collectionName: string,
  items: T[],
  idKey: string = 'id'
): Promise<void> {
  try {
    const batch = writeBatch(db);
    let count = 0;
    items.forEach((item) => {
      const rec = item as Record<string, unknown>;
      const rawId = rec[idKey];
      const validRawId = (typeof rawId === 'string' && rawId.trim() !== '') || (typeof rawId === 'number') ? String(rawId) : null;
      const validId = (typeof rec.id === 'string' && rec.id.trim() !== '') ? rec.id : null;
      const validLinkedUser = (typeof rec.linkedUserId === 'string' && rec.linkedUserId.trim() !== '') ? rec.linkedUserId : null;
      const validMeter = (typeof rec.meterNumber === 'string' && rec.meterNumber.trim() !== '') ? rec.meterNumber : null;
      const validEmail = (typeof rec.email === 'string' && rec.email.trim() !== '') ? rec.email : null;
      const validAcc = (typeof rec.accountNumber === 'string' && rec.accountNumber.trim() !== '') ? rec.accountNumber : null;

      const docId = validRawId || validId || validAcc || validLinkedUser || validMeter || validEmail;
      if (docId && docId.trim() !== '') {
        batch.set(doc(db, collectionName, String(docId).trim()), item, { merge: true });
        count++;
      }
    });
    if (count > 0) {
      await batch.commit();
    }
  } catch (error) {
    console.warn(`[Firestore] Batch sync to ${collectionName} cached locally.`);
  }
}

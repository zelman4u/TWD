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
  AuditLog,
  ConsumerNotification,
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

// Storage prefix used by mockDb
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
  BARANGAYS: `${STORAGE_PREFIX}barangays`,
};

function triggerLocalUpdateEvent(key: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key, timestamp: Date.now() } }));
    try {
      localStorage.setItem('twd_sync_ping', `${Date.now()}_${key}`);
    } catch {}
  }
}

// Active Firestore Realtime Unsubscribe handles
let realtimeUnsubscribes: Unsubscribe[] = [];

/**
 * Starts live real-time two-way Firestore synchronization
 */
export function startRealtimeFirestoreListeners() {
  // Clear any existing active listeners to avoid duplicate subscribers
  stopRealtimeFirestoreListeners();

  try {
    // 1. Live USERS Listener
    const unsubUsers = onSnapshot(collection(db, COLLECTIONS.USERS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudUsers: User[] = [];
        snapshot.forEach((d) => {
          cloudUsers.push(d.data() as User);
        });

        // Merge with existing local to prevent loss
        const localRaw = localStorage.getItem(KEYS.USERS);
        const localUsers: User[] = localRaw ? JSON.parse(localRaw) : [];
        const mergedMap = new Map<string, User>();

        // Ensure baseline admin exists
        const adminUser: User = {
          id: 'admin-1',
          email: 'admin@tagoloanwater.gov.ph',
          name: 'Admin',
          role: 'admin',
          status: 'active',
          password: 'AdminWater2025!',
        };
        mergedMap.set('admin@tagoloanwater.gov.ph', adminUser);

        cloudUsers.forEach((u) => {
          if (u.email) mergedMap.set(u.email.toLowerCase(), u);
          else if (u.id) mergedMap.set(u.id, u);
        });
        localUsers.forEach((u) => {
          const key = u.email ? u.email.toLowerCase() : u.id;
          if (!mergedMap.has(key)) mergedMap.set(key, u);
        });

        const finalUsers = Array.from(mergedMap.values());
        localStorage.setItem(KEYS.USERS, JSON.stringify(finalUsers));
        triggerLocalUpdateEvent(KEYS.USERS);
      }
    }, (err) => console.warn('[Firestore Live] Users listener standby:', err.message));
    realtimeUnsubscribes.push(unsubUsers);

    // 2. Live CONSUMERS Listener
    const unsubConsumers = onSnapshot(collection(db, COLLECTIONS.CONSUMERS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudConsumers: Consumer[] = [];
        snapshot.forEach((d) => {
          const cData = d.data() as Consumer;
          cloudConsumers.push(cData);
        });

        const localRaw = localStorage.getItem(KEYS.CONSUMERS);
        const localConsumers: Consumer[] = localRaw ? JSON.parse(localRaw) : [];
        
        // Merge cloud and local, deduplicating and preferring active/issued records
        const allList = [...cloudConsumers, ...localConsumers];
        const mergedList: Consumer[] = [];

        for (const c of allList) {
          const existingIdx = mergedList.findIndex(m => 
            (c.accountNumber && m.accountNumber && c.accountNumber === m.accountNumber) ||
            (c.linkedUserId && m.linkedUserId && c.linkedUserId === m.linkedUserId) ||
            (c.email && m.email && c.email.toLowerCase() === m.email.toLowerCase()) ||
            (c.name && m.name && c.name.toLowerCase() === m.name.toLowerCase() && c.barangay === m.barangay)
          );

          if (existingIdx === -1) {
            mergedList.push(c);
          } else {
            const existing = mergedList[existingIdx];
            const isCMoreActive = (c.accountNumber && !c.accountNumber.startsWith('PENDING') && c.status === 'active') &&
                                  (!existing.accountNumber || existing.accountNumber.startsWith('PENDING') || existing.status === 'pending_approval');
            if (isCMoreActive) {
              mergedList[existingIdx] = c;
            } else if (!((existing.accountNumber && !existing.accountNumber.startsWith('PENDING') && existing.status === 'active') &&
                         (!c.accountNumber || c.accountNumber.startsWith('PENDING') || c.status === 'pending_approval'))) {
              mergedList[existingIdx] = { ...existing, ...c };
            }
          }
        }

        localStorage.setItem(KEYS.CONSUMERS, JSON.stringify(mergedList));
        triggerLocalUpdateEvent(KEYS.CONSUMERS);
      }
    }, (err) => console.warn('[Firestore Live] Consumers listener standby:', err.message));
    realtimeUnsubscribes.push(unsubConsumers);

    // 3. Live READERS Listener
    const unsubReaders = onSnapshot(collection(db, COLLECTIONS.READERS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudReaders: MeterReader[] = [];
        snapshot.forEach((d) => cloudReaders.push(d.data() as MeterReader));
        localStorage.setItem(KEYS.READERS, JSON.stringify(cloudReaders));
        triggerLocalUpdateEvent(KEYS.READERS);
      }
    }, (err) => console.warn('[Firestore Live] Readers listener standby:', err.message));
    realtimeUnsubscribes.push(unsubReaders);

    // 4. Live METERS Listener
    const unsubMeters = onSnapshot(collection(db, COLLECTIONS.METERS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudMeters: WaterMeter[] = [];
        snapshot.forEach((d) => cloudMeters.push(d.data() as WaterMeter));
        localStorage.setItem(KEYS.METERS, JSON.stringify(cloudMeters));
        triggerLocalUpdateEvent(KEYS.METERS);
      }
    }, (err) => console.warn('[Firestore Live] Meters listener standby:', err.message));
    realtimeUnsubscribes.push(unsubMeters);

    // 5. Live READINGS Listener
    const unsubReadings = onSnapshot(collection(db, COLLECTIONS.READINGS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudReadings: MeterReading[] = [];
        snapshot.forEach((d) => cloudReadings.push(d.data() as MeterReading));
        localStorage.setItem(KEYS.READINGS, JSON.stringify(cloudReadings));
        triggerLocalUpdateEvent(KEYS.READINGS);
      }
    }, (err) => console.warn('[Firestore Live] Readings listener standby:', err.message));
    realtimeUnsubscribes.push(unsubReadings);

    // 6. Live ANNOUNCEMENTS Listener
    const unsubAnnouncements = onSnapshot(collection(db, COLLECTIONS.ANNOUNCEMENTS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudAnns: Announcement[] = [];
        snapshot.forEach((d) => cloudAnns.push(d.data() as Announcement));
        localStorage.setItem(KEYS.ANNOUNCEMENTS, JSON.stringify(cloudAnns));
        triggerLocalUpdateEvent(KEYS.ANNOUNCEMENTS);
      }
    }, (err) => console.warn('[Firestore Live] Announcements listener standby:', err.message));
    realtimeUnsubscribes.push(unsubAnnouncements);

    // 7. Live AUDIT_LOGS Listener
    const unsubAudit = onSnapshot(collection(db, COLLECTIONS.AUDIT_LOGS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudLogs: AuditLog[] = [];
        snapshot.forEach((d) => cloudLogs.push(d.data() as AuditLog));
        localStorage.setItem(KEYS.AUDIT_LOGS, JSON.stringify(cloudLogs));
        triggerLocalUpdateEvent(KEYS.AUDIT_LOGS);
      }
    }, (err) => console.warn('[Firestore Live] Audit listener standby:', err.message));
    realtimeUnsubscribes.push(unsubAudit);

    // 8. Live BARANGAYS Listener
    const unsubBarangays = onSnapshot(collection(db, COLLECTIONS.BARANGAYS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudBrgs: Barangay[] = [];
        snapshot.forEach((d) => cloudBrgs.push(d.data() as Barangay));
        localStorage.setItem(KEYS.BARANGAYS, JSON.stringify(cloudBrgs));
        triggerLocalUpdateEvent(KEYS.BARANGAYS);
      }
    }, (err) => console.warn('[Firestore Live] Barangays listener standby:', err.message));
    realtimeUnsubscribes.push(unsubBarangays);

    // 9. Live NOTIFICATIONS Listener
    const unsubNotifs = onSnapshot(collection(db, COLLECTIONS.NOTIFICATIONS), (snapshot) => {
      if (!snapshot.empty) {
        const cloudNotifs: ConsumerNotification[] = [];
        snapshot.forEach((d) => cloudNotifs.push(d.data() as ConsumerNotification));
        localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(cloudNotifs));
        triggerLocalUpdateEvent(KEYS.NOTIFICATIONS);
      }
    }, (err) => console.warn('[Firestore Live] Notifs listener standby:', err.message));
    realtimeUnsubscribes.push(unsubNotifs);

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
 * Direct Live Lookup for a User in Firestore (by Email or ID)
 */
export async function directFindUserInFirestore(emailOrId: string): Promise<User | null> {
  try {
    const cleanSearch = emailOrId.trim().toLowerCase();
    // 1. Check doc by ID
    const directDoc = await getDoc(doc(db, COLLECTIONS.USERS, cleanSearch));
    if (directDoc.exists()) {
      return directDoc.data() as User;
    }

    // 2. Query by email field
    const q = query(collection(db, COLLECTIONS.USERS), where('email', '==', cleanSearch), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].data() as User;
    }

    return null;
  } catch (error) {
    console.warn('[Firestore] directFindUser error:', error);
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
  try {
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
            const docId = c.accountNumber || c.linkedUserId || c.email?.replace(/[@.]/g, '_') || `consumer-${Date.now()}`;
            batch.set(doc(db, COLLECTIONS.CONSUMERS, docId), c);
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

        // Start real-time snapshot listeners after seed verification
        startRealtimeFirestoreListeners();
      } catch (innerError) {
        console.warn('[Firestore] Background seed sync deferred.');
        startRealtimeFirestoreListeners();
      }
    }, 500);
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
  if (!docId || docId.trim() === '') return;
  try {
    await setDoc(doc(db, collectionName, docId.trim()), data, { merge: true });
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
  if (!items || items.length === 0) return;
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
      if (docId && String(docId).trim() !== '') {
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

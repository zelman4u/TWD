import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  limit,
} from "firebase/firestore/lite";

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const DEFAULT_FIREBASE_CONFIG: FirebaseAppletConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || "gen-lang-client-0840655687",
  appId: process.env.FIREBASE_APP_ID || "1:140365844334:web:ab17496a50dfb39acdfb7f",
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAqMaOnNXTYDV6HpR2vJOTW0zoAIcuTVpE",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "gen-lang-client-0840655687.firebaseapp.com",
  firestoreDatabaseId:
    process.env.FIRESTORE_DATABASE_ID || "ai-studio-tagoloanwaterdis-29aaeffc-dbd1-4669-9b5b-63d636462350",
  storageBucket: "gen-lang-client-0840655687.firebasestorage.app",
  messagingSenderId: "140365844334",
};

function loadFirebaseConfig(): FirebaseAppletConfig {
  const candidatePaths = [
    resolve(process.cwd(), "firebase-applet-config.json"),
    resolve(process.cwd(), "..", "firebase-applet-config.json"),
  ];
  for (const p of candidatePaths) {
    try {
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
      if (parsed && parsed.projectId && parsed.apiKey) {
        return { ...DEFAULT_FIREBASE_CONFIG, ...parsed };
      }
    } catch {
      // Fall through to embedded config in serverless bundle
    }
  }
  return DEFAULT_FIREBASE_CONFIG;
}

const firebaseConfig = loadFirebaseConfig();
const fbApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const fsDb = firebaseConfig.firestoreDatabaseId
  ? getFirestore(fbApp, firebaseConfig.firestoreDatabaseId)
  : getFirestore(fbApp);

const FS_COLLECTIONS = {
  USERS: "users",
  CONSUMERS: "consumers",
  READERS: "readers",
  METERS: "meters",
  READINGS: "readings",
  NOTIFICATIONS: "notifications",
  REPORTS: "consumer_reports",
  ANNOUNCEMENTS: "announcements",
  SETTINGS: "settings",
};

const app = express();

// Express JSON and URL-encoded body parsing
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Normalize Vercel rewrite URLs (__api_path, x-matched-path, stripped prefixes) & enable CORS
app.use((req, res, next) => {
  try {
    const parsedUrl = new URL(req.url || "/", "http://localhost");
    const rewrittenSubpath = parsedUrl.searchParams.get("__api_path");
    if (rewrittenSubpath !== null) {
      parsedUrl.searchParams.delete("__api_path");
      const cleanSub = rewrittenSubpath.replace(/^\/+/, "");
      const qs = parsedUrl.searchParams.toString();
      req.url = cleanSub ? `/api/${cleanSub}${qs ? `?${qs}` : ""}` : `/api${qs ? `?${qs}` : ""}`;
    } else if (req.url.startsWith("/api/api/")) {
      req.url = req.url.replace(/^\/api\/api\//, "/api/");
    } else if (!req.url.startsWith("/api/") && req.url !== "/api" && !req.url.startsWith("/api?")) {
      req.url = `/api${req.url.startsWith("/") ? "" : "/"}${req.url}`;
    }
  } catch {
    if (req.url.startsWith("/api/api/")) {
      req.url = req.url.replace(/^\/api\/api\//, "/api/");
    }
  }

  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-portal, x-role, x-client-version, x-app-id, x-reader-id, x-employee-id, x-user-id, Cache-Control, Pragma"
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ==========================================
// HELPERS & TYPES
// ==========================================
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
};

function sanitizeDocId(rawId: string): string {
  return String(rawId || "")
    .trim()
    .replace(/\//g, "_")
    .slice(0, 120);
}

function sanitizeEmailDocId(email: string): string {
  return `email_${String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 120);
}

function sanitizePayload<T>(input: T, keyName?: string): T {
  if (input === null || input === undefined) return input;
  if (keyName && STRING_SCHEMA_KEYS[keyName] !== undefined) {
    const maxLen = STRING_SCHEMA_KEYS[keyName];
    return String(input).slice(0, maxLen) as unknown as T;
  }
  if (typeof input === "string") {
    return (input.length > 2900 ? input.slice(0, 2900) : input) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input
      .filter((v) => v !== undefined)
      .slice(0, 100)
      .map((v) => sanitizePayload(v)) as unknown as T;
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 58)) {
      if (v !== undefined) {
        out[k] = sanitizePayload(v, k);
      }
    }
    return out as T;
  }
  return input;
}

function isRealAccountNumber(acc?: string | null): boolean {
  if (!acc) return false;
  const clean = String(acc).replace(/^#/, "").trim().toUpperCase();
  if (!clean) return false;
  return (
    !clean.startsWith("PENDING") &&
    clean !== "UNASSIGNED" &&
    clean !== "UNISSUED" &&
    clean !== "NONE" &&
    clean !== "N/A" &&
    clean !== "NULL" &&
    clean !== "UNDEFINED"
  );
}

function isValidatedConsumerForReader(c?: Partial<MobileConsumerRecord> | null): boolean {
  if (!c) return false;
  return (
    isRealAccountNumber(c.accountNumber) &&
    c.status !== "pending_approval" &&
    c.status !== "pending" &&
    Boolean(c.meterNumber && !String(c.meterNumber).toUpperCase().startsWith("PENDING"))
  );
}

function normalizePhone(phone?: string | null): string {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("639")) return "0" + digits.slice(2);
  if (digits.length === 10 && digits.startsWith("9")) return "0" + digits;
  return digits.length === 11 ? digits : "";
}

interface MobileReader {
  id: string;
  employeeId?: string;
  username: string;
  email?: string;
  name: string;
  pin?: string;
  role: string;
  zone: string;
  contactNumber: string;
  employmentStatus: "active" | "pending" | "inactive";
  registeredAt: string;
  approvedAt?: string;
  assignedRoutes: string[];
}

export interface MobileConsumerRecord {
  id?: string;
  accountNumber: string;
  name: string;
  address: string;
  barangay: string;
  barangayId?: string;
  sitioZone: string;
  meterNumber: string;
  previousReading: number;
  lastReadingDate: string;
  meterSize: string;
  consumerType: "Residential" | "Commercial";
  status: "active" | "inactive" | "maintenance" | "disconnected" | "pending_approval" | "pending";
  contactNumber?: string;
  email?: string;
  rfidTag?: string;
  registrationDate?: string;
  linkedUserId?: string;
  householdInfo?: string;
  businessName?: string;
  businessType?: string;
  isRegistered?: boolean;
  outstandingBalance?: number;
}

interface PortalSyncUser {
  id: string;
  email: string;
  name: string;
  password?: string;
  passwordUpdatedAt?: number;
  role: string;
  status: string;
  linkedAccountNumber?: string;
  contactNumber?: string;
  registrationDate?: string;
}

interface PortalNotification {
  id: string;
  accountNumber: string;
  consumerId?: string;
  userId?: string;
  consumerEmail?: string;
  title: string;
  message: string;
  timestamp: string;
  type: string;
  read: boolean;
  readingId?: string;
  billingPeriod?: string;
  remainingBalance?: number;
  reportId?: string;
  ticketNumber?: string;
}

interface MobileReadingSubmission {
  id: string;
  accountNumber: string;
  consumerName: string;
  meterNumber: string;
  billingPeriod: string;
  readingDate: string;
  previousReading: number;
  currentReading: number;
  consumption: number;
  readerId?: string;
  readerName?: string;
  meterReaderName?: string;
  route: string;
  status: "pending_approval" | "pending" | "approved" | "verified" | "rejected" | "flagged_abnormal" | "cancelled";
  paymentStatus?: "paid" | "unpaid" | "partial";
  paidAmount?: number;
  billAmount?: number;
  totalAmount?: number;
  dueDate?: string;
  orNumber?: string;
  isBillingIssued?: boolean;
  billingIssuedAt?: string;
  billingIssuedBy?: string;
  invoiceNumber?: string;
  photoUrl?: string;
  coordinates?: { latitude: number; longitude: number };
  notes?: string;
  submittedAt?: string;
  [key: string]: unknown;
}

interface ServerReportReply {
  id: string;
  reportId: string;
  senderId: string;
  senderName: string;
  senderRole: "admin" | "consumer" | "staff";
  message: string;
  timestamp: string;
  statusUpdate?: string;
}

interface ServerConsumerReport {
  id: string;
  ticketNumber: string;
  accountNumber: string;
  consumerName: string;
  consumerEmail?: string;
  consumerPhone?: string;
  barangay?: string;
  address?: string;
  meterNumber?: string;
  category: string;
  title: string;
  description: string;
  urgency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  assignedStaff?: string;
  photoUrl?: string;
  replies: ServerReportReply[];
  hasUnreadAdminReply?: boolean;
  hasUnreadConsumerUpdate?: boolean;
}

// Warm in-memory caches synced with Cloud Firestore
let registeredStaff: MobileReader[] = [
  {
    id: "MR-101",
    username: "reader.poblacion@tagoloanwater.gov.ph",
    name: "Ramon Valderrama",
    pin: "1234",
    role: "Senior Meter Officer",
    zone: "Poblacion",
    contactNumber: "0917-555-0191",
    employmentStatus: "active",
    registeredAt: "2026-08-01T08:00:00.000Z",
    assignedRoutes: ["Poblacion", "Natumolan"],
  },
];

let syncedConsumers: MobileConsumerRecord[] = [];
let syncedUsers: PortalSyncUser[] = [];
let syncedNotifications: PortalNotification[] = [];
let syncedReadings: MobileReadingSubmission[] = [];
let syncedReports: ServerConsumerReport[] = [];
let syncedAnnouncements: any[] = [];
const deletedAnnouncementIds = new Set<string>();
let syncedTariffConfig: any = null;

// Server-side Firestore quota cooldown circuit breaker so /api/* responds in <10ms instead of 400-675ms when free daily quota is full
let fsReadCooldownUntil = 0;
let fsWriteCooldownUntil = 0;

function isFsQuotaErr(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string })?.code || "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === "resource-exhausted" ||
    msg.includes("resource-exhausted") ||
    msg.includes("Quota exceeded") ||
    msg.includes("Quota limit exceeded") ||
    msg.includes("Free daily write units") ||
    msg.includes("Free daily read units")
  );
}

function canReadFs(): boolean {
  return Date.now() >= fsReadCooldownUntil;
}

function canWriteFs(): boolean {
  return Date.now() >= fsWriteCooldownUntil;
}

function recordFsErr(err: unknown, mode: "read" | "write"): void {
  if (!isFsQuotaErr(err)) return;
  const cooldown = 10 * 60 * 1000; // 10 minutes
  if (mode === "read") {
    fsReadCooldownUntil = Date.now() + cooldown;
  } else {
    fsWriteCooldownUntil = Date.now() + cooldown;
  }
}

function withFsTimeout<T>(promise: Promise<T>, timeoutMs = 2200): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      const timeoutErr = Object.assign(new Error("Firestore serverless quota/network timeout"), {
        code: "resource-exhausted",
      });
      rejectPromise(timeoutErr);
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolvePromise(val);
      },
      (err) => {
        clearTimeout(timer);
        rejectPromise(err);
      }
    );
  });
}

function dedupeServerReplies(replies: ServerReportReply[]): ServerReportReply[] {
  if (!Array.isArray(replies)) return [];
  const sorted = [...replies]
    .filter((r) => r && typeof r.message === "string" && r.message.trim().length > 0)
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

  const byId = new Set<string>();
  const result: ServerReportReply[] = [];
  let hasAutoAck = false;

  for (const rep of sorted) {
    const cleanId = String(rep.id || "").trim();
    if (cleanId && byId.has(cleanId)) continue;

    const isAutoAck =
      cleanId.startsWith("ACK-") ||
      rep.senderId === "system-admin-ack" ||
      (rep.senderRole === "admin" && rep.message.includes("officially received by Tagoloan Water District"));
    if (isAutoAck) {
      if (hasAutoAck) continue;
      hasAutoAck = true;
    }

    const normMsg = rep.message.trim().replace(/\s+/g, " ").toLowerCase();
    const repTime = new Date(rep.timestamp || 0).getTime();
    const semanticDupIdx = result.findIndex((existing) => {
      if (existing.senderRole !== rep.senderRole) return false;
      const exMsg = existing.message.trim().replace(/\s+/g, " ").toLowerCase();
      if (exMsg !== normMsg) return false;
      const exTime = new Date(existing.timestamp || 0).getTime();
      if (!exTime || !repTime) return true;
      return Math.abs(repTime - exTime) < 5 * 60 * 1000;
    });

    if (semanticDupIdx >= 0) {
      if (rep.statusUpdate && !result[semanticDupIdx].statusUpdate) {
        result[semanticDupIdx] = { ...result[semanticDupIdx], statusUpdate: rep.statusUpdate };
      }
      if (cleanId) byId.add(cleanId);
      continue;
    }

    if (cleanId) byId.add(cleanId);
    result.push(rep);
  }

  return result;
}

function mergeServerReportPair(existing: ServerConsumerReport, incoming: ServerConsumerReport): ServerConsumerReport {
  const exReplies = Array.isArray(existing.replies) ? existing.replies : [];
  const inReplies = Array.isArray(incoming.replies) ? incoming.replies : [];
  const mergedReplies = dedupeServerReplies([...exReplies, ...inReplies]);
  const inTime = new Date(incoming.updatedAt || incoming.createdAt || 0).getTime();
  const exTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
  const incomingNewer = inTime > exTime || (inTime === exTime && inReplies.length >= exReplies.length);
  const primary = incomingNewer ? incoming : existing;
  const secondary = incomingNewer ? existing : incoming;
  return {
    ...secondary,
    ...primary,
    id: existing.id || incoming.id,
    ticketNumber: primary.ticketNumber || secondary.ticketNumber,
    replies: mergedReplies,
  };
}

function mergeConsumersList(items: MobileConsumerRecord[]): MobileConsumerRecord[] {
  const merged: MobileConsumerRecord[] = [];
  for (const c of items) {
    if (!c || !c.name) continue;
    const cAcc = isRealAccountNumber(c.accountNumber) ? String(c.accountNumber).trim().toUpperCase() : "";
    const cEmail = String(c.email || "").trim().toLowerCase();
    const cUid = String(c.linkedUserId || "").trim();
    const cPhone = normalizePhone(c.contactNumber);
    const cName = String(c.name || "").trim().toLowerCase();

    const idx = merged.findIndex((m) => {
      const mAcc = isRealAccountNumber(m.accountNumber) ? String(m.accountNumber).trim().toUpperCase() : "";
      const mEmail = String(m.email || "").trim().toLowerCase();
      const mUid = String(m.linkedUserId || "").trim();
      const mPhone = normalizePhone(m.contactNumber);
      const mName = String(m.name || "").trim().toLowerCase();

      if (cAcc && mAcc && cAcc === mAcc) return true;
      if (cEmail && mEmail && cEmail === mEmail) return true;
      if (cUid && mUid && cUid === mUid) return true;
      if (cPhone && mPhone && cPhone === mPhone) return true;
      if (cName && mName && cName === mName && (!cEmail || !mEmail || cEmail === mEmail)) {
        if (!c.barangay || !m.barangay || c.barangay.toLowerCase() === m.barangay.toLowerCase()) return true;
      }
      return false;
    });

    if (idx === -1) {
      merged.push(c);
    } else {
      const ex = merged[idx];
      const exIssued =
        isValidatedConsumerForReader(ex) || (isRealAccountNumber(ex.accountNumber) && ex.status !== "pending_approval");
      const inIssued =
        isValidatedConsumerForReader(c) || (isRealAccountNumber(c.accountNumber) && c.status !== "pending_approval");
      const primary = inIssued && !exIssued ? c : exIssued && !inIssued ? ex : { ...ex, ...c };
      const secondary = primary === c ? ex : c;
      const finalAcc = isRealAccountNumber(primary.accountNumber)
        ? String(primary.accountNumber).trim().toUpperCase()
        : isRealAccountNumber(secondary.accountNumber)
          ? String(secondary.accountNumber).trim().toUpperCase()
          : primary.accountNumber || secondary.accountNumber || "";
      merged[idx] = {
        ...secondary,
        ...primary,
        accountNumber: finalAcc,
        meterNumber:
          primary.meterNumber && !String(primary.meterNumber).toUpperCase().startsWith("PENDING")
            ? String(primary.meterNumber)
            : secondary.meterNumber && !String(secondary.meterNumber).toUpperCase().startsWith("PENDING")
              ? String(secondary.meterNumber)
              : finalAcc
                ? `MT-${finalAcc}`
                : "",
        rfidTag:
          primary.rfidTag && !String(primary.rfidTag).toUpperCase().startsWith("PENDING")
            ? String(primary.rfidTag)
            : secondary.rfidTag && !String(secondary.rfidTag).toUpperCase().startsWith("PENDING")
              ? String(secondary.rfidTag)
              : finalAcc
                ? `RFID-MT-${finalAcc}`
                : "",
        status: isRealAccountNumber(finalAcc)
          ? primary.status === "pending_approval"
            ? "active"
            : primary.status || "active"
          : primary.status || "pending_approval",
        email: (primary.email || secondary.email || "").trim().toLowerCase() || primary.email || secondary.email || "",
        linkedUserId: primary.linkedUserId || secondary.linkedUserId,
        contactNumber: primary.contactNumber || secondary.contactNumber || "",
      };
    }
  }
  return merged;
}

async function fetchAllConsumersFromFirestore(): Promise<MobileConsumerRecord[]> {
  if (!canReadFs()) return syncedConsumers;
  try {
    const snap = await getDocs(query(collection(fsDb, FS_COLLECTIONS.CONSUMERS), limit(450)));
    const fsList: MobileConsumerRecord[] = [];
    snap.forEach((d) => fsList.push(d.data() as MobileConsumerRecord));
    syncedConsumers = mergeConsumersList([...fsList, ...syncedConsumers]);
  } catch (err) {
    recordFsErr(err, "read");
  }
  return syncedConsumers;
}

async function fetchAllUsersFromFirestore(): Promise<PortalSyncUser[]> {
  if (!canReadFs()) return syncedUsers;
  try {
    const snap = await getDocs(query(collection(fsDb, FS_COLLECTIONS.USERS), limit(300)));
    const map = new Map<string, PortalSyncUser>();
    const upsert = (u: PortalSyncUser) => {
      if (!u) return;
      const key = (u.email || u.id || "").trim().toLowerCase();
      if (!key) return;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, u);
      } else {
        const uHasAcc = isRealAccountNumber(u.linkedAccountNumber);
        const prevHasAcc = isRealAccountNumber(prev.linkedAccountNumber);
        const uPwTs = Number(u.passwordUpdatedAt || 0);
        const prevPwTs = Number(prev.passwordUpdatedAt || 0);
        const chosenPassword =
          uPwTs > prevPwTs
            ? u.password || prev.password
            : prevPwTs > uPwTs
              ? prev.password || u.password
              : u.password || prev.password;
        const chosenPwTs = Math.max(uPwTs, prevPwTs) || undefined;
        map.set(key, {
          ...prev,
          ...u,
          id: prev.id && !prev.id.startsWith("email_") ? prev.id : u.id,
          linkedAccountNumber: uHasAcc ? u.linkedAccountNumber : prevHasAcc ? prev.linkedAccountNumber : u.linkedAccountNumber,
          status: uHasAcc || prevHasAcc || u.status === "active" || prev.status === "active" ? "active" : u.status || prev.status,
          password: chosenPassword,
          ...(chosenPwTs ? { passwordUpdatedAt: chosenPwTs } : {}),
        });
      }
    };
    syncedUsers.forEach(upsert);
    snap.forEach((d) => {
      const data = d.data() as PortalSyncUser;
      upsert({ ...data, id: data.id || d.id });
    });
    syncedUsers = Array.from(map.values());
  } catch (err) {
    recordFsErr(err, "read");
  }
  return syncedUsers;
}

async function saveConsumerToFirestore(
  record: MobileConsumerRecord,
  userPatch?: Partial<PortalSyncUser>,
  notif?: PortalNotification
): Promise<void> {
  if (!canWriteFs()) return;
  const cleanEmail = String(record.email || "").trim().toLowerCase();
  const acc = isRealAccountNumber(record.accountNumber) ? String(record.accountNumber).replace(/^#/, "").trim().toUpperCase() : "";
  const uid = String(record.linkedUserId || "").trim();

  const normalizedRecord: MobileConsumerRecord = {
    ...record,
    accountNumber: acc || record.accountNumber || "",
    email: cleanEmail || record.email || "",
    status: acc
      ? record.status === "pending_approval" || record.status === "pending" || !record.status
        ? "active"
        : record.status
      : record.status || "pending_approval",
  };
  const cleanRecord = sanitizePayload(normalizedRecord);

  const docIds = new Set<string>();
  if (acc) docIds.add(sanitizeDocId(acc));
  if (uid && !uid.startsWith("email_")) docIds.add(sanitizeDocId(uid));
  if (cleanEmail) docIds.add(sanitizeEmailDocId(cleanEmail));
  if (docIds.size === 0) docIds.add(`consumer_${Date.now()}`);

  const writes: Promise<unknown>[] = [];
  for (const id of docIds) {
    writes.push(
      setDoc(doc(fsDb, FS_COLLECTIONS.CONSUMERS, id), cleanRecord, { merge: true }).catch((err) => recordFsErr(err, "write"))
    );
  }

  // When saving an issued consumer, also delete any stale pending twin documents in Firestore
  if (acc && (cleanEmail || uid)) {
    const cleanupTwinTask = (async () => {
      try {
        if (cleanEmail) {
          const snapE = await getDocs(query(collection(fsDb, FS_COLLECTIONS.CONSUMERS), where("email", "==", cleanEmail), limit(15)));
          for (const d of snapE.docs) {
            if (docIds.has(d.id)) continue;
            const data = d.data() as MobileConsumerRecord;
            if (!isRealAccountNumber(data.accountNumber) || data.status === "pending_approval" || d.id.startsWith("user-")) {
              await deleteDoc(doc(fsDb, FS_COLLECTIONS.CONSUMERS, d.id)).catch(() => {});
            }
          }
        }
        if (uid) {
          const snapU = await getDocs(query(collection(fsDb, FS_COLLECTIONS.CONSUMERS), where("linkedUserId", "==", uid), limit(15)));
          for (const d of snapU.docs) {
            if (docIds.has(d.id)) continue;
            const data = d.data() as MobileConsumerRecord;
            if (!isRealAccountNumber(data.accountNumber) || data.status === "pending_approval") {
              await deleteDoc(doc(fsDb, FS_COLLECTIONS.CONSUMERS, d.id)).catch(() => {});
            }
          }
        }
      } catch {}
    })();
    writes.push(cleanupTwinTask);
  }

  if (userPatch && (uid || cleanEmail || userPatch.id || userPatch.email)) {
    const uEmail = String(userPatch.email || cleanEmail || "").trim().toLowerCase();
    const uId = String(userPatch.id || uid || "").trim();
    const cleanUser = sanitizePayload({
      ...userPatch,
      ...(uId ? { id: uId } : {}),
      ...(uEmail ? { email: uEmail } : {}),
    });
    if (uId && !uId.startsWith("email_")) {
      writes.push(setDoc(doc(fsDb, FS_COLLECTIONS.USERS, sanitizeDocId(uId)), cleanUser, { merge: true }).catch(() => {}));
    }
    if (uEmail) {
      writes.push(
        setDoc(doc(fsDb, FS_COLLECTIONS.USERS, sanitizeEmailDocId(uEmail)), cleanUser, { merge: true }).catch(() => {})
      );
    }
  }

  if (notif && notif.id) {
    const cleanNotif = sanitizePayload({
      ...notif,
      consumerEmail: notif.consumerEmail ? notif.consumerEmail.trim().toLowerCase() : undefined,
    });
    writes.push(
      setDoc(doc(fsDb, FS_COLLECTIONS.NOTIFICATIONS, sanitizeDocId(notif.id)), cleanNotif, { merge: true }).catch(() => {})
    );
  }

  await Promise.all(writes);
}

// ==========================================
// 1. PRIMARY CONSUMER ENDPOINTS (PORTAL & MOBILE SYNC)
// ==========================================

app.get("/api/consumers", async (req, res) => {
  try {
    const { zone, barangay, search, status, includePending } = req.query;
    const portalHeader = String(req.headers["x-portal"] || "").toLowerCase();
    const roleHeader = String(req.headers["x-role"] || "").toLowerCase();
    const isPortalAdminOrConsumer =
      portalHeader === "admin" ||
      portalHeader === "consumer" ||
      roleHeader === "admin" ||
      includePending === "true" ||
      status === "pending_approval";

    let list = await fetchAllConsumersFromFirestore();

    // Mobile Meter Reader App strictly receives validated consumers with issued IDs & meters
    if (!isPortalAdminOrConsumer) {
      list = list.filter(isValidatedConsumerForReader);
    }

    if (barangay && typeof barangay === "string" && barangay.trim() !== "" && barangay !== "All") {
      const bFilter = barangay.trim().toLowerCase();
      list = list.filter((c) => (c.barangay || "").toLowerCase() === bFilter);
    } else if (zone && typeof zone === "string" && zone.trim() !== "" && zone !== "All") {
      const zFilter = zone.replace(/^Zone\s*\d+\s*[-:]\s*/i, "").trim().toLowerCase();
      list = list.filter(
        (c) => (c.barangay || "").toLowerCase().includes(zFilter) || (c.address || "").toLowerCase().includes(zFilter)
      );
    }

    if (search && typeof search === "string" && search.trim() !== "") {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.accountNumber || "").toLowerCase().includes(q) ||
          (c.meterNumber || "").toLowerCase().includes(q) ||
          (c.email || "").toLowerCase().includes(q)
      );
    }

    if (status && typeof status === "string" && status.trim() !== "" && status !== "all") {
      list = list.filter((c) => c.status === status);
    }

    res.json({
      success: true,
      count: list.length,
      consumers: list,
      data: list,
    });
  } catch {
    res.status(200).json({
      success: true,
      count: syncedConsumers.length,
      consumers: syncedConsumers,
      data: syncedConsumers,
    });
  }
});

// POST /api/consumers/reconcile - Bidirectional Multi-Device Sync
app.post("/api/consumers/reconcile", async (req, res) => {
  try {
    const incomingConsumers: MobileConsumerRecord[] = Array.isArray(req.body?.consumers) ? req.body.consumers : [];
    const incomingUsers: PortalSyncUser[] = Array.isArray(req.body?.users) ? req.body.users : [];
    const incomingNotifs: PortalNotification[] = Array.isArray(req.body?.notifications) ? req.body.notifications : [];

    const writeTasks: Promise<unknown>[] = [];

    for (const c of incomingConsumers) {
      if (isRealAccountNumber(c.accountNumber) && c.status !== "pending_approval") {
        const acc = String(c.accountNumber).trim().toUpperCase();
        const isPortalLinked = Boolean(
          c.linkedUserId ||
            c.email ||
            acc.startsWith("BRG-") ||
            /^(PB|NT|BL|SA|SC|MH|GR|CS|SG)-\d+/i.test(acc)
        );
        if (isPortalLinked) {
          const matchedU = incomingUsers.find(
            (u) =>
              (c.email && u.email && u.email.toLowerCase() === c.email.toLowerCase()) ||
              (c.linkedUserId && u.id === c.linkedUserId) ||
              (u.linkedAccountNumber && u.linkedAccountNumber.toUpperCase() === acc)
          );
          const matchedN = incomingNotifs.find(
            (n) =>
              n.type === "account_issue" &&
              !(n.title || "").toLowerCase().includes("registration application submitted") &&
              ((n.accountNumber || "").toUpperCase() === acc ||
                (c.email && n.consumerEmail && n.consumerEmail.toLowerCase() === c.email.toLowerCase()))
          );
          const fallbackNotif: PortalNotification = matchedN || {
            id: `notif-issued-${acc.replace(/[^a-zA-Z0-9]/g, "")}`,
            accountNumber: acc,
            consumerId: c.id,
            userId: c.linkedUserId || matchedU?.id,
            consumerEmail: (c.email || matchedU?.email || "").trim().toLowerCase() || undefined,
            title: "Official Account Number & Meter Issued!",
            message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${acc} and Meter Serial is #${c.meterNumber || `MT-${acc}`}. Smart RFID Tag: ${c.rfidTag || `RFID-MT-${acc}`}. Your full dashboard and telemetry are now active.`,
            timestamp: new Date().toISOString(),
            type: "account_issue",
            read: false,
          };
          const userPatch: Partial<PortalSyncUser> | undefined =
            c.linkedUserId || c.email || matchedU
              ? {
                  ...(matchedU || {}),
                  id: matchedU?.id || c.linkedUserId || "",
                  email: (c.email || matchedU?.email || "").trim().toLowerCase(),
                  name: c.name || matchedU?.name || "Consumer",
                  role: "consumer",
                  status: "active",
                  linkedAccountNumber: acc,
                }
              : undefined;

          writeTasks.push(saveConsumerToFirestore(c, userPatch, fallbackNotif));
        }
      }
    }

    for (const u of incomingUsers) {
      if (u && (u.id || u.email) && u.role !== "admin") {
        const uEmail = String(u.email || "").trim().toLowerCase();
        const cleanU = sanitizePayload({ ...u, ...(uEmail ? { email: uEmail } : {}) });
        if (u.id && !u.id.startsWith("email_")) {
          writeTasks.push(
            setDoc(doc(fsDb, FS_COLLECTIONS.USERS, sanitizeDocId(u.id)), cleanU, { merge: true }).catch(() => {})
          );
        }
        if (uEmail) {
          writeTasks.push(
            setDoc(doc(fsDb, FS_COLLECTIONS.USERS, sanitizeEmailDocId(uEmail)), cleanU, { merge: true }).catch(() => {})
          );
        }
      }
    }

    for (const n of incomingNotifs) {
      if (n && n.id && n.title) {
        writeTasks.push(
          setDoc(
            doc(fsDb, FS_COLLECTIONS.NOTIFICATIONS, sanitizeDocId(n.id)),
            sanitizePayload({
              ...n,
              consumerEmail: n.consumerEmail ? n.consumerEmail.trim().toLowerCase() : undefined,
            }),
            { merge: true }
          ).catch(() => {})
        );
      }
    }

    if (writeTasks.length > 0) {
      await Promise.all(writeTasks);
    }

    syncedConsumers = mergeConsumersList([...incomingConsumers, ...syncedConsumers]);
    const mergedAll = await fetchAllConsumersFromFirestore();

    res.json({
      success: true,
      count: mergedAll.length,
      consumers: mergedAll,
      data: mergedAll,
    });
  } catch {
    res.status(200).json({
      success: true,
      count: syncedConsumers.length,
      consumers: syncedConsumers,
      data: syncedConsumers,
    });
  }
});

// POST /api/consumers/resolve-account - Authoritative Case-Insensitive Cross-Device Account & ID Resolution
app.post("/api/consumers/resolve-account", async (req, res) => {
  try {
    const { email, userId, accountNumber, name, contactNumber, password, verifyPassword, includeAuthMeta } = req.body || {};
    const rawEmail = String(email || "").trim();
    const cleanEmail = rawEmail.toLowerCase();
    const cleanUid = String(userId || "").trim();
    const cleanAcc = isRealAccountNumber(accountNumber) ? String(accountNumber).replace(/^#/, "").trim().toUpperCase() : "";
    const cleanName = String(name || "").trim().toLowerCase();
    const cleanPhone = normalizePhone(contactNumber);

    // 1. Prepend warm in-memory users first so password updates take immediate effect even during Firestore quota cooldown
    const userCandidates: PortalSyncUser[] = [];
    syncedUsers.forEach((u) => {
      const uEmail = (u.email || "").trim().toLowerCase();
      const uAcc = isRealAccountNumber(u.linkedAccountNumber) ? u.linkedAccountNumber!.trim().toUpperCase() : "";
      if (
        (cleanEmail && uEmail === cleanEmail) ||
        (cleanUid && u.id === cleanUid) ||
        (cleanAcc && uAcc === cleanAcc)
      ) {
        userCandidates.push(u);
      }
    });

    if (canReadFs()) {
      if (cleanEmail) {
        const eDoc = await getDoc(doc(fsDb, FS_COLLECTIONS.USERS, sanitizeEmailDocId(cleanEmail))).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (eDoc && eDoc.exists()) userCandidates.push(eDoc.data() as PortalSyncUser);
        const uSnap = await getDocs(
          query(collection(fsDb, FS_COLLECTIONS.USERS), where("email", "==", cleanEmail), limit(5))
        ).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (uSnap) uSnap.forEach((d) => userCandidates.push({ id: d.id, ...(d.data() as PortalSyncUser) }));
        if (rawEmail && rawEmail !== cleanEmail) {
          const rawSnap = await getDocs(
            query(collection(fsDb, FS_COLLECTIONS.USERS), where("email", "==", rawEmail), limit(5))
          ).catch((err) => {
            recordFsErr(err, "read");
            return null;
          });
          if (rawSnap) rawSnap.forEach((d) => userCandidates.push({ id: d.id, ...(d.data() as PortalSyncUser) }));
        }
      }
      if (cleanUid) {
        const idDoc = await getDoc(doc(fsDb, FS_COLLECTIONS.USERS, sanitizeDocId(cleanUid))).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (idDoc && idDoc.exists()) userCandidates.push(idDoc.data() as PortalSyncUser);
      }

      if (userCandidates.length === 0 && (cleanEmail || cleanUid)) {
        const allUsers = await fetchAllUsersFromFirestore();
        allUsers.forEach((u) => {
          if ((cleanEmail && (u.email || "").trim().toLowerCase() === cleanEmail) || (cleanUid && u.id === cleanUid)) {
            userCandidates.push(u);
          }
        });
      }
    }

    let resolvedUser: PortalSyncUser | null = null;
    for (const u of userCandidates) {
      if (!resolvedUser) {
        resolvedUser = { ...u };
      } else {
        const hasAcc = isRealAccountNumber(u.linkedAccountNumber);
        const prevAcc = isRealAccountNumber(resolvedUser.linkedAccountNumber);
        const uPwTs = Number(u.passwordUpdatedAt || 0);
        const prevPwTs = Number(resolvedUser.passwordUpdatedAt || 0);
        const chosenPassword =
          uPwTs > prevPwTs
            ? u.password || resolvedUser.password
            : prevPwTs > uPwTs
              ? resolvedUser.password || u.password
              : resolvedUser.password || u.password;
        const chosenPwTs = Math.max(uPwTs, prevPwTs) || undefined;
        resolvedUser = {
          ...resolvedUser,
          ...u,
          id: resolvedUser.id && !resolvedUser.id.startsWith("email_") ? resolvedUser.id : u.id,
          linkedAccountNumber: hasAcc
            ? u.linkedAccountNumber
            : prevAcc
              ? resolvedUser.linkedAccountNumber
              : u.linkedAccountNumber,
          status:
            hasAcc || prevAcc || u.status === "active" || resolvedUser.status === "active"
              ? "active"
              : u.status || resolvedUser.status,
          password: chosenPassword,
          ...(chosenPwTs ? { passwordUpdatedAt: chosenPwTs } : {}),
        };
      }
    }

    const passwordVerified = Boolean(
      resolvedUser?.password && password !== undefined && resolvedUser.password === String(password).trim()
    );

    if (
      verifyPassword &&
      resolvedUser?.password &&
      password !== undefined &&
      !passwordVerified
    ) {
      return res.status(401).json({
        success: false,
        authFailed: true,
        message: "Incorrect account password.",
      });
    }

    const effectiveAcc =
      cleanAcc ||
      (resolvedUser && isRealAccountNumber(resolvedUser.linkedAccountNumber)
        ? resolvedUser.linkedAccountNumber!.trim().toUpperCase()
        : "");
    const effectiveEmail = cleanEmail || (resolvedUser?.email || "").trim().toLowerCase();
    const effectiveUid = cleanUid || (resolvedUser?.id || "").trim();

    // 2. Resolve Consumer from warm cache + Firestore
    const consumerCandidates: MobileConsumerRecord[] = [];
    syncedConsumers.forEach((c) => {
      const cEmail = (c.email || "").trim().toLowerCase();
      const cPhone = normalizePhone(c.contactNumber);
      const cName = (c.name || "").trim().toLowerCase();
      if (
        (effectiveAcc && (c.accountNumber || "").toUpperCase() === effectiveAcc) ||
        (effectiveEmail && cEmail === effectiveEmail) ||
        (effectiveUid && c.linkedUserId === effectiveUid) ||
        (cleanPhone && cPhone && cleanPhone === cPhone) ||
        (cleanName && cName === cleanName && (!effectiveEmail || !cEmail || effectiveEmail === cEmail))
      ) {
        consumerCandidates.push(c);
      }
    });

    if (canReadFs()) {
      if (effectiveAcc) {
        const aDoc = await getDoc(doc(fsDb, FS_COLLECTIONS.CONSUMERS, sanitizeDocId(effectiveAcc))).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (aDoc && aDoc.exists()) consumerCandidates.push(aDoc.data() as MobileConsumerRecord);
        const aSnap = await getDocs(
          query(collection(fsDb, FS_COLLECTIONS.CONSUMERS), where("accountNumber", "==", effectiveAcc), limit(3))
        ).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (aSnap) aSnap.forEach((d) => consumerCandidates.push(d.data() as MobileConsumerRecord));
      }
      if (effectiveEmail) {
        const eDoc = await getDoc(doc(fsDb, FS_COLLECTIONS.CONSUMERS, sanitizeEmailDocId(effectiveEmail))).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (eDoc && eDoc.exists()) consumerCandidates.push(eDoc.data() as MobileConsumerRecord);
        const eSnap = await getDocs(
          query(collection(fsDb, FS_COLLECTIONS.CONSUMERS), where("email", "==", effectiveEmail), limit(5))
        ).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (eSnap) eSnap.forEach((d) => consumerCandidates.push(d.data() as MobileConsumerRecord));
        if (rawEmail && rawEmail !== effectiveEmail) {
          const rawCSnap = await getDocs(
            query(collection(fsDb, FS_COLLECTIONS.CONSUMERS), where("email", "==", rawEmail), limit(5))
          ).catch((err) => {
            recordFsErr(err, "read");
            return null;
          });
          if (rawCSnap) rawCSnap.forEach((d) => consumerCandidates.push(d.data() as MobileConsumerRecord));
        }
      }
      if (effectiveUid) {
        const uDoc = await getDoc(doc(fsDb, FS_COLLECTIONS.CONSUMERS, sanitizeDocId(effectiveUid))).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (uDoc && uDoc.exists()) consumerCandidates.push(uDoc.data() as MobileConsumerRecord);
        const uSnap = await getDocs(
          query(collection(fsDb, FS_COLLECTIONS.CONSUMERS), where("linkedUserId", "==", effectiveUid), limit(5))
        ).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (uSnap) uSnap.forEach((d) => consumerCandidates.push(d.data() as MobileConsumerRecord));
      }

      const hasIssuedDirect = consumerCandidates.some(
        (c) => isRealAccountNumber(c.accountNumber) && c.status !== "pending_approval"
      );
      if (!hasIssuedDirect) {
        const allConsumers = await fetchAllConsumersFromFirestore();
        allConsumers.forEach((c) => {
          const cEmail = (c.email || "").trim().toLowerCase();
          const cPhone = normalizePhone(c.contactNumber);
          const cName = (c.name || "").trim().toLowerCase();
          if (
            (effectiveAcc && (c.accountNumber || "").toUpperCase() === effectiveAcc) ||
            (effectiveEmail && cEmail === effectiveEmail) ||
            (effectiveUid && c.linkedUserId === effectiveUid) ||
            (cleanPhone && cPhone && cleanPhone === cPhone) ||
            (cleanName && cName === cleanName && (!effectiveEmail || !cEmail || effectiveEmail === cEmail))
          ) {
            consumerCandidates.push(c);
          }
        });
      }
    }

    const mergedConsumers = mergeConsumersList(consumerCandidates);
    mergedConsumers.sort((a, b) => {
      const aIss = isRealAccountNumber(a.accountNumber) && a.status !== "pending_approval" ? 1 : 0;
      const bIss = isRealAccountNumber(b.accountNumber) && b.status !== "pending_approval" ? 1 : 0;
      return bIss - aIss;
    });

    let resolvedConsumer = mergedConsumers[0] || null;
    if (resolvedConsumer && !isRealAccountNumber(resolvedConsumer.accountNumber) && effectiveAcc) {
      resolvedConsumer = {
        ...resolvedConsumer,
        accountNumber: effectiveAcc,
        meterNumber:
          resolvedConsumer.meterNumber && !String(resolvedConsumer.meterNumber).toUpperCase().startsWith("PENDING")
            ? resolvedConsumer.meterNumber
            : `MT-${effectiveAcc}`,
        rfidTag:
          resolvedConsumer.rfidTag && !String(resolvedConsumer.rfidTag).toUpperCase().startsWith("PENDING")
            ? resolvedConsumer.rfidTag
            : `RFID-MT-${effectiveAcc}`,
        status: "active",
      };
    }

    const isIssued = Boolean(
      resolvedConsumer && isRealAccountNumber(resolvedConsumer.accountNumber) && resolvedConsumer.status !== "pending_approval"
    );
    const finalAcc = isIssued && resolvedConsumer ? resolvedConsumer.accountNumber.trim().toUpperCase() : effectiveAcc;

    // Synthesize User record if consumer exists in Firestore `consumers` even when `users` doc was missing
    if (!resolvedUser && resolvedConsumer && (effectiveEmail || resolvedConsumer.email || resolvedConsumer.linkedUserId)) {
      resolvedUser = {
        id: resolvedConsumer.linkedUserId || effectiveUid || `user-${Date.now()}`,
        email: (resolvedConsumer.email || effectiveEmail || "").trim().toLowerCase(),
        name: resolvedConsumer.name,
        role: "consumer",
        status: isIssued ? "active" : "pending_approval",
        linkedAccountNumber: isIssued ? finalAcc : undefined,
        contactNumber: resolvedConsumer.contactNumber,
        registrationDate: resolvedConsumer.registrationDate,
      };
    }

    // 3. Resolve Notifications from warm cache + Firestore
    const notifMap = new Map<string, PortalNotification>();
    syncedNotifications.forEach((n) => {
      if (
        (finalAcc && (n.accountNumber || "").toUpperCase() === finalAcc) ||
        (effectiveEmail && (n.consumerEmail || "").toLowerCase() === effectiveEmail) ||
        (effectiveUid && n.userId === effectiveUid)
      ) {
        notifMap.set(n.id, n);
      }
    });

    if (canReadFs()) {
      const collectNotifs = async (field: string, value: string) => {
        if (!value) return;
        const snap = await getDocs(
          query(collection(fsDb, FS_COLLECTIONS.NOTIFICATIONS), where(field, "==", value), limit(30))
        ).catch((err) => {
          recordFsErr(err, "read");
          return null;
        });
        if (snap) {
          snap.forEach((d) => {
            const n = d.data() as PortalNotification;
            if (n && n.title) notifMap.set(n.id || d.id, { ...n, id: n.id || d.id });
          });
        }
      };

      await Promise.all([
        collectNotifs("accountNumber", finalAcc),
        collectNotifs("consumerEmail", effectiveEmail),
        ...(rawEmail && rawEmail !== effectiveEmail ? [collectNotifs("consumerEmail", rawEmail)] : []),
        collectNotifs("userId", effectiveUid || resolvedConsumer?.linkedUserId || ""),
      ]);
    }

    const notifications = Array.from(notifMap.values());

    // Self-heal issuance notification & active user link ONLY when notification was genuinely missing
    if (isIssued && resolvedConsumer) {
      const hasIssuanceNotif = notifications.some(
        (n) => n.type === "account_issue" && !(n.title || "").toLowerCase().includes("registration application submitted")
      );
      let backfilledNotif: PortalNotification | undefined;
      if (!hasIssuanceNotif) {
        backfilledNotif = {
          id: `notif-issued-${finalAcc.replace(/[^a-zA-Z0-9]/g, "")}`,
          accountNumber: finalAcc,
          consumerId: resolvedConsumer.id,
          userId: effectiveUid || resolvedConsumer.linkedUserId,
          consumerEmail: (effectiveEmail || resolvedConsumer.email || "").trim().toLowerCase() || undefined,
          title: "Official Account Number & Meter Issued!",
          message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${finalAcc} and Meter Serial is #${resolvedConsumer.meterNumber}. Smart RFID Tag: ${resolvedConsumer.rfidTag}. Your full dashboard and telemetry are now active.`,
          timestamp: new Date().toISOString(),
          type: "account_issue",
          read: false,
        };
        notifications.unshift(backfilledNotif);
      }

      if (resolvedUser) {
        resolvedUser = {
          ...resolvedUser,
          linkedAccountNumber: finalAcc,
          status: "active",
        };
      }

      if (backfilledNotif && canWriteFs()) {
        await saveConsumerToFirestore(resolvedConsumer, resolvedUser || undefined, backfilledNotif);
      }
    }

    const safeUser = resolvedUser
      ? includeAuthMeta
        ? resolvedUser
        : (() => {
            const { password: _pw, ...rest } = resolvedUser;
            return rest;
          })()
      : null;

    res.json({
      success: true,
      isIssued,
      passwordVerified,
      user: safeUser,
      consumer: resolvedConsumer,
      notifications,
    });
  } catch {
    res.status(200).json({
      success: false,
      isIssued: false,
      user: null,
      consumer: null,
      notifications: [],
    });
  }
});

// POST /api/consumers/change-password - Authoritative Consumer Password Update across all user documents
app.post("/api/consumers/change-password", async (req, res) => {
  try {
    const { userId, email, accountNumber, currentPassword, newPassword, passwordUpdatedAt } = req.body || {};
    const cleanNewPassword = String(newPassword || "").trim();
    const cleanCurrentPassword = currentPassword !== undefined ? String(currentPassword).trim() : "";
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanUid = String(userId || "").trim();
    const cleanAcc = isRealAccountNumber(accountNumber) ? String(accountNumber).replace(/^#/, "").trim().toUpperCase() : "";
    const updatedTs = Number(passwordUpdatedAt) || Date.now();

    if (!cleanNewPassword || cleanNewPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long.",
      });
    }

    if (cleanCurrentPassword && cleanNewPassword === cleanCurrentPassword) {
      return res.status(400).json({
        success: false,
        message: "New password cannot be the same as your current or previous password.",
      });
    }

    const allUsers = await fetchAllUsersFromFirestore();
    const matchingUsers = allUsers.filter((u) => {
      const uEmail = (u.email || "").trim().toLowerCase();
      const uAcc = isRealAccountNumber(u.linkedAccountNumber) ? u.linkedAccountNumber!.trim().toUpperCase() : "";
      return (
        (cleanUid && u.id === cleanUid) ||
        (cleanEmail && uEmail === cleanEmail) ||
        (cleanAcc && uAcc === cleanAcc)
      );
    });

    // Pick candidate with newest passwordUpdatedAt to verify currentPassword accurately
    let primaryUser: PortalSyncUser | null = null;
    for (const u of matchingUsers) {
      if (!primaryUser || Number(u.passwordUpdatedAt || 0) >= Number(primaryUser.passwordUpdatedAt || 0)) {
        primaryUser = { ...(primaryUser || {}), ...u, password: u.password || primaryUser?.password };
      }
    }

    if (primaryUser?.password) {
      if (primaryUser.password === cleanNewPassword) {
        return res.status(400).json({
          success: false,
          message: "New password cannot be the same as your current or previous password.",
        });
      }
      if (cleanCurrentPassword && primaryUser.password !== cleanCurrentPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password entered is incorrect.",
        });
      }
    }

    const effectiveId =
      (primaryUser?.id && !primaryUser.id.startsWith("email_") ? primaryUser.id : "") ||
      cleanUid ||
      (cleanEmail ? sanitizeEmailDocId(cleanEmail) : `user-${Date.now()}`);
    const effectiveEmail = cleanEmail || (primaryUser?.email || "").trim().toLowerCase();

    const updatedUserRecord: PortalSyncUser = {
      id: effectiveId,
      email: effectiveEmail,
      name: primaryUser?.name || "Consumer",
      role: primaryUser?.role || "consumer",
      status: primaryUser?.status || (cleanAcc ? "active" : "pending_approval"),
      linkedAccountNumber: cleanAcc || primaryUser?.linkedAccountNumber,
      contactNumber: primaryUser?.contactNumber,
      registrationDate: primaryUser?.registrationDate,
      password: cleanNewPassword,
      passwordUpdatedAt: updatedTs,
    };

    let matchedInMem = false;
    syncedUsers = syncedUsers.map((u) => {
      const uEmail = (u.email || "").trim().toLowerCase();
      const uAcc = isRealAccountNumber(u.linkedAccountNumber) ? u.linkedAccountNumber!.trim().toUpperCase() : "";
      if (
        (effectiveId && u.id === effectiveId) ||
        (cleanUid && u.id === cleanUid) ||
        (effectiveEmail && uEmail === effectiveEmail) ||
        (cleanAcc && uAcc === cleanAcc)
      ) {
        matchedInMem = true;
        return {
          ...u,
          password: cleanNewPassword,
          passwordUpdatedAt: updatedTs,
        };
      }
      return u;
    });
    if (!matchedInMem) {
      syncedUsers.unshift(updatedUserRecord);
    }

    if (canWriteFs()) {
      const userDocIds = new Set<string>();
      if (effectiveId && !effectiveId.startsWith("email_")) userDocIds.add(sanitizeDocId(effectiveId));
      if (cleanUid && !cleanUid.startsWith("email_")) userDocIds.add(sanitizeDocId(cleanUid));
      if (effectiveEmail) userDocIds.add(sanitizeEmailDocId(effectiveEmail));

      const cleanPayload = sanitizePayload(updatedUserRecord);
      await Promise.all(
        Array.from(userDocIds).map((docId) =>
          setDoc(doc(fsDb, FS_COLLECTIONS.USERS, docId), cleanPayload, { merge: true }).catch((err) =>
            recordFsErr(err, "write")
          )
        )
      );
    }

    const { password: _pw, ...safeUser } = updatedUserRecord;
    res.json({
      success: true,
      message: "Account password updated successfully.",
      passwordUpdatedAt: updatedTs,
      user: safeUser,
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Unable to update account password right now.",
    });
  }
});

// GET /api/consumers/:accountNumber
app.get("/api/consumers/:accountNumber", async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const all = await fetchAllConsumersFromFirestore();
    const consumer = all.find(
      (c) =>
        c.accountNumber === accountNumber ||
        c.meterNumber === accountNumber ||
        c.linkedUserId === accountNumber ||
        (c.email && c.email.toLowerCase() === accountNumber.toLowerCase())
    );

    if (!consumer) {
      return res.status(404).json({
        success: false,
        message: `Consumer account ${accountNumber} not found.`,
      });
    }

    res.json({
      success: true,
      consumer,
      data: consumer,
    });
  } catch {
    res.status(404).json({ success: false, message: "Consumer record not found." });
  }
});

// POST /api/consumers/register - Self-Registration endpoint for Consumers from any device
app.post("/api/consumers/register", async (req, res) => {
  try {
    const {
      name,
      fullName,
      email,
      contactNumber,
      address,
      barangay,
      barangayId,
      sitioZone,
      consumerType,
      meterSize,
      householdInfo,
      businessName,
      businessType,
      linkedUserId,
      password,
    } = req.body || {};

    const consumerName = String(name || fullName || "").trim();
    if (!consumerName) {
      return res.status(400).json({
        success: false,
        message: "Consumer full name is required for registration.",
      });
    }

    const cleanEmail = String(email || "").trim().toLowerCase();
    const userId = linkedUserId || `user-${Date.now()}`;
    const cleanPhone = normalizePhone(contactNumber) || contactNumber || "";

    const allExisting = await fetchAllConsumersFromFirestore();
    const existing = allExisting.find(
      (c) => (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) || (c.linkedUserId && c.linkedUserId === userId)
    );

    if (existing && isRealAccountNumber(existing.accountNumber) && existing.status !== "pending_approval") {
      return res.status(200).json({
        success: true,
        message: "Account already registered and active.",
        consumer: existing,
      });
    }

    const record: MobileConsumerRecord = {
      accountNumber: "",
      name: consumerName,
      address: address || `${sitioZone || "Zone 1"}, ${barangay || "Poblacion"}, Tagoloan, Misamis Oriental`,
      barangay: barangay || "Poblacion",
      barangayId: barangayId || "BRG-01",
      sitioZone: sitioZone || "Zone 1",
      meterNumber: "",
      previousReading: 0,
      lastReadingDate: new Date().toISOString().split("T")[0],
      meterSize: meterSize || "1/2 inch",
      consumerType: consumerType === "Commercial" ? "Commercial" : "Residential",
      status: "pending_approval",
      contactNumber: cleanPhone,
      email: cleanEmail,
      rfidTag: "",
      registrationDate: new Date().toISOString().split("T")[0],
      linkedUserId: userId,
      householdInfo: householdInfo || undefined,
      businessName: businessName || undefined,
      businessType: businessType || undefined,
      isRegistered: true,
    };

    const userRecord: PortalSyncUser = {
      id: userId,
      email: cleanEmail,
      name: consumerName,
      password: password ? String(password) : undefined,
      role: "consumer",
      status: "pending_approval",
      contactNumber: cleanPhone,
      registrationDate: record.registrationDate,
    };

    const welcomeNotif: PortalNotification = {
      id: `notif-reg-${userId}`,
      accountNumber: "PENDING",
      userId,
      consumerEmail: cleanEmail,
      title: "Registration Application Submitted",
      message: `Your registration application for Barangay ${record.barangay}, ${record.sitioZone} has been submitted. The administration office will review and issue your official Account Number and Meter Tag shortly.`,
      timestamp: new Date().toISOString(),
      type: "account_issue",
      read: false,
    };

    syncedConsumers.unshift(record);
    syncedUsers.unshift(userRecord);
    syncedNotifications.unshift(welcomeNotif);

    await saveConsumerToFirestore(record, userRecord, welcomeNotif);

    res.status(201).json({
      success: true,
      message: "Registration application received. Waiting for admin approval.",
      consumer: record,
    });
  } catch {
    res.status(200).json({ success: false, message: "Failed to submit registration application." });
  }
});

// POST /api/consumers - Add or Sync Consumer Record (including Admin ID Issuance)
app.post("/api/consumers", async (req, res) => {
  try {
    const {
      id,
      accountNumber,
      name,
      address,
      barangay,
      barangayId,
      sitioZone,
      meterNumber,
      previousReading,
      lastReadingDate,
      meterSize,
      consumerType,
      status,
      contactNumber,
      email,
      rfidTag,
      registrationDate,
      linkedUserId,
      householdInfo,
      businessName,
      businessType,
      isRegistered,
    } = req.body || {};

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required.",
      });
    }

    const cleanAcc = isRealAccountNumber(accountNumber) ? String(accountNumber).trim().toUpperCase() : "";
    const cleanEmail = String(email || "").trim().toLowerCase();
    const resolvedMeter =
      meterNumber && !String(meterNumber).toUpperCase().startsWith("PENDING")
        ? String(meterNumber).trim()
        : cleanAcc
          ? `MT-${cleanAcc}`
          : "";
    const resolvedRfid =
      rfidTag && !String(rfidTag).toUpperCase().startsWith("PENDING")
        ? String(rfidTag).trim()
        : resolvedMeter
          ? `RFID-${resolvedMeter}`
          : "";

    const record: MobileConsumerRecord = {
      id,
      accountNumber: cleanAcc,
      name: String(name).trim(),
      address: address || "Tagoloan, Misamis Oriental",
      barangay: barangay || "Poblacion",
      barangayId,
      sitioZone: sitioZone || "Zone 1",
      meterNumber: resolvedMeter,
      previousReading: Number(previousReading) || 0,
      lastReadingDate: lastReadingDate || new Date().toISOString().split("T")[0],
      meterSize: meterSize || "1/2 inch",
      consumerType: consumerType === "Commercial" ? "Commercial" : "Residential",
      status: cleanAcc ? (status === "pending_approval" ? "active" : status || "active") : status || "pending_approval",
      contactNumber: contactNumber || "",
      email: cleanEmail,
      rfidTag: resolvedRfid,
      registrationDate: registrationDate || new Date().toISOString().split("T")[0],
      linkedUserId,
      householdInfo,
      businessName,
      businessType,
      isRegistered: isRegistered !== undefined ? isRegistered : true,
    };

    const existingConsumer = syncedConsumers.find(
      (c) =>
        (cleanAcc && c.accountNumber && c.accountNumber.toUpperCase() === cleanAcc) ||
        (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) ||
        (linkedUserId && c.linkedUserId === linkedUserId)
    );
    const wasAlreadyIssuedSameAcc = Boolean(
      existingConsumer &&
        isRealAccountNumber(existingConsumer.accountNumber) &&
        existingConsumer.status !== "pending_approval" &&
        existingConsumer.accountNumber.toUpperCase() === cleanAcc
    );

    syncedConsumers = mergeConsumersList([record, ...syncedConsumers]);

    let userPatch: Partial<PortalSyncUser> | undefined;
    let issuedNotif: PortalNotification | undefined;

    if (cleanAcc && record.status !== "pending_approval") {
      userPatch = {
        ...(linkedUserId ? { id: linkedUserId } : {}),
        ...(cleanEmail ? { email: cleanEmail } : {}),
        name: record.name,
        role: "consumer",
        status: "active",
        linkedAccountNumber: cleanAcc,
      };
      if (!wasAlreadyIssuedSameAcc) {
        issuedNotif = {
          id: `notif-issued-${cleanAcc.replace(/[^a-zA-Z0-9]/g, "")}`,
          accountNumber: cleanAcc,
          consumerId: record.id,
          userId: linkedUserId,
          consumerEmail: cleanEmail || undefined,
          title: "Official Account Number & Meter Issued!",
          message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${cleanAcc} and Meter Serial is #${resolvedMeter}. Smart RFID Tag: ${resolvedRfid}. Your full dashboard and telemetry are now active.`,
          timestamp: new Date().toISOString(),
          type: "account_issue",
          read: false,
        };
      }
    }

    await saveConsumerToFirestore(record, userPatch, issuedNotif);

    res.status(201).json({
      success: true,
      message: "Consumer saved successfully.",
      consumer: record,
      notification: issuedNotif,
    });
  } catch {
    res.status(200).json({ success: false, message: "Failed to save consumer." });
  }
});

// POST /api/consumers/:identifier/issue-id & PATCH /api/consumers/:identifier
app.all(["/api/consumers/:identifier/issue-id", "/api/consumers/:identifier"], async (req, res, next) => {
  if (req.method === "GET" || req.method === "DELETE") return next();
  if (req.method !== "PATCH" && req.method !== "POST" && req.method !== "PUT") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  try {
    const { identifier } = req.params;
    const updates = req.body || {};
    const all = await fetchAllConsumersFromFirestore();
    const existing = all.find(
      (c) =>
        c.accountNumber === identifier ||
        (c.email && c.email.toLowerCase() === identifier.toLowerCase()) ||
        c.linkedUserId === identifier ||
        c.id === identifier
    );

    if (!existing && !updates.name) {
      return res.status(404).json({
        success: false,
        message: `Consumer ${identifier} not found in registry.`,
      });
    }

    const updated: MobileConsumerRecord = {
      ...(existing || ({} as MobileConsumerRecord)),
      ...updates,
    };

    const cleanAcc = isRealAccountNumber(updated.accountNumber) ? String(updated.accountNumber).trim().toUpperCase() : "";
    if (cleanAcc) {
      updated.accountNumber = cleanAcc;
      updated.meterNumber =
        updated.meterNumber && !String(updated.meterNumber).toUpperCase().startsWith("PENDING")
          ? String(updated.meterNumber)
          : `MT-${cleanAcc}`;
      updated.rfidTag =
        updated.rfidTag && !String(updated.rfidTag).toUpperCase().startsWith("PENDING")
          ? String(updated.rfidTag)
          : `RFID-${updated.meterNumber}`;
      if (!updated.status || updated.status === "pending_approval") {
        updated.status = "active";
      }
    }

    const wasAlreadyIssuedSameAcc = Boolean(
      existing &&
        isRealAccountNumber(existing.accountNumber) &&
        existing.status !== "pending_approval" &&
        existing.accountNumber.toUpperCase() === cleanAcc
    );

    let userPatch: Partial<PortalSyncUser> | undefined;
    let issuedNotif: PortalNotification | undefined;
    if (cleanAcc && updated.status !== "pending_approval") {
      userPatch = {
        ...(updated.linkedUserId ? { id: updated.linkedUserId } : {}),
        ...(updated.email ? { email: updated.email.trim().toLowerCase() } : {}),
        name: updated.name,
        role: "consumer",
        status: "active",
        linkedAccountNumber: cleanAcc,
      };
      if (!wasAlreadyIssuedSameAcc) {
        issuedNotif = {
          id: `notif-issued-${cleanAcc.replace(/[^a-zA-Z0-9]/g, "")}`,
          accountNumber: cleanAcc,
          consumerId: updated.id,
          userId: updated.linkedUserId,
          consumerEmail: updated.email?.trim().toLowerCase(),
          title: "Official Account Number & Meter Issued!",
          message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${cleanAcc} and Meter Serial is #${updated.meterNumber}. Smart RFID Tag: ${updated.rfidTag}. Your full dashboard and telemetry are now active.`,
          timestamp: new Date().toISOString(),
          type: "account_issue",
          read: false,
        };
      }
    }

    syncedConsumers = mergeConsumersList([updated, ...syncedConsumers]);
    await saveConsumerToFirestore(updated, userPatch, issuedNotif);

    res.json({
      success: true,
      message: `Consumer ${identifier} updated successfully.`,
      consumer: updated,
      notification: issuedNotif,
    });
  } catch {
    res.status(200).json({ success: false, message: "Failed to update consumer." });
  }
});

// DELETE /api/consumers/:identifier
app.delete("/api/consumers/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    syncedConsumers = syncedConsumers.filter(
      (c) =>
        c.accountNumber !== identifier &&
        (!c.email || c.email.toLowerCase() !== identifier.toLowerCase()) &&
        c.linkedUserId !== identifier
    );
    await deleteDoc(doc(fsDb, FS_COLLECTIONS.CONSUMERS, sanitizeDocId(identifier))).catch(() => {});
    if (identifier.includes("@")) {
      await deleteDoc(doc(fsDb, FS_COLLECTIONS.CONSUMERS, sanitizeEmailDocId(identifier))).catch(() => {});
    }
    res.json({
      success: true,
      message: `Consumer ${identifier} removed.`,
      removed: true,
    });
  } catch {
    res.json({ success: true, removed: true });
  }
});

function getPortalNotifSemanticKey(n: Partial<PortalNotification> & Record<string, any>): string {
  const accRaw = String(n.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
  const email = String(n.consumerEmail || "").trim().toLowerCase();
  const uid = String(n.userId || n.consumerId || "").trim().toLowerCase();

  let target = "ANON";
  if (accRaw === "ALL" || accRaw === "BROADCAST" || accRaw === "DISTRICT") {
    target = "BROADCAST";
  } else if (isRealAccountNumber(accRaw)) {
    target = `ACC:${accRaw}`;
  } else if (email) {
    target = `EMAIL:${email}`;
  } else if (uid) {
    target = `UID:${uid}`;
  }

  const type = String(n.type || "announcement").trim().toLowerCase();
  const normTitle = String(n.title || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normMsg = String(n.message || "").trim().replace(/\s+/g, " ").toLowerCase();

  if (type === "account_issue") {
    if (normTitle.includes("registration application submitted")) {
      return `account_issue_reg::${email ? `EMAIL:${email}` : target}`;
    }
    if (normTitle.includes("updated to")) {
      return `account_issue_update::${target}::${normTitle}`;
    }
    return `account_issue_confirmed::${target}`;
  }
  if (type === "disconnection") {
    return `disconnection::${target}::${String(n.billingPeriod || n.readingId || normTitle).trim().toLowerCase()}`;
  }
  if (type === "billing" || type === "balance") {
    const isOverdue = normTitle.includes("overdue") || normTitle.includes("urgent");
    return `${type}::${isOverdue ? "overdue" : "statement"}::${target}::${String(n.readingId || n.billingPeriod || normTitle).trim().toLowerCase()}`;
  }
  if (type === "payment" || type === "receipt_upload") {
    return `${type}::${target}::${String(n.readingId || n.billingPeriod || "").trim().toLowerCase()}::${normTitle}::${normMsg.slice(0, 80)}`;
  }
  if (type === "report") {
    return `report::${target}::${String(n.reportId || n.ticketNumber || "").trim().toLowerCase()}::${normTitle}::${normMsg.slice(0, 140)}`;
  }
  return `${type}::${target}::${normTitle}::${normMsg.slice(0, 140)}`;
}

function dedupePortalNotifications(list: PortalNotification[], maxTotal = 120): PortalNotification[] {
  if (!Array.isArray(list) || list.length === 0) return [];
  const byId = new Map<string, PortalNotification>();
  const bySem = new Map<string, string>();

  for (const raw of list) {
    if (!raw || !raw.title) continue;
    const cleanAcc = String(raw.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const item: PortalNotification = {
      ...raw,
      id: String(raw.id || `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`),
      accountNumber: cleanAcc || raw.accountNumber || "PENDING",
      ...(raw.consumerEmail ? { consumerEmail: String(raw.consumerEmail).trim().toLowerCase() } : {}),
      timestamp: raw.timestamp || "2026-01-01T08:00:00.000Z",
      read: Boolean(raw.read),
    };
    const semKey = getPortalNotifSemanticKey(item);
    const existingId = byId.has(item.id) ? item.id : bySem.get(semKey);
    if (existingId && byId.has(existingId)) {
      const prev = byId.get(existingId)!;
      const merged: PortalNotification = {
        ...prev,
        ...item,
        id: prev.id,
        accountNumber: isRealAccountNumber(item.accountNumber)
          ? item.accountNumber
          : isRealAccountNumber(prev.accountNumber)
            ? prev.accountNumber
            : item.accountNumber || prev.accountNumber,
        consumerEmail: item.consumerEmail || prev.consumerEmail,
        userId: item.userId || prev.userId,
        timestamp: item.type === "account_issue" && prev.timestamp ? prev.timestamp : item.timestamp || prev.timestamp,
        read: Boolean(prev.read || item.read),
      };
      byId.set(prev.id, merged);
      bySem.set(semKey, prev.id);
    } else {
      byId.set(item.id, item);
      bySem.set(semKey, item.id);
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => (new Date(b.timestamp || 0).getTime() || 0) - (new Date(a.timestamp || 0).getTime() || 0))
    .slice(0, maxTotal);
}

// ==========================================
// 2. NOTIFICATIONS ENDPOINTS (CROSS-DEVICE)
// ==========================================
app.get("/api/notifications", async (req, res) => {
  try {
    const accountNumber = String(req.query.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const userId = String(req.query.userId || "").trim();
    const rawEmail = String(req.query.email || "").trim();
    const email = rawEmail.toLowerCase();

    syncedNotifications = dedupePortalNotifications(syncedNotifications, 250);
    const collected: PortalNotification[] = [];

    // Include warm-instance notifications first so notifications remain instant even when Firestore daily write quota is exhausted
    for (const n of syncedNotifications) {
      if (!n || !n.title) continue;
      const nAcc = String(n.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
      const nEmail = String(n.consumerEmail || "").trim().toLowerCase();
      const nUid = String(n.userId || "").trim();
      const isBroadcast = nAcc === "ALL" || nAcc === "BROADCAST" || nAcc === "DISTRICT";
      const matchAcc = accountNumber && !accountNumber.startsWith("PENDING") && nAcc === accountNumber;
      const matchEmail = email && nEmail === email;
      const matchUid = userId && nUid === userId;
      if (isBroadcast || matchAcc || matchEmail || matchUid) {
        collected.push(n);
      }
    }

    const collect = async (field: string, val: string) => {
      if (!canReadFs() || !val || val.toUpperCase().startsWith("PENDING")) return;
      const snap = await withFsTimeout(
        getDocs(query(collection(fsDb, FS_COLLECTIONS.NOTIFICATIONS), where(field, "==", val), limit(40))),
        3500
      ).catch((err) => {
        recordFsErr(err, "read");
        return null;
      });
      if (snap) {
        snap.forEach((d) => {
          const n = d.data() as PortalNotification;
          if (n && n.title) {
            collected.push({ ...n, id: n.id || d.id });
          }
        });
      }
    };

    if (canReadFs()) {
      await Promise.all([
        collect("accountNumber", accountNumber),
        collect("accountNumber", "ALL"),
        collect("consumerEmail", email),
        ...(rawEmail && rawEmail !== email ? [collect("consumerEmail", rawEmail)] : []),
        collect("userId", userId),
      ]);
    }

    const list = dedupePortalNotifications(collected, 80);

    res.json({
      success: true,
      count: list.length,
      notifications: list,
      data: list,
    });
  } catch {
    res.json({ success: true, count: 0, notifications: [], data: [] });
  }
});

app.post("/api/notifications", async (req, res) => {
  try {
    const body = req.body || {};
    const notif: PortalNotification = {
      ...body,
      id: body.id || `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      accountNumber: body.accountNumber ? String(body.accountNumber).replace(/^#/, "").trim().toUpperCase() : "PENDING",
      consumerEmail: body.consumerEmail ? String(body.consumerEmail).trim().toLowerCase() : undefined,
      timestamp: body.timestamp || new Date().toISOString(),
      read: Boolean(body.read),
    };
    const targetSemKey = getPortalNotifSemanticKey(notif);
    const existing = syncedNotifications.find(
      (n) => n.id === notif.id || getPortalNotifSemanticKey(n) === targetSemKey
    );
    if (existing) {
      if (notif.read) existing.read = true;
      if (isRealAccountNumber(notif.accountNumber) && !isRealAccountNumber(existing.accountNumber)) {
        existing.accountNumber = notif.accountNumber;
      }
      return res.status(200).json({ success: true, notification: existing });
    }

    syncedNotifications = dedupePortalNotifications([notif, ...syncedNotifications], 250);
    if (canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.NOTIFICATIONS, sanitizeDocId(notif.id)), sanitizePayload(notif), {
        merge: true,
      }).catch((err) => recordFsErr(err, "write"));
    }
    res.status(201).json({ success: true, notification: notif });
  } catch {
    res.status(200).json({ success: false, message: "Failed to save notification." });
  }
});

app.post("/api/notifications/mark-all-read", async (req, res) => {
  try {
    const { ids, accountNumber, email, userId } = req.body || {};
    const idSet = Array.isArray(ids) && ids.length > 0 ? new Set(ids.map(String)) : null;
    const cleanAcc = String(accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanUid = String(userId || "").trim();

    const updatedIds: string[] = [];
    syncedNotifications.forEach((n) => {
      const nAcc = String(n.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
      if (nAcc === "ALL" || nAcc === "BROADCAST" || nAcc === "DISTRICT") return;
      const matchesId = idSet ? idSet.has(n.id) : false;
      const matchesIdentity =
        !idSet &&
        ((cleanAcc && isRealAccountNumber(cleanAcc) && nAcc === cleanAcc) ||
          (cleanEmail && String(n.consumerEmail || "").trim().toLowerCase() === cleanEmail) ||
          (cleanUid && String(n.userId || "").trim() === cleanUid));
      if ((matchesId || matchesIdentity) && !n.read) {
        n.read = true;
        updatedIds.push(n.id);
      }
    });

    if (canWriteFs()) {
      const targetDocs = (idSet ? Array.from(idSet) : updatedIds).slice(0, 20);
      await Promise.all(
        targetDocs.map((docId) =>
          setDoc(doc(fsDb, FS_COLLECTIONS.NOTIFICATIONS, sanitizeDocId(docId)), { read: true }, { merge: true }).catch(
            (err) => recordFsErr(err, "write")
          )
        )
      );
    }

    res.json({ success: true, updatedCount: updatedIds.length });
  } catch {
    res.json({ success: true, updatedCount: 0 });
  }
});

app.patch("/api/notifications/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    const found = syncedNotifications.find((n) => n.id === id);
    const isBroadcast = found && String(found.accountNumber || "").trim().toUpperCase() === "ALL";
    if (found && !isBroadcast) {
      found.read = true;
    }
    if (!isBroadcast && canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.NOTIFICATIONS, sanitizeDocId(id)), { read: true }, { merge: true }).catch(
        (err) => recordFsErr(err, "write")
      );
    }
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// ==========================================
// 3. CONSUMER SERVICE REPORTS & ADMIN REPLIES
// ==========================================
function upsertReportsIntoSynced(incomingList: ServerConsumerReport[]): ServerConsumerReport[] {
  const map = new Map<string, ServerConsumerReport>();
  for (const r of syncedReports) {
    if (r && (r.id || r.ticketNumber)) {
      const k = r.id || r.ticketNumber;
      map.set(k, { ...r, id: k, replies: Array.isArray(r.replies) ? r.replies : [] });
    }
  }
  for (const ir of incomingList) {
    if (!ir || (!ir.id && !ir.ticketNumber)) continue;
    let matchKey = ir.id && map.has(ir.id) ? ir.id : undefined;
    if (!matchKey && ir.ticketNumber) {
      const entry = Array.from(map.entries()).find(([, v]) => v.ticketNumber === ir.ticketNumber);
      if (entry) matchKey = entry[0];
    }
    if (!matchKey) {
      const newKey = ir.id || ir.ticketNumber;
      map.set(newKey, { ...ir, id: newKey, replies: Array.isArray(ir.replies) ? ir.replies : [] });
    } else {
      map.set(matchKey, mergeServerReportPair(map.get(matchKey)!, ir));
    }
  }
  syncedReports = Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
  return syncedReports;
}

async function loadReportsFromFirestore(): Promise<ServerConsumerReport[]> {
  if (!canReadFs()) return syncedReports;
  try {
    const snap = await getDocs(query(collection(fsDb, FS_COLLECTIONS.REPORTS), limit(200)));
    const fsReports: ServerConsumerReport[] = [];
    snap.forEach((d) => {
      const r = d.data() as ServerConsumerReport;
      if (r && (r.id || d.id)) {
        fsReports.push({ ...r, id: r.id || d.id });
      }
    });
    upsertReportsIntoSynced(fsReports);
  } catch (err) {
    recordFsErr(err, "read");
  }
  return syncedReports;
}

function filterServerReports(
  source: ServerConsumerReport[],
  filters: { accountNumber?: unknown; email?: unknown; status?: unknown; category?: unknown; search?: unknown }
): ServerConsumerReport[] {
  let list = [...source];
  const accRaw = typeof filters.accountNumber === "string" ? filters.accountNumber.trim().toLowerCase() : "";
  const emailRaw = typeof filters.email === "string" ? filters.email.trim().toLowerCase() : "";
  const validAcc = accRaw && !accRaw.startsWith("pending") && accRaw !== "unassigned" ? accRaw : "";

  if (validAcc || emailRaw) {
    list = list.filter((r) => {
      const rAcc = (r.accountNumber || "").trim().toLowerCase();
      const rEmail = (r.consumerEmail || "").trim().toLowerCase();
      return (
        (validAcc && (rAcc === validAcc || rEmail === validAcc)) ||
        (emailRaw && (rEmail === emailRaw || rAcc === emailRaw))
      );
    });
  }
  if (typeof filters.status === "string" && filters.status.trim() !== "" && filters.status !== "all") {
    list = list.filter((r) => r.status === filters.status);
  }
  if (typeof filters.category === "string" && filters.category.trim() !== "" && filters.category !== "all") {
    list = list.filter((r) => r.category === filters.category);
  }
  if (typeof filters.search === "string" && filters.search.trim() !== "") {
    const q = filters.search.trim().toLowerCase();
    list = list.filter(
      (r) =>
        (r.ticketNumber || "").toLowerCase().includes(q) ||
        (r.title || "").toLowerCase().includes(q) ||
        (r.consumerName || "").toLowerCase().includes(q) ||
        (r.accountNumber || "").toLowerCase().includes(q)
    );
  }
  return list;
}

app.get("/api/reports", async (req, res) => {
  try {
    const all = await loadReportsFromFirestore();
    const list = filterServerReports(all, req.query);
    res.json({
      success: true,
      count: list.length,
      reports: list,
      data: list,
    });
  } catch {
    res.json({ success: true, count: 0, reports: [], data: [] });
  }
});

// POST /api/reports/reconcile - Fast bidirectional report & reply reconciliation across devices/instances
app.post("/api/reports/reconcile", async (req, res) => {
  try {
    const incoming: ServerConsumerReport[] = Array.isArray(req.body?.reports) ? req.body.reports : [];
    await loadReportsFromFirestore();
    if (incoming.length > 0) {
      upsertReportsIntoSynced(incoming);
      if (canWriteFs()) {
        for (const r of incoming.slice(0, 25)) {
          if (r && r.id) {
            setDoc(doc(fsDb, FS_COLLECTIONS.REPORTS, sanitizeDocId(r.id)), sanitizePayload(r), { merge: true }).catch(
              (err) => recordFsErr(err, "write")
            );
          }
        }
      }
    }
    const list = filterServerReports(syncedReports, {
      accountNumber: req.body?.accountNumber,
      email: req.body?.email,
    });
    res.json({
      success: true,
      count: list.length,
      reports: list,
      data: list,
    });
  } catch {
    res.json({ success: true, count: syncedReports.length, reports: syncedReports, data: syncedReports });
  }
});

app.get("/api/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const list = await loadReportsFromFirestore();
    const report = list.find((r) => r.id === id || r.ticketNumber === id);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }
    res.json({ success: true, report, data: report });
  } catch {
    res.status(404).json({ success: false, message: "Report not found." });
  }
});

app.post("/api/reports", async (req, res) => {
  try {
    const body = req.body || {};
    const now = new Date().toISOString();
    const createdAt = body.createdAt || now;
    const id = body.id || `REP-${Date.now()}`;
    const ticketNumber =
      body.ticketNumber || `TWD-CR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const rawReplies: ServerReportReply[] =
      Array.isArray(body.replies) && body.replies.length > 0
        ? body.replies
        : body.description
          ? [
              {
                id: `INIT-${ticketNumber}`,
                reportId: id,
                senderId: body.accountNumber || "consumer",
                senderName: body.consumerName || "Consumer",
                senderRole: "consumer",
                message: body.description,
                timestamp: createdAt,
              },
            ]
          : [];

    const ackTimestamp = new Date(new Date(createdAt).getTime() + 1).toISOString();
    const ackId = `ACK-${ticketNumber}`;
    const hasAckAlready = rawReplies.some(
      (r) =>
        r &&
        (String(r.id || "").startsWith("ACK-") ||
          r.senderId === "system-admin-ack" ||
          (r.senderRole === "admin" && String(r.message || "").includes("officially received by Tagoloan Water District")))
    );
    if (!hasAckAlready) {
      rawReplies.push({
        id: ackId,
        reportId: id,
        senderId: "system-admin-ack",
        senderName: "TWD Customer Service Desk",
        senderRole: "admin",
        message: `Thank you for reaching out! Your inquiry/report (${ticketNumber}) has been officially received by Tagoloan Water District Administration. Our Customer Service team has been notified—please wait momentarily while our staff reviews your concern and prepares an official response.`,
        timestamp: ackTimestamp,
      });
    }
    const replies = dedupeServerReplies(rawReplies);

    const report: ServerConsumerReport = {
      id,
      ticketNumber,
      accountNumber: body.accountNumber || "",
      consumerName: body.consumerName || "Consumer",
      consumerEmail: body.consumerEmail ? String(body.consumerEmail).trim().toLowerCase() : undefined,
      consumerPhone: body.consumerPhone,
      barangay: body.barangay,
      address: body.address,
      meterNumber: body.meterNumber,
      category: body.category || "other",
      title: body.title || "Consumer Inquiry",
      description: body.description || "",
      urgency: body.urgency || "normal",
      status: body.status || "pending",
      createdAt,
      updatedAt: ackTimestamp,
      photoUrl: body.photoUrl || "",
      replies,
      hasUnreadAdminReply: false,
      hasUnreadConsumerUpdate: true,
    };

    upsertReportsIntoSynced([report]);
    if (canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.REPORTS, sanitizeDocId(id)), sanitizePayload(report), { merge: true }).catch(
        (err) => recordFsErr(err, "write")
      );
    }

    res.status(201).json({
      success: true,
      message: "Service report submitted successfully.",
      report,
      data: report,
    });
  } catch {
    res.status(200).json({ success: false, message: "Failed to create report." });
  }
});

app.post(["/api/reports/:id/reply", "/api/reports/:id/replies"], async (req, res) => {
  try {
    const { id } = req.params;
    const {
      id: clientReplyId,
      replyId,
      timestamp: clientReplyTimestamp,
      senderId,
      senderName,
      senderRole,
      message,
      statusUpdate,
      assignedStaff,
      report: clientReport,
    } = req.body || {};
    const list = await loadReportsFromFirestore();
    let idx = list.findIndex((r) => r.id === id || r.ticketNumber === id);

    const now = new Date().toISOString();
    const replyTs = clientReplyTimestamp || now;
    if (idx < 0 && clientReport && typeof clientReport === "object") {
      const hydrated: ServerConsumerReport = {
        ...clientReport,
        id: clientReport.id || id,
        ticketNumber: clientReport.ticketNumber || id,
        accountNumber: clientReport.accountNumber || "",
        consumerName: clientReport.consumerName || "Consumer",
        consumerEmail: clientReport.consumerEmail ? String(clientReport.consumerEmail).trim().toLowerCase() : undefined,
        category: clientReport.category || "other",
        title: clientReport.title || "Consumer Inquiry",
        description: clientReport.description || "",
        urgency: clientReport.urgency || "normal",
        status: clientReport.status || "pending",
        createdAt: clientReport.createdAt || now,
        updatedAt: now,
        replies: dedupeServerReplies(Array.isArray(clientReport.replies) ? clientReport.replies : []),
      };
      syncedReports.unshift(hydrated);
      idx = 0;
    }

    if (idx < 0) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }

    const existing = syncedReports[idx];
    const cleanMessage = String(message || "").trim();
    const deterministicReplyId = String(clientReplyId || replyId || "").trim() || `REP-MSG-${Date.now()}`;

    const reply: ServerReportReply = {
      id: deterministicReplyId,
      reportId: existing.id,
      senderId: senderId || "admin-1",
      senderName: senderName || "TWD Operations",
      senderRole: senderRole || "admin",
      message: cleanMessage,
      timestamp: replyTs,
      statusUpdate,
    };

    const existingReplies = dedupeServerReplies(Array.isArray(existing.replies) ? existing.replies : []);
    const normNewMsg = cleanMessage.replace(/\s+/g, " ").toLowerCase();
    const newReplyMs = new Date(replyTs).getTime();
    const isDuplicateSubmission = existingReplies.some((r) => {
      if (r.id === deterministicReplyId) return true;
      if (r.senderRole !== reply.senderRole) return false;
      const rNorm = String(r.message || "").trim().replace(/\s+/g, " ").toLowerCase();
      if (rNorm !== normNewMsg) return false;
      const rMs = new Date(r.timestamp || 0).getTime();
      return !rMs || !newReplyMs || Math.abs(newReplyMs - rMs) < 5 * 60 * 1000;
    });

    const mergedReplies = dedupeServerReplies([...existingReplies, reply]);
    const nextStatus = statusUpdate || existing.status;
    const updated: ServerConsumerReport = {
      ...existing,
      status: nextStatus,
      updatedAt: now,
      resolvedAt: nextStatus === "resolved" ? existing.resolvedAt || now : existing.resolvedAt,
      assignedStaff: assignedStaff !== undefined ? assignedStaff : existing.assignedStaff,
      replies: mergedReplies,
      hasUnreadAdminReply: reply.senderRole === "admin",
      hasUnreadConsumerUpdate: reply.senderRole === "consumer",
    };

    syncedReports[idx] = updated;
    if (canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.REPORTS, sanitizeDocId(existing.id)), sanitizePayload(updated), {
        merge: true,
      }).catch((err) => recordFsErr(err, "write"));
    }

    let createdNotif: PortalNotification | undefined;
    if (!isDuplicateSubmission && reply.senderRole === "admin" && (updated.accountNumber || updated.consumerEmail)) {
      const deterministicNotifId = `notif-rep-${sanitizeDocId(deterministicReplyId)}`;
      createdNotif = {
        id: deterministicNotifId,
        accountNumber: (updated.accountNumber || "PENDING").toUpperCase(),
        consumerEmail: updated.consumerEmail?.toLowerCase(),
        title: `Official Reply on Concern #${updated.ticketNumber}`,
        message: `Admin ${reply.senderName} replied: "${reply.message.slice(0, 90)}" (Status: ${nextStatus.toUpperCase()})`,
        timestamp: now,
        type: "report",
        read: false,
        reportId: updated.id,
        ticketNumber: updated.ticketNumber,
      };
      if (!syncedNotifications.some((n) => n.id === deterministicNotifId)) {
        syncedNotifications.unshift(createdNotif);
      }
      if (canWriteFs()) {
        await setDoc(doc(fsDb, FS_COLLECTIONS.NOTIFICATIONS, deterministicNotifId), sanitizePayload(createdNotif), {
          merge: true,
        }).catch((err) => recordFsErr(err, "write"));
      }
    }

    res.json({ success: true, message: "Reply posted.", report: updated, reply, notification: createdNotif });
  } catch {
    res.status(200).json({ success: false, message: "Failed to reply to report." });
  }
});

app.all("/api/reports/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedStaff, report: clientReport } = req.body || {};
    const list = await loadReportsFromFirestore();
    let idx = list.findIndex((r) => r.id === id || r.ticketNumber === id);
    const now = new Date().toISOString();

    if (idx < 0 && clientReport && typeof clientReport === "object") {
      const hydrated: ServerConsumerReport = {
        ...clientReport,
        id: clientReport.id || id,
        ticketNumber: clientReport.ticketNumber || id,
        accountNumber: clientReport.accountNumber || "",
        consumerName: clientReport.consumerName || "Consumer",
        category: clientReport.category || "other",
        title: clientReport.title || "Consumer Inquiry",
        description: clientReport.description || "",
        urgency: clientReport.urgency || "normal",
        status: clientReport.status || "pending",
        createdAt: clientReport.createdAt || now,
        updatedAt: now,
        replies: Array.isArray(clientReport.replies) ? clientReport.replies : [],
      };
      syncedReports.unshift(hydrated);
      idx = 0;
    }

    if (idx < 0) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }
    const existing = syncedReports[idx];
    const updated: ServerConsumerReport = {
      ...existing,
      status: status || existing.status,
      updatedAt: now,
      resolvedAt: status === "resolved" ? now : existing.resolvedAt,
      assignedStaff: assignedStaff !== undefined ? assignedStaff : existing.assignedStaff,
      hasUnreadAdminReply: true,
    };
    syncedReports[idx] = updated;
    if (canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.REPORTS, sanitizeDocId(existing.id)), sanitizePayload(updated), {
        merge: true,
      }).catch((err) => recordFsErr(err, "write"));
    }
    res.json({ success: true, message: "Report status updated.", report: updated });
  } catch {
    res.status(200).json({ success: false, message: "Failed to update report status." });
  }
});

// ==========================================
// 4. METER READER AUTH & REGISTRATION
// ==========================================
async function loadReadersFromFirestore(): Promise<MobileReader[]> {
  try {
    const snap = await getDocs(query(collection(fsDb, FS_COLLECTIONS.READERS), limit(100)));
    const map = new Map<string, MobileReader>();
    registeredStaff.forEach((r) => map.set(r.id, r));
    snap.forEach((d) => {
      const r = d.data() as MobileReader;
      if (r && (r.id || d.id)) {
        map.set(r.id || d.id, { ...r, id: r.id || d.id });
      }
    });
    registeredStaff = Array.from(map.values());
  } catch {
    // Graceful fallback
  }
  return registeredStaff;
}

app.post(
  ["/api/auth/register", "/api/readers/register", "/api/readers", "/api/auth/register-reader", "/api/staff/register", "/api/staff"],
  async (req, res) => {
    try {
      const { id, username, name, pin, role, zone, contactNumber, registeredAt, assignedRoutes } = req.body || {};
      const rName = (name || username || "").toString().trim();
      const rUser = (username || name || "").toString().trim();

      if (!rName || !rUser) {
        return res.status(400).json({
          success: false,
          message: "Reader name and username are required for registration.",
        });
      }

      const readerId = id || `WDT-MR${Math.floor(10 + Math.random() * 90)}`;
      const cleanZone = zone ? String(zone).replace(/^Zone\s*\d+\s*-\s*/i, "").trim() : "Poblacion";
      const routes = Array.isArray(assignedRoutes) && assignedRoutes.length > 0 ? assignedRoutes : [cleanZone];

      const newReader: MobileReader = {
        id: readerId,
        employeeId: readerId,
        username: rUser,
        name: rName,
        pin: pin || "1234",
        role: role || "Meter Reader I",
        zone: cleanZone,
        contactNumber: contactNumber || "",
        employmentStatus: "pending",
        registeredAt: registeredAt || new Date().toISOString(),
        assignedRoutes: routes,
      };

      const existingIdx = registeredStaff.findIndex((s) => s.username === newReader.username || s.id === newReader.id);
      if (existingIdx >= 0) {
        registeredStaff[existingIdx] = { ...registeredStaff[existingIdx], ...newReader };
      } else {
        registeredStaff.push(newReader);
      }

      await setDoc(doc(fsDb, FS_COLLECTIONS.READERS, sanitizeDocId(readerId)), sanitizePayload(newReader), {
        merge: true,
      }).catch(() => {});

      res.status(201).json({
        success: true,
        message: "Registration received successfully. Account is pending Admin approval.",
        reader: newReader,
      });
    } catch {
      res.status(200).json({ success: false, message: "Registration error." });
    }
  }
);

app.get(["/api/staff", "/api/readers"], async (_req, res) => {
  try {
    const list = await loadReadersFromFirestore();
    res.json({
      success: true,
      count: list.length,
      staff: list,
      readers: list,
    });
  } catch {
    res.json({
      success: true,
      count: registeredStaff.length,
      staff: registeredStaff,
      readers: registeredStaff,
    });
  }
});

app.get("/api/readers/check-status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const list = await loadReadersFromFirestore();
    const reader = list.find((s) => s.id === id || s.username?.toLowerCase() === id?.toLowerCase());
    if (!reader) {
      return res.status(404).json({ success: false, message: "Meter reader not found." });
    }
    res.json({
      success: true,
      readerId: reader.id,
      username: reader.username,
      name: reader.name,
      status: reader.employmentStatus,
      employmentStatus: reader.employmentStatus,
      assignedRoutes: reader.assignedRoutes,
      approvedAt: reader.approvedAt,
    });
  } catch {
    res.status(404).json({ success: false, message: "Meter reader not found." });
  }
});

app.all(["/api/staff/:id/status", "/api/staff/:id", "/api/readers/:id/approve", "/api/readers/:id"], async (req, res) => {
  try {
    if (req.method === "DELETE") {
      const { id } = req.params;
      registeredStaff = registeredStaff.filter((s) => s.id !== id && s.username !== id);
      await deleteDoc(doc(fsDb, FS_COLLECTIONS.READERS, sanitizeDocId(id))).catch(() => {});
      return res.json({ success: true });
    }
    if (req.method !== "PATCH" && req.method !== "POST" && req.method !== "PUT") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    const { id } = req.params;
    const { status, employmentStatus, assignedRoutes } = req.body || {};
    const list = await loadReadersFromFirestore();
    const reader = list.find((s) => s.id === id || s.username === id);
    if (!reader) {
      return res.status(404).json({ success: false, message: "Meter reader not found." });
    }

    const targetStatus = employmentStatus || status || "active";
    reader.employmentStatus = targetStatus;
    if (targetStatus === "active") {
      reader.approvedAt = new Date().toISOString();
    }
    if (assignedRoutes && Array.isArray(assignedRoutes)) {
      reader.assignedRoutes = assignedRoutes;
    }

    await setDoc(doc(fsDb, FS_COLLECTIONS.READERS, sanitizeDocId(reader.id)), sanitizePayload(reader), {
      merge: true,
    }).catch(() => {});

    res.json({
      success: true,
      message: `Meter reader ${reader.name} status updated to ${reader.employmentStatus}.`,
      reader,
    });
  } catch {
    res.status(200).json({ success: false, message: "Failed to update meter reader." });
  }
});

// ==========================================
// 5. ROUTE & SYNC DATA PULL + READINGS
// ==========================================
app.get("/api/sync/pull", async (req, res) => {
  try {
    const { zone } = req.query;
    const all = await fetchAllConsumersFromFirestore();
    let consumers = all.filter(isValidatedConsumerForReader);

    if (zone && typeof zone === "string" && zone.trim() !== "" && zone !== "All") {
      const cleanZone = zone.replace(/^Zone\s*\d+\s*[-:]\s*/i, "").trim().toLowerCase();
      consumers = consumers.filter(
        (c) => (c.barangay || "").toLowerCase().includes(cleanZone) || (c.address || "").toLowerCase().includes(cleanZone)
      );
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      zone: zone || "all",
      count: consumers.length,
      consumers,
    });
  } catch {
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      zone: "all",
      count: 0,
      consumers: [],
    });
  }
});

async function loadReadingsFromFirestore(): Promise<MobileReadingSubmission[]> {
  try {
    const snap = await getDocs(query(collection(fsDb, FS_COLLECTIONS.READINGS), limit(400)));
    const map = new Map<string, MobileReadingSubmission>();
    syncedReadings.forEach((r) => {
      if (r.id) map.set(r.id, r);
    });
    snap.forEach((d) => {
      const r = d.data() as MobileReadingSubmission;
      if (r && (r.id || d.id)) map.set(r.id || d.id, { ...r, id: r.id || d.id });
    });
    syncedReadings = Array.from(map.values()).sort(
      (a, b) => new Date(b.readingDate || b.submittedAt || 0).getTime() - new Date(a.readingDate || a.submittedAt || 0).getTime()
    );
  } catch {
    // Graceful fallback
  }
  return syncedReadings;
}

app.get("/api/readings", async (req, res) => {
  try {
    const { accountNumber, status } = req.query;
    let list = await loadReadingsFromFirestore();
    if (accountNumber && typeof accountNumber === "string" && accountNumber.trim() !== "") {
      const acc = accountNumber.trim().toUpperCase();
      list = list.filter((r) => (r.accountNumber || "").toUpperCase() === acc);
    }
    if (status && typeof status === "string" && status !== "all") {
      list = list.filter((r) => r.status === status);
    }
    res.json({
      success: true,
      count: list.length,
      readings: list,
      data: list,
    });
  } catch {
    res.json({ success: true, count: 0, readings: [], data: [] });
  }
});

app.get("/api/readings/pending", async (_req, res) => {
  try {
    const list = await loadReadingsFromFirestore();
    const pending = list.filter((r) => r.status === "pending_approval" || r.status === "pending");
    res.json({
      success: true,
      count: pending.length,
      readings: pending,
      data: pending,
    });
  } catch {
    res.json({ success: true, count: 0, readings: [], data: [] });
  }
});

app.post(["/api/readings", "/api/sync/push", "/api/readings/submit"], async (req, res) => {
  try {
    const {
      id,
      accountNumber,
      meterNumber,
      currentReading,
      previousReading,
      readerId,
      readerName,
      route,
      billingPeriod,
      photoUrl,
      coordinates,
      notes,
      status,
    } = req.body || {};

    if (!accountNumber || currentReading === undefined) {
      return res.status(400).json({
        success: false,
        message: "Account number and current reading are mandatory.",
      });
    }

    const allConsumers = await fetchAllConsumersFromFirestore();
    const matchedConsumer = allConsumers.find(
      (c) => c.accountNumber === accountNumber || (meterNumber && c.meterNumber === meterNumber)
    );

    const prev = previousReading !== undefined ? Number(previousReading) : matchedConsumer ? matchedConsumer.previousReading : 0;
    const curr = Number(currentReading);
    const consumption = Math.max(0, curr - prev);

    const submission: MobileReadingSubmission = {
      id: id || `READ-${Math.floor(10000 + Math.random() * 90000)}`,
      accountNumber: matchedConsumer ? matchedConsumer.accountNumber : accountNumber,
      consumerName: matchedConsumer ? matchedConsumer.name : req.body.consumerName || "Consumer Account",
      meterNumber: meterNumber || (matchedConsumer ? matchedConsumer.meterNumber : "MT-TAG"),
      billingPeriod: billingPeriod || "October 2026",
      readingDate: req.body.readingDate || new Date().toISOString().split("T")[0],
      previousReading: prev,
      currentReading: curr,
      consumption,
      readerId: readerId || "WDT-FIELD",
      readerName: readerName || "Field Meter Officer",
      route: route || (matchedConsumer ? matchedConsumer.barangay : "Poblacion"),
      status: status || "pending_approval",
      paymentStatus: req.body.paymentStatus || "unpaid",
      photoUrl: photoUrl || "",
      coordinates: coordinates || { latitude: 8.5372, longitude: 124.7523 },
      notes: notes || "Submitted via Tagoloan Water District System",
      submittedAt: new Date().toISOString(),
    };

    syncedReadings.unshift(submission);
    await setDoc(doc(fsDb, FS_COLLECTIONS.READINGS, sanitizeDocId(submission.id)), sanitizePayload(submission), {
      merge: true,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: "Reading submitted successfully.",
      submissionId: submission.id,
      reading: submission,
      consumption: submission.consumption,
      status: submission.status,
    });
  } catch {
    res.status(200).json({ success: false, message: "Failed to submit reading." });
  }
});

app.post("/api/readings/batch", async (req, res) => {
  try {
    const readingsList = Array.isArray(req.body) ? req.body : req.body?.readings || [];
    if (!readingsList || readingsList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No readings payload provided in batch upload.",
      });
    }

    const processed: MobileReadingSubmission[] = [];
    for (const item of readingsList) {
      const prev = item.previousReading !== undefined ? Number(item.previousReading) : 0;
      const curr = Number(item.currentReading || 0);
      const consumption = Math.max(0, curr - prev);

      const submission: MobileReadingSubmission = {
        id: item.id || `READ-${Math.floor(10000 + Math.random() * 90000)}`,
        accountNumber: item.accountNumber || "UNKNOWN",
        consumerName: item.consumerName || "Consumer",
        meterNumber: item.meterNumber || "MT-TAG",
        billingPeriod: item.billingPeriod || "October 2026",
        readingDate: item.readingDate || new Date().toISOString().split("T")[0],
        previousReading: prev,
        currentReading: curr,
        consumption,
        readerId: item.readerId || "WDT-FIELD",
        readerName: item.readerName || "Field Meter Officer",
        route: item.route || item.barangay || "Poblacion",
        status: item.status || "pending_approval",
        paymentStatus: item.paymentStatus || "unpaid",
        photoUrl: item.photoUrl || item.dialPhotoUrl || "",
        coordinates: item.coordinates || { latitude: 8.5372, longitude: 124.7523 },
        notes: item.notes || "Batch synced from Mobile Offline Queue",
        submittedAt: new Date().toISOString(),
      };

      syncedReadings.unshift(submission);
      processed.push(submission);
      await setDoc(doc(fsDb, FS_COLLECTIONS.READINGS, sanitizeDocId(submission.id)), sanitizePayload(submission), {
        merge: true,
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: `Successfully processed and synced ${processed.length} field readings.`,
      count: processed.length,
      processed: processed.length,
      readings: processed,
      syncedIds: processed.map((p) => p.id),
    });
  } catch {
    res.status(200).json({ success: false, message: "Batch sync error." });
  }
});

app.post("/api/readings/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    if (canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.READINGS, sanitizeDocId(id)), { status: "verified" }, { merge: true }).catch(
        (err) => recordFsErr(err, "write")
      );
    }
    const idx = syncedReadings.findIndex((r) => r.id === id);
    if (idx >= 0) syncedReadings[idx].status = "verified";
    res.json({ success: true, message: `Reading ${id} verified.` });
  } catch {
    res.json({ success: true });
  }
});

function mergeBillingRecordVercel(prev: any, incoming: any): any {
  if (!prev) return { ...incoming };
  const isPaid = prev.paymentStatus === "paid" || incoming.paymentStatus === "paid";
  const isPartial = !isPaid && (prev.paymentStatus === "partial" || incoming.paymentStatus === "partial");
  const prevBilled = Boolean(
    prev.isBillingIssued || prev.billingIssuedAt || prev.invoiceNumber || prev.paymentStatus === "paid" || prev.paymentStatus === "partial"
  );
  const incBilled = Boolean(
    incoming.isBillingIssued || incoming.billingIssuedAt || incoming.invoiceNumber || incoming.paymentStatus === "paid" || incoming.paymentStatus === "partial"
  );
  const mergedBilled = prevBilled || incBilled;
  const billedSrc = incBilled ? incoming : prevBilled ? prev : incoming;
  const altSrc = billedSrc === incoming ? prev : incoming;
  const maxPaid = Math.max(Number(prev.paidAmount || 0), Number(incoming.paidAmount || 0));
  const effBillAmt = Number(billedSrc.billAmount || altSrc.billAmount || 0) || prev.billAmount || incoming.billAmount;
  const effTotalAmt = Number(billedSrc.totalAmount || altSrc.totalAmount || effBillAmt || 0) || prev.totalAmount || incoming.totalAmount;

  return {
    ...prev,
    ...incoming,
    isBillingIssued: mergedBilled ? true : Boolean(incoming.isBillingIssued ?? prev.isBillingIssued),
    billingIssuedAt: incoming.billingIssuedAt || prev.billingIssuedAt,
    billingIssuedBy: incoming.billingIssuedBy || prev.billingIssuedBy,
    invoiceNumber: incoming.invoiceNumber || prev.invoiceNumber,
    dueDate: billedSrc.dueDate || altSrc.dueDate,
    billAmount: effBillAmt,
    totalAmount: effTotalAmt,
    franchiseTax: billedSrc.franchiseTax ?? altSrc.franchiseTax,
    arrears: billedSrc.arrears ?? altSrc.arrears,
    penaltyAmount: billedSrc.penaltyAmount ?? altSrc.penaltyAmount,
    amountAfterDueDate: billedSrc.amountAfterDueDate ?? altSrc.amountAfterDueDate,
    status:
      prev.status === "cancelled" || incoming.status === "cancelled"
        ? "cancelled"
        : mergedBilled || prev.status === "verified" || incoming.status === "verified"
          ? "verified"
          : (incoming.status || prev.status),
    paymentStatus: isPaid ? "paid" : isPartial ? "partial" : (incoming.paymentStatus || prev.paymentStatus),
    paidAmount: maxPaid > 0 ? maxPaid : (prev.paidAmount ?? incoming.paidAmount),
    remainingBalance: isPaid
      ? 0
      : isPartial
        ? Math.max(0, Number(effTotalAmt || effBillAmt || 0) - maxPaid)
        : (typeof billedSrc.remainingBalance === "number"
            ? billedSrc.remainingBalance
            : typeof altSrc.remainingBalance === "number"
              ? altSrc.remainingBalance
              : effTotalAmt),
    orNumber: incoming.orNumber || prev.orNumber,
    paymentDate: incoming.paymentDate || prev.paymentDate,
    paymentMethod: incoming.paymentMethod || prev.paymentMethod,
    cashierName: incoming.cashierName || prev.cashierName,
    transactionId: incoming.transactionId || prev.transactionId,
    paymentReceiptUrl: incoming.paymentReceiptUrl || prev.paymentReceiptUrl,
  };
}

app.get("/api/billings", async (req, res) => {
  try {
    const accQuery = String(req.query.accountNumber || "").trim().toUpperCase();
    if (canReadFs()) {
      try {
        const fsQuery = accQuery
          ? query(collection(fsDb, FS_COLLECTIONS.READINGS), where("accountNumber", "==", accQuery), limit(30))
          : query(collection(fsDb, FS_COLLECTIONS.READINGS), limit(120));
        const snap = await withFsTimeout(getDocs(fsQuery), 2200);
        snap.forEach((d) => {
          const r = d.data() as MobileReadingSubmission;
          const id = (r && r.id) || d.id;
          if (!r || !id) return;
          const idx = syncedReadings.findIndex((x) => x.id === id);
          if (idx >= 0) {
            syncedReadings[idx] = mergeBillingRecordVercel(syncedReadings[idx], { ...r, id });
          } else {
            syncedReadings.push({ ...r, id });
          }
        });
      } catch (err) {
        recordFsErr(err, "read");
      }
    }
    let list = [...syncedReadings];
    if (accQuery) {
      list = list.filter((r) => String(r.accountNumber || "").trim().toUpperCase() === accQuery);
    }
    list.sort((a, b) => new Date(b.readingDate || 0).getTime() - new Date(a.readingDate || 0).getTime());
    res.json({ success: true, count: list.length, readings: list });
  } catch {
    res.json({ success: true, count: 0, readings: [] });
  }
});

app.post("/api/billings/reconcile", async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.readings) ? req.body.readings : [];
    for (const r of incoming) {
      if (!r || !r.id) continue;
      const idx = syncedReadings.findIndex((x) => x.id === r.id);
      if (idx >= 0) {
        syncedReadings[idx] = mergeBillingRecordVercel(syncedReadings[idx], r);
      } else {
        syncedReadings.unshift({ ...r });
      }
      if (canWriteFs()) {
        const target = syncedReadings.find((x) => x.id === r.id) || r;
        await withFsTimeout(
          setDoc(doc(fsDb, FS_COLLECTIONS.READINGS, sanitizeDocId(r.id)), sanitizePayload(target), { merge: true }),
          2200
        ).catch((err) => recordFsErr(err, "write"));
      }
    }
    const accQuery = String(req.body?.accountNumber || "").trim().toUpperCase();
    let list = [...syncedReadings];
    if (accQuery) {
      list = list.filter((r) => String(r.accountNumber || "").trim().toUpperCase() === accQuery);
    }
    list.sort((a, b) => new Date(b.readingDate || 0).getTime() - new Date(a.readingDate || 0).getTime());
    res.json({ success: true, count: list.length, readings: list });
  } catch {
    res.json({ success: true, count: 0, readings: [] });
  }
});

// ==========================================
// 6. ANNOUNCEMENTS, TARIFF CONFIG, BARANGAYS & HEALTH
// ==========================================
async function loadAnnouncementsFromFirestore(): Promise<any[]> {
  if (!canReadFs()) {
    return syncedAnnouncements.filter((a) => a && a.id && !deletedAnnouncementIds.has(a.id));
  }
  try {
    const snap = await getDocs(query(collection(fsDb, FS_COLLECTIONS.ANNOUNCEMENTS), limit(100)));
    const map = new Map<string, any>();
    syncedAnnouncements.forEach((a) => {
      if (a && a.id && !deletedAnnouncementIds.has(a.id)) map.set(a.id, a);
    });
    snap.forEach((d) => {
      const a = d.data();
      const id = (a && a.id) || d.id;
      if (a && id && !deletedAnnouncementIds.has(id)) {
        const existing = map.get(id);
        map.set(id, existing ? { ...a, ...existing, id } : { ...a, id });
      }
    });
    syncedAnnouncements = Array.from(map.values()).sort(
      (a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime()
    );
  } catch (err) {
    recordFsErr(err, "read");
  }
  return syncedAnnouncements.filter((a) => a && a.id && !deletedAnnouncementIds.has(a.id));
}

app.get("/api/announcements", async (_req, res) => {
  try {
    const list = await loadAnnouncementsFromFirestore();
    res.json({ success: true, count: list.length, announcements: list, data: list });
  } catch {
    res.json({ success: true, count: syncedAnnouncements.length, announcements: syncedAnnouncements, data: syncedAnnouncements });
  }
});

app.post("/api/announcements", async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id || `ann-${Date.now()}`;
    const ann = {
      id,
      title: String(body.title || "Official Advisory").trim(),
      content: String(body.content || "").trim(),
      type: body.type || "info",
      date: body.date || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      author: body.author || "TWD Operations",
      createdAt: body.createdAt || new Date().toISOString(),
    };
    deletedAnnouncementIds.delete(id);
    const idx = syncedAnnouncements.findIndex((a) => a.id === id);
    if (idx >= 0) {
      syncedAnnouncements[idx] = { ...syncedAnnouncements[idx], ...ann };
    } else {
      syncedAnnouncements.unshift(ann);
    }
    if (canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.ANNOUNCEMENTS, sanitizeDocId(id)), sanitizePayload(ann), {
        merge: true,
      }).catch((err) => recordFsErr(err, "write"));
    }
    res.status(201).json({ success: true, announcement: ann, data: ann });
  } catch {
    res.status(200).json({ success: false, message: "Failed to publish announcement." });
  }
});

app.put("/api/announcements/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const idx = syncedAnnouncements.findIndex((a) => a.id === id);
    const updated = {
      ...(idx >= 0 ? syncedAnnouncements[idx] : {}),
      ...body,
      id,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) {
      syncedAnnouncements[idx] = updated;
    } else {
      syncedAnnouncements.unshift(updated);
    }
    if (canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.ANNOUNCEMENTS, sanitizeDocId(id)), sanitizePayload(updated), {
        merge: true,
      }).catch((err) => recordFsErr(err, "write"));
    }
    res.json({ success: true, announcement: updated, data: updated });
  } catch {
    res.status(200).json({ success: false, message: "Failed to update announcement." });
  }
});

app.delete("/api/announcements/:id", async (req, res) => {
  try {
    const { id } = req.params;
    deletedAnnouncementIds.add(id);
    syncedAnnouncements = syncedAnnouncements.filter((a) => a.id !== id);
    if (canWriteFs()) {
      await deleteDoc(doc(fsDb, FS_COLLECTIONS.ANNOUNCEMENTS, sanitizeDocId(id))).catch((err) => recordFsErr(err, "write"));
    }
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

app.get("/api/tariff-config", async (_req, res) => {
  if (canReadFs()) {
    try {
      const tDoc = await getDoc(doc(fsDb, FS_COLLECTIONS.SETTINGS, "tariff_config")).catch((err) => {
        recordFsErr(err, "read");
        return null;
      });
      if (tDoc && tDoc.exists()) {
        const remoteCfg = tDoc.data();
        if (!syncedTariffConfig || Number(remoteCfg?.version || 0) >= Number(syncedTariffConfig?.version || 0)) {
          syncedTariffConfig = remoteCfg;
        }
      }
    } catch (err) {
      recordFsErr(err, "read");
    }
  }
  res.json({ success: true, config: syncedTariffConfig });
});

app.post("/api/tariff-config", async (req, res) => {
  try {
    const cfg = req.body || {};
    syncedTariffConfig = cfg;
    if (canWriteFs()) {
      await setDoc(doc(fsDb, FS_COLLECTIONS.SETTINGS, "tariff_config"), sanitizePayload(cfg), { merge: true }).catch(
        (err) => recordFsErr(err, "write")
      );
    }
    res.json({ success: true, config: cfg });
  } catch {
    res.json({ success: true, config: syncedTariffConfig || req.body || {} });
  }
});

app.get("/api/barangays", (_req, res) => {
  const barangays = [
    { id: "BRG-01", name: "Poblacion", code: "PB-01", ratePerM3: 24.5 },
    { id: "BRG-02", name: "Natumolan", code: "NT-02", ratePerM3: 24.5 },
    { id: "BRG-03", name: "Baluarte", code: "BL-03", ratePerM3: 24.5 },
    { id: "BRG-04", name: "Sta. Ana", code: "SA-04", ratePerM3: 24.5 },
    { id: "BRG-05", name: "Sta. Cruz", code: "SC-05", ratePerM3: 24.5 },
    { id: "BRG-06", name: "Mohon", code: "MH-06", ratePerM3: 24.5 },
    { id: "BRG-07", name: "Gracia", code: "GR-07", ratePerM3: 24.5 },
    { id: "BRG-08", name: "Casinglot", code: "CS-08", ratePerM3: 24.5 },
    { id: "BRG-09", name: "Sugbongcogon", code: "SG-09", ratePerM3: 24.5 },
  ];
  res.json({ success: true, count: barangays.length, barangays, data: barangays });
});

app.get(["/api", "/api/health", "/api/status", "/api/ws", "/ws"], (_req, res) => {
  res.json({
    status: "ok",
    connected: true,
    service: "Tagoloan Water District Live Cloud Gateway",
    timestamp: new Date().toISOString(),
    consumersCount: syncedConsumers.length,
    staffCount: registeredStaff.length,
  });
});

// Global error guard so serverless handler never returns an unhandled 500
app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (!res.headersSent) {
    res.status(200).json({ success: false, message: "Request handled safely." });
  }
});

export default app;

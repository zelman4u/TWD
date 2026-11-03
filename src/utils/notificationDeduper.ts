import { ConsumerNotification } from '../types';
import {
  inferNotificationType,
  isPersonalNotificationType,
  isTransactionalPaymentOrReceiptItem,
} from './announcementSanitizer';
import { safeStorageGetItem, safeStorageSetStructured } from '../services/storageSafe';

const READ_NOTIFS_STORAGE_KEY = 'twd_live_v4_read_notifs_v2';
const MAX_PERSISTED_READ_KEYS = 800;
let hydratedReadKeys = false;
const readNotificationKeySet = new Set<string>();

function ensureReadKeysHydrated(): void {
  if (hydratedReadKeys) return;
  hydratedReadKeys = true;
  try {
    const raw = safeStorageGetItem(READ_NOTIFS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach((k) => {
        if (typeof k === 'string' && k) readNotificationKeySet.add(k);
      });
    }
  } catch {
    // Ignore malformed storage
  }
}

function persistReadKeySet(): void {
  try {
    const all = Array.from(readNotificationKeySet);
    const trimmed = all.length > MAX_PERSISTED_READ_KEYS ? all.slice(all.length - MAX_PERSISTED_READ_KEYS) : all;
    if (trimmed.length !== all.length) {
      readNotificationKeySet.clear();
      trimmed.forEach((k) => readNotificationKeySet.add(k));
    }
    safeStorageSetStructured(READ_NOTIFS_STORAGE_KEY, trimmed);
  } catch {
    // In-memory readNotificationKeySet remains authoritative
  }
}

const PLACEHOLDER_ACCOUNTS = new Set([
  '',
  'pending',
  'pending admin issuance',
  'unassigned',
  'unissued',
  'none',
  'n/a',
  'null',
  'undefined',
]);

export function normalizeNotifAccount(acc?: string | null): string {
  if (!acc) return '';
  return String(acc).replace(/^#/, '').trim().toUpperCase();
}

export function isIssuedNotifAccount(acc?: string | null): boolean {
  const clean = normalizeNotifAccount(acc).toLowerCase();
  if (!clean || clean.startsWith('pending') || PLACEHOLDER_ACCOUNTS.has(clean)) {
    return false;
  }
  if (clean === 'all' || clean === 'broadcast' || clean === 'district') {
    return false;
  }
  return true;
}

export function isBroadcastNotifAccount(acc?: string | null): boolean {
  const clean = normalizeNotifAccount(acc).toLowerCase();
  return clean === 'all' || clean === 'broadcast' || clean === 'district';
}

export function getNotificationSemanticKey(n: Partial<ConsumerNotification>): string {
  const acc = normalizeNotifAccount(n.accountNumber);
  const email = String(n.consumerEmail || '').trim().toLowerCase();
  const uid = String(n.userId || n.consumerId || '').trim().toLowerCase();

  let target = 'ANON';
  if (isBroadcastNotifAccount(acc)) {
    target = 'BROADCAST';
  } else if (isIssuedNotifAccount(acc)) {
    target = `ACC:${acc}`;
  } else if (email) {
    target = `EMAIL:${email}`;
  } else if (uid) {
    target = `UID:${uid}`;
  }

  const type = inferNotificationType(n);
  const normTitle = String(n.title || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const normMsg = String(n.message || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (type === 'account_issue') {
    if (normTitle.includes('registration application submitted')) {
      return `account_issue_reg::${email ? `EMAIL:${email}` : target}`;
    }
    if (normTitle.includes('updated to')) {
      return `account_issue_update::${target}::${normTitle}`;
    }
    return `account_issue_confirmed::${target}`;
  }

  if (type === 'disconnection') {
    const period = String(n.billingPeriod || n.readingId || normTitle).trim().toLowerCase();
    return `disconnection::${target}::${period}`;
  }

  if (type === 'billing' || type === 'balance') {
    const isOverdue = normTitle.includes('overdue') || normTitle.includes('urgent');
    const billKey = String(n.readingId || n.billingPeriod || normTitle).trim().toLowerCase();
    return `${type}::${isOverdue ? 'overdue' : 'statement'}::${target}::${billKey}`;
  }

  if (type === 'payment' || type === 'receipt_upload') {
    const payKey = String(n.readingId || n.billingPeriod || '').trim().toLowerCase();
    return `${type}::${target}::${payKey}::${normTitle}::${normMsg.slice(0, 80)}`;
  }

  if (type === 'meter_status') {
    const meterKey = String(n.meterNumber || '').trim().toLowerCase();
    const statusKey = String(n.meterStatus || '').trim().toLowerCase();
    const eventStamp = String(n.statusUpdateDate || '').trim().slice(0, 16);
    return `meter_status::${target}::${meterKey}::${statusKey}::${eventStamp}`;
  }

  if (type === 'installation') {
    const reqKey = String(n.installationRequestId || n.applicationNumber || '').trim().toLowerCase();
    const instStatus = String(n.installationStatus || normTitle).trim().toLowerCase();
    return `installation::${target}::${reqKey}::${instStatus}`;
  }

  if (type === 'report') {
    const repKey = String(n.reportId || n.ticketNumber || '').trim().toLowerCase();
    const replyKey = String(n.replyId || '').trim().toLowerCase();
    if (repKey && replyKey) {
      return `report::${target}::${repKey}::reply::${replyKey}`;
    }
    return `report::${target}::${repKey}::${normTitle}::${normMsg.slice(0, 140)}`;
  }

  return `${type}::${target}::${normTitle}::${normMsg.slice(0, 140)}`;
}

/**
 * Computes an identity-invariant event fingerprint for personal notifications that carry a unique
 * transaction/document reference (readingId, applicationNumber, installationRequestId, reportId, orNumber)
 * so read state survives even if an account transitions from PENDING/EMAIL to an issued Account Number.
 */
function getLooseNotificationEventKey(n: Partial<ConsumerNotification>): string | null {
  const acc = normalizeNotifAccount(n.accountNumber);
  if (isBroadcastNotifAccount(acc)) return null;

  const type = inferNotificationType(n);
  const normTitle = String(n.title || '').trim().replace(/\s+/g, ' ').toLowerCase();

  if (type === 'billing' || type === 'balance' || type === 'disconnection') {
    if (n.readingId) {
      const isOverdue = normTitle.includes('overdue') || normTitle.includes('urgent');
      return `loose:${type}:${isOverdue ? 'overdue' : 'stmt'}:rid:${String(n.readingId).trim().toLowerCase()}`;
    }
  }
  if ((type === 'payment' || type === 'receipt_upload') && (n.orNumber || n.readingId)) {
    return `loose:${type}:ref:${String(n.orNumber || n.readingId).trim().toLowerCase()}:${normTitle}`;
  }
  if (type === 'installation' && (n.installationRequestId || n.applicationNumber)) {
    const reqKey = String(n.installationRequestId || n.applicationNumber).trim().toLowerCase();
    const instStatus = String(n.installationStatus || normTitle).trim().toLowerCase();
    return `loose:installation:${reqKey}:${instStatus}`;
  }
  if (type === 'report' && (n.reportId || n.ticketNumber)) {
    const repKey = String(n.reportId || n.ticketNumber).trim().toLowerCase();
    const replyKey = String(n.replyId || normTitle).trim().toLowerCase();
    return `loose:report:${repKey}:${replyKey}`;
  }
  if (type === 'account_issue') {
    const email = String(n.consumerEmail || '').trim().toLowerCase();
    if (isIssuedNotifAccount(acc)) {
      return `loose:account_issue:acc:${acc}::${normTitle.includes('updated to') ? normTitle : 'confirmed'}`;
    }
    if (email && normTitle.includes('registration application submitted')) {
      return `loose:account_issue:reg:${email}`;
    }
  }
  return null;
}

export function markNotificationsReadPersistently(
  itemsOrIds: Array<Partial<ConsumerNotification> | string>,
  knownList?: ConsumerNotification[]
): void {
  if (!Array.isArray(itemsOrIds) || itemsOrIds.length === 0) return;
  ensureReadKeysHydrated();
  let added = false;

  for (const entry of itemsOrIds) {
    let notifObj: Partial<ConsumerNotification> | undefined;
    if (typeof entry === 'string') {
      const cleanId = entry.trim();
      if (!cleanId) continue;
      const idKey = `id:${cleanId}`;
      if (!readNotificationKeySet.has(idKey)) {
        readNotificationKeySet.add(idKey);
        added = true;
      }
      notifObj = knownList?.find((n) => n.id === cleanId);
    } else if (entry && typeof entry === 'object') {
      notifObj = entry;
      if (entry.id) {
        const idKey = `id:${String(entry.id).trim()}`;
        if (!readNotificationKeySet.has(idKey)) {
          readNotificationKeySet.add(idKey);
          added = true;
        }
      }
    }

    if (notifObj && notifObj.title && !isBroadcastNotifAccount(notifObj.accountNumber)) {
      const semKey = `sem:${getNotificationSemanticKey(notifObj)}`;
      if (!readNotificationKeySet.has(semKey)) {
        readNotificationKeySet.add(semKey);
        added = true;
      }
      const looseKey = getLooseNotificationEventKey(notifObj);
      if (looseKey && !readNotificationKeySet.has(looseKey)) {
        readNotificationKeySet.add(looseKey);
        added = true;
      }
    }
  }

  if (added) {
    persistReadKeySet();
  }
}

export function isNotificationReadPersistently(n?: Partial<ConsumerNotification> | null): boolean {
  if (!n) return false;
  if (n.read) return true;
  if (isBroadcastNotifAccount(n.accountNumber)) return false;

  ensureReadKeysHydrated();
  if (readNotificationKeySet.size === 0) return false;

  if (n.id && readNotificationKeySet.has(`id:${String(n.id).trim()}`)) {
    return true;
  }
  if (n.title) {
    const semKey = `sem:${getNotificationSemanticKey(n)}`;
    if (readNotificationKeySet.has(semKey)) {
      return true;
    }
    const looseKey = getLooseNotificationEventKey(n);
    if (looseKey && readNotificationKeySet.has(looseKey)) {
      return true;
    }
  }
  return false;
}

/**
 * Deduplicates notifications by both ID and semantic event identity,
 * preserving `read: true` if any duplicate copy was already marked read,
 * and caps total stored notifications to prevent storage/UI bloat.
 */
export function dedupeNotifications(
  list: ConsumerNotification[],
  maxTotal = 200,
  maxPerTarget = 60
): ConsumerNotification[] {
  if (!Array.isArray(list) || list.length === 0) return [];

  // Process oldest-to-newest or newest-to-oldest deterministically
  const valid = list.filter((n) => n && typeof n === 'object' && Boolean(n.title));
  if (valid.length === 0) return [];

  const byId = new Map<string, ConsumerNotification>();
  const bySemantic = new Map<string, string>(); // semanticKey -> canonical id

  for (const raw of valid) {
    const cleanAcc = normalizeNotifAccount(raw.accountNumber);
    const cleanEmail = raw.consumerEmail ? String(raw.consumerEmail).trim().toLowerCase() : undefined;
    const inferredType = inferNotificationType(raw);

    // Block personal payment/receipt/account notifications that were mistakenly broadcast to 'ALL' without a recipient
    if (
      isBroadcastNotifAccount(cleanAcc) &&
      !cleanEmail &&
      !raw.userId &&
      !raw.consumerId &&
      (isPersonalNotificationType(inferredType) ||
        isTransactionalPaymentOrReceiptItem(raw as unknown as Record<string, unknown>))
    ) {
      continue;
    }

    const itemId = String(raw.id || `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
    const candidateItem: ConsumerNotification = {
      ...raw,
      type: inferredType,
      id: itemId,
      accountNumber: cleanAcc || raw.accountNumber || 'PENDING',
      ...(cleanEmail ? { consumerEmail: cleanEmail } : {}),
      timestamp: raw.timestamp || '2026-01-01T08:00:00.000Z',
      read: Boolean(raw.read),
    };
    const resolvedRead = Boolean(candidateItem.read || isNotificationReadPersistently(candidateItem));
    if (resolvedRead && !isBroadcastNotifAccount(cleanAcc)) {
      markNotificationsReadPersistently([candidateItem]);
    }
    const item: ConsumerNotification = {
      ...candidateItem,
      read: resolvedRead,
    };

    const semKey = getNotificationSemanticKey(item);
    const existingId = byId.has(item.id) ? item.id : bySemantic.get(semKey);

    if (existingId && byId.has(existingId)) {
      const prev = byId.get(existingId)!;
      const preferItemId =
        item.id.startsWith('notif-issued-') && !prev.id.startsWith('notif-issued-')
          ? item.id
          : prev.id;

      const prevTime = new Date(prev.timestamp || 0).getTime() || 0;
      const itemTime = new Date(item.timestamp || 0).getTime() || 0;
      const newer = itemTime >= prevTime ? item : prev;
      const older = itemTime >= prevTime ? prev : item;

      const mergedAcc = isIssuedNotifAccount(newer.accountNumber)
        ? normalizeNotifAccount(newer.accountNumber)
        : isIssuedNotifAccount(older.accountNumber)
          ? normalizeNotifAccount(older.accountNumber)
          : newer.accountNumber || older.accountNumber;

      const mergedRead = Boolean(prev.read || item.read);
      const merged: ConsumerNotification = {
        ...older,
        ...newer,
        id: preferItemId,
        accountNumber: mergedAcc,
        consumerEmail: newer.consumerEmail || older.consumerEmail,
        userId: newer.userId || older.userId,
        consumerId: newer.consumerId || older.consumerId,
        // For account_issue confirmations, keep the earliest stable timestamp so polling never churns JSON
        timestamp:
          item.type === 'account_issue' && older.timestamp
            ? older.timestamp
            : newer.timestamp || older.timestamp,
        read: mergedRead,
      };
      if (mergedRead && !isBroadcastNotifAccount(mergedAcc)) {
        markNotificationsReadPersistently([merged, prev, item]);
      }

      if (preferItemId !== existingId) {
        byId.delete(existingId);
      }
      byId.set(preferItemId, merged);
      bySemantic.set(semKey, preferItemId);
    } else {
      byId.set(item.id, item);
      bySemantic.set(semKey, item.id);
    }
  }

  const sorted = Array.from(byId.values()).sort(
    (a, b) => (new Date(b.timestamp || 0).getTime() || 0) - (new Date(a.timestamp || 0).getTime() || 0)
  );

  // Enforce per-target and global caps so notifications never accumulate into thousands
  const targetCounts = new Map<string, number>();
  const capped: ConsumerNotification[] = [];

  for (const n of sorted) {
    if (capped.length >= maxTotal) break;
    const acc = normalizeNotifAccount(n.accountNumber);
    const targetBucket = isBroadcastNotifAccount(acc)
      ? 'BROADCAST'
      : isIssuedNotifAccount(acc)
        ? `ACC:${acc}`
        : `EMAIL:${String(n.consumerEmail || n.userId || 'anon').toLowerCase()}`;
    const count = targetCounts.get(targetBucket) || 0;
    if (count >= maxPerTarget) continue;
    targetCounts.set(targetBucket, count + 1);
    capped.push(n);
  }

  return capped;
}

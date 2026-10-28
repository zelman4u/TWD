import { ConsumerNotification } from '../types';

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

  const type = String(n.type || 'announcement').trim().toLowerCase();
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

  if (type === 'report') {
    const repKey = String(n.reportId || n.ticketNumber || '').trim().toLowerCase();
    return `report::${target}::${repKey}::${normTitle}::${normMsg.slice(0, 140)}`;
  }

  return `${type}::${target}::${normTitle}::${normMsg.slice(0, 140)}`;
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
    const item: ConsumerNotification = {
      ...raw,
      id: String(raw.id || `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`),
      accountNumber: cleanAcc || raw.accountNumber || 'PENDING',
      ...(cleanEmail ? { consumerEmail: cleanEmail } : {}),
      timestamp: raw.timestamp || '2026-01-01T08:00:00.000Z',
      read: Boolean(raw.read),
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
        read: Boolean(prev.read || item.read),
      };

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

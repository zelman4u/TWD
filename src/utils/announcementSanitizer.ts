import { Announcement, ConsumerNotification } from '../types';

const VALID_NOTIFICATION_TYPES = new Set<ConsumerNotification['type']>([
  'payment',
  'billing',
  'balance',
  'announcement',
  'disconnection',
  'receipt_upload',
  'report',
  'account_issue',
  'meter_status',
  'installation',
]);

const VALID_ANNOUNCEMENT_CATEGORIES = new Set<Announcement['category']>([
  'maintenance',
  'disruption',
  'event',
  'info',
]);

/**
 * Detects whether an object represents a personal payment, official receipt,
 * or individual billing transaction that must NEVER appear in public Announcements / District Advisories.
 */
export function isTransactionalPaymentOrReceiptItem(
  item?: {
    title?: unknown;
    content?: unknown;
    message?: unknown;
    type?: unknown;
    category?: unknown;
    orNumber?: unknown;
    amountPaid?: unknown;
    receiptUrl?: unknown;
  } | null
): boolean {
  if (!item || typeof item !== 'object') return false;

  const rawType = String(item.type || '').trim().toLowerCase();
  const rawCategory = String(item.category || '').trim().toLowerCase();

  if (rawType === 'payment' || rawType === 'receipt_upload' || rawType === 'meter_status' || rawType === 'installation') return true;
  if (rawCategory === 'payment' || rawCategory === 'receipt' || rawCategory === 'receipt_upload' || rawCategory === 'meter_status' || rawCategory === 'installation') return true;

  if (typeof item.orNumber === 'string' && item.orNumber.trim() !== '') return true;
  if (typeof item.amountPaid === 'number' && item.amountPaid > 0) return true;
  if (typeof item.receiptUrl === 'string' && item.receiptUrl.trim() !== '') return true;

  const title = String(item.title || '').trim();
  const body = String(item.content || item.message || '').trim();
  const combined = `${title} ${body}`;

  // Explicit personal payment / receipt transaction phrases
  if (/\bpayment\s*(successful|success|confirmed|received|settled|cleared|processed|recorded|complete|completed)\b/i.test(title)) {
    return true;
  }
  if (/\bpayment\s+settle\s+confirmed\b/i.test(combined)) {
    return true;
  }
  if (/\bofficial\s+receipt\s*(issued|verified|#|:)/i.test(combined)) {
    return true;
  }
  if (/\breceipt\s*(uploaded|verified|approved|validated|rejected|under\s+verification)\b/i.test(title)) {
    return true;
  }
  if (/^water\s+bill\s+issued\b/i.test(title)) {
    return true;
  }
  if (/\bin-office\s+cash\s+payment\s+of\b/i.test(combined)) {
    return true;
  }
  if (/\bonline\s+payment\s+of\s*₱/i.test(combined)) {
    return true;
  }

  return false;
}

/**
 * Normalizes an advisory title so broadcast `type: 'announcement'` notifications
 * ("Official District Advisory: XYZ") match their corresponding `Announcement` ("XYZ").
 */
export function normalizeAdvisoryComparisonTitle(title?: string | null): string {
  if (!title) return '';
  return String(title)
    .trim()
    .replace(/^(official\s+district\s+advisory|official\s+advisory|district\s+advisory|public\s+advisory)\s*[:\-–—]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Sanitizes and deduplicates public Announcements, stripping any polluted payment/receipt records
 * and ensuring valid `category` and `postedBy` fields.
 */
export function sanitizeAnnouncements(list?: Announcement[] | null): Announcement[] {
  if (!Array.isArray(list) || list.length === 0) return [];

  const seenIds = new Set<string>();
  const seenTitleDates = new Set<string>();
  const result: Announcement[] = [];

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const title = String(raw.title || '').trim();
    const content = String(raw.content || (raw as unknown as Record<string, unknown>).message || '').trim();
    if (!title) continue;

    if (isTransactionalPaymentOrReceiptItem(raw as unknown as Record<string, unknown>)) {
      continue;
    }

    const rawCat = String(
      raw.category || (raw as unknown as Record<string, unknown>).type || 'info'
    )
      .trim()
      .toLowerCase() as Announcement['category'];

    const category: Announcement['category'] = VALID_ANNOUNCEMENT_CATEGORIES.has(rawCat)
      ? rawCat
      : 'info';

    const postedBy = String(
      raw.postedBy || (raw as unknown as Record<string, unknown>).author || 'TWD Administration'
    ).trim();

    const date = String(raw.date || '').trim() || new Date().toISOString().split('T')[0];
    const id = String(raw.id || `ann-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}-${date}`).trim();

    if (id && seenIds.has(id)) continue;
    const titleDateKey = `${normalizeAdvisoryComparisonTitle(title)}::${date.toLowerCase()}`;
    if (seenTitleDates.has(titleDateKey)) continue;

    if (id) seenIds.add(id);
    seenTitleDates.add(titleDateKey);

    result.push({
      ...raw,
      id,
      title,
      content,
      date,
      category,
      postedBy,
    });
  }

  return result;
}

/**
 * Returns true if the notification type is strictly personal to a single consumer account
 * and must NEVER be broadcast via `accountNumber: 'ALL'`.
 */
export function isPersonalNotificationType(type?: string | null): boolean {
  const t = String(type || '').trim().toLowerCase();
  return (
    t === 'payment' ||
    t === 'receipt_upload' ||
    t === 'account_issue' ||
    t === 'disconnection' ||
    t === 'report' ||
    t === 'balance' ||
    t === 'meter_status' ||
    t === 'installation'
  );
}

/**
 * Deterministically infers the true `ConsumerNotification['type']` from both explicit fields
 * and title/message semantics so untyped or misclassified notifications never masquerade as Announcements
 * and Announcements never masquerade as Payment Success.
 */
export function inferNotificationType(
  n?: Partial<ConsumerNotification> | null
): ConsumerNotification['type'] {
  if (!n || typeof n !== 'object') return 'announcement';

  const rawType = String(n.type || '').trim().toLowerCase() as ConsumerNotification['type'];
  const title = String(n.title || '').trim();
  const msg = String(n.message || '').trim();
  const titleLower = title.toLowerCase();
  const msgLower = msg.toLowerCase();
  const accUpper = String(n.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
  const isBroadcast = accUpper === 'ALL' || accUpper === 'BROADCAST' || accUpper === 'DISTRICT';

  // 1. Report / Customer Service Inquiry notifications
  if (
    rawType === 'report' ||
    Boolean(n.reportId) ||
    Boolean(n.ticketNumber) ||
    titleLower.includes('concern ticket') ||
    titleLower.includes('report reply') ||
    titleLower.includes('inquiry reply') ||
    msgLower.includes('replied to your concern') ||
    msgLower.includes('ticket #')
  ) {
    return 'report';
  }

  // 2. Receipt upload / verification notifications
  if (
    rawType === 'receipt_upload' ||
    /\breceipt\s*(uploaded|verified|approved|validated|rejected|under\s+verification)\b/i.test(title)
  ) {
    return 'receipt_upload';
  }

  // 3. Payment / Official Receipt confirmations (even if untyped or wrongly tagged 'announcement')
  if (
    rawType === 'payment' ||
    (typeof n.orNumber === 'string' && n.orNumber.trim() !== '') ||
    (typeof n.amountPaid === 'number' && n.amountPaid > 0) ||
    /\bpayment\s*(successful|success|confirmed|received|settled|cleared|processed|recorded|complete|completed)\b/i.test(title) ||
    /\bpayment\s+settle\s+confirmed\b/i.test(`${title} ${msg}`) ||
    /\bofficial\s+receipt\s*(issued|#|:)/i.test(`${title} ${msg}`) ||
    /\bin-office\s+cash\s+payment\s+of\b/i.test(`${title} ${msg}`)
  ) {
    return 'payment';
  }

  // 4. Disconnection / Cutting notices
  if (
    rawType === 'disconnection' ||
    titleLower.includes('disconnection') ||
    titleLower.includes('cutting order') ||
    titleLower.includes('curb-stop')
  ) {
    return 'disconnection';
  }

  // 4b. Personal Water Meter Status update notifications
  if (
    rawType === 'meter_status' ||
    Boolean(n.meterStatus) ||
    titleLower.includes('regarding your water meter') ||
    titleLower.includes('water meter status')
  ) {
    return 'meter_status';
  }

  // 4c. Water Meter Installation Scheduling & Progress notifications
  if (
    rawType === 'installation' ||
    Boolean(n.installationRequestId) ||
    Boolean(n.installationStatus) ||
    titleLower.includes('water meter installation') ||
    titleLower.includes('installation schedule')
  ) {
    return 'installation';
  }

  // 5. Account / Meter / RFID issuance & registration updates
  if (
    rawType === 'account_issue' ||
    titleLower.includes('water service account has been activated') ||
    titleLower.includes('account number') ||
    titleLower.includes('meter issued') ||
    titleLower.includes('registration application')
  ) {
    return 'account_issue';
  }

  // 6. Official District Advisories / Public Broadcasts (including Tariff Rate Advisories broadcast to 'ALL')
  if (
    /^(official\s+(district\s+)?advisory|district\s+advisory|public\s+advisory)\b/i.test(title) ||
    (isBroadcast && rawType === 'announcement')
  ) {
    return 'announcement';
  }

  // 7. Billing / Overdue / Remaining balance alerts
  if (
    rawType === 'balance' ||
    titleLower.includes('remaining balance')
  ) {
    return 'balance';
  }
  if (
    rawType === 'billing' ||
    /^water\s+bill\s+issued\b/i.test(title) ||
    titleLower.includes('tariff overdue') ||
    titleLower.includes('water bill') ||
    Boolean(n.readingId) ||
    Boolean(n.billingPeriod)
  ) {
    return 'billing';
  }

  // 8. Preserve valid explicit type if present
  if (VALID_NOTIFICATION_TYPES.has(rawType)) {
    return rawType;
  }

  // 9. Safe fallback: only broadcast accounts default to 'announcement'
  return isBroadcast ? 'announcement' : 'account_issue';
}

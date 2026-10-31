import {
  Consumer,
  ConsumerNotification,
  ConsumerReport,
  ReferencedNoticeContext,
} from '../types';
import { inferNotificationType } from './announcementSanitizer';
import {
  formatMeterStatusLabel,
  formatMeterStatusUpdateDate,
  normalizeMeterStatus,
} from './meterStatusNotification';

export interface NotificationAdminAttribution {
  isFromAdmin: boolean;
  senderName: string;
  senderBadgeLabel: string;
  senderFullLabel: string;
  canReplyDirectly: boolean;
  noticeCategoryLabel: string;
}

/**
 * Determines whether a notification was issued by Tagoloan Water District Administration
 * and returns clear, human-readable attribution labels plus whether the consumer can
 * reply directly inside the Notification Detail Modal.
 */
export function getNotificationAdminAttribution(
  n?: ConsumerNotification | null
): NotificationAdminAttribution {
  if (!n) {
    return {
      isFromAdmin: false,
      senderName: 'Tagoloan Water District',
      senderBadgeLabel: 'System Notice',
      senderFullLabel: 'Tagoloan Water District',
      canReplyDirectly: false,
      noticeCategoryLabel: 'System Notice',
    };
  }

  const effectiveType = inferNotificationType(n);
  const explicitAdmin = (n.sentByAdmin || n.updatedByAdmin || '').trim();
  const titleLower = (n.title || '').toLowerCase();
  const msgLower = (n.message || '').toLowerCase();

  // Automated ticket submission receipt vs Official Admin Reply
  const isAutomatedReceipt =
    effectiveType === 'report' &&
    (titleLower.startsWith('concern submitted') ||
      msgLower.includes('received by tagoloan water district customer service'));

  const isAdminReply =
    effectiveType === 'report' && !isAutomatedReceipt;

  const isFromAdmin =
    Boolean(n.isFromAdmin) ||
    Boolean(explicitAdmin) ||
    isAdminReply ||
    effectiveType === 'meter_status' ||
    effectiveType === 'disconnection' ||
    effectiveType === 'billing' ||
    effectiveType === 'balance' ||
    effectiveType === 'account_issue' ||
    effectiveType === 'announcement' ||
    effectiveType === 'payment' ||
    effectiveType === 'receipt_upload' ||
    effectiveType === 'installation';

  const senderName =
    explicitAdmin ||
    (isAdminReply
      ? 'TWD Customer Service & Administration'
      : 'TWD Administration');

  let noticeCategoryLabel = 'Official Notice';
  switch (effectiveType) {
    case 'meter_status': {
      const stLabel = formatMeterStatusLabel(normalizeMeterStatus(n.meterStatus));
      noticeCategoryLabel = `Water Meter Status Notice (${stLabel})`;
      break;
    }
    case 'disconnection':
      noticeCategoryLabel = 'Disconnection Notice';
      break;
    case 'billing':
      noticeCategoryLabel = 'Official Billing Statement';
      break;
    case 'balance':
      noticeCategoryLabel = 'Remaining Balance Notice';
      break;
    case 'account_issue':
      noticeCategoryLabel = 'Account & Meter ID Notice';
      break;
    case 'announcement':
      noticeCategoryLabel = 'Official District Advisory';
      break;
    case 'payment':
      noticeCategoryLabel = 'Official Payment Confirmation';
      break;
    case 'receipt_upload':
      noticeCategoryLabel = 'Receipt Verification Notice';
      break;
    case 'installation':
      noticeCategoryLabel = n.installationStatus
        ? `Meter Installation Notice (${n.installationStatus})`
        : 'Meter Installation Notice';
      break;
    case 'report':
      noticeCategoryLabel = isAdminReply ? 'Official Admin Reply' : 'Inquiry Acknowledgement';
      break;
    default:
      noticeCategoryLabel = 'Official Notice';
  }

  const senderBadgeLabel = isAdminReply
    ? 'Admin Reply'
    : isFromAdmin
    ? 'From Admin'
    : 'System';

  const senderFullLabel = explicitAdmin
    ? `Tagoloan Water District Administration (${explicitAdmin})`
    : 'Tagoloan Water District Administration';

  // Consumers can reply directly to any Admin-sent notice or existing Inquiry thread
  const canReplyDirectly =
    effectiveType === 'meter_status' ||
    effectiveType === 'disconnection' ||
    effectiveType === 'billing' ||
    effectiveType === 'balance' ||
    effectiveType === 'account_issue' ||
    effectiveType === 'report' ||
    effectiveType === 'announcement' ||
    effectiveType === 'receipt_upload' ||
    effectiveType === 'payment' ||
    effectiveType === 'installation';

  return {
    isFromAdmin,
    senderName,
    senderBadgeLabel,
    senderFullLabel,
    canReplyDirectly,
    noticeCategoryLabel,
  };
}

/**
 * Builds a complete, structured ReferencedNoticeContext snapshot from an Admin notification
 * so that when a consumer replies to it (or when Admin replies back), neither side ever has
 * to ask which notice, water meter, status update, or billing concern is being discussed.
 */
export function buildReferencedNoticeFromNotification(
  n: ConsumerNotification,
  consumer?: Consumer | null
): ReferencedNoticeContext {
  // If this notification already carries an upstream referencedNotice (e.g., an Admin Reply notification),
  // preserve that original notice context so the thread stays anchored to the root Admin notice.
  if (n.referencedNotice && n.referencedNotice.notificationId) {
    return n.referencedNotice;
  }

  const effectiveType = inferNotificationType(n);
  const attribution = getNotificationAdminAttribution(n);
  const cleanSubject = (n.title || n.subject || attribution.noticeCategoryLabel).trim().slice(0, 220);
  const rawExcerpt = (n.message || '').replace(/\s+/g, ' ').trim();
  const summaryExcerpt = rawExcerpt.length > 320 ? `${rawExcerpt.slice(0, 317)}...` : rawExcerpt;

  const cleanAcc = (n.accountNumber && n.accountNumber !== 'ALL'
    ? n.accountNumber
    : consumer?.accountNumber || ''
  )
    .replace(/^#/, '')
    .trim();

  const cleanMeter = (n.meterNumber || consumer?.meterNumber || '').replace(/^#/, '').trim();

  const ctx: ReferencedNoticeContext = {
    notificationId: n.id,
    notificationType: effectiveType,
    subject: cleanSubject,
    sentByAdmin: attribution.senderName,
    sentAt: n.statusUpdateDate || n.timestamp || new Date().toISOString(),
    summaryExcerpt,
  };

  if (cleanAcc) ctx.accountNumber = cleanAcc;
  if (n.consumerName || consumer?.name) {
    ctx.consumerName = (n.consumerName || consumer?.name || '').trim();
  }
  if (cleanMeter) ctx.meterNumber = cleanMeter;

  if (effectiveType === 'meter_status' || n.meterStatus) {
    const norm = normalizeMeterStatus(n.meterStatus);
    if (norm === 'active' || norm === 'inactive' || norm === 'damaged' || norm === 'maintenance') {
      ctx.meterStatus = norm;
    }
    if (n.previousMeterStatus) ctx.previousMeterStatus = n.previousMeterStatus;
    if (n.statusUpdateDate || n.timestamp) {
      ctx.statusUpdateDate = n.statusUpdateDate || n.timestamp;
    }
    if (n.remarks && n.remarks.trim()) {
      ctx.remarks = n.remarks.trim().slice(0, 400);
    }
  }

  if (effectiveType === 'installation' || n.installationRequestId || n.applicationNumber) {
    if (n.applicationNumber) ctx.applicationNumber = n.applicationNumber;
    if (n.installationRequestId) ctx.installationRequestId = n.installationRequestId;
    if (n.installationStatus) ctx.installationStatus = n.installationStatus;
    if (n.remarks && n.remarks.trim()) {
      ctx.remarks = n.remarks.trim().slice(0, 400);
    }
  }

  if (n.billingPeriod) ctx.billingPeriod = n.billingPeriod;
  if (n.readingId) ctx.readingId = n.readingId;

  return ctx;
}

/**
 * Chooses the most accurate ConsumerReport category for a contextual notification reply.
 */
export function getReportCategoryForNotification(
  n: ConsumerNotification
): ConsumerReport['category'] {
  const effectiveType = inferNotificationType(n);
  if (effectiveType === 'meter_status' || effectiveType === 'installation') return 'meter_issue';
  if (
    effectiveType === 'billing' ||
    effectiveType === 'balance' ||
    effectiveType === 'disconnection' ||
    effectiveType === 'payment' ||
    effectiveType === 'receipt_upload'
  ) {
    return 'billing';
  }
  return 'other';
}

/**
 * Chooses appropriate urgency for a contextual notification reply.
 */
export function getReportUrgencyForNotification(
  n: ConsumerNotification
): ConsumerReport['urgency'] {
  const effectiveType = inferNotificationType(n);
  if (effectiveType === 'meter_status') {
    const st = normalizeMeterStatus(n.meterStatus);
    if (st === 'damaged') return 'urgent';
    return 'normal';
  }
  if (effectiveType === 'disconnection') return 'urgent';
  return 'normal';
}

/**
 * Builds an unambiguous report subject/title so Admin immediately sees in the table
 * and notification bell what notice the consumer is replying to.
 */
export function buildContextualInquiryTitle(
  n: ConsumerNotification,
  consumer?: Consumer | null
): string {
  const effectiveType = inferNotificationType(n);
  const meterNo = (n.meterNumber || consumer?.meterNumber || '').replace(/^#/, '').trim();

  if (effectiveType === 'meter_status' || n.meterStatus) {
    const stLabel = formatMeterStatusLabel(normalizeMeterStatus(n.meterStatus));
    return `Reply Re: Water Meter Status (${stLabel})${meterNo ? ` — Meter #${meterNo}` : ''}`.slice(0, 180);
  }

  if (effectiveType === 'installation') {
    const appTag = n.applicationNumber ? ` (${n.applicationNumber})` : '';
    const stTag = n.installationStatus ? ` — ${n.installationStatus}` : '';
    return `Reply Re: Meter Installation${appTag}${stTag}`.slice(0, 180);
  }

  if (effectiveType === 'billing' && n.billingPeriod) {
    return `Reply Re: Water Bill (${n.billingPeriod})`.slice(0, 180);
  }

  if (effectiveType === 'disconnection') {
    return `Reply Re: Disconnection Notice${n.billingPeriod ? ` (${n.billingPeriod})` : ''}`.slice(0, 180);
  }

  const baseTitle = (n.title || n.subject || 'Official Notice').trim();
  const prefixed = baseTitle.toLowerCase().startsWith('re:') ? baseTitle : `Reply Re: ${baseTitle}`;
  return prefixed.slice(0, 180);
}

/**
 * Builds a concise human-readable one-line summary of a ReferencedNoticeContext
 * for chips, badges, and notification headers.
 */
export function formatReferencedNoticeSummaryChip(
  ref?: ReferencedNoticeContext | null
): string {
  if (!ref) return '';
  if (ref.notificationType === 'meter_status' || ref.meterStatus) {
    const stLabel = formatMeterStatusLabel(normalizeMeterStatus(ref.meterStatus));
    const parts = [`Water Meter Status: ${stLabel}`];
    if (ref.meterNumber) parts.push(`Meter #${ref.meterNumber}`);
    if (ref.statusUpdateDate) {
      parts.push(`Updated ${formatMeterStatusUpdateDate(ref.statusUpdateDate)}`);
    }
    return parts.join(' · ');
  }
  if (ref.notificationType === 'installation' || ref.applicationNumber) {
    const parts = [ref.subject || 'Meter Installation'];
    if (ref.applicationNumber) parts.push(`App #${ref.applicationNumber}`);
    if (ref.installationStatus) parts.push(ref.installationStatus);
    return parts.join(' · ');
  }
  if (ref.billingPeriod) {
    return `${ref.subject} · Cycle: ${ref.billingPeriod}`;
  }
  return ref.subject;
}

/**
 * Finds an existing ConsumerReport linked to a given ConsumerNotification, either by
 * explicit reportId/ticketNumber (for report notifications) or by sourceNotificationId /
 * referencedNotice.notificationId (for replies initiated on a meter_status or other notice).
 */
export function findLinkedReportForNotification(
  n: ConsumerNotification | null | undefined,
  reports: ConsumerReport[]
): ConsumerReport | undefined {
  if (!n || !Array.isArray(reports) || reports.length === 0) return undefined;

  if (n.reportId) {
    const byId = reports.find(r => r.id === n.reportId);
    if (byId) return byId;
  }

  if (n.ticketNumber) {
    const targetTicket = n.ticketNumber.trim().toUpperCase();
    const byTicket = reports.find(r => (r.ticketNumber || '').trim().toUpperCase() === targetTicket);
    if (byTicket) return byTicket;
  }

  if (n.id && !n.id.startsWith('ADVISORY-PREVIEW-')) {
    const bySource = reports.find(
      r =>
        r.sourceNotificationId === n.id ||
        r.referencedNotice?.notificationId === n.id
    );
    if (bySource) return bySource;
  }

  if (n.referencedNotice?.notificationId) {
    const byRefId = reports.find(
      r =>
        r.sourceNotificationId === n.referencedNotice?.notificationId ||
        r.referencedNotice?.notificationId === n.referencedNotice?.notificationId
    );
    if (byRefId) return byRefId;
  }

  return undefined;
}

/**
 * Normalizes multi-line notification/reply text into clean, compact paragraphs without
 * excessive blank lines, duplicate "From Admin" wrappers, or redundant remarks lines.
 */
export function normalizeCompactParagraphs(
  rawMessage?: string | null,
  options?: {
    stripAdminEnvelope?: boolean;
    hideDuplicateRemarks?: boolean;
  }
): string[] {
  if (!rawMessage) return [];

  const rawLines = String(rawMessage)
    .split(/\r?\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const cleaned: string[] = [];

  for (const line of rawLines) {
    if (options?.stripAdminEnvelope) {
      if (/^from admin\s*(\([^)]*\))?\s*:/i.test(line)) {
        const rest = line.replace(/^from admin\s*(\([^)]*\))?\s*:\s*/i, '').trim();
        if (rest) cleaned.push(rest);
        continue;
      }
      if (/^[—–-]\s*(regarding official notice|ticket #)/i.test(line)) {
        continue;
      }
    }

    if (options?.hideDuplicateRemarks && /^remarks from administration\s*:/i.test(line)) {
      continue;
    }

    cleaned.push(line);
  }

  // Merge standalone sign-off ("Thank you..." + "Tagoloan Water District") into one compact line
  if (
    cleaned.length >= 2 &&
    /^tagoloan water district$/i.test(cleaned[cleaned.length - 1]) &&
    /^thank you/i.test(cleaned[cleaned.length - 2])
  ) {
    const signOff = cleaned.pop()!;
    cleaned[cleaned.length - 1] = `${cleaned[cleaned.length - 1]} — ${signOff}`;
  }

  return cleaned;
}

/**
 * Collapses a notification or reply message into a crisp single-line preview for Bell dropdown items.
 */
export function normalizeSingleLinePreview(rawMessage?: string | null): string {
  const parts = normalizeCompactParagraphs(rawMessage, {
    stripAdminEnvelope: true,
    hideDuplicateRemarks: false,
  });
  return parts.join(' ').trim();
}


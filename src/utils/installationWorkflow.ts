import {
  Consumer,
  ConsumerNotification,
  InstallationStatus,
  WaterMeterInstallationRequest,
} from '../types';

export const INSTALLATION_STATUS_OPTIONS: InstallationStatus[] = [
  'Pending Review',
  'Approved',
  'Scheduled',
  'Rescheduled',
  'Installation in Progress',
  'Installed',
  'Cancelled',
];

/**
 * Generates an official unique Tagoloan Water District Registration/Application Number.
 */
export function generateApplicationNumber(existing?: (string | undefined)[]): string {
  const year = new Date().getFullYear();
  const taken = new Set(
    (existing || [])
      .filter((v): v is string => Boolean(v))
      .map((v) => v.trim().toUpperCase())
  );
  for (let attempt = 0; attempt < 25; attempt++) {
    const rand = Math.floor(10000 + Math.random() * 90000);
    const candidate = `TWD-APP-${year}-${rand}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `TWD-APP-${year}-${Date.now().toString().slice(-5)}`;
}

/**
 * Checks whether a consumer status represents an unissued / pending registration state.
 */
export function isPendingConsumerStatus(status?: string | null): boolean {
  const s = String(status || '').trim().toLowerCase();
  return (
    s === 'pending_approval' ||
    s === 'pending_installation' ||
    s === 'installation_not_scheduled' ||
    s === 'pending'
  );
}

/**
 * Formats an ISO or YYYY-MM-DD date string into a clean human-readable date.
 */
export function formatInstallationDateDisplay(dateStr?: string | null): string {
  if (!dateStr) return 'Not Yet Set';
  const raw = String(dateStr).trim();
  if (!raw) return 'Not Yet Set';
  const parsed = new Date(raw.length === 10 ? `${raw}T08:00:00` : raw);
  if (isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Finds all installation requests belonging to a given consumer.
 */
export function filterInstallationRequestsForConsumer(
  consumer: Partial<Consumer> | null | undefined,
  allRequests: WaterMeterInstallationRequest[],
  fallbackEmail?: string,
  fallbackUserId?: string
): WaterMeterInstallationRequest[] {
  if (!Array.isArray(allRequests) || allRequests.length === 0) return [];
  const cEmail = String(consumer?.email || fallbackEmail || '').trim().toLowerCase();
  const cUid = String(consumer?.linkedUserId || fallbackUserId || '').trim();
  const cAppNo = String(consumer?.applicationNumber || '').trim().toUpperCase();
  const cReqId = String(consumer?.installationRequestId || '').trim();
  const cAcc = String(consumer?.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
  const hasRealAcc = Boolean(cAcc && !cAcc.startsWith('PENDING') && cAcc !== 'UNASSIGNED');

  return allRequests
    .filter((req) => {
      if (!req) return false;
      if (cReqId && req.id === cReqId) return true;
      if (cAppNo && req.applicationNumber && req.applicationNumber.trim().toUpperCase() === cAppNo) return true;
      if (cEmail && req.consumerEmail && req.consumerEmail.trim().toLowerCase() === cEmail) return true;
      if (cUid && req.linkedUserId && req.linkedUserId === cUid) return true;
      if (hasRealAcc && req.assignedAccountNumber && req.assignedAccountNumber.trim().toUpperCase() === cAcc) {
        return true;
      }
      return false;
    })
    .sort((a, b) => new Date(b.submissionDate || 0).getTime() - new Date(a.submissionDate || 0).getTime());
}

/**
 * Prevents duplicate active installation requests for the same pending application.
 * A consumer may submit an installation request ONLY if they do not already have a non-cancelled
 * unvalidated installation request.
 */
export function canConsumerSubmitInstallationRequest(
  consumer: Partial<Consumer> | null | undefined,
  existingRequests: WaterMeterInstallationRequest[],
  fallbackEmail?: string,
  fallbackUserId?: string
): { allowed: boolean; activeRequest?: WaterMeterInstallationRequest; reason?: string } {
  const acc = String(consumer?.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
  const hasIssuedAcc = Boolean(
    acc &&
      !acc.startsWith('PENDING') &&
      acc !== 'UNASSIGNED' &&
      acc !== 'UNISSUED' &&
      !isPendingConsumerStatus(consumer?.status)
  );
  if (hasIssuedAcc) {
    return {
      allowed: false,
      reason: 'Your water service account already has an active water meter and official Account Number.',
    };
  }

  const matched = filterInstallationRequestsForConsumer(consumer, existingRequests, fallbackEmail, fallbackUserId);
  const activeReq = matched.find((r) => r.status !== 'Cancelled');
  if (activeReq) {
    return {
      allowed: false,
      activeRequest: activeReq,
      reason: `An active installation request (${activeReq.applicationNumber} · ${activeReq.status}) is already on file for your application.`,
    };
  }

  return { allowed: true };
}

/**
 * STRICT GATING RULE:
 * Determines whether an Administrator is allowed to issue finalized Account Numbers and Meter Tag Numbers
 * for a consumer.
 * - If the consumer registered WITHOUT an installed water meter (`hasExistingMeter === false`, or status is
 *   `pending_installation` / `installation_not_scheduled`), official Account Number and Meter Tag Number
 *   issuance is STRICTLY LOCKED until their water meter installation status is confirmed as `'Installed'`.
 * - If the consumer registered WITH an existing physical meter (`hasExistingMeter === true`), or already has
 *   an active issued account, Admin may verify and issue/update IDs.
 */
export function canAdminIssueIdentifiersForConsumer(
  consumer: Partial<Consumer> | null | undefined,
  allRequests: WaterMeterInstallationRequest[]
): {
  allowed: boolean;
  requiresInstallationFirst: boolean;
  latestRequest?: WaterMeterInstallationRequest;
  reason?: string;
} {
  if (!consumer) {
    return { allowed: false, requiresInstallationFirst: false, reason: 'Consumer record not found.' };
  }

  const matchedRequests = filterInstallationRequestsForConsumer(consumer, allRequests);
  const latestReq = matchedRequests[0];

  const needsPhysicalInstallation =
    consumer.hasExistingMeter === false ||
    consumer.status === 'pending_installation' ||
    consumer.status === 'installation_not_scheduled' ||
    Boolean(latestReq);

  if (!needsPhysicalInstallation) {
    return {
      allowed: true,
      requiresInstallationFirst: false,
    };
  }

  if (!latestReq) {
    return {
      allowed: false,
      requiresInstallationFirst: true,
      reason:
        'This applicant indicated that they do not yet have an installed water meter and has not scheduled an installation yet. Physical water meter installation must be scheduled and confirmed as Installed before Account Number and Meter Tag Number can be issued.',
    };
  }

  if (latestReq.status !== 'Installed') {
    return {
      allowed: false,
      requiresInstallationFirst: true,
      latestRequest: latestReq,
      reason: `Water meter installation (${latestReq.applicationNumber}) is currently "${latestReq.status}". Official Account Number and Meter Tag Number issuance unlocks only after physical installation is confirmed as "Installed".`,
    };
  }

  return {
    allowed: true,
    requiresInstallationFirst: true,
    latestRequest: latestReq,
  };
}

// ============================================================================
// PROFESSIONAL CONSUMER NOTIFICATION BUILDERS FOR INSTALLATION WORKFLOW
// NOTE: Physical Meter Serial Number is NEVER included in consumer notifications
// (Meter Serial Number is strictly visible ONLY in the Admin Water Meters module).
// ============================================================================

export function buildInstallationReceivedNotification(
  req: WaterMeterInstallationRequest
): Omit<ConsumerNotification, 'id' | 'timestamp' | 'read'> & { id: string; timestamp: string } {
  const subject = 'Water Meter Installation Request Received';
  const formattedPref = formatInstallationDateDisplay(req.preferredInstallationDate);
  const lines = [
    `Dear ${req.consumerName},`,
    `We have successfully received your request for water meter installation associated with your registration/application number ${req.applicationNumber}.`,
    `Your requested installation date is ${formattedPref}.`,
    ...(req.consumerRemarks
      ? [`Installation Instructions / Remarks Submitted: ${req.consumerRemarks}`]
      : []),
    `Please wait for confirmation from the Tagoloan Water District while our staff reviews your request. You may check your Consumer Portal for updates regarding your installation schedule.`,
    `Thank you.`,
    `Tagoloan Water District`,
  ];

  return {
    id: `notif-inst-recv-${req.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    accountNumber: req.assignedAccountNumber || 'PENDING',
    consumerId: req.consumerId,
    userId: req.linkedUserId,
    consumerEmail: req.consumerEmail.trim().toLowerCase(),
    consumerName: req.consumerName,
    subject,
    title: subject,
    message: lines.join('\n\n'),
    timestamp: req.submissionDate || new Date().toISOString(),
    type: 'installation',
    installationRequestId: req.id,
    applicationNumber: req.applicationNumber,
    installationStatus: 'Pending Review',
    preferredDate: req.preferredInstallationDate,
    sentByAdmin: 'Tagoloan Water District',
    isFromAdmin: true,
  };
}

export function buildInstallationStatusUpdateNotification(
  req: WaterMeterInstallationRequest,
  newStatus: InstallationStatus,
  adminName: string,
  remarks?: string
): (Omit<ConsumerNotification, 'id' | 'timestamp' | 'read'> & { id: string; timestamp: string }) | null {
  const nowIso = new Date().toISOString();
  const cleanRemarks = (remarks ?? req.adminRemarks ?? '').trim();
  const confirmedDisplay = formatInstallationDateDisplay(
    req.confirmedInstallationDate || req.preferredInstallationDate
  );

  let subject = `Water Meter Installation Update — ${newStatus}`;
  let lines: string[] = [];

  if (newStatus === 'Approved' || newStatus === 'Scheduled') {
    subject =
      newStatus === 'Approved'
        ? 'Water Meter Installation Request Approved & Scheduled'
        : 'Water Meter Installation Schedule Confirmed';
    lines = [
      `Dear ${req.consumerName},`,
      `Your water meter installation request under application number ${req.applicationNumber} has been ${newStatus.toLowerCase()} by the Tagoloan Water District.`,
      `Confirmed Installation Schedule: ${confirmedDisplay}.`,
      `Service Location: ${req.address}${req.barangay ? `, Brgy. ${req.barangay}` : ''}.`,
      ...(cleanRemarks ? [`Additional Instructions / Remarks from Administration: ${cleanRemarks}`] : []),
      `Please ensure an authorized household or property representative is available at the service premises on the scheduled installation date.`,
      `Thank you.`,
      `Tagoloan Water District`,
    ];
  } else if (newStatus === 'Rescheduled') {
    subject = 'Water Meter Installation Schedule Revised';
    lines = [
      `Dear ${req.consumerName},`,
      `Please be informed that the water meter installation schedule associated with your application number ${req.applicationNumber} has been rescheduled by the Tagoloan Water District.`,
      `Revised Installation Date: ${confirmedDisplay}.`,
      ...(cleanRemarks
        ? [`Reason / Remarks from Administration: ${cleanRemarks}`]
        : []),
      `You may review the updated schedule anytime in your Consumer Portal. If you have questions regarding this adjustment, you may reply directly to this notice.`,
      `Thank you for your understanding.`,
      `Tagoloan Water District`,
    ];
  } else if (newStatus === 'Installation in Progress') {
    subject = 'Water Meter Installation Now in Progress';
    lines = [
      `Dear ${req.consumerName},`,
      `Field personnel from the Tagoloan Water District are currently conducting the physical water meter installation for your application number ${req.applicationNumber} at ${req.address}.`,
      ...(cleanRemarks ? [`Field Remarks: ${cleanRemarks}`] : []),
      `You will receive another notification once physical installation is completed and forwarded for administrative account validation.`,
      `Thank you.`,
      `Tagoloan Water District`,
    ];
  } else if (newStatus === 'Installed') {
    subject = 'Water Meter Installation Completed';
    lines = [
      `Dear ${req.consumerName},`,
      `We are pleased to inform you that the installation of your water meter has been completed by the Tagoloan Water District.`,
      `Your application (${req.applicationNumber}) is now awaiting administrative validation and account updating. Once the installation details have been reviewed and verified, your official Account Number and Meter Tag Number will be issued and displayed in your Consumer Portal.`,
      ...(cleanRemarks ? [`Installation Remarks: ${cleanRemarks}`] : []),
      `Please wait for another notification regarding the activation and completion of your water service account.`,
      `Thank you for your patience and cooperation.`,
      `Tagoloan Water District`,
    ];
  } else if (newStatus === 'Cancelled') {
    subject = 'Water Meter Installation Request Cancelled';
    lines = [
      `Dear ${req.consumerName},`,
      `We would like to inform you that the water meter installation request associated with your application number ${req.applicationNumber} has been marked as CANCELLED.`,
      ...(cleanRemarks ? [`Reason / Remarks from Administration: ${cleanRemarks}`] : []),
      `If you wish to submit a new installation schedule request or clarify this update, you may schedule a new installation date in your Consumer Portal or reply directly to this notice.`,
      `Thank you.`,
      `Tagoloan Water District`,
    ];
  } else {
    return null;
  }

  return {
    id: `notif-inst-${newStatus.toLowerCase().replace(/\s+/g, '-')}-${req.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}`,
    accountNumber: req.assignedAccountNumber || 'PENDING',
    consumerId: req.consumerId,
    userId: req.linkedUserId,
    consumerEmail: req.consumerEmail.trim().toLowerCase(),
    consumerName: req.consumerName,
    subject,
    title: subject,
    message: lines.join('\n\n'),
    timestamp: nowIso,
    type: 'installation',
    installationRequestId: req.id,
    applicationNumber: req.applicationNumber,
    installationStatus: newStatus,
    preferredDate: req.preferredInstallationDate,
    confirmedDate: req.confirmedInstallationDate || req.preferredInstallationDate,
    remarks: cleanRemarks || undefined,
    updatedByAdmin: adminName,
    sentByAdmin: adminName,
    isFromAdmin: true,
  };
}

/**
 * Builds the official Account Activation notification sent AFTER installation details
 * are validated by the Administrator and the Account Number + Meter Tag Number are issued.
 * STRICT RULE: Never includes physical Meter Serial Number (visible only in Admin Water Meters module).
 */
export function buildAccountActivatedAfterInstallationNotification(params: {
  consumerName: string;
  consumerEmail: string;
  consumerId?: string;
  userId?: string;
  applicationNumber?: string;
  installationRequestId?: string;
  accountNumber: string;
  meterTagNumber: string;
  adminName: string;
}): Omit<ConsumerNotification, 'id' | 'timestamp' | 'read'> & { id: string; timestamp: string } {
  const subject = 'Your Water Service Account Has Been Activated';
  const cleanAcc = params.accountNumber.replace(/^#/, '').trim().toUpperCase();
  const cleanTag = params.meterTagNumber.replace(/^#/, '').trim().toUpperCase();
  const nowIso = new Date().toISOString();

  const lines = [
    `Dear ${params.consumerName},`,
    `Your water meter installation and account verification have been completed by the Tagoloan Water District.`,
    `Your official water service account details are now active:`,
    `Account Number: ${cleanAcc}`,
    `Meter Tag Number: ${cleanTag}`,
    `Account Status: Active`,
    `You may now view your complete account information, billing records, consumption updates, and notifications through your Consumer Portal.`,
    `Thank you for registering with the Tagoloan Water District.`,
    `Tagoloan Water District`,
  ];

  return {
    id: `notif-issued-${cleanAcc.replace(/[^a-zA-Z0-9]/g, '')}`,
    accountNumber: cleanAcc,
    consumerId: params.consumerId,
    userId: params.userId,
    consumerEmail: params.consumerEmail.trim().toLowerCase(),
    consumerName: params.consumerName,
    meterNumber: cleanTag,
    subject,
    title: subject,
    message: lines.join('\n\n'),
    timestamp: nowIso,
    type: 'account_issue',
    applicationNumber: params.applicationNumber,
    installationRequestId: params.installationRequestId,
    updatedByAdmin: params.adminName,
    sentByAdmin: params.adminName,
    isFromAdmin: true,
  };
}

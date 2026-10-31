import { ConsumerNotification, WaterMeter } from '../types';

export type MeterOperationalStatus = 'active' | 'inactive' | 'damaged' | 'maintenance';

export function normalizeMeterStatus(
  raw?: string | null
): WaterMeter['status'] {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'damaged' || s === 'faulty' || s === 'defective') return 'damaged';
  if (s === 'maintenance' || s === 'under_maintenance' || s === 'under maintenance') {
    return 'maintenance';
  }
  if (s === 'inactive' || s === 'deactivated') return 'inactive';
  if (s === 'unassigned') return 'unassigned';
  return 'active';
}

export function formatMeterStatusLabel(status?: string | null): string {
  const normalized = normalizeMeterStatus(status);
  switch (normalized) {
    case 'active':
      return 'Active';
    case 'inactive':
      return 'Inactive';
    case 'damaged':
      return 'Damaged';
    case 'maintenance':
      return 'Under Maintenance';
    case 'unassigned':
      return 'Unassigned';
    default:
      return 'Active';
  }
}

export function formatMeterStatusUpper(status?: string | null): string {
  const normalized = normalizeMeterStatus(status);
  switch (normalized) {
    case 'active':
      return 'ACTIVE';
    case 'inactive':
      return 'INACTIVE';
    case 'damaged':
      return 'DAMAGED';
    case 'maintenance':
      return 'UNDER MAINTENANCE';
    case 'unassigned':
      return 'UNASSIGNED';
    default:
      return 'ACTIVE';
  }
}

export function formatMeterStatusUpdateDate(isoOrDate?: string | null): string {
  if (!isoOrDate) {
    return new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  const parsed = new Date(isoOrDate);
  if (Number.isNaN(parsed.getTime())) {
    return String(isoOrDate);
  }
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export interface BuildMeterStatusNotificationParams {
  consumerName: string;
  accountNumber: string;
  consumerId?: string;
  userId?: string;
  consumerEmail?: string;
  meterNumber: string;
  previousStatus: WaterMeter['status'];
  newStatus: MeterOperationalStatus;
  updateDateIso: string;
  remarks?: string;
  adminName: string;
}

export function buildMeterStatusNotificationPayload(
  params: BuildMeterStatusNotificationParams
): Omit<ConsumerNotification, 'read'> {
  const cleanName = (params.consumerName || 'Valued Consumer').trim();
  const cleanAcc = (params.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
  const cleanMeter = (params.meterNumber || '').trim().toUpperCase();
  const cleanRemarks = (params.remarks || '').trim();
  const formattedDate = formatMeterStatusUpdateDate(params.updateDateIso);
  const statusUpper = formatMeterStatusUpper(params.newStatus);
  const prevLabel = formatMeterStatusLabel(params.previousStatus);

  const remarksLine = cleanRemarks
    ? `Remarks from Administration: ${cleanRemarks}`
    : 'Remarks from Administration: None provided.';

  let title = 'Important Notice Regarding Your Water Meter';
  let bodyParagraphs: string[] = [];

  if (params.newStatus === 'damaged') {
    title = 'Important Notice Regarding Your Water Meter';
    bodyParagraphs = [
      `Dear ${cleanName},`,
      `We would like to inform you that the water meter associated with your account number ${cleanAcc} (Meter #${cleanMeter}) has been marked as DAMAGED in our system following an update from the Tagoloan Water District on ${formattedDate}.`,
      remarksLine,
      `If you have already reported this issue to our office, please disregard this notification and wait for further updates regarding your water meter. However, if you have not yet reported or been informed about this matter, please contact or visit the Tagoloan Water District office (or reply directly below) to clarify the situation and receive further instructions.`,
      `Thank you for your cooperation. — Tagoloan Water District`,
    ];
  } else if (params.newStatus === 'inactive') {
    title = 'Important Notice Regarding Your Water Meter — Inactive';
    bodyParagraphs = [
      `Dear ${cleanName},`,
      `We would like to inform you that the water meter associated with your account number ${cleanAcc} (Meter #${cleanMeter}) is currently marked as INACTIVE in our system following an update from the Tagoloan Water District on ${formattedDate}.`,
      remarksLine,
      `If you have previously requested temporary deactivation or already coordinated this update with our office, please disregard this notice. If you wish to request service reactivation or clarify the status of your water meter, please contact our office or reply directly below.`,
      `Thank you for your cooperation. — Tagoloan Water District`,
    ];
  } else if (params.newStatus === 'maintenance') {
    title = 'Important Notice Regarding Your Water Meter — Under Maintenance';
    bodyParagraphs = [
      `Dear ${cleanName},`,
      `We would like to inform you that the water meter associated with your account number ${cleanAcc} (Meter #${cleanMeter}) is currently marked as UNDER MAINTENANCE in our system following an update from the Tagoloan Water District on ${formattedDate}.`,
      remarksLine,
      `Our technical personnel are conducting inspection, servicing, or calibration on your water meter to ensure accurate consumption readings and reliable water delivery. If you have any questions, please contact our office or reply directly below.`,
      `Thank you for your patience and cooperation. — Tagoloan Water District`,
    ];
  } else {
    const isRestored =
      params.previousStatus === 'damaged' ||
      params.previousStatus === 'maintenance' ||
      params.previousStatus === 'inactive';
    title = isRestored
      ? 'Important Notice Regarding Your Water Meter — Restored to Active'
      : 'Important Notice Regarding Your Water Meter — Active';
    bodyParagraphs = [
      `Dear ${cleanName},`,
      isRestored
        ? `We are pleased to inform you that the water meter associated with your account number ${cleanAcc} (Meter #${cleanMeter}) has been restored to ACTIVE status in our system following an update from the Tagoloan Water District on ${formattedDate}.`
        : `We would like to inform you that the water meter associated with your account number ${cleanAcc} (Meter #${cleanMeter}) has been marked as ACTIVE in our system following an update from the Tagoloan Water District on ${formattedDate}.`,
      remarksLine,
      `Your water meter is recorded as operational for regular water supply service and scheduled meter reading inspections. Should you notice any concern with your water meter, please contact our office or reply directly below.`,
      `Thank you for your cooperation. — Tagoloan Water District`,
    ];
  }

  const tsMs = new Date(params.updateDateIso).getTime() || Date.now();
  const safeMeterKey = cleanMeter.replace(/[^A-Z0-9_-]/g, '') || 'METER';
  const deterministicId = `notif-meter-status-${safeMeterKey}-${params.newStatus}-${tsMs}`;

  const cleanAdminName = (params.adminName || '').trim() || 'TWD Administration';

  return {
    id: deterministicId,
    accountNumber: cleanAcc,
    consumerId: params.consumerId,
    userId: params.userId,
    consumerEmail: params.consumerEmail ? params.consumerEmail.trim().toLowerCase() : undefined,
    subject: 'Important Notice Regarding Your Water Meter',
    title,
    message: bodyParagraphs.join('\n'),
    timestamp: params.updateDateIso,
    type: 'meter_status',
    consumerName: cleanName,
    meterNumber: cleanMeter,
    meterStatus: params.newStatus,
    previousMeterStatus: prevLabel,
    statusUpdateDate: params.updateDateIso,
    remarks: cleanRemarks || undefined,
    updatedByAdmin: cleanAdminName,
    sentByAdmin: cleanAdminName,
    isFromAdmin: true,
  };
}

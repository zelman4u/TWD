/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface User {
  id: string;
  email: string;
  name: string;
  username?: string;
  role: 'admin' | 'consumer' | 'staff' | 'cashier' | 'meter_reader';
  linkedAccountNumber?: string; // For consumers
  employeeId?: string; // For staff / meter readers
  assignedBarangay?: string;
  readerId?: string;
  status: 'active' | 'inactive' | 'pending_approval' | 'pending_installation' | 'installation_not_scheduled';
  contactNumber?: string;
  password?: string;
  passwordUpdatedAt?: number;
  registrationDate?: string;
}

export interface Barangay {
  id: string;
  name: string;
  code: string;
  consumers: number;
  activeMeters: number;
  schedule: string;
  supervisor: string;
  ratePerM3: number;
}

export interface Consumer {
  id?: string;
  accountNumber: string;
  name: string;
  address: string;
  barangayId?: string;
  barangay?: string;
  sitioZone?: string;
  contactNumber: string;
  email: string;
  meterNumber: string;
  meterBrand?: string;
  status: 'active' | 'inactive' | 'archived' | 'blocked' | 'pending_approval' | 'pending_installation' | 'installation_not_scheduled' | 'Disconnection Notice' | 'disconnection_notice';
  applicationNumber?: string;
  hasExistingMeter?: boolean;
  installationRequestId?: string;
  installationStatus?: InstallationStatus;
  accountValidationStatus?: 'pending_installation' | 'awaiting_validation' | 'validated';
  disconnectionNoticeDate?: string;
  gracePeriodOverdueDays?: number;
  unpaidCyclesCount?: number;
  isRegistered: boolean;
  registrationDate?: string;
  createdAt?: number;
  linkedUserId?: string;
  consumerType?: 'Residential' | 'Commercial';
  meterSize?: string;
  householdInfo?: string;
  businessName?: string;
  businessType?: string;
  blockReason?: string;
  blockExpiryDate?: string;
  outstandingBalance?: number;
  rfidTag?: string;
  sequenceNo?: number | string;
  previousReading?: number;
  presentReading?: number;
  currentReading?: number;
  lastConsumption?: number;
  lastReadingDate?: string;
}

export interface MeterReader {
  id: string;
  name: string;
  username?: string;
  password?: string;
  pin?: string;
  email?: string;
  contactNumber?: string;
  employeeId?: string;
  employmentStatus: 'active' | 'inactive' | 'pending_approval';
  assignedRoutes: string[]; // List of routes
  targetRoute?: string;
  zone?: string;
  completedReadings?: number;
  pendingReadings?: number;
  performanceRating?: number; // Scale of 1-5
  registrationDate?: string;
  approvedBy?: string;
  approvalDate?: string;
  linkedUserId?: string;
}

export type InstallationStatus =
  | 'Pending Review'
  | 'Approved'
  | 'Scheduled'
  | 'Rescheduled'
  | 'Installation in Progress'
  | 'Installed'
  | 'Cancelled';

export interface InstallationHistoryEntry {
  id: string;
  timestamp: string;
  status: InstallationStatus | 'Validated & Activated';
  actorName: string;
  actorRole: 'consumer' | 'admin' | 'system';
  action: string;
  scheduledDate?: string;
  remarks?: string;
}

export interface WaterMeterInstallationRequest {
  id: string;
  applicationNumber: string;
  consumerId?: string;
  linkedUserId?: string;
  consumerName: string;
  consumerEmail: string;
  contactNumber: string;
  address: string;
  barangay: string;
  barangayId?: string;
  sitioZone?: string;
  consumerType?: 'Residential' | 'Commercial';
  preferredInstallationDate: string;
  confirmedInstallationDate?: string;
  consumerRemarks?: string;
  adminRemarks?: string;
  submissionDate: string;
  updatedAt: string;
  status: InstallationStatus;
  completionDate?: string;
  responsiblePersonnel?: string;
  /** Physical Water Meter Serial Number — strictly visible ONLY in the Admin Water Meters module */
  meterSerialNumber?: string;
  meterBrand?: string;
  meterSize?: string;
  /** Official Meter Tag Number issued to the consumer upon account validation */
  assignedMeterTagNumber?: string;
  assignedRfidTag?: string;
  /** Official Account Number issued to the consumer upon account validation */
  assignedAccountNumber?: string;
  accountValidationStatus: 'pending_installation' | 'awaiting_validation' | 'validated';
  validatedAt?: string;
  validatedBy?: string;
  hasUnreadAdminAlert?: boolean;
  history: InstallationHistoryEntry[];
}

export interface WaterMeter {
  /** Official Meter Tag Number linked to consumer account */
  meterNumber: string;
  /** Physical Manufacturer Serial Number — strictly visible ONLY in the Admin Water Meters module */
  serialNumber?: string;
  brand: string;
  rfidTag?: string;
  type?: string;
  size?: string;
  installationDate: string;
  completionDate?: string;
  installedBy?: string;
  installationRequestId?: string;
  applicationNumber?: string;
  lastReadingDate?: string;
  lastReadingValue?: number;
  status: 'active' | 'inactive' | 'damaged' | 'maintenance' | 'unassigned';
  linkedAccountNumber: string;
  remarks?: string;
  previousStatus?: 'active' | 'inactive' | 'damaged' | 'maintenance' | 'unassigned';
  statusUpdatedAt?: string;
  statusUpdatedBy?: string;
}

export interface MeterReading {
  id: string;
  meterNumber: string;
  meterBrand?: string;
  sequenceNo?: number | string;
  accountNumber: string;
  consumerName: string;
  address?: string;
  addressZone?: string;
  route: string;
  previousReading: number; // m3 (Prev. Rdg. - Baseline)
  presentReading?: number; // m3 (Pres. Rdg. - Recorded at inspection)
  currentReading: number; // m3 (Curr. Rdg. - Latest dial index)
  consumption: number; // m3 (Usage = Pres - Prev)
  readingDate: string;
  meterReaderDate?: string;
  submittedAt?: string;
  status: 'pending' | 'verified' | 'flagged_abnormal' | 'cancelled';
  meterReaderName: string;
  imageUrl: string;
  notes?: string;
  billingPeriod: string; // e.g., "October 2024"
  paymentStatus?: 'unpaid' | 'paid' | 'partial' | 'processing';
  paymentDate?: string;
  paymentMethod?: string;
  transactionId?: string;
  paymentReference?: string;
  classification?: 'Residential' | 'Commercial';
  gpsLocation?: string;
  meterImageUrl?: string;
  dueDate?: string;
  billAmount?: number; // Basic water charge (Bill Amt.) locked at reading creation/approval
  appliedTariffVersion?: number; // Tariff version in effect when reading was billed
  franchiseTax?: number; // 2% Franchise Tax
  arrears?: number; // Unpaid balance from previous bills
  totalAmount?: number; // Bill Amt + Franchise Tax + Arrears
  amountAfterDueDate?: number; // Total + 10% Late Penalty
  paidAmount?: number;
  remainingBalance?: number;
  penaltyAmount?: number;
  orNumber?: string;
  cashierName?: string;
  paymentReceiptUrl?: string;
  receiptUploadDate?: string;
  receiptStatus?: 'verified' | 'pending_verification' | 'rejected';
  receiptNotes?: string;
  isDisconnectionNoticeIssued?: boolean;
  disconnectionDate?: string;
  isBillingIssued?: boolean;
  billingIssuedAt?: string;
  billingIssuedBy?: string;
  invoiceNumber?: string;
}

export interface ConsumerReportReply {
  id: string;
  reportId: string;
  senderId: string;
  senderName: string;
  senderRole: 'admin' | 'consumer' | 'staff';
  message: string;
  timestamp: string;
  statusUpdate?: 'pending' | 'in_progress' | 'resolved' | 'closed';
}

export interface ReferencedNoticeContext {
  notificationId: string;
  notificationType: ConsumerNotification['type'];
  subject: string;
  sentByAdmin: string;
  sentAt: string;
  summaryExcerpt: string;
  accountNumber?: string;
  consumerName?: string;
  meterNumber?: string;
  meterStatus?: 'active' | 'inactive' | 'damaged' | 'maintenance';
  previousMeterStatus?: string;
  statusUpdateDate?: string;
  remarks?: string;
  billingPeriod?: string;
  readingId?: string;
  applicationNumber?: string;
  installationRequestId?: string;
  installationStatus?: InstallationStatus;
}

export interface ConsumerReport {
  id: string;
  ticketNumber: string;
  accountNumber: string;
  consumerName: string;
  consumerEmail?: string;
  consumerPhone?: string;
  barangay?: string;
  address?: string;
  meterNumber?: string;
  category: 'leak' | 'low_pressure' | 'water_quality' | 'billing' | 'meter_issue' | 'illegal_connection' | 'other';
  title: string;
  description: string;
  urgency: 'normal' | 'urgent' | 'emergency';
  status: 'pending' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  assignedStaff?: string;
  photoUrl?: string;
  replies: ConsumerReportReply[];
  hasUnreadAdminReply?: boolean;
  hasUnreadConsumerUpdate?: boolean;
  sourceNotificationId?: string;
  referencedNotice?: ReferencedNoticeContext;
}

export interface ConsumerNotification {
  id: string;
  accountNumber: string;
  consumerId?: string;
  userId?: string;
  consumerEmail?: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'payment' | 'billing' | 'balance' | 'announcement' | 'disconnection' | 'receipt_upload' | 'report' | 'account_issue' | 'meter_status' | 'installation';
  read: boolean;
  orNumber?: string;
  amountPaid?: number;
  remainingBalance?: number;
  readingId?: string;
  billingPeriod?: string;
  receiptUrl?: string;
  reportId?: string;
  ticketNumber?: string;
  replyId?: string;
  subject?: string;
  consumerName?: string;
  meterNumber?: string;
  meterStatus?: 'active' | 'inactive' | 'damaged' | 'maintenance';
  previousMeterStatus?: string;
  statusUpdateDate?: string;
  remarks?: string;
  updatedByAdmin?: string;
  sentByAdmin?: string;
  isFromAdmin?: boolean;
  applicationNumber?: string;
  installationRequestId?: string;
  installationStatus?: InstallationStatus;
  preferredDate?: string;
  confirmedDate?: string;
  referencedNotice?: ReferencedNoticeContext;
}

export interface RouteAssignment {
  id: string;
  routeName: string;
  description: string;
  assignedReaderId: string;
  assignedReaderName: string;
  totalConsumers: number;
  status: 'completed' | 'in_progress' | 'pending';
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
  category: 'maintenance' | 'disruption' | 'event' | 'info';
  postedBy: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: 'admin' | 'consumer' | 'system' | 'staff' | 'cashier' | 'meter_reader';
  action: string;
  details: string;
  ipAddress: string;
}

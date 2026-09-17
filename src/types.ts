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
  status: 'active' | 'inactive' | 'pending_approval';
  password?: string;
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
  status: 'active' | 'inactive' | 'archived' | 'blocked' | 'pending_approval';
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

export interface WaterMeter {
  meterNumber: string;
  brand: string;
  rfidTag?: string;
  type?: string;
  size?: string;
  installationDate: string;
  lastReadingDate?: string;
  lastReadingValue?: number;
  status: 'active' | 'damaged' | 'maintenance' | 'unassigned';
  linkedAccountNumber: string;
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
  previousReading: number; // m3 (Prev. Rdg.)
  currentReading: number; // m3 (Pres. Rdg.)
  consumption: number; // m3 (Usage = Pres - Prev)
  readingDate: string;
  meterReaderDate?: string;
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
  billAmount?: number; // Basic water charge (Bill Amt.)
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
}

export interface ConsumerNotification {
  id: string;
  accountNumber: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'payment' | 'billing' | 'announcement' | 'disconnection' | 'receipt_upload';
  read: boolean;
  orNumber?: string;
  amountPaid?: number;
  remainingBalance?: number;
  readingId?: string;
  billingPeriod?: string;
  receiptUrl?: string;
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

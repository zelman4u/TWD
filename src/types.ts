/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'consumer' | 'staff' | 'cashier';
  linkedAccountNumber?: string; // For consumers
  status: 'active' | 'inactive';
  password?: string;
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
  status: 'active' | 'inactive' | 'archived' | 'blocked';
  isRegistered: boolean;
  registrationDate?: string;
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
}

export interface MeterReader {
  id: string;
  name: string;
  contactNumber: string;
  employmentStatus: 'active' | 'inactive';
  assignedRoutes: string[]; // List of routes
  completedReadings: number;
  pendingReadings: number;
  performanceRating: number; // Scale of 1-5
}

export interface WaterMeter {
  meterNumber: string;
  brand: string;
  size: string; // e.g., "1/2 inch", "3/4 inch"
  installationDate: string;
  status: 'active' | 'damaged' | 'maintenance' | 'unassigned';
  linkedAccountNumber: string;
}

export interface MeterReading {
  id: string;
  meterNumber: string;
  accountNumber: string;
  consumerName: string;
  route: string;
  previousReading: number; // m3
  currentReading: number; // m3
  consumption: number; // m3
  readingDate: string;
  status: 'pending' | 'verified' | 'flagged_abnormal' | 'cancelled';
  meterReaderName: string;
  imageUrl: string;
  notes?: string;
  billingPeriod: string; // e.g., "June 2026"
  paymentStatus?: 'unpaid' | 'paid' | 'partial' | 'processing';
  paymentDate?: string;
  paymentMethod?: string;
  transactionId?: string;
  paymentReference?: string;
  classification?: 'Residential' | 'Commercial';
  gpsLocation?: string;
  meterImageUrl?: string;
  dueDate?: string;
  paidAmount?: number;
  remainingBalance?: number;
  penaltyAmount?: number;
  orNumber?: string;
  cashierName?: string;
}

export interface ConsumerNotification {
  id: string;
  accountNumber: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'payment' | 'billing' | 'announcement';
  read: boolean;
  orNumber?: string;
  amountPaid?: number;
  remainingBalance?: number;
  readingId?: string;
  billingPeriod?: string;
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
  userRole: 'admin' | 'consumer' | 'system' | 'staff' | 'cashier';
  action: string;
  details: string;
  ipAddress: string;
}

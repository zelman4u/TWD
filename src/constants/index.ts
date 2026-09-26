/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tagoloan Water District - Central Configuration & System Constants
 * 
 * Provides unified, single-source-of-truth constants across admin, consumer,
 * and service modules to facilitate easy detection, identification, and maintenance.
 */

export const DISTRICT_INFO = {
  name: 'Tagoloan Water District',
  acronym: 'TWD',
  tagline: 'Delivering Clean, Safe & Sustainable Water to Tagoloan',
  officeAddress: 'Poblacion, Tagoloan, Misamis Oriental, 9001',
  hotline: '(088) 567-1234',
  mobile: '+63 917 123 4567',
  email: 'support@tagoloanwater.gov.ph',
  officeHours: 'Monday – Friday, 8:00 AM – 5:00 PM',
  portalVersion: 'v4.2.0-Production',
} as const;

export const BILLING_RULES = {
  /** Number of days from bill statement generation until due date */
  DUE_DAYS_STANDARD: 15,
  /** Standard late payment surcharge percentage (10%) */
  LATE_SURCHARGE_PERCENTAGE: 0.10,
  /** 3-month payment grace period cutoff in days (90 days) */
  GRACE_PERIOD_DAYS_CUTOFF: 90,
  /** Maximum allowable unpaid consecutive monthly billing cycles before Disconnection Notice */
  MAX_UNPAID_CYCLES_BEFORE_DISCONNECTION: 3,
  /** Grace period cutoff notice lead time in working days */
  DISCONNECTION_NOTICE_LEAD_DAYS: 5,
  /** Minimum partial payment percentage accepted online (50%) */
  MIN_PARTIAL_PAYMENT_PERCENTAGE: 0.50,
} as const;

export const STORAGE_KEYS = {
  PREFIX: 'twd_live_v4_',
  USERS: 'twd_live_v4_users',
  CONSUMERS: 'twd_live_v4_consumers',
  READERS: 'twd_live_v4_readers',
  METERS: 'twd_live_v4_meters',
  READINGS: 'twd_live_v4_readings',
  ROUTES: 'twd_live_v4_routes',
  ANNOUNCEMENTS: 'twd_live_v4_announcements',
  AUDIT_LOGS: 'twd_live_v4_audit_logs',
  NOTIFICATIONS: 'twd_live_v4_notifications',
  BARANGAYS: 'twd_live_v4_barangays',
  TERMINATED: 'twd_live_v4_terminated_accounts',
  CURRENT_USER: 'twd_live_v4_current_user',
  FIRESTORE_QUOTA: 'twd_firestore_quota_exceeded',
  SYNC_PING: 'twd_sync_ping',
} as const;

export const FIRESTORE_COLLECTIONS = {
  USERS: 'users',
  CONSUMERS: 'consumers',
  READERS: 'readers',
  METERS: 'meters',
  READINGS: 'readings',
  ROUTES: 'routes',
  ANNOUNCEMENTS: 'announcements',
  AUDIT_LOGS: 'audit_logs',
  NOTIFICATIONS: 'notifications',
  BARANGAYS: 'barangays',
} as const;

export const STANDARD_BARANGAYS = [
  { id: 'BRG-01', name: 'Poblacion', code: 'PB-01', ratePerM3: 24.50, zone: 'Zone 1-4: Poblacion (Main Central)' },
  { id: 'BRG-02', name: 'Natumolan', code: 'NT-02', ratePerM3: 24.50, zone: 'Zone 5-8: Natumolan Coastal & Residential' },
  { id: 'BRG-03', name: 'Baluarte', code: 'BL-03', ratePerM3: 24.50, zone: 'Zone 9-10: Baluarte Agricultural & Commercial' },
  { id: 'BRG-04', name: 'Sta. Ana', code: 'SA-04', ratePerM3: 24.50, zone: 'Zone 4: Sta. Ana Rural' },
  { id: 'BRG-05', name: 'Sta. Cruz', code: 'SC-05', ratePerM3: 24.50, zone: 'Zone 5: Sta. Cruz Sub-Central' },
  { id: 'BRG-06', name: 'Mohon', code: 'MH-06', ratePerM3: 24.50, zone: 'Zone 11-12: Mohon Industrial Corridor' },
  { id: 'BRG-07', name: 'Gracia', code: 'GR-07', ratePerM3: 24.50, zone: 'Zone 7: Gracia Uplands' },
  { id: 'BRG-08', name: 'Casinglot', code: 'CS-08', ratePerM3: 24.50, zone: 'Zone 8: Casinglot Residential' },
  { id: 'BRG-09', name: 'Sugbongcogon', code: 'SG-09', ratePerM3: 24.50, zone: 'Zone 9: Sugbongcogon Valley' },
] as const;

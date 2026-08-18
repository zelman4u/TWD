/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User, Consumer, MeterReader, WaterMeter, MeterReading, RouteAssignment, Announcement, AuditLog, ConsumerNotification, Barangay } from './types';
import { initializeFirestoreSeed, syncBatchToFirestore, syncDocToFirestore, COLLECTIONS } from './services/firebaseDb';

// Storage keys
const STORAGE_PREFIX = 'twd_';
const KEYS = {
  USERS: `${STORAGE_PREFIX}users`,
  CONSUMERS: `${STORAGE_PREFIX}consumers`,
  READERS: `${STORAGE_PREFIX}readers`,
  METERS: `${STORAGE_PREFIX}meters`,
  READINGS: `${STORAGE_PREFIX}readings`,
  ROUTES: `${STORAGE_PREFIX}routes`,
  ANNOUNCEMENTS: `${STORAGE_PREFIX}announcements`,
  AUDIT_LOGS: `${STORAGE_PREFIX}audit_logs`,
  NOTIFICATIONS: `${STORAGE_PREFIX}notifications`,
  CURRENT_USER: `${STORAGE_PREFIX}current_user`,
  BARANGAYS: `${STORAGE_PREFIX}barangays`,
};

// Initial Seed Data
const INITIAL_BARANGAYS: Barangay[] = [
  { id: 'BRG-01', name: 'Poblacion East', code: 'PE-01', consumers: 245, activeMeters: 240, schedule: '1st - 5th of Month', supervisor: 'Engr. Juan Dela Cruz', ratePerM3: 24.50 },
  { id: 'BRG-02', name: 'Poblacion West', code: 'PW-02', consumers: 198, activeMeters: 192, schedule: '6th - 10th of Month', supervisor: 'Engr. Juan Dela Cruz', ratePerM3: 24.50 },
  { id: 'BRG-03', name: 'Natumolan', code: 'NT-03', consumers: 312, activeMeters: 305, schedule: '11th - 15th of Month', supervisor: 'Roberto Tan', ratePerM3: 24.50 },
  { id: 'BRG-04', name: 'Baluarte', code: 'BL-04', consumers: 180, activeMeters: 175, schedule: '16th - 20th of Month', supervisor: 'Roberto Tan', ratePerM3: 24.50 },
  { id: 'BRG-05', name: 'Sta. Ana', code: 'SA-05', consumers: 155, activeMeters: 150, schedule: '21st - 25th of Month', supervisor: 'Engr. Juan Dela Cruz', ratePerM3: 24.50 },
  { id: 'BRG-06', name: 'Sta. Cruz', code: 'SC-06', consumers: 120, activeMeters: 118, schedule: '26th - End of Month', supervisor: 'Elena Ramos', ratePerM3: 24.50 },
  { id: 'BRG-07', name: 'Mohon', code: 'MH-07', consumers: 88, activeMeters: 85, schedule: '1st - 5th of Month', supervisor: 'Engr. Juan Dela Cruz', ratePerM3: 24.50 },
  { id: 'BRG-08', name: 'Gracia', code: 'GR-08', consumers: 94, activeMeters: 90, schedule: '6th - 10th of Month', supervisor: 'Roberto Tan', ratePerM3: 24.50 },
  { id: 'BRG-09', name: 'Casinglot', code: 'CS-09', consumers: 112, activeMeters: 108, schedule: '11th - 15th of Month', supervisor: 'Engr. Juan Dela Cruz', ratePerM3: 24.50 },
  { id: 'BRG-10', name: 'Sugbongcogon', code: 'SG-10', consumers: 76, activeMeters: 72, schedule: '16th - 20th of Month', supervisor: 'Roberto Tan', ratePerM3: 24.50 },
];

const INITIAL_USERS: User[] = [
  {
    id: 'admin-1',
    email: 'admin@tagoloanwater.gov.ph',
    name: 'Engr. Salvador Castillo',
    role: 'admin',
    status: 'active',
  },
  {
    id: 'user-consumer-1',
    email: 'john@example.com',
    name: 'John Doe',
    role: 'consumer',
    linkedAccountNumber: '1001-A',
    status: 'active',
  },
  {
    id: 'user-consumer-2',
    email: 'maria@example.com',
    name: 'Maria Santos',
    role: 'consumer',
    linkedAccountNumber: '1002-B',
    status: 'active',
  }
];

const INITIAL_CONSUMERS: Consumer[] = [
  {
    accountNumber: '1001-A',
    name: 'John Doe',
    address: 'Zone 1, Poblacion East, Tagoloan, Misamis Oriental',
    barangayId: 'BRG-01',
    barangay: 'Poblacion East',
    sitioZone: 'Zone 1',
    contactNumber: '09171234567',
    email: 'john@example.com',
    meterNumber: 'MT-7711',
    status: 'active',
    isRegistered: true,
    registrationDate: '2026-05-10',
    linkedUserId: 'user-consumer-1',
    consumerType: 'Residential',
    meterSize: '1/2 inch',
    householdInfo: '4 members'
  },
  {
    accountNumber: '1002-B',
    name: 'Maria Santos',
    address: 'Zone 4, Baluarte, Tagoloan, Misamis Oriental',
    barangayId: 'BRG-04',
    barangay: 'Baluarte',
    sitioZone: 'Zone 4',
    contactNumber: '09187654321',
    email: 'maria@example.com',
    meterNumber: 'MT-7712',
    status: 'active',
    isRegistered: true,
    registrationDate: '2026-05-12',
    linkedUserId: 'user-consumer-2',
    consumerType: 'Residential',
    meterSize: '1/2 inch',
    householdInfo: '3 members'
  },
  {
    accountNumber: '1003-C',
    name: 'Arthur Pendelton',
    address: 'Zone 2, Natumolan, Tagoloan, Misamis Oriental',
    barangayId: 'BRG-03',
    barangay: 'Natumolan',
    sitioZone: 'Zone 2',
    contactNumber: '09228881234',
    email: 'arthur@example.com',
    meterNumber: 'MT-7713',
    status: 'active',
    isRegistered: false,
    consumerType: 'Commercial',
    businessName: 'Arthur Food Haus',
    businessType: 'Restaurant',
    meterSize: '3/4 inch'
  },
  {
    accountNumber: '2001-X',
    name: 'Ramon Valenzuela',
    address: 'Zone 3, Natumolan, Tagoloan, Misamis Oriental',
    barangayId: 'BRG-03',
    barangay: 'Natumolan',
    sitioZone: 'Zone 3',
    contactNumber: '09203334444',
    email: 'ramon@temp.com',
    meterNumber: 'MT-9001',
    status: 'active',
    isRegistered: false,
    consumerType: 'Residential',
    meterSize: '1/2 inch',
    householdInfo: '5 members'
  },
  {
    accountNumber: '2002-Y',
    name: 'Clara Generosa',
    address: 'Zone 5, Sta. Ana, Tagoloan, Misamis Oriental',
    barangayId: 'BRG-05',
    barangay: 'Sta. Ana',
    sitioZone: 'Zone 5',
    contactNumber: '09355556666',
    email: 'clara@temp.com',
    meterNumber: 'MT-9002',
    status: 'active',
    isRegistered: false,
    consumerType: 'Residential',
    meterSize: '1/2 inch',
    householdInfo: '2 members'
  },
  {
    accountNumber: '2003-Z',
    name: 'Wilfredo Macabebe',
    address: 'Zone 2, Sta. Cruz, Tagoloan, Misamis Oriental',
    barangayId: 'BRG-06',
    barangay: 'Sta. Cruz',
    sitioZone: 'Zone 2',
    contactNumber: '09774441234',
    email: 'wilfredo@temp.com',
    meterNumber: 'MT-9003',
    status: 'active',
    isRegistered: false,
    consumerType: 'Commercial',
    businessName: 'Wilfredo Auto Shop',
    businessType: 'Automotive Workshop',
    meterSize: '3/4 inch'
  }
];

const INITIAL_READERS: MeterReader[] = [
  {
    id: 'reader-1',
    name: 'Danilo Alcantara',
    contactNumber: '09451239876',
    employmentStatus: 'active',
    assignedRoutes: ['Poblacion East', 'Natumolan'],
    completedReadings: 142,
    pendingReadings: 18,
    performanceRating: 4.8,
  },
  {
    id: 'reader-2',
    name: 'Michael Vance',
    contactNumber: '09159847253',
    employmentStatus: 'active',
    assignedRoutes: ['Baluarte', 'Sta. Ana'],
    completedReadings: 110,
    pendingReadings: 25,
    performanceRating: 4.5,
  },
  {
    id: 'reader-3',
    name: 'Gregorio Lopez',
    contactNumber: '09367253912',
    employmentStatus: 'inactive',
    assignedRoutes: ['Sta. Cruz'],
    completedReadings: 80,
    pendingReadings: 0,
    performanceRating: 4.2,
  },
];

const INITIAL_METERS: WaterMeter[] = [
  {
    meterNumber: 'MT-7711',
    brand: 'NBI WaterTech',
    size: '1/2 inch',
    installationDate: '2024-01-15',
    status: 'active',
    linkedAccountNumber: '1001-A',
  },
  {
    meterNumber: 'MT-7712',
    brand: 'Arad Group',
    size: '1/2 inch',
    installationDate: '2024-02-18',
    status: 'active',
    linkedAccountNumber: '1002-B',
  },
  {
    meterNumber: 'MT-7713',
    brand: 'Zenner USA',
    size: '3/4 inch',
    installationDate: '2025-03-10',
    status: 'active',
    linkedAccountNumber: '1003-C',
  },
  {
    meterNumber: 'MT-9001',
    brand: 'Sensory Logic',
    size: '1/2 inch',
    installationDate: '2024-11-20',
    status: 'active',
    linkedAccountNumber: '2001-X',
  },
  {
    meterNumber: 'MT-9002',
    brand: 'NBI WaterTech',
    size: '1/2 inch',
    installationDate: '2025-01-05',
    status: 'active',
    linkedAccountNumber: '2002-Y',
  },
  {
    meterNumber: 'MT-9003',
    brand: 'Zenner USA',
    size: '3/4 inch',
    installationDate: '2025-05-12',
    status: 'active',
    linkedAccountNumber: '2003-Z',
  }
];

const INITIAL_READINGS: MeterReading[] = [
  // Readings for 1001-A (John Doe)
  {
    id: 'R-1001-A-1',
    meterNumber: 'MT-7711',
    accountNumber: '1001-A',
    consumerName: 'John Doe',
    route: 'Poblacion East',
    previousReading: 210,
    currentReading: 226,
    consumption: 16,
    readingDate: '2026-03-02',
    status: 'verified',
    meterReaderName: 'Danilo Alcantara',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    notes: 'Normal consumption',
    billingPeriod: 'March 2026',
    paymentStatus: 'paid',
    paymentDate: '2026-03-07',
    paymentMethod: 'Credit/Debit Card',
    transactionId: 'TXN-1001A329',
    paymentReference: 'PAYREF-887711'
  },
  {
    id: 'R-1001-A-2',
    meterNumber: 'MT-7711',
    accountNumber: '1001-A',
    consumerName: 'John Doe',
    route: 'Poblacion East',
    previousReading: 226,
    currentReading: 244,
    consumption: 18,
    readingDate: '2026-04-03',
    status: 'verified',
    meterReaderName: 'Danilo Alcantara',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    notes: 'Slightly higher usage',
    billingPeriod: 'April 2026',
    paymentStatus: 'paid',
    paymentDate: '2026-04-09',
    paymentMethod: 'GCash',
    transactionId: 'TXN-1001A843',
    paymentReference: 'PAYREF-887712'
  },
  {
    id: 'R-1001-A-3',
    meterNumber: 'MT-7711',
    accountNumber: '1001-A',
    consumerName: 'John Doe',
    route: 'Poblacion East',
    previousReading: 244,
    currentReading: 261,
    consumption: 17,
    readingDate: '2026-05-02',
    status: 'verified',
    meterReaderName: 'Danilo Alcantara',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    notes: 'Clean meter crystal',
    billingPeriod: 'May 2026',
    paymentStatus: 'paid',
    paymentDate: '2026-05-10',
    paymentMethod: 'Online Banking (Landbank)',
    transactionId: 'TXN-1001A948',
    paymentReference: 'PAYREF-887713'
  },
  {
    id: 'R-1001-A-4',
    meterNumber: 'MT-7711',
    accountNumber: '1001-A',
    consumerName: 'John Doe',
    route: 'Poblacion East',
    previousReading: 261,
    currentReading: 321,
    consumption: 60, // Anomalous (high jump)
    readingDate: '2026-06-02',
    status: 'flagged_abnormal',
    meterReaderName: 'Danilo Alcantara',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    notes: 'Leak suspected in garden connection. Reading verified twice.',
    billingPeriod: 'June 2026',
    paymentStatus: 'unpaid'
  },

  // Readings for 1002-B (Maria Santos)
  {
    id: 'R-1002-B-1',
    meterNumber: 'MT-7712',
    accountNumber: '1002-B',
    consumerName: 'Maria Santos',
    route: 'Baluarte',
    previousReading: 110,
    currentReading: 122,
    consumption: 12,
    readingDate: '2026-04-05',
    status: 'verified',
    meterReaderName: 'Michael Vance',
    imageUrl: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?q=80&w=300&auto=format&fit=crop',
    notes: 'Well maintained',
    billingPeriod: 'April 2026',
    paymentStatus: 'paid',
    paymentDate: '2026-04-10',
    paymentMethod: 'PayMaya',
    transactionId: 'TXN-1002B487',
    paymentReference: 'PAYREF-220011'
  },
  {
    id: 'R-1002-B-2',
    meterNumber: 'MT-7712',
    accountNumber: '1002-B',
    consumerName: 'Maria Santos',
    route: 'Baluarte',
    previousReading: 122,
    currentReading: 135,
    consumption: 13,
    readingDate: '2026-05-05',
    status: 'verified',
    meterReaderName: 'Michael Vance',
    imageUrl: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?q=80&w=300&auto=format&fit=crop',
    notes: 'Ok',
    billingPeriod: 'May 2026',
    paymentStatus: 'paid',
    paymentDate: '2026-05-12',
    paymentMethod: 'GCash',
    transactionId: 'TXN-1002B903',
    paymentReference: 'PAYREF-220012'
  },
  {
    id: 'R-1002-B-3',
    meterNumber: 'MT-7712',
    accountNumber: '1002-B',
    consumerName: 'Maria Santos',
    route: 'Baluarte',
    previousReading: 135,
    currentReading: 146,
    consumption: 11,
    readingDate: '2026-06-03',
    status: 'pending',
    meterReaderName: 'Michael Vance',
    imageUrl: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?q=80&w=300&auto=format&fit=crop',
    notes: 'Normal consumption level',
    billingPeriod: 'June 2026',
    paymentStatus: 'unpaid'
  },

  // Readings for 1003-C (Arthur Pendelton)
  {
    id: 'R-1003-C-1',
    meterNumber: 'MT-7713',
    accountNumber: '1003-C',
    consumerName: 'Arthur Pendelton',
    route: 'Natumolan',
    previousReading: 450,
    currentReading: 472,
    consumption: 22,
    readingDate: '2026-05-03',
    status: 'verified',
    meterReaderName: 'Danilo Alcantara',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    notes: 'Commercial rate connection',
    billingPeriod: 'May 2026',
  },
  {
    id: 'R-1003-C-2',
    meterNumber: 'MT-7713',
    accountNumber: '1003-C',
    consumerName: 'Arthur Pendelton',
    route: 'Natumolan',
    previousReading: 472,
    currentReading: 495,
    consumption: 23,
    readingDate: '2026-06-01',
    status: 'pending',
    meterReaderName: 'Danilo Alcantara',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    notes: 'Awaiting verification',
    billingPeriod: 'June 2026',
  }
];

const INITIAL_ROUTES: RouteAssignment[] = [
  {
    id: 'route-1',
    routeName: 'Poblacion East',
    description: 'Central Poblacion covering businesses and housing from municipal hall eastwards.',
    assignedReaderId: 'reader-1',
    assignedReaderName: 'Danilo Alcantara',
    totalConsumers: 160,
    status: 'in_progress',
  },
  {
    id: 'route-2',
    routeName: 'Natumolan',
    description: 'Barangay Natumolan residential cluster.',
    assignedReaderId: 'reader-1',
    assignedReaderName: 'Danilo Alcantara',
    totalConsumers: 120,
    status: 'pending',
  },
  {
    id: 'route-3',
    routeName: 'Baluarte',
    description: 'Baluarte highway and near-shore connections.',
    assignedReaderId: 'reader-2',
    assignedReaderName: 'Michael Vance',
    totalConsumers: 135,
    status: 'completed',
  },
  {
    id: 'route-4',
    routeName: 'Sta. Ana',
    description: 'Sta. Ana agrarian and rural zones.',
    assignedReaderId: 'reader-2',
    assignedReaderName: 'Michael Vance',
    totalConsumers: 95,
    status: 'in_progress',
  },
  {
    id: 'route-5',
    routeName: 'Sta. Cruz',
    description: 'Sta. Cruz residential strip.',
    assignedReaderId: 'reader-3',
    assignedReaderName: 'Gregorio Lopez',
    totalConsumers: 80,
    status: 'pending',
  },
];

const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'ann-1',
    title: 'Emergency Water Service Interruption due to Pipe Repair',
    content: 'Please be informed that there will be a temporary water service interruption on June 5, 2026, from 8:00 AM to 5:00 PM in Poblacion East and Baluarte. This is to facilitate emergency pipe replacement and repair near TWD main pump station. Please store enough water for your household needs. Thank you for your cooperation.',
    date: '2026-06-03',
    category: 'disruption',
    postedBy: 'Admin Office',
  },
  {
    id: 'ann-2',
    title: 'Water Quality Treatment Schedule - Station 3',
    content: 'TWD will perform routine preventive maintenance and chlorination at Pump Station 3 (Natumolan) on June 8, 2026, from 11:00 PM to 4:00 AM. Mild odor and cloudiness may be observed after pressure restoration. Let water flow for 1-2 minutes before domestic consumption. No widespread disruption expected.',
    date: '2026-06-01',
    category: 'maintenance',
    postedBy: 'Engineering Div',
  },
  {
    id: 'ann-3',
    title: 'District 36th Anniversary and Open House event',
    content: 'Join Tagoloan Water District as we celebrate 36 years of providing clean, affordable, and sustainable water solutions to the lovely community of Tagoloan. Drop by our main office on June 15 for complimentary customer treats, souvenirs, and easy account clearing programs!',
    date: '2026-05-28',
    category: 'event',
    postedBy: 'Public Relations office',
  },
  {
    id: 'ann-4',
    title: 'Updated Offline Payment Centers & Partner Banks',
    content: 'To bring you greater convenience, consumers can now settle their monthly water bills through local Palawan Express outlets, Landbank Link.BizPortal, or our main customer assistance counter with no additional convenience fee. Always secure an official receipt upon settlement.',
    date: '2026-05-15',
    category: 'info',
    postedBy: 'Billing Dept',
  }
];

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    timestamp: '2026-06-03T10:15:30Z',
    userId: 'system',
    userName: 'TWD System Agent',
    userRole: 'system',
    action: 'Database Initialized',
    details: 'Initial system catalogs, default configurations, and default users deployed successfully.',
    ipAddress: '127.0.0.1',
  },
  {
    id: 'log-2',
    timestamp: '2026-06-03T11:04:12Z',
    userId: 'admin-1',
    userName: 'Engr. Salvador Castillo',
    userRole: 'admin',
    action: 'Administrator Authentication',
    details: 'Successful administrator credentials validation via the Unified Login component.',
    ipAddress: '192.168.1.55',
  },
  {
    id: 'log-3',
    timestamp: '2026-06-04T02:30:11Z',
    userId: 'reader-1',
    userName: 'Danilo Alcantara',
    userRole: 'system',
    action: 'Field Readings Synchronized',
    details: 'Received and synchronized 4 new meter recordings from mobile handset (Model: Fl_401).',
    ipAddress: '10.0.8.213',
  },
];

// Helper functions to fetch and save from/to localStorage
function getStored<T>(key: string, initial: T): T {
  const data = localStorage.getItem(key);
  if (!data) {
    localStorage.setItem(key, JSON.stringify(initial));
    return initial;
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    return initial;
  }
}

function setStored<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export const mockDb = {
  // Get all datasets
  getUsers: (): User[] => getStored<User[]>(KEYS.USERS, INITIAL_USERS),
  getConsumers: (): Consumer[] => getStored<Consumer[]>(KEYS.CONSUMERS, INITIAL_CONSUMERS),
  getReaders: (): MeterReader[] => getStored<MeterReader[]>(KEYS.READERS, INITIAL_READERS),
  getMeters: (): WaterMeter[] => getStored<WaterMeter[]>(KEYS.METERS, INITIAL_METERS),
  getReadings: (): MeterReading[] => getStored<MeterReading[]>(KEYS.READINGS, INITIAL_READINGS),
  getRoutes: (): RouteAssignment[] => getStored<RouteAssignment[]>(KEYS.ROUTES, INITIAL_ROUTES),
  getAnnouncements: (): Announcement[] => getStored<Announcement[]>(KEYS.ANNOUNCEMENTS, INITIAL_ANNOUNCEMENTS),
  getAuditLogs: (): AuditLog[] => getStored<AuditLog[]>(KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ),
  getBarangays: (): Barangay[] => getStored<Barangay[]>(KEYS.BARANGAYS, INITIAL_BARANGAYS),
  getCurrentUser: (): User | null => {
    const u = localStorage.getItem(KEYS.CURRENT_USER);
    return u ? JSON.parse(u) : null;
  },

  // State Updates
  setCurrentUser: (user: User | null): void => {
    if (user) {
      localStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(KEYS.CURRENT_USER);
    }
  },

  saveUsers: (users: User[]): void => {
    setStored(KEYS.USERS, users);
    syncBatchToFirestore(COLLECTIONS.USERS, users, 'id');
  },
  saveConsumers: (consumers: Consumer[]): void => {
    setStored(KEYS.CONSUMERS, consumers);
    syncBatchToFirestore(COLLECTIONS.CONSUMERS, consumers, 'accountNumber');
  },
  saveReaders: (readers: MeterReader[]): void => {
    setStored(KEYS.READERS, readers);
    syncBatchToFirestore(COLLECTIONS.READERS, readers, 'id');
  },
  saveMeters: (meters: WaterMeter[]): void => {
    setStored(KEYS.METERS, meters);
    syncBatchToFirestore(COLLECTIONS.METERS, meters, 'meterNumber');
  },
  saveReadings: (readings: MeterReading[]): void => {
    setStored(KEYS.READINGS, readings);
    syncBatchToFirestore(COLLECTIONS.READINGS, readings, 'id');
  },
  saveRoutes: (routes: RouteAssignment[]): void => {
    setStored(KEYS.ROUTES, routes);
    syncBatchToFirestore(COLLECTIONS.ROUTES, routes, 'id');
  },
  saveAnnouncements: (anns: Announcement[]): void => {
    setStored(KEYS.ANNOUNCEMENTS, anns);
    syncBatchToFirestore(COLLECTIONS.ANNOUNCEMENTS, anns, 'id');
  },
  saveAuditLogs: (logs: AuditLog[]): void => {
    setStored(KEYS.AUDIT_LOGS, logs);
    syncBatchToFirestore(COLLECTIONS.AUDIT_LOGS, logs, 'id');
  },
  saveBarangays: (barangays: Barangay[]): void => {
    setStored(KEYS.BARANGAYS, barangays);
    syncBatchToFirestore(COLLECTIONS.BARANGAYS, barangays, 'id');
  },

  findOrCreateBarangay: (barangayName: string): Barangay => {
    const list = mockDb.getBarangays();
    const cleanName = barangayName.trim();
    const existing = list.find(b => b.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      return existing;
    }
    // Auto-create matching Barangay if it doesn't exist
    const nextNum = list.length + 1;
    const generatedId = `BRG-${String(nextNum).padStart(2, '0')}`;
    const codePrefix = cleanName.replace(/[^a-zA-Z]/g, '').substring(0, 2).toUpperCase() || 'BG';
    const generatedCode = `${codePrefix}-${String(nextNum).padStart(2, '0')}`;
    
    const newBarangay: Barangay = {
      id: generatedId,
      name: cleanName,
      code: generatedCode,
      consumers: 1,
      activeMeters: 1,
      schedule: '1st - 15th of Month',
      supervisor: 'Engr. Juan Dela Cruz',
      ratePerM3: 24.50
    };
    
    list.push(newBarangay);
    mockDb.saveBarangays(list);
    return newBarangay;
  },

  getNotifications: (accountNumber?: string): ConsumerNotification[] => {
    const list = getStored<ConsumerNotification[]>(KEYS.NOTIFICATIONS, [
      {
        id: 'notif-1',
        accountNumber: '1001-A',
        title: 'Meter Reading & Water Bill Issued - June 2026',
        message: 'Your official meter reading for June 2026 of 60 m³ (₱1,520.00) has been recorded and verified. Statement is now available on your portal. Due date: June 20, 2026.',
        timestamp: new Date().toISOString(),
        type: 'billing',
        read: false,
        readingId: 'R-1001-A-4',
        billingPeriod: 'June 2026',
        remainingBalance: 1520
      }
    ]);
    if (accountNumber) {
      return list.filter(n => n.accountNumber === accountNumber).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }
    return list.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  addNotification: (notif: Omit<ConsumerNotification, 'id' | 'timestamp' | 'read'>): ConsumerNotification => {
    const list = getStored<ConsumerNotification[]>(KEYS.NOTIFICATIONS, []);
    const newNotif: ConsumerNotification = {
      ...notif,
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      read: false
    };
    list.push(newNotif);
    setStored(KEYS.NOTIFICATIONS, list);
    syncDocToFirestore(COLLECTIONS.NOTIFICATIONS, newNotif.id, newNotif as unknown as Record<string, unknown>);
    return newNotif;
  },

  markNotificationRead: (id: string): void => {
    const list = getStored<ConsumerNotification[]>(KEYS.NOTIFICATIONS, []);
    const updated = list.map(n => n.id === id ? { ...n, read: true } : n);
    setStored(KEYS.NOTIFICATIONS, updated);
    syncDocToFirestore(COLLECTIONS.NOTIFICATIONS, id, { read: true });
  },

  addAuditLog: (userId: string, userName: string, userRole: 'admin' | 'consumer' | 'system', action: string, details: string): void => {
    const logs = mockDb.getAuditLogs();
    const newLog: AuditLog = {
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId,
      userName,
      userRole,
      action,
      details,
      ipAddress: '192.168.1.' + Math.floor(Math.random() * 254 + 1), // simulated dynamic local IP
    };
    logs.push(newLog);
    mockDb.saveAuditLogs(logs);
  },

  initFirestore: (): void => {
    initializeFirestoreSeed({
      users: INITIAL_USERS,
      consumers: INITIAL_CONSUMERS,
      readers: INITIAL_READERS,
      meters: INITIAL_METERS,
      readings: INITIAL_READINGS,
      routes: INITIAL_ROUTES,
      announcements: INITIAL_ANNOUNCEMENTS,
      barangays: INITIAL_BARANGAYS,
    });
  },

  resetDatabase: (): void => {
    localStorage.removeItem(KEYS.USERS);
    localStorage.removeItem(KEYS.CONSUMERS);
    localStorage.removeItem(KEYS.READERS);
    localStorage.removeItem(KEYS.METERS);
    localStorage.removeItem(KEYS.READINGS);
    localStorage.removeItem(KEYS.ROUTES);
    localStorage.removeItem(KEYS.ANNOUNCEMENTS);
    localStorage.removeItem(KEYS.AUDIT_LOGS);
    localStorage.removeItem(KEYS.CURRENT_USER);
    localStorage.removeItem(KEYS.BARANGAYS);
  }
};

// Auto initialize Firestore baseline data
mockDb.initFirestore();


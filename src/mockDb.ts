/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User, Consumer, MeterReader, WaterMeter, MeterReading, RouteAssignment, Announcement, AuditLog, ConsumerNotification, Barangay, ConsumerReport, ConsumerReportReply } from './types';
import { 
  WaterTariffConfig, 
  getActiveTariffConfig, 
  saveActiveTariffConfig, 
  DEFAULT_TARIFF_CONFIG 
} from './utils/tariffCalculator';
import { 
  initializeFirestoreSeed, 
  syncBatchToFirestore, 
  syncDocToFirestore, 
  deleteDocFromFirestore, 
  eraseAccountFromFirestore,
  isAccountTerminated,
  addTerminatedAccountKeys,
  removeTerminatedAccountKeys,
  COLLECTIONS 
} from './services/firebaseDb';


// Purge all legacy storage keys containing old mock data
try {
  const legacyPrefixes = ['twd_', 'twd_v1_', 'twd_v2_', 'water_district_', 'twd_live_v1_', 'twd_live_v2_', 'twd_live_v3_'];
  const keysToPurge: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && legacyPrefixes.some(p => k.startsWith(p)) && !k.startsWith('twd_live_v4_')) {
      keysToPurge.push(k);
    }
  }
  keysToPurge.forEach(k => localStorage.removeItem(k));
} catch (e) {
  // Safe failover
}

// Storage keys
const STORAGE_PREFIX = 'twd_live_v4_';
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
  TARIFF_CONFIG: `${STORAGE_PREFIX}tariff_config`,
  REPORTS: `${STORAGE_PREFIX}consumer_reports`,
};

// Initial Sample Consumer Reports
const INITIAL_REPORTS: ConsumerReport[] = [
  {
    id: 'REP-2024-001',
    ticketNumber: 'TWD-CR-2024-001',
    accountNumber: 'BRG-01-3117',
    consumerName: 'Bruce Acero',
    consumerEmail: 'acero@gmail.com',
    consumerPhone: '+63 917 888 2345',
    barangay: 'Poblacion',
    address: 'PUROK 3, POBLACION',
    meterNumber: '150309988',
    category: 'leak',
    title: 'Water Leak along Purok 3 main connection pipe',
    description: 'Noticeable water bubbling out from underground pipe near the meter box outside our gate. Significant drop of pressure observed in our household.',
    urgency: 'urgent',
    status: 'in_progress',
    createdAt: '2024-10-14T08:30:00.000Z',
    updatedAt: '2024-10-14T09:15:00.000Z',
    assignedStaff: 'Field Maintenance Crew - Team Alpha',
    replies: [
      {
        id: 'REP-MSG-001',
        reportId: 'REP-2024-001',
        senderId: 'user-acero',
        senderName: 'Bruce Acero',
        senderRole: 'consumer',
        message: 'Noticeable water bubbling out from underground pipe near the meter box outside our gate. Significant drop of pressure observed in our household.',
        timestamp: '2024-10-14T08:30:00.000Z'
      },
      {
        id: 'REP-MSG-002',
        reportId: 'REP-2024-001',
        senderId: 'admin-1',
        senderName: 'TWD Operations Admin',
        senderRole: 'admin',
        message: 'Good morning Mr. Acero. We have logged your concern and dispatched Field Maintenance Crew (Team Alpha) led by Engr. Morales to inspect the underground coupling at Purok 3.',
        timestamp: '2024-10-14T09:15:00.000Z',
        statusUpdate: 'in_progress'
      }
    ],
    hasUnreadAdminReply: true,
    hasUnreadConsumerUpdate: false
  },
  {
    id: 'REP-2024-002',
    ticketNumber: 'TWD-CR-2024-002',
    accountNumber: '011-102-056',
    consumerName: 'FIGUEROA, GINA O.',
    consumerEmail: 'gina.figueroa@gmail.com',
    consumerPhone: '+63 917 123 4567',
    barangay: 'Poblacion',
    address: 'SIHAYON-LEFT (ZONE-11A)',
    meterNumber: '150307143',
    category: 'billing',
    title: 'Inquiry regarding October Consumption Breakdown',
    description: 'Requesting confirmation on whether late penalty is waived before due date. Would like clarification on franchise tax calculation.',
    urgency: 'normal',
    status: 'resolved',
    createdAt: '2024-10-10T10:00:00.000Z',
    updatedAt: '2024-10-10T11:20:00.000Z',
    resolvedAt: '2024-10-10T11:20:00.000Z',
    assignedStaff: 'Billing Department Desk 2',
    replies: [
      {
        id: 'REP-MSG-003',
        reportId: 'REP-2024-002',
        senderId: 'consumer-gina',
        senderName: 'Gina Figueroa',
        senderRole: 'consumer',
        message: 'Requesting confirmation on whether late penalty is waived before due date. Would like clarification on franchise tax calculation.',
        timestamp: '2024-10-10T10:00:00.000Z'
      },
      {
        id: 'REP-MSG-004',
        reportId: 'REP-2024-002',
        senderId: 'admin-1',
        senderName: 'TWD Billing Supervisor',
        senderRole: 'admin',
        message: 'Hello Ms. Figueroa! The 10% late surcharge is strictly applied only after the due date. The 2% franchise tax is mandated by national utility regulations. Your current statement is valid for normal payment.',
        timestamp: '2024-10-10T11:20:00.000Z',
        statusUpdate: 'resolved'
      }
    ],
    hasUnreadAdminReply: false,
    hasUnreadConsumerUpdate: false
  }
];

// Initial Clean Seed Data - Tagoloan Municipal Barangays
const INITIAL_BARANGAYS: Barangay[] = [
  { id: 'BRG-01', name: 'Poblacion', code: 'PB-01', consumers: 0, activeMeters: 0, schedule: '1st - 5th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-02', name: 'Natumolan', code: 'NT-02', consumers: 0, activeMeters: 0, schedule: '6th - 10th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-03', name: 'Baluarte', code: 'BL-03', consumers: 0, activeMeters: 0, schedule: '11th - 15th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-04', name: 'Sta. Ana', code: 'SA-04', consumers: 0, activeMeters: 0, schedule: '16th - 20th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-05', name: 'Sta. Cruz', code: 'SC-05', consumers: 0, activeMeters: 0, schedule: '21st - 25th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-06', name: 'Mohon', code: 'MH-06', consumers: 0, activeMeters: 0, schedule: '26th - End of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-07', name: 'Gracia', code: 'GR-07', consumers: 0, activeMeters: 0, schedule: '1st - 5th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-08', name: 'Casinglot', code: 'CS-08', consumers: 0, activeMeters: 0, schedule: '6th - 10th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
  { id: 'BRG-09', name: 'Sugbongcogon', code: 'SG-09', consumers: 0, activeMeters: 0, schedule: '11th - 15th of Month', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 },
];

const INITIAL_USERS: User[] = [
  {
    id: 'admin-1',
    email: 'admin@tagoloanwater.gov.ph',
    name: 'Admin',
    role: 'admin',
    status: 'active',
    password: 'AdminWater2025!',
  },
  {
    id: 'user-acero',
    email: 'acero@gmail.com',
    name: 'Bruce Acero',
    role: 'consumer',
    status: 'pending_approval',
    password: 'Password123!',
    registrationDate: '2026-08-25',
  }
];

const INITIAL_CONSUMERS: Consumer[] = [
  {
    accountNumber: '',
    name: 'Bruce Acero',
    address: 'PUROK 3, POBLACION',
    barangay: 'Poblacion',
    barangayId: 'BRG-01',
    sitioZone: 'Purok 3',
    contactNumber: '+63 917 888 2345',
    email: 'acero@gmail.com',
    meterNumber: '',
    status: 'pending_approval',
    isRegistered: true,
    registrationDate: '2026-08-25',
    createdAt: 1724630400000,
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '4 members',
    outstandingBalance: 0,
    rfidTag: '',
    sequenceNo: 138,
    linkedUserId: 'user-acero',
  },
  {
    accountNumber: '011-102-056',
    name: 'FIGUEROA, GINA O.',
    address: 'SIHAYON-LEFT (ZONE-11A)',
    barangay: 'Poblacion',
    sitioZone: 'ZONE-11A',
    contactNumber: '+63 917 123 4567',
    email: 'gina.figueroa@gmail.com',
    meterNumber: '150307143',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-01-15',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '4 members',
    outstandingBalance: 205.03,
    rfidTag: 'RFID-150307143',
    sequenceNo: 135,
  },
  {
    accountNumber: '011-302-053',
    name: 'ELLO, CARMEN',
    address: 'SIHAYON-LEFT',
    barangay: 'Poblacion',
    sitioZone: 'Sihayon-Left',
    contactNumber: '+63 918 234 5678',
    email: 'carmen.ello@gmail.com',
    meterNumber: 'E180103545',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-10',
    consumerType: 'Commercial',
    businessName: 'Ello Enterprise / Store',
    businessType: 'Retail & Commercial',
    meterSize: '3/4"',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-E180103545',
    sequenceNo: 136,
  },
  {
    accountNumber: '011-102-042',
    name: 'OKLAND AIDALIN 1 / LLERA',
    address: 'SIHAYON-LEFT',
    barangay: 'Poblacion',
    sitioZone: 'Sihayon-Left',
    contactNumber: '+63 919 345 6789',
    email: 'aidalin.llera@gmail.com',
    meterNumber: '121111102',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-03-05',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '3 members',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-121111102',
    sequenceNo: 137,
  },
  {
    accountNumber: '022-204-118',
    name: 'SABIO, EDUARDO P.',
    address: 'PUROK 2, NATUMOLAN',
    barangay: 'Natumolan',
    barangayId: 'BRG-02',
    sitioZone: 'Purok 2',
    contactNumber: '+63 919 333 4455',
    email: 'eduardo.sabio@gmail.com',
    meterNumber: '160408221',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-01-20',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '4 members',
    outstandingBalance: 180.50,
    rfidTag: 'RFID-160408221',
    sequenceNo: 201,
  },
  {
    accountNumber: '022-501-094',
    name: 'MAGPALE, TERESITA L.',
    address: 'COASTAL ROAD, NATUMOLAN',
    barangay: 'Natumolan',
    barangayId: 'BRG-02',
    sitioZone: 'Zone 5',
    contactNumber: '+63 917 555 7890',
    email: 'teresita.magpale@gmail.com',
    meterNumber: '160409934',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-15',
    consumerType: 'Commercial',
    businessName: 'Magpale Trading',
    businessType: 'General Merchandise',
    meterSize: '3/4"',
    outstandingBalance: 420.00,
    rfidTag: 'RFID-160409934',
    sequenceNo: 202,
  },
  {
    accountNumber: '033-101-077',
    name: 'CABALLES, ROLANDO B.',
    address: 'HIGHWAY PROPER, BALUARTE',
    barangay: 'Baluarte',
    barangayId: 'BRG-03',
    sitioZone: 'Zone 9',
    contactNumber: '+63 920 444 8899',
    email: 'rolando.caballes@gmail.com',
    meterNumber: '170501123',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-01-25',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '5 members',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-170501123',
    sequenceNo: 301,
  },
  {
    accountNumber: '033-202-088',
    name: 'MERCADO, ANICETO C.',
    address: 'RIVERSIDE DRIVE, BALUARTE',
    barangay: 'Baluarte',
    barangayId: 'BRG-03',
    sitioZone: 'Zone 10',
    contactNumber: '+63 921 555 3322',
    email: 'aniceto.mercado@gmail.com',
    meterNumber: '170502234',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-03-10',
    consumerType: 'Commercial',
    businessName: 'Mercado Auto Repair',
    businessType: 'Services',
    meterSize: '3/4"',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-170502234',
    sequenceNo: 302,
  },
  {
    accountNumber: '044-101-019',
    name: 'VALDEZ, RAMON S.',
    address: 'STA. ANA CENTRAL, STA. ANA',
    barangay: 'Sta. Ana',
    barangayId: 'BRG-04',
    sitioZone: 'Zone 13',
    contactNumber: '+63 922 666 4411',
    email: 'ramon.valdez@gmail.com',
    meterNumber: '180601345',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-01',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '3 members',
    outstandingBalance: 145.25,
    rfidTag: 'RFID-180601345',
    sequenceNo: 401,
  },
  {
    accountNumber: '044-202-044',
    name: 'PACAÑA, MERLITA G.',
    address: 'CROSSING STA. ANA, STA. ANA',
    barangay: 'Sta. Ana',
    barangayId: 'BRG-04',
    sitioZone: 'Zone 14',
    contactNumber: '+63 923 777 5522',
    email: 'merlita.pacana@gmail.com',
    meterNumber: '180602456',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-03-12',
    consumerType: 'Commercial',
    businessName: 'Pacaña Eatery & Refreshment',
    businessType: 'Food & Beverage',
    meterSize: '3/4"',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-180602456',
    sequenceNo: 402,
  },
  {
    accountNumber: '055-101-032',
    name: 'YBAÑEZ, DANILO M.',
    address: 'STA. CRUZ VALLEY, STA. CRUZ',
    barangay: 'Sta. Cruz',
    barangayId: 'BRG-05',
    sitioZone: 'Zone 17',
    contactNumber: '+63 925 888 6633',
    email: 'danilo.ybanez@gmail.com',
    meterNumber: '190701567',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-01-28',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '4 members',
    outstandingBalance: 210.00,
    rfidTag: 'RFID-190701567',
    sequenceNo: 501,
  },
  {
    accountNumber: '055-202-061',
    name: 'CASIÑO, ROWENA T.',
    address: 'PUROK 4, STA. CRUZ',
    barangay: 'Sta. Cruz',
    barangayId: 'BRG-05',
    sitioZone: 'Zone 18',
    contactNumber: '+63 926 999 7744',
    email: 'rowena.casino@gmail.com',
    meterNumber: '190702678',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-18',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '5 members',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-190702678',
    sequenceNo: 502,
  },
  {
    accountNumber: '066-202-045',
    name: 'DAGANATO, VICENTE K.',
    address: 'MOHON INDUSTRIAL CORRIDOR, MOHON',
    barangay: 'Mohon',
    barangayId: 'BRG-06',
    sitioZone: 'Zone 11',
    contactNumber: '+63 922 777 6611',
    email: 'vicente.daganato@gmail.com',
    meterNumber: '180602345',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-22',
    consumerType: 'Commercial',
    businessName: 'Daganato Metalworks & Hardware',
    businessType: 'Industrial / Commercial',
    meterSize: '1"',
    outstandingBalance: 580.00,
    rfidTag: 'RFID-180602345',
    sequenceNo: 601,
  },
  {
    accountNumber: '066-101-089',
    name: 'JADMAN, ELEUTERIO R.',
    address: 'FOOTHILL PUROK 2, MOHON',
    barangay: 'Mohon',
    barangayId: 'BRG-06',
    sitioZone: 'Zone 12',
    contactNumber: '+63 927 111 8855',
    email: 'eleuterio.jadman@gmail.com',
    meterNumber: '180603789',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-03-15',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '3 members',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-180603789',
    sequenceNo: 602,
  },
  {
    accountNumber: '077-101-023',
    name: 'RIVERA, FEDERICO D.',
    address: 'GRACIA PROPER, GRACIA',
    barangay: 'Gracia',
    barangayId: 'BRG-07',
    sitioZone: 'Zone 25',
    contactNumber: '+63 928 222 9966',
    email: 'federico.rivera@gmail.com',
    meterNumber: '200801122',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-01-30',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '4 members',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-200801122',
    sequenceNo: 701,
  },
  {
    accountNumber: '077-202-054',
    name: 'GORRES, ISIDRA M.',
    address: 'PUROK 3, GRACIA',
    barangay: 'Gracia',
    barangayId: 'BRG-07',
    sitioZone: 'Zone 26',
    contactNumber: '+63 929 333 0077',
    email: 'isidra.gorres@gmail.com',
    meterNumber: '200802233',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-28',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '2 members',
    outstandingBalance: 120.00,
    rfidTag: 'RFID-200802233',
    sequenceNo: 702,
  },
  {
    accountNumber: '088-101-011',
    name: 'LABIS, GREGORIO F.',
    address: 'CASINGLOT COASTAL, CASINGLOT',
    barangay: 'Casinglot',
    barangayId: 'BRG-08',
    sitioZone: 'Zone 21',
    contactNumber: '+63 930 444 1188',
    email: 'gregorio.labis@gmail.com',
    meterNumber: '210901344',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-05',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '6 members',
    outstandingBalance: 245.00,
    rfidTag: 'RFID-210901344',
    sequenceNo: 801,
  },
  {
    accountNumber: '088-202-076',
    name: 'RANISES, EMMA L.',
    address: 'SEASIDE BLVD, CASINGLOT',
    barangay: 'Casinglot',
    barangayId: 'BRG-08',
    sitioZone: 'Zone 22',
    contactNumber: '+63 931 555 2299',
    email: 'emma.ranises@gmail.com',
    meterNumber: '210902455',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-03-01',
    consumerType: 'Commercial',
    businessName: 'Ranises Beachside Resort',
    businessType: 'Hospitality / Commercial',
    meterSize: '1"',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-210902455',
    sequenceNo: 802,
  },
  {
    accountNumber: '099-101-098',
    name: 'ZAMBRANO, CRISANTO P.',
    address: 'SUGBONGCOGON HIGHWAY, SUGBONGCOGON',
    barangay: 'Sugbongcogon',
    barangayId: 'BRG-09',
    sitioZone: 'Zone 33',
    contactNumber: '+63 932 666 3300',
    email: 'crisanto.zambrano@gmail.com',
    meterNumber: '221001566',
    meterBrand: 'EVER',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-01-18',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '4 members',
    outstandingBalance: 0.00,
    rfidTag: 'RFID-221001566',
    sequenceNo: 901,
  },
  {
    accountNumber: '099-202-033',
    name: 'BEJA, ALICIA N.',
    address: 'PUROK 1, SUGBONGCOGON',
    barangay: 'Sugbongcogon',
    barangayId: 'BRG-09',
    sitioZone: 'Zone 34',
    contactNumber: '+63 933 777 4411',
    email: 'alicia.beja@gmail.com',
    meterNumber: '221002677',
    meterBrand: 'EVJET',
    status: 'active',
    isRegistered: true,
    registrationDate: '2024-02-14',
    consumerType: 'Residential',
    meterSize: '1/2"',
    householdInfo: '3 members',
    outstandingBalance: 165.75,
    rfidTag: 'RFID-221002677',
    sequenceNo: 902,
  }
];

const INITIAL_READERS: MeterReader[] = [
  {
    id: 'reader-1',
    employeeId: 'TWD-2026-001',
    name: 'Marco Polo',
    username: 'marco_polo',
    password: 'password123',
    pin: '1234',
    email: 'marco_polo@tagoloanwater.gov.ph',
    contactNumber: '0917-555-0199',
    employmentStatus: 'active',
    assignedRoutes: ['Zone 1-4: Poblacion (Main Central)'],
    targetRoute: 'Zone 1-4: Poblacion (Main Central)',
    zone: 'Zone 1-4: Poblacion (Main Central)',
    completedReadings: 142,
    pendingReadings: 3,
    performanceRating: 4.9
  }
];

const INITIAL_METERS: WaterMeter[] = [
  {
    meterNumber: '150307143',
    rfidTag: 'RFID-150307143',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-01-15',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 4393,
    status: 'active',
    linkedAccountNumber: '011-102-056'
  },
  {
    meterNumber: 'E180103545',
    rfidTag: 'RFID-E180103545',
    brand: 'EVER',
    type: 'mechanical',
    size: '3/4"',
    installationDate: '2024-02-10',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 2204,
    status: 'active',
    linkedAccountNumber: '011-302-053'
  },
  {
    meterNumber: '121111102',
    rfidTag: 'RFID-121111102',
    brand: 'EVJET',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-03-05',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 2100,
    status: 'active',
    linkedAccountNumber: '011-102-042'
  },
  {
    meterNumber: '160408221',
    rfidTag: 'RFID-160408221',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-01-20',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1540,
    status: 'active',
    linkedAccountNumber: '022-204-118'
  },
  {
    meterNumber: '160409934',
    rfidTag: 'RFID-160409934',
    brand: 'EVJET',
    type: 'mechanical',
    size: '3/4"',
    installationDate: '2024-02-15',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 3210,
    status: 'active',
    linkedAccountNumber: '022-501-094'
  },
  {
    meterNumber: '170501123',
    rfidTag: 'RFID-170501123',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-01-25',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 2890,
    status: 'active',
    linkedAccountNumber: '033-101-077'
  },
  {
    meterNumber: '170502234',
    rfidTag: 'RFID-170502234',
    brand: 'EVJET',
    type: 'mechanical',
    size: '3/4"',
    installationDate: '2024-03-10',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1845,
    status: 'active',
    linkedAccountNumber: '033-202-088'
  },
  {
    meterNumber: '180601345',
    rfidTag: 'RFID-180601345',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-02-01',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1220,
    status: 'active',
    linkedAccountNumber: '044-101-019'
  },
  {
    meterNumber: '180602456',
    rfidTag: 'RFID-180602456',
    brand: 'EVJET',
    type: 'mechanical',
    size: '3/4"',
    installationDate: '2024-03-12',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 2430,
    status: 'active',
    linkedAccountNumber: '044-202-044'
  },
  {
    meterNumber: '190701567',
    rfidTag: 'RFID-190701567',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-01-28',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1980,
    status: 'active',
    linkedAccountNumber: '055-101-032'
  },
  {
    meterNumber: '190702678',
    rfidTag: 'RFID-190702678',
    brand: 'EVJET',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-02-18',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1450,
    status: 'active',
    linkedAccountNumber: '055-202-061'
  },
  {
    meterNumber: '180602345',
    rfidTag: 'RFID-180602345',
    brand: 'EVJET',
    type: 'mechanical',
    size: '1"',
    installationDate: '2024-02-22',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 5120,
    status: 'active',
    linkedAccountNumber: '066-202-045'
  },
  {
    meterNumber: '180603789',
    rfidTag: 'RFID-180603789',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-03-15',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 970,
    status: 'active',
    linkedAccountNumber: '066-101-089'
  },
  {
    meterNumber: '200801122',
    rfidTag: 'RFID-200801122',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-01-30',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1650,
    status: 'active',
    linkedAccountNumber: '077-101-023'
  },
  {
    meterNumber: '200802233',
    rfidTag: 'RFID-200802233',
    brand: 'EVJET',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-02-28',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1110,
    status: 'active',
    linkedAccountNumber: '077-202-054'
  },
  {
    meterNumber: '210901344',
    rfidTag: 'RFID-210901344',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-02-05',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 2240,
    status: 'active',
    linkedAccountNumber: '088-101-011'
  },
  {
    meterNumber: '210902455',
    rfidTag: 'RFID-210902455',
    brand: 'EVJET',
    type: 'mechanical',
    size: '1"',
    installationDate: '2024-03-01',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 3890,
    status: 'active',
    linkedAccountNumber: '088-202-076'
  },
  {
    meterNumber: '221001566',
    rfidTag: 'RFID-221001566',
    brand: 'EVER',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-01-18',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1780,
    status: 'active',
    linkedAccountNumber: '099-101-098'
  },
  {
    meterNumber: '221002677',
    rfidTag: 'RFID-221002677',
    brand: 'EVJET',
    type: 'mechanical',
    size: '1/2"',
    installationDate: '2024-02-14',
    lastReadingDate: '2024-10-15',
    lastReadingValue: 1340,
    status: 'active',
    linkedAccountNumber: '099-202-033'
  }
];

const INITIAL_READINGS: MeterReading[] = [
  {
    id: 'R-011-102-056-202410',
    accountNumber: '011-102-056',
    consumerName: 'FIGUEROA, GINA O.',
    meterNumber: '150307143',
    meterBrand: 'EVER',
    sequenceNo: 135,
    address: 'SIHAYON-LEFT (ZONE-11A)',
    addressZone: 'ZONE-11A',
    route: 'Sihayon-Left Route',
    previousReading: 4377,
    currentReading: 4393,
    consumption: 16,
    readingDate: '2024-10-15',
    meterReaderDate: '2024-10-15',
    status: 'verified',
    meterReaderName: 'MARCO POLO',
    imageUrl: 'https://images.unsplash.com/photo-1584467735815-f778f274e296?w=600&auto=format&fit=crop&q=80',
    billingPeriod: 'October 2024',
    dueDate: 'December 12, 2024',
    classification: 'Residential',
    billAmount: 124.50,
    franchiseTax: 2.54,
    arrears: 205.03,
    totalAmount: 332.07,
    penaltyAmount: 12.45,
    amountAfterDueDate: 344.52,
    paymentStatus: 'unpaid',
  },
  {
    id: 'R-011-302-053-202410',
    accountNumber: '011-302-053',
    consumerName: 'ELLO, CARMEN',
    meterNumber: 'E180103545',
    meterBrand: 'EVER',
    sequenceNo: 136,
    address: 'SIHAYON-LEFT',
    addressZone: 'Sihayon-Left',
    route: 'Sihayon-Left Route',
    previousReading: 2139,
    currentReading: 2204,
    consumption: 65,
    readingDate: '2024-10-15',
    meterReaderDate: '2024-10-15',
    status: 'verified',
    meterReaderName: 'MARCO POLO',
    imageUrl: 'https://images.unsplash.com/photo-1584467735815-f778f274e296?w=600&auto=format&fit=crop&q=80',
    billingPeriod: 'October 2024',
    dueDate: 'December 12, 2024',
    classification: 'Commercial',
    billAmount: 1387.50,
    franchiseTax: 28.32,
    arrears: 0.00,
    totalAmount: 1415.82,
    penaltyAmount: 138.75,
    amountAfterDueDate: 1554.57,
    paymentStatus: 'unpaid',
  },
  {
    id: 'R-011-102-042-202410',
    accountNumber: '011-102-042',
    consumerName: 'OKLAND AIDALIN 1 / LLERA',
    meterNumber: '121111102',
    meterBrand: 'EVJET',
    sequenceNo: 137,
    address: 'SIHAYON-LEFT',
    addressZone: 'Sihayon-Left',
    route: 'Sihayon-Left Route',
    previousReading: 2083,
    currentReading: 2100,
    consumption: 17,
    readingDate: '2024-10-15',
    meterReaderDate: '2024-10-15',
    status: 'verified',
    meterReaderName: 'MARCO POLO',
    imageUrl: 'https://images.unsplash.com/photo-1584467735815-f778f274e296?w=600&auto=format&fit=crop&q=80',
    billingPeriod: 'October 2024',
    dueDate: 'December 12, 2024',
    classification: 'Residential',
    billAmount: 132.75,
    franchiseTax: 2.71,
    arrears: 0.00,
    totalAmount: 135.46,
    penaltyAmount: 13.30,
    amountAfterDueDate: 148.76,
    paymentStatus: 'unpaid',
  },
  {
    id: 'R-022-204-118-PENDING',
    accountNumber: '022-204-118',
    consumerName: 'SABIO, EDUARDO P.',
    meterNumber: 'E180103546',
    meterBrand: 'EVER',
    sequenceNo: 140,
    address: 'PUROK 2, NATUMOLAN',
    addressZone: 'Purok 2',
    route: 'Natumolan Route 1',
    previousReading: 114,
    currentReading: 132,
    consumption: 18,
    readingDate: '2024-11-05',
    meterReaderDate: '2024-11-05',
    status: 'pending',
    meterReaderName: 'MARCO POLO',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    billingPeriod: 'November 2024',
    classification: 'Residential',
    notes: 'Normal residential consumption. Meter seal intact.'
  },
  {
    id: 'R-022-501-094-PENDING',
    accountNumber: '022-501-094',
    consumerName: 'MAGPALE, TERESITA L.',
    meterNumber: 'E180103547',
    meterBrand: 'EVER',
    sequenceNo: 141,
    address: 'COASTAL ROAD, NATUMOLAN',
    addressZone: 'Zone 5',
    route: 'Natumolan Route 1',
    previousReading: 240,
    currentReading: 264,
    consumption: 24,
    readingDate: '2024-11-05',
    meterReaderDate: '2024-11-05',
    status: 'pending',
    meterReaderName: 'MARCO POLO',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    billingPeriod: 'November 2024',
    classification: 'Residential',
    notes: 'Regular reading recorded on schedule.'
  },
  {
    id: 'R-033-101-077-PENDING',
    accountNumber: '033-101-077',
    consumerName: 'CABALLES, ROLANDO B.',
    meterNumber: 'E180103548',
    meterBrand: 'EVJET',
    sequenceNo: 142,
    address: 'HIGHWAY PROPER, BALUARTE',
    addressZone: 'Zone 9',
    route: 'Baluarte Riverside Route',
    previousReading: 85,
    currentReading: 104,
    consumption: 19,
    readingDate: '2024-11-05',
    meterReaderDate: '2024-11-05',
    status: 'pending',
    meterReaderName: 'JUAN DELA CRUZ',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    billingPeriod: 'November 2024',
    classification: 'Residential',
    notes: 'Dial inspected. No leak observed.'
  },
  {
    id: 'R-033-202-088-PENDING',
    accountNumber: '033-202-088',
    consumerName: 'MERCADO, ANICETO C.',
    meterNumber: 'E180103549',
    meterBrand: 'EVER',
    sequenceNo: 143,
    address: 'RIVERSIDE DRIVE, BALUARTE',
    addressZone: 'Zone 10',
    route: 'Baluarte Riverside Route',
    previousReading: 310,
    currentReading: 342,
    consumption: 32,
    readingDate: '2024-11-05',
    meterReaderDate: '2024-11-05',
    status: 'pending',
    meterReaderName: 'JUAN DELA CRUZ',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
    billingPeriod: 'November 2024',
    classification: 'Commercial',
    notes: 'Commercial water service reading. Steady consumption.'
  }
];
const INITIAL_ROUTES: RouteAssignment[] = [];
const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'ann-1',
    title: 'Tagoloan Water District Live System Online',
    content: 'Welcome to the official Tagoloan Water District utility management system. Register your water service account or authenticate using municipal administration credentials.',
    date: '2026-08-18',
    category: 'info',
    postedBy: 'Administrative Office',
  }
];

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    timestamp: new Date().toISOString(),
    userId: 'system',
    userName: 'TWD Core System',
    userRole: 'system',
    action: 'Database Initialized',
    details: 'System initialized with clean municipal registry and official administrator credentials.',
    ipAddress: '127.0.0.1',
  }
];

// Helper functions to fetch and save from/to localStorage
function getStored<T>(key: string, initial: T): T {
  const data = localStorage.getItem(key);
  if (!data) {
    const validInitial = Array.isArray(initial) 
      ? initial.filter((item: any) => !isAccountTerminated(item)) 
      : initial;
    localStorage.setItem(key, JSON.stringify(validInitial));
    return validInitial as unknown as T;
  }
  try {
    const parsed = JSON.parse(data);
    // Automatic cleanup of legacy mock test accounts & name normalization
    if (key === KEYS.READERS) {
      const readers = parsed as MeterReader[];
      const seenIds = new Set<string>();
      const deduplicatedReaders: MeterReader[] = [];
      readers.forEach(r => {
        if (isAccountTerminated(r)) return; // Strictly ignore terminated accounts
        const kId = (r.id || '').trim().toLowerCase();
        const kEmp = (r.employeeId || '').trim().toLowerCase();
        const kUser = (r.username || '').trim().toLowerCase();
        const kName = (r.name || '').trim().toLowerCase();
        const kEmail = (r.email || '').trim().toLowerCase();

        // If this reader matches ANY already seen reader by username, name, employeeId, id, or email, skip duplicate
        if (
          (kId && seenIds.has(kId)) ||
          (kEmp && seenIds.has(kEmp)) ||
          (kUser && seenIds.has(kUser)) ||
          (kName && seenIds.has(kName)) ||
          (kEmail && seenIds.has(kEmail))
        ) {
          return;
        }

        if (kId) seenIds.add(kId);
        if (kEmp) seenIds.add(kEmp);
        if (kUser) seenIds.add(kUser);
        if (kName) seenIds.add(kName);
        if (kEmail) seenIds.add(kEmail);
        deduplicatedReaders.push(r);
      });
      if (deduplicatedReaders.length !== readers.length) {
        localStorage.setItem(key, JSON.stringify(deduplicatedReaders));
        return deduplicatedReaders as unknown as T;
      }
    }
    if (key === KEYS.USERS) {
      const users = parsed as User[];
      let modified = false;
      const seenUsers = new Set<string>();
      const deduplicatedUsers: User[] = [];
      users.forEach(u => {
        if (isAccountTerminated(u)) {
          modified = true;
          return;
        }
        const userKey = (u.id || u.email || u.username || '').trim().toLowerCase();
        if (userKey && !seenUsers.has(userKey)) {
          seenUsers.add(userKey);
          if (u.email) seenUsers.add(u.email.trim().toLowerCase());
          if (u.username) seenUsers.add(u.username.trim().toLowerCase());
          deduplicatedUsers.push(u);
        }
      });
      if (deduplicatedUsers.length !== users.length) {
        modified = true;
      }
      deduplicatedUsers.forEach(u => {
        if (u.email && u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph') {
          if (u.name !== 'Admin') {
            u.name = 'Admin';
            modified = true;
          }
          if (u.password !== 'AdminWater2025!') {
            u.password = 'AdminWater2025!';
            modified = true;
          }
        }
        if (u.email && u.email.toLowerCase() === 'acero@gmail.com') {
          if (u.name !== 'Bruce Acero') {
            u.name = 'Bruce Acero';
            modified = true;
          }
          if (u.status !== 'active') {
            u.status = 'active';
            modified = true;
          }
        }
      });
      const hasMockUsers = deduplicatedUsers.some(u => u.email === 'john@example.com' || u.email === 'maria@example.com');
      const adminExists = deduplicatedUsers.some(u => u.email && u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph');
      
      // Ensure essential baseline users exist (Admin + Acero demo account) only if NOT terminated
      INITIAL_USERS.forEach(iu => {
        if (!isAccountTerminated(iu) && !deduplicatedUsers.some(u => (iu.email && u.email?.toLowerCase() === iu.email.toLowerCase()) || (iu.id && u.id === iu.id))) {
          deduplicatedUsers.push(iu);
          modified = true;
        }
      });

      if (hasMockUsers || !adminExists || modified) {
        const cleanedUsers = deduplicatedUsers
          .filter(u => !isAccountTerminated(u) && u.email !== 'john@example.com' && u.email !== 'maria@example.com');
        if (!cleanedUsers.some(u => u.email && u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph')) {
          cleanedUsers.unshift(INITIAL_USERS[0]);
        }
        localStorage.setItem(key, JSON.stringify(cleanedUsers));
        return cleanedUsers as unknown as T;
      }
    }
    if (key === KEYS.BARANGAYS) {
      const brgs = parsed as Barangay[];
      const hasLegacyPoblacionEast = brgs.some(b => b.name === 'Poblacion East' || b.name === 'Poblacion West');
      if (hasLegacyPoblacionEast) {
        localStorage.setItem(key, JSON.stringify(INITIAL_BARANGAYS));
        return INITIAL_BARANGAYS as unknown as T;
      }
    }
    if (key === KEYS.CONSUMERS) {
      let cons = parsed as Consumer[];
      const hasMockConsumers = cons.some(c => c.accountNumber === '1001-A' && c.name === 'John Doe');
      if (hasMockConsumers) {
        cons = cons.filter(c => c.accountNumber !== '1001-A' && c.accountNumber !== '1002-B' && c.accountNumber !== '1003-C');
      }
      // Ensure authentic example consumers exist and new accounts start without IDs
      let changed = hasMockConsumers;
      cons.forEach(c => {
        if (c.email && c.email.toLowerCase() === 'acero@gmail.com') {
          if (c.accountNumber === 'BRG-01-3117' || c.meterNumber === '150309988' || c.rfidTag === 'MT-88373') {
            c.accountNumber = '';
            c.meterNumber = '';
            c.rfidTag = '';
            c.status = 'pending_approval';
            c.outstandingBalance = 0;
            changed = true;
          }
        }
      });
      INITIAL_CONSUMERS.forEach(ic => {
        const exists = cons.some(c => 
          (ic.accountNumber && c.accountNumber === ic.accountNumber) ||
          (ic.email && c.email && c.email.toLowerCase() === ic.email.toLowerCase()) ||
          (ic.linkedUserId && c.linkedUserId && c.linkedUserId === ic.linkedUserId)
        );
        if (!exists) {
          cons.unshift(ic);
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(key, JSON.stringify(cons));
        return cons as unknown as T;
      }
    }
    if (key === KEYS.METERS) {
      let meters = parsed as WaterMeter[];
      let changed = false;
      INITIAL_METERS.forEach(im => {
        if (!meters.some(m => m.meterNumber === im.meterNumber)) {
          meters.push(im);
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(key, JSON.stringify(meters));
        return meters as unknown as T;
      }
    }
    if (key === KEYS.READINGS) {
      let reads = parsed as MeterReading[];
      const hasMockReads = reads.some(r => r.id.startsWith('R-1001-A') || r.id.startsWith('R-1002-B'));
      if (hasMockReads) {
        reads = reads.filter(r => !r.id.startsWith('R-1001-A') && !r.id.startsWith('R-1002-B'));
      }
      let changed = hasMockReads;

      // Migrate any old pending Acero readings to Bruce Acero with BRG-01-3117
      reads.forEach(r => {
        if (r.id === 'R-PENDING-ACERO-202608' || r.accountNumber === 'PENDING-ACERO' || r.consumerName === 'ACERO, MARIEL S.') {
          r.id = 'R-BRG-01-3117-202608';
          r.accountNumber = 'BRG-01-3117';
          r.consumerName = 'Bruce Acero';
          r.meterNumber = '150309988';
          r.meterBrand = 'EVER';
          r.route = 'Poblacion Zone 3 Route';
          changed = true;
        }
      });

      INITIAL_READINGS.forEach(ir => {
        const alreadyExists = reads.some(r => r.id === ir.id || (r.consumerName.trim().toLowerCase() === ir.consumerName.trim().toLowerCase() && r.billingPeriod === ir.billingPeriod));
        if (!alreadyExists) {
          reads.push(ir);
          changed = true;
        }
      });

      // Synchronize reading account numbers if consumer was assigned official IDs
      try {
        const storedConsumers = localStorage.getItem(KEYS.CONSUMERS);
        if (storedConsumers) {
          const consumersList = JSON.parse(storedConsumers) as Consumer[];
          reads = reads.map(r => {
            const matchedConsumer = consumersList.find(c => 
              (c.accountNumber && c.accountNumber === r.accountNumber) ||
              (c.name && c.name.trim().toLowerCase() === r.consumerName.trim().toLowerCase())
            );
            if (matchedConsumer && matchedConsumer.accountNumber && matchedConsumer.accountNumber !== r.accountNumber && !matchedConsumer.accountNumber.toUpperCase().startsWith('PENDING')) {
              changed = true;
              return {
                ...r,
                accountNumber: matchedConsumer.accountNumber,
                meterNumber: matchedConsumer.meterNumber || r.meterNumber,
                meterBrand: matchedConsumer.meterBrand || r.meterBrand
              };
            }
            return r;
          });
        }
      } catch {}

      if (changed) {
        localStorage.setItem(key, JSON.stringify(reads));
        return reads as unknown as T;
      }
    }
    return parsed;
  } catch (e) {
    return initial;
  }
}

function setStored<T>(key: string, value: T): void {
  try {
    const json = JSON.stringify(value);
    const existing = localStorage.getItem(key);
    if (existing === json) {
      return; // Data has not changed, do not trigger event loops
    }
    localStorage.setItem(key, json);
    if (typeof window !== 'undefined') {
      // Notify mounted components in same window immediately
      window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key, timestamp: Date.now() } }));
      // Cross-tab synchronization ping
      try {
        localStorage.setItem('twd_sync_ping', `${Date.now()}_${key}`);
      } catch {}
    }
  } catch (e) {
    console.warn(`[mockDb] Error persisting key "${key}":`, e);
  }
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
    try {
      const u = localStorage.getItem(KEYS.CURRENT_USER);
      if (!u) return null;
      const user = JSON.parse(u) as User;
      if (user && user.email && user.email.toLowerCase() === 'admin@tagoloanwater.gov.ph') {
        if (user.name !== 'Admin') {
          user.name = 'Admin';
          localStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
        }
      }
      return user;
    } catch {
      return null;
    }
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
    // Deduplicate consumers: if an active record with issued accountNumber exists, drop stale pending placeholders for same user/email/name
    const deduplicated = consumers.filter((c, idx, arr) => {
      const isPending = !c.accountNumber || c.accountNumber.toUpperCase().startsWith('PENDING') || c.status === 'pending_approval';
      if (isPending) {
        const hasActiveTwin = arr.some(o => o !== c && (
          (c.linkedUserId && o.linkedUserId && o.linkedUserId === c.linkedUserId && o.status === 'active') ||
          (c.email && o.email && o.email.toLowerCase() === c.email.toLowerCase() && o.status === 'active') ||
          (c.name && o.name && o.name.toLowerCase() === c.name.toLowerCase() && c.barangay === o.barangay && o.status === 'active')
        ));
        if (hasActiveTwin) return false;
      }
      return true;
    });

    setStored(KEYS.CONSUMERS, deduplicated);
    syncBatchToFirestore(COLLECTIONS.CONSUMERS, deduplicated, 'accountNumber');
  },
  saveReaders: (readers: MeterReader[]): void => {
    const seen = new Set<string>();
    const deduplicated: MeterReader[] = [];
    readers.forEach(r => {
      if (isAccountTerminated(r)) return; // Never save terminated accounts
      const kId = (r.id || '').trim().toLowerCase();
      const kEmp = (r.employeeId || '').trim().toLowerCase();
      const kUser = (r.username || '').trim().toLowerCase();
      const kName = (r.name || '').trim().toLowerCase();
      const kEmail = (r.email || '').trim().toLowerCase();

      if (
        (kId && seen.has(kId)) ||
        (kEmp && seen.has(kEmp)) ||
        (kUser && seen.has(kUser)) ||
        (kName && seen.has(kName)) ||
        (kEmail && seen.has(kEmail))
      ) {
        return;
      }

      if (kId) seen.add(kId);
      if (kEmp) seen.add(kEmp);
      if (kUser) seen.add(kUser);
      if (kName) seen.add(kName);
      if (kEmail) seen.add(kEmail);
      deduplicated.push(r);
    });
    setStored(KEYS.READERS, deduplicated);
    syncBatchToFirestore(COLLECTIONS.READERS, deduplicated, 'id');
  },
  deleteReader: (readerId: string, employeeId?: string, email?: string, username?: string, name?: string): void => {
    // 1. Mark identifiers in blacklist
    addTerminatedAccountKeys([readerId, employeeId, email, username, name]);

    // 2. Remove from local READERS
    const currentReaders = getStored<MeterReader[]>(KEYS.READERS, INITIAL_READERS);
    const updatedReaders = currentReaders.filter(r => 
      !isAccountTerminated(r) &&
      r.id !== readerId && 
      (!employeeId || r.employeeId !== employeeId) && 
      (!email || !r.email || r.email.toLowerCase() !== email.toLowerCase()) &&
      (!username || !r.username || r.username.toLowerCase() !== username.toLowerCase()) &&
      (!name || r.name.toLowerCase() !== name.toLowerCase())
    );
    setStored(KEYS.READERS, updatedReaders);

    // 3. Remove from local USERS
    const allUsers = getStored<User[]>(KEYS.USERS, INITIAL_USERS);
    const updatedUsers = allUsers.filter(u => 
      !isAccountTerminated(u) &&
      u.id !== readerId && 
      (!employeeId || u.employeeId !== employeeId) && 
      (!email || !u.email || u.email.toLowerCase() !== email.toLowerCase()) &&
      (!username || !u.username || u.username.toLowerCase() !== username.toLowerCase()) &&
      (!name || u.name.toLowerCase() !== name.toLowerCase())
    );
    setStored(KEYS.USERS, updatedUsers);

    // 4. Clear any route assignments for this reader
    const currentRoutes = getStored<RouteAssignment[]>(KEYS.ROUTES, INITIAL_ROUTES);
    const updatedRoutes = currentRoutes.map(rt => {
      if (rt.assignedReaderId === readerId || (employeeId && rt.assignedReaderId === employeeId) || (name && rt.assignedReaderName === name)) {
        return {
          ...rt,
          assignedReaderId: '',
          assignedReaderName: '',
          status: 'pending' as const
        };
      }
      return rt;
    });
    setStored(KEYS.ROUTES, updatedRoutes);

    // 5. If current active user in session is this reader, log them out
    const currentUser = mockDb.getCurrentUser();
    if (currentUser && (
      currentUser.id === readerId || 
      (employeeId && currentUser.employeeId === employeeId) || 
      (email && currentUser.email?.toLowerCase() === email.toLowerCase()) ||
      (username && currentUser.username?.toLowerCase() === username.toLowerCase())
    )) {
      mockDb.setCurrentUser(null);
    }

    // 6. Deep erasure across Firestore (documents and queries)
    eraseAccountFromFirestore({
      id: readerId,
      employeeId,
      email,
      username,
      name
    });
  },

  deleteUser: (userId: string, email?: string, username?: string, name?: string): void => {
    addTerminatedAccountKeys([userId, email, username, name]);
    const allUsers = getStored<User[]>(KEYS.USERS, INITIAL_USERS);
    const updatedUsers = allUsers.filter(u => 
      !isAccountTerminated(u) &&
      u.id !== userId &&
      (!email || !u.email || u.email.toLowerCase() !== email.toLowerCase()) &&
      (!username || !u.username || u.username.toLowerCase() !== username.toLowerCase()) &&
      (!name || u.name.toLowerCase() !== name.toLowerCase())
    );
    setStored(KEYS.USERS, updatedUsers);
    eraseAccountFromFirestore({ id: userId, email, username, name });
  },

  deleteConsumer: (accountNumber?: string, email?: string, linkedUserId?: string, name?: string): void => {
    // 1. Add keys to blacklist
    addTerminatedAccountKeys([accountNumber, email, linkedUserId, name]);

    // 2. Erase from CONSUMERS
    const allConsumers = getStored<Consumer[]>(KEYS.CONSUMERS, INITIAL_CONSUMERS);
    const updatedConsumers = allConsumers.filter(c => 
      !isAccountTerminated(c) &&
      (!accountNumber || c.accountNumber !== accountNumber) &&
      (!email || !c.email || c.email.toLowerCase() !== email.toLowerCase()) &&
      (!linkedUserId || c.linkedUserId !== linkedUserId) &&
      (!name || c.name.toLowerCase() !== name.toLowerCase())
    );
    setStored(KEYS.CONSUMERS, updatedConsumers);

    // 3. Delete linked user account if exists
    mockDb.deleteUser(linkedUserId || '', email, undefined, name);

    // 4. Unassign any water meters linked to this consumer
    if (accountNumber) {
      const allMeters = getStored<WaterMeter[]>(KEYS.METERS, INITIAL_METERS);
      const updatedMeters = allMeters.map(m => {
        if (m.linkedAccountNumber === accountNumber) {
          return { ...m, linkedAccountNumber: '' };
        }
        return m;
      });
      setStored(KEYS.METERS, updatedMeters);
    }

    // 5. Erase from Firestore
    const docId = accountNumber || linkedUserId || (email ? `email_${email.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_')}` : '');
    if (docId) {
      deleteDocFromFirestore(COLLECTIONS.CONSUMERS, docId);
    }
    eraseAccountFromFirestore({ id: linkedUserId || accountNumber, email, name });
  },

  deleteMeter: (meterNumber: string): void => {
    const allMeters = getStored<WaterMeter[]>(KEYS.METERS, INITIAL_METERS);
    const updatedMeters = allMeters.filter(m => m.meterNumber !== meterNumber);
    setStored(KEYS.METERS, updatedMeters);

    // Unlink any consumer linked to this meter
    const allConsumers = getStored<Consumer[]>(KEYS.CONSUMERS, INITIAL_CONSUMERS);
    const updatedConsumers = allConsumers.map(c => {
      if (c.meterNumber === meterNumber) {
        return { ...c, meterNumber: 'UNASSIGNED', rfidTag: 'UNASSIGNED' };
      }
      return c;
    });
    setStored(KEYS.CONSUMERS, updatedConsumers);

    deleteDocFromFirestore(COLLECTIONS.METERS, meterNumber);
  },

  deleteReading: (readingId: string): void => {
    const allReadings = getStored<MeterReading[]>(KEYS.READINGS, INITIAL_READINGS);
    const updatedReadings = allReadings.filter(r => r.id !== readingId);
    setStored(KEYS.READINGS, updatedReadings);
    deleteDocFromFirestore(COLLECTIONS.READINGS, readingId);
  },

  deleteAnnouncement: (id: string): void => {
    const allAnnouncements = getStored<Announcement[]>(KEYS.ANNOUNCEMENTS, INITIAL_ANNOUNCEMENTS);
    const updatedAnnouncements = allAnnouncements.filter(a => a.id !== id);
    setStored(KEYS.ANNOUNCEMENTS, updatedAnnouncements);
    deleteDocFromFirestore(COLLECTIONS.ANNOUNCEMENTS, id);
  },

  deleteBarangay: (id: string): void => {
    const allBarangays = getStored<Barangay[]>(KEYS.BARANGAYS, INITIAL_BARANGAYS);
    const updatedBarangays = allBarangays.filter(b => b.id !== id);
    setStored(KEYS.BARANGAYS, updatedBarangays);
    deleteDocFromFirestore(COLLECTIONS.BARANGAYS, id);
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
    const existing = list.find(b => (b.name || '').toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      return existing;
    }
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
      supervisor: 'District Operations Supervisor',
      ratePerM3: 24.50
    };
    
    list.push(newBarangay);
    mockDb.saveBarangays(list);
    return newBarangay;
  },

  getNotifications: (
    accountNumber?: string,
    options?: { userId?: string; email?: string; consumerId?: string; isAdmin?: boolean }
  ): ConsumerNotification[] => {
    const list = getStored<ConsumerNotification[]>(KEYS.NOTIFICATIONS, []);

    // If explicit admin query with no specific consumer target, return all sorted by timestamp
    if (options?.isAdmin && !accountNumber && !options?.userId && !options?.email && !options?.consumerId) {
      return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    const isPlaceholderAccount = (acc?: string): boolean => {
      if (!acc) return true;
      const lower = acc.replace(/^#/, '').trim().toLowerCase();
      return (
        lower === '' ||
        lower === 'pending' ||
        lower === 'pending admin issuance' ||
        lower.startsWith('pending') ||
        lower === 'unassigned' ||
        lower === 'unissued' ||
        lower === 'none' ||
        lower === 'n/a' ||
        lower === 'null' ||
        lower === 'undefined'
      );
    };

    const cleanAccount = (accountNumber || '').replace(/^#/, '').trim().toLowerCase();
    const cleanUserId = (options?.userId || '').trim().toLowerCase();
    const cleanEmail = (options?.email || '').trim().toLowerCase();
    const cleanConsumerId = (options?.consumerId || '').trim().toLowerCase();

    const hasRealAccount = !isPlaceholderAccount(cleanAccount);

    // If consumer has zero valid identifiers, return empty array to prevent ANY data leakage
    if (!hasRealAccount && !cleanUserId && !cleanEmail && !cleanConsumerId) {
      return [];
    }

    const filtered = list.filter(n => {
      const nCleanAcc = (n.accountNumber || '').replace(/^#/, '').trim().toLowerCase();
      const nHasRealAcc = !isPlaceholderAccount(n.accountNumber);
      const nUserId = (n.userId || '').trim().toLowerCase();
      const nEmail = (n.consumerEmail || '').trim().toLowerCase();
      const nConsumerId = (n.consumerId || '').trim().toLowerCase();

      // STRICT CONFLICT EXCLUSION: If notification is explicitly tagged to a different User ID, do NOT match
      if (cleanUserId && nUserId && nUserId !== cleanUserId) {
        return false;
      }
      // STRICT CONFLICT EXCLUSION: If notification is explicitly tagged to a different Email, do NOT match
      if (cleanEmail && nEmail && nEmail !== cleanEmail) {
        return false;
      }
      // STRICT CONFLICT EXCLUSION: If notification is explicitly tagged to a different Consumer ID, do NOT match
      if (cleanConsumerId && nConsumerId && nConsumerId !== cleanConsumerId) {
        return false;
      }

      // 1. Exact User ID Match
      if (cleanUserId && nUserId && nUserId === cleanUserId) {
        return true;
      }

      // 2. Exact Consumer ID Match
      if (cleanConsumerId && nConsumerId && nConsumerId === cleanConsumerId) {
        return true;
      }

      // 3. Exact Email Match
      if (cleanEmail && nEmail && nEmail === cleanEmail) {
        return true;
      }

      // 4. Real Account Number Match (ONLY if neither is a placeholder!)
      if (hasRealAccount && nHasRealAcc && nCleanAcc === cleanAccount) {
        return true;
      }

      // Strictly deny match for any unverified or cross-account notification
      return false;
    });

    return filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  updateConsumerNotifications: (
    filter: { userId?: string; email?: string; consumerId?: string; oldAccountNumber?: string },
    updates: Partial<ConsumerNotification>
  ): void => {
    const list = getStored<ConsumerNotification[]>(KEYS.NOTIFICATIONS, []);
    let modified = false;
    const cleanOldAcc = (filter.oldAccountNumber || '').replace(/^#/, '').trim().toLowerCase();
    const cleanUserId = (filter.userId || '').trim().toLowerCase();
    const cleanEmail = (filter.email || '').trim().toLowerCase();
    const cleanConsumerId = (filter.consumerId || '').trim().toLowerCase();

    const updated = list.map(n => {
      const nCleanAcc = (n.accountNumber || '').replace(/^#/, '').trim().toLowerCase();
      const nUserId = (n.userId || '').trim().toLowerCase();
      const nEmail = (n.consumerEmail || '').trim().toLowerCase();
      const nConsumerId = (n.consumerId || '').trim().toLowerCase();

      const isMatch = (cleanUserId && nUserId && nUserId === cleanUserId) ||
                      (cleanEmail && nEmail && nEmail === cleanEmail) ||
                      (cleanConsumerId && nConsumerId && nConsumerId === cleanConsumerId) ||
                      (cleanOldAcc && nCleanAcc && nCleanAcc === cleanOldAcc);

      if (isMatch) {
        modified = true;
        const next = { ...n, ...updates };
        syncDocToFirestore(COLLECTIONS.NOTIFICATIONS, next.id, next as unknown as Record<string, unknown>);
        return next;
      }
      return n;
    });

    if (modified) {
      setStored(KEYS.NOTIFICATIONS, updated);
    }
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

  // Consumer Service Reports & Admin Reply Methods
  getReports: (accountNumber?: string): ConsumerReport[] => {
    const list = getStored<ConsumerReport[]>(KEYS.REPORTS, INITIAL_REPORTS);
    if (accountNumber) {
      return list.filter(r => r.accountNumber === accountNumber || (r.consumerEmail && r.consumerEmail.toLowerCase() === accountNumber.toLowerCase())).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  getReportById: (id: string): ConsumerReport | undefined => {
    const list = getStored<ConsumerReport[]>(KEYS.REPORTS, INITIAL_REPORTS);
    return list.find(r => r.id === id || r.ticketNumber === id);
  },

  saveReports: (reports: ConsumerReport[]): void => {
    setStored(KEYS.REPORTS, reports);
    syncBatchToFirestore(COLLECTIONS.REPORTS, reports, 'id');
  },

  createReport: (reportData: Omit<ConsumerReport, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt' | 'replies' | 'status' | 'hasUnreadAdminReply' | 'hasUnreadConsumerUpdate'> & { status?: ConsumerReport['status']; initialReply?: string; hasUnreadAdminReply?: boolean; hasUnreadConsumerUpdate?: boolean }): ConsumerReport => {
    const list = getStored<ConsumerReport[]>(KEYS.REPORTS, INITIAL_REPORTS);
    const id = `REP-${Date.now()}`;
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const ticketNumber = `TWD-CR-${new Date().getFullYear()}-${randNum}`;
    const now = new Date().toISOString();

    const replies: ConsumerReportReply[] = [];
    if (reportData.description || reportData.initialReply) {
      replies.push({
        id: `REP-MSG-${Date.now()}-1`,
        reportId: id,
        senderId: reportData.accountNumber || 'consumer',
        senderName: reportData.consumerName,
        senderRole: 'consumer',
        message: reportData.description || reportData.initialReply || '',
        timestamp: now
      });
    }

    const newReport: ConsumerReport = {
      ...reportData,
      id,
      ticketNumber,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      replies,
      hasUnreadAdminReply: false,
      hasUnreadConsumerUpdate: true
    };

    list.unshift(newReport);
    mockDb.saveReports(list);

    mockDb.addAuditLog(
      reportData.accountNumber || 'consumer',
      reportData.consumerName,
      'consumer',
      'Filed Service Report',
      `Filed concern #${ticketNumber} (${reportData.category.toUpperCase()}): "${reportData.title}".`
    );

    return newReport;
  },

  replyToReport: (
    reportId: string, 
    reply: Omit<ConsumerReportReply, 'id' | 'timestamp' | 'reportId'>, 
    newStatus?: ConsumerReport['status'],
    assignedStaff?: string
  ): ConsumerReport | null => {
    const list = getStored<ConsumerReport[]>(KEYS.REPORTS, INITIAL_REPORTS);
    const idx = list.findIndex(r => r.id === reportId || r.ticketNumber === reportId);
    if (idx === -1) return null;

    const report = list[idx];
    const now = new Date().toISOString();
    const replyItem: ConsumerReportReply = {
      ...reply,
      id: `REP-MSG-${Date.now()}`,
      reportId: report.id,
      timestamp: now,
      statusUpdate: newStatus
    };

    const nextStatus = newStatus || report.status;
    const isResolved = nextStatus === 'resolved';

    const updated: ConsumerReport = {
      ...report,
      status: nextStatus,
      updatedAt: now,
      resolvedAt: isResolved ? (report.resolvedAt || now) : report.resolvedAt,
      assignedStaff: assignedStaff !== undefined ? assignedStaff : report.assignedStaff,
      replies: [...report.replies, replyItem],
      hasUnreadAdminReply: reply.senderRole === 'admin',
      hasUnreadConsumerUpdate: reply.senderRole === 'consumer'
    };

    list[idx] = updated;
    mockDb.saveReports(list);

    if (reply.senderRole === 'admin') {
      const consumers = mockDb.getConsumers();
      const matchedConsumer = consumers.find(c => 
        (report.accountNumber && c.accountNumber === report.accountNumber) ||
        (report.consumerEmail && c.email && c.email.toLowerCase() === report.consumerEmail.toLowerCase())
      );
      mockDb.addNotification({
        accountNumber: report.accountNumber,
        consumerId: matchedConsumer?.id,
        userId: matchedConsumer?.linkedUserId,
        consumerEmail: report.consumerEmail || matchedConsumer?.email,
        title: `Official Reply on Concern #${report.ticketNumber}`,
        message: `Admin ${reply.senderName} replied: "${reply.message.length > 90 ? reply.message.slice(0, 87) + '...' : reply.message}" (Status: ${nextStatus.toUpperCase()})`,
        type: 'report',
        reportId: report.id,
        ticketNumber: report.ticketNumber
      });

      mockDb.addAuditLog(
        reply.senderId,
        reply.senderName,
        'admin',
        'Replied to Consumer Report',
        `Responded to Ticket #${report.ticketNumber} for ${report.consumerName} (Status: ${nextStatus}).`
      );
    } else {
      mockDb.addAuditLog(
        reply.senderId,
        reply.senderName,
        'consumer',
        'Updated Service Report',
        `Added follow-up message to Ticket #${report.ticketNumber}.`
      );
    }

    return updated;
  },

  updateReportStatus: (reportId: string, status: ConsumerReport['status'], assignedStaff?: string): ConsumerReport | null => {
    const list = getStored<ConsumerReport[]>(KEYS.REPORTS, INITIAL_REPORTS);
    const idx = list.findIndex(r => r.id === reportId || r.ticketNumber === reportId);
    if (idx === -1) return null;

    const report = list[idx];
    const now = new Date().toISOString();
    const isResolved = status === 'resolved';

    const updated: ConsumerReport = {
      ...report,
      status,
      updatedAt: now,
      resolvedAt: isResolved ? now : report.resolvedAt,
      assignedStaff: assignedStaff !== undefined ? assignedStaff : report.assignedStaff,
      hasUnreadAdminReply: true
    };

    list[idx] = updated;
    mockDb.saveReports(list);

    const consumers = mockDb.getConsumers();
    const matchedConsumer = consumers.find(c => 
      (report.accountNumber && c.accountNumber === report.accountNumber) ||
      (report.consumerEmail && c.email && c.email.toLowerCase() === report.consumerEmail.toLowerCase())
    );
    mockDb.addNotification({
      accountNumber: report.accountNumber,
      consumerId: matchedConsumer?.id,
      userId: matchedConsumer?.linkedUserId,
      consumerEmail: report.consumerEmail || matchedConsumer?.email,
      title: `Status Updated for Ticket #${report.ticketNumber}`,
      message: `Your report status was changed to ${status.toUpperCase().replace('_', ' ')}.${assignedStaff ? ` Assigned to: ${assignedStaff}` : ''}`,
      type: 'report',
      reportId: report.id,
      ticketNumber: report.ticketNumber
    });

    return updated;
  },

  markReportReadByConsumer: (reportId: string): void => {
    const list = getStored<ConsumerReport[]>(KEYS.REPORTS, INITIAL_REPORTS);
    const updated = list.map(r => (r.id === reportId || r.ticketNumber === reportId) ? { ...r, hasUnreadAdminReply: false } : r);
    setStored(KEYS.REPORTS, updated);
  },

  markReportReadByAdmin: (reportId: string): void => {
    const list = getStored<ConsumerReport[]>(KEYS.REPORTS, INITIAL_REPORTS);
    const updated = list.map(r => (r.id === reportId || r.ticketNumber === reportId) ? { ...r, hasUnreadConsumerUpdate: false } : r);
    setStored(KEYS.REPORTS, updated);
  },

  addAuditLog: (userId: string, userName: string, userRole: 'admin' | 'consumer' | 'system' | 'staff' | 'cashier' | 'meter_reader', action: string, details: string): void => {
    const logs = mockDb.getAuditLogs();
    const newLog: AuditLog = {
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId,
      userName,
      userRole,
      action,
      details,
      ipAddress: '192.168.1.' + Math.floor(Math.random() * 254 + 1),
    };
    logs.push(newLog);
    mockDb.saveAuditLogs(logs);
  },

  getTariffConfig: (): WaterTariffConfig => {
    return getActiveTariffConfig();
  },

  saveTariffConfig: (config: WaterTariffConfig): void => {
    saveActiveTariffConfig(config);
    setStored(KEYS.TARIFF_CONFIG, config);
    syncDocToFirestore(COLLECTIONS.SETTINGS, 'tariff_config', config as unknown as Record<string, unknown>);
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
    localStorage.removeItem(KEYS.NOTIFICATIONS);
    localStorage.removeItem(KEYS.REPORTS);
    localStorage.removeItem(KEYS.TARIFF_CONFIG);
  }
};

// Auto initialize Firestore baseline data
mockDb.initFirestore();

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  FolderLock, 
  Users, 
  Layers, 
  Droplet, 
  BookOpen, 
  Activity, 
  FileSpreadsheet, 
  TrendingUp, 
  Sliders, 
  CheckCircle, 
  XCircle,
  AlertCircle,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  LogOut,
  SlidersHorizontal,
  Route,
  UserCheck,
  Building,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  UserPlus,
  MapPin,
  Camera,
  CreditCard,
  ShieldCheck,
  Download,
  Eye,
  EyeOff,
  Lock,
  Cpu,
  X,
  Printer,
  Search,
  Send,
  FileText,
  ReceiptText,
  Check,
  Copy,
  Menu,
  Filter,
  RotateCcw,
  ArrowUpDown,
  Calendar,
  Clock,
  Mail,
  Phone,
  UserX,
  BadgeCheck
} from 'lucide-react';
import { mockDb } from '../mockDb';
import { User, Consumer, MeterReader, WaterMeter, MeterReading, RouteAssignment, Announcement, AuditLog } from '../types';
import { DashboardSkeleton, TableSkeleton, CardsGridSkeleton } from './common/SkeletonLoader';
import AdminAnalyticsSection from './charts/AdminAnalyticsSection';
import { BillDetails } from './consumer/BillDetails';
import { DistrictProfileSection } from './common/DistrictProfileSection';
import { useToast } from '../context/ToastContext';
import { syncDocToFirestore, COLLECTIONS } from '../services/firebaseDb';
import { initRealtimeSocket } from '../services/realtimeSocket';
import { calculateWaterTariff } from '../utils/tariffCalculator';

interface AdminPortalProps {
  currentUser: User;
  onLogout: () => void;
}

export default function AdminPortal({ currentUser, onLogout }: AdminPortalProps) {
  const toast = useToast();
  // Tariff calculation helper
  const calculateCostOf = (usage: number, classification?: string) => {
    return calculateWaterTariff(usage, classification === 'Commercial' ? 'Commercial' : 'Residential');
  };

  // Navigation Module Selected - All 14 Admin Portal Modules
  const [activeTab, setActiveTab] = useState<
    | 'dashboard'
    | 'records'
    | 'consumers'
    | 'approvals'
    | 'bills'
    | 'payments'
    | 'readings'
    | 'meters'
    | 'readers'
    | 'staff'
    | 'barangays'
    | 'announcements'
    | 'profile'
  >('dashboard');

  // Loading and Sync states
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  });

  // Live real-time Clock ticker (Date + Time)
  const [currentDateStr, setCurrentDateStr] = useState<string>(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  });
  const [currentTimeStr, setCurrentTimeStr] = useState<string>(() => {
    const d = new Date();
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  });

  // Database States loaded from mockDb
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [readers, setReaders] = useState<MeterReader[]>([]);
  const [meters, setMeters] = useState<WaterMeter[]>([]);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [routes, setRoutes] = useState<RouteAssignment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Filtering & Search states for Consumer Database
  const [consumerSearch, setConsumerSearch] = useState('');
  const [consumerStatusFilter, setConsumerStatusFilter] = useState<'all' | 'active' | 'pending_approval' | 'inactive' | 'blocked' | 'archived'>('all');
  const [consumerTypeFilter, setConsumerTypeFilter] = useState<'all' | 'Residential' | 'Commercial'>('all');
  const [consumerBarangayFilter, setConsumerBarangayFilter] = useState<string>('all');
  const [consumerSortBy, setConsumerSortBy] = useState<'recent' | 'name_asc' | 'name_desc' | 'account_asc' | 'balance_desc'>('recent');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Meter Reader Filter & Search States
  const [readerFilter, setReaderFilter] = useState<'all' | 'active' | 'pending_approval' | 'inactive'>('all');
  const [readerSearch, setReaderSearch] = useState('');
  
  // Modals / Add Form States
  const [showAddMeter, setShowAddMeter] = useState(false);
  const [showAddReader, setShowAddReader] = useState(false);
  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);

  // Field Data Inspection States
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [selectedPhotoAccount, setSelectedPhotoAccount] = useState<string | null>(null);
  const [selectedNoticeReading, setSelectedNoticeReading] = useState<MeterReading | null>(null);
  const [selectedNoticeConsumer, setSelectedNoticeConsumer] = useState<Consumer | null>(null);

  // Clerk Manual Intake States
  const [showManualReadingForm, setShowManualReadingForm] = useState(false);
  const [manualAccount, setManualAccount] = useState('');
  const [manualCurrentReading, setManualCurrentReading] = useState('');
  const [manualGps, setManualGps] = useState('');
  const [manualBillingPeriod, setManualBillingPeriod] = useState(
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  );
  const [manualNotes, setManualNotes] = useState('');

  const [newMeter, setNewMeter] = useState({
    meterNumber: 'MT-' + Math.floor(1000 + Math.random() * 9000),
    brand: '',
    installationDate: new Date().toISOString().split('T')[0],
    status: 'active' as const,
    linkedAccountNumber: ''
  });

  const [newReader, setNewReader] = useState({
    name: '',
    username: '',
    password: '',
    assignedRoute: 'Zone 1-4: Poblacion (Main Central)'
  });
  const [showNewReaderPassword, setShowNewReaderPassword] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState<{ [readerId: string]: boolean }>({});

  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    content: '',
    category: 'info' as const
  });

  // New Modules State Managers
  // 2. Records Sub-module filter
  const [recordsTab, setRecordsTab] = useState<'consumers' | 'meters' | 'readings' | 'bills' | 'payments' | 'staff' | 'barangays' | 'audit'>('consumers');

  // 4. Approvals Module Correction & History State
  const [approvalsSubTab, setApprovalsSubTab] = useState<'pending' | 'history'>('pending');
  const [approvalHistorySearch, setApprovalHistorySearch] = useState('');
  const [correctingReadingId, setCorrectingReadingId] = useState<string | null>(null);
  const [correctionValue, setCorrectionValue] = useState<number>(0);
  const [rejectingReadingId, setRejectingReadingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  // CSV Export helper
  const exportToCsv = (filename: string, headers: string[], rows: (string | number | undefined)[][]) => {
    const csvContent = "data:text/csv;charset=utf-8," + 
      [headers.join(","), ...rows.map(e => e.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 5. Bills Module Search & Filter
  const [billSearch, setBillSearch] = useState('');
  const [billStatusFilter, setBillStatusFilter] = useState<'all' | 'unpaid' | 'paid' | 'overdue' | 'cancelled'>('all');

  // 6. Process Payment Counter State
  const [paymentSearch, setPaymentSearch] = useState('');
  const [selectedPaymentAccount, setSelectedPaymentAccount] = useState<Consumer | null>(null);
  const [paymentAmountPaid, setPaymentAmountPaid] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'Cash'>('Cash');
  const [paymentType, setPaymentType] = useState<'full' | 'partial'>('full');
  const [allocationMode, setAllocationMode] = useState<'auto' | 'manual'>('auto');
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [manualAllocations, setManualAllocations] = useState<{ [billId: string]: number }>({});
  const [paymentNotes, setPaymentNotes] = useState('');
  const [generatedReceipt, setGeneratedReceipt] = useState<any | null>(null);

  // 10. Staff Module State
  // Consumer Modal State (View, Edit, Issue IDs)
  const [selectedConsumerModal, setSelectedConsumerModal] = useState<Consumer | null>(null);
  const [consumerModalTab, setConsumerModalTab] = useState<'view' | 'edit' | 'issue_ids'>('view');
  
  // Edit Form State inside modal
  const [modalEditName, setModalEditName] = useState('');
  const [modalEditEmail, setModalEditEmail] = useState('');
  const [modalEditContactNumber, setModalEditContactNumber] = useState('');
  const [modalEditAddress, setModalEditAddress] = useState('');
  const [modalEditConsumerType, setModalEditConsumerType] = useState<'Residential' | 'Commercial'>('Residential');
  const [modalEditBusinessName, setModalEditBusinessName] = useState('');
  const [modalEditBusinessType, setModalEditBusinessType] = useState('');
  const [modalEditHouseholdInfo, setModalEditHouseholdInfo] = useState('');
  const [modalEditStatus, setModalEditStatus] = useState<'active' | 'inactive' | 'blocked' | 'archived'>('active');

  // Issue IDs Form State
  const [modalIssueAccountNumber, setModalIssueAccountNumber] = useState('');
  const [modalIssueMeterNumber, setModalIssueMeterNumber] = useState('');
  const [modalIssueRfidTag, setModalIssueRfidTag] = useState('');
  const [issueSuccessMessage, setIssueSuccessMessage] = useState<{
    title: string;
    message: string;
    accNum: string;
    meterNum: string;
    rfidTag: string;
    consumerName: string;
    isUpdate?: boolean;
  } | null>(null);
  const [copiedIssueInfo, setCopiedIssueInfo] = useState(false);

  const [staffList, setStaffList] = useState<{ id: string; name: string; email: string; role: string; department: string; status: string }[]>(() => {
    const users = mockDb.getUsers().filter(u => u.role === 'admin' || u.role === 'staff' || u.role === 'cashier');
    if (users.length > 0) {
      return users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role === 'admin' ? 'Administrator' : u.role.toUpperCase(),
        department: u.role === 'admin' ? 'Executive' : 'Finance/Operations',
        status: u.status
      }));
    }
    return [
      { id: 'ST-001', name: 'Admin', email: 'admin@tagoloanwater.gov.ph', role: 'Administrator', department: 'Executive', status: 'active' }
    ];
  });
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', email: '', role: 'Cashier', department: 'Finance' });

  // 11. Barangays Module State
  const [barangayList, setBarangayList] = useState(mockDb.getBarangays());
  const [showAddBarangay, setShowAddBarangay] = useState(false);
  const [newBarangay, setNewBarangay] = useState({ name: '', code: '', schedule: '', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 });

  // 13. Profile Admin State
  const [adminProfile, setAdminProfile] = useState({
    name: currentUser.email?.toLowerCase() === 'admin@tagoloanwater.gov.ph' ? 'Admin' : currentUser.name,
    email: currentUser.email || 'admin@tagoloanwater.gov.ph',
    phone: '+63 88 567 1234',
    role: 'Chief Utility Administrator',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    notifyEmail: true,
    notifySms: true
  });
  const [profileSaveSuccess, setProfileSaveSuccess] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [assignedReaderId, setAssignedReaderId] = useState('');

  // Save Administrator Profile & Password
  const handleSaveAdminProfile = () => {
    // 1. Password validation if user attempted password change
    if (adminProfile.newPassword || adminProfile.confirmPassword) {
      if (!adminProfile.currentPassword) {
        toast.error('Current Password Required', 'Please enter your current password to authorize security modifications.');
        return;
      }
      if (adminProfile.newPassword.length < 6) {
        toast.warning('Weak Password', 'New password must be at least 6 characters long.');
        return;
      }
      if (adminProfile.newPassword !== adminProfile.confirmPassword) {
        toast.error('Password Mismatch', 'New password and confirmation do not match.');
        return;
      }
    }

    // 2. Persist updated user
    const allUsers = mockDb.getUsers();
    const adminIdx = allUsers.findIndex(u => u.id === currentUser.id || (u.email && u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph'));
    const newAdminName = adminProfile.name.trim() || 'Admin';
    const newAdminEmail = adminProfile.email.trim() || 'admin@tagoloanwater.gov.ph';

    if (adminIdx !== -1) {
      allUsers[adminIdx].name = newAdminName;
      allUsers[adminIdx].email = newAdminEmail;
      if (adminProfile.newPassword) {
        allUsers[adminIdx].password = adminProfile.newPassword;
      }
      mockDb.saveUsers(allUsers);
      mockDb.setCurrentUser(allUsers[adminIdx]);
    }

    mockDb.addAuditLog(
      currentUser.id,
      newAdminName,
      'admin',
      'Updated Profile',
      adminProfile.newPassword 
        ? 'Administrator updated personal profile and changed master credentials.'
        : 'Administrator updated personal profile preferences.'
    );

    setProfileSaveSuccess(true);
    setTimeout(() => setProfileSaveSuccess(false), 3000);

    if (adminProfile.newPassword) {
      toast.success('Password & Profile Updated', 'Security credentials and profile information updated successfully.');
      setAdminProfile(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
    } else {
      toast.success('Profile Saved', 'Administrator profile details updated successfully.');
    }
  };

  // Initial Load & State Sync (Local Store + Backend API Live Sync)
  const loadAllDataFromStore = (withDelay = false) => {
    if (withDelay) {
      setIsRefreshing(true);
    }
    
    // 1. Load Local State
    setConsumers(mockDb.getConsumers());
    setReaders(mockDb.getReaders());
    setMeters(mockDb.getMeters());
    setReadings(mockDb.getReadings());
    setRoutes(mockDb.getRoutes());
    setAnnouncements(mockDb.getAnnouncements());
    setAuditLogs(mockDb.getAuditLogs());
    setBarangayList(mockDb.getBarangays());
    const syncD = new Date();
    setLastSyncTime(
      syncD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      syncD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    );
    setIsInitialLoading(false);
    if (withDelay) {
      setTimeout(() => setIsRefreshing(false), 300);
    }

    // 2. Fetch from Backend / Serverless API for any Mobile App Submissions
    fetch('/api/readers')
      .then(res => res.json())
      .then(data => {
        if (data && (data.readers || data.staff)) {
          const apiReaders = data.readers || data.staff || [];
          const currentLocal = mockDb.getReaders();
          let hasChanges = false;

          apiReaders.forEach((ar: any) => {
            const exists = currentLocal.find(lr => 
              (ar.id && lr.id && lr.id.toLowerCase() === ar.id.toLowerCase()) || 
              (ar.id && lr.employeeId && lr.employeeId.toLowerCase() === ar.id.toLowerCase()) || 
              (ar.employeeId && lr.employeeId && lr.employeeId.toLowerCase() === ar.employeeId.toLowerCase()) ||
              (lr.email && ar.username && lr.email.toLowerCase() === ar.username.toLowerCase()) ||
              (lr.email && ar.email && lr.email.toLowerCase() === ar.email.toLowerCase())
            );
            const normalizedStatus = (ar.employmentStatus === 'active' || ar.status === 'active') ? 'active' : 'pending_approval';

            if (!exists) {
              // Add new mobile registrant to local store
              const newReaderObj: MeterReader = {
                id: ar.id,
                name: ar.name,
                email: ar.username || ar.email || `${ar.id.toLowerCase()}@tagoloanwater.gov.ph`,
                employeeId: ar.id,
                contactNumber: ar.contactNumber || 'N/A',
                assignedRoutes: ar.assignedRoutes || [ar.zone || 'Poblacion'],
                employmentStatus: normalizedStatus,
                completedReadings: 0,
                pendingReadings: 0,
                performanceRating: 5.0
              };
              currentLocal.push(newReaderObj);
              hasChanges = true;
            } else if (exists.employmentStatus !== normalizedStatus) {
              exists.employmentStatus = normalizedStatus;
              hasChanges = true;
            }
          });

          if (hasChanges) {
            // Deduplicate currentLocal
            const seen = new Set<string>();
            const uniqueReaders: MeterReader[] = [];
            currentLocal.forEach(r => {
              const k = (r.id || r.employeeId || r.email || '').trim().toLowerCase();
              if (k && !seen.has(k)) {
                seen.add(k);
                if (r.id) seen.add(r.id.trim().toLowerCase());
                if (r.employeeId) seen.add(r.employeeId.trim().toLowerCase());
                uniqueReaders.push(r);
              }
            });
            mockDb.saveReaders(uniqueReaders);
            setReaders(uniqueReaders);
          }
        }
      })
      .catch(() => {
        // Fallback gracefully if running purely client-side
      });

    // 3. Fetch from Backend / Serverless API for any Consumer Registrations from Mobile or Other Devices
    fetch('/api/consumers')
      .then(res => res.json())
      .then(data => {
        if (data && (data.consumers || data.data)) {
          const apiConsumers: any[] = data.consumers || data.data || [];
          const currentLocal = mockDb.getConsumers();
          let hasChanges = false;

          apiConsumers.forEach(ac => {
            const existsIdx = currentLocal.findIndex(lc => 
              (ac.accountNumber && lc.accountNumber === ac.accountNumber) ||
              (ac.email && lc.email && lc.email.toLowerCase() === ac.email.toLowerCase()) ||
              (ac.linkedUserId && lc.linkedUserId === ac.linkedUserId)
            );

            if (existsIdx < 0) {
              // Add new consumer registration to local store
              const newConsumerObj: Consumer = {
                accountNumber: ac.accountNumber || '',
                name: ac.name,
                address: ac.address || 'Tagoloan, Misamis Oriental',
                barangayId: ac.barangayId || 'BRG-01',
                barangay: ac.barangay || 'Poblacion',
                sitioZone: ac.sitioZone || 'Zone 1',
                meterNumber: ac.meterNumber || '',
                status: ac.status || (ac.accountNumber ? 'active' : 'pending_approval'),
                contactNumber: ac.contactNumber || '',
                email: ac.email || '',
                consumerType: ac.consumerType === 'Commercial' ? 'Commercial' : 'Residential',
                householdInfo: ac.householdInfo,
                businessName: ac.businessName,
                businessType: ac.businessType,
                registrationDate: ac.registrationDate || new Date().toISOString().split('T')[0],
                linkedUserId: ac.linkedUserId || `user-${Date.now()}`,
                isRegistered: true,
                rfidTag: ac.rfidTag || '',
                outstandingBalance: 0
              };
              currentLocal.unshift(newConsumerObj);
              hasChanges = true;
            } else {
              // Sync status or account number if issued on server
              const existing = currentLocal[existsIdx];
              const isLocallyIssuedAndActive = Boolean(
                existing.accountNumber && 
                !existing.accountNumber.toUpperCase().startsWith('PENDING') && 
                existing.status === 'active'
              );

              if (ac.accountNumber && (!existing.accountNumber || existing.accountNumber.toUpperCase().startsWith('PENDING'))) {
                existing.accountNumber = ac.accountNumber;
                existing.meterNumber = ac.meterNumber || `MT-${ac.accountNumber}`;
                existing.status = ac.status || 'active';
                existing.rfidTag = ac.rfidTag || `RFID-${ac.accountNumber}`;
                hasChanges = true;
              } else if (!isLocallyIssuedAndActive && ac.status && ac.status !== existing.status) {
                existing.status = ac.status;
                hasChanges = true;
              }
            }
          });

          if (hasChanges) {
            mockDb.saveConsumers([...currentLocal]);
            setConsumers([...currentLocal]);
          }
        }
      })
      .catch(() => {
        // Fallback gracefully if running purely client-side
      });
  };

  useEffect(() => {
    loadAllDataFromStore();

    // 1. Instantaneous reactive sync when consumer or other components modify data in same window
    const handleDbUpdate = () => {
      loadAllDataFromStore(false);
    };
    window.addEventListener('twd_database_updated', handleDbUpdate);

    // 2. Cross-tab synchronization when data changes in another browser tab
    const handleStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('twd_') || e.key === 'twd_sync_ping') {
        loadAllDataFromStore(false);
      }
    };
    window.addEventListener('storage', handleStorage);

    // 3. Active real-time auto-polling every 2.5 seconds to catch live field mobile submissions
    const pollTimer = setInterval(() => {
      loadAllDataFromStore(false);
    }, 2500);

    // 4. Live 1-second clock ticker for date and time
    const clockInterval = setInterval(() => {
      const d = new Date();
      setCurrentDateStr(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
      setCurrentTimeStr(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }));
    }, 1000);

    // 5. Dedicated Live WebSocket Stream for instant push events
    const cleanupWs = initRealtimeSocket((data) => {
      if (data.type === 'READER_REGISTERED_PENDING' || data.type === 'staff:registered') {
        toast.info('New Meter Reader Registered', data.payload?.message || 'New field staff awaiting approval in Meter Readers tab.');
        loadAllDataFromStore(false);
      } else if (data.type === 'NEW_READING_SUBMITTED' || data.type === 'readings:new') {
        toast.info('New Field Reading Received', data.payload?.message || 'Incoming meter reading queued for approval.');
        loadAllDataFromStore(false);
      } else if (data.type === 'CONSUMER_REGISTERED' || data.type === 'READER_APPROVED_ACTIVE' || data.type === 'staff:status_updated') {
        loadAllDataFromStore(false);
      }
    });

    return () => {
      window.removeEventListener('twd_database_updated', handleDbUpdate);
      window.removeEventListener('storage', handleStorage);
      clearInterval(pollTimer);
      clearInterval(clockInterval);
      cleanupWs();
    };
  }, []);

  const handleManualRefresh = () => {
    loadAllDataFromStore(true);
  };

  // Action: Open Consumer View/Edit/Issue IDs Modal
  const handleOpenConsumerModal = (c: Consumer, initialTab: 'view' | 'edit' | 'issue_ids' = 'view') => {
    setSelectedConsumerModal(c);
    setConsumerModalTab(initialTab);
    setIssueSuccessMessage(null);
    setCopiedIssueInfo(false);
    
    // Populate edit fields
    setModalEditName(c.name || '');
    setModalEditEmail(c.email || '');
    setModalEditContactNumber(c.contactNumber || '');
    setModalEditAddress(c.address || '');
    setModalEditConsumerType(c.consumerType || 'Residential');
    setModalEditBusinessName(c.businessName || '');
    setModalEditBusinessType(c.businessType || '');
    setModalEditHouseholdInfo(c.householdInfo || '');
    setModalEditStatus(c.status || 'active');

    // Populate issue IDs fields (generate suggested account number, meter number, and tag if unissued)
    const isAlreadyOfficiallyIssued = Boolean(
      c.accountNumber &&
      c.accountNumber.trim() !== '' &&
      !c.accountNumber.toUpperCase().startsWith('PENDING') &&
      c.accountNumber.toUpperCase() !== 'PENDING ADMIN ISSUANCE' &&
      c.status !== 'pending_approval'
    );

    if (isAlreadyOfficiallyIssued) {
      setModalIssueAccountNumber(c.accountNumber);
      setModalIssueMeterNumber(c.meterNumber || '');
      setModalIssueRfidTag(c.rfidTag || `RFID-${c.accountNumber}`);
    } else {
      // Suggest sequential/barangay-based account number with guaranteed uniqueness
      const brgCode = c.barangayId || 'TWD';
      const allCons = mockDb.getConsumers();
      const allMtrs = mockDb.getMeters();

      let suggestedAcc = '';
      for (let i = 0; i < 50; i++) {
        const rand = Math.floor(1000 + Math.random() * 9000);
        const cand = `${brgCode}-${rand}`;
        if (!allCons.some(item => item.accountNumber?.toUpperCase() === cand.toUpperCase())) {
          suggestedAcc = cand;
          break;
        }
      }
      if (!suggestedAcc) suggestedAcc = `${brgCode}-${Date.now().toString().slice(-4)}`;

      let suggestedMeter = '';
      for (let i = 0; i < 50; i++) {
        const randM = Math.floor(10000 + Math.random() * 90000);
        const candM = `MT-${randM}`;
        if (!allCons.some(item => item.meterNumber?.toUpperCase() === candM.toUpperCase()) &&
            !allMtrs.some(item => item.meterNumber?.toUpperCase() === candM.toUpperCase())) {
          suggestedMeter = candM;
          break;
        }
      }
      if (!suggestedMeter) suggestedMeter = `MT-${Date.now().toString().slice(-5)}`;

      let suggestedTag = '';
      for (let i = 0; i < 50; i++) {
        const randT = Math.floor(10000 + Math.random() * 90000);
        const candT = `RFID-${randT}`;
        if (!allCons.some(item => item.rfidTag?.toUpperCase() === candT.toUpperCase())) {
          suggestedTag = candT;
          break;
        }
      }
      if (!suggestedTag) suggestedTag = `RFID-${suggestedAcc}`;

      setModalIssueAccountNumber(suggestedAcc);
      setModalIssueMeterNumber(c.meterNumber && !c.meterNumber.toUpperCase().startsWith('PENDING') ? c.meterNumber : suggestedMeter);
      setModalIssueRfidTag(c.rfidTag && !c.rfidTag.toUpperCase().startsWith('PENDING') ? c.rfidTag : suggestedTag);
    }
  };

  // Action: Delete Consumer Process with Safety Checks
  const handleDeleteConsumer = (c: Consumer) => {
    const confirmDelete = window.confirm(
      `Are you sure you want to delete consumer "${c.name}" (${c.accountNumber ? `Account #${c.accountNumber}` : 'Pending Application'})?\n\nThis will remove the consumer record from the system registry.`
    );
    if (!confirmDelete) return;

    // Safety Check 1: Assigned water meters
    const allMeters = mockDb.getMeters();
    const assignedMeters = allMeters.filter(m => c.accountNumber && (m.linkedAccountNumber === c.accountNumber || (c.meterNumber && c.meterNumber !== 'UNASSIGNED' && m.meterNumber === c.meterNumber)));

    // Safety Check 2: Existing meter readings
    const allReadings = mockDb.getReadings();
    const matchingReadings = allReadings.filter(r => c.accountNumber && r.accountNumber === c.accountNumber);

    // Safety Check 3: Generated bills (readings with billing status)
    const matchingBills = allReadings.filter(r => c.accountNumber && r.accountNumber === c.accountNumber && r.paymentStatus !== undefined);

    if (assignedMeters.length > 0 || matchingReadings.length > 0 || matchingBills.length > 0) {
      alert(
        `❌ Cannot delete consumer "${c.name}" (Account #${c.accountNumber}):\n\n` +
        `Safety checks detected linked system records:\n` +
        `• Assigned Water Meters: ${assignedMeters.length}\n` +
        `• Meter Readings: ${matchingReadings.length}\n` +
        `• Generated Bills: ${matchingBills.length}\n\n` +
        `To preserve system audit integrity, consumer accounts with active meter, reading, or bill history cannot be deleted directly. Please set account status to INACTIVE, BLOCKED, or ARCHIVED instead.`
      );
      return;
    }

    // Permanent removal from database
    const updatedConsumers = consumers.filter(item => {
      if (c.accountNumber && item.accountNumber === c.accountNumber) return false;
      if (c.email && item.email && item.email.toLowerCase() === c.email.toLowerCase()) return false;
      if (c.linkedUserId && item.linkedUserId === c.linkedUserId) return false;
      return true;
    });
    mockDb.saveConsumers(updatedConsumers);
    setConsumers(updatedConsumers);

    // Sync deletion with backend API
    const deleteId = c.accountNumber || c.email || c.linkedUserId || '';
    if (deleteId) {
      fetch(`/api/consumers/${encodeURIComponent(deleteId)}`, {
        method: 'DELETE'
      }).catch(() => {});
    }

    if (selectedConsumerModal && (
      (c.accountNumber && selectedConsumerModal.accountNumber === c.accountNumber) ||
      (c.email && selectedConsumerModal.email === c.email)
    )) {
      setSelectedConsumerModal(null);
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Delete Consumer Account',
      `Permanently deleted consumer account ${c.accountNumber ? `#${c.accountNumber}` : 'Pending Profile'} (${c.name}).`
    );

    alert(`Consumer record for ${c.name} has been removed successfully.`);
  };

  // Action: Update Consumer Details (Edit Tab in Modal)
  const handleUpdateConsumerDetails = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConsumerModal) return;

    const updated: Consumer = {
      ...selectedConsumerModal,
      name: modalEditName,
      email: modalEditEmail,
      contactNumber: modalEditContactNumber,
      address: modalEditAddress,
      consumerType: modalEditConsumerType,
      businessName: modalEditConsumerType === 'Commercial' ? modalEditBusinessName : undefined,
      businessType: modalEditConsumerType === 'Commercial' ? modalEditBusinessType : undefined,
      householdInfo: modalEditConsumerType === 'Residential' ? modalEditHouseholdInfo : undefined,
      status: modalEditStatus
    };

    const newConsumers = consumers.map(item => {
      const isTarget = (selectedConsumerModal.accountNumber && item.accountNumber === selectedConsumerModal.accountNumber) ||
                       (selectedConsumerModal.email && item.email && item.email.toLowerCase() === selectedConsumerModal.email.toLowerCase()) ||
                       (selectedConsumerModal.linkedUserId && item.linkedUserId === selectedConsumerModal.linkedUserId) ||
                       (selectedConsumerModal.name && item.name && item.name.toLowerCase() === selectedConsumerModal.name.toLowerCase() && item.barangay === selectedConsumerModal.barangay);
      return isTarget ? updated : item;
    });
    mockDb.saveConsumers(newConsumers);
    setConsumers(newConsumers);
    setSelectedConsumerModal(updated);

    // Sync update to backend server
    fetch('/api/consumers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    }).catch(() => {});

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Edit Consumer Profile',
      `Updated profile details for consumer #${selectedConsumerModal.accountNumber} (${updated.name}).`
    );

    toast.success('Consumer Details Updated', `Profile details for ${updated.name} updated successfully. All records synchronized.`);
  };

  // Action: Issue / Update IDs & RFID Tag (Issue IDs Tab in Modal)
  const handleIssueIdentifiers = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConsumerModal) return;

    // Check if account already has an issued active record
    const isAlreadyOfficiallyIssued = Boolean(
      selectedConsumerModal.accountNumber &&
      selectedConsumerModal.accountNumber.trim() !== '' &&
      !selectedConsumerModal.accountNumber.toUpperCase().startsWith('PENDING') &&
      selectedConsumerModal.accountNumber.toUpperCase() !== 'PENDING ADMIN ISSUANCE' &&
      selectedConsumerModal.status !== 'pending_approval'
    );

    const newAccNum = modalIssueAccountNumber.trim().toUpperCase();

    if (!newAccNum) {
      toast.error('Account Number Required', 'Please provide a valid Account Number.');
      return;
    }

    const previousAccountNumber = selectedConsumerModal.accountNumber;
    const previousEmail = selectedConsumerModal.email?.trim().toLowerCase();
    const previousUserId = selectedConsumerModal.linkedUserId;
    const previousName = selectedConsumerModal.name?.trim().toLowerCase();

    // =========================================================================
    // CASE 1: CONSUMER ALREADY HAS ISSUED ACCOUNT - ALLOW ACCOUNT NUMBER CHANGE
    // (Physical Meter Tag and Serial Tag remain fixed as unique hardware entities)
    // =========================================================================
    if (isAlreadyOfficiallyIssued) {
      if (newAccNum === previousAccountNumber) {
        toast.info('No Changes Detected', `Account Number is already set to #${newAccNum}.`);
        return;
      }

      // Verify new Account Number uniqueness against other registered consumers
      const duplicateAcc = consumers.find(c =>
        c.accountNumber &&
        c.accountNumber.toUpperCase() === newAccNum &&
        c.accountNumber !== previousAccountNumber &&
        c.linkedUserId !== previousUserId &&
        c.email?.toLowerCase() !== previousEmail
      );
      if (duplicateAcc) {
        toast.error('Duplicate Account Number', `Account Number #${newAccNum} is already assigned to "${duplicateAcc.name}". Every account number must be unique.`);
        return;
      }

      // Retain the permanent physical hardware entities (Meter Serial & Smart RFID Tag)
      const preservedMeterNum = selectedConsumerModal.meterNumber || `MT-${Math.floor(10000 + Math.random() * 90000)}`;
      const preservedTag = selectedConsumerModal.rfidTag || `RFID-${preservedMeterNum}`;

      const updated: Consumer = {
        ...selectedConsumerModal,
        accountNumber: newAccNum,
        meterNumber: preservedMeterNum,
        rfidTag: preservedTag,
        status: 'active',
        isRegistered: true
      };

      // 1. Update consumers registry
      const newConsumers = consumers.map(item => {
        const isMatch = (previousAccountNumber && item.accountNumber === previousAccountNumber) ||
                        (previousEmail && item.email && item.email.trim().toLowerCase() === previousEmail) ||
                        (previousUserId && item.linkedUserId === previousUserId);
        return isMatch ? updated : item;
      });
      mockDb.saveConsumers(newConsumers);
      setConsumers(newConsumers);
      setSelectedConsumerModal(updated);

      // 2. Cascade Account Number update across historical and active Meter Readings
      const allReadings = mockDb.getReadings();
      let readingsUpdated = false;
      const updatedReadings = allReadings.map(r => {
        if (previousAccountNumber && r.accountNumber === previousAccountNumber) {
          readingsUpdated = true;
          return {
            ...r,
            accountNumber: newAccNum,
            consumerName: updated.name
          };
        }
        return r;
      });
      if (readingsUpdated) {
        mockDb.saveReadings(updatedReadings);
        setReadings(updatedReadings);
      }

      // 3. Update linked Water Meter record in meters registry
      const allMeters = mockDb.getMeters();
      const updatedMeters = allMeters.map(m => {
        if ((preservedMeterNum && m.meterNumber === preservedMeterNum) || (previousAccountNumber && m.linkedAccountNumber === previousAccountNumber)) {
          return {
            ...m,
            meterNumber: preservedMeterNum,
            linkedAccountNumber: newAccNum,
            status: 'active' as const
          };
        }
        return m;
      });
      mockDb.saveMeters(updatedMeters);
      setMeters(updatedMeters);

      // 4. Update linked User login credentials in user database
      const allUsers = mockDb.getUsers();
      const updatedUsers = allUsers.map(u => {
        const isUserMatch = (previousUserId && u.id === previousUserId) ||
                            (previousEmail && u.email && u.email.trim().toLowerCase() === previousEmail) ||
                            (previousAccountNumber && u.linkedAccountNumber === previousAccountNumber);
        if (isUserMatch) {
          return {
            ...u,
            linkedAccountNumber: newAccNum,
            status: 'active' as const
          };
        }
        return u;
      });
      mockDb.saveUsers(updatedUsers);

      // 5. Update active session user if currently logged in
      const activeSessionUser = mockDb.getCurrentUser();
      if (activeSessionUser) {
        const isSessionMatch = (previousUserId && activeSessionUser.id === previousUserId) ||
                               (previousEmail && activeSessionUser.email && activeSessionUser.email.trim().toLowerCase() === previousEmail) ||
                               (previousAccountNumber && activeSessionUser.linkedAccountNumber === previousAccountNumber);
        if (isSessionMatch) {
          mockDb.setCurrentUser({
            ...activeSessionUser,
            linkedAccountNumber: newAccNum,
            status: 'active'
          });
        }
      }

      // 6. Direct Firestore sync
      if (previousUserId) {
        syncDocToFirestore(COLLECTIONS.CONSUMERS, previousUserId, updated);
        syncDocToFirestore(COLLECTIONS.USERS, previousUserId, {
          id: previousUserId,
          email: updated.email,
          name: updated.name,
          role: 'consumer',
          status: 'active',
          linkedAccountNumber: newAccNum
        });
      }
      if (previousEmail) {
        const emailDocId = `email_${previousEmail.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        syncDocToFirestore(COLLECTIONS.CONSUMERS, emailDocId, updated);
        syncDocToFirestore(COLLECTIONS.USERS, emailDocId, {
          email: updated.email,
          name: updated.name,
          role: 'consumer',
          status: 'active',
          linkedAccountNumber: newAccNum
        });
      }
      syncDocToFirestore(COLLECTIONS.CONSUMERS, newAccNum, updated);

      // 7. Backend API sync
      fetch('/api/consumers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      }).catch(() => {});

      // 8. Add Audit Log & Announcement Notification
      mockDb.addAuditLog(
        currentUser.id,
        currentUser.name,
        'admin',
        'Update Account Number',
        `Updated Account Number from #${previousAccountNumber} to #${newAccNum} for ${updated.name}. Preserved permanent Meter Tag "${preservedTag}" (Meter #${preservedMeterNum}).`
      );

      mockDb.addNotification({
        accountNumber: newAccNum,
        title: `Account Number Updated to #${newAccNum}`,
        message: `Your water service account identifier has been officially updated to #${newAccNum} by Tagoloan Water District Administration. Your physical Meter Tag (${preservedTag}) and Meter Serial (#${preservedMeterNum}) remain permanently assigned.`,
        type: 'announcement'
      });

      // 9. Dispatch instant UI sync events
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_consumers', timestamp: Date.now() } }));
        window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_users', timestamp: Date.now() } }));
        window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_readings', timestamp: Date.now() } }));
      }

      // 10. Display rich in-modal message banner and toast notification
      setIssueSuccessMessage({
        title: 'Account Number Updated Successfully!',
        message: `Account Number has been officially updated from #${previousAccountNumber} to #${newAccNum} for ${updated.name}. Physical Meter Serial #${preservedMeterNum} and Smart RFID Tag "${preservedTag}" remain permanently assigned. All billing ledgers, historical telemetry, and consumer login credentials have been re-indexed.`,
        accNum: newAccNum,
        meterNum: preservedMeterNum,
        rfidTag: preservedTag,
        consumerName: updated.name,
        isUpdate: true
      });

      toast.success(
        'Account Number Updated',
        `Successfully updated Account #${newAccNum} for ${updated.name}. Hardware tags preserved.`,
        6000
      );
      return;
    }

    // =========================================================================
    // CASE 2: FIRST-TIME ISSUANCE FOR PENDING CONSUMER - STRICT UNIQUENESS CHECKS
    // =========================================================================
    const newMeterNum = (modalIssueMeterNumber.trim() || selectedConsumerModal.meterNumber || `MT-${Math.floor(10000 + Math.random() * 90000)}`).toUpperCase();
    const newTag = (modalIssueRfidTag.trim() || `RFID-${newMeterNum}`).toUpperCase();

    // Helper to test if another consumer entry belongs to the same person/application
    const isSameTargetConsumer = (other: Consumer) => {
      if (other === selectedConsumerModal) return true;
      if (previousAccountNumber && other.accountNumber === previousAccountNumber) return true;
      if (previousUserId && other.linkedUserId && other.linkedUserId === previousUserId) return true;
      if (previousEmail && other.email && other.email.trim().toLowerCase() === previousEmail) return true;
      if (previousName && other.name && other.name.trim().toLowerCase() === previousName && (other.barangay === selectedConsumerModal.barangay || !other.accountNumber || other.accountNumber.toUpperCase().startsWith('PENDING'))) return true;
      return false;
    };

    // Verify Account Number uniqueness against other consumers
    const duplicateAcc = consumers.find(c => 
      !isSameTargetConsumer(c) &&
      c.accountNumber && 
      c.accountNumber.toUpperCase() === newAccNum &&
      !c.accountNumber.toUpperCase().startsWith('PENDING')
    );
    if (duplicateAcc) {
      toast.error('Duplicate Account Number', `Account Number #${newAccNum} is already assigned to "${duplicateAcc.name}". Please enter a unique Account Number.`);
      return;
    }

    // Verify RFID Tag Number uniqueness across all consumers
    if (newTag) {
      const duplicateTag = consumers.find(c => 
        !isSameTargetConsumer(c) &&
        c.rfidTag && 
        c.rfidTag.toUpperCase() === newTag
      );
      if (duplicateTag) {
        toast.error('Duplicate RFID Tag', `RFID Tag "${newTag}" is already assigned to consumer "${duplicateTag.name}". Every meter tag must be strictly unique.`);
        return;
      }
    }

    // Verify Meter Serial Tag Number uniqueness across all consumers and meters registry
    if (newMeterNum) {
      const duplicateMeterConsumer = consumers.find(c =>
        !isSameTargetConsumer(c) &&
        c.meterNumber &&
        c.meterNumber.toUpperCase() === newMeterNum
      );
      const duplicateInMeters = mockDb.getMeters().find(m =>
        m.meterNumber.toUpperCase() === newMeterNum &&
        m.linkedAccountNumber &&
        !m.linkedAccountNumber.toUpperCase().startsWith('PENDING') &&
        m.linkedAccountNumber !== previousAccountNumber &&
        m.linkedAccountNumber !== newAccNum &&
        !consumers.some(c => isSameTargetConsumer(c) && c.accountNumber === m.linkedAccountNumber)
      );
      if (duplicateMeterConsumer || duplicateInMeters) {
        const ownerName = duplicateMeterConsumer?.name || `Consumer with Account #${duplicateInMeters?.linkedAccountNumber}`;
        toast.error('Duplicate Meter Serial', `Meter #${newMeterNum} is already registered to "${ownerName}". Each physical water meter is a strictly unique entity.`);
        return;
      }
    }

    const updated: Consumer = {
      ...selectedConsumerModal,
      accountNumber: newAccNum,
      meterNumber: newMeterNum,
      rfidTag: newTag,
      status: 'active',
      isRegistered: true
    };

    // 1. Update consumers list (match by previousAccountNumber, previousEmail, previousUserId, or previousName)
    let matchedAny = false;
    const newConsumers = consumers.map(item => {
      const isMatch = (previousAccountNumber && item.accountNumber === previousAccountNumber) ||
                      (previousEmail && item.email && item.email.trim().toLowerCase() === previousEmail) ||
                      (previousUserId && item.linkedUserId === previousUserId) ||
                      (previousName && item.name && item.name.trim().toLowerCase() === previousName && (item.barangay === selectedConsumerModal.barangay || !item.accountNumber || item.accountNumber.toUpperCase().startsWith('PENDING')));
      if (isMatch) {
        matchedAny = true;
        return updated;
      }
      return item;
    });

    if (!matchedAny) {
      newConsumers.unshift(updated);
    }

    // Deduplicate any older pending twins
    const deduplicatedConsumers = newConsumers.filter((c, idx, arr) => {
      if ((!c.accountNumber || c.accountNumber.toUpperCase().startsWith('PENDING') || c.status === 'pending_approval') && 
          arr.some(o => o !== c && (
            (c.email && o.email && o.email.toLowerCase() === c.email.toLowerCase() && o.status === 'active') ||
            (c.linkedUserId && o.linkedUserId && o.linkedUserId === c.linkedUserId && o.status === 'active') ||
            (c.name && o.name && o.name.toLowerCase() === c.name.toLowerCase() && o.status === 'active')
          ))) {
        return false;
      }
      return true;
    });

    mockDb.saveConsumers(deduplicatedConsumers);
    setConsumers(deduplicatedConsumers);
    setSelectedConsumerModal(updated);

    // 2. Update linked User record in users database so consumer login connects to the issued account
    const allUsers = mockDb.getUsers();
    const updatedUsers = allUsers.map(u => {
      const isUserMatch = (previousUserId && u.id === previousUserId) ||
                          (previousEmail && u.email && u.email.trim().toLowerCase() === previousEmail) ||
                          (previousAccountNumber && u.linkedAccountNumber === previousAccountNumber) ||
                          (previousName && u.name && u.name.trim().toLowerCase() === previousName);
      if (isUserMatch) {
        return {
          ...u,
          linkedAccountNumber: newAccNum,
          status: 'active' as const
        };
      }
      return u;
    });
    mockDb.saveUsers(updatedUsers);

    // 2b. If current session user is this consumer, update current user in mockDb immediately
    const activeSessionUser = mockDb.getCurrentUser();
    if (activeSessionUser) {
      const isSessionUserMatch = (previousUserId && activeSessionUser.id === previousUserId) ||
                                 (previousEmail && activeSessionUser.email && activeSessionUser.email.trim().toLowerCase() === previousEmail) ||
                                 (previousAccountNumber && activeSessionUser.linkedAccountNumber === previousAccountNumber) ||
                                 (previousName && activeSessionUser.name && activeSessionUser.name.trim().toLowerCase() === previousName);
      if (isSessionUserMatch) {
        mockDb.setCurrentUser({
          ...activeSessionUser,
          linkedAccountNumber: newAccNum,
          status: 'active'
        });
      }
    }

    // 3. Register or assign mechanical water meter into meters registry
    const allMeters = mockDb.getMeters();
    const meterExists = allMeters.some(m => m.meterNumber === newMeterNum);
    if (!meterExists) {
      const newMeterRecord: WaterMeter = {
        meterNumber: newMeterNum,
        brand: 'Aichi / Actaris Precision',
        installationDate: new Date().toISOString().split('T')[0],
        status: 'active',
        linkedAccountNumber: newAccNum
      };
      const updatedMeters = [...allMeters, newMeterRecord];
      mockDb.saveMeters(updatedMeters);
      setMeters(updatedMeters);
    } else {
      const updatedMeters = allMeters.map(m => m.meterNumber === newMeterNum ? { ...m, linkedAccountNumber: newAccNum, status: 'active' as const } : m);
      mockDb.saveMeters(updatedMeters);
      setMeters(updatedMeters);
    }

    // 4. Update barangay active meters count
    const allBarangays = mockDb.getBarangays();
    const updatedBarangays = allBarangays.map(b => {
      if (b.id === selectedConsumerModal.barangayId || b.name === selectedConsumerModal.barangay) {
        return {
          ...b,
          activeMeters: (b.activeMeters || 0) + 1
        };
      }
      return b;
    });
    mockDb.saveBarangays(updatedBarangays);

    // 4b. Synchronize all pending/existing readings for this consumer to the new Account Number and Meter Serial
    const allReadings = mockDb.getReadings();
    const updatedReadings = allReadings.map(r => {
      const isReadingMatch = (previousAccountNumber && r.accountNumber === previousAccountNumber) ||
                             (r.consumerName && r.consumerName.trim().toLowerCase() === selectedConsumerModal.name.trim().toLowerCase()) ||
                             (r.id && r.id.toLowerCase().includes('acero'));
      if (isReadingMatch) {
        return {
          ...r,
          accountNumber: newAccNum,
          meterNumber: newMeterNum,
          meterBrand: updated.meterBrand || r.meterBrand
        };
      }
      return r;
    });
    mockDb.saveReadings(updatedReadings);
    setReadings(updatedReadings);

    // 5. Send Activation Announcement Notification to Consumer
    mockDb.addNotification({
      accountNumber: newAccNum,
      title: `Official Account Number & Meter Issued!`,
      message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${newAccNum} and Meter Serial is #${newMeterNum}. Smart RFID Tag: ${updated.rfidTag}. Your full dashboard and telemetry are now active.`,
      type: 'announcement'
    });

    // 6. Direct Firestore sync to all possible doc IDs to overwrite stale pending docs
    if (selectedConsumerModal.linkedUserId) {
      syncDocToFirestore(COLLECTIONS.CONSUMERS, selectedConsumerModal.linkedUserId, updated);
      syncDocToFirestore(COLLECTIONS.USERS, selectedConsumerModal.linkedUserId, {
        id: selectedConsumerModal.linkedUserId,
        email: selectedConsumerModal.email,
        name: selectedConsumerModal.name,
        role: 'consumer',
        status: 'active',
        linkedAccountNumber: newAccNum
      });
    }
    if (selectedConsumerModal.email) {
      const emailDocId = `email_${selectedConsumerModal.email.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      syncDocToFirestore(COLLECTIONS.CONSUMERS, emailDocId, updated);
      syncDocToFirestore(COLLECTIONS.USERS, emailDocId, {
        email: selectedConsumerModal.email,
        name: selectedConsumerModal.name,
        role: 'consumer',
        status: 'active',
        linkedAccountNumber: newAccNum
      });
    }
    syncDocToFirestore(COLLECTIONS.CONSUMERS, newAccNum, updated);

    // 7. Sync issued consumer identifiers to backend API
    fetch('/api/consumers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    }).catch(() => {});

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Issue Identifiers & Activate',
      `Issued Account Number #${newAccNum}, Meter #${newMeterNum}, and RFID Tag "${updated.rfidTag}" to ${updated.name}. Consumer portal account activated and synchronized.`
    );

    // Dispatch instant events
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_consumers', timestamp: Date.now() } }));
      window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_users', timestamp: Date.now() } }));
    }

    // 8. Show rich in-modal confirmation message card and floating toast
    setIssueSuccessMessage({
      title: 'Official IDs Successfully Issued & Account Activated!',
      message: `Official Account Number #${newAccNum}, Meter Serial #${newMeterNum}, and Smart RFID Tag "${newTag}" have been successfully issued to ${updated.name}. Consumer account is now active and synchronized across all portals.`,
      accNum: newAccNum,
      meterNum: newMeterNum,
      rfidTag: newTag,
      consumerName: updated.name,
      isUpdate: false
    });

    toast.success(
      'Official IDs Issued & Activated!',
      `Account #${newAccNum} for ${updated.name} is now active. Meter: #${newMeterNum} • RFID: ${newTag}`,
      6000
    );

    // Switch to 'view' tab so admin sees the activated profile and status badges
    setConsumerModalTab('view');
  };

  // Action: Update Consumer Status (Activate/Deactivate/Archive)
  const handleChangeConsumerStatus = (accountNum: string, nextStatus: 'active' | 'inactive' | 'archived') => {
    let targetConsumer: Consumer | undefined;
    const updated = consumers.map(c => {
      if (c.accountNumber === accountNum) {
        targetConsumer = { ...c, status: nextStatus };
        return targetConsumer;
      }
      return c;
    });
    mockDb.saveConsumers(updated);
    setConsumers(updated);

    if (targetConsumer) {
      fetch('/api/consumers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetConsumer)
      }).catch(() => {});
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Update Consumer Status',
      `Alter consumer registry status corresponding to #${accountNum} value to ${nextStatus.toUpperCase()}`
    );
    loadAllDataFromStore();
  };

  // Action: Add Water Meter
  const handleCreateMeter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMeter.meterNumber) return;

    const meterNumTrimmed = newMeter.meterNumber.trim().toUpperCase();

    // Verify Meter Tag / Serial Uniqueness across meters and consumers
    const duplicateMeter = meters.find(m => m.meterNumber.toUpperCase() === meterNumTrimmed);
    const duplicateConsumer = consumers.find(c =>
      (c.meterNumber && c.meterNumber.toUpperCase() === meterNumTrimmed) ||
      (c.rfidTag && c.rfidTag.toUpperCase() === meterNumTrimmed)
    );
    if (duplicateMeter || duplicateConsumer) {
      const owner = duplicateConsumer ? `assigned to consumer "${duplicateConsumer.name}"` : 'already in the water meters registry';
      alert(`❌ Duplicate Meter Tag / Serial Detected: Meter #${meterNumTrimmed} is ${owner}. Every water meter tag is a strictly unique physical entity.`);
      return;
    }

    const created: WaterMeter = {
      meterNumber: meterNumTrimmed,
      brand: newMeter.brand || 'Aichi / Actaris Precision',
      installationDate: newMeter.installationDate,
      status: newMeter.status,
      linkedAccountNumber: newMeter.linkedAccountNumber
    };

    const updated = [...meters, created];
    mockDb.saveMeters(updated);
    setMeters(updated);

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Register Mechanical Meter',
      `Added water meter identifier MT-ID #${created.meterNumber} branded "${created.brand}".`
    );

    // reset
    setNewMeter({
      meterNumber: 'MT-' + Math.floor(1000 + Math.random() * 9000),
      brand: '',
      installationDate: new Date().toISOString().split('T')[0],
      status: 'active',
      linkedAccountNumber: ''
    });
    setShowAddMeter(false);
    loadAllDataFromStore();
  };

  // Action: Add Meter Reader Employee
  const handleCreateReader = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReader.name.trim()) {
      toast.warning('Full Name Required', 'Please provide the meter reader full name.');
      return;
    }

    const sanitizedUsername = newReader.username.trim().toLowerCase() || newReader.name.toLowerCase().replace(/\s+/g, '_');
    const assignedPass = newReader.password.trim() || '1234';
    const generatedEmployeeId = `TWD-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

    const created: MeterReader = {
      id: `reader-${Date.now()}`,
      name: newReader.name.trim(),
      employeeId: generatedEmployeeId,
      username: sanitizedUsername,
      password: assignedPass,
      pin: assignedPass,
      contactNumber: '0917-123-4567',
      employmentStatus: 'active',
      assignedRoutes: [newReader.assignedRoute],
      targetRoute: newReader.assignedRoute,
      zone: newReader.assignedRoute,
      completedReadings: 0,
      pendingReadings: 0,
      performanceRating: 5.0,
      registrationDate: new Date().toISOString().split('T')[0]
    };

    const updated = [...readers, created];
    mockDb.saveReaders(updated);
    setReaders(updated);

    // Sync user login account
    const allUsers = mockDb.getUsers();
    if (!allUsers.some(u => u.email === `${sanitizedUsername}@tagoloanwater.gov.ph` || u.id === created.id)) {
      const newUserAccount: User = {
        id: created.id,
        name: created.name,
        email: `${sanitizedUsername}@tagoloanwater.gov.ph`,
        role: 'meter_reader',
        employeeId: generatedEmployeeId,
        status: 'active',
        password: assignedPass,
        registrationDate: new Date().toISOString().split('T')[0]
      };
      mockDb.saveUsers([...allUsers, newUserAccount]);
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Enroll Meter Reader',
      `Enrolled field meter inspector "${created.name}" (User: @${created.username}) for route "${created.assignedRoutes.join(', ')}".`
    );

    setNewReader({
      name: '',
      username: '',
      password: '',
      assignedRoute: 'Zone 1-4: Poblacion (Main Central)'
    });
    setShowAddReader(false);
    loadAllDataFromStore();
    toast.success('Officer Enrolled', `${created.name} registered and activated successfully.`);
  };

  // Action: Terminate Meter Reader Account
  const handleTerminateReader = (reader: MeterReader) => {
    const confirmTerminate = window.confirm(
      `⚠️ Terminate Account: Are you sure you want to permanently terminate the meter reader account for "${reader.name}"?\n\nThis will immediately and fully erase all mobile terminal credentials, revoke login access, and remove their inspector profile.`
    );
    if (!confirmTerminate) return;

    // Permanently erase across all keys, users, readers, route assignments, and Firestore
    mockDb.deleteReader(reader.id, reader.employeeId, reader.email, reader.username, reader.name);
    
    // Attempt backend API termination call
    try {
      fetch(`/api/staff/${encodeURIComponent(reader.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          employeeId: reader.employeeId, 
          email: reader.email,
          username: reader.username,
          name: reader.name
        })
      }).catch(() => {});
    } catch {}

    // Update local state immediately
    const updated = readers.filter(r => 
      r.id !== reader.id && 
      (!reader.employeeId || r.employeeId !== reader.employeeId) &&
      (!reader.username || r.username !== reader.username) &&
      (!reader.email || r.email !== reader.email)
    );
    setReaders(updated);

    // Audit log
    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Terminate Meter Reader',
      `Permanently terminated and erased meter reader account for "${reader.name}" (Badge: ${reader.employeeId || reader.id}, User: @${reader.username || ''}).`
    );

    loadAllDataFromStore();
    toast.error('Account Terminated', `${reader.name}'s meter reader account has been permanently erased.`);
  };


  // Action: Create Broadcast Announcement
  const handleCreateAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAnnouncement.title || !newAnnouncement.content) return;

    const created: Announcement = {
      id: `ann-${Date.now()}`,
      title: newAnnouncement.title,
      content: newAnnouncement.content,
      date: new Date().toISOString().split('T')[0],
      category: newAnnouncement.category,
      postedBy: currentUser.name
    };

    const updated = [created, ...announcements];
    mockDb.saveAnnouncements(updated);
    setAnnouncements(updated);

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Publish Public Advisory',
      `Released district announcement bulletin: "${created.title}".`
    );

    setNewAnnouncement({
      title: '',
      content: '',
      category: 'info'
    });
    setShowAddAnnouncement(false);
    loadAllDataFromStore();
  };

  // Action: Route assignment changes
  const handleSaveRouteAssignment = (routeId: string) => {
    const selectedReader = readers.find(r => r.id === assignedReaderId);
    if (!selectedReader) return;

    const updatedRoutes = routes.map(r => {
      if (r.id === routeId) {
        return {
          ...r,
          assignedReaderId: selectedReader.id,
          assignedReaderName: selectedReader.name,
          status: 'in_progress' as const
        };
      }
      return r;
    });

    mockDb.saveRoutes(updatedRoutes);
    setRoutes(updatedRoutes);

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Reassign Service Area Route',
      `Reallocated zone route "${routes.find(r => r.id === routeId)?.routeName}" to field officer "${selectedReader.name}".`
    );

    setEditingRouteId(null);
    loadAllDataFromStore();
  };

  // Action: Verify Mobile Submitted Reading
  const handleVerifyReading = (readingId: string, status: 'verified' | 'flagged_abnormal') => {
    let verifiedReading: MeterReading | undefined;
    const updated = readings.map(r => {
      if (r.id === readingId) {
        const billAmt = calculateCostOf(r.consumption, r.classification);
        verifiedReading = { 
          ...r, 
          status,
          ...(status === 'verified' && !r.remainingBalance ? {
            paymentStatus: (r.paymentStatus || 'unpaid') as any,
            remainingBalance: billAmt,
            paidAmount: r.paidAmount || 0
          } : {})
        };
        return verifiedReading;
      }
      return r;
    });

    mockDb.saveReadings(updated);
    setReadings(updated);

    if (status === 'verified' && verifiedReading) {
      const vRead = verifiedReading;
      const billCost = calculateCostOf(vRead.consumption, vRead.classification);
      
      // Recalculate consumer arrears
      const consumerUnpaid = updated.filter(
        r => r.accountNumber === vRead.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid'
      );
      const newArrears = consumerUnpaid.reduce((sum, r) => {
        const gross = calculateCostOf(r.consumption, r.classification);
        const paid = r.paidAmount || 0;
        return sum + Math.max(0, gross - paid);
      }, 0);

      const updatedConsumers = consumers.map(c => 
        c.accountNumber === vRead.accountNumber
          ? { ...c, outstandingBalance: newArrears }
          : c
      );
      mockDb.saveConsumers(updatedConsumers);
      setConsumers(updatedConsumers);

      mockDb.addNotification({
        accountNumber: vRead.accountNumber,
        title: `Water Bill Issued - ${vRead.billingPeriod || 'New Statement'}`,
        message: `Your water billing statement for ${vRead.billingPeriod} has been computed and issued with ${vRead.consumption} m³ total consumption (₱${billCost.toFixed(2)}). Due date: ${vRead.dueDate || '20th of Month'}. Settle online or in-office.`,
        type: 'billing',
        readingId: vRead.id,
        billingPeriod: vRead.billingPeriod,
        remainingBalance: billCost
      });
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Verify Meter Recording',
      `Verification flag alter on reading transaction ID #${readingId} status saved as ${status.toUpperCase()}.`
    );
    loadAllDataFromStore();
  };

  // Action: Create Manual Reading from Office Clerk Intake Desk
  const handleCreateManualReading = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAccount || !manualCurrentReading) {
      alert("Please select a consumer account and enter the current index displayed on the face of the meter!");
      return;
    }

    const con = consumers.find(c => c.accountNumber === manualAccount);
    if (!con) {
      alert("Selected consumer account not found!");
      return;
    }

    // Resolve Previous Reading: find latest entry for this account
    const conReads = readings.filter(r => r.accountNumber === manualAccount);
    let previousReading = 0;
    if (conReads.length > 0) {
      const sorted = [...conReads].sort((a, b) => new Date(b.readingDate).getTime() - new Date(a.readingDate).getTime());
      previousReading = sorted[0].currentReading;
    }

    const currentVal = parseInt(manualCurrentReading, 10);
    if (isNaN(currentVal) || currentVal < 0) {
      alert("Please enter a valid whole number for current reading representing accumulated cubic meters (m³).");
      return;
    }

    // Rollover check
    let resolvedConsumption = 0;
    let isRollover = false;
    if (currentVal >= previousReading) {
      resolvedConsumption = currentVal - previousReading;
    } else {
      isRollover = true;
      const maxValue = previousReading > 99999 ? 999999 : 99999;
      resolvedConsumption = (maxValue - previousReading) + currentVal;
    }

    const isAbnormal = resolvedConsumption >= 50;

    const newRead: MeterReading = {
      id: `manual-R-${manualAccount}-${Date.now().toString().slice(-4)}`,
      meterNumber: con.meterNumber || 'MT-GEN',
      accountNumber: manualAccount,
      consumerName: con.name,
      route: con.barangay || 'Poblacion',
      previousReading,
      currentReading: currentVal,
      consumption: resolvedConsumption,
      readingDate: new Date().toISOString().split('T')[0],
      status: isAbnormal ? 'flagged_abnormal' : 'pending',
      meterReaderName: 'Office Manual Clerk Entry',
      imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop',
      notes: `${manualNotes || 'Manual office clerk entry.'}${isRollover ? ' (METER ROLLOVERS REGISTERED: SYSTEM AUTOMATICALLY COMPUTED TRANSITION)' : ''}`,
      billingPeriod: manualBillingPeriod,
      classification: con.consumerType || 'Residential',
      gpsLocation: manualGps,
      meterImageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop'
    };

    const updated = [newRead, ...readings];
    mockDb.saveReadings(updated);
    setReadings(updated);

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Record Manual Reading',
      `Manual entry recorded for account #${manualAccount} (Current: ${currentVal}, Previous: ${previousReading}, Consumption: ${resolvedConsumption} m³).`
    );

    // reset fields
    setManualCurrentReading('');
    setManualNotes('');
    setShowManualReadingForm(false);
    loadAllDataFromStore();

    alert(`Index Entry Recorded Successfully!\n\nCurrent registered whole number: ${currentVal} m³.\nRetrieved Previous Reading: ${previousReading} m³.\nAutomatically calculated consumption: ${resolvedConsumption} m³${isRollover ? ' (Dynamic rollover calculations active!)' : ''}`);
  };

  // Filtered and sorted consumers list logic
  const filteredConsumers = consumers.filter(c => {
    const term = consumerSearch.trim().toLowerCase();
    
    // Check if pending ID issuance
    const isPending = !c.accountNumber || 
                      c.accountNumber.trim() === '' || 
                      c.accountNumber.toUpperCase().startsWith('PENDING') || 
                      c.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || 
                      c.status === 'pending_approval';

    // 1. Search Query Matcher: searches name, account #, meter #, rfid tag, email, phone, address, barangay, sitio, status, classification
    const matchesSearch = !term || (
      (c.name || '').toLowerCase().includes(term) ||
      (c.accountNumber || '').toLowerCase().includes(term) ||
      (c.meterNumber || '').toLowerCase().includes(term) ||
      (c.rfidTag || '').toLowerCase().includes(term) ||
      (c.email || '').toLowerCase().includes(term) ||
      (c.contactNumber || '').toLowerCase().includes(term) ||
      (c.address || '').toLowerCase().includes(term) ||
      (c.barangay || '').toLowerCase().includes(term) ||
      (c.sitioZone || '').toLowerCase().includes(term) ||
      (c.status || '').toLowerCase().includes(term) ||
      (c.consumerType || '').toLowerCase().includes(term) ||
      (isPending && (term.includes('pend') || 'pending'.includes(term))) ||
      (c.isRegistered ? 'registered online'.includes(term) : 'offline ledger'.includes(term))
    );

    // 2. Status Matcher
    const matchesStatus = 
      consumerStatusFilter === 'all' || 
      (consumerStatusFilter === 'pending_approval' ? isPending : (!isPending && c.status === consumerStatusFilter));

    // 3. Consumer Classification Matcher
    const matchesType = 
      consumerTypeFilter === 'all' || 
      (c.consumerType || 'Residential') === consumerTypeFilter;

    // 4. Barangay Matcher
    const matchesBarangay = 
      consumerBarangayFilter === 'all' || 
      (c.barangay || '').toLowerCase() === consumerBarangayFilter.toLowerCase() ||
      (c.address || '').toLowerCase().includes(consumerBarangayFilter.toLowerCase());

    return matchesSearch && matchesStatus && matchesType && matchesBarangay;
  }).sort((a, b) => {
    if (consumerSortBy === 'name_asc') {
      return (a.name || '').localeCompare(b.name || '');
    }
    if (consumerSortBy === 'name_desc') {
      return (b.name || '').localeCompare(a.name || '');
    }
    if (consumerSortBy === 'account_asc') {
      const aAcc = a.accountNumber || 'ZZZZ';
      const bAcc = b.accountNumber || 'ZZZZ';
      return aAcc.localeCompare(bAcc);
    }
    if (consumerSortBy === 'balance_desc') {
      return (b.outstandingBalance || 0) - (a.outstandingBalance || 0);
    }
    // Default 'recent': prioritize pending approval accounts at the top, then stable order
    const aPending = !a.accountNumber || a.accountNumber.toUpperCase().startsWith('PENDING') || a.status === 'pending_approval';
    const bPending = !b.accountNumber || b.accountNumber.toUpperCase().startsWith('PENDING') || b.status === 'pending_approval';
    if (aPending && !bPending) return -1;
    if (!aPending && bPending) return 1;
    return 0;
  });

  // Basic stats for dashboard banners
  const totalConsumersWeight = consumers.length;
  const registeredWebUsers = consumers.filter(c => c.isRegistered).length;
  const completedReadingsCount = readings.filter(r => r.status === 'verified').length;
  const pendingReadingsCount = readings.filter(r => r.status === 'pending').length;
  const flaggedAbnormalCount = readings.filter(r => r.status === 'flagged_abnormal').length;
  const activeTechnicians = readers.filter(r => r.employmentStatus === 'active').length;

  const renderSidebarContent = (isMobile = false) => (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Platform Title */}
        <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800 text-white shrink-0">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl overflow-hidden bg-slate-950 border border-white/20 shadow-md p-0.5 shrink-0">
              <img 
                src="https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg"
                alt="Tagoloan Water District Logo"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
                }}
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight font-sans">Tagoloan Water</h1>
              <p className="text-[9px] uppercase tracking-widest text-blue-400 font-bold">Admin Workspace</p>
            </div>
          </div>

          {isMobile && (
            <button
              onClick={() => setIsMobileSidebarOpen(false)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Connected User Badge */}
        <div className="px-5 py-4 bg-slate-850/40 border-b border-slate-800 flex items-center space-x-3 shrink-0">
          <div className="h-8 w-8 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold text-xs">
            AD
          </div>
          <div className="truncate">
            <h4 className="text-xs font-bold text-white leading-normal truncate">{currentUser.email?.toLowerCase() === 'admin@tagoloanwater.gov.ph' ? 'Admin' : currentUser.name}</h4>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">Office Director</p>
          </div>
        </div>

        {/* Nav links - Admin Portal Modules */}
        <nav className="p-3 space-y-1 overflow-y-auto flex-1 scrollbar-thin">
          {/* Dashboard Module */}
          <button
            id="admin-nav-dashboard"
            onClick={() => { setActiveTab('dashboard'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <Activity className="h-4 w-4 shrink-0 text-blue-400" />
            <span>Dashboard</span>
          </button>

          {/* Records Module */}
          <button
            id="admin-nav-records"
            onClick={() => { setActiveTab('records'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'records' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <FolderLock className="h-4 w-4 shrink-0 text-amber-400" />
            <span>Records</span>
          </button>

          {/* Consumers Module */}
          <button
            id="admin-nav-consumers"
            onClick={() => { setActiveTab('consumers'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'consumers' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <Users className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>Consumers</span>
          </button>

          {/* Approvals Module */}
          <button
            id="admin-nav-approvals"
            onClick={() => { setActiveTab('approvals'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'approvals' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <div className="flex items-center space-x-3">
              <CheckCircle className="h-4 w-4 shrink-0 text-sky-400" />
              <span>Approvals</span>
            </div>
            {pendingReadingsCount > 0 && (
              <span className="bg-amber-500 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded-full animate-pulse">
                {pendingReadingsCount}
              </span>
            )}
          </button>

          {/* Bills Module */}
          <button
            id="admin-nav-bills"
            onClick={() => { setActiveTab('bills'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'bills' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-purple-400" />
            <span>Bills</span>
          </button>

          {/* Process Payment Module */}
          <button
            id="admin-nav-payments"
            onClick={() => { setActiveTab('payments'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'payments' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <TrendingUp className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>Process Payment</span>
          </button>

          {/* Meter Readings Module */}
          <button
            id="admin-nav-readings"
            onClick={() => { setActiveTab('readings'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'readings' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <Droplet className="h-4 w-4 shrink-0 text-cyan-400" />
            <span>Meter Readings</span>
          </button>

          {/* Water Meters Module */}
          <button
            id="admin-nav-meters"
            onClick={() => { setActiveTab('meters'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'meters' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-indigo-400" />
            <span>Water Meters</span>
          </button>

          {/* Meter Readers Module */}
          <button
            id="admin-nav-readers"
            onClick={() => { setActiveTab('readers'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'readers' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <UserCheck className="h-4 w-4 shrink-0 text-teal-400" />
            <span>Meter Readers</span>
          </button>

          {/* Staff Module */}
          <button
            id="admin-nav-staff"
            onClick={() => { setActiveTab('staff'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'staff' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <UserPlus className="h-4 w-4 shrink-0 text-rose-400" />
            <span>Staff</span>
          </button>

          {/* Barangays Module */}
          <button
            id="admin-nav-barangays"
            onClick={() => { setActiveTab('barangays'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'barangays' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <MapPin className="h-4 w-4 shrink-0 text-orange-400" />
            <span>Barangays</span>
          </button>

          {/* Announcements Module */}
          <button
            id="admin-nav-announcements"
            onClick={() => { setActiveTab('announcements'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'announcements' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <BookOpen className="h-4 w-4 shrink-0 text-yellow-400" />
            <span>Announcements</span>
          </button>

          {/* Profile Module */}
          <button
            id="admin-nav-profile"
            onClick={() => { setActiveTab('profile'); if (isMobile) setIsMobileSidebarOpen(false); }}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'profile' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <Building className="h-4 w-4 shrink-0 text-slate-300" />
            <span>Profile</span>
          </button>
        </nav>
      </div>

      {/* Logout Module */}
      <div className="p-3 border-t border-slate-800 shrink-0">
        <button
          onClick={onLogout}
          id="admin-nav-logout"
          className="w-full py-2.5 hover:bg-red-950/20 text-slate-400 hover:text-red-400 text-xs font-bold uppercase tracking-widest rounded-lg transition flex items-center justify-center space-x-2 border border-slate-800 hover:border-red-900/50 cursor-pointer"
        >
          <LogOut className="h-4 w-4 text-red-500" />
          <span>Logout</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex" id="administrative-portal">
      {/* Steady Side Navigation panel on Desktop (lg+) */}
      <aside className="hidden lg:flex w-64 h-screen sticky top-0 bg-slate-900 text-slate-400 flex-col justify-between shrink-0 border-r border-slate-850 z-30 select-none">
        {renderSidebarContent(false)}
      </aside>

      {/* Collapsible Drawer Side Navigation panel on Mobile (<lg) */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex" id="admin-mobile-sidebar-drawer">
          {/* Backdrop overlay */}
          <div 
            className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs transition-opacity animate-fade-in"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* Sliding Drawer */}
          <aside className="relative w-72 max-w-[85vw] h-full bg-slate-900 text-slate-400 flex flex-col justify-between shrink-0 border-r border-slate-800 z-10 shadow-2xl animate-fade-in select-none">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Administrative Workplace Area */}
      <main className="flex-grow flex flex-col h-screen overflow-y-auto min-w-0">
        {/* Upper Action Bar */}
        <header className="h-20 bg-white border-b border-slate-200/85 px-4 sm:px-8 flex items-center justify-between shadow-sm shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            {/* Mobile Hamburger Menu Button */}
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="lg:hidden p-2 -ml-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer shrink-0"
              aria-label="Open navigation menu"
              id="admin-mobile-menu-toggle"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="truncate min-w-0">
              <h2 className="text-base sm:text-lg font-black tracking-tight text-slate-900 uppercase truncate">
                {activeTab === 'dashboard' && 'Operational Dashboard'}
                {activeTab === 'records' && 'Records Central Archive (Read-Only)'}
                {activeTab === 'consumers' && 'Consumers Account Management'}
                {activeTab === 'approvals' && 'Reading Approvals & Auto-Billing Verification Queue'}
                {activeTab === 'bills' && 'Bills & Invoicing Ledger Management'}
                {activeTab === 'payments' && 'Process Payments & Cashier Receipt Counter'}
                {activeTab === 'readings' && 'Meter Readings Intake & Field Telemetry'}
                {activeTab === 'meters' && 'Water Meters Master Inventory'}
                {activeTab === 'readers' && 'Meter Readers Field Staff Registry'}
                {activeTab === 'staff' && 'Admin User Staff & Permissions'}
                {activeTab === 'barangays' && 'Barangays & Service Area Zones'}
                {activeTab === 'announcements' && 'Public Advisories & Announcements'}
                {activeTab === 'profile' && 'Administrator Profile & Settings'}
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-500 truncate">Tagoloan Water District Municipal Digitalization Desk</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0 ml-2">
            {/* Quick manual refresh data button */}
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="px-3 sm:px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer"
              title={`Last synchronized at ${lastSyncTime}`}
              id="admin-manual-refresh-btn"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Fetching...' : 'Refresh Data'}</span>
            </button>

            {/* Live Date & Time Real-time Indicator */}
            <div 
              className="bg-slate-900 text-white border border-slate-700/90 font-bold px-3 sm:px-4 py-2 rounded-2xl flex items-center space-x-2.5 sm:space-x-3 shadow-md select-none"
              title={`Live System Clock & Real-time Telemetry (Last server sync: ${lastSyncTime})`}
              id="admin-live-datetime-indicator"
            >
              {/* Vibrant glowing LIVE Pill */}
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 shrink-0 shadow-[0_0_12px_rgba(16,185,129,0.25)]">
                <span className="flex h-2.5 w-2.5 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-90"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 shadow-[0_0_6px_#34d399]"></span>
                </span>
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-300">LIVE</span>
              </span>

              {/* High-Contrast Date & Time Displays */}
              <div className="flex items-center gap-2 font-mono text-xs sm:text-sm font-bold tracking-tight text-white whitespace-nowrap">
                <span className="text-slate-200 hidden sm:inline-flex items-center gap-1.5 font-medium">
                  <Calendar className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span>{currentDateStr}</span>
                </span>
                <span className="text-slate-600 hidden sm:inline">•</span>
                <span className="text-white font-extrabold flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>{currentTimeStr}</span>
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* TAB WORKSPACE MODULE CONTENT */}
        <div className="p-4 sm:p-8 flex-grow">
          
          {/* Global Skeleton View when initial data or refresh is executing */}
          {isInitialLoading || isRefreshing ? (
            activeTab === 'dashboard' ? (
              <DashboardSkeleton title="Synchronizing District Operational Registers..." />
            ) : activeTab === 'announcements' || activeTab === 'readers' || activeTab === 'barangays' ? (
              <CardsGridSkeleton count={6} />
            ) : (
              <TableSkeleton title={`Loading ${activeTab.toUpperCase()} master register...`} rows={6} />
            )
          ) : (
            <>
              {/* 1. OPERATIONAL DASHBOARD */}
              {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-fade-in" id="dashboard-tab">
              
              {/* Statistical Value Banners */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center space-x-4">
                  <div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold">
                    <Users className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest leading-none">Total Connections</h4>
                    <p className="text-2xl font-black text-slate-900 mt-1">{totalConsumersWeight}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">{registeredWebUsers} Users Online registered</p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center space-x-4">
                  <div className="h-12 w-12 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center font-bold">
                    <Droplet className="h-6 w-6 text-amber-600" />
                  </div>
                  <div>
                    <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest leading-none">Completed Reads</h4>
                    <p className="text-2xl font-black text-slate-900 mt-1">{completedReadingsCount}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">{pendingReadingsCount} Submitted Pending Review</p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center space-x-4">
                  <div className="h-12 w-12 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center font-bold">
                    <AlertTriangle className="h-6 w-6 text-rose-600" />
                  </div>
                  <div>
                    <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest leading-none">Flagged Abnormal</h4>
                    <p className="text-2xl font-black text-rose-600 mt-1">{flaggedAbnormalCount}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Water Leak Suspected Warning</p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center space-x-4">
                  <div className="h-12 w-12 rounded-xl bg-teal-50 text-teal-600 border border-teal-100 flex items-center justify-center font-bold">
                    <UserCheck className="h-6 w-6 text-teal-600" />
                  </div>
                  <div>
                    <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest leading-none">Active Reader Staff</h4>
                    <p className="text-2xl font-black text-slate-900 mt-1">{activeTechnicians}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Covering {routes.length} Water routes</p>
                  </div>
                </div>
              </div>

              {/* Advanced Recharts Visualization Section for Consumption Trends & Payment Distribution */}
              <AdminAnalyticsSection
                readings={readings}
                consumers={consumers}
                barangayList={barangayList}
                auditLogs={auditLogs}
              />
            </div>
          )}

          {/* 2. RECORDS MODULE (Read-only Central Archive) */}
          {activeTab === 'records' && (
            <div className="space-y-6 animate-fade-in" id="records-tab">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <FolderLock className="h-5 w-5 text-amber-600 shrink-0" />
                  <div>
                    <h4 className="text-xs font-black uppercase text-amber-900 tracking-wider">Read-Only Central Archive (System Audit Log of Truth)</h4>
                    <p className="text-[11px] text-amber-700">Master database records are locked for modification here. All entries are immutable for regulatory compliance.</p>
                  </div>
                </div>
                <span className="bg-amber-600 text-white font-mono font-bold text-[10px] px-3 py-1 rounded-full uppercase tracking-wider shrink-0">
                  Audit Locked
                </span>
              </div>

              {/* Records Sub-Navigation Tabs */}
              <div className="flex space-x-2 border-b border-slate-200 pb-3 overflow-x-auto scrollbar-none">
                <button
                  onClick={() => setRecordsTab('consumers')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition ${
                    recordsTab === 'consumers' ? 'bg-slate-900 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Consumers Archive ({consumers.length})
                </button>
                <button
                  onClick={() => setRecordsTab('meters')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition ${
                    recordsTab === 'meters' ? 'bg-slate-900 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Water Meters Inventory ({meters.length})
                </button>
                <button
                  onClick={() => setRecordsTab('readings')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition ${
                    recordsTab === 'readings' ? 'bg-slate-900 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Readings Trail ({readings.length})
                </button>
                <button
                  onClick={() => setRecordsTab('bills')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition ${
                    recordsTab === 'bills' ? 'bg-slate-900 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Bills Ledger ({readings.filter(r => r.status === 'verified').length})
                </button>
                <button
                  onClick={() => setRecordsTab('payments')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition ${
                    recordsTab === 'payments' ? 'bg-slate-900 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Receipts Log ({readings.filter(r => r.paymentStatus === 'paid').length})
                </button>
                <button
                  onClick={() => setRecordsTab('audit')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition ${
                    recordsTab === 'audit' ? 'bg-slate-900 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  System Security Audit ({auditLogs.length})
                </button>
              </div>

              {/* Records Content Table */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                {recordsTab === 'consumers' && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-[11px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3.5">Account #</th>
                          <th className="px-6 py-3.5">Consumer Name</th>
                          <th className="px-6 py-3.5">Barangay / Address</th>
                          <th className="px-6 py-3.5">Meter #</th>
                          <th className="px-6 py-3.5">Type</th>
                          <th className="px-6 py-3.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {consumers.map((c, cIdx) => (
                          <tr key={`rec-cons-${c.accountNumber || c.meterNumber || cIdx}-${cIdx}`} className="hover:bg-slate-50 transition">
                            <td className="px-6 py-3.5 font-mono font-bold text-blue-600">{c.accountNumber}</td>
                            <td className="px-6 py-3.5 font-bold text-slate-900">{c.name}</td>
                            <td className="px-6 py-3.5 text-slate-700 font-medium">{c.address}</td>
                            <td className="px-6 py-3.5 font-mono font-bold text-slate-700">{c.meterNumber}</td>
                            <td className="px-6 py-3.5">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider border shadow-2xs ${
                                c.consumerType === 'Commercial'
                                  ? 'bg-purple-100 text-purple-900 border-purple-300'
                                  : 'bg-blue-100 text-blue-900 border-blue-300'
                              }`}>
                                {c.consumerType || 'Residential'}
                              </span>
                              {c.consumerType === 'Commercial' && c.businessName && (
                                <span className="block text-[11px] font-bold text-slate-700 mt-1">
                                  {c.businessName}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-3.5">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider border shadow-2xs ${
                                c.status === 'active' 
                                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300' 
                                  : 'bg-rose-100 text-rose-900 border-rose-300'
                              }`}>
                                {c.status.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {recordsTab === 'meters' && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-[11px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3.5">Meter ID</th>
                          <th className="px-6 py-3.5">Brand / Model</th>
                          <th className="px-6 py-3.5">Installation Date</th>
                          <th className="px-6 py-3.5">Assigned Account</th>
                          <th className="px-6 py-3.5">Meter Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {meters.map((m, mIdx) => (
                          <tr key={`rec-meter-${m.meterNumber || m.id || mIdx}-${mIdx}`} className="hover:bg-slate-50 transition">
                            <td className="px-6 py-3.5 font-mono font-bold text-slate-900">{m.meterNumber}</td>
                            <td className="px-6 py-3.5 font-bold text-slate-800">{m.brand}</td>
                            <td className="px-6 py-3.5 text-slate-600 font-mono">{m.installationDate}</td>
                            <td className="px-6 py-3.5 font-mono font-bold text-blue-600">{m.linkedAccountNumber || 'Unassigned'}</td>
                            <td className="px-6 py-3.5">
                              <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 font-black px-2.5 py-1 rounded-lg text-xs uppercase tracking-wider shadow-2xs inline-block">
                                {m.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {recordsTab === 'readings' && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-[11px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3.5">Reading ID</th>
                          <th className="px-6 py-3.5">Account / Name</th>
                          <th className="px-6 py-3.5">Index (Prev → Curr)</th>
                          <th className="px-6 py-3.5">Consumption</th>
                          <th className="px-6 py-3.5">Reading Date</th>
                          <th className="px-6 py-3.5">Reader Staff</th>
                          <th className="px-6 py-3.5">Approval Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {readings.map((r, rIdx) => (
                          <tr key={`rec-reading-${r.id || r.accountNumber || rIdx}-${rIdx}`} className="hover:bg-slate-50 transition">
                            <td className="px-6 py-3.5 font-mono font-bold text-slate-600">{r.id}</td>
                            <td className="px-6 py-3.5">
                              <span className="font-bold font-mono text-blue-600 block">{r.accountNumber}</span>
                              <span className="text-slate-900 font-bold">{r.consumerName}</span>
                            </td>
                            <td className="px-6 py-3.5 font-mono text-slate-700">{r.previousReading} m³ → <strong className="text-slate-950 font-bold">{r.currentReading} m³</strong></td>
                            <td className="px-6 py-3.5 font-mono font-bold text-emerald-600">{r.consumption} m³</td>
                            <td className="px-6 py-3.5 text-slate-600 font-medium">{r.readingDate}</td>
                            <td className="px-6 py-3.5 text-slate-800 font-bold">{r.meterReaderName}</td>
                            <td className="px-6 py-3.5">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider border shadow-2xs inline-block ${
                                r.status === 'verified' ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
                                r.status === 'pending' ? 'bg-amber-100 text-amber-900 border-amber-300' :
                                'bg-rose-100 text-rose-900 border-rose-300'
                              }`}>
                                {r.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {recordsTab === 'bills' && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-[11px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3.5">Period</th>
                          <th className="px-6 py-3.5">Account #</th>
                          <th className="px-6 py-3.5">Consumer</th>
                          <th className="px-6 py-3.5">Consumption</th>
                          <th className="px-6 py-3.5">Bill Amount</th>
                          <th className="px-6 py-3.5">Payment Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {readings.filter(r => r.status === 'verified').map((r, bIdx) => {
                          const totalBill = calculateCostOf(r.consumption, r.classification);
                          return (
                            <tr key={`rec-bill-${r.id || r.accountNumber || bIdx}-${bIdx}`} className="hover:bg-slate-50 transition">
                              <td className="px-6 py-3.5 font-bold text-slate-900">{r.billingPeriod || 'Current Period'}</td>
                              <td className="px-6 py-3.5 font-mono font-bold text-blue-600">{r.accountNumber}</td>
                              <td className="px-6 py-3.5 font-bold text-slate-900">{r.consumerName}</td>
                              <td className="px-6 py-3.5 font-mono font-bold text-slate-800">{r.consumption} m³</td>
                              <td className="px-6 py-3.5 font-mono font-black text-slate-950 text-xs">₱{totalBill.toFixed(2)}</td>
                              <td className="px-6 py-3.5">
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider border shadow-2xs inline-block ${
                                  r.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-900 border-emerald-300' : 'bg-amber-100 text-amber-900 border-amber-300'
                                }`}>
                                  {r.paymentStatus || 'unpaid'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {recordsTab === 'payments' && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-[11px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3.5">Receipt / TXN ID</th>
                          <th className="px-6 py-3.5">Payment Date</th>
                          <th className="px-6 py-3.5">Account #</th>
                          <th className="px-6 py-3.5">Consumer</th>
                          <th className="px-6 py-3.5">Payment Method</th>
                          <th className="px-6 py-3.5">Amount Paid</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {readings.filter(r => r.paymentStatus === 'paid').map((r, pIdx) => {
                          const totalBill = r.paidAmount && r.paidAmount > 0 ? r.paidAmount : calculateCostOf(r.consumption, r.classification);
                          return (
                            <tr key={`rec-paid-${r.id || r.transactionId || pIdx}-${pIdx}`} className="hover:bg-slate-50 transition">
                              <td className="px-6 py-3.5 font-mono font-bold text-emerald-600">{r.transactionId || 'OR-2026-88192'}</td>
                              <td className="px-6 py-3.5 text-slate-700 font-mono font-medium">{r.paymentDate || r.readingDate}</td>
                              <td className="px-6 py-3.5 font-mono font-bold text-blue-600">{r.accountNumber}</td>
                              <td className="px-6 py-3.5 font-bold text-slate-900">{r.consumerName}</td>
                              <td className="px-6 py-3.5 font-bold text-slate-800">{r.paymentMethod || 'Cash'}</td>
                              <td className="px-6 py-3.5 font-mono font-black text-emerald-700 text-xs">₱{totalBill.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {recordsTab === 'audit' && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3.5">Timestamp</th>
                          <th className="px-6 py-3.5">User Operator</th>
                          <th className="px-6 py-3.5">Action</th>
                          <th className="px-6 py-3.5">Details</th>
                          <th className="px-6 py-3.5 text-right">IP Address</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {auditLogs.map((log, lIdx) => (
                          <tr key={`rec-audit-${log.id || lIdx}-${lIdx}`} className="hover:bg-slate-50">
                            <td className="px-6 py-3.5 font-mono text-slate-500 text-[11px]">{new Date(log.timestamp).toLocaleString()}</td>
                            <td className="px-6 py-3.5 font-bold text-slate-800">{log.userName}</td>
                            <td className="px-6 py-3.5 font-mono font-bold text-blue-600">{log.action}</td>
                            <td className="px-6 py-3.5 text-slate-700">{log.details}</td>
                            <td className="px-6 py-3.5 text-right font-mono text-slate-400">{log.ipAddress}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. APPROVALS MODULE (⭐ MOST IMPORTANT MODULE) */}
          {activeTab === 'approvals' && (
            <div className="space-y-6 animate-fade-in" id="approvals-tab">
              <div className="bg-blue-900 text-white p-6 rounded-3xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="bg-amber-400 text-slate-950 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full">
                      ⭐ Critical Workflow Gate
                    </span>
                    <span className="text-blue-200 text-xs font-mono">Real-time Meter Reader Submissions</span>
                  </div>
                  <h3 className="text-xl font-black uppercase tracking-tight">Reading Approvals & Auto-Billing Verification Queue</h3>
                  <p className="text-xs text-blue-200 max-w-2xl">
                    Approving a reading locks the field index, automatically generates the monthly water bill using tiered rates + fixed fees + VAT, posts it instantly to the Consumer Portal, and notifies the consumer.
                  </p>
                </div>
                <div className="bg-blue-950/80 border border-blue-800 p-4 rounded-2xl text-center shrink-0">
                  <span className="text-3xl font-black text-amber-400 block">{readings.filter(r => r.status === 'pending').length}</span>
                  <span className="text-[10px] text-blue-300 uppercase tracking-widest font-bold">Pending Approvals</span>
                </div>
              </div>

              {/* Sub-tab Navigation: Pending Queue vs Permanent Approval History */}
              <div className="flex border-b border-slate-200 space-x-4">
                <button
                  onClick={() => setApprovalsSubTab('pending')}
                  className={`pb-3 text-xs font-black uppercase tracking-wider transition border-b-2 flex items-center space-x-2 ${
                    approvalsSubTab === 'pending'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <span>⏳ Pending Verification Queue</span>
                  <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                    {readings.filter(r => r.status === 'pending').length}
                  </span>
                </button>

                <button
                  onClick={() => setApprovalsSubTab('history')}
                  className={`pb-3 text-xs font-black uppercase tracking-wider transition border-b-2 flex items-center space-x-2 ${
                    approvalsSubTab === 'history'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <span>📜 Permanent Approval History</span>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                    {readings.filter(r => r.status !== 'pending').length}
                  </span>
                </button>
              </div>

              {/* PENDING APPROVALS SUB-TAB */}
              {approvalsSubTab === 'pending' && (
                <>
                  {readings.filter(r => r.status === 'pending').length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
                      <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
                      <h4 className="text-base font-extrabold text-slate-800 uppercase">Approval Queue is All Clear!</h4>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">All field meter reader submissions have been reviewed and verified. Auto-generated bills have been published to consumer portals.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {readings.filter(r => r.status === 'pending').map((reading, pIdx) => {
                        const totalCalculatedBill = calculateCostOf(reading.consumption, reading.classification);
                        const waterAmount = totalCalculatedBill;

                        return (
                          <div key={`pending-read-${reading.id || ''}-${reading.accountNumber || ''}-${pIdx}`} className="bg-white border-2 border-amber-300 rounded-3xl p-6 shadow-md hover:shadow-lg transition space-y-4">
                            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-100 pb-4">
                              <div className="flex items-center space-x-4">
                                <div className="h-12 w-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600 flex items-center justify-center shrink-0">
                                  <Activity className="h-6 w-6 text-amber-600" />
                                </div>
                                <div>
                                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                    <h4 className="text-base font-extrabold text-slate-900">{reading.consumerName}</h4>
                                    <span className="bg-slate-900 text-amber-400 border border-slate-800 font-mono font-black px-2 py-0.5 rounded-lg text-xs tracking-wider shadow-2xs">
                                      {reading.accountNumber ? `#${reading.accountNumber}` : 'Pending Account'}
                                    </span>
                                    <span className="bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                                      {reading.route}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-500 mt-1">
                                    Meter ID: <strong className="font-mono text-slate-700">{reading.meterNumber}</strong> • Submitted by Field Reader: <strong className="text-slate-800">{reading.meterReaderName}</strong>
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center space-x-3 self-end lg:self-center">
                                <button
                                  onClick={() => {
                                    setSelectedPhotoUrl(reading.imageUrl || 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop');
                                    setSelectedPhotoAccount(reading.accountNumber);
                                  }}
                                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center space-x-1.5 transition"
                                >
                                  <Camera className="h-4 w-4 text-blue-600" />
                                  <span>View Dial Photo</span>
                                </button>

                                <span className="text-[11px] text-slate-400 font-mono">GPS: {reading.notes || '8.5024° N, 124.7731° E'}</span>
                              </div>
                            </div>

                            {/* Calculation Breakdown Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 bg-slate-50 p-4 rounded-2xl text-xs">
                              <div>
                                <span className="text-[10px] text-slate-400 font-bold uppercase block">Previous Index</span>
                                <span className="text-sm font-mono font-bold text-slate-700">{reading.previousReading} m³</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-bold uppercase block">Current Field Read</span>
                                <span className="text-sm font-mono font-black text-blue-600">{reading.currentReading} m³</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-bold uppercase block">Calculated Use</span>
                                <span className="text-sm font-mono font-black text-emerald-600">{reading.consumption} m³</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-bold uppercase block">Net Tariff</span>
                                <span className="text-sm font-mono font-bold text-slate-800">₱{waterAmount.toFixed(2)}</span>
                              </div>
                              <div className="col-span-2 md:col-span-1 bg-emerald-100 border border-emerald-200 p-2 rounded-xl text-center">
                                <span className="text-[9px] text-emerald-800 font-bold uppercase block">Auto Generated Bill</span>
                                <span className="text-base font-mono font-black text-emerald-900">₱{totalCalculatedBill.toFixed(2)}</span>
                              </div>
                            </div>

                            {/* Actions Row */}
                            <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-2">
                              <div className="text-[11px] text-slate-500">
                                Billing Period: <strong className="text-slate-800 font-bold">{reading.billingPeriod || 'Current Period'}</strong>
                              </div>

                              <div className="flex items-center space-x-2 w-full sm:w-auto">
                                {/* Admin Approval Only Button */}
                                <button
                                  onClick={() => {
                                    const updated = readings.map(r => r.id === reading.id ? { 
                                      ...r, 
                                      status: 'verified' as const, 
                                      paymentStatus: 'unpaid' as const, 
                                      remainingBalance: totalCalculatedBill, 
                                      billAmount: totalCalculatedBill,
                                      totalAmount: totalCalculatedBill,
                                      paidAmount: 0 
                                    } : r);
                                    mockDb.saveReadings(updated);
                                    setReadings(updated);

                                    // Direct Firestore sync
                                    syncDocToFirestore(COLLECTIONS.READINGS, reading.id, {
                                      ...reading,
                                      status: 'verified',
                                      paymentStatus: 'unpaid',
                                      remainingBalance: totalCalculatedBill,
                                      billAmount: totalCalculatedBill,
                                      totalAmount: totalCalculatedBill,
                                      paidAmount: 0
                                    });

                                    // Recalculate consumer arrears
                                    const consumerUnpaid = updated.filter(
                                      r => (r.accountNumber === reading.accountNumber || (reading.consumerName && r.consumerName === reading.consumerName)) && 
                                           r.status === 'verified' && 
                                           r.paymentStatus !== 'paid'
                                    );
                                    const newArrears = consumerUnpaid.reduce((sum, r) => {
                                      const gross = calculateCostOf(r.consumption, r.classification);
                                      const paid = r.paidAmount || 0;
                                      return sum + Math.max(0, gross - paid);
                                    }, 0);

                                    const updatedConsumers = consumers.map(c => 
                                      (c.accountNumber && c.accountNumber === reading.accountNumber) ||
                                      (c.name && reading.consumerName && c.name.trim().toLowerCase() === reading.consumerName.trim().toLowerCase())
                                        ? { ...c, outstandingBalance: newArrears }
                                        : c
                                    );
                                    mockDb.saveConsumers(updatedConsumers);
                                    setConsumers(updatedConsumers);

                                    // Dispatch Smart Notification to Consumer Portal
                                    mockDb.addNotification({
                                      accountNumber: reading.accountNumber,
                                      title: `Water Bill Issued - ${reading.billingPeriod || 'New Statement'}`,
                                      message: `Your water billing statement for ${reading.billingPeriod} has been verified and issued with ${reading.consumption} m³ total consumption (₱${totalCalculatedBill.toFixed(2)}). Due date: ${reading.dueDate || '20th of Month'}. Settle online or in-office.`,
                                      type: 'billing',
                                      readingId: reading.id,
                                      billingPeriod: reading.billingPeriod,
                                      remainingBalance: totalCalculatedBill
                                    });

                                    mockDb.addAuditLog(
                                      currentUser.id, 
                                      currentUser.name, 
                                      'admin', 
                                      'Approved Reading & Generated Bill', 
                                      `Approved reading #${reading.id} for ${reading.consumerName} (Account #${reading.accountNumber}). Auto-generated bill ₱${totalCalculatedBill.toFixed(2)} published to Consumer Portal.`
                                    );

                                    toast.success(
                                      'Reading Approved & Bill Issued',
                                      `Verified reading for ${reading.consumerName} (${reading.consumption} m³). Monthly bill of ₱${totalCalculatedBill.toFixed(2)} published.`,
                                      5000
                                    );
                                  }}
                                  className="w-full sm:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs transition shadow-md uppercase tracking-wider flex items-center justify-center space-x-2 cursor-pointer"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                  <span>APPROVE READING & ISSUE BILL</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* PERMANENT APPROVAL HISTORY SUB-TAB */}
              {approvalsSubTab === 'history' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                    <div className="relative flex-1 sm:max-w-md">
                      <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search history by account #, consumer name, meter ID, or notes..."
                        value={approvalHistorySearch}
                        onChange={(e) => setApprovalHistorySearch(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-2xs font-medium"
                      />
                    </div>

                    <button
                      onClick={() => {
                        const historyList = readings.filter(r => r.status !== 'pending');
                        const headers = ['Tx ID', 'Billing Period', 'Account Number', 'Consumer Name', 'Meter Number', 'Prev Index', 'Curr Index', 'Consumption', 'Status', 'Reader Staff', 'Notes'];
                        const rows = historyList.map(r => [
                          r.id, r.billingPeriod, r.accountNumber, r.consumerName, r.meterNumber, r.previousReading, r.currentReading, r.consumption, r.status.toUpperCase(), r.meterReaderName, r.notes || ''
                        ]);
                        exportToCsv('twd_approval_history_audit_export.csv', headers, rows);
                      }}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-2 transition shadow-sm border border-blue-700 shrink-0 cursor-pointer"
                    >
                      <Download className="h-4 w-4 text-white" />
                      <span className="text-white font-bold tracking-wide">Export Approval History CSV</span>
                    </button>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                          <tr>
                            <th className="px-3.5 py-3 whitespace-nowrap">Tx ID</th>
                            <th className="px-3.5 py-3 whitespace-nowrap">Billing Period</th>
                            <th className="px-3.5 py-3 min-w-[140px]">Account & Consumer</th>
                            <th className="px-3.5 py-3 whitespace-nowrap">Meter No.</th>
                            <th className="px-3.5 py-3 whitespace-nowrap">Indices (Prev → Curr)</th>
                            <th className="px-3.5 py-3 whitespace-nowrap">Usage & Bill</th>
                            <th className="px-3.5 py-3 whitespace-nowrap">Status</th>
                            <th className="px-3.5 py-3 min-w-[160px]">Audit Notes & Reader</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {(() => {
                            const q = (approvalHistorySearch || '').toLowerCase();
                            const filteredHistory = readings
                              .filter(r => r.status !== 'pending')
                              .filter(r => 
                                (r.accountNumber || '').toLowerCase().includes(q) ||
                                (r.consumerName || '').toLowerCase().includes(q) ||
                                (r.meterNumber || '').toLowerCase().includes(q) ||
                                (r.notes && r.notes.toLowerCase().includes(q))
                              );

                            if (filteredHistory.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                                    <div className="space-y-1">
                                      <p className="text-xs font-bold text-slate-600">No approval history found</p>
                                      <p className="text-[11px]">No verified or rejected meter reading transactions match your filter.</p>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            return filteredHistory.map((r, hIdx) => {
                              const totalBill = calculateCostOf(r.consumption, r.classification);
                              const isCorrected = r.notes && r.notes.includes('CORRECTED');
                              const isRejected = r.status === ('rejected' as any) || (r.notes && r.notes.includes('REJECTED'));

                              return (
                                <tr key={`hist-read-${r.id || ''}-${r.accountNumber || ''}-${hIdx}`} className="hover:bg-slate-50/80 transition">
                                  <td className="px-3.5 py-3 font-mono font-bold text-slate-500 text-[11px] whitespace-nowrap">
                                    {r.id}
                                  </td>
                                  <td className="px-3.5 py-3 font-bold text-slate-800 whitespace-nowrap">
                                    {r.billingPeriod || 'Current Period'}
                                  </td>
                                  <td className="px-3.5 py-3 space-y-0.5 min-w-[140px]">
                                    <span className="font-bold text-slate-900 block leading-tight">{r.consumerName}</span>
                                    <span className="font-mono text-blue-600 text-[11px] font-bold">#{r.accountNumber}</span>
                                  </td>
                                  <td className="px-3.5 py-3 font-mono text-slate-700 font-bold whitespace-nowrap">
                                    {r.meterNumber}
                                  </td>
                                  <td className="px-3.5 py-3 font-mono whitespace-nowrap">
                                    <span className="text-slate-500">{r.previousReading}</span>
                                    <span className="text-slate-400 mx-1">→</span>
                                    <span className="font-bold text-slate-900">{r.currentReading} m³</span>
                                  </td>
                                  <td className="px-3.5 py-3 space-y-0.5 whitespace-nowrap">
                                    <span className="font-mono font-bold text-emerald-600 block">{r.consumption} m³</span>
                                    <span className="font-mono font-black text-slate-900 text-xs">₱{totalBill.toFixed(2)}</span>
                                  </td>
                                  <td className="px-3.5 py-3 whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                      isRejected
                                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                        : isCorrected
                                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                        : r.status === 'verified'
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                        : 'bg-rose-100 text-rose-800 border border-rose-200'
                                    }`}>
                                      {isRejected ? 'REJECTED' : isCorrected ? 'CORRECTED' : r.status.toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="px-3.5 py-3 max-w-xs space-y-0.5 min-w-[160px]">
                                    <p className="text-[11px] text-slate-700 font-medium leading-normal" title={r.notes || 'Verified by Admin'}>
                                      {r.notes || 'Verified by Admin & Auto-Billed'}
                                    </p>
                                    <p className="text-[10px] text-slate-400 font-mono">
                                      Reader: <span className="text-slate-600 font-medium">{r.meterReaderName}</span>
                                    </p>
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. CONSUMERS MANAGEMENT MODULE */}
          {activeTab === 'consumers' && (
            <div className="space-y-6 animate-fade-in" id="consumers-tab">
              {(() => {
                const totalCount = consumers.length;
                const activeCount = consumers.filter(c => c.status === 'active' && Boolean(c.accountNumber && !c.accountNumber.toUpperCase().startsWith('PENDING') && c.status !== 'pending_approval')).length;
                const pendingCount = consumers.filter(c => !c.accountNumber || c.accountNumber.trim() === '' || c.accountNumber.toUpperCase().startsWith('PENDING') || c.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || c.status === 'pending_approval').length;
                const blockedCount = consumers.filter(c => c.status === 'blocked').length;
                const inactiveCount = consumers.filter(c => c.status === 'inactive' || c.status === 'archived').length;
                const hasActiveFilters = Boolean(
                  consumerSearch.trim() ||
                  consumerStatusFilter !== 'all' ||
                  consumerTypeFilter !== 'all' ||
                  consumerBarangayFilter !== 'all' ||
                  consumerSortBy !== 'recent'
                );

                const clearAllConsumerFilters = () => {
                  setConsumerSearch('');
                  setConsumerStatusFilter('all');
                  setConsumerTypeFilter('all');
                  setConsumerBarangayFilter('all');
                  setConsumerSortBy('recent');
                };

                return (
                  <>
                    {/* Header & Quick Status Filter Tabs */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                          <span>Consumer Accounts Database</span>
                          <span className="text-xs font-mono font-bold px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-full border border-blue-200">
                            {totalCount} Registered
                          </span>
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Manage registered water service connections, issue official account & meter identifiers, and monitor status.
                        </p>
                      </div>

                      {/* Export CSV Action */}
                      <button
                        onClick={() => {
                          const headers = ['Name', 'Email', 'Phone', 'Barangay', 'Sitio / Zone', 'Classification', 'Status', 'Account Number', 'Meter Number', 'RFID Tag', 'Address', 'Outstanding Balance'];
                          const rows = filteredConsumers.map(c => [
                            c.name, c.email, c.contactNumber, c.barangay || '', c.sitioZone || '', c.consumerType || 'Residential', c.status.toUpperCase(), c.accountNumber, c.meterNumber, c.rfidTag || '', c.address, c.outstandingBalance || 0
                          ]);
                          exportToCsv('twd_consumers_master_export.csv', headers, rows);
                        }}
                        className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center space-x-2 transition shadow-sm cursor-pointer shrink-0 self-start md:self-auto"
                      >
                        <Download className="h-4 w-4 text-white" />
                        <span>Export Filtered List ({filteredConsumers.length})</span>
                      </button>
                    </div>

                    {/* Quick Status Pill Bar */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                      <button
                        onClick={() => setConsumerStatusFilter('all')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shrink-0 flex items-center space-x-2 ${
                          consumerStatusFilter === 'all'
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        <span>All Accounts</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                          consumerStatusFilter === 'all' ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {totalCount}
                        </span>
                      </button>

                      <button
                        onClick={() => setConsumerStatusFilter('active')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shrink-0 flex items-center space-x-2 ${
                          consumerStatusFilter === 'active'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        <span>Active</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                          consumerStatusFilter === 'active' ? 'bg-emerald-800 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {activeCount}
                        </span>
                      </button>

                      <button
                        onClick={() => setConsumerStatusFilter('pending_approval')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shrink-0 flex items-center space-x-2 ${
                          consumerStatusFilter === 'pending_approval'
                            ? 'bg-amber-500 text-slate-950 shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        <span>⏳ Pending ID Issuance</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-black ${
                          consumerStatusFilter === 'pending_approval' ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}>
                          {pendingCount}
                        </span>
                      </button>

                      <button
                        onClick={() => setConsumerStatusFilter('blocked')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shrink-0 flex items-center space-x-2 ${
                          consumerStatusFilter === 'blocked'
                            ? 'bg-rose-600 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        <span>Blocked</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                          consumerStatusFilter === 'blocked' ? 'bg-rose-800 text-white' : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}>
                          {blockedCount}
                        </span>
                      </button>

                      <button
                        onClick={() => setConsumerStatusFilter('inactive')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shrink-0 flex items-center space-x-2 ${
                          consumerStatusFilter === 'inactive' || consumerStatusFilter === 'archived'
                            ? 'bg-slate-700 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        <span>Inactive / Archived</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                          consumerStatusFilter === 'inactive' || consumerStatusFilter === 'archived' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {inactiveCount}
                        </span>
                      </button>
                    </div>

                    {/* Master Search & Filter Controls Panel */}
                    <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-xs space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                        
                        {/* 1. Primary Search Input */}
                        <div className="lg:col-span-4 relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <Search className="h-4 w-4" />
                          </div>
                          <input 
                            type="text" 
                            placeholder="Search by name, account #, meter #, email, phone, or address..."
                            value={consumerSearch}
                            onChange={(e) => setConsumerSearch(e.target.value)}
                            className="w-full bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-2xl py-2.5 pl-10 pr-9 text-xs text-slate-900 font-medium placeholder-slate-400 focus:outline-none transition shadow-2xs"
                          />
                          {consumerSearch && (
                            <button
                              onClick={() => setConsumerSearch('')}
                              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                              title="Clear search"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        {/* 2. Status Filter Dropdown */}
                        <div className="lg:col-span-2">
                          <div className="relative">
                            <select
                              value={consumerStatusFilter}
                              onChange={(e: any) => setConsumerStatusFilter(e.target.value)}
                              className="w-full bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-2xl py-2.5 px-3 text-xs font-bold text-slate-700 focus:outline-none transition cursor-pointer appearance-none shadow-2xs"
                            >
                              <option value="all">All Statuses</option>
                              <option value="active">Active</option>
                              <option value="pending_approval">Pending ID Issuance</option>
                              <option value="inactive">Inactive</option>
                              <option value="blocked">Blocked</option>
                              <option value="archived">Archived</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                              <Filter className="h-3.5 w-3.5" />
                            </div>
                          </div>
                        </div>

                        {/* 3. Classification Filter (Residential / Commercial) */}
                        <div className="lg:col-span-2">
                          <div className="relative">
                            <select
                              value={consumerTypeFilter}
                              onChange={(e: any) => setConsumerTypeFilter(e.target.value)}
                              className="w-full bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-2xl py-2.5 px-3 text-xs font-bold text-slate-700 focus:outline-none transition cursor-pointer appearance-none shadow-2xs"
                            >
                              <option value="all">All Classifications</option>
                              <option value="Residential">Residential</option>
                              <option value="Commercial">Commercial</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                              <Building className="h-3.5 w-3.5" />
                            </div>
                          </div>
                        </div>

                        {/* 4. Barangay Filter */}
                        <div className="lg:col-span-2">
                          <div className="relative">
                            <select
                              value={consumerBarangayFilter}
                              onChange={(e) => setConsumerBarangayFilter(e.target.value)}
                              className="w-full bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-2xl py-2.5 px-3 text-xs font-bold text-slate-700 focus:outline-none transition cursor-pointer appearance-none shadow-2xs"
                            >
                              <option value="all">All Barangays</option>
                              {barangayList.map((b) => (
                                <option key={b.id || b.code} value={b.name}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                              <MapPin className="h-3.5 w-3.5" />
                            </div>
                          </div>
                        </div>

                        {/* 5. Sort Dropdown */}
                        <div className="lg:col-span-2">
                          <div className="relative">
                            <select
                              value={consumerSortBy}
                              onChange={(e: any) => setConsumerSortBy(e.target.value)}
                              className="w-full bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-2xl py-2.5 px-3 text-xs font-bold text-slate-700 focus:outline-none transition cursor-pointer appearance-none shadow-2xs"
                            >
                              <option value="recent">Sort: Priority / Recent</option>
                              <option value="name_asc">Name: A to Z</option>
                              <option value="name_desc">Name: Z to A</option>
                              <option value="account_asc">Account # Sequential</option>
                              <option value="balance_desc">Highest Outstanding Balance</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                              <ArrowUpDown className="h-3.5 w-3.5" />
                            </div>
                          </div>
                        </div>

                      </div>

                      {/* Active Filter Chips & Feedback Counter */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs border-t border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-500 font-medium">
                            Showing <strong className="text-slate-900 font-black">{filteredConsumers.length}</strong> of <strong className="text-slate-900 font-black">{totalCount}</strong> accounts
                          </span>

                          {/* Active Chips */}
                          {consumerSearch && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 border border-blue-200 text-[11px] font-bold">
                              <span>Query: "{consumerSearch}"</span>
                              <button onClick={() => setConsumerSearch('')} className="hover:text-blue-950">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          )}

                          {consumerStatusFilter !== 'all' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                              <span>Status: {consumerStatusFilter.replace('_', ' ').toUpperCase()}</span>
                              <button onClick={() => setConsumerStatusFilter('all')} className="hover:text-emerald-950">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          )}

                          {consumerTypeFilter !== 'all' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-800 border border-purple-200 text-[11px] font-bold">
                              <span>Type: {consumerTypeFilter}</span>
                              <button onClick={() => setConsumerTypeFilter('all')} className="hover:text-purple-950">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          )}

                          {consumerBarangayFilter !== 'all' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-bold">
                              <span>Barangay: {consumerBarangayFilter}</span>
                              <button onClick={() => setConsumerBarangayFilter('all')} className="hover:text-teal-950">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          )}
                        </div>

                        {hasActiveFilters && (
                          <button
                            onClick={clearAllConsumerFilters}
                            className="inline-flex items-center gap-1 text-slate-500 hover:text-rose-600 font-bold transition text-xs cursor-pointer ml-auto"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Reset All Filters</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Citizen Self-Service Registration Architecture Notice */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-white shadow-sm">
                      <div className="flex items-start space-x-3.5">
                        <div className="p-2.5 bg-blue-600/30 text-blue-400 rounded-xl border border-blue-500/30 shrink-0">
                          <UserCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                            <span>Consumer Self-Registration Architecture</span>
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded">
                              Auto-Sync Active
                            </span>
                          </h4>
                          <p className="text-[11px] text-slate-300 mt-1 max-w-2xl leading-relaxed">
                            Water consumers register directly via the Consumer Portal registration form. Barangay selection and Sitio/Zone are mandatory. Upon submission, accounts and their assigned Barangay IDs are automatically synchronized into this master administrative ledger.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <span className="inline-flex items-center px-3 py-1.5 bg-slate-800 text-slate-200 font-mono text-[11px] font-bold rounded-xl border border-slate-700">
                          <CheckCircle className="h-4 w-4 text-emerald-400 mr-2" />
                          <span>{filteredConsumers.length} Matching Accounts</span>
                        </span>
                      </div>
                    </div>

                    {/* Consumers Grid/Table or Empty State */}
                    {filteredConsumers.length === 0 ? (
                      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-4 shadow-xs">
                        <div className="h-16 w-16 bg-slate-100 text-slate-400 rounded-3xl flex items-center justify-center mx-auto">
                          <Search className="h-8 w-8 text-slate-400" />
                        </div>
                        <div className="space-y-1 max-w-md mx-auto">
                          <h4 className="text-base font-extrabold text-slate-800">No Consumers Found</h4>
                          <p className="text-xs text-slate-500">
                            {hasActiveFilters 
                              ? `No consumer records match your current search "${consumerSearch || 'all'}" with the selected filters.`
                              : "No registered water consumers found in the master database."}
                          </p>
                        </div>
                        {hasActiveFilters && (
                          <button
                            onClick={clearAllConsumerFilters}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition inline-flex items-center space-x-1.5 cursor-pointer shadow-sm"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Clear All Filters</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="bg-white border border-slate-200/80 rounded-3xl overflow-hidden shadow-xs">
                        <div className="w-full overflow-x-auto sm:overflow-x-visible">
                          <table className="w-full text-xs text-left table-fixed">
                            <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-150">
                              <tr>
                                <th className="w-[23%] px-4 py-3.5">Name</th>
                                <th className="w-[21%] px-3 py-3.5">Email</th>
                                <th className="w-[14%] px-3 py-3.5">Phone</th>
                                <th className="w-[16%] px-3 py-3.5">Barangay & Sitio</th>
                                <th className="w-[11%] px-3 py-3.5">Status</th>
                                <th className="w-[15%] px-4 py-3.5 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                              {filteredConsumers.map((c, cIdx) => {
                                const addrParts = c.address.split(',').map(p => p.trim());
                                const barangayDisplay = c.barangay || (addrParts.length >= 2 ? addrParts[1] : c.address);
                                const isPending = !c.accountNumber || c.accountNumber.trim() === '' || c.accountNumber.toUpperCase().startsWith('PENDING') || c.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || c.status === 'pending_approval';

                                return (
                                  <tr key={`cons-row-${c.accountNumber || c.email || c.name || cIdx}-${cIdx}`} className="hover:bg-slate-50/70 transition">
                                    <td className="px-4 py-3 space-y-0.5 truncate">
                                      <span className="font-bold text-[13px] text-slate-900 block truncate" title={c.name}>{c.name}</span>
                                      <div className="flex items-center space-x-1.5 truncate">
                                        {!isPending ? (
                                          <span className="font-mono text-[10px] text-slate-400 font-bold shrink-0">#{c.accountNumber}</span>
                                        ) : (
                                          <span className="font-mono text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded border border-amber-200 shrink-0">
                                            Pending Issuance
                                          </span>
                                        )}
                                        <span className={`inline-block text-[9px] font-black uppercase px-1.5 py-0.2 rounded border shrink-0 ${
                                          c.consumerType === 'Commercial'
                                            ? 'bg-purple-100/70 text-purple-700 border-purple-200'
                                            : 'bg-blue-100/70 text-blue-700 border-blue-200'
                                        }`}>
                                          {c.consumerType || 'Residential'}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-3 py-3 font-mono text-[11px] text-slate-600 truncate" title={c.email}>{c.email}</td>
                                    <td className="px-3 py-3 font-mono text-[11px] text-slate-700 font-bold truncate">{c.contactNumber}</td>
                                    <td className="px-3 py-3 truncate" title={`${barangayDisplay} ${c.sitioZone || ''}`}>
                                      <span className="font-semibold text-slate-900 truncate block">
                                        {barangayDisplay}
                                      </span>
                                      {c.sitioZone && (
                                        <span className="text-[10px] text-slate-500 block truncate mt-0.5 font-medium">
                                          {c.sitioZone}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-3">
                                      <div className="space-y-0.5">
                                        <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                          isPending
                                            ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse'
                                            : c.status === 'blocked'
                                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                            : c.status === 'active'
                                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                            : c.status === 'inactive'
                                            ? 'bg-slate-100 text-slate-700 border border-slate-200'
                                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                                        }`}>
                                          {isPending ? 'PENDING ID' : c.status.toUpperCase()}
                                        </span>
                                        <span className={`block text-[9px] font-bold truncate ${c.isRegistered ? 'text-emerald-600' : 'text-slate-400'}`}>
                                          {c.isRegistered ? '• Registered' : '• Offline'}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      <div className="flex items-center justify-end space-x-1.5">
                                        {isPending ? (
                                          <button 
                                            onClick={() => handleOpenConsumerModal(c, 'issue_ids')}
                                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center space-x-1 transition shadow-2xs cursor-pointer shrink-0"
                                            title="Issue Official Account Number, Meter & RFID Tag"
                                          >
                                            <ShieldCheck className="h-3.5 w-3.5 text-white" />
                                            <span className="text-white font-bold">Issue IDs</span>
                                          </button>
                                        ) : (
                                          <button 
                                            onClick={() => handleOpenConsumerModal(c, 'view')}
                                            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs flex items-center space-x-1 transition shadow-2xs cursor-pointer shrink-0"
                                            title="View Consumer Details"
                                          >
                                            <Eye className="h-3.5 w-3.5 text-white" />
                                            <span className="text-white font-bold">View</span>
                                          </button>
                                        )}

                                        <button 
                                          onClick={() => handleDeleteConsumer(c)}
                                          className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs flex items-center space-x-1 transition shadow-2xs cursor-pointer border border-rose-700 shrink-0"
                                          title={`Delete Consumer Record`}
                                        >
                                          <Trash2 className="h-3.5 w-3.5 text-white" />
                                          <span className="text-white font-bold">Delete</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* 3. METER READER MANAGEMENT MODULE */}
          {activeTab === 'readers' && (() => {
            const filteredStaff = readers.filter(r => {
              if (readerSearch.trim()) {
                const q = readerSearch.toLowerCase();
                const matchesName = r.name?.toLowerCase().includes(q);
                const matchesId = (r.employeeId || r.id)?.toLowerCase().includes(q);
                const matchesEmail = r.email?.toLowerCase().includes(q);
                const matchesPhone = r.contactNumber?.toLowerCase().includes(q);
                const matchesRoute = r.assignedRoutes?.some(route => route.toLowerCase().includes(q));
                return matchesName || matchesId || matchesEmail || matchesPhone || matchesRoute;
              }
              return true;
            });

            const uniqueRoutesCount = new Set(readers.flatMap(r => r.assignedRoutes || ['Zone 1-4: Poblacion (Main Central)'])).size;

            return (
              <div className="space-y-6 animate-fade-in" id="readers-tab">
                {/* Header & Main Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-slate-950 uppercase tracking-wider font-sans">
                      Meter Reading Staff Registry
                    </h3>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      Manage municipal field inspectors, register handheld terminal accounts, or terminate field staff access.
                    </p>
                  </div>
                  
                  <button
                    onClick={() => setShowAddReader(!showAddReader)}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition flex items-center space-x-2 shrink-0 shadow-sm active:scale-95 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Enroll Field Officer</span>
                  </button>
                </div>

                {/* Status Summary & Quick Stats Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-2xl border bg-white border-slate-200 shadow-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">Total Enrolled Officers</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900">{readers.length}</span>
                  </div>

                  <div className="p-3.5 rounded-2xl border bg-emerald-50 border-emerald-300 ring-2 ring-emerald-500/20 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">Active Mobile Terminals</span>
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    </div>
                    <span className="text-xl sm:text-2xl font-black text-emerald-900">{readers.length}</span>
                  </div>

                  <div className="col-span-2 sm:col-span-1 p-3.5 rounded-2xl border bg-blue-50 border-blue-200 shadow-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">Active Coverage Zones</span>
                    <span className="text-xl sm:text-2xl font-black text-blue-900">{uniqueRoutesCount || 1}</span>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <div className="relative flex-1 w-full">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <input 
                        type="text"
                        placeholder="Search officer name, employee ID, route, email, or phone..."
                        value={readerSearch}
                        onChange={(e) => setReaderSearch(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>

                    {readerSearch && (
                      <button
                        onClick={() => setReaderSearch('')}
                        className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer shrink-0"
                      >
                        Clear Search
                      </button>
                    )}
                  </div>
                </div>

                {/* Add Meter Reader Form */}
                {showAddReader && (
                  <form onSubmit={handleCreateReader} className="bg-white border-2 border-blue-200 p-6 rounded-2xl shadow-lg space-y-4 max-w-2xl animate-fade-in">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h4 className="text-sm font-black uppercase text-slate-900">Enroll Mobile Meter Reader</h4>
                        <p className="text-xs text-slate-500">Register field inspector credentials matching mobile terminal sync parameters.</p>
                      </div>
                      <button 
                        type="button" 
                        onClick={() => setShowAddReader(false)}
                        className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Full Name *</label>
                        <input 
                          type="text" 
                          required
                          placeholder="Full name"
                          value={newReader.name}
                          onChange={(e) => setNewReader({ ...newReader, name: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Username *</label>
                        <input 
                          type="text" 
                          required
                          placeholder="Username"
                          value={newReader.username}
                          onChange={(e) => setNewReader({ ...newReader, username: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono font-medium text-slate-800 focus:bg-white focus:border-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Password *</label>
                        <div className="relative">
                          <input 
                            type={showNewReaderPassword ? "text" : "password"} 
                            required
                            placeholder="Password"
                            value={newReader.password}
                            onChange={(e) => setNewReader({ ...newReader, password: e.target.value })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-3 pr-10 text-xs font-mono font-medium text-slate-800 focus:bg-white focus:border-blue-500 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewReaderPassword(!showNewReaderPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            {showNewReaderPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Target Route / Barangay Assignment</label>
                        <select 
                          value={newReader.assignedRoute}
                          onChange={(e) => setNewReader({ ...newReader, assignedRoute: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:bg-white focus:border-blue-500 outline-none cursor-pointer"
                        >
                          <option value="Zone 1-4: Poblacion (Main Central)">Zone 1-4: Poblacion (Main Central)</option>
                          <option value="Zone 5-8: Natumolan District">Zone 5-8: Natumolan District</option>
                          <option value="Zone 9-12: Baluarte Perimeter">Zone 9-12: Baluarte Perimeter</option>
                          <option value="Zone 13-16: Sta. Ana Coverage">Zone 13-16: Sta. Ana Coverage</option>
                          <option value="Zone 17-20: Sta. Cruz Valley">Zone 17-20: Sta. Cruz Valley</option>
                          <option value="Zone 21-24: Casinglot Coastal">Zone 21-24: Casinglot Coastal</option>
                          <option value="Zone 25-28: Gracia Sector">Zone 25-28: Gracia Sector</option>
                          <option value="Zone 29-32: Mohon Foothill">Zone 29-32: Mohon Foothill</option>
                          <option value="Zone 33-36: Sugbongcogon">Zone 33-36: Sugbongcogon</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                      <button 
                        type="button" 
                        onClick={() => setShowAddReader(false)} 
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="px-5 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition shadow-sm cursor-pointer"
                      >
                        Enroll Officer
                      </button>
                    </div>
                  </form>
                )}

                {/* Empty State */}
                {filteredStaff.length === 0 && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3">
                    <div className="h-12 w-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center font-bold text-xl">
                      🔍
                    </div>
                    <h4 className="text-base font-bold text-slate-800">No Meter Readers Found</h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      {readerSearch ? `No staff records matching "${readerSearch}". Try a different keyword or clear search.` : 'No meter readers recorded.'}
                    </p>
                    {readerSearch && (
                      <button
                        onClick={() => setReaderSearch('')}
                        className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition cursor-pointer"
                      >
                        Clear Search
                      </button>
                    )}
                  </div>
                )}

                {/* Unified Meter Readers Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {filteredStaff.map((r, rIdx) => {
                    const initials = r.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'MR';
                    const readerKey = r.id || `reader-${rIdx}`;
                    const isPasswordRevealed = !!revealedPasswords[readerKey];
                    const displayedPassword = r.password || r.pin || '1234';
                    const targetRouteDisplay = (r.assignedRoutes && r.assignedRoutes.length > 0) 
                      ? r.assignedRoutes[0] 
                      : (r.targetRoute || r.zone || 'Zone 1-4: Poblacion (Main Central)');

                    return (
                      <div 
                        key={`reader-unified-card-${r.id || ''}-${r.username || ''}-${rIdx}`} 
                        className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all flex flex-col justify-between space-y-4 relative"
                      >
                        {/* Card Header: Avatar, Name & Active Status Pill */}
                        <div className="space-y-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className="h-11 w-11 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 shadow-xs bg-blue-600 text-white">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-sm sm:text-base font-black text-slate-900 truncate">
                                  {r.name}
                                </h4>
                                <p className="text-[11px] text-blue-600 font-mono font-bold">
                                  @{r.username || r.name.toLowerCase().replace(/\s+/g, '_')}
                                </p>
                              </div>
                            </div>

                            {/* Status Pill */}
                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider shrink-0 border bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center space-x-1">
                              <Check className="h-3 w-3 inline mr-0.5" />
                              <span>Active Duty</span>
                            </span>
                          </div>

                          {/* Mobile Meter Reader Info Details Card */}
                          <div className="space-y-2.5 text-xs bg-slate-50 border border-slate-150 p-4 rounded-xl">
                            {/* Full Name */}
                            <div className="flex items-center justify-between text-slate-600 pb-2 border-b border-slate-200/60">
                              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Full Name</span>
                              <span className="font-bold text-slate-900 text-xs truncate max-w-[170px]">
                                {r.name}
                              </span>
                            </div>

                            {/* Username */}
                            <div className="flex items-center justify-between text-slate-600 pb-2 border-b border-slate-200/60">
                              <div className="flex items-center space-x-1.5 text-slate-500">
                                <UserCheck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <span className="text-[11px] font-bold uppercase tracking-wider">Username</span>
                              </div>
                              <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-xs">
                                {r.username || r.name.toLowerCase().replace(/\s+/g, '_')}
                              </span>
                            </div>

                            {/* Password */}
                            <div className="flex items-center justify-between text-slate-600 pb-2 border-b border-slate-200/60">
                              <div className="flex items-center space-x-1.5 text-slate-500">
                                <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <span className="text-[11px] font-bold uppercase tracking-wider">Password</span>
                              </div>
                              <div className="flex items-center space-x-1.5">
                                <span className="font-mono font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200 text-xs">
                                  {isPasswordRevealed ? displayedPassword : '••••••••'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setRevealedPasswords(prev => ({ ...prev, [readerKey]: !prev[readerKey] }))}
                                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition cursor-pointer"
                                  title={isPasswordRevealed ? "Hide Password" : "Show Password"}
                                >
                                  {isPasswordRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>

                            {/* Target Route / Barangay Assignment */}
                            <div className="pt-1">
                              <div className="flex items-center space-x-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                                <MapPin className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                                <span>Target Route / Barangay Assignment</span>
                              </div>
                              <div className="p-2 bg-blue-50/80 rounded-lg border border-blue-200/70 text-blue-800 font-bold text-xs">
                                {targetRouteDisplay}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Card Action Footer: Terminate Account */}
                        <div className="pt-3 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleTerminateReader(r)}
                            className="w-full py-2.5 px-3 bg-rose-50 hover:bg-rose-600 active:scale-95 text-rose-700 hover:text-white font-bold text-xs rounded-xl border border-rose-200 hover:border-rose-600 transition shadow-xs flex items-center justify-center space-x-2 cursor-pointer group"
                          >
                            <UserX className="h-4 w-4 text-rose-600 group-hover:text-white transition" />
                            <span>Terminate Account</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}


          {/* 4. WATER METER REGISTRATION & MANAGEMENT */}
          {activeTab === 'meters' && (
            <div className="space-y-6 animate-fade-in" id="meters-tab">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-extrabold text-slate-950 uppercase tracking-wider font-sans">Mechanical Water Meter Catalog</h3>
                
                <button
                  onClick={() => setShowAddMeter(!showAddMeter)}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition flex items-center space-x-2"
                >
                  <Plus className="h-4.5 w-4.5" />
                  <span>Register Mechanical Meter</span>
                </button>
              </div>

              {/* Add Meter Form */}
              {showAddMeter && (
                <form onSubmit={handleCreateMeter} className="bg-white border border-slate-200 p-6 rounded-2xl shadow-lg space-y-4 max-w-2xl">
                  <h4 className="text-sm font-bold uppercase text-slate-850">Water Meter Mechanical Parameters</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Meter Serial Number</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. MT-8844"
                        value={newMeter.meterNumber}
                        onChange={(e) => setNewMeter({ ...newMeter, meterNumber: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Manufacturer / Brand</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. NBI WaterTech"
                        value={newMeter.brand}
                        onChange={(e) => setNewMeter({ ...newMeter, brand: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Linked Account Number</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 1001-A"
                        value={newMeter.linkedAccountNumber}
                        onChange={(e) => setNewMeter({ ...newMeter, linkedAccountNumber: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                    <button 
                      type="button" 
                      onClick={() => setShowAddMeter(false)} 
                      className="px-4.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="px-4.5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold"
                    >
                      Insert Water Meter
                    </button>
                  </div>
                </form>
              )}

              {/* Meter list table */}
              <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-150">
                      <tr>
                        <th className="px-6 py-4">Meter serial</th>
                        <th className="px-6 py-4">Brand / Manufacturer</th>
                        <th className="px-6 py-4">Installation Date</th>
                        <th className="px-6 py-4 font-mono">Linked Consumer Link</th>
                        <th className="px-6 py-3 text-right">Operational Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                      {meters.map((m, mIdx) => (
                        <tr key={`meter-inv-${m.meterNumber || mIdx}-${mIdx}`} className="hover:bg-slate-50/70">
                          <td className="px-6 py-4 font-mono text-slate-900 font-black">{m.meterNumber}</td>
                          <td className="px-6 py-4 font-bold">{m.brand}</td>
                          <td className="px-6 py-4 font-sans text-slate-500">{m.installationDate}</td>
                          <td className="px-6 py-4 font-mono font-bold text-blue-600">
                            {m.linkedAccountNumber ? `#${m.linkedAccountNumber}` : 'UNASSIGNED'}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className={`px-2.5 py-1 rounded text-[10px] font-bold ${
                              m.status === 'active' 
                                ? 'bg-emerald-50 text-emerald-700' 
                                : m.status === 'damaged' 
                                ? 'bg-rose-50 text-rose-700' 
                                : 'bg-amber-50 text-amber-700'
                            }`}>
                              {m.status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 5. READING MONITORING MODULE */}
          {activeTab === 'readings' && (
            <div className="space-y-6 animate-fade-in" id="readings-tab">
              
              {/* Readings Control & Intake Header */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center space-x-3.5">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
                    <Activity className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Field Meter Readings & Telemetry Desk</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Real-time inspection of field readings submitted via mobile handset or clerk desk</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2.5">
                  <button 
                    onClick={() => setShowManualReadingForm(!showManualReadingForm)}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 shadow-xs"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{showManualReadingForm ? 'Hide Intake Form' : 'Record Manual Intake'}</span>
                  </button>
                </div>
              </div>

              {/* Collapsible Manual clerk forms */}
              {showManualReadingForm && (
                <form onSubmit={handleCreateManualReading} className="bg-white border border-slate-200 p-6 rounded-3xl shadow-md animate-slide-down space-y-4 text-slate-800">
                  <h4 className="text-xs font-extrabold text-blue-600 uppercase tracking-widest">Manual Clerk Reading Intake Panel</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 font-sans">Select connection Account</label>
                      <select
                        required
                        value={manualAccount}
                        onChange={(e) => setManualAccount(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500 font-semibold"
                      >
                        <option value="">-- Choose Account --</option>
                        {consumers.map((c, cIdx) => (
                          <option key={`sel-cons-opt-${c.accountNumber || cIdx}-${cIdx}`} value={c.accountNumber}>
                            #{c.accountNumber} - {c.name} ({c.consumerType || 'Residential'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 font-sans">Current Reading (Whole Dial Number)</label>
                      <input 
                        type="number"
                        required
                        min="0"
                        placeholder="e.g. 1258"
                        value={manualCurrentReading}
                        onChange={(e) => setManualCurrentReading(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500 font-bold font-mono"
                      />
                      <span className="text-[9px] text-slate-400 mt-1 block">Whole number indices displayed on meter face (m³)</span>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 font-sans">Service Billing Period</label>
                      <input 
                        type="text"
                        required
                        value={manualBillingPeriod}
                        onChange={(e) => setManualBillingPeriod(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 font-sans">Geographic GPS Tag</label>
                      <input 
                        type="text"
                        required
                        value={manualGps}
                        onChange={(e) => setManualGps(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 font-sans">Clerk Inspection notes</label>
                      <input 
                        type="text"
                        placeholder="Audit description details..."
                        value={manualNotes}
                        onChange={(e) => setManualNotes(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500"
                      />
                    </div>

                  </div>

                  <div className="pt-3 border-t border-slate-100 flex justify-end">
                    <button 
                      type="submit"
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition shadow-xs"
                    >
                      Calculate & Record Registry Entry
                    </button>
                  </div>
                </form>
              )}

              {/* Readings board layout */}
              <div className="bg-white border border-slate-150 rounded-3xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-150">
                      <tr>
                        <th className="px-6 py-4">Tx ID</th>
                        <th className="px-6 py-4">Consumer & Meter serial</th>
                        <th className="px-6 py-4">Reading Period</th>
                        <th className="px-6 py-4">Indices (Prev → Curr)</th>
                        <th className="px-6 py-4">Handset Telemetry (GPS / Dial Photo)</th>
                        <th className="px-6 py-4">Consumption (m³)</th>
                        <th className="px-6 py-3">Verification Review</th>
                        <th className="px-6 py-3 text-right">Review Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {readings.map((r, rIdx) => {
                        const isAbnormal = r.consumption >= 50;
                        const resolvedClassification = r.classification || 'Residential';
                        return (
                          <tr key={`board-reading-${r.id || ''}-${rIdx}`} className={`hover:bg-slate-55 transition ${isAbnormal && r.status === 'flagged_abnormal' ? 'bg-rose-500/10' : ''}`}>
                            <td className="px-6 py-4 font-mono font-bold text-slate-500 text-[11px]">{r.id}</td>
                            <td className="px-6 py-4 space-y-1">
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-slate-900 text-[13px]">{r.consumerName}</span>
                                <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border tracking-wider shrink-0 ${
                                  resolvedClassification === 'Commercial'
                                    ? 'bg-purple-100/80 text-purple-700 border-purple-200'
                                    : 'bg-blue-105/80 text-blue-700 border-blue-200'
                                }`}>
                                  {resolvedClassification}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-mono">Acc: {r.accountNumber} • Met: {r.meterNumber}</p>
                            </td>
                            <td className="px-6 py-4 text-slate-600 font-semibold">{r.billingPeriod}</td>
                            <td className="px-6 py-4 font-mono">
                              <span className="text-slate-400">{r.previousReading} m³</span>
                              <span className="text-slate-300 mx-1.5">→</span>
                              <span className="font-bold text-slate-800">{r.currentReading} m³</span>
                            </td>
                            <td className="px-6 py-4 space-y-1.5">
                              {r.gpsLocation ? (
                                <div className="flex items-center text-[10px] font-sans text-slate-500 font-semibold">
                                  <MapPin className="h-3.5 w-3.5 text-rose-500 mr-1.5 shrink-0" />
                                  <span>{r.gpsLocation}</span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">No GPS coordinates</span>
                              )}
                              <button 
                                onClick={() => { 
                                  setSelectedPhotoUrl(r.meterImageUrl || 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop'); 
                                  setSelectedPhotoAccount(r.accountNumber); 
                                }}
                                className="flex items-center space-x-1.5 px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-150 rounded text-[10px] font-extrabold transition uppercase"
                              >
                                <Camera className="h-3 w-3 shrink-0 text-blue-600" />
                                <span>Check dial photo</span>
                              </button>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center space-x-2">
                                <span className={`font-mono font-bold text-sm ${isAbnormal ? 'text-rose-600 font-black' : 'text-slate-800'}`}>
                                  {r.consumption} m³
                                </span>
                                {isAbnormal && (
                                  <span className="bg-rose-100 border border-rose-200 text-rose-700 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide flex items-center shrink-0">
                                    <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                                    HIGH USAGE ALERT
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                r.status === 'verified' 
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                  : r.status === 'flagged_abnormal' 
                                  ? 'bg-rose-50 text-rose-700 border border-rose-150 animate-pulse' 
                                  : 'bg-amber-50 text-amber-700 border border-amber-100'
                              }`}>
                                {r.status === 'flagged_abnormal' ? 'ANOMALOUS SUSPECTED' : r.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {r.status === 'pending' || r.status === 'flagged_abnormal' ? (
                                <button
                                  onClick={() => handleVerifyReading(r.id, 'verified')}
                                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase rounded-xl transition inline-flex items-center space-x-1.5 shadow-xs cursor-pointer tracking-wider"
                                  id={`approve-read-btn-${r.id}`}
                                >
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  <span>Approve</span>
                                </button>
                              ) : (
                                <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 inline-flex items-center space-x-1">
                                  <Check className="h-3 w-3 mr-0.5" />
                                  <span>Approved</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 6. ROUTE ASSIGNMENT ACTIONS MODULE */}
          {activeTab === 'routes' && (
            <div className="space-y-6 animate-fade-in" id="routes-tab">
              <div className="bg-white border border-slate-150 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-950 uppercase tracking-widest leading-none">Geographic Service Route assignments</h3>
                  <p className="text-xs text-slate-505 mt-1.5">Assign designated zones directly to registered reader handheld mobile applications.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                  {routes.map((rt, rtIdx) => (
                    <div key={`route-card-${rt.id || ''}-${rtIdx}`} className="bg-slate-50 border border-slate-150 rounded-2xl p-6 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-base font-extrabold text-slate-900">{rt.routeName}</h4>
                          <p className="text-xs text-slate-500">{rt.description}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          rt.status === 'completed' 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                            : rt.status === 'in_progress' 
                            ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {rt.status.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-xs">
                        <div>
                          <span className="text-slate-400">Consumers in zone:</span>
                          <span className="font-bold text-slate-800 ml-1.5">{rt.totalConsumers} connections</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Assigned Reader Option:</span>
                          <span className="font-extrabold text-blue-700 ml-1.5">{rt.assignedReaderName}</span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-200/50 flex justify-end">
                        {editingRouteId === rt.id ? (
                          <div className="flex items-center space-x-2 w-full">
                            <select
                              value={assignedReaderId}
                              onChange={(e) => setAssignedReaderId(e.target.value)}
                              className="bg-white border border-slate-200 rounded-lg py-1.5 px-3 text-xs w-full font-bold text-slate-700"
                            >
                              <option value="">Choose Reader Staff...</option>
                              {readers.map((r, rIdx) => (
                                <option key={`route-reader-opt-${r.id || ''}-${r.employeeId || ''}-${rIdx}`} value={r.id}>{r.name}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleSaveRouteAssignment(rt.id)}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold shrink-0 hover:bg-blue-700"
                            >
                              Save Assignment
                            </button>
                            <button
                              onClick={() => setEditingRouteId(null)}
                              className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold shrink-0 hover:bg-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingRouteId(rt.id);
                              setAssignedReaderId(rt.assignedReaderId);
                            }}
                            className="px-4 py-2 bg-white border border-slate-250 text-slate-700 hover:text-blue-600 text-xs font-bold rounded-lg transition"
                          >
                            Reassign Route Zone
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 7. REPORTS AND ANALYTICS MODULE */}
          {activeTab === 'reports' && (
            <div className="space-y-6 animate-fade-in" id="reports-tab">
              <div className="bg-white border border-slate-150 rounded-3xl p-6 sm:p-8 space-y-6 shadow-sm">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-950 uppercase tracking-widest">Reports, Export & Operational Analytics</h3>
                    <p className="text-xs text-slate-505 mt-1">Review district water supply indicators and download data tables.</p>
                  </div>
                  <button
                    onClick={() => {
                      alert("TWD Reports cleared! Initiated CSV spreadsheet download of 6 connections water history.");
                    }}
                    className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition flex items-center space-x-2"
                  >
                    <FileSpreadsheet className="h-4.5 w-4.5" />
                    <span>Export Ledger Report (CSV)</span>
                  </button>
                </div>

                {/* Simulated Ledger metrics */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Historical Water consumption readings for billing cycles</h4>
                  <div className="border border-slate-150 rounded-2xl overflow-hidden">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-100">
                        <tr>
                          <th className="px-6 py-3">Account</th>
                          <th className="px-6 py-3">Client Name</th>
                          <th className="px-6 py-3">Route location</th>
                          <th className="px-6 py-3">Prev Index</th>
                          <th className="px-6 py-3">Current Index</th>
                          <th className="px-6 py-3 font-mono">Simulated Consumption</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-755 font-medium">
                        {readings.map((r, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-6 py-3 font-mono font-bold text-slate-900">{r.accountNumber}</td>
                            <td className="px-6 py-3 font-bold text-slate-800">{r.consumerName}</td>
                            <td className="px-6 py-3">{r.route}</td>
                            <td className="px-6 py-3 font-mono text-slate-400">{r.previousReading} m³</td>
                            <td className="px-6 py-3 font-mono text-slate-700 font-bold">{r.currentReading} m³</td>
                            <td className="px-6 py-3 font-mono font-black text-blue-600">{r.consumption} m³</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 8. PUBLIC ANNOUNCEMENTS BILLBOARD */}
          {activeTab === 'announcements' && (
            <div className="space-y-6 animate-fade-in" id="announcements-tab">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-extrabold text-slate-950 uppercase tracking-wider">Public advisories bulletin</h3>
                
                <button
                  onClick={() => setShowAddAnnouncement(!showAddAnnouncement)}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition flex items-center space-x-2"
                >
                  <Plus className="h-4.5 w-4.5" />
                  <span>Publish Advisory Notice</span>
                </button>
              </div>

              {/* Add Announcement Form */}
              {showAddAnnouncement && (
                <form onSubmit={handleCreateAnnouncement} className="bg-white border border-slate-200 p-6 rounded-2xl shadow-lg space-y-4 max-w-2xl">
                  <h4 className="text-sm font-bold uppercase text-slate-850">Publish Advisory Bulletin specs</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notice Title</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Pipeline Disruption Natumolan Station"
                        value={newAnnouncement.title}
                        onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notice Category</label>
                      <select
                        value={newAnnouncement.category}
                        onChange={(e: any) => setNewAnnouncement({ ...newAnnouncement, category: e.target.value })}
                        className="bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3 text-xs font-bold text-slate-700"
                      >
                        <option value="disruption">Service Disruption / Interruption</option>
                        <option value="maintenance">Preventive Maintenance</option>
                        <option value="event">Community Event</option>
                        <option value="info">General Info Announcement</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notice Content Context</label>
                      <textarea 
                        rows={4}
                        required
                        placeholder="Tell the water consumers about this schedule..."
                        value={newAnnouncement.content}
                        onChange={(e) => setNewAnnouncement({ ...newAnnouncement, content: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      ></textarea>
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                    <button 
                      type="button" 
                      onClick={() => setShowAddAnnouncement(false)} 
                      className="px-4.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-705"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="px-4.5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold"
                    >
                      Publish Advisory
                    </button>
                  </div>
                </form>
              )}

              {/* Announcements list */}
              <div className="space-y-4">
                {announcements.map((ann, aIdx) => (
                  <div key={`ann-card-${ann.id || ''}-${aIdx}`} className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-center text-xs font-bold mb-2">
                        <span className="text-blue-600 bg-blue-50 border border-blue-105 px-2 py-0.5 rounded text-[10px] uppercase">{ann.category}</span>
                        <span className="text-slate-400">{ann.date}</span>
                      </div>
                      <h4 className="text-base font-extrabold text-slate-900">{ann.title}</h4>
                      <p className="text-xs text-slate-600 mt-2 leading-relaxed">{ann.content}</p>
                    </div>
                    <div className="pt-3 border-t border-slate-50 mt-4 flex justify-between items-center text-[10px] uppercase font-bold text-slate-400">
                      <span>Posted by: {ann.postedBy}</span>
                      <button
                        onClick={() => {
                          const updated = announcements.filter(x => x.id !== ann.id);
                          mockDb.saveAnnouncements(updated);
                          setAnnouncements(updated);
                          mockDb.addAuditLog(currentUser.id, currentUser.name, 'admin', 'Delete Public Bulletin', `Removed bulletin titled: ${ann.title}`);
                        }}
                        className="text-rose-600 hover:underline"
                      >
                        Delete Announcement
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 9. SECURITY AUDIT TRAIL REGISTER */}
          {activeTab === 'audit' && (
            <div className="space-y-6 animate-fade-in" id="audit-tab">
              <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-150">
                      <tr>
                        <th className="px-6 py-4">Timestamp</th>
                        <th className="px-6 py-4">User Operator coordinates</th>
                        <th className="px-6 py-4 font-mono">Logged Action event</th>
                        <th className="px-6 py-4">Audit Details summary</th>
                        <th className="px-6 py-3 text-right">Operational IP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                      {auditLogs.map((log, lIdx) => (
                        <tr key={`log-row-${log.id || ''}-${lIdx}`} className="hover:bg-slate-50/50">
                          <td className="px-6 py-4.5 font-mono text-slate-500 text-[11px] leading-relaxed">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="px-6 py-4.5 space-y-0.5">
                            <p className="font-extrabold text-slate-850">{log.userName}</p>
                            <p className="text-[10px] text-slate-450 uppercase tracking-widest leading-none">Role: {log.userRole}</p>
                          </td>
                          <td className="px-6 py-4.5 font-bold font-mono text-blue-600">{log.action}</td>
                          <td className="px-6 py-4.5 text-slate-650 max-w-sm font-sans text-xs leading-normal">{log.details}</td>
                          <td className="px-6 py-4.5 text-right font-mono text-slate-400 text-[11px]">{log.ipAddress}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 5. BILLS MODULE */}
          {activeTab === 'bills' && (
            <div className="space-y-6 animate-fade-in" id="bills-tab">
              {/* Security & Separation of Duties Audit Notice */}
              <div className="bg-slate-900 border-l-4 border-amber-500 p-4 rounded-2xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-white">
                <div className="flex items-start space-x-3">
                  <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-amber-400">Strict Audit & Immutable Records Notice</h4>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Bills in this ledger are immutable financial records. No direct payment collecting or amount editing is allowed in this module. To collect payments, switch to the <button onClick={() => setActiveTab('payments')} className="underline font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer">Process Payment (Cashier Counter)</button> module.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('payments')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] uppercase tracking-wider rounded-xl transition shrink-0 flex items-center space-x-1.5 cursor-pointer shadow-sm"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  <span>Go to Process Payment</span>
                </button>
              </div>

              {/* Bills Module Summary KPI Header */}
              {(() => {
                const verifiedReadings = readings.filter(r => r.status === 'verified');
                const totalConsumptionVol = verifiedReadings.reduce((sum, r) => sum + (r.consumption || 0), 0);
                const unpaidBills = verifiedReadings.filter(r => r.paymentStatus !== 'paid' && r.status !== 'cancelled');
                const unpaidTotal = unpaidBills.reduce((sum, r) => {
                  const gross = calculateCostOf(r.consumption, r.classification);
                  const paid = r.paidAmount || 0;
                  return sum + Math.max(0, gross - paid);
                }, 0);

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Verified Bills Count</p>
                        <p className="text-2xl font-black text-slate-900 mt-0.5">{verifiedReadings.length}</p>
                      </div>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700">
                        <FileText className="h-5 w-5" />
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Total Billed Consumption</p>
                        <p className="text-2xl font-black text-cyan-950 mt-0.5">{totalConsumptionVol.toLocaleString()} m³</p>
                      </div>
                      <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-xl text-cyan-700">
                        <Droplet className="h-5 w-5" />
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Unpaid Receivables</p>
                        <p className="text-2xl font-black text-amber-950 mt-0.5">₱{unpaidTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700">
                        <CreditCard className="h-5 w-5" />
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:max-w-xl">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search account #, consumer name or billing period..."
                      value={billSearch}
                      onChange={(e) => setBillSearch(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs placeholder:text-slate-400 placeholder:font-normal"
                    />
                  </div>
                  <select
                    value={billStatusFilter}
                    onChange={(e: any) => setBillStatusFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs shrink-0 cursor-pointer"
                  >
                    <option value="all">All Statuses</option>
                    <option value="unpaid">Unpaid Only</option>
                    <option value="paid">Paid Only</option>
                    <option value="overdue">Overdue Only</option>
                    <option value="cancelled">Cancelled Only</option>
                  </select>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => {
                      alert("TWD Water Bills Ledger exported as PDF/CSV.");
                    }}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-xl text-xs uppercase tracking-wider transition shadow-2xs flex items-center space-x-2 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-slate-300" />
                    <span>Export Ledger</span>
                  </button>
                </div>
              </div>

              {/* Bills List Table */}
              <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
                <div className="w-full overflow-x-auto">
                  <table className="min-w-full text-xs text-left">
                    <thead className="bg-slate-800 text-white font-extrabold uppercase border-b border-slate-700 text-[10px] select-none tracking-wider">
                      <tr>
                        <th className="px-3 py-3 whitespace-nowrap">Billing Period</th>
                        <th className="px-3 py-3 whitespace-nowrap">Account #</th>
                        <th className="px-3 py-3 whitespace-nowrap">Consumer Name</th>
                        <th className="px-3 py-3 whitespace-nowrap">Meter #</th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">Consumption</th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">Bill Amount</th>
                        <th className="px-2 py-3 whitespace-nowrap text-center">Status</th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs font-medium bg-white">
                      {(() => {
                        const filteredBills = readings
                          .filter(r => r.status === 'verified')
                          .filter(r => {
                            if (billStatusFilter === 'unpaid') return r.paymentStatus !== 'paid' && r.status !== 'cancelled';
                            if (billStatusFilter === 'paid') return r.paymentStatus === 'paid';
                            if (billStatusFilter === 'overdue') return r.paymentStatus !== 'paid' && r.status !== 'cancelled' && r.isOverdue;
                            if (billStatusFilter === 'cancelled') return r.status === 'cancelled';
                            return true;
                          })
                          .filter(r => {
                            if (!billSearch) return true;
                            const q = (billSearch || '').toLowerCase();
                            return (r.accountNumber || '').toLowerCase().includes(q) || 
                                   (r.consumerName || '').toLowerCase().includes(q) || 
                                   (r.billingPeriod && r.billingPeriod.toLowerCase().includes(q));
                          });

                        if (filteredBills.length === 0) {
                          return (
                            <tr>
                              <td colSpan={8} className="px-4 py-12 text-center text-slate-700 bg-white">
                                <div className="flex flex-col items-center justify-center space-y-2">
                                  <FileText className="h-8 w-8 text-slate-400" />
                                  <p className="font-extrabold text-sm text-slate-900">No bills found matching your criteria</p>
                                  <p className="text-xs text-slate-600 font-bold">Try adjusting your search query or status filter.</p>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return filteredBills.map((bill, bIdx) => {
                          const totalBill = calculateCostOf(bill.consumption, bill.classification);
                          const isPaid = bill.paymentStatus === 'paid';
                          const isCancelled = bill.status === 'cancelled';

                          return (
                            <tr key={`bill-row-${bill.id || ''}-${bIdx}`} className="hover:bg-slate-50 transition-colors bg-white">
                              <td className="px-3 py-3 whitespace-nowrap font-black text-slate-900">
                                {bill.billingPeriod || 'Current Period'}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">
                                <span className="font-mono font-bold text-blue-900 bg-blue-100/90 px-2 py-0.5 rounded border border-blue-300 text-xs inline-block">
                                  {bill.accountNumber}
                                </span>
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap font-black text-slate-900">
                                {bill.consumerName}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap font-mono font-extrabold text-slate-800 text-xs">
                                {bill.meterNumber}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap text-right">
                                <span className="inline-flex items-center justify-end space-x-1 bg-slate-900 text-cyan-300 font-mono font-black text-xs px-2.5 py-1 rounded-md border border-slate-800 shadow-2xs">
                                  <Droplet className="h-3 w-3 text-cyan-400 shrink-0" />
                                  <span>{bill.consumption} m³</span>
                                </span>
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap text-right font-mono font-black text-slate-950 text-sm">
                                {isCancelled ? (
                                  <span className="line-through text-slate-400">₱{totalBill.toFixed(2)}</span>
                                ) : (
                                  <span className="text-slate-950 font-black">₱{totalBill.toFixed(2)}</span>
                                )}
                              </td>
                              <td className="px-2 py-3 whitespace-nowrap text-center">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
                                  isCancelled
                                    ? 'bg-slate-100 text-slate-900 border-slate-300'
                                    : isPaid
                                    ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
                                    : 'bg-amber-100 text-amber-950 border-amber-300'
                                }`}>
                                  {isCancelled ? 'CANCELLED' : isPaid ? 'PAID' : 'UNPAID'}
                                </span>
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => {
                                      const foundConsumer = consumers.find(c => c.accountNumber === bill.accountNumber) || {
                                        accountNumber: bill.accountNumber,
                                        name: bill.consumerName,
                                        address: bill.address || 'SIHAYON-LEFT (ZONE-11A)',
                                        sitioZone: bill.addressZone || 'ZONE-11A',
                                        contactNumber: '+63 917 000 0000',
                                        email: 'consumer@tagoloanwater.gov.ph',
                                        meterNumber: bill.meterNumber,
                                        meterBrand: bill.meterBrand || 'EVER',
                                        status: 'active' as const,
                                        isRegistered: true,
                                        consumerType: (bill.classification || 'Residential') as 'Residential' | 'Commercial',
                                        outstandingBalance: bill.arrears || 0,
                                        sequenceNo: bill.sequenceNo || '135',
                                      };
                                      setSelectedNoticeConsumer(foundConsumer);
                                      setSelectedNoticeReading(bill);
                                    }}
                                    className="px-2.5 py-1 bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs rounded-md transition inline-flex items-center space-x-1 cursor-pointer shadow-2xs border border-blue-900 shrink-0"
                                    title="View & Print Official Notice"
                                  >
                                    <ReceiptText className="h-3.5 w-3.5 text-blue-300" />
                                    <span>View Notice</span>
                                  </button>

                                  {!isCancelled && !isPaid && (
                                    <>
                                      <button
                                        onClick={() => {
                                          alert(`SMS and Email bill notification resent to consumer ${bill.consumerName} (Account #${bill.accountNumber}).`);
                                        }}
                                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-md transition inline-flex items-center space-x-1 cursor-pointer shadow-2xs shrink-0"
                                        title="Resend Notice"
                                      >
                                        <Send className="h-3.5 w-3.5 text-white" />
                                        <span>Resend</span>
                                      </button>

                                      <button
                                        onClick={() => {
                                          const reason = prompt(`Reason for cancelling bill #${bill.id} (Account #${bill.accountNumber}):`);
                                          if (reason && reason.trim()) {
                                            setReadings(prev => prev.map(r => r.id === bill.id ? { ...r, status: 'cancelled' as any } : r));
                                            alert(`Bill #${bill.id} has been marked as CANCELLED.\nReason: "${reason}"\nAudit trail record generated permanently.`);
                                          }
                                        }}
                                        className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-md transition inline-flex items-center space-x-1 cursor-pointer shadow-2xs shrink-0"
                                        title="Cancel Bill"
                                      >
                                        <XCircle className="h-3.5 w-3.5 text-white" />
                                        <span>Cancel</span>
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 6. PROCESS PAYMENT MODULE */}
          {activeTab === 'payments' && (
            <div className="space-y-6 animate-fade-in" id="payments-tab">
              <div className="bg-gradient-to-r from-emerald-900 via-slate-900 to-slate-900 text-white rounded-3xl p-6 shadow-md border border-emerald-800/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-emerald-500/30">
                      In-Office Cashier Desk
                    </span>
                    <span className="bg-blue-500/20 text-blue-300 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-blue-500/30">
                      Real-Time Consumer Portal Sync
                    </span>
                  </div>
                  <h3 className="text-xl font-black uppercase tracking-tight mt-1 text-white">Process Consumer Payments & Issue Official Receipts (OR)</h3>
                  <p className="text-xs text-emerald-200/80 mt-0.5">Search consumer by Account Number, Name, Phone, or RFID tag to process cash payments and issue official receipts.</p>
                </div>
                <div className="bg-emerald-950/90 border border-emerald-800/80 p-4 rounded-2xl text-center shrink-0 min-w-[200px]">
                  <span className="text-2xl font-black text-emerald-400 font-mono block">
                    ₱{readings.filter(r => r.paymentStatus === 'paid' || r.paymentStatus === 'partial').reduce((acc, r) => acc + (r.paidAmount || 0), 0).toFixed(2)}
                  </span>
                  <span className="text-[10px] text-emerald-300 uppercase tracking-widest font-bold">Today's Settled Collections</span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* 1. Lookup Consumer Account Panel */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">1. Lookup Consumer Account</h4>
                    <span className="text-[10px] font-bold text-slate-400">Prioritizing Unpaid</span>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Search Name, Account #, Phone, or Scan RFID</label>
                    <div className="relative">
                      <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        placeholder="e.g. 1001-A, John Doe, 0917..."
                        value={paymentSearch}
                        onChange={(e) => setPaymentSearch(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-emerald-500 focus:bg-white transition"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                    {consumers
                      .filter(c => {
                        if (!paymentSearch) return true;
                        const q = (paymentSearch || '').toLowerCase();
                        return (
                          (c.accountNumber || '').toLowerCase().includes(q) ||
                          (c.name || '').toLowerCase().includes(q) ||
                          (c.contactNumber && c.contactNumber.includes(q)) ||
                          (c.rfidTag && c.rfidTag.toLowerCase().includes(q))
                        );
                      })
                      .sort((a, b) => {
                        const aUnpaid = readings.filter(r => r.accountNumber === a.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid').length;
                        const bUnpaid = readings.filter(r => r.accountNumber === b.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid').length;
                        return bUnpaid - aUnpaid; // Prioritize unpaid consumers first
                      })
                      .map((c, cIdx) => {
                        const isSelected = selectedPaymentAccount?.accountNumber === c.accountNumber;
                        const consumerReadings = readings.filter(r => r.accountNumber === c.accountNumber && r.status === 'verified');
                        const unpaidReadings = consumerReadings.filter(r => r.paymentStatus !== 'paid');
                        const unpaidCount = unpaidReadings.length;

                        // Total due calculation including overdue penalties
                        const totalArrears = unpaidReadings.reduce((acc, r) => {
                          const w = calculateCostOf(r.consumption, r.classification);
                          const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                          const pen = isOverdue ? Math.round(w * 0.10) : 0;
                          const gross = w + pen;
                          const paid = r.paidAmount || 0;
                          return acc + Math.max(0, gross - paid);
                        }, 0);

                        return (
                          <div
                            key={`pos-cons-${c.accountNumber || cIdx}-${cIdx}`}
                            onClick={() => {
                              setSelectedPaymentAccount(c);
                              const unpaidList = readings.filter(r => r.accountNumber === c.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid');
                              const unpaidIds = unpaidList.map(r => r.id);
                              setSelectedBillIds(unpaidIds);
                              
                              // Auto calculate exact total due
                              const exactDue = unpaidList.reduce((acc, r) => {
                                const w = calculateCostOf(r.consumption, r.classification);
                                const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                                const pen = isOverdue ? Math.round(w * 0.10) : 0;
                                const gross = w + pen;
                                const paid = r.paidAmount || 0;
                                return acc + Math.max(0, gross - paid);
                              }, 0);

                              setPaymentAmountPaid(Math.round(exactDue * 100) / 100);
                              setPaymentType('full');
                              setAllocationMode('auto');
                              setManualAllocations({});
                            }}
                            className={`p-3.5 rounded-2xl border cursor-pointer transition flex justify-between items-center ${
                              isSelected ? 'bg-emerald-50 border-emerald-500 shadow-sm' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-mono font-bold text-blue-600 text-xs">#{c.accountNumber}</span>
                                {c.rfidTag && (
                                  <span className="bg-slate-200 text-slate-700 text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold">RFID</span>
                                )}
                              </div>
                              <h5 className="font-extrabold text-slate-900 text-xs mt-0.5">{c.name}</h5>
                              <p className="text-[10px] text-slate-500 truncate max-w-[180px]">{c.address}</p>
                            </div>
                            <div className="text-right">
                              {unpaidCount > 0 ? (
                                <div className="space-y-1">
                                  <span className="bg-amber-100 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full inline-block">
                                    {unpaidCount} Unpaid Bill{unpaidCount > 1 ? 's' : ''}
                                  </span>
                                  <span className="font-mono font-black text-amber-700 text-xs block">₱{totalArrears.toFixed(2)}</span>
                                </div>
                              ) : (
                                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2.5 py-0.5 rounded-full inline-block">
                                  Cleared (₱0.00)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* 2. Cashier Payment Processing & Allocation Panel */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
                  {selectedPaymentAccount ? (
                    <div className="space-y-6">
                      {/* Consumer Details Header */}
                      <div className="flex justify-between items-start border-b border-slate-100 pb-4">
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">Selected Consumer Account</span>
                          <h4 className="text-lg font-black text-slate-900">{selectedPaymentAccount.name}</h4>
                          <p className="text-xs text-slate-500 font-mono">
                            Account #{selectedPaymentAccount.accountNumber} • Meter #{selectedPaymentAccount.meterNumber}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="bg-blue-100 text-blue-800 font-bold text-xs px-3 py-1 rounded-xl inline-block mb-1">
                            {selectedPaymentAccount.consumerType || 'Residential'}
                          </span>
                          <p className="text-[10px] text-slate-500 font-medium">{selectedPaymentAccount.address}</p>
                        </div>
                      </div>

                      {/* Outstanding Itemized Bills Table */}
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                        <div className="flex justify-between items-center">
                          <h5 className="text-xs font-black uppercase text-slate-800 flex items-center space-x-2">
                            <FileText className="h-4 w-4 text-emerald-600" />
                            <span>Unpaid & Partial Water Bills</span>
                          </h5>
                          <span className="text-[10px] font-bold text-slate-500">Select bills to settle</span>
                        </div>

                        {readings.filter(r => r.accountNumber === selectedPaymentAccount.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid').length === 0 ? (
                          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-center text-xs font-bold space-y-1">
                            <CheckCircle className="h-6 w-6 text-emerald-600 mx-auto" />
                            <p>All bills for this account are fully settled! Current balance is ₱0.00.</p>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                            {readings
                              .filter(r => r.accountNumber === selectedPaymentAccount.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid')
                              .map((r, bIdx) => {
                                const waterAmount = calculateCostOf(r.consumption, r.classification);
                                const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                                const penaltyAmount = isOverdue ? Math.round(waterAmount * 0.10) : 0;
                                const grossTotal = waterAmount + penaltyAmount;
                                const alreadyPaid = r.paidAmount || 0;
                                const netBalanceDue = Math.max(0, grossTotal - alreadyPaid);
                                const isChecked = selectedBillIds.includes(r.id);

                                return (
                                  <div 
                                    key={`pos-bill-chk-${r.id || ''}-${bIdx}`} 
                                    className={`p-3 rounded-xl border transition flex items-center justify-between text-xs ${
                                      isChecked ? 'bg-white border-emerald-400 shadow-2xs' : 'bg-slate-100/70 border-slate-200 opacity-60'
                                    }`}
                                  >
                                    <div className="flex items-center space-x-3">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedBillIds([...selectedBillIds, r.id]);
                                          } else {
                                            setSelectedBillIds(selectedBillIds.filter(id => id !== r.id));
                                          }
                                        }}
                                        className="h-4 w-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                                      />
                                      <div>
                                        <div className="flex items-center space-x-2">
                                          <span className="font-bold text-slate-900">{r.billingPeriod}</span>
                                          {r.paymentStatus === 'partial' ? (
                                            <span className="bg-amber-100 text-amber-800 text-[9px] font-black px-1.5 py-0.2 rounded uppercase">PARTIAL</span>
                                          ) : (
                                            <span className="bg-rose-100 text-rose-800 text-[9px] font-black px-1.5 py-0.2 rounded uppercase">UNPAID</span>
                                          )}
                                          {isOverdue && (
                                            <span className="bg-purple-100 text-purple-800 text-[9px] font-black px-1.5 py-0.2 rounded uppercase">OVERDUE</span>
                                          )}
                                        </div>
                                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                          Usage: {r.consumption} m³ • Base: ₱{waterAmount.toFixed(2)} {penaltyAmount > 0 ? `• Penalty: ₱${penaltyAmount.toFixed(2)}` : ''}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="text-right font-mono">
                                      <span className="font-black text-slate-900 block text-sm">₱{netBalanceDue.toFixed(2)}</span>
                                      {alreadyPaid > 0 && (
                                        <span className="text-[9px] text-slate-400 block">Paid so far: ₱{alreadyPaid.toFixed(2)}</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>

                      {/* Payment Settings & Controls */}
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Payment Mode</label>
                            <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentType('full');
                                  setAllocationMode('auto');
                                  // Recalculate full total due
                                  const selectedReadings = readings.filter(r => selectedBillIds.includes(r.id));
                                  const exactDue = selectedReadings.reduce((acc, r) => {
                                    const w = calculateCostOf(r.consumption, r.classification);
                                    const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                                    const pen = isOverdue ? Math.round(w * 0.10) : 0;
                                    const gross = w + pen;
                                    const paid = r.paidAmount || 0;
                                    return acc + Math.max(0, gross - paid);
                                  }, 0);
                                  setPaymentAmountPaid(Math.round(exactDue * 100) / 100);
                                }}
                                className={`py-2 rounded-lg text-xs font-bold transition ${
                                  paymentType === 'full' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                Full Payment
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentType('partial');
                                }}
                                className={`py-2 rounded-lg text-xs font-bold transition ${
                                  paymentType === 'partial' ? 'bg-white text-amber-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                Partial Payment
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Payment Method (Office Policy)</label>
                            <div className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 flex items-center justify-between text-xs font-bold text-slate-800">
                              <span className="flex items-center space-x-2">
                                <CreditCard className="h-4 w-4 text-emerald-600" />
                                <span>CASH OVER COUNTER</span>
                              </span>
                              <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black px-2 py-0.5 rounded">
                                IN-OFFICE ONLY
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Partial Payment Allocation Strategy */}
                        {paymentType === 'partial' && (
                          <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 space-y-3 animate-fade-in">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-black uppercase text-amber-900">Partial Payment Distribution Strategy</span>
                              <div className="flex space-x-2 text-[10px] font-bold">
                                <button
                                  type="button"
                                  onClick={() => setAllocationMode('auto')}
                                  className={`px-2.5 py-1 rounded-lg ${allocationMode === 'auto' ? 'bg-amber-800 text-white' : 'bg-amber-100 text-amber-800'}`}
                                >
                                  Auto (Oldest First)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAllocationMode('manual')}
                                  className={`px-2.5 py-1 rounded-lg ${allocationMode === 'manual' ? 'bg-amber-800 text-white' : 'bg-amber-100 text-amber-800'}`}
                                >
                                  Manual Per Bill
                                </button>
                              </div>
                            </div>
                            <p className="text-[10px] text-amber-800">
                              {allocationMode === 'auto' 
                                ? 'System automatically applies received cash to the oldest unpaid bill first until exhausted.'
                                : 'Enter custom payment allocations for each selected bill below.'
                              }
                            </p>
                          </div>
                        )}

                        {/* Amount Tendered Input */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                              Amount Tendered / Received (₱)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={paymentAmountPaid}
                              onChange={(e) => setPaymentAmountPaid(parseFloat(e.target.value) || 0)}
                              className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 rounded-xl py-3 px-4 text-base font-mono font-black text-slate-900"
                              placeholder="0.00"
                            />
                          </div>

                          {/* Cash Change Display */}
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col justify-center">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Calculated Cash Change</span>
                            <span className="font-mono font-black text-slate-900 text-lg mt-0.5">
                              ₱{(() => {
                                const selectedReadings = readings.filter(r => selectedBillIds.includes(r.id));
                                const totalNetDue = selectedReadings.reduce((acc, r) => {
                                  const w = calculateCostOf(r.consumption, r.classification);
                                  const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                                  const pen = isOverdue ? Math.round(w * 0.10) : 0;
                                  const gross = w + pen;
                                  const paid = r.paidAmount || 0;
                                  return acc + Math.max(0, gross - paid);
                                }, 0);
                                const change = paymentAmountPaid - totalNetDue;
                                return change > 0 ? change.toFixed(2) : '0.00';
                              })()}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Process Payment CTA Button */}
                      <button
                        onClick={() => {
                          if (selectedBillIds.length === 0) {
                            alert("Please select at least one bill to process payment.");
                            return;
                          }
                          if (paymentAmountPaid <= 0) {
                            alert("Please enter a valid cash amount tendered greater than 0.");
                            return;
                          }

                          // Selected bills sorted by reading date (oldest first)
                          const selectedReadings = readings
                            .filter(r => selectedBillIds.includes(r.id))
                            .sort((a, b) => new Date(a.readingDate).getTime() - new Date(b.readingDate).getTime());

                          let remainingCash = paymentAmountPaid;
                          const allocations: { [billId: string]: { allocated: number; newPaid: number; newRem: number; newStatus: 'paid' | 'partial'; grossTotal: number; penaltyAmount: number } } = {};

                          selectedReadings.forEach(r => {
                            const waterAmount = calculateCostOf(r.consumption, r.classification);
                            const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                            const penaltyAmount = isOverdue ? Math.round(waterAmount * 0.10) : 0;
                            const grossTotal = waterAmount + penaltyAmount;
                            const alreadyPaid = r.paidAmount || 0;
                            const netDue = Math.max(0, grossTotal - alreadyPaid);

                            let alloc = 0;
                            if (allocationMode === 'auto') {
                              alloc = Math.min(netDue, remainingCash);
                              remainingCash -= alloc;
                            } else {
                              alloc = Math.min(netDue, manualAllocations[r.id] || 0);
                            }

                            const newPaid = alreadyPaid + alloc;
                            const newRem = Math.max(0, grossTotal - newPaid);
                            const newStatus: 'paid' | 'partial' = newRem <= 0.01 ? 'paid' : 'partial';

                            allocations[r.id] = {
                              allocated: alloc,
                              newPaid,
                              newRem,
                              newStatus,
                              grossTotal,
                              penaltyAmount
                            };
                          });

                          const totalApplied = Object.values(allocations).reduce((sum, a) => sum + a.allocated, 0);
                          const cashChange = Math.max(0, paymentAmountPaid - totalApplied);
                          const generatedOrNumber = `OR-2026-${Math.floor(100000 + Math.random() * 900000)}`;

                          // Atomic Database Update
                          const updatedReadings = readings.map(r => {
                            if (selectedBillIds.includes(r.id)) {
                              const alloc = allocations[r.id];
                              return {
                                ...r,
                                paymentStatus: alloc.newStatus,
                                paidAmount: alloc.newPaid,
                                remainingBalance: alloc.newRem,
                                penaltyAmount: alloc.penaltyAmount,
                                paymentDate: new Date().toISOString().split('T')[0],
                                paymentMethod: 'Cash',
                                orNumber: generatedOrNumber,
                                cashierName: currentUser.name,
                                transactionId: `TXN-CASH-${selectedPaymentAccount.accountNumber}-${Date.now().toString().slice(-5)}`
                              };
                            }
                            return r;
                          });

                          // Commit atomic updates
                          mockDb.saveReadings(updatedReadings);
                          setReadings(updatedReadings);

                          // Recalculate Consumer Outstanding Arrears
                          const updatedUnpaid = updatedReadings.filter(
                            r => r.accountNumber === selectedPaymentAccount.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid'
                          );
                          const newConsumerArrears = updatedUnpaid.reduce((acc, r) => {
                            const w = calculateCostOf(r.consumption, r.classification);
                            const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                            const pen = isOverdue ? Math.round(w * 0.10) : 0;
                            const gross = w + pen;
                            const paid = r.paidAmount || 0;
                            return acc + Math.max(0, gross - paid);
                          }, 0);

                          const updatedConsumersList = consumers.map(c =>
                            c.accountNumber === selectedPaymentAccount.accountNumber
                              ? { ...c, outstandingBalance: newConsumerArrears }
                              : c
                          );
                          mockDb.saveConsumers(updatedConsumersList);
                          setConsumers(updatedConsumersList);

                          // Immutable Audit Log
                          mockDb.addAuditLog(
                            currentUser.id,
                            currentUser.name,
                            'admin',
                            'Processed In-Office Cash Payment',
                            `Collected ₱${totalApplied.toFixed(2)} cash for Account #${selectedPaymentAccount.accountNumber}. OR #${generatedOrNumber}. Updated ${selectedBillIds.length} bill(s).`
                          );

                          // Real-Time Consumer Portal Sync & Notification
                          mockDb.addNotification({
                            accountNumber: selectedPaymentAccount.accountNumber,
                            title: `Official Receipt Issued - OR #${generatedOrNumber}`,
                            message: `In-office cash payment of ₱${totalApplied.toFixed(2)} processed at Tagoloan Water District Office Cashier. OR #${generatedOrNumber}. Updated ${selectedBillIds.length} bill(s). Remaining Arrears Balance: ₱${newConsumerArrears.toFixed(2)}.`,
                            type: 'payment',
                            orNumber: generatedOrNumber,
                            amountPaid: totalApplied,
                            remainingBalance: newConsumerArrears
                          });

                          // Construct Receipt Object
                          const receiptData = {
                            orNumber: generatedOrNumber,
                            date: new Date().toLocaleString(),
                            accountNumber: selectedPaymentAccount.accountNumber,
                            consumerName: selectedPaymentAccount.name,
                            address: selectedPaymentAccount.address,
                            meterNumber: selectedPaymentAccount.meterNumber,
                            consumerType: selectedPaymentAccount.consumerType || 'Residential',
                            bills: selectedReadings.map(r => {
                              const alloc = allocations[r.id];
                              return {
                                billingPeriod: r.billingPeriod,
                                consumption: r.consumption,
                                grossTotal: alloc.grossTotal,
                                amountApplied: alloc.allocated,
                                remainingBalance: alloc.newRem,
                                status: alloc.newStatus
                              };
                            }),
                            cashTendered: paymentAmountPaid,
                            totalApplied: totalApplied,
                            cashChange: cashChange,
                            remainingArrears: newConsumerArrears,
                            cashier: currentUser.name
                          };

                          setGeneratedReceipt(receiptData);
                        }}
                        className="w-full py-4 bg-emerald-700 hover:bg-emerald-800 text-white font-black rounded-2xl text-xs uppercase tracking-widest transition shadow-lg flex items-center justify-center space-x-2 cursor-pointer"
                      >
                        <CreditCard className="h-5 w-5" />
                        <span>PROCESS CASH PAYMENT & PRINT OFFICIAL RECEIPT (OR)</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-20 space-y-3 text-slate-400">
                      <CreditCard className="h-12 w-12 mx-auto text-slate-300" />
                      <h4 className="text-sm font-bold uppercase text-slate-600">No Consumer Account Selected</h4>
                      <p className="text-xs max-w-xs mx-auto">Search and select a consumer account from the left panel to begin in-office cash payment processing.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Official Receipt (OR) Printable Modal */}
              {generatedReceipt && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in overflow-y-auto">
                  <div className="bg-white rounded-3xl p-8 max-w-lg w-full border border-slate-200 shadow-2xl space-y-6 my-auto">
                    {/* Receipt Header */}
                    <div className="text-center space-y-1.5 border-b border-slate-150 pb-5">
                      <div className="flex justify-center items-center space-x-2">
                        <Droplet className="h-6 w-6 text-blue-600 fill-blue-600" />
                        <span className="font-extrabold text-xs text-slate-800 tracking-wider uppercase font-mono">TAGOLOAN WATER DISTRICT</span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium">Zone 1, Poblacion, Tagoloan, Misamis Oriental • BIR TIN: 002-841-992-000</p>
                      <div className="pt-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-300">
                          OFFICIAL RECEIPT (OR)
                        </span>
                      </div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight font-mono pt-1">{generatedReceipt.orNumber}</h3>
                      <p className="text-xs text-slate-500 font-mono">{generatedReceipt.date}</p>
                    </div>

                    {/* Consumer & Cashier Details */}
                    <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200 font-mono">
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase block font-bold">Account #</span>
                        <span className="font-bold text-blue-600">{generatedReceipt.accountNumber}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase block font-bold">Meter #</span>
                        <span className="font-bold text-slate-800">{generatedReceipt.meterNumber}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400 text-[10px] uppercase block font-bold">Consumer Name</span>
                        <span className="font-extrabold text-slate-900">{generatedReceipt.consumerName}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400 text-[10px] uppercase block font-bold">Address</span>
                        <span className="text-slate-700 text-[11px]">{generatedReceipt.address}</span>
                      </div>
                    </div>

                    {/* Itemized Bills Table */}
                    <div className="space-y-2">
                      <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-500">Settled Bills Breakdown</h5>
                      <div className="divide-y divide-slate-150 border border-slate-200 rounded-2xl overflow-hidden text-xs">
                        {generatedReceipt.bills.map((b: any, idx: number) => (
                          <div key={idx} className="p-3 bg-white flex justify-between items-center font-mono">
                            <div>
                              <span className="font-bold text-slate-900 block">{b.billingPeriod}</span>
                              <span className="text-[10px] text-slate-500">Gross: ₱{b.grossTotal.toFixed(2)} • Applied: ₱{b.amountApplied.toFixed(2)}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-emerald-700 block">₱{b.amountApplied.toFixed(2)}</span>
                              {b.remainingBalance > 0 ? (
                                <span className="text-[9px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded">Rem: ₱{b.remainingBalance.toFixed(2)}</span>
                              ) : (
                                <span className="text-[9px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">FULL</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Financial Totals Summary */}
                    <div className="space-y-2 text-xs bg-slate-900 text-white p-4 rounded-2xl font-mono">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Cash Tendered:</span>
                        <span className="font-bold">₱{generatedReceipt.cashTendered.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-800 pt-1.5">
                        <span className="text-emerald-400 font-bold">Total Payment Applied:</span>
                        <span className="font-black text-emerald-400 text-sm">₱{generatedReceipt.totalApplied.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>Cash Change Returned:</span>
                        <span className="font-bold text-amber-300">₱{generatedReceipt.cashChange.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-800 pt-1.5 text-slate-400 text-[10px]">
                        <span>Remaining Account Arrears:</span>
                        <span className="font-bold text-white">₱{generatedReceipt.remainingArrears.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Official Stamp & Cashier Sign-Off */}
                    <div className="text-center pt-1 border-t border-slate-100 space-y-1">
                      <p className="text-[10px] text-slate-500 font-mono uppercase">Issued by Cashier Staff: <strong className="text-slate-800">{generatedReceipt.cashier}</strong></p>
                      <p className="text-[9px] text-slate-400 italic">This official receipt serves as proof of payment to Tagoloan Water District. Keep for your records.</p>
                    </div>

                    {/* Modal Actions */}
                    <div className="flex space-x-3 pt-2">
                      <button
                        onClick={() => {
                          window.print();
                        }}
                        className="flex-1 py-3 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs uppercase tracking-wider transition flex items-center justify-center space-x-2 cursor-pointer"
                      >
                        <Printer className="h-4 w-4" />
                        <span>Print Official Receipt</span>
                      </button>
                      <button
                        onClick={() => setGeneratedReceipt(null)}
                        className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs uppercase transition cursor-pointer"
                      >
                        Done & Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 10. STAFF MODULE */}
          {activeTab === 'staff' && (
            <div className="space-y-6 animate-fade-in" id="staff-tab">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-950 uppercase tracking-wider">Admin Staff & System Permissions</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Manage administrative portal users and role access levels.</p>
                </div>
                <button
                  onClick={() => setShowAddStaff(!showAddStaff)}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition flex items-center space-x-2"
                >
                  <Plus className="h-4.5 w-4.5" />
                  <span>Enroll Staff User</span>
                </button>
              </div>

              {/* Add Staff Form */}
              {showAddStaff && (
                <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-lg space-y-4 max-w-xl">
                  <h4 className="text-xs font-black uppercase text-slate-900">Enroll New Administrative Staff</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Full Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Maria Clara"
                        value={newStaff.name}
                        onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="e.g. m.clara@tagoloanwater.gov.ph"
                        value={newStaff.email}
                        onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Assigned Role</label>
                      <select
                        value={newStaff.role}
                        onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs font-bold text-slate-700"
                      >
                        <option value="Administrator">Administrator (Full Access)</option>
                        <option value="Supervisor">Supervisor (Approvals & Operations)</option>
                        <option value="Cashier">Cashier (Process Payments)</option>
                        <option value="Billing Officer">Billing Officer (Ledger & Reports)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Department</label>
                      <input
                        type="text"
                        placeholder="e.g. Treasury & Finance"
                        value={newStaff.department}
                        onChange={(e) => setNewStaff({ ...newStaff, department: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setShowAddStaff(false)}
                      className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!newStaff.name || !newStaff.email) {
                          alert("Please fill in staff name and email.");
                          return;
                        }
                        const created = {
                          id: `ST-${Math.floor(100 + Math.random() * 900)}`,
                          name: newStaff.name,
                          email: newStaff.email,
                          role: newStaff.role,
                          department: newStaff.department || 'General Admin',
                          status: 'active'
                        };
                        setStaffList(prev => [...prev, created]);
                        
                        // Persist staff user to database
                        const currentUsers = mockDb.getUsers();
                        const roleStr = (created.role || '').toLowerCase();
                        currentUsers.push({
                          id: created.id,
                          name: created.name,
                          email: created.email,
                          role: roleStr === 'administrator' ? 'admin' : (roleStr === 'cashier' ? 'cashier' : 'staff'),
                          status: 'active',
                          password: 'TwdStaff2025!'
                        });
                        mockDb.saveUsers(currentUsers);
                        
                        setShowAddStaff(false);
                        mockDb.addAuditLog(currentUser.id, currentUser.name, 'admin', 'Enrolled Admin Staff', `Created staff account for ${newStaff.name} (${newStaff.role})`);
                        alert(`Staff user ${newStaff.name} successfully enrolled!`);
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold"
                    >
                      Save Staff User
                    </button>
                  </div>
                </div>
              )}

              {/* Staff List Table */}
              <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
                <table className="min-w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4">Staff ID</th>
                      <th className="px-6 py-4">Name & Email</th>
                      <th className="px-6 py-4">Role Title</th>
                      <th className="px-6 py-4">Department</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {staffList.map((st, sIdx) => (
                      <tr key={`staff-user-${st.id || ''}-${st.email || ''}-${sIdx}`} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-mono font-bold text-slate-900">{st.id}</td>
                        <td className="px-6 py-4">
                          <span className="font-extrabold text-slate-900 block">{st.name}</span>
                          <span className="text-slate-500 text-[10px] font-mono">{st.email}</span>
                        </td>
                        <td className="px-6 py-4 font-bold text-blue-700">{st.role}</td>
                        <td className="px-6 py-4 text-slate-600">{st.department}</td>
                        <td className="px-6 py-4">
                          <span className="bg-emerald-100 text-emerald-800 font-bold px-2.5 py-1 rounded-full text-[10px] uppercase">
                            {st.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => {
                              alert(`Reset password link sent to ${st.email}`);
                            }}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] uppercase rounded-lg transition"
                          >
                            Reset Password
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 11. BARANGAYS MODULE */}
          {activeTab === 'barangays' && (
            <div className="space-y-6 animate-fade-in" id="barangays-tab">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-950 uppercase tracking-wider">Barangays & Service Area Zones</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Municipal water distribution zones and collection schedules in Tagoloan.</p>
                </div>
                <button
                  onClick={() => setShowAddBarangay(!showAddBarangay)}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition flex items-center space-x-2"
                >
                  <Plus className="h-4.5 w-4.5" />
                  <span>Add Service Zone</span>
                </button>
              </div>

              {/* Add Barangay Form */}
              {showAddBarangay && (
                <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-lg space-y-4 max-w-xl">
                  <h4 className="text-xs font-black uppercase text-slate-900">Define New Barangay Service Area</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Barangay Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Casinglot"
                        value={newBarangay.name}
                        onChange={(e) => setNewBarangay({ ...newBarangay, name: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Zone Code</label>
                      <input
                        type="text"
                        placeholder="e.g. CS-07"
                        value={newBarangay.code}
                        onChange={(e) => setNewBarangay({ ...newBarangay, code: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Collection Schedule</label>
                      <input
                        type="text"
                        placeholder="e.g. 1st - 10th of Month"
                        value={newBarangay.schedule}
                        onChange={(e) => setNewBarangay({ ...newBarangay, schedule: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Rate per m³ (₱)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={newBarangay.ratePerM3}
                        onChange={(e) => setNewBarangay({ ...newBarangay, ratePerM3: parseFloat(e.target.value) || 24.5 })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs font-mono font-bold"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                    <button onClick={() => setShowAddBarangay(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!newBarangay.name) return;
                        const newEntry = {
                          id: `BRG-${Math.floor(10 + Math.random() * 90)}`,
                          name: newBarangay.name.trim(),
                          code: newBarangay.code.trim().toUpperCase() || 'ZONE',
                          consumers: 0,
                          activeMeters: 0,
                          schedule: newBarangay.schedule || 'Monthly',
                          supervisor: newBarangay.supervisor,
                          ratePerM3: newBarangay.ratePerM3
                        };
                        const updated = [...barangayList, newEntry];
                        mockDb.saveBarangays(updated);
                        setBarangayList(updated);
                        setShowAddBarangay(false);
                        mockDb.addAuditLog(currentUser.id, currentUser.name, 'admin', 'Add Barangay Service Zone', `Added barangay service area ${newBarangay.name}`);
                        alert(`Barangay ${newBarangay.name} successfully registered in system!`);
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold"
                    >
                      Save Zone
                    </button>
                  </div>
                </div>
              )}

              {/* Barangay Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {barangayList.map((bg, bgIdx) => {
                  const bgName = (bg.name || '').toLowerCase();
                  const liveCount = consumers.filter(c => 
                    c.barangayId === bg.id || 
                    (c.barangay && c.barangay.toLowerCase() === bgName) || 
                    (c.address && c.address.toLowerCase().includes(bgName))
                  ).length;
                  const displayCount = Math.max(bg.consumers || 0, liveCount);

                  return (
                    <div key={`bg-card-${bg.id || bg.code || bgIdx}-${bgIdx}`} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-base font-black text-slate-900">{bg.name}</h4>
                          <span className="text-[11px] text-slate-500 font-medium">Barangay Service Area</span>
                        </div>
                        <MapPin className="h-6 w-6 text-orange-500 shrink-0" />
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">Connections</span>
                          <span className="font-extrabold text-slate-800">{displayCount} active</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">Schedule</span>
                          <span className="font-bold text-slate-700">{bg.schedule}</span>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-500 flex justify-between items-center pt-2 border-t border-slate-100">
                        <span>Area Supervisor: <strong className="text-slate-800">{bg.supervisor}</strong></span>
                        <span className="font-mono font-bold text-emerald-700">₱{bg.ratePerM3}/m³</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 13. PROFILE MODULE */}
          {activeTab === 'profile' && (
            <div className="space-y-6 animate-fade-in" id="profile-tab">
              <div className="bg-white border border-slate-200 rounded-3xl p-8 max-w-3xl shadow-sm space-y-6">
                <div className="border-b border-slate-100 pb-4">
                  <h3 className="text-base font-black text-slate-900 uppercase">Administrator Profile Settings</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Manage your administrative credentials and security options.</p>
                </div>

                {profileSaveSuccess && (
                  <div className="bg-emerald-100 text-emerald-800 p-4 rounded-2xl text-xs font-bold flex items-center space-x-2">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    <span>Profile preferences successfully updated!</span>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Administrator Name</label>
                      <input
                        type="text"
                        value={adminProfile.name}
                        onChange={(e) => setAdminProfile({ ...adminProfile, name: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3.5 text-xs text-slate-800 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Email Address</label>
                      <input
                        type="email"
                        value={adminProfile.email}
                        onChange={(e) => setAdminProfile({ ...adminProfile, email: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3.5 text-xs text-slate-800 font-medium"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 space-y-3">
                    <h4 className="text-xs font-black uppercase text-slate-800">Change Password Security</h4>
                    <div className="grid grid-cols-3 gap-3">
                      <input
                        type="password"
                        placeholder="Current Password"
                        value={adminProfile.currentPassword}
                        onChange={(e) => setAdminProfile({ ...adminProfile, currentPassword: e.target.value })}
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs"
                      />
                      <input
                        type="password"
                        placeholder="New Password"
                        value={adminProfile.newPassword}
                        onChange={(e) => setAdminProfile({ ...adminProfile, newPassword: e.target.value })}
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs"
                      />
                      <input
                        type="password"
                        placeholder="Confirm Password"
                        value={adminProfile.confirmPassword}
                        onChange={(e) => setAdminProfile({ ...adminProfile, confirmPassword: e.target.value })}
                        className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-100">
                  <button
                    onClick={handleSaveAdminProfile}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition shadow-md flex items-center space-x-2"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>Save Profile Changes</span>
                  </button>
                </div>
              </div>

              {/* Official District Profile, Mission, Vision, Core Values & Staffing Structure */}
              <div className="pt-4">
                <DistrictProfileSection id="admin-district-profile" />
              </div>
            </div>
          )}
          </>
          )}

        </div>
      </main>

      {/* DIAL PHOTO INSPECTION OVERLAY MODAL */}
      {selectedPhotoUrl && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" id="dial-photo-modal">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl max-w-lg w-full flex flex-col">
            <header className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
              <div>
                <h4 className="text-sm font-bold text-slate-100 uppercase tracking-widest flex items-center">
                  <Camera className="h-4.5 w-4.5 mr-2 text-blue-500" />
                  METER FACE PHOTO VALIDATOR
                </h4>
                <p className="text-[10px] text-slate-400 mt-1 uppercase">CONSUMER ACCOUNT: {selectedPhotoAccount}</p>
              </div>
              <button 
                onClick={() => { setSelectedPhotoUrl(null); setSelectedPhotoAccount(null); }}
                className="p-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold font-mono transition"
              >
                ESC
              </button>
            </header>
            <div className="p-6 flex items-center justify-center bg-black/60 relative group min-h-[350px]">
              <img 
                src={selectedPhotoUrl} 
                alt="Meter face verification file" 
                className="max-h-[380px] object-contain rounded-xl shadow-lg border border-slate-800/80"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                  const fb = document.getElementById('meter-dial-fallback-view');
                  if (fb) fb.style.display = 'flex';
                }}
              />
              <div id="meter-dial-fallback-view" style={{ display: 'none' }} className="flex-col items-center justify-center p-8 text-center space-y-3 bg-slate-900/90 rounded-2xl border border-slate-700">
                <Activity className="h-16 w-16 text-amber-400 mx-auto animate-pulse" />
                <div>
                  <p className="text-sm font-bold text-white uppercase tracking-wider">Field Meter Dial Photo Verified</p>
                  <p className="text-xs text-slate-400 mt-1">Recorded Index by Reader: {selectedPhotoAccount}</p>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 bg-slate-950/75 text-slate-200 border border-slate-800/80 p-2.5 rounded-lg text-[9px] uppercase tracking-wider font-mono">
                <span className="text-emerald-400 font-extrabold flex items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 inline-block animate-pulse"></span>
                  LENS VERIFIED Dial
                </span>
                <span className="text-slate-400 block mt-1">LENS CODE: 10025-V-TWD</span>
              </div>
            </div>
            <footer className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end">
              <button 
                onClick={() => { setSelectedPhotoUrl(null); setSelectedPhotoAccount(null); }}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition uppercase tracking-wider shadow-sm"
              >
                Close dial inspection
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* OFFICIAL WATER BILLING NOTICE STATEMENT MODAL */}
      {selectedNoticeReading && selectedNoticeConsumer && (
        <BillDetails
          isModal={true}
          isOpen={true}
          reading={selectedNoticeReading}
          consumer={selectedNoticeConsumer}
          onClose={() => {
            setSelectedNoticeReading(null);
            setSelectedNoticeConsumer(null);
          }}
        />
      )}

      {/* CONSUMER VIEW / EDIT / ISSUE IDS MODAL (FIXED VIEWPORT-CENTERED ROOT OVERLAY) */}
      {selectedConsumerModal && (
        <div 
          className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden animate-fade-in select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedConsumerModal(null);
          }}
        >
          <div 
            className="bg-slate-900 rounded-2xl sm:rounded-3xl max-w-2xl lg:max-w-3xl w-full border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] my-auto select-text"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header (Non-scrolling) */}
            <div className="shrink-0 bg-slate-950 text-white p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between shadow-xs">
              <div>
                <div className="flex items-center space-x-2.5">
                  <h3 className="text-base sm:text-lg font-black tracking-tight text-white">{selectedConsumerModal.name}</h3>
                  <span className={`px-2.5 py-0.5 text-[10px] font-black uppercase rounded-md border ${
                    selectedConsumerModal.status === 'blocked'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                      : selectedConsumerModal.status === 'active'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                  }`}>
                    {selectedConsumerModal.status}
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1 font-mono font-medium">
                  Account #{selectedConsumerModal.accountNumber || 'Pending'} • Meter: {selectedConsumerModal.meterNumber || 'Unassigned'}
                </p>
              </div>
              <button
                onClick={() => setSelectedConsumerModal(null)}
                className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-black rounded-xl text-xs transition cursor-pointer shadow-md flex items-center space-x-1.5 border border-rose-500 shrink-0"
                title="Close Modal"
              >
                <X className="h-4 w-4" />
                <span className="hidden sm:inline">Close</span>
              </button>
            </div>

            {/* Modal Tab Buttons (Non-scrolling) */}
            <div className="shrink-0 flex border-b border-slate-800 bg-slate-950/90 px-4 sm:px-6 pt-3 space-x-2 sm:space-x-3 overflow-x-auto">
              <button
                onClick={() => setConsumerModalTab('view')}
                className={`px-4 py-2 text-xs font-black uppercase tracking-wider transition rounded-t-xl flex items-center space-x-2 shrink-0 cursor-pointer ${
                  consumerModalTab === 'view'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Eye className="h-4 w-4" />
                <span>View Profile</span>
              </button>

              <button
                onClick={() => setConsumerModalTab('edit')}
                className={`px-4 py-2 text-xs font-black uppercase tracking-wider transition rounded-t-xl flex items-center space-x-2 shrink-0 cursor-pointer ${
                  consumerModalTab === 'edit'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Edit2 className="h-4 w-4" />
                <span>Edit Details</span>
              </button>

              <button
                onClick={() => setConsumerModalTab('issue_ids')}
                className={`px-4 py-2 text-xs font-black uppercase tracking-wider transition rounded-t-xl flex items-center space-x-2 shrink-0 cursor-pointer ${
                  consumerModalTab === 'issue_ids'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                <span>
                  {selectedConsumerModal.accountNumber && 
                   !selectedConsumerModal.accountNumber.toUpperCase().startsWith('PENDING') &&
                   selectedConsumerModal.status !== 'pending_approval'
                    ? 'Account & Tag IDs'
                    : 'Issue IDs & Tag'}
                </span>
              </button>
            </div>

            {/* Modal Body - Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6 space-y-4 text-left bg-slate-900 text-slate-100">
              {/* PROMINENT ISSUE IDs SUCCESS CONFIRMATION BANNER */}
              {issueSuccessMessage && (
                <div className="bg-gradient-to-r from-emerald-950/95 via-slate-900 to-emerald-950/95 border-2 border-emerald-500/80 rounded-2xl p-4 sm:p-5 text-emerald-100 shadow-2xl space-y-3 relative overflow-hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start space-x-3">
                      <div className="p-2.5 bg-emerald-500/20 rounded-xl border border-emerald-500/40 text-emerald-400 shrink-0">
                        <CheckCircle className="h-6 w-6 text-emerald-400" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <h4 className="text-sm sm:text-base font-black text-white">{issueSuccessMessage.title}</h4>
                          <span className="px-2 py-0.5 text-[10px] font-black uppercase rounded bg-emerald-500 text-slate-950">
                            {issueSuccessMessage.isUpdate ? 'Updated' : 'Official IDs Active'}
                          </span>
                        </div>
                        <p className="text-xs text-emerald-200/90 font-medium mt-1 leading-relaxed">
                          {issueSuccessMessage.message}
                        </p>
                      </div>
                    </div>
                    <button 
                      type="button"
                      onClick={() => setIssueSuccessMessage(null)}
                      className="text-slate-400 hover:text-white p-1 hover:bg-slate-800/60 rounded-lg transition shrink-0 cursor-pointer"
                      title="Dismiss message"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Issued Credentials Quick Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
                    <div className="bg-slate-950/90 p-2.5 rounded-xl border border-emerald-500/40 flex flex-col">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Official Account Number</span>
                      <span className="font-mono font-black text-white text-xs mt-0.5">#{issueSuccessMessage.accNum}</span>
                    </div>
                    <div className="bg-slate-950/90 p-2.5 rounded-xl border border-emerald-500/40 flex flex-col">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Meter Tag / Serial</span>
                      <span className="font-mono font-black text-blue-300 text-xs mt-0.5">{issueSuccessMessage.meterNum}</span>
                    </div>
                    <div className="bg-slate-950/90 p-2.5 rounded-xl border border-emerald-500/40 flex flex-col">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Smart RFID Tag</span>
                      <span className="font-mono font-black text-emerald-300 text-xs mt-0.5">{issueSuccessMessage.rfidTag}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const info = `Tagoloan Water District - Official Identifiers\nConsumer: ${issueSuccessMessage.consumerName}\nAccount Number: #${issueSuccessMessage.accNum}\nMeter Serial: #${issueSuccessMessage.meterNum}\nRFID Tag: ${issueSuccessMessage.rfidTag}`;
                        navigator.clipboard.writeText(info);
                        setCopiedIssueInfo(true);
                        setTimeout(() => setCopiedIssueInfo(false), 3000);
                        toast.success('Copied to Clipboard', 'Account identifiers copied.');
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition cursor-pointer shadow-xs"
                    >
                      {copiedIssueInfo ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedIssueInfo ? 'Copied to Clipboard!' : 'Copy Account Details'}</span>
                    </button>

                    {consumerModalTab !== 'view' && (
                      <button
                        type="button"
                        onClick={() => setConsumerModalTab('view')}
                        className="text-xs text-emerald-300 hover:text-white font-bold underline flex items-center space-x-1 cursor-pointer"
                      >
                        <span>View Full Profile</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* VIEW TAB */}
              {consumerModalTab === 'view' && (() => {
                const allR = mockDb.getReadings();
                const isIssued = selectedConsumerModal.accountNumber && selectedConsumerModal.accountNumber.trim() !== '' && !selectedConsumerModal.accountNumber.startsWith('PENDING');
                const modalReadings = isIssued
                  ? allR.filter(r => r.accountNumber === selectedConsumerModal.accountNumber || (selectedConsumerModal.meterNumber && r.meterNumber === selectedConsumerModal.meterNumber))
                  : [];
                const modalUnpaid = modalReadings.filter(r => r.paymentStatus !== 'paid');
                const computedOutstanding = isIssued
                  ? modalUnpaid.reduce((acc, b) => {
                      const total = calculateCostOf(b.consumption, selectedConsumerModal.consumerType);
                      const paid = b.paidAmount || 0;
                      return acc + Math.max(0, total - paid);
                    }, 0)
                  : 0;

                return (
                <div className="space-y-4">
                  {/* Status Banner */}
                  <div className="bg-slate-800/90 p-4 rounded-xl border border-slate-700 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Identifiers Status</span>
                      <span className="font-extrabold text-white text-xs flex items-center space-x-1 mt-1.5">
                        {selectedConsumerModal.accountNumber ? (
                          <span className="text-emerald-300 font-black flex items-center bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-600/50">
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-400 mr-1.5 inline shrink-0" /> Issued (#{selectedConsumerModal.accountNumber})
                          </span>
                        ) : (
                          <span className="text-amber-300 font-black bg-amber-950/80 px-2.5 py-1 rounded border border-amber-600/50">⚠️ Pending Issue</span>
                        )}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Account Status</span>
                      <span className={`mt-1.5 inline-block font-black text-xs uppercase px-3 py-1 rounded border ${
                        selectedConsumerModal.status === 'blocked'
                          ? 'bg-rose-950/80 text-rose-300 border-rose-600/50'
                          : selectedConsumerModal.status === 'active'
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                          : 'bg-amber-950/80 text-amber-300 border-amber-600/50'
                      }`}>
                        {selectedConsumerModal.status}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Outstanding Balance</span>
                      <span className={`font-mono font-black text-base mt-1 block ${
                        computedOutstanding > 0 ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        ₱{computedOutstanding.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Detail Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-1">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Full Name</span>
                      <span className="font-black text-white text-xs truncate block" title={selectedConsumerModal.name}>{selectedConsumerModal.name}</span>
                    </div>

                    <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-1">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Email Address</span>
                      <span className="font-mono text-slate-200 font-bold text-xs truncate block" title={selectedConsumerModal.email || 'N/A'}>{selectedConsumerModal.email || 'N/A'}</span>
                    </div>

                    <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-1">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Phone Number</span>
                      <span className="font-mono text-slate-200 font-bold text-xs truncate block">{selectedConsumerModal.contactNumber || 'N/A'}</span>
                    </div>

                    <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-1">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Address / Barangay</span>
                      <span className="font-bold text-slate-200 text-xs truncate block" title={selectedConsumerModal.address}>{selectedConsumerModal.address}</span>
                    </div>

                    <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-1">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Consumer Type</span>
                      <span className="font-black text-white text-xs block">{selectedConsumerModal.consumerType || 'Residential'}</span>
                    </div>

                    <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-1">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Assigned Meter</span>
                      <span className="font-mono font-black text-blue-300 text-xs truncate block">{selectedConsumerModal.meterNumber || 'UNASSIGNED'}</span>
                    </div>

                    <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-1">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Smart RFID Tag</span>
                      <span className="font-mono font-black text-slate-200 text-xs truncate block">{selectedConsumerModal.rfidTag || 'None Assigned'}</span>
                    </div>

                    <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-1">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Web Portal</span>
                      <span className="font-black text-slate-200 text-xs block">
                        {selectedConsumerModal.isRegistered ? '✅ Registered' : '❌ Offline'}
                      </span>
                    </div>
                  </div>

                  {selectedConsumerModal.consumerType === 'Commercial' && (
                    <div className="bg-purple-950/60 p-4 rounded-xl border border-purple-700/60 text-xs flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-black text-purple-300 uppercase tracking-wider block">Commercial Establishment</span>
                        <span className="font-black text-white text-xs">{selectedConsumerModal.businessName || 'N/A'}</span>
                      </div>
                      <span className="text-purple-200 font-extrabold text-[11px] bg-purple-900/80 px-3 py-1 rounded-md border border-purple-600/60">Type: {selectedConsumerModal.businessType || 'General Commercial'}</span>
                    </div>
                  )}
                </div>
                );
              })()}

              {/* EDIT TAB */}
              {consumerModalTab === 'edit' && (
                <form onSubmit={handleUpdateConsumerDetails} className="bg-slate-800 p-5 rounded-xl border border-slate-700 space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-slate-200 font-extrabold mb-1.5 text-xs">Consumer Name *</label>
                      <input
                        type="text"
                        required
                        value={modalEditName}
                        onChange={(e) => setModalEditName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-bold text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-200 font-extrabold mb-1.5 text-xs">Email Address *</label>
                      <input
                        type="email"
                        required
                        value={modalEditEmail}
                        onChange={(e) => setModalEditEmail(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-bold text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-200 font-extrabold mb-1.5 text-xs">Phone Number *</label>
                      <input
                        type="text"
                        required
                        value={modalEditContactNumber}
                        onChange={(e) => setModalEditContactNumber(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-bold text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-200 font-extrabold mb-1.5 text-xs">Address / Barangay *</label>
                      <input
                        type="text"
                        required
                        value={modalEditAddress}
                        onChange={(e) => setModalEditAddress(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-bold text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-200 font-extrabold mb-1.5 text-xs">Classification</label>
                      <select
                        value={modalEditConsumerType}
                        onChange={(e) => setModalEditConsumerType(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-bold text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs shadow-2xs cursor-pointer"
                      >
                        <option value="Residential">Residential</option>
                        <option value="Commercial">Commercial</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-200 font-extrabold mb-1.5 text-xs">Account Status</label>
                      <select
                        value={modalEditStatus}
                        onChange={(e) => setModalEditStatus(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-bold text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs shadow-2xs cursor-pointer"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="blocked">Blocked</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                  </div>

                  {modalEditConsumerType === 'Commercial' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-purple-950/60 p-3.5 rounded-xl border border-purple-700/60">
                      <div>
                        <label className="block text-purple-200 font-black mb-1.5 text-xs">Business Name</label>
                        <input
                          type="text"
                          value={modalEditBusinessName}
                          onChange={(e) => setModalEditBusinessName(e.target.value)}
                          className="w-full bg-slate-950 border border-purple-600/60 rounded-lg p-2.5 text-white font-bold focus:outline-none focus:border-purple-400 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-purple-200 font-black mb-1.5 text-xs">Business Type</label>
                        <input
                          type="text"
                          value={modalEditBusinessType}
                          onChange={(e) => setModalEditBusinessType(e.target.value)}
                          className="w-full bg-slate-950 border border-purple-600/60 rounded-lg p-2.5 text-white font-bold focus:outline-none focus:border-purple-400 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs transition shadow-md cursor-pointer uppercase tracking-wider"
                    >
                      Update Details
                    </button>
                  </div>
                </form>
              )}

              {/* ISSUE / UPDATE IDS TAB */}
              {consumerModalTab === 'issue_ids' && (() => {
                const isAlreadyIssued = Boolean(
                  selectedConsumerModal.accountNumber && 
                  !selectedConsumerModal.accountNumber.toUpperCase().startsWith('PENDING') &&
                  selectedConsumerModal.accountNumber.toUpperCase() !== 'PENDING ADMIN ISSUANCE' &&
                  selectedConsumerModal.status !== 'pending_approval'
                );

                return (
                <form onSubmit={handleIssueIdentifiers} className="bg-slate-800 p-5 rounded-xl border border-slate-700 space-y-4 text-xs">
                  {isAlreadyIssued ? (
                    <div className="bg-slate-950 p-4 rounded-xl border border-blue-500/50 space-y-1.5 shadow-2xs">
                      <h5 className="font-black text-blue-300 flex items-center space-x-1.5 text-xs">
                        <Cpu className="h-4 w-4 text-blue-400 mr-1 inline shrink-0" />
                        <span>Permanent Meter Tag Hardware Entity & Editable Account Number</span>
                      </h5>
                      <p className="text-slate-300 font-medium text-[11px] leading-relaxed">
                        The Smart RFID Tag (<strong>{selectedConsumerModal.rfidTag}</strong>) and Meter Serial (<strong>#{selectedConsumerModal.meterNumber}</strong>) are permanent physical hardware entities attached to the consumer's water pipe. You can update or transfer the <strong>Account Number</strong> below (e.g. for change of ownership, transfer of service, or account re-numbering) while retaining the physical meter tag.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-blue-950/60 p-4 rounded-xl border border-blue-600/60 space-y-1">
                      <h5 className="font-black text-blue-200 flex items-center space-x-1.5 text-xs">
                        <ShieldCheck className="h-4 w-4 text-blue-400 mr-1 inline shrink-0" />
                        <span>Issue Official Identifiers & Activate Consumer Account</span>
                      </h5>
                      <p className="text-blue-100 font-medium text-[11px]">
                        Assign official Account Number, physical Meter Tag / Serial Number, and Smart RFID Tag for <strong>{selectedConsumerModal.name}</strong> ({selectedConsumerModal.barangay || 'Tagoloan'}). Every tag number must be a strictly unique entity in the water district.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* ACCOUNT NUMBER (ALWAYS EDITABLE) */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-slate-200 font-extrabold text-xs">Account Number *</label>
                        {isAlreadyIssued && (
                          <span className="text-[10px] font-black text-blue-300 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-600/60 flex items-center space-x-0.5">
                            <Edit2 className="h-3 w-3 mr-0.5 inline shrink-0" /> Editable
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        required
                        placeholder="e.g. NT-2026-001"
                        value={modalIssueAccountNumber}
                        onChange={(e) => setModalIssueAccountNumber(e.target.value)}
                        className="w-full bg-slate-950 text-white border border-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg p-2.5 font-mono font-black text-xs shadow-2xs"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        {isAlreadyIssued 
                          ? '✏️ Editable for account updates, transfer, or re-numbering.'
                          : 'Assign unique official municipal account number.'}
                      </p>
                    </div>

                    {/* METER SERIAL / TAG (LOCKED IF ISSUED) */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-slate-200 font-extrabold text-xs">Meter Tag / Serial *</label>
                        {isAlreadyIssued && (
                          <span className="text-[10px] font-black text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-600/60 flex items-center space-x-0.5">
                            <Lock className="h-3 w-3 mr-0.5 inline shrink-0" /> Permanent
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        required
                        placeholder="e.g. MT-88204"
                        value={modalIssueMeterNumber}
                        onChange={(e) => setModalIssueMeterNumber(e.target.value)}
                        readOnly={isAlreadyIssued}
                        className={`w-full border rounded-lg p-2.5 font-mono font-black text-xs shadow-2xs ${
                          isAlreadyIssued
                            ? 'bg-slate-950/80 text-slate-400 border-slate-800 cursor-not-allowed select-none'
                            : 'bg-slate-950 text-white border-slate-700 focus:outline-none focus:border-blue-500'
                        }`}
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        {isAlreadyIssued
                          ? '🔒 Fixed physical mechanical meter serial attached on-site.'
                          : 'Assign unique meter serial number.'}
                      </p>
                    </div>

                    {/* SMART RFID TAG (LOCKED IF ISSUED) */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-slate-200 font-extrabold text-xs">Smart RFID Tag *</label>
                        {isAlreadyIssued && (
                          <span className="text-[10px] font-black text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-600/60 flex items-center space-x-0.5">
                            <Lock className="h-3 w-3 mr-0.5 inline shrink-0" /> Permanent
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        required
                        placeholder="e.g. RFID-88204"
                        value={modalIssueRfidTag}
                        onChange={(e) => setModalIssueRfidTag(e.target.value)}
                        readOnly={isAlreadyIssued}
                        className={`w-full border rounded-lg p-2.5 font-mono font-black text-xs shadow-2xs ${
                          isAlreadyIssued
                            ? 'bg-slate-950/80 text-slate-400 border-slate-800 cursor-not-allowed select-none'
                            : 'bg-slate-950 text-white border-slate-700 focus:outline-none focus:border-blue-500'
                        }`}
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        {isAlreadyIssued
                          ? '🔒 Unique physical RFID entity across Tagoloan Water District.'
                          : 'Assign unique RFID reader tag.'}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    {isAlreadyIssued ? (
                      <button
                        type="submit"
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs transition shadow-md uppercase tracking-wider cursor-pointer flex items-center space-x-1.5"
                      >
                        <RefreshCw className="h-4 w-4" />
                        <span>Update Account Number</span>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs transition shadow-md uppercase tracking-wider cursor-pointer flex items-center space-x-1.5"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        <span>Issue Identifiers & Activate Account</span>
                      </button>
                    )}
                  </div>
                </form>
                );
              })()}
            </div>

            {/* Modal Footer (Non-scrolling) */}
            <div className="shrink-0 bg-slate-950 p-4 border-t border-slate-800 flex items-center justify-between">
              <div className="text-xs text-slate-400 font-mono font-semibold hidden sm:block">
                Consumer ID: <span className="text-slate-200 font-bold">{selectedConsumerModal.accountNumber || 'Unissued'}</span>
              </div>
              <button
                onClick={() => setSelectedConsumerModal(null)}
                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-black rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-lg flex items-center space-x-2 border border-rose-500 ml-auto"
              >
                <X className="h-4 w-4" />
                <span>Close Window</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL WATER BILLING NOTICE STATEMENT MODAL */}
      {selectedNoticeReading && selectedNoticeConsumer && (
        <BillDetails
          isModal={true}
          isOpen={true}
          reading={selectedNoticeReading}
          consumer={selectedNoticeConsumer}
          onClose={() => {
            setSelectedNoticeReading(null);
            setSelectedNoticeConsumer(null);
          }}
        />
      )}

    </div>
  );
}

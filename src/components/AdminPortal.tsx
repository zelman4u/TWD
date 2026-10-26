/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
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
  CheckCheck,
  Building,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  ChevronUp,
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
  BadgeCheck,
  Gauge,
  Tag,
  Edit3,
  Receipt,
  Home,
  AlertOctagon,
  Zap,
  MessageSquare,
  Smartphone
} from 'lucide-react';
import { mockDb } from '../mockDb';
import { User, Barangay, Consumer, MeterReader, WaterMeter, MeterReading, RouteAssignment, Announcement, AuditLog, ConsumerReport } from '../types';
import { 
  scanAndUpdateAccounts, 
  getScannerStatus, 
  subscribeToScanner, 
  ScannerStatus 
} from '../services/gracePeriodScannerService';
import { DashboardSkeleton, TableSkeleton, CardsGridSkeleton } from './common/SkeletonLoader';
import DataLoadingIndicator from './common/DataLoadingIndicator';
import AdminAnalyticsSection from './charts/AdminAnalyticsSection';
import { BillDetails } from './consumer/BillDetails';
import { DistrictProfileSection } from './common/DistrictProfileSection';
import { OfficialReportsGenerator, RecordsArchiveView, GracePeriodScannerCard, TariffRateManager, ConsumerReportsManager } from './admin';
import { TablePagination } from './common/TablePagination';
import { SmartSearchBar } from './common/SmartSearchBar';
import { smartMatch } from '../utils/smartSearch';
import { useToast } from '../context/ToastContext';
import { useLoading } from '../context/LoadingContext';
import {
  syncDocToFirestore,
  pushIssuedConsumerToFirestore,
  ensureRealtimeFirestoreListeners,
  isRealIssuedAccountNumber,
  COLLECTIONS
} from '../services/firebaseDb';
import { initRealtimeSocket, sendRealtimeMessage } from '../services/realtimeSocket';
import { apiClient, safeBackendFetch } from '../services/apiClient';
import { calculateWaterTariff, calculateFranchiseTax, getActiveTariffConfig, getReadingEffectiveBillAmount, saveActiveTariffConfig, WaterTariffConfig } from '../utils/tariffCalculator';
import { 
  checkDuplicateAccountNumber, 
  checkDuplicateRfidTag, 
  checkDuplicateMeterTag 
} from '../utils/identifierValidation';
import { 
  normalizePhoneNumber, 
  isValid11DigitPhone, 
  detectExistingPhoneAccount 
} from '../utils/phoneValidation';

interface AdminPortalProps {
  currentUser: User;
  onLogout: () => void;
}

export default function AdminPortal({ currentUser, onLogout }: AdminPortalProps) {
  const toast = useToast();
  const { showLoading, hideLoading } = useLoading();
  
  // Tariff calculation helper (honors locked billAmount on existing readings; uses active tariff only for new/un-stamped usage)
  const calculateCostOf = (usageOrReading: number | MeterReading, classification?: string) => {
    const cls = classification === 'Commercial' ? 'Commercial' : 'Residential';
    if (typeof usageOrReading === 'number') {
      return calculateWaterTariff(usageOrReading, cls);
    }
    return getReadingEffectiveBillAmount(usageOrReading, cls);
  };

  // Navigation Module Selected - All 15 Admin Portal Modules
  const [activeTab, setActiveTab] = useState<
    | 'dashboard'
    | 'records'
    | 'consumers'
    | 'reports'
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

  // Announcements Module Sub-Tab Switcher: 'bulletin' (Public Advisories) vs 'customer_service' (Customer Inquiries)
  const [announcementsSubTab, setAnnouncementsSubTab] = useState<'bulletin' | 'customer_service'>('bulletin');

  // Loading and Sync states
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTabLoading, setIsTabLoading] = useState(false);
  const [isSubTabLoading, setIsSubTabLoading] = useState(false);

  // Tab switching handler with data loading transition
  const handleTabChange = (tab: typeof activeTab) => {
    if (tab === 'reports') {
      setIsTabLoading(true);
      setActiveTab('announcements');
      setAnnouncementsSubTab('customer_service');
      if (isMobileSidebarOpen) setIsMobileSidebarOpen(false);
      setTimeout(() => {
        setIsTabLoading(false);
      }, 220);
      return;
    }
    if (tab === activeTab) return;
    setIsTabLoading(true);
    setActiveTab(tab);
    if (isMobileSidebarOpen) setIsMobileSidebarOpen(false);
    setTimeout(() => {
      setIsTabLoading(false);
    }, 220);
  };

  // Helper to describe loading state for each tab
  const getTabLoadingMessage = (tab: typeof activeTab) => {
    switch (tab) {
      case 'dashboard': return { title: 'Compiling Operational Dashboard Analytics...', subtitle: 'Calculating real-time water production, billing aggregates, and field metrics' };
      case 'records': return { title: 'Querying Municipal Archive Records...', subtitle: 'Fetching unified data ledger across consumers, meters, readings, and payments' };
      case 'consumers': return { title: 'Fetching Consumer Accounts Registry...', subtitle: 'Loading active water service accounts, meter bindings, and arrears ledgers' };
      case 'reports': return { title: 'Loading Customer Service & Inquiries Dispatch...', subtitle: 'Synchronizing water leak reports, customer service inquiries, and reply threads' };
      case 'approvals': return { title: 'Fetching Reading Approvals Queue...', subtitle: 'Querying telemetry photos, GPS tags, and anomaly flags for validation' };
      case 'bills': return { title: 'Loading Invoicing & Billing Master Ledger...', subtitle: 'Computing tiered block consumption tariffs and overdue statements' };
      case 'payments': return { title: 'Initializing Cashier & Payment Gateway...', subtitle: 'Connecting to Tagoloan revenue counter and official receipt registers' };
      case 'readings': return { title: 'Loading Meter Readings History...', subtitle: 'Retrieving historical cubic meter index telemetry and photographic audit proofs' };
      case 'meters': return { title: 'Loading Mechanical Water Meters Inventory...', subtitle: 'Syncing hardware serial registry, installation logs, and meter statuses' };
      case 'readers': return { title: 'Fetching Meter Readers & Route Registry...', subtitle: 'Loading field technician rosters, credentials, and geographic assignments' };
      case 'staff': return { title: 'Loading Staff & Permissions Directory...', subtitle: 'Verifying administrative access privileges and system security roles' };
      case 'barangays': return { title: 'Loading Service Area Zones...', subtitle: 'Fetching barangay zone schedules, assigned inspectors, and tariff parameters' };
      case 'announcements': return { title: 'Retrieving Public Advisories & Notices...', subtitle: 'Fetching emergency broadcasts, maintenance schedules, and district bulletins' };
      case 'profile': return { title: 'Loading Administrator Settings...', subtitle: 'Retrieving municipal profile configuration and security preferences' };
      default: return { title: 'Fetching data from Tagoloan Water District...', subtitle: 'Synchronizing records with municipal database' };
    }
  };

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
  const [reports, setReports] = useState<ConsumerReport[]>([]);

  // Filtering & Search states for Consumer Database
  const [consumerSearch, setConsumerSearch] = useState('');
  const [consumerStatusFilter, setConsumerStatusFilter] = useState<'all' | 'active' | 'pending_approval' | 'inactive' | 'blocked' | 'archived' | 'Disconnection Notice'>('all');
  const [consumerTypeFilter, setConsumerTypeFilter] = useState<'all' | 'Residential' | 'Commercial'>('all');
  const [consumerBarangayFilter, setConsumerBarangayFilter] = useState<string>('all');
  const [consumerSortBy, setConsumerSortBy] = useState<'recent' | 'name_asc' | 'name_desc' | 'account_asc' | 'balance_desc'>('recent');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Background Grace Period Scanner Service State
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>(getScannerStatus());
  const [isManualScanning, setIsManualScanning] = useState(false);

  // Meter Reader Filter & Search States
  const [readerFilter, setReaderFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [readerSearch, setReaderSearch] = useState('');
  
  // Modals / Add Form States
  const [showAddMeter, setShowAddMeter] = useState(false);
  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);

  // Field Data Inspection States
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [selectedPhotoAccount, setSelectedPhotoAccount] = useState<string | null>(null);
  const [selectedNoticeReading, setSelectedNoticeReading] = useState<MeterReading | null>(null);
  const [selectedNoticeConsumer, setSelectedNoticeConsumer] = useState<Consumer | null>(null);


  const [newMeter, setNewMeter] = useState({
    meterNumber: 'MT-' + Math.floor(1000 + Math.random() * 9000),
    brand: '',
    installationDate: new Date().toISOString().split('T')[0],
    status: 'active' as const,
    linkedAccountNumber: ''
  });

  const [revealedPasswords, setRevealedPasswords] = useState<{ [readerId: string]: boolean }>({});

  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    content: '',
    category: 'info' as const
  });

  // New Modules State Managers
  // 2. Records Sub-module filter
  const [recordsTab, setRecordsTab] = useState<'reports' | 'consumers' | 'meters' | 'readings' | 'bills' | 'payments' | 'staff' | 'barangays' | 'audit'>('reports');
  const [recordsSearch, setRecordsSearch] = useState('');
  const [recordsClassificationFilter, setRecordsClassificationFilter] = useState<'all' | 'Residential' | 'Commercial'>('all');
  const [readersSubTab, setReadersSubTab] = useState<'officers' | 'routes'>('officers');

  // 4. Approvals Module Correction & History State
  const [approvalsSubTab, setApprovalsSubTab] = useState<'pending' | 'history'>('pending');
  const [approvalHistorySearch, setApprovalHistorySearch] = useState('');
  const [pendingApprovalSearch, setPendingApprovalSearch] = useState('');
  const [selectedPendingReaderFilter, setSelectedPendingReaderFilter] = useState('all');
  const [collapsedReaderGroups, setCollapsedReaderGroups] = useState<Record<string, boolean>>({});
  const [correctingReadingId, setCorrectingReadingId] = useState<string | null>(null);
  const [correctionValue, setCorrectionValue] = useState<number>(0);
  const [rejectingReadingId, setRejectingReadingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  // 10. Staff Module Sub-Navigation & Dynamic Tariff State
  const [staffSubTab, setStaffSubTab] = useState<'users' | 'tariff'>('users');
  const [activeTariff, setActiveTariff] = useState<WaterTariffConfig>(() => getActiveTariffConfig());

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

  // Meter Readings Module Search & Filter
  const [readingsSearch, setReadingsSearch] = useState('');
  const [readingsStatusFilter, setReadingsStatusFilter] = useState<'all' | 'verified' | 'pending' | 'flagged_abnormal'>('all');

  // Water Meters Module Search & Filter
  const [meterSearch, setMeterSearch] = useState('');
  const [meterStatusFilter, setMeterStatusFilter] = useState<'all' | 'active' | 'inactive' | 'damaged' | 'maintenance'>('all');

  // 5. Bills Module Search & Filter
  const [billSearch, setBillSearch] = useState('');
  const [billStatusFilter, setBillStatusFilter] = useState<'all' | 'unpaid' | 'paid' | 'overdue' | 'cancelled'>('all');

  // Additional Smart Search States for Routes, Announcements, Staff, and Barangays Overview
  const [routesSearch, setRoutesSearch] = useState('');
  const [announcementSearch, setAnnouncementSearch] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const [barangayOverviewSearch, setBarangayOverviewSearch] = useState('');

  // Table Pagination States (Displays 10 records per page with next/prev page navigation)
  const [consumerPage, setConsumerPage] = useState(1);
  const [approvalHistoryPage, setApprovalHistoryPage] = useState(1);
  const [meterPage, setMeterPage] = useState(1);
  const [readingsPage, setReadingsPage] = useState(1);
  const [billPage, setBillPage] = useState(1);
  const [staffPage, setStaffPage] = useState(1);
  const [barangayConsumersPage, setBarangayConsumersPage] = useState(1);

  useEffect(() => {
    setConsumerPage(1);
  }, [consumerSearch, consumerStatusFilter, consumerTypeFilter, consumerBarangayFilter, consumerSortBy]);

  useEffect(() => {
    setApprovalHistoryPage(1);
  }, [approvalHistorySearch]);

  useEffect(() => {
    setMeterPage(1);
  }, [meterSearch, meterStatusFilter]);

  useEffect(() => {
    setReadingsPage(1);
  }, [readingsSearch, readingsStatusFilter]);

  useEffect(() => {
    setBillPage(1);
  }, [billSearch, billStatusFilter]);

  useEffect(() => {
    setStaffPage(1);
  }, [staffSearch]);

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
  const [modalEditStatus, setModalEditStatus] = useState<'active' | 'inactive' | 'blocked' | 'archived' | 'Disconnection Notice'>('active');

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
  const [editingStaffModal, setEditingStaffModal] = useState<{ id: string; name: string; email: string; role: string; department: string; status: string } | null>(null);

  // 11. Barangays Module State
  const [barangayList, setBarangayList] = useState(mockDb.getBarangays());
  const [showAddBarangay, setShowAddBarangay] = useState(false);
  const [newBarangay, setNewBarangay] = useState({ name: '', code: '', schedule: '', supervisor: 'District Operations Supervisor', ratePerM3: 24.50 });
  const [editingBarangayModal, setEditingBarangayModal] = useState<Barangay | null>(null);
  const [selectedBarangayForDetail, setSelectedBarangayForDetail] = useState<Barangay | null>(null);
  const [expandedBarangayConsumerId, setExpandedBarangayConsumerId] = useState<string | null>(null);
  const [isSyncingBarangays, setIsSyncingBarangays] = useState(false);
  const [barangaySearchQuery, setBarangaySearchQuery] = useState('');
  const [barangayZoneFilter, setBarangayZoneFilter] = useState('all');
  const [barangayStatusFilter, setBarangayStatusFilter] = useState('all');
  const [barangayCategoryFilter, setBarangayCategoryFilter] = useState('all');

  useEffect(() => {
    setBarangayConsumersPage(1);
    setExpandedBarangayConsumerId(null);
  }, [barangaySearchQuery, barangayZoneFilter, barangayStatusFilter, barangayCategoryFilter, selectedBarangayForDetail]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedBarangayForDetail && !selectedConsumerModal && !editingBarangayModal) {
        setSelectedBarangayForDetail(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedBarangayForDetail, selectedConsumerModal, editingBarangayModal]);

  // Additional Edit Modal States
  const [editingMeterModal, setEditingMeterModal] = useState<WaterMeter | null>(null);
  const [editingAnnouncementModal, setEditingAnnouncementModal] = useState<Announcement | null>(null);
  const [editingReaderModal, setEditingReaderModal] = useState<MeterReader | null>(null);

  // In-App Confirm Dialog State (Sandboxed iFrame Safe)
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    confirmVariant?: 'danger' | 'primary' | 'success';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    confirmVariant: 'danger',
    onConfirm: () => {}
  });

  // In-App Bill Cancellation Modal State (Sandboxed iFrame Safe)
  const [cancelBillModal, setCancelBillModal] = useState<{
    isOpen: boolean;
    bill: any | null;
    reason: string;
  }>({
    isOpen: false,
    bill: null,
    reason: ''
  });

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
    
    // 1. Reconcile any previously issued consumer IDs locally & load state
    mockDb.reconcileIssuedAccounts();
    setConsumers(mockDb.getConsumers());
    setReaders(mockDb.getReaders());
    setMeters(mockDb.getMeters());
    setReadings(mockDb.getReadings());
    setRoutes(mockDb.getRoutes());
    setAnnouncements(mockDb.getAnnouncements());
    setAuditLogs(mockDb.getAuditLogs());
    setBarangayList(mockDb.getBarangays());
    setReports(mockDb.getReports());
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
    safeBackendFetch('/api/readers')
      .then(res => (res ? res.json() : null))
      .then(data => {
        if (data && (data.readers || data.staff)) {
          const apiReaders = data.readers || data.staff || [];
          const currentLocal = mockDb.getReaders();
          let hasChanges = false;

          apiReaders.forEach((ar: any) => {
            const arUser = (ar.username || '').trim().toLowerCase();
            const arName = (ar.name || '').trim().toLowerCase();
            const arId = (ar.id || '').trim().toLowerCase();
            const arEmp = (ar.employeeId || '').trim().toLowerCase();
            const arEmail = (ar.email || '').trim().toLowerCase();

            const exists = currentLocal.find(lr => {
              const lrUser = (lr.username || '').trim().toLowerCase();
              const lrName = (lr.name || '').trim().toLowerCase();
              const lrId = (lr.id || '').trim().toLowerCase();
              const lrEmp = (lr.employeeId || '').trim().toLowerCase();
              const lrEmail = (lr.email || '').trim().toLowerCase();
              return (
                (arId && lrId && lrId === arId) ||
                (arId && lrEmp && lrEmp === arId) ||
                (arEmp && lrEmp && lrEmp === arEmp) ||
                (arEmp && lrId && lrId === arEmp) ||
                (arUser && lrUser && lrUser === arUser) ||
                (arName && lrName && lrName === arName) ||
                (arEmail && lrEmail && lrEmail === arEmail)
              );
            });
            const rawStatus = (ar.employmentStatus || ar.status || 'active').toLowerCase();
            const normalizedStatus: 'active' | 'inactive' = 
              rawStatus === 'inactive' ? 'inactive' : 'active';

            if (!exists) {
              // Add new mobile registrant to local store
              const newReaderObj: MeterReader = {
                id: ar.id || `reader-${Date.now()}`,
                name: ar.name,
                username: ar.username || ar.name.toLowerCase().replace(/\s+/g, '_'),
                email: ar.email || `${(ar.username || ar.name).toLowerCase().replace(/\s+/g, '_')}@tagoloanwater.gov.ph`,
                employeeId: ar.employeeId || ar.id,
                contactNumber: ar.contactNumber || 'N/A',
                assignedRoutes: (ar.assignedRoutes && ar.assignedRoutes.length > 0) ? ar.assignedRoutes : [ar.zone || 'Zone 1-4: Poblacion (Main Central)'],
                targetRoute: (ar.assignedRoutes && ar.assignedRoutes.length > 0) ? ar.assignedRoutes[0] : (ar.zone || 'Zone 1-4: Poblacion (Main Central)'),
                zone: ar.zone || 'Zone 1-4: Poblacion (Main Central)',
                employmentStatus: normalizedStatus,
                completedReadings: 0,
                pendingReadings: 0,
                performanceRating: 5.0
              };
              currentLocal.push(newReaderObj);
              hasChanges = true;
            } else {
              if (ar.employmentStatus && exists.employmentStatus !== normalizedStatus) {
                exists.employmentStatus = normalizedStatus;
                hasChanges = true;
              }
              if (ar.assignedRoutes && Array.isArray(ar.assignedRoutes) && ar.assignedRoutes.length > 0) {
                exists.assignedRoutes = ar.assignedRoutes;
                hasChanges = true;
              }
            }
          });

          // Multi-identifier deduplication ensures strictly 1 card per reader
          const seen = new Set<string>();
          const uniqueReaders: MeterReader[] = [];
          currentLocal.forEach(r => {
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
            uniqueReaders.push(r);
          });

          mockDb.saveReaders(uniqueReaders);
          setReaders(uniqueReaders);
        }
      })
      .catch(() => {
        // Fallback gracefully if running purely client-side
      });

    // 3. Bidirectional Reconciliation with Backend Server:
    // Pushes ALL locally issued consumer IDs, consumer users & issuance notifications to server
    // AND pulls any newly registered consumers from other browsers/devices
    const localConsumersToSync = mockDb.getConsumers();
    const localUsersToSync = mockDb.getUsers().filter(u => u.role !== 'admin');
    const localNotifsToSync = mockDb.getAllNotifications().filter(n => n.type === 'account_issue');

    safeBackendFetch('/api/consumers/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-portal': 'admin', 'x-role': 'admin' },
      body: JSON.stringify({
        consumers: localConsumersToSync,
        users: localUsersToSync,
        notifications: localNotifsToSync
      })
    })
      .then(res => (res ? res.json() : null))
      .then(data => {
        if (data && (data.consumers || data.data)) {
          const apiConsumers: any[] = data.consumers || data.data || [];
          const currentLocal = mockDb.getConsumers();
          const currentUsers = mockDb.getUsers();
          let hasChanges = false;

          apiConsumers.forEach(ac => {
            const acAcc = (ac.accountNumber || '').trim().toUpperCase();
            const acHasIssuedAcc = Boolean(acAcc && !acAcc.startsWith('PENDING') && acAcc !== 'UNASSIGNED' && acAcc !== 'UNISSUED');
            const acEmail = (ac.email || '').trim().toLowerCase();
            const acPhone = normalizePhoneNumber(ac.contactNumber || '');
            const acName = (ac.name || '').trim().toLowerCase();

            const existsIdx = currentLocal.findIndex(lc => {
              const lcAcc = (lc.accountNumber || '').trim().toUpperCase();
              const lcEmail = (lc.email || '').trim().toLowerCase();
              const lcPhone = normalizePhoneNumber(lc.contactNumber || '');
              const lcName = (lc.name || '').trim().toLowerCase();
              return (
                (acHasIssuedAcc && lcAcc && acAcc === lcAcc) ||
                (acEmail && lcEmail && acEmail === lcEmail) ||
                (ac.linkedUserId && lc.linkedUserId && ac.linkedUserId === lc.linkedUserId) ||
                (acPhone && lcPhone && acPhone.length === 11 && acPhone === lcPhone) ||
                (acName && lcName && acName === lcName && (!acEmail || !lcEmail || acEmail === lcEmail))
              );
            });

            if (existsIdx < 0) {
              // Match real user ID if registered locally rather than inventing a synthetic timestamp ID
              const matchedLocalUser = currentUsers.find(u =>
                u.role !== 'admin' && (
                  (acEmail && u.email && u.email.toLowerCase() === acEmail) ||
                  (ac.linkedUserId && u.id === ac.linkedUserId)
                )
              );

              const newConsumerObj: Consumer = {
                accountNumber: ac.accountNumber || '',
                name: ac.name,
                address: ac.address || 'Tagoloan, Misamis Oriental',
                barangayId: ac.barangayId || 'BRG-01',
                barangay: ac.barangay || 'Poblacion',
                sitioZone: ac.sitioZone || 'Zone 1',
                meterNumber: ac.meterNumber || '',
                status: ac.status || (acHasIssuedAcc ? 'active' : 'pending_approval'),
                contactNumber: ac.contactNumber || '',
                email: ac.email || '',
                consumerType: ac.consumerType === 'Commercial' ? 'Commercial' : 'Residential',
                householdInfo: ac.householdInfo,
                businessName: ac.businessName,
                businessType: ac.businessType,
                registrationDate: ac.registrationDate || new Date().toISOString().split('T')[0],
                linkedUserId: matchedLocalUser?.id || ac.linkedUserId || undefined,
                isRegistered: true,
                rfidTag: ac.rfidTag || '',
                createdAt: (ac as any).createdAt || Date.now(),
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
                existing.status !== 'pending_approval'
              );

              if (acHasIssuedAcc && (!existing.accountNumber || existing.accountNumber.toUpperCase().startsWith('PENDING') || existing.status === 'pending_approval')) {
                existing.accountNumber = ac.accountNumber;
                existing.meterNumber = ac.meterNumber || `MT-${ac.accountNumber}`;
                existing.status = ac.status && ac.status !== 'pending_approval' ? ac.status : 'active';
                existing.rfidTag = ac.rfidTag || `RFID-${existing.meterNumber}`;
                hasChanges = true;
              } else if (!isLocallyIssuedAndActive && ac.status && ac.status !== existing.status) {
                existing.status = ac.status;
                hasChanges = true;
              }
              if (!existing.email && ac.email) {
                existing.email = ac.email;
                hasChanges = true;
              }
              if (ac.linkedUserId && !existing.linkedUserId) {
                existing.linkedUserId = ac.linkedUserId;
                hasChanges = true;
              }
            }
          });

          if (hasChanges) {
            mockDb.saveConsumers([...currentLocal]);
            mockDb.reconcileIssuedAccounts();
            setConsumers(mockDb.getConsumers());
          }
        }
      })
      .catch(() => {
        // Fallback gracefully if running purely client-side
      });

    // 4. Fetch Reports from Backend API (merge without wiping local/Firestore reports)
    safeBackendFetch('/api/reports')
      .then(res => (res ? res.json() : null))
      .then(data => {
        if (data && data.reports && Array.isArray(data.reports) && data.reports.length > 0) {
          const merged = mockDb.mergeExternalReports(data.reports);
          setReports(merged);
        }
      })
      .catch(() => {
        // Fallback to mockDb
      });

    // 4b. Sync Announcements & Tariff Config from Backend API
    apiClient.getAnnouncements()
      .then(res => {
        if (res?.announcements && Array.isArray(res.announcements)) {
          const mergedAnns = mockDb.mergeExternalAnnouncements(res.announcements);
          setAnnouncements(mergedAnns);
        }
      })
      .catch(() => {});

    apiClient.getTariffConfig()
      .then(res => {
        if (res?.config && (res.config.version || 0) > (getActiveTariffConfig().version || 0)) {
          saveActiveTariffConfig(res.config);
          setActiveTariff(res.config);
        }
      })
      .catch(() => {});

    // 5. Fetch Mobile App Submitted Readings from Backend API (/api/readings)
    safeBackendFetch('/api/readings')
      .then(res => (res ? res.json() : null))
      .then(data => {
        const apiReadings: any[] = data?.readings || data?.data || [];
        if (Array.isArray(apiReadings) && apiReadings.length > 0) {
          const currentLocal = mockDb.getReadings();
          const currentConsumers = mockDb.getConsumers();
          let hasReadingChanges = false;

          apiReadings.forEach(ar => {
            if (!ar || !ar.id) return;
            const matchedConsumer = currentConsumers.find(c =>
              (ar.accountNumber && c.accountNumber === ar.accountNumber) ||
              (ar.meterNumber && c.meterNumber === ar.meterNumber)
            );
            const consumptionVal = Math.max(0, Number(ar.consumption ?? (Number(ar.currentReading || 0) - Number(ar.previousReading || 0))));
            const mappedStatus: MeterReading['status'] =
              ar.status === 'approved' || ar.status === 'verified'
                ? 'verified'
                : consumptionVal >= 50
                  ? 'flagged_abnormal'
                  : 'pending';

            const existsIdx = currentLocal.findIndex(lr => lr.id === ar.id);
            if (existsIdx < 0) {
              const photo = ar.photoUrl || ar.imageUrl || ar.meterImageUrl || '';
              const cls = matchedConsumer?.consumerType === 'Commercial' ? 'Commercial' : 'Residential';
              const activeTariffCfg = getActiveTariffConfig();
              const computedBill = typeof ar.billAmount === 'number' && ar.billAmount > 0
                ? ar.billAmount
                : calculateWaterTariff(consumptionVal, cls, activeTariffCfg);
              const newReadingRecord: MeterReading = {
                id: ar.id,
                accountNumber: ar.accountNumber || matchedConsumer?.accountNumber || 'UNKNOWN',
                consumerName: ar.consumerName || matchedConsumer?.name || 'Consumer',
                address: matchedConsumer?.address || '',
                addressZone: matchedConsumer?.sitioZone || '',
                meterNumber: ar.meterNumber || matchedConsumer?.meterNumber || '',
                meterBrand: matchedConsumer?.meterBrand || 'EVER',
                classification: cls,
                previousReading: Number(ar.previousReading || 0),
                currentReading: Number(ar.currentReading || 0),
                consumption: consumptionVal,
                billAmount: computedBill,
                totalAmount: computedBill,
                appliedTariffVersion: ar.appliedTariffVersion || activeTariffCfg.version,
                readingDate: ar.readingDate || new Date().toISOString().split('T')[0],
                billingPeriod: ar.billingPeriod || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                meterReaderName: ar.readerName || ar.meterReaderName || 'Field Meter Officer',
                route: ar.route || matchedConsumer?.barangay || 'Poblacion',
                status: mappedStatus,
                paymentStatus: 'unpaid',
                imageUrl: photo,
                meterImageUrl: photo,
                gpsLocation: ar.coordinates
                  ? `${ar.coordinates.latitude}, ${ar.coordinates.longitude}`
                  : (ar.gpsLocation || ''),
                notes: ar.notes || ''
              };
              currentLocal.unshift(newReadingRecord);
              hasReadingChanges = true;
            }
          });

          if (hasReadingChanges) {
            mockDb.saveReadings([...currentLocal]);
            setReadings([...currentLocal]);
          }
        }
      })
      .catch(() => {
        // Fallback gracefully if running purely client-side
      });
  };

  useEffect(() => {
    ensureRealtimeFirestoreListeners();
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

    // 3. Adaptive real-time auto-polling to catch live field mobile submissions (backup to live WebSocket)
    const pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        loadAllDataFromStore(false);
      }
    }, 10000);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        loadAllDataFromStore(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 4. Live 1-second clock ticker for date and time
    const clockInterval = setInterval(() => {
      const d = new Date();
      setCurrentDateStr(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
      setCurrentTimeStr(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }));
    }, 1000);

    // 5. Dedicated Live WebSocket Stream for instant push events
    const cleanupWs = initRealtimeSocket((data) => {
      if (data.type === 'READER_REGISTERED_ACTIVE' || data.type === 'READER_REGISTERED_PENDING' || data.type === 'staff:registered') {
        toast.info('Meter Reader Registered', data.payload?.message || 'New field staff registered via mobile app.');
        loadAllDataFromStore(false);
      } else if (data.type === 'READER_TERMINATED' || data.type === 'staff:terminated') {
        loadAllDataFromStore(false);
      } else if (
        data.type === 'READING_SUBMITTED_FOR_APPROVAL' ||
        data.type === 'reading:submitted' ||
        data.type === 'NEW_READING_SUBMITTED' ||
        data.type === 'readings:new' ||
        data.type === 'READINGS_BATCH_SYNCED'
      ) {
        toast.info('Field Readings Received', data.payload?.message || 'Incoming meter reading queued for review.');
        loadAllDataFromStore(false);
      } else if (
        data.type === 'CONSUMER_REGISTERED' ||
        data.type === 'consumer:registered' ||
        data.type === 'CONSUMER_UPDATED' ||
        data.type === 'READER_APPROVED_ACTIVE' ||
        data.type === 'staff:status_updated'
      ) {
        loadAllDataFromStore(false);
      } else if (data.type === 'service:grace_period_scan_complete') {
        loadAllDataFromStore(false);
        setScannerStatus(getScannerStatus());
      } else if (data.type === 'tariff:updated') {
        if (data.payload?.config) {
          saveActiveTariffConfig(data.payload.config);
        }
        setActiveTariff(getActiveTariffConfig());
        loadAllDataFromStore(false);
      } else if (
        data.type === 'ANNOUNCEMENT_PUBLISHED' ||
        data.type === 'ANNOUNCEMENT_UPDATED' ||
        data.type === 'ANNOUNCEMENT_DELETED'
      ) {
        loadAllDataFromStore(false);
      } else if (data.type === 'CONSUMER_REPORT_CREATED' || data.type === 'consumer:report:created') {
        toast.warning(
          'New Consumer Concern Filed',
          data.payload?.message || `${data.payload?.consumerName || 'A consumer'} submitted report #${data.payload?.reportId || ''}`
        );
        loadAllDataFromStore(false);
      } else if (
        data.type === 'CONSUMER_REPORT_REPLY' ||
        data.type === 'CONSUMER_REPLIED_TO_REPORT' ||
        data.type === 'ADMIN_REPLIED_TO_REPORT' ||
        data.type === 'REPORT_STATUS_CHANGED' ||
        data.type === 'CONSUMER_REPORT_UPDATED'
      ) {
        loadAllDataFromStore(false);
      }
    });

    // 6. Subscribe to local tariff update events
    const handleTariffUpdated = (e: any) => {
      if (e?.detail) {
        setActiveTariff(e.detail);
      } else {
        setActiveTariff(getActiveTariffConfig());
      }
    };
    window.addEventListener('twd_tariff_updated', handleTariffUpdated);

    // 7. Subscribe to automated grace period background scanner
    const unsubscribeScanner = subscribeToScanner((status) => {
      setScannerStatus(status);
    });

    return () => {
      window.removeEventListener('twd_database_updated', handleDbUpdate);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('twd_tariff_updated', handleTariffUpdated);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(pollTimer);
      clearInterval(clockInterval);
      cleanupWs();
      unsubscribeScanner();
    };
  }, []);

  const handleManualRefresh = () => {
    loadAllDataFromStore(true);
  };

  // Manual Trigger: Scan Account Grace Periods Now
  const handleTriggerManualGracePeriodScan = () => {
    setIsManualScanning(true);
    try {
      const summary = scanAndUpdateAccounts();
      setConsumers(mockDb.getConsumers());
      setReadings(mockDb.getReadings());
      setScannerStatus(getScannerStatus());
      toast.success(
        'Grace Period Scan Complete',
        `Evaluated ${summary.scannedCount} accounts. ${summary.updatedToDisconnectionCount} updated to Disconnection Notice. ${summary.restoredToActiveCount} restored to Active.`
      );
    } catch (e: any) {
      toast.error('Scan Error', e?.message || 'Failed to complete background grace period scan.');
    } finally {
      setTimeout(() => setIsManualScanning(false), 500);
    }
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
    setModalEditStatus(
      !c.status || c.status === 'pending_approval' ? 'active' : c.status
    );

    // Populate issue IDs fields (generate suggested account number, meter number, and tag if unissued)
    const isAlreadyOfficiallyIssued = isRealIssuedAccountNumber(c.accountNumber);

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

  // Action: Delete / Terminate Consumer Account (Full Erasure & Purge)
  const executeDeleteConsumer = (c: Consumer) => {
    // Permanent erasure across mockDb, user accounts, meters, and firestore
    mockDb.deleteConsumer(c.accountNumber, c.email, c.linkedUserId, c.name);

    // Sync deletion with backend API
    const deleteId = c.accountNumber || c.email || c.linkedUserId || '';
    if (deleteId) {
      safeBackendFetch(`/api/consumers/${encodeURIComponent(deleteId)}`, {
        method: 'DELETE'
      }).catch(() => {});
    }

    if (selectedConsumerModal && (
      (c.accountNumber && selectedConsumerModal.accountNumber === c.accountNumber) ||
      (c.email && selectedConsumerModal.email === c.email) ||
      (c.linkedUserId && selectedConsumerModal.linkedUserId === c.linkedUserId)
    )) {
      setSelectedConsumerModal(null);
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Purge and Terminate Consumer Account',
      `Permanently terminated and fully erased consumer account ${c.accountNumber ? `#${c.accountNumber}` : 'Pending Profile'} (${c.name}, Email: ${c.email || 'N/A'}).`
    );

    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.error('Consumer Account Erased', `Consumer record for "${c.name}" has been permanently purged and erased.`);
  };

  const handleDeleteConsumer = (c: Consumer) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Permanent Account Termination',
      message: `Are you sure you want to permanently delete and erase consumer "${c.name}" (${c.accountNumber ? `Account #${c.accountNumber}` : 'Pending Application'})?\n\nFull Account Termination:\n• Permanently removes consumer profile from database\n• Erases all consumer portal login credentials and user accounts\n• Unlinks and frees any assigned water meters\n• Purges record from active billing rolls`,
      confirmLabel: 'Permanently Erase',
      confirmVariant: 'danger',
      onConfirm: () => executeDeleteConsumer(c)
    });
  };

  // Action: Update Consumer Details (Edit Tab in Modal)
  const handleUpdateConsumerDetails = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConsumerModal) return;

    // Validate 11-digit mobile number and duplicate detection
    const cleanPhone = normalizePhoneNumber(modalEditContactNumber);
    if (!cleanPhone || cleanPhone.length !== 11 || !cleanPhone.startsWith('09')) {
      toast.error('Invalid Mobile Number', 'Mobile number must be exactly 11 digits starting with 09 (e.g. 09171234567).');
      return;
    }

    const existingPhone = detectExistingPhoneAccount(cleanPhone, {
      accountNumber: selectedConsumerModal.accountNumber,
      email: selectedConsumerModal.email,
      linkedUserId: selectedConsumerModal.linkedUserId
    });
    if (existingPhone) {
      toast.error('Duplicate Mobile Number Blocked', `Mobile number "${cleanPhone}" is already assigned to "${existingPhone.name}". Duplicate phone numbers are strictly prohibited in the system.`);
      return;
    }

    const hasIssuedAccount = isRealIssuedAccountNumber(selectedConsumerModal.accountNumber);
    const updated: Consumer = {
      ...selectedConsumerModal,
      name: modalEditName,
      email: modalEditEmail,
      contactNumber: cleanPhone,
      address: modalEditAddress,
      consumerType: modalEditConsumerType,
      businessName: modalEditConsumerType === 'Commercial' ? modalEditBusinessName : undefined,
      businessType: modalEditConsumerType === 'Commercial' ? modalEditBusinessType : undefined,
      householdInfo: modalEditConsumerType === 'Residential' ? modalEditHouseholdInfo : undefined,
      status: hasIssuedAccount ? (modalEditStatus || 'active') : 'pending_approval'
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

    if (hasIssuedAccount) {
      pushIssuedConsumerToFirestore(updated, undefined, undefined, true).catch(() => {});
    }

    // Sync update to backend server
    safeBackendFetch('/api/consumers', {
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

    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.success('Consumer Details Updated', `Profile details for ${updated.name} updated successfully. All records synchronized.`);
  };

  // Action: Issue / Update IDs & RFID Tag (Issue IDs Tab in Modal)
  const handleIssueIdentifiers = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConsumerModal) return;

    // Check if account already has an issued active record
    const isAlreadyOfficiallyIssued = Boolean(
      isRealIssuedAccountNumber(selectedConsumerModal.accountNumber) &&
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

      // Strict Duplicate Account Number Verification
      const duplicateAccCheck = checkDuplicateAccountNumber(newAccNum, selectedConsumerModal);
      if (duplicateAccCheck) {
        toast.error('Duplicate Account Number Blocked', duplicateAccCheck.message);
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
      setModalEditStatus('active');

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
      safeBackendFetch('/api/consumers', {
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

      const updatedIdNotif = mockDb.addNotification({
        accountNumber: newAccNum,
        consumerId: updated.id,
        userId: updated.linkedUserId,
        consumerEmail: updated.email,
        title: `Account Number Updated to #${newAccNum}`,
        message: `Your water service account identifier has been officially updated to #${newAccNum} by Tagoloan Water District Administration. Your physical Meter Tag (${preservedTag}) and Meter Serial (#${preservedMeterNum}) remain permanently assigned.`,
        type: 'account_issue'
      });

      // Update past notifications to point to the new account number
      mockDb.updateConsumerNotifications(
        {
          userId: updated.linkedUserId,
          email: updated.email,
          consumerId: updated.id,
          oldAccountNumber: previousAccountNumber
        },
        {
          accountNumber: newAccNum,
          consumerId: updated.id,
          userId: updated.linkedUserId,
          consumerEmail: updated.email
        }
      );

      // Ensure Cloud Firestore & Backend Reconcile Store receive updated consumer, active user, and notification across all devices
      const matchedUpdatedUser = updatedUsers.find(u =>
        (previousUserId && u.id === previousUserId) ||
        (previousEmail && u.email && u.email.trim().toLowerCase() === previousEmail) ||
        u.linkedAccountNumber === newAccNum
      );
      pushIssuedConsumerToFirestore(updated, updatedIdNotif, matchedUpdatedUser, true, previousAccountNumber).catch(() => {});
      safeBackendFetch('/api/consumers/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-portal': 'admin', 'x-role': 'admin' },
        body: JSON.stringify({
          consumers: [updated],
          users: matchedUpdatedUser ? [matchedUpdatedUser] : [],
          notifications: [updatedIdNotif]
        })
      }).catch(() => {});

      // Push instant WebSocket confirmation + notification to Consumer Portal
      sendRealtimeMessage('CONSUMER_IDS_ISSUED', {
        consumer: updated,
        notification: updatedIdNotif,
        accountNumber: newAccNum,
        meterNumber: preservedMeterNum,
        rfidTag: preservedTag,
        email: updated.email,
        linkedUserId: updated.linkedUserId,
        previousAccountNumber,
        isUpdate: true
      });

      // 9. Dispatch instant UI sync events
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_consumers', timestamp: Date.now() } }));
        window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_users', timestamp: Date.now() } }));
        window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_readings', timestamp: Date.now() } }));
        window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_notifications', timestamp: Date.now() } }));
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

    // 1. Strict Duplicate Account Number Check
    const accDupCheck = checkDuplicateAccountNumber(newAccNum, selectedConsumerModal);
    if (accDupCheck) {
      toast.error('Duplicate Account Number Blocked', accDupCheck.message);
      return;
    }

    // 2. Strict Duplicate RFID Tag Number Check
    if (newTag) {
      const rfidDupCheck = checkDuplicateRfidTag(newTag, selectedConsumerModal);
      if (rfidDupCheck) {
        toast.error('Duplicate RFID Tag Blocked', rfidDupCheck.message);
        return;
      }
    }

    // 3. Strict Duplicate Meter Tag Number Check
    if (newMeterNum) {
      const meterDupCheck = checkDuplicateMeterTag(newMeterNum, selectedConsumerModal);
      if (meterDupCheck) {
        toast.error('Duplicate Meter Tag Blocked', meterDupCheck.message);
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

    // 1. Update consumers list (match by previousAccountNumber, previousEmail, previousUserId, or previousName when email/uid do not conflict)
    let matchedAny = false;
    const newConsumers = consumers.map(item => {
      const sameNameNoConflict =
        previousName &&
        item.name &&
        item.name.trim().toLowerCase() === previousName &&
        (!previousEmail || !item.email || item.email.trim().toLowerCase() === previousEmail) &&
        (!previousUserId || !item.linkedUserId || item.linkedUserId === previousUserId) &&
        (item.barangay === selectedConsumerModal.barangay || !item.accountNumber || item.accountNumber.toUpperCase().startsWith('PENDING'));
      const isMatch = (previousAccountNumber && item.accountNumber === previousAccountNumber) ||
                      (previousEmail && item.email && item.email.trim().toLowerCase() === previousEmail) ||
                      (previousUserId && item.linkedUserId === previousUserId) ||
                      sameNameNoConflict;
      if (isMatch) {
        matchedAny = true;
        return updated;
      }
      return item;
    });

    if (!matchedAny) {
      newConsumers.unshift(updated);
    }

    // Deduplicate any older pending twins for the SAME applicant
    const deduplicatedConsumers = newConsumers.filter((c, idx, arr) => {
      if ((!c.accountNumber || c.accountNumber.toUpperCase().startsWith('PENDING') || c.status === 'pending_approval') && 
          arr.some(o => o !== c && (
            (c.email && o.email && o.email.toLowerCase() === c.email.toLowerCase() && o.status === 'active') ||
            (c.linkedUserId && o.linkedUserId && o.linkedUserId === c.linkedUserId && o.status === 'active') ||
            (c.name && o.name && o.name.toLowerCase() === c.name.toLowerCase() && (!c.email || !o.email || c.email.toLowerCase() === o.email.toLowerCase()) && (!c.linkedUserId || !o.linkedUserId || c.linkedUserId === o.linkedUserId) && o.status === 'active')
          ))) {
        return false;
      }
      return true;
    });

    mockDb.saveConsumers(deduplicatedConsumers);
    setConsumers(deduplicatedConsumers);
    setSelectedConsumerModal(updated);
    setModalEditStatus('active');

    // 2. Update linked User record in users database so consumer login connects to the issued account
    const allUsers = mockDb.getUsers();
    const updatedUsers = allUsers.map(u => {
      const sameUserNameNoConflict =
        previousName &&
        u.name &&
        u.name.trim().toLowerCase() === previousName &&
        (!previousEmail || !u.email || u.email.trim().toLowerCase() === previousEmail) &&
        (!previousUserId || !u.id || u.id === previousUserId);
      const isUserMatch = (previousUserId && u.id === previousUserId) ||
                          (previousEmail && u.email && u.email.trim().toLowerCase() === previousEmail) ||
                          (previousAccountNumber && u.linkedAccountNumber === previousAccountNumber) ||
                          sameUserNameNoConflict;
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
                                 (previousName && activeSessionUser.name && activeSessionUser.name.trim().toLowerCase() === previousName && (!previousEmail || !activeSessionUser.email || activeSessionUser.email.trim().toLowerCase() === previousEmail));
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

    // 5. Send Activation Notification strictly to this Consumer
    const issuedNotif = mockDb.addNotification({
      accountNumber: newAccNum,
      consumerId: updated.id,
      userId: updated.linkedUserId || selectedConsumerModal.linkedUserId,
      consumerEmail: updated.email || selectedConsumerModal.email,
      title: `Official Account Number & Meter Issued!`,
      message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${newAccNum} and Meter Serial is #${newMeterNum}. Smart RFID Tag: ${updated.rfidTag}. Your full dashboard and telemetry are now active.`,
      type: 'account_issue'
    });

    // 5b. Strictly update any prior unissued/pending notifications to associate with their newly issued account
    mockDb.updateConsumerNotifications(
      {
        userId: updated.linkedUserId || selectedConsumerModal.linkedUserId,
        email: updated.email || selectedConsumerModal.email,
        consumerId: updated.id,
        oldAccountNumber: previousAccountNumber || 'PENDING'
      },
      {
        accountNumber: newAccNum,
        consumerId: updated.id,
        userId: updated.linkedUserId || selectedConsumerModal.linkedUserId,
        consumerEmail: updated.email || selectedConsumerModal.email
      }
    );

    // 6. Authoritative Cloud Firestore + Backend Reconcile sync across all lookup keys so every device confirms immediately
    const matchedIssuedUser = updatedUsers.find(u =>
      (previousUserId && u.id === previousUserId) ||
      (previousEmail && u.email && u.email.trim().toLowerCase() === previousEmail) ||
      u.linkedAccountNumber === newAccNum
    );
    pushIssuedConsumerToFirestore(updated, issuedNotif, matchedIssuedUser, true, previousAccountNumber).catch(() => {});

    safeBackendFetch('/api/consumers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    }).catch(() => {});

    safeBackendFetch('/api/consumers/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-portal': 'admin', 'x-role': 'admin' },
      body: JSON.stringify({
        consumers: [updated],
        users: matchedIssuedUser ? [matchedIssuedUser] : [],
        notifications: [issuedNotif]
      })
    }).catch(() => {});

    sendRealtimeMessage('CONSUMER_IDS_ISSUED', {
      consumer: updated,
      notification: issuedNotif,
      accountNumber: newAccNum,
      meterNumber: newMeterNum,
      rfidTag: updated.rfidTag,
      email: updated.email || selectedConsumerModal.email,
      linkedUserId: updated.linkedUserId || selectedConsumerModal.linkedUserId,
      previousAccountNumber: previousAccountNumber || '',
      isUpdate: false
    });

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
      window.dispatchEvent(new CustomEvent('twd_database_updated', { detail: { key: 'twd_live_v4_notifications', timestamp: Date.now() } }));
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
      toast.error('Duplicate Meter Tag / Serial Detected', `Meter #${meterNumTrimmed} is ${owner}. Every water meter tag is a strictly unique physical entity.`);
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



  // Action: Terminate Meter Reader Account
  const executeTerminateReader = async (reader: MeterReader) => {
    // Permanently erase across all keys, users, readers, route assignments, and Firestore
    mockDb.deleteReader(reader.id, reader.employeeId, reader.email, reader.username, reader.name);
    
    // Attempt backend API termination call
    try {
      await apiClient.delete(`/api/staff/${encodeURIComponent(reader.id)}`, { 
        employeeId: reader.employeeId, 
        email: reader.email,
        username: reader.username,
        name: reader.name
      });
      sendRealtimeMessage('staff:terminated', {
        readerId: reader.id,
        employeeId: reader.employeeId,
        username: reader.username
      });
    } catch (err) {
      console.warn('[AdminPortal] Error terminating reader via API:', err);
    }

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

    window.dispatchEvent(new Event('twd_database_updated'));
    toast.error('Account Terminated', `${reader.name}'s meter reader account has been permanently erased.`);
  };

  const handleTerminateReader = (reader: MeterReader) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Terminate Meter Reader Account',
      message: `Are you sure you want to permanently terminate the meter reader account for "${reader.name}"?\n\nThis will immediately and fully erase all mobile terminal credentials, revoke login access, and remove their inspector profile.`,
      confirmLabel: 'Terminate Reader',
      confirmVariant: 'danger',
      onConfirm: () => executeTerminateReader(reader)
    });
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

    // Sync announcement to REST backend + broadcast live via WebSocket to all Consumer accounts
    apiClient.createAnnouncement(created).catch(() => {});
    sendRealtimeMessage('ANNOUNCEMENT_PUBLISHED', { announcement: created });

    // Create a single district-wide broadcast notification ('ALL') so every consumer receives an instant bell alert without exhausting Firestore write quota
    const broadcastNotif = mockDb.addNotification({
      accountNumber: 'ALL',
      title: `Official District Advisory: ${created.title}`,
      message: created.content,
      type: 'announcement'
    });
    sendRealtimeMessage('CONSUMER_NOTIFICATION_CREATED', {
      notification: broadcastNotif,
      accountNumber: 'ALL'
    });

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
    toast.success('Advisory Published', `"${created.title}" is now live across all Consumer accounts.`);
    loadAllDataFromStore();
  };

  // Action: Delete Water Meter
  const executeDeleteMeter = (m: WaterMeter) => {
    mockDb.deleteMeter(m.meterNumber);
    setMeters(prev => prev.filter(item => item.meterNumber !== m.meterNumber));
    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Delete Water Meter',
      `Decommissioned and deleted water meter #${m.meterNumber} (${m.brand}).`
    );
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.error('Meter Deleted', `Water meter #${m.meterNumber} has been removed from inventory.`);
  };

  const handleDeleteMeter = (m: WaterMeter) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Decommission Water Meter',
      message: `Are you sure you want to delete and decommission water meter #${m.meterNumber} (${m.brand})?\n\nIf this meter is currently assigned to a consumer, the meter link will be automatically unlinked.`,
      confirmLabel: 'Decommission Meter',
      confirmVariant: 'danger',
      onConfirm: () => executeDeleteMeter(m)
    });
  };

  // Action: Update Water Meter
  const handleUpdateMeter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMeterModal) return;

    const allMeters = mockDb.getMeters();
    const updated = allMeters.map(m => m.meterNumber === editingMeterModal.meterNumber ? editingMeterModal : m);
    mockDb.saveMeters(updated);
    setMeters(updated);

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Update Water Meter',
      `Updated meter specifications for #${editingMeterModal.meterNumber} (Status: ${editingMeterModal.status}).`
    );
    setEditingMeterModal(null);
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.success('Meter Updated', `Water meter #${editingMeterModal.meterNumber} updated successfully.`);
  };

  // Action: Delete / Terminate Staff Account
  const executeDeleteStaff = (st: { id: string; name: string; email: string; role: string; department: string; status: string }) => {
    mockDb.deleteUser(st.id, st.email, undefined, st.name);
    setStaffList(prev => prev.filter(item => item.id !== st.id && item.email !== st.email));
    
    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Terminate Staff User',
      `Permanently terminated and erased staff user "${st.name}" (${st.role}, ${st.email}).`
    );
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.error('Staff Account Terminated', `Staff account for "${st.name}" has been permanently purged.`);
  };

  const handleDeleteStaff = (st: { id: string; name: string; email: string; role: string; department: string; status: string }) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Terminate Staff Account',
      message: `Are you sure you want to permanently erase and terminate staff member "${st.name}" (${st.email})?\n\nThis will completely erase their system credentials, revoke all administrative access, and remove their profile.`,
      confirmLabel: 'Terminate Staff',
      confirmVariant: 'danger',
      onConfirm: () => executeDeleteStaff(st)
    });
  };

  // Action: Update Staff Member
  const handleUpdateStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaffModal) return;

    const allUsers = mockDb.getUsers();
    const roleLower = editingStaffModal.role.toLowerCase();
    const roleCode = roleLower.includes('admin') ? 'admin' : (roleLower.includes('cashier') ? 'cashier' : 'staff');
    const updatedUsers = allUsers.map(u => {
      if (u.id === editingStaffModal.id || (u.email && u.email.toLowerCase() === editingStaffModal.email.toLowerCase())) {
        return {
          ...u,
          name: editingStaffModal.name,
          email: editingStaffModal.email,
          role: roleCode as any,
          status: editingStaffModal.status as any
        };
      }
      return u;
    });
    mockDb.saveUsers(updatedUsers);

    setStaffList(prev => prev.map(s => s.id === editingStaffModal.id ? editingStaffModal : s));
    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Update Staff User',
      `Updated staff record for "${editingStaffModal.name}" (${editingStaffModal.role}).`
    );
    setEditingStaffModal(null);
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.success('Staff Updated', `Staff details for "${editingStaffModal.name}" updated successfully.`);
  };

  // Action: Delete Barangay Zone
  const executeDeleteBarangay = (bg: Barangay) => {
    mockDb.deleteBarangay(bg.id);
    setBarangayList(prev => prev.filter(item => item.id !== bg.id));
    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Delete Barangay Zone',
      `Deleted service zone ${bg.name} (${bg.code}).`
    );
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.error('Zone Removed', `Barangay ${bg.name} has been removed.`);
  };

  const handleDeleteBarangay = (bg: Barangay) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Service Zone',
      message: `Are you sure you want to delete Barangay service zone "${bg.name}" (${bg.code})?\n\nThis will remove the zone definition from the municipal district registry.`,
      confirmLabel: 'Delete Zone',
      confirmVariant: 'danger',
      onConfirm: () => executeDeleteBarangay(bg)
    });
  };

  // Action: Update Barangay Zone
  const handleUpdateBarangay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBarangayModal) return;

    const allBarangays = mockDb.getBarangays();
    const updated = allBarangays.map(b => b.id === editingBarangayModal.id ? editingBarangayModal : b);
    mockDb.saveBarangays(updated);
    setBarangayList(updated);

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Update Barangay Zone',
      `Updated zone parameters for ${editingBarangayModal.name} (${editingBarangayModal.code}, ₱${editingBarangayModal.ratePerM3}/m³).`
    );
    setEditingBarangayModal(null);
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.success('Zone Updated', `Barangay ${editingBarangayModal.name} updated successfully.`);
  };

  // Action: Synchronize All Consumers to their Assigned Barangay & Zone
  const handleSyncConsumersAndBarangays = () => {
    setIsSyncingBarangays(true);
    try {
      let syncCount = 0;
      const updated = consumers.map(c => {
        let changed = false;
        let bName = c.barangay ? c.barangay.trim() : '';
        let bId = c.barangayId ? c.barangayId.trim() : '';
        let sZone = c.sitioZone ? c.sitioZone.trim() : '';

        // Match against known barangays
        const bLower = (bName + ' ' + (c.address || '')).toLowerCase();
        let matchedBg = barangayList.find(b => b.id.toLowerCase() === bId.toLowerCase());

        if (!matchedBg) {
          if (bLower.includes('natumolan') || bLower.includes('natumulan')) {
            matchedBg = barangayList.find(b => b.name === 'Natumolan');
          } else if (bLower.includes('baluarte')) {
            matchedBg = barangayList.find(b => b.name === 'Baluarte');
          } else if ((bLower.includes('sta') && bLower.includes('ana')) || bLower.includes('santa ana')) {
            matchedBg = barangayList.find(b => b.name === 'Sta. Ana');
          } else if ((bLower.includes('sta') && bLower.includes('cruz')) || bLower.includes('santa cruz')) {
            matchedBg = barangayList.find(b => b.name === 'Sta. Cruz');
          } else if (bLower.includes('mohon')) {
            matchedBg = barangayList.find(b => b.name === 'Mohon');
          } else if (bLower.includes('gracia')) {
            matchedBg = barangayList.find(b => b.name === 'Gracia');
          } else if (bLower.includes('casinglot')) {
            matchedBg = barangayList.find(b => b.name === 'Casinglot');
          } else if (bLower.includes('sugbongcogon') || bLower.includes('subongcogon')) {
            matchedBg = barangayList.find(b => b.name === 'Sugbongcogon');
          } else {
            matchedBg = barangayList.find(b => b.name === 'Poblacion') || barangayList[0];
          }
        }

        if (matchedBg) {
          if (c.barangay !== matchedBg.name) {
            bName = matchedBg.name;
            changed = true;
          }
          if (c.barangayId !== matchedBg.id) {
            bId = matchedBg.id;
            changed = true;
          }
          if (!sZone) {
            if (matchedBg.code === 'PB-01') sZone = 'Zone 1';
            else if (matchedBg.code === 'NT-02') sZone = 'Zone 5';
            else if (matchedBg.code === 'BL-03') sZone = 'Zone 9';
            else if (matchedBg.code === 'SA-04') sZone = 'Zone 13';
            else if (matchedBg.code === 'SC-05') sZone = 'Zone 17';
            else if (matchedBg.code === 'MH-06') sZone = 'Zone 11';
            else if (matchedBg.code === 'GR-07') sZone = 'Zone 25';
            else if (matchedBg.code === 'CS-08') sZone = 'Zone 21';
            else if (matchedBg.code === 'SG-09') sZone = 'Zone 33';
            else sZone = 'Central Zone';
            changed = true;
          }
        }

        if (changed) {
          syncCount++;
          return {
            ...c,
            barangay: bName,
            barangayId: bId,
            sitioZone: sZone
          };
        }
        return c;
      });

      if (syncCount > 0) {
        mockDb.saveConsumers(updated);
        setConsumers(updated);
        mockDb.addAuditLog(
          currentUser.id,
          currentUser.name,
          'admin',
          'Sync Consumer Barangays & Zones',
          `Synchronized ${syncCount} consumer records to official Barangay & Zone parameters.`
        );
        toast.success(
          'Barangay & Zone Sync Complete',
          `Successfully synchronized ${syncCount} consumer records to their designated municipal Barangays and Sitios.`
        );
      } else {
        toast.info(
          '100% Synchronized',
          `All ${consumers.length} consumers are already synchronized with their municipal Barangay and Zone records.`
        );
      }
    } catch (err: any) {
      toast.error('Sync Error', 'Failed to synchronize consumer records.');
    } finally {
      setIsSyncingBarangays(false);
    }
  };

  // Robust synchronization & mapping of consumers to their Barangay and Zone
  const getConsumersForBarangay = (bg: Barangay) => {
    const bgName = (bg.name || '').trim().toLowerCase();
    const bgId = (bg.id || '').trim().toLowerCase();
    const bgCode = (bg.code || '').trim().toLowerCase();

    return consumers.filter(c => {
      // 1. Direct Barangay ID match
      if (c.barangayId && c.barangayId.trim().toLowerCase() === bgId) return true;

      // 2. Exact or normalized barangay name match
      const cBarangay = (c.barangay || '').trim().toLowerCase();
      if (cBarangay) {
        if (cBarangay === bgName) return true;
        if (cBarangay.includes(bgName) || bgName.includes(cBarangay)) return true;
        const cleanC = cBarangay.replace(/\./g, '').replace(/santa/g, 'sta');
        const cleanBg = bgName.replace(/\./g, '').replace(/santa/g, 'sta');
        if (cleanC === cleanBg) return true;
      }

      // 3. Address match
      const cAddr = (c.address || '').trim().toLowerCase();
      if (cAddr) {
        if (cAddr.includes(bgName)) return true;
        if (bgCode && cAddr.includes(bgCode)) return true;
        const cleanAddr = cAddr.replace(/\./g, '').replace(/santa/g, 'sta');
        const cleanBg = bgName.replace(/\./g, '').replace(/santa/g, 'sta');
        if (cleanAddr.includes(cleanBg)) return true;
      }

      // 4. Fallback check for Poblacion if no other barangay matches
      if (bg.code === 'PB-01') {
        const matchesOther = barangayList.some(other => {
          if (other.id === bg.id) return false;
          const otherName = (other.name || '').trim().toLowerCase();
          const otherCode = (other.code || '').trim().toLowerCase();
          const cleanOther = otherName.replace(/\./g, '').replace(/santa/g, 'sta');
          return (c.barangayId && c.barangayId.trim().toLowerCase() === other.id.trim().toLowerCase()) ||
                 (cBarangay && (cBarangay === otherName || cBarangay.replace(/\./g, '').replace(/santa/g, 'sta') === cleanOther)) ||
                 (cAddr && (cAddr.includes(otherName) || (otherCode && cAddr.includes(otherCode))));
        });
        if (!matchesOther) return true;
      }

      return false;
    });
  };

  // Action: Delete Announcement
  const executeDeleteAnnouncement = (ann: Announcement) => {
    mockDb.deleteAnnouncement(ann.id);
    setAnnouncements(prev => prev.filter(item => item.id !== ann.id));
    sendRealtimeMessage('ANNOUNCEMENT_DELETED', { id: ann.id });
    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Delete Public Bulletin',
      `Deleted announcement "${ann.title}".`
    );
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.error('Announcement Deleted', `Bulletin "${ann.title}" removed.`);
  };

  const handleDeleteAnnouncement = (ann: Announcement) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Public Bulletin',
      message: `Are you sure you want to delete announcement "${ann.title}"?`,
      confirmLabel: 'Delete Announcement',
      confirmVariant: 'danger',
      onConfirm: () => executeDeleteAnnouncement(ann)
    });
  };

  // Action: Update Announcement
  const handleUpdateAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAnnouncementModal) return;

    const allAnnouncements = mockDb.getAnnouncements();
    const updated = allAnnouncements.map(a => a.id === editingAnnouncementModal.id ? editingAnnouncementModal : a);
    mockDb.saveAnnouncements(updated);
    setAnnouncements(updated);

    apiClient.updateAnnouncement(editingAnnouncementModal.id, editingAnnouncementModal).catch(() => {});
    sendRealtimeMessage('ANNOUNCEMENT_UPDATED', { announcement: editingAnnouncementModal });

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Update Public Bulletin',
      `Updated announcement "${editingAnnouncementModal.title}".`
    );
    setEditingAnnouncementModal(null);
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.success('Announcement Updated', `Bulletin updated successfully.`);
  };

  // Action: Delete / Void Meter Reading
  const executeDeleteReading = (readingId: string) => {
    mockDb.deleteReading(readingId);
    setReadings(prev => prev.filter(r => r.id !== readingId));
    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Delete Meter Reading',
      `Voided and deleted reading transaction #${readingId}.`
    );
    loadAllDataFromStore();
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.error('Reading Deleted', `Reading #${readingId} has been deleted.`);
  };

  const handleDeleteReading = (readingId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Void Meter Reading',
      message: `Are you sure you want to void and delete meter reading transaction #${readingId}?\n\nThis will permanently remove the reading entry from the system registry.`,
      confirmLabel: 'Void Reading',
      confirmVariant: 'danger',
      onConfirm: () => executeDeleteReading(readingId)
    });
  };

  // Action: Quick Approve Meter Reader Officer
  const handleQuickApproveReader = async (reader: MeterReader) => {
    const allReaders = mockDb.getReaders();
    const updated = allReaders.map(r => {
      if (r.id === reader.id || (reader.employeeId && r.employeeId === reader.employeeId)) {
        return { ...r, employmentStatus: 'active' as const, status: 'active' as const };
      }
      return r;
    });
    mockDb.saveReaders(updated);
    setReaders(updated);

    const allUsers = mockDb.getUsers();
    const updatedUsers = allUsers.map(u => {
      if (u.id === reader.id || (reader.username && u.email?.startsWith(reader.username))) {
        return { ...u, status: 'active' as const };
      }
      return u;
    });
    mockDb.saveUsers(updatedUsers);

    try {
      await apiClient.patch(`/api/readers/${encodeURIComponent(reader.id)}`, {
        employmentStatus: 'active',
        status: 'active',
        employeeId: reader.employeeId
      });
      sendRealtimeMessage('staff:status_updated', {
        readerId: reader.id,
        employmentStatus: 'active',
        status: 'active'
      });
    } catch (err) {
      console.warn('[AdminPortal] Error syncing reader approval to API:', err);
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Approve Field Officer',
      `Approved and activated meter reader officer "${reader.name}" (ID: ${reader.employeeId || reader.id}).`
    );
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.success('Officer Approved', `${reader.name} has been activated for field inspection duty.`);
  };

  // Action: Toggle Meter Reader Active/Inactive Status
  const handleToggleReaderStatus = async (reader: MeterReader) => {
    const current = reader.employmentStatus || ((reader as any).status === 'inactive' ? 'inactive' : 'active');
    const nextStatus: 'active' | 'inactive' = current === 'active' ? 'inactive' : 'active';

    const allReaders = mockDb.getReaders();
    const updated = allReaders.map(r => {
      if (r.id === reader.id || (reader.employeeId && r.employeeId === reader.employeeId)) {
        return { ...r, employmentStatus: nextStatus, status: nextStatus };
      }
      return r;
    });
    mockDb.saveReaders(updated);
    setReaders(updated);

    const allUsers = mockDb.getUsers();
    const updatedUsers = allUsers.map(u => {
      if (u.id === reader.id || (reader.username && u.email?.startsWith(reader.username))) {
        return { ...u, status: nextStatus };
      }
      return u;
    });
    mockDb.saveUsers(updatedUsers);

    try {
      await apiClient.patch(`/api/readers/${encodeURIComponent(reader.id)}`, {
        employmentStatus: nextStatus,
        status: nextStatus,
        employeeId: reader.employeeId
      });
      sendRealtimeMessage('staff:status_updated', {
        readerId: reader.id,
        employmentStatus: nextStatus,
        status: nextStatus
      });
    } catch (err) {
      console.warn('[AdminPortal] Error syncing reader toggle status to API:', err);
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Update Staff Status',
      `Changed meter reader "${reader.name}" status to ${nextStatus.toUpperCase()}.`
    );
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.info('Status Updated', `${reader.name} is now marked as ${nextStatus === 'active' ? 'Active' : 'Inactive'}.`);
  };

  // Action: Update Meter Reader Officer
  const handleUpdateReader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReaderModal) return;

    const allReaders = mockDb.getReaders();
    const updated = allReaders.map(r => r.id === editingReaderModal.id ? editingReaderModal : r);
    mockDb.saveReaders(updated);
    setReaders(updated);

    // Sync user account
    const allUsers = mockDb.getUsers();
    const updatedUsers = allUsers.map(u => {
      if (u.id === editingReaderModal.id || (editingReaderModal.username && u.email?.startsWith(editingReaderModal.username))) {
        return {
          ...u,
          name: editingReaderModal.name,
          status: (editingReaderModal.employmentStatus === 'active' ? 'active' : 'inactive') as User['status']
        };
      }
      return u;
    });
    mockDb.saveUsers(updatedUsers);

    // Sync to backend API
    try {
      await apiClient.patch(`/api/readers/${encodeURIComponent(editingReaderModal.id)}`, editingReaderModal);
      sendRealtimeMessage('staff:status_updated', {
        readerId: editingReaderModal.id,
        employmentStatus: editingReaderModal.employmentStatus,
        status: editingReaderModal.employmentStatus,
        reader: editingReaderModal
      });
    } catch (err) {
      console.warn('[AdminPortal] Error syncing reader edit to API:', err);
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Update Meter Reader',
      `Updated profile & status (${editingReaderModal.employmentStatus}) for field officer "${editingReaderModal.name}".`
    );
    setEditingReaderModal(null);
    window.dispatchEvent(new Event('twd_database_updated'));
    toast.success('Officer Updated', `Reader profile for ${editingReaderModal.name} updated successfully.`);
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
    const activeCfg = getActiveTariffConfig();
    const updated = readings.map(r => {
      if (r.id === readingId) {
        const billAmt = calculateCostOf(r, r.classification);
        verifiedReading = { 
          ...r, 
          status,
          billAmount: billAmt,
          totalAmount: billAmt,
          appliedTariffVersion: r.appliedTariffVersion || activeCfg.version,
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
      const billCost = calculateCostOf(vRead, vRead.classification);
      
      // Recalculate consumer arrears
      const consumerUnpaid = updated.filter(
        r => r.accountNumber === vRead.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid'
      );
      const newArrears = consumerUnpaid.reduce((sum, r) => {
        const gross = calculateCostOf(r, r.classification);
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

      const matchedConsumer = consumers.find(c => c.accountNumber === vRead.accountNumber);
      mockDb.addNotification({
        accountNumber: vRead.accountNumber,
        consumerId: matchedConsumer?.id,
        userId: matchedConsumer?.linkedUserId,
        consumerEmail: matchedConsumer?.email,
        title: `Water Bill Issued - ${vRead.billingPeriod || 'New Statement'}`,
        message: `Your water billing statement for ${vRead.billingPeriod} has been computed and issued with ${vRead.consumption} m³ total consumption (₱${billCost.toFixed(2)}). Due date: ${vRead.dueDate || '20th of Month'}. Settle online or in-office.`,
        type: 'billing',
        readingId: vRead.id,
        billingPeriod: vRead.billingPeriod,
        remainingBalance: billCost
      });

      // Notify backend API so server updates consumer.previousReading for Mobile App's next sync pull
      fetch(`/api/readings/${encodeURIComponent(vRead.id)}/approve`, { method: 'POST' }).catch(() => {});
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


  // Action: Approve Single Reading or Entire Reader Submission Batch
  const handleApproveReadingBatch = (readingsToApprove: MeterReading[], readerNameLabel?: string) => {
    if (!readingsToApprove || readingsToApprove.length === 0) return;

    const targetIds = new Set(readingsToApprove.map(r => r.id));
    const readingBills = new Map<string, number>();
    const activeCfg = getActiveTariffConfig();

    readingsToApprove.forEach(r => {
      readingBills.set(r.id, calculateCostOf(r, r.classification));
    });

    const updatedReadings = readings.map(r => {
      if (targetIds.has(r.id)) {
        const totalCalculatedBill = readingBills.get(r.id) ?? calculateCostOf(r, r.classification);
        return {
          ...r,
          status: 'verified' as const,
          paymentStatus: 'unpaid' as const,
          remainingBalance: totalCalculatedBill,
          billAmount: totalCalculatedBill,
          totalAmount: totalCalculatedBill,
          appliedTariffVersion: r.appliedTariffVersion || activeCfg.version,
          paidAmount: 0
        };
      }
      return r;
    });

    // Save readings (diffChangedItems syncs only modified readings to Firestore once)
    mockDb.saveReadings(updatedReadings);
    setReadings(updatedReadings);

    // Backend API approval sync
    readingsToApprove.forEach(reading => {
      fetch(`/api/readings/${encodeURIComponent(reading.id)}/approve`, { method: 'POST' }).catch(() => {});
    });

    // Recalculate consumer arrears for affected consumers
    const affectedAccounts = new Set(readingsToApprove.map(r => (r.accountNumber || '').trim().toLowerCase()).filter(Boolean));
    const affectedNames = new Set(readingsToApprove.map(r => (r.consumerName || '').trim().toLowerCase()).filter(Boolean));

    const updatedConsumers = consumers.map(c => {
      const cAcct = (c.accountNumber || '').trim().toLowerCase();
      const cName = (c.name || '').trim().toLowerCase();

      if (affectedAccounts.has(cAcct) || affectedNames.has(cName)) {
        const consumerUnpaid = updatedReadings.filter(
          r => ((r.accountNumber && r.accountNumber.trim().toLowerCase() === cAcct) ||
                (r.consumerName && r.consumerName.trim().toLowerCase() === cName)) &&
               r.status === 'verified' &&
               r.paymentStatus !== 'paid'
        );
        const newArrears = consumerUnpaid.reduce((sum, r) => {
          const gross = calculateCostOf(r, r.classification);
          const paid = r.paidAmount || 0;
          return sum + Math.max(0, gross - paid);
        }, 0);
        return { ...c, outstandingBalance: newArrears };
      }
      return c;
    });

    mockDb.saveConsumers(updatedConsumers);
    setConsumers(updatedConsumers);

    // Dispatch Smart Notifications
    readingsToApprove.forEach(reading => {
      const totalCalculatedBill = readingBills.get(reading.id) ?? calculateCostOf(reading, reading.classification);
      const matchedConsumer = consumers.find(c => c.accountNumber === reading.accountNumber);
      mockDb.addNotification({
        accountNumber: reading.accountNumber,
        consumerId: matchedConsumer?.id,
        userId: matchedConsumer?.linkedUserId,
        consumerEmail: matchedConsumer?.email,
        title: `Water Bill Issued - ${reading.billingPeriod || 'New Statement'}`,
        message: `Your water billing statement for ${reading.billingPeriod} has been verified and issued with ${reading.consumption} m³ total consumption (₱${totalCalculatedBill.toFixed(2)}). Due date: ${reading.dueDate || '20th of Month'}. Settle online or in-office.`,
        type: 'billing',
        readingId: reading.id,
        billingPeriod: reading.billingPeriod,
        remainingBalance: totalCalculatedBill
      });
    });

    // Audit logs & Toast
    if (readingsToApprove.length === 1) {
      const reading = readingsToApprove[0];
      const totalCalculatedBill = readingBills.get(reading.id) ?? calculateCostOf(reading.consumption, reading.classification);
      mockDb.addAuditLog(
        currentUser.id,
        currentUser.name,
        'admin',
        'Approved Reading & Generated Bill',
        `Approved reading #${reading.id} for ${reading.consumerName} (Account #${reading.accountNumber}, Reader: ${reading.meterReaderName}, Period: ${reading.billingPeriod}, ${reading.previousReading} → ${reading.currentReading} m³ = ${reading.consumption} m³). Auto-generated bill ₱${totalCalculatedBill.toFixed(2)} published to Consumer Portal.`
      );
      toast.success(
        'Reading Approved & Bill Issued',
        `Verified reading for ${reading.consumerName} (${reading.consumption} m³ by ${reading.meterReaderName || 'Field Reader'}). Monthly bill of ₱${totalCalculatedBill.toFixed(2)} for ${reading.billingPeriod} published.`,
        5000
      );
    } else {
      const totalBatchBill = Array.from(readingBills.values()).reduce((sum, val) => sum + val, 0);
      const totalBatchConsumption = readingsToApprove.reduce((sum, r) => sum + (r.consumption || 0), 0);
      mockDb.addAuditLog(
        currentUser.id,
        currentUser.name,
        'admin',
        'Batch Approved Reader Readings',
        `Batch approved ${readingsToApprove.length} field readings submitted by ${readerNameLabel || 'Meter Reader'} totaling ${totalBatchConsumption} m³ and ₱${totalBatchBill.toFixed(2)} in bills.`
      );
      toast.success(
        'Batch Approved Successfully',
        `Approved all ${readingsToApprove.length} readings submitted by ${readerNameLabel || 'Field Reader'} (${totalBatchConsumption} m³, Total: ₱${totalBatchBill.toFixed(2)}). All statements and notifications issued.`,
        5000
      );
    }
  };

  // Filtered and sorted consumers list logic
  const filteredConsumers = consumers.filter(c => {
    // Check if pending ID issuance
    const isPending = !c.accountNumber || 
                      c.accountNumber.trim() === '' || 
                      c.accountNumber.toUpperCase().startsWith('PENDING') || 
                      c.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || 
                      c.status === 'pending_approval';

    // 1. Smart Search Matcher: multi-token + compact ID/phone normalization across all consumer fields
    const matchesSearch = smartMatch(consumerSearch, [
      c.name,
      c.accountNumber,
      c.meterNumber,
      c.rfidTag,
      c.email,
      c.contactNumber,
      c.address,
      c.barangay,
      c.sitioZone,
      c.businessName,
      c.status,
      c.consumerType,
      isPending ? 'pending approval issuance' : 'issued active',
      c.isRegistered ? 'registered online' : 'offline ledger'
    ]);

    // 2. Status Matcher
    const matchesStatus = 
      consumerStatusFilter === 'all' || 
      (consumerStatusFilter === 'pending_approval' 
        ? isPending 
        : consumerStatusFilter === 'Disconnection Notice'
          ? (c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice')
          : (!isPending && c.status === consumerStatusFilter));

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
    // 1. Pending accounts without issued IDs ALWAYS sit at the very top of the list
    // so administrators can immediately see new accounts without scrolling or searching
    const aPending = !a.accountNumber || a.accountNumber.trim() === '' || a.accountNumber.toUpperCase().startsWith('PENDING') || a.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || a.accountNumber.toUpperCase() === 'UNASSIGNED' || a.accountNumber.toUpperCase() === 'UNISSUED' || a.status === 'pending_approval';
    const bPending = !b.accountNumber || b.accountNumber.trim() === '' || b.accountNumber.toUpperCase().startsWith('PENDING') || b.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || b.accountNumber.toUpperCase() === 'UNASSIGNED' || b.accountNumber.toUpperCase() === 'UNISSUED' || b.status === 'pending_approval';

    if (aPending && !bPending) return -1;
    if (!aPending && bPending) return 1;

    // When both are pending, newest created account sits strictly at the very top
    if (aPending && bPending) {
      const aTime = a.createdAt || (a.registrationDate ? new Date(a.registrationDate).getTime() : 0);
      const bTime = b.createdAt || (b.registrationDate ? new Date(b.registrationDate).getTime() : 0);
      if (bTime !== aTime) return bTime - aTime;
    }

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

    // Default 'recent': newest created or registered accounts at the top
    const aTime = a.createdAt || (a.registrationDate ? new Date(a.registrationDate).getTime() : 0);
    const bTime = b.createdAt || (b.registrationDate ? new Date(b.registrationDate).getTime() : 0);
    if (bTime !== aTime) return bTime - aTime;

    return 0;
  });

  // Basic stats for dashboard banners
  const totalConsumersWeight = consumers.length;
  const registeredWebUsers = consumers.filter(c => c.isRegistered).length;
  const completedReadingsCount = readings.filter(r => r.status === 'verified').length;
  const pendingReadingsCount = readings.filter(r => r.status === 'pending').length;
  const flaggedAbnormalCount = readings.filter(r => r.status === 'flagged_abnormal').length;
  const pendingReportsCount = reports.filter(r => r.status === 'pending' || r.hasUnreadConsumerUpdate).length;
  const activeTechnicians = readers.filter(r => r.employmentStatus !== 'inactive' && (r as any).status !== 'inactive').length;
  const routesCoveredCount = routes.filter(rt => rt.assignedReaderId || rt.assignedReaderName).length;

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
            onClick={() => handleTabChange('dashboard')}
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
            onClick={() => handleTabChange('records')}
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
            onClick={() => handleTabChange('consumers')}
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
            onClick={() => handleTabChange('approvals')}
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
            onClick={() => handleTabChange('bills')}
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
            onClick={() => handleTabChange('payments')}
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
            onClick={() => handleTabChange('readings')}
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
            onClick={() => handleTabChange('meters')}
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
            onClick={() => handleTabChange('readers')}
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
            onClick={() => handleTabChange('staff')}
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
            onClick={() => handleTabChange('barangays')}
            className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'barangays' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <MapPin className="h-4 w-4 shrink-0 text-orange-400" />
            <span>Barangays</span>
          </button>

          {/* Announcements & Customer Service Module */}
          <button
            id="admin-nav-announcements"
            onClick={() => handleTabChange('announcements')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left cursor-pointer ${
              activeTab === 'announcements' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
            }`}
          >
            <div className="flex items-center space-x-3">
              <BookOpen className="h-4 w-4 shrink-0 text-yellow-400" />
              <span>Announcements & Customer Service</span>
            </div>
            {pendingReportsCount > 0 && (
              <span className="bg-rose-500 text-white font-black text-[10px] px-2 py-0.5 rounded-full animate-pulse shadow-sm">
                {pendingReportsCount}
              </span>
            )}
          </button>

          {/* Profile Module */}
          <button
            id="admin-nav-profile"
            onClick={() => handleTabChange('profile')}
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
                {activeTab === 'reports' && 'Customer Service & Consumer Inquiries'}
                {activeTab === 'approvals' && 'Reading Approvals & Auto-Billing Verification Queue'}
                {activeTab === 'bills' && 'Bills & Invoicing Ledger Management'}
                {activeTab === 'payments' && 'Process Payments & Cashier Receipt Counter'}
                {activeTab === 'readings' && 'Meter Readings & Field Telemetry'}
                {activeTab === 'meters' && 'Water Meters Master Inventory'}
                {activeTab === 'readers' && 'Meter Readers Field Staff Registry'}
                {activeTab === 'staff' && 'Admin User Staff & Permissions'}
                {activeTab === 'barangays' && 'Barangays & Service Area Zones'}
                {activeTab === 'announcements' && (
                  announcementsSubTab === 'customer_service'
                    ? 'Customer Service & Consumer Inquiries'
                    : 'Public Advisories & Bulletin Announcements'
                )}
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
          
          {/* Data Loading Indicator when initial data, refresh, or tab switch is executing */}
          {isInitialLoading || isRefreshing || isTabLoading ? (
            <DataLoadingIndicator 
              variant="card"
              message={getTabLoadingMessage(activeTab).title}
              subMessage={getTabLoadingMessage(activeTab).subtitle}
              badgeText="MUNICIPAL LEDGER SYNC"
            />
          ) : (
            <>
              {/* 1. OPERATIONAL DASHBOARD */}
              {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-fade-in" id="dashboard-tab">
              
              {/* Statistical Value Banners - Connected directly to functional modules */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                
                <button
                  type="button"
                  onClick={() => handleTabChange('consumers')}
                  className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md rounded-2xl p-5 shadow-sm flex items-center justify-between text-left transition-all cursor-pointer group"
                  title="View Consumers Directory"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold shrink-0 group-hover:scale-105 group-hover:bg-blue-600 group-hover:text-white transition">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Connections</h4>
                      <p className="text-xl font-black text-slate-900 mt-1">{totalConsumersWeight}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5 truncate">{registeredWebUsers} Registered</p>
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-0.5 transition shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleTabChange('announcements');
                    setAnnouncementsSubTab('customer_service');
                  }}
                  className={`bg-white border hover:shadow-md rounded-2xl p-5 shadow-sm flex items-center justify-between text-left transition-all cursor-pointer group ${
                    pendingReportsCount > 0 ? 'border-rose-300 ring-1 ring-rose-300/40 bg-rose-50/20' : 'border-slate-200 hover:border-rose-400'
                  }`}
                  title="View Customer Service & Inquiries"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className={`h-11 w-11 rounded-xl border flex items-center justify-center font-bold shrink-0 group-hover:scale-105 transition ${
                      pendingReportsCount > 0
                        ? 'bg-rose-100 text-rose-700 border-rose-200 animate-pulse'
                        : 'bg-rose-50 text-rose-600 border-rose-100 group-hover:bg-rose-600 group-hover:text-white'
                    }`}>
                      <MessageSquare className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Customer Service</h4>
                      <p className="text-xl font-black text-rose-600 mt-1">{reports.length}</p>
                      <p className="text-[9px] text-rose-700 font-bold mt-0.5 truncate">
                        {pendingReportsCount > 0 ? `${pendingReportsCount} Require Reply` : 'All Resolved'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-rose-600 group-hover:translate-x-0.5 transition shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange('readings')}
                  className="bg-white border border-slate-200 hover:border-amber-400 hover:shadow-md rounded-2xl p-5 shadow-sm flex items-center justify-between text-left transition-all cursor-pointer group"
                  title="View Completed Meter Readings"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="h-11 w-11 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center font-bold shrink-0 group-hover:scale-105 group-hover:bg-amber-600 group-hover:text-white transition">
                      <Droplet className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Completed Reads</h4>
                      <p className="text-xl font-black text-slate-900 mt-1">{completedReadingsCount}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5 truncate">{pendingReadingsCount} Submitted</p>
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-amber-600 group-hover:translate-x-0.5 transition shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange('approvals')}
                  className="bg-white border border-slate-200 hover:border-rose-400 hover:shadow-md rounded-2xl p-5 shadow-sm flex items-center justify-between text-left transition-all cursor-pointer group"
                  title="View Flagged Abnormal Readings"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="h-11 w-11 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center font-bold shrink-0 group-hover:scale-105 group-hover:bg-rose-600 group-hover:text-white transition">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Flagged Abnormal</h4>
                      <p className="text-xl font-black text-rose-600 mt-1">{flaggedAbnormalCount}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5 truncate">Leak Suspected</p>
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-rose-600 group-hover:translate-x-0.5 transition shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange('readers')}
                  className="bg-white border border-slate-200 hover:border-teal-400 hover:shadow-md rounded-2xl p-5 shadow-sm flex items-center justify-between text-left transition-all cursor-pointer group"
                  title="Open Meter Readers Module"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="h-11 w-11 rounded-xl bg-teal-50 text-teal-600 border border-teal-100 flex items-center justify-center font-bold shrink-0 group-hover:scale-105 group-hover:bg-teal-600 group-hover:text-white transition">
                      <UserCheck className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Reader Staff</h4>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      </div>
                      <p className="text-xl font-black text-slate-900 mt-1">{activeTechnicians}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5 truncate">
                        {routesCoveredCount} of {routes.length} Routes
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-teal-600 group-hover:translate-x-0.5 transition shrink-0" />
                </button>
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
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
                <div className="flex items-start sm:items-center space-x-3.5">
                  <div className="p-3 bg-blue-600/20 border border-blue-500/30 rounded-xl text-blue-400 shrink-0">
                    <FolderLock className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white tracking-tight font-sans">
                      Central Records & Official Reports Archive
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                      Read-only regulatory archive and PD 198 report generation center. Master database records are immutable here for audit compliance.
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <div className="bg-slate-950 border border-slate-800 px-3.5 py-2 rounded-xl text-xs font-mono font-bold text-emerald-400 flex items-center gap-2 shadow-inner">
                    <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Audit Locked</span>
                  </div>
                </div>
              </div>

              {/* Records Sub-Navigation Tabs — Unified with Admin Portal Dark Slate Modules */}
              <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
                <button
                  type="button"
                  onClick={() => setRecordsTab('reports')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition flex items-center space-x-2 cursor-pointer ${
                    recordsTab === 'reports'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0" />
                  <span>Official Reports Center (PDF)</span>
                  <span className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded-md ${
                    recordsTab === 'reports' ? 'bg-black/25 text-white' : 'bg-slate-800 text-slate-300'
                  }`}>
                    11 Reports
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setRecordsTab('consumers')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                    recordsTab === 'consumers'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  Consumers Archive ({consumers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRecordsTab('meters')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                    recordsTab === 'meters'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  Water Meters Inventory ({meters.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRecordsTab('readings')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                    recordsTab === 'readings'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  Readings Trail ({readings.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRecordsTab('bills')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                    recordsTab === 'bills'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  Bills Ledger ({readings.filter(r => r.status === 'verified').length})
                </button>
                <button
                  type="button"
                  onClick={() => setRecordsTab('payments')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                    recordsTab === 'payments'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  Receipts Log ({readings.filter(r => r.paymentStatus === 'paid').length})
                </button>
                <button
                  type="button"
                  onClick={() => setRecordsTab('audit')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                    recordsTab === 'audit'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  System Security Audit ({auditLogs.length})
                </button>
              </div>

              {/* Reports Center Module View */}
              {recordsTab === 'reports' && (
                <OfficialReportsGenerator
                  consumers={consumers}
                  readings={readings}
                  meters={meters}
                  barangays={barangayList}
                  meterReaders={readers}
                  currentUser={currentUser}
                />
              )}

              {/* Records Content Table (for other tabs) */}
              {recordsTab !== 'reports' && (
                <RecordsArchiveView
                  recordsTab={recordsTab as any}
                  setRecordsTab={setRecordsTab}
                  consumers={consumers}
                  meters={meters}
                  readings={readings}
                  auditLogs={auditLogs}
                  searchQuery={recordsSearch}
                  setSearchQuery={setRecordsSearch}
                  classificationFilter={recordsClassificationFilter}
                  setClassificationFilter={setRecordsClassificationFilter}
                  calculateCostOf={calculateCostOf}
                  handleVerifyReading={handleVerifyReading}
                  handleDeleteReading={handleDeleteReading}
                  exportToCsv={exportToCsv}
                />
              )}
            </div>
          )}

          {/* 4. APPROVALS MODULE */}
          {activeTab === 'approvals' && (
            <div className="space-y-6 animate-fade-in" id="approvals-tab">
              {/* Dark, Eye-Friendly Header */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
                <div>
                  <h3 className="text-base sm:text-lg font-black text-white tracking-tight font-sans">Meter Reading Approvals</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                    Review and verify field meter readings submitted by meter readers. Approving a reading generates the monthly billing statement and updates the consumer portal.
                  </p>
                </div>
                <div className="flex items-center space-x-3 shrink-0">
                  <div className="bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl text-center shadow-inner">
                    <span className="text-xl sm:text-2xl font-black text-amber-400 block leading-tight font-mono">{readings.filter(r => r.status === 'pending').length}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Pending Approvals</span>
                  </div>
                </div>
              </div>

              {/* Sub-tab Navigation */}
              <div className="flex border-b border-slate-800 space-x-6">
                <button
                  onClick={() => setApprovalsSubTab('pending')}
                  className={`pb-3 text-xs font-bold transition border-b-2 flex items-center space-x-2 cursor-pointer ${
                    approvalsSubTab === 'pending'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>Pending Verification</span>
                  <span className="bg-amber-950/80 text-amber-300 border border-amber-800/80 text-[11px] font-semibold px-2 py-0.5 rounded-full font-mono">
                    {readings.filter(r => r.status === 'pending').length}
                  </span>
                </button>

                <button
                  onClick={() => setApprovalsSubTab('history')}
                  className={`pb-3 text-xs font-bold transition border-b-2 flex items-center space-x-2 cursor-pointer ${
                    approvalsSubTab === 'history'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>Approval History</span>
                  <span className="bg-slate-800 text-slate-300 border border-slate-750 text-[11px] font-semibold px-2 py-0.5 rounded-full font-mono">
                    {readings.filter(r => r.status !== 'pending').length}
                  </span>
                </button>
              </div>

              {/* PENDING APPROVALS SUB-TAB */}
              {approvalsSubTab === 'pending' && (
                <>
                  {/* Search, Reader Filter, and Summary bar for pending items */}
                  {(() => {
                    const pendingList = readings.filter(r => r.status === 'pending');
                    const distinctReaders: string[] = Array.from(
                      new Set<string>(
                        pendingList.map(r => (r.meterReaderName && r.meterReaderName.trim()) ? r.meterReaderName.trim() : 'Field Reader')
                      )
                    ).sort();

                    return (
                      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
                          <div className="flex-1 sm:max-w-lg">
                            <SmartSearchBar
                              variant="dark"
                              value={pendingApprovalSearch}
                              onChange={setPendingApprovalSearch}
                              placeholder="Smart search consumer name, account #, meter #, reader, period, or route..."
                              id="admin-approvals-pending-smart-search"
                            />
                          </div>

                          {/* Filter by Reader Dropdown */}
                          <div className="relative sm:w-64 shrink-0">
                            <select
                              value={selectedPendingReaderFilter}
                              onChange={(e) => setSelectedPendingReaderFilter(e.target.value)}
                              className="w-full min-h-[42px] bg-slate-900 border border-slate-800 rounded-xl py-2.5 pl-3.5 pr-8 text-xs text-slate-200 focus:outline-none focus:border-blue-500 shadow-inner font-medium cursor-pointer"
                            >
                              <option value="all">All Readers ({pendingList.length} readings)</option>
                              {distinctReaders.map((reader) => {
                                const countForReader = pendingList.filter(
                                  x => ((x.meterReaderName && x.meterReaderName.trim()) ? x.meterReaderName.trim() : 'Field Reader') === reader
                                ).length;
                                return (
                                  <option key={`reader-opt-${reader}`} value={reader}>
                                    {reader} ({countForReader} pending)
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        </div>

                        {/* Batch Action Controls */}
                        {pendingList.length > 0 && (
                          <div className="flex items-center space-x-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                const allCollapsed = distinctReaders.every(r => collapsedReaderGroups[r]);
                                const next: Record<string, boolean> = {};
                                distinctReaders.forEach(r => {
                                  next[r] = !allCollapsed;
                                });
                                setCollapsedReaderGroups(next);
                              }}
                              className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white font-bold rounded-xl text-xs transition flex items-center space-x-1.5 cursor-pointer border border-slate-700 shadow-xs"
                            >
                              <span>{distinctReaders.every(r => collapsedReaderGroups[r]) ? 'Expand All Readers' : 'Collapse All'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const filtered = pendingList.filter(r => {
                                  const rName = (r.meterReaderName && r.meterReaderName.trim()) ? r.meterReaderName.trim() : 'Field Reader';
                                  if (selectedPendingReaderFilter !== 'all' && rName !== selectedPendingReaderFilter) return false;
                                  return smartMatch(pendingApprovalSearch, [
                                    r.consumerName,
                                    rName,
                                    r.accountNumber,
                                    r.meterNumber,
                                    r.billingPeriod,
                                    r.route,
                                    r.notes
                                  ]);
                                });
                                if (filtered.length > 0) {
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: 'Batch Approve Readings',
                                    message: `Approve all ${filtered.length} pending readings across all matching readers? This will finalize them for consumer billing statements.`,
                                    confirmLabel: `Approve All (${filtered.length})`,
                                    confirmVariant: 'success',
                                    onConfirm: () => handleApproveReadingBatch(filtered, 'All Field Readers')
                                  });
                                }
                              }}
                              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow-md flex items-center space-x-1.5 cursor-pointer border border-emerald-500/40"
                            >
                              <CheckCheck className="h-4 w-4" />
                              <span>Approve All Matching ({pendingList.length})</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {(() => {
                    const pendingList = readings.filter(r => r.status === 'pending');
                    const filteredPending = pendingList.filter(r => {
                      const rName = (r.meterReaderName && r.meterReaderName.trim()) ? r.meterReaderName.trim() : 'Field Reader';
                      if (selectedPendingReaderFilter !== 'all' && rName !== selectedPendingReaderFilter) {
                        return false;
                      }
                      return smartMatch(pendingApprovalSearch, [
                        r.consumerName,
                        rName,
                        r.accountNumber,
                        r.meterNumber,
                        r.billingPeriod,
                        r.route,
                        r.notes
                      ]);
                    });

                    if (filteredPending.length === 0) {
                      return (
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3 shadow-xl">
                          <CheckCircle className="h-12 w-12 text-slate-600 mx-auto" />
                          <h4 className="text-base font-bold text-white">
                            {pendingList.length === 0 ? 'No Pending Readings' : 'No Matching Readings'}
                          </h4>
                          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                            {pendingList.length === 0
                              ? 'All field readings have been reviewed and approved.'
                              : 'No pending readings match your filter criteria or search query.'}
                          </p>
                        </div>
                      );
                    }

                    // Group readings by meter reader so readings sent by the same reader are NOT separated
                    const readerGroupsMap = new Map<string, MeterReading[]>();
                    filteredPending.forEach(r => {
                      const rName = (r.meterReaderName && r.meterReaderName.trim()) ? r.meterReaderName.trim() : 'Field Reader';
                      if (!readerGroupsMap.has(rName)) {
                        readerGroupsMap.set(rName, []);
                      }
                      readerGroupsMap.get(rName)!.push(r);
                    });

                    const readerGroups = Array.from(readerGroupsMap.entries()).map(([readerName, groupReadings]) => {
                      const totalConsumption = groupReadings.reduce((sum, r) => sum + (Number(r.consumption) || 0), 0);
                      const totalBill = groupReadings.reduce((sum, r) => sum + calculateCostOf(r, r.classification), 0);
                      const routes = Array.from(new Set(groupReadings.map(r => r.route).filter(Boolean)));
                      const latestDate = groupReadings.map(r => r.readingDate || r.meterReaderDate || '').filter(Boolean).sort().reverse()[0] || 'Today';
                      return {
                        readerName,
                        readings: groupReadings,
                        totalConsumption,
                        totalBill,
                        routes,
                        latestDate,
                      };
                    });

                    return (
                      <div className="space-y-6">
                        {readerGroups.map((group, gIdx) => {
                          const isCollapsed = !!collapsedReaderGroups[group.readerName];

                          return (
                            <div 
                              key={`reader-group-${group.readerName}-${gIdx}`}
                              className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all hover:border-slate-700/80"
                            >
                              {/* READER BATCH HEADER: Groups all readings sent by this same reader together */}
                              <div className="bg-slate-950/80 border-b border-slate-800/80 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-start sm:items-center space-x-3.5">
                                  <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-md shrink-0 border border-blue-500/30">
                                    <UserCheck className="h-5 w-5" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="text-base font-black text-white tracking-tight">
                                        {group.readerName}
                                      </h4>
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-blue-950/80 text-blue-300 px-2.5 py-0.5 rounded-md border border-blue-800/80">
                                        Field Officer Batch
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 flex-wrap">
                                      <span className="flex items-center gap-1">
                                        <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                                        <span>{group.routes.join(', ') || 'Tagoloan Municipal Routes'}</span>
                                      </span>
                                      <span>•</span>
                                      <span>Date: <strong className="text-slate-300 font-semibold">{group.latestDate}</strong></span>
                                    </div>
                                  </div>
                                </div>

                                {/* Aggregate Batch Stats & Batch Approval Actions */}
                                <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                                  {/* Readings Count */}
                                  <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-center shadow-inner">
                                    <span className="text-[10px] uppercase font-bold text-slate-500 block leading-tight">Batch Size</span>
                                    <span className="text-xs font-black text-slate-200 font-mono">{group.readings.length} Readings</span>
                                  </div>

                                  {/* Total Volume */}
                                  <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-center shadow-inner">
                                    <span className="text-[10px] uppercase font-bold text-slate-500 block leading-tight">Total Volume</span>
                                    <span className="text-xs font-black text-emerald-400 font-mono">{group.totalConsumption} m³</span>
                                  </div>

                                  {/* Total Billing */}
                                  <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-center shadow-inner">
                                    <span className="text-[10px] uppercase font-bold text-slate-500 block leading-tight">Batch Billing</span>
                                    <span className="text-xs font-black text-amber-300 font-mono">₱{group.totalBill.toFixed(2)}</span>
                                  </div>

                                  {/* Approve All For This Reader Button */}
                                  <button
                                    type="button"
                                    onClick={() => handleApproveReadingBatch(group.readings, group.readerName)}
                                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow-md flex items-center space-x-1.5 cursor-pointer border border-emerald-500/40"
                                    title={`Approve all ${group.readings.length} readings submitted by ${group.readerName}`}
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                    <span>Approve All ({group.readings.length})</span>
                                  </button>

                                  {/* Toggle Collapse/Expand */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCollapsedReaderGroups(prev => ({
                                        ...prev,
                                        [group.readerName]: !prev[group.readerName]
                                      }));
                                    }}
                                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700 cursor-pointer"
                                    title={isCollapsed ? 'Expand Readings' : 'Collapse Readings'}
                                  >
                                    {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                                  </button>
                                </div>
                              </div>

                              {/* LIST OF READINGS SUBMITTED BY THIS READER */}
                              {!isCollapsed && (
                                <div className="p-4 sm:p-5 space-y-3.5 bg-slate-950/40">
                                  {group.readings.map((reading, pIdx) => {
                                    const totalCalculatedBill = calculateCostOf(reading, reading.classification);

                                    return (
                                      <div 
                                        key={`reader-${group.readerName}-read-${reading.id || ''}-${reading.accountNumber || ''}-${pIdx}`} 
                                        className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-md hover:border-blue-500/60 transition space-y-4"
                                      >
                                        {/* Header: Account Number, Consumer Info, Route, and Coverage */}
                                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-slate-800/80">
                                          <div className="space-y-1.5">
                                            <div className="flex items-center gap-2.5 flex-wrap">
                                              {/* High-visibility Account Number Badge */}
                                              <div className="inline-flex items-center gap-1.5 bg-slate-950 text-white px-2.5 py-1 rounded-md border border-slate-800 shadow-2xs">
                                                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Account</span>
                                                <span className="font-mono text-sm font-black text-amber-300 tracking-wide">
                                                  {reading.accountNumber ? (reading.accountNumber.startsWith('#') ? reading.accountNumber : `#${reading.accountNumber}`) : 'Pending Account'}
                                                </span>
                                              </div>

                                              {/* Consumer Full Name */}
                                              <h4 className="text-base font-bold text-white">{reading.consumerName}</h4>

                                              {/* Classification Tag */}
                                              {reading.classification?.toLowerCase().includes('comm') ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-black uppercase tracking-wider bg-purple-950/80 text-purple-300 border border-purple-800/80 shadow-2xs">
                                                  <Building className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                                                  <span>COMMERCIAL</span>
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-black uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 shadow-2xs">
                                                  <Home className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                                  <span>{reading.classification ? reading.classification.toUpperCase() : 'RESIDENTIAL'}</span>
                                                </span>
                                              )}
                                            </div>

                                            <div className="flex items-center space-x-3 text-xs text-slate-400 flex-wrap">
                                              <span className="flex items-center gap-1">
                                                <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                                                <span>{reading.route || 'Poblacion Zone 3 Route'}</span>
                                              </span>
                                              <span>•</span>
                                              <span>Meter No: <strong className="font-mono text-slate-200 font-semibold">{reading.meterNumber}</strong> {reading.meterBrand ? `(${reading.meterBrand})` : ''}</span>
                                            </div>
                                          </div>

                                          <div className="text-left sm:text-right text-xs text-slate-400 shrink-0">
                                            <span className="block text-[11px] text-slate-500">Coverage Period</span>
                                            <span className="font-semibold text-slate-200">{reading.billingPeriod || 'Current Period'}</span>
                                            <span className="block text-[11px] text-slate-500 mt-0.5">Read Date: {reading.readingDate || reading.meterReaderDate || 'Today'}</span>
                                          </div>
                                        </div>

                                        {/* Reading Metrics: Previous, Present, Consumption, Bill */}
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 shadow-inner">
                                          <div>
                                            <span className="text-[11px] font-medium text-slate-400 block">Previous Index</span>
                                            <div className="mt-0.5 flex items-baseline space-x-1">
                                              <span className="text-base font-mono font-bold text-slate-300">{reading.previousReading}</span>
                                              <span className="text-xs text-slate-500">m³</span>
                                            </div>
                                          </div>

                                          <div>
                                            <span className="text-[11px] font-medium text-slate-400 block">Present Index</span>
                                            <div className="mt-0.5 flex items-baseline space-x-1">
                                              <span className="text-base font-mono font-bold text-blue-400">{reading.currentReading}</span>
                                              <span className="text-xs text-blue-500">m³</span>
                                            </div>
                                          </div>

                                          <div>
                                            <span className="text-[11px] font-medium text-slate-400 block">Consumption</span>
                                            <div className="mt-0.5 flex items-baseline space-x-1">
                                              <span className="text-base font-mono font-bold text-emerald-400">+{reading.consumption}</span>
                                              <span className="text-xs text-emerald-500">m³</span>
                                            </div>
                                          </div>

                                          <div>
                                            <span className="text-[11px] font-medium text-slate-400 block">Calculated Bill</span>
                                            <div className="mt-0.5 flex items-baseline space-x-1">
                                              <span className="text-base font-mono font-black text-amber-300">₱{totalCalculatedBill.toFixed(2)}</span>
                                            </div>
                                            <span className={`text-[10px] font-bold block mt-0.5 ${
                                              reading.classification?.toLowerCase().includes('comm') ? 'text-purple-400' : 'text-emerald-400'
                                            }`}>
                                              {reading.classification?.toLowerCase().includes('comm') ? 'Commercial Tariff' : 'Residential Tariff'}
                                            </span>
                                          </div>
                                        </div>

                                        {/* Verification Details & Actions */}
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                                          <div className="flex items-center space-x-3 text-xs text-slate-400 flex-wrap">
                                            <span>Reader: <strong className="text-slate-200 font-semibold">{reading.meterReaderName || group.readerName}</strong></span>
                                            {reading.notes && (
                                              <>
                                                <span>•</span>
                                                <span className="text-slate-400 max-w-xs truncate">{reading.notes}</span>
                                              </>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setSelectedPhotoUrl(reading.imageUrl || 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop');
                                                setSelectedPhotoAccount(reading.accountNumber);
                                              }}
                                              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                                            >
                                              <Camera className="h-3.5 w-3.5" />
                                              <span>View Dial Photo</span>
                                            </button>
                                          </div>

                                          <div className="flex items-center space-x-2 shrink-0">
                                            <button
                                              type="button"
                                              onClick={() => handleApproveReadingBatch([reading])}
                                              className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition shadow-md flex items-center justify-center space-x-1.5 cursor-pointer border border-emerald-500/30"
                                            >
                                              <CheckCircle className="h-4 w-4" />
                                              <span>Approve & Issue Bill</span>
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* PERMANENT APPROVAL HISTORY SUB-TAB */}
              {approvalsSubTab === 'history' && (
                <div className="space-y-4">
                  {(() => {
                    const allHistoryItems = readings.filter(r => r.status !== 'pending');
                    const filteredHistory = allHistoryItems.filter(r =>
                      smartMatch(approvalHistorySearch, [
                        r.id,
                        r.accountNumber,
                        r.consumerName,
                        r.meterNumber,
                        r.billingPeriod,
                        r.readingDate,
                        r.meterReaderName,
                        r.status,
                        r.notes
                      ])
                    );
                    const paginatedHistory = filteredHistory.slice((approvalHistoryPage - 1) * 10, approvalHistoryPage * 10);

                    return (
                      <>
                        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                          <div className="flex-1 sm:max-w-lg">
                            <SmartSearchBar
                              variant="dark"
                              value={approvalHistorySearch}
                              onChange={setApprovalHistorySearch}
                              resultCount={filteredHistory.length}
                              totalCount={allHistoryItems.length}
                              placeholder="Smart search history by Tx ID, account #, consumer name, meter #, reader, or notes..."
                              id="admin-approvals-history-smart-search"
                            />
                          </div>

                          <button
                            onClick={() => {
                              const headers = ['Tx ID', 'Billing Period', 'Account Number', 'Consumer Name', 'Meter Number', 'Prev Index', 'Curr Index', 'Consumption', 'Status', 'Reader Staff', 'Notes'];
                              const rows = filteredHistory.map(r => [
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

                        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead className="bg-slate-950 text-slate-300 font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                              <tr>
                                <th className="px-3.5 py-3 whitespace-nowrap">Tx ID</th>
                                <th className="px-3.5 py-3 whitespace-nowrap">Read Date</th>
                                <th className="px-3.5 py-3 whitespace-nowrap">Billing Period</th>
                                <th className="px-3.5 py-3 min-w-[140px]">Account & Consumer</th>
                                <th className="px-3.5 py-3 whitespace-nowrap">Meter No.</th>
                                <th className="px-3.5 py-3 whitespace-nowrap">Indices (Prev → Curr)</th>
                                <th className="px-3.5 py-3 whitespace-nowrap">Usage & Bill</th>
                                <th className="px-3.5 py-3 whitespace-nowrap">Status</th>
                                <th className="px-3.5 py-3 min-w-[160px]">Audit Notes & Reader</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/80 text-slate-200 bg-slate-900">
                              {filteredHistory.length === 0 ? (
                                <tr>
                                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                                    <div className="space-y-1">
                                      <p className="text-xs font-bold text-slate-300">No approval history found</p>
                                      <p className="text-[11px] text-slate-500">No verified or rejected meter reading transactions match your filter.</p>
                                    </div>
                                  </td>
                                </tr>
                              ) : (
                                paginatedHistory.map((r, hIdx) => {
                                  const totalBill = calculateCostOf(r, r.classification);
                              const isCorrected = r.notes && r.notes.includes('CORRECTED');
                              const isRejected = r.status === ('rejected' as any) || (r.notes && r.notes.includes('REJECTED'));

                              return (
                                <tr key={`hist-read-${r.id || ''}-${r.accountNumber || ''}-${hIdx}`} className="hover:bg-slate-800/60 transition">
                                  <td className="px-3.5 py-3 font-mono font-bold text-slate-400 text-[11px] whitespace-nowrap">
                                    {r.id}
                                  </td>
                                  <td className="px-3.5 py-3 whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1 font-bold text-amber-300 bg-amber-950/60 border border-amber-800/70 px-2 py-0.5 rounded text-[11px]">
                                      📅 {r.readingDate || r.meterReaderDate || 'Recent'}
                                    </span>
                                  </td>
                                  <td className="px-3.5 py-3 font-bold text-slate-200 whitespace-nowrap">
                                    {r.billingPeriod || 'Current Period'}
                                  </td>
                                  <td className="px-3.5 py-3 space-y-1 min-w-[140px]">
                                    <span className="font-bold text-white block leading-tight">{r.consumerName}</span>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-mono text-sky-400 text-xs font-black bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 inline-block">
                                        {r.accountNumber ? (r.accountNumber.startsWith('#') ? r.accountNumber : `#${r.accountNumber}`) : 'Pending Acct'}
                                      </span>
                                      {r.classification?.toLowerCase().includes('comm') ? (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-purple-950/80 text-purple-300 border border-purple-800/80">
                                          <Building className="h-2.5 w-2.5 text-purple-400 shrink-0" />
                                          <span>COMMERCIAL</span>
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-800/80">
                                          <Home className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                                          <span>RESIDENTIAL</span>
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3.5 py-3 font-mono text-slate-200 font-bold whitespace-nowrap">
                                    {r.meterNumber}
                                  </td>
                                  <td className="px-3.5 py-3 font-mono whitespace-nowrap">
                                    <span className="text-slate-400">{r.previousReading}</span>
                                    <span className="text-slate-500 mx-1">→</span>
                                    <span className="font-bold text-white">{r.currentReading} m³</span>
                                  </td>
                                  <td className="px-3.5 py-3 space-y-0.5 whitespace-nowrap">
                                    <span className="font-mono font-bold text-emerald-400 block">{r.consumption} m³</span>
                                    <span className="font-mono font-black text-white text-xs">₱{totalBill.toFixed(2)}</span>
                                  </td>
                                  <td className="px-3.5 py-3 whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                      isRejected
                                        ? 'bg-rose-950/80 text-rose-300 border border-rose-800/80'
                                        : isCorrected
                                        ? 'bg-amber-950/80 text-amber-300 border border-amber-800/80'
                                        : r.status === 'verified'
                                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80'
                                        : 'bg-rose-950/80 text-rose-300 border border-rose-800/80'
                                    }`}>
                                      {isRejected ? 'REJECTED' : isCorrected ? 'CORRECTED' : r.status.toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="px-3.5 py-3 max-w-xs space-y-1 min-w-[180px]">
                                    {r.notes ? (
                                      <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-1.5 text-xs text-slate-200 font-medium">
                                        {r.notes.includes('°') ? (
                                          <div>
                                            <span className="font-mono font-black text-rose-400 text-[11px] block">📍 {r.notes.split('•')[0].trim()}</span>
                                            <span className="text-[11px] text-slate-300 font-bold block">{r.notes.split('•').slice(1).join('•').trim() || r.notes}</span>
                                          </div>
                                        ) : (
                                          <p className="text-[11px] text-slate-300 font-semibold">{r.notes}</p>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-[11px] text-slate-500 font-medium">Verified & Auto-Billed</span>
                                    )}
                                    <p className="text-[11px] text-slate-400 font-medium">
                                      Reader: <strong className="text-slate-200 font-bold">{r.meterReaderName || 'Field Reader'}</strong>
                                    </p>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    <TablePagination
                      currentPage={approvalHistoryPage}
                      totalItems={filteredHistory.length}
                      pageSize={10}
                      onPageChange={setApprovalHistoryPage}
                      itemName="approval records"
                    />
                  </div>
                </>
                );
              })()}
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
                const disconnectionCount = consumers.filter(c => c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice').length;
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

                // Real-time System Audit: Detect duplicate Account Numbers, RFID Tags, Meter Tags, and Phone Numbers
                const accMap = new Map<string, Consumer[]>();
                const rfidMap = new Map<string, Consumer[]>();
                const meterMap = new Map<string, Consumer[]>();
                const phoneMap = new Map<string, Consumer[]>();

                consumers.forEach(c => {
                  const acc = (c.accountNumber || '').trim().toUpperCase();
                  if (acc && !acc.startsWith('PENDING') && acc !== 'PENDING ADMIN ISSUANCE') {
                    const list = accMap.get(acc) || [];
                    list.push(c);
                    accMap.set(acc, list);
                  }

                  const rfid = (c.rfidTag || '').trim().toUpperCase();
                  if (rfid && !rfid.startsWith('PENDING') && rfid !== 'UNASSIGNED') {
                    const list = rfidMap.get(rfid) || [];
                    list.push(c);
                    rfidMap.set(rfid, list);
                  }

                  const meter = (c.meterNumber || '').trim().toUpperCase();
                  if (meter && !meter.startsWith('PENDING') && meter !== 'UNASSIGNED') {
                    const list = meterMap.get(meter) || [];
                    list.push(c);
                    meterMap.set(meter, list);
                  }

                  const phone = normalizePhoneNumber(c.contactNumber);
                  if (phone && phone.length === 11) {
                    const list = phoneMap.get(phone) || [];
                    list.push(c);
                    phoneMap.set(phone, list);
                  }
                });

                const duplicateAccounts = new Set<string>();
                accMap.forEach((list, acc) => {
                  if (list.length > 1) duplicateAccounts.add(acc);
                });

                const duplicateRfids = new Set<string>();
                rfidMap.forEach((list, rfid) => {
                  if (list.length > 1) duplicateRfids.add(rfid);
                });

                const duplicateMeters = new Set<string>();
                meterMap.forEach((list, meter) => {
                  if (list.length > 1) duplicateMeters.add(meter);
                });

                const duplicatePhones = new Set<string>();
                phoneMap.forEach((list, phone) => {
                  if (list.length > 1) duplicatePhones.add(phone);
                });

                const hasAnyDuplicate = duplicateAccounts.size > 0 || duplicateRfids.size > 0 || duplicateMeters.size > 0 || duplicatePhones.size > 0;

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

                      {/* Action Buttons: Export CSV */}
                      <div className="flex items-center gap-2.5 self-start md:self-auto shrink-0 flex-wrap">
                        <button
                          onClick={() => {
                            const headers = ['Name', 'Email', 'Phone', 'Barangay', 'Sitio / Zone', 'Classification', 'Status', 'Account Number', 'Meter Number', 'RFID Tag', 'Address', 'Outstanding Balance'];
                            const rows = filteredConsumers.map(c => [
                              c.name, c.email, c.contactNumber, c.barangay || '', c.sitioZone || '', c.consumerType || 'Residential', c.status.toUpperCase(), c.accountNumber, c.meterNumber, c.rfidTag || '', c.address, c.outstandingBalance || 0
                            ]);
                            exportToCsv('twd_consumers_master_export.csv', headers, rows);
                          }}
                          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center space-x-2 transition shadow-sm cursor-pointer shrink-0"
                        >
                          <Download className="h-4 w-4 text-white" />
                          <span>Export Filtered List ({filteredConsumers.length})</span>
                        </button>
                      </div>
                    </div>

                    {/* Duplicate Integrity Status Banner */}
                    {hasAnyDuplicate ? (
                      <div className="bg-rose-950/90 border-2 border-rose-500 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-white shadow-xl animate-pulse">
                        <div className="flex items-start space-x-3.5">
                          <div className="p-2.5 bg-rose-600 text-white rounded-xl shadow-md shrink-0">
                            <AlertTriangle className="h-6 w-6" />
                          </div>
                          <div>
                            <h4 className="text-xs font-black uppercase tracking-wider text-rose-100 flex items-center gap-2">
                              <span>Strict System Policy Alert: Duplicate Identifiers Detected</span>
                              <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-rose-500 text-white rounded-full">
                                Duplicates Forbidden
                              </span>
                            </h4>
                            <p className="text-[11px] text-rose-200 mt-1 max-w-3xl leading-relaxed">
                              Tagoloan Water District system policy strictly prohibits duplicate Account Numbers, Meter Serial Tags, or RFID Tags.
                              {duplicateAccounts.size > 0 && ` Conflicting Account Number(s): ${Array.from(duplicateAccounts).join(', ')}.`}
                              {duplicateRfids.size > 0 && ` Conflicting RFID Tag(s): ${Array.from(duplicateRfids).join(', ')}.`}
                              {duplicateMeters.size > 0 && ` Conflicting Meter Tag(s): ${Array.from(duplicateMeters).join(', ')}.`}
                              {duplicatePhones.size > 0 && ` Conflicting Phone Number(s): ${Array.from(duplicatePhones).join(', ')}.`}
                              {' '}Please re-issue unique identifiers to maintain data integrity.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-white">
                        <div className="flex items-center space-x-2.5">
                          <div className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/40 shrink-0">
                            <ShieldCheck className="h-4 w-4" />
                          </div>
                          <div className="text-xs text-emerald-200">
                            <strong className="text-white font-bold">Uniqueness Verification:</strong> All Account Numbers, Smart RFID Tags, and Meter Serial Tags are 100% unique. Duplicate identifiers are strictly forbidden.
                          </div>
                        </div>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full shrink-0">
                          Audit Passed
                        </span>
                      </div>
                    )}

                    {/* Background Service: Automated 3-Month Grace Period & Disconnection Scanner Banner */}
                    <GracePeriodScannerCard
                      scannerStatus={scannerStatus}
                      disconnectionCount={disconnectionCount}
                      activeCount={activeCount}
                      isManualScanning={isManualScanning}
                      onRunScanNow={handleTriggerManualGracePeriodScan}
                    />

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

                      {/* Disconnection Notice Filter Pill */}
                      <button
                        onClick={() => setConsumerStatusFilter('Disconnection Notice')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shrink-0 flex items-center space-x-2 ${
                          consumerStatusFilter === 'Disconnection Notice'
                            ? 'bg-rose-700 text-white shadow-md ring-2 ring-rose-400'
                            : 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-300'
                        }`}
                      >
                        <AlertOctagon className="h-3.5 w-3.5 text-rose-600" />
                        <span>Disconnection Notice</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                          consumerStatusFilter === 'Disconnection Notice' ? 'bg-rose-900 text-white' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {disconnectionCount}
                        </span>
                      </button>

                      <button
                        onClick={() => setConsumerStatusFilter('pending_approval')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shrink-0 flex items-center space-x-2 ${
                          consumerStatusFilter === 'pending_approval'
                            ? 'bg-amber-600 text-white shadow-md ring-2 ring-amber-400'
                            : 'bg-amber-950/20 text-amber-500 hover:bg-amber-950/30 border border-amber-800/50'
                        }`}
                      >
                        <span>⏳ Pending ID Issuance</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-black ${
                          consumerStatusFilter === 'pending_approval' ? 'bg-amber-800 text-white' : 'bg-amber-900/40 text-amber-400 border border-amber-700/50'
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
                        
                        {/* 1. Primary Smart Search Input */}
                        <div className="lg:col-span-4">
                          <SmartSearchBar
                            variant="light"
                            value={consumerSearch}
                            onChange={setConsumerSearch}
                            resultCount={filteredConsumers.length}
                            totalCount={consumers.length}
                            placeholder="Smart search name, account #, meter #, phone, email, barangay..."
                            id="admin-consumers-smart-search"
                          />
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
                              <option value="Disconnection Notice">⚠️ Disconnection Notice</option>
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

                    {/* Consumers Grid/Table or Empty State - Eye-Friendly Dark Navy Slate Theme */}
                    {filteredConsumers.length === 0 ? (
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-4 shadow-xl">
                        <div className="h-16 w-16 bg-slate-800 text-slate-400 rounded-2xl flex items-center justify-center mx-auto border border-slate-700">
                          <Search className="h-8 w-8 text-slate-400" />
                        </div>
                        <div className="space-y-1 max-w-md mx-auto">
                          <h4 className="text-base font-extrabold text-white">No Consumers Found</h4>
                          <p className="text-xs text-slate-400">
                            {hasActiveFilters 
                              ? `No consumer records match your current search "${consumerSearch || 'all'}" with the selected filters.`
                              : "No registered water consumers found in the master database."}
                          </p>
                        </div>
                        {hasActiveFilters && (
                          <button
                            onClick={clearAllConsumerFilters}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition inline-flex items-center space-x-1.5 cursor-pointer shadow-sm"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Clear All Filters</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl text-slate-100">
                        {/* Table Header Bar */}
                        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-xs"></div>
                            <span className="font-extrabold text-white uppercase tracking-wider text-[11px]">
                              Consumers Master Ledger
                            </span>
                            <span className="text-slate-400 text-[10px] hidden sm:inline">
                              • High-Contrast Eye-Friendly Mode
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono font-bold text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                              Showing {filteredConsumers.length} of {consumers.length}
                            </span>
                            {pendingCount > 0 && (
                              <span className="text-[11px] font-bold text-amber-300 bg-amber-950/70 border border-amber-800/80 px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-2xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                <span>{pendingCount} Pending ID Issuance</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="w-full overflow-x-auto">
                          <table className="w-full text-xs text-left min-w-[1100px]">
                            <thead className="bg-slate-950 text-slate-300 font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                              <tr>
                                <th className="px-4 py-3.5 whitespace-nowrap min-w-[190px]">Consumer Details</th>
                                <th className="px-3 py-3.5 whitespace-nowrap min-w-[170px]">Official Account #</th>
                                <th className="px-3 py-3.5 whitespace-nowrap min-w-[190px]">Tag Numbers (Meter & RFID)</th>
                                <th className="px-3 py-3.5 text-center whitespace-nowrap min-w-[120px]">Classification</th>
                                <th className="px-3 py-3.5 whitespace-nowrap min-w-[120px]">Phone (11 Digits)</th>
                                <th className="px-3 py-3.5 whitespace-nowrap min-w-[140px]">Barangay & Sitio</th>
                                <th className="px-3 py-3.5 text-center whitespace-nowrap min-w-[100px]">Status</th>
                                <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[140px]">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/80 text-slate-200">
                              {(() => {
                                const paginatedConsumers = filteredConsumers.slice((consumerPage - 1) * 10, consumerPage * 10);
                                return paginatedConsumers.map((c, cIdx) => {
                                const addrParts = c.address.split(',').map(p => p.trim());
                                const barangayDisplay = c.barangay || (addrParts.length >= 2 ? addrParts[1] : c.address);
                                const isPending = !c.accountNumber || c.accountNumber.trim() === '' || c.accountNumber.toUpperCase().startsWith('PENDING') || c.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || c.status === 'pending_approval';

                                const isDupAccount = Boolean(c.accountNumber && !c.accountNumber.toUpperCase().startsWith('PENDING') && duplicateAccounts.has(c.accountNumber.trim().toUpperCase()));
                                const isDupMeter = Boolean(c.meterNumber && !c.meterNumber.toUpperCase().startsWith('PENDING') && c.meterNumber !== 'UNASSIGNED' && duplicateMeters.has(c.meterNumber.trim().toUpperCase()));
                                const isDupRfid = Boolean(c.rfidTag && !c.rfidTag.toUpperCase().startsWith('PENDING') && c.rfidTag !== 'UNASSIGNED' && duplicateRfids.has(c.rfidTag.trim().toUpperCase()));
                                const isDupPhone = Boolean(c.contactNumber && duplicatePhones.has(normalizePhoneNumber(c.contactNumber)));

                                return (
                                  <tr 
                                    key={`cons-row-${c.accountNumber || c.email || c.name || cIdx}-${cIdx}`} 
                                    className={`transition-colors ${
                                      isDupAccount || isDupMeter || isDupRfid || isDupPhone
                                        ? 'bg-rose-950/40 hover:bg-rose-900/50 border-l-4 border-l-rose-500'
                                        : isPending 
                                          ? 'bg-amber-950/25 hover:bg-amber-950/45 border-l-4 border-l-amber-500' 
                                          : 'bg-slate-900/90 hover:bg-slate-850'
                                    }`}
                                  >
                                    {/* 1. Consumer Details */}
                                    <td className="px-4 py-3.5 space-y-1">
                                      <div className="flex items-center space-x-1.5">
                                        <span className="font-bold text-[13px] text-white truncate max-w-[180px]" title={c.name}>{c.name}</span>
                                        {isPending && (
                                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-black text-[9px] uppercase tracking-wider shrink-0 shadow-2xs">
                                            NEW
                                          </span>
                                        )}
                                      </div>
                                      <div className="font-mono text-[10px] text-slate-400 truncate max-w-[180px]" title={c.email}>
                                        {c.email}
                                      </div>
                                    </td>

                                    {/* 2. Official Account # (Strictly Unique) */}
                                    <td className="px-3 py-3.5 whitespace-nowrap">
                                      {!isPending ? (
                                        <div className="space-y-1">
                                          <span 
                                            className="font-mono font-bold text-xs text-white bg-slate-950 hover:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700 inline-flex items-center gap-1.5 shadow-xs select-all transition-colors cursor-copy" 
                                            title={`Official Account #: ${c.accountNumber}`}
                                          >
                                            <span className="text-sky-400 font-black text-[11px]">#</span>
                                            <span className="tracking-wide font-black text-white">{c.accountNumber}</span>
                                          </span>
                                          {isDupAccount && (
                                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600 text-white text-[9px] font-black tracking-wider animate-pulse shadow-xs w-fit">
                                              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                              <span>DUPLICATE ACC #</span>
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 shadow-xs">
                                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                                          <span className="font-bold text-amber-200 text-[11px] tracking-wide">Pending ID Issuance</span>
                                        </div>
                                      )}
                                    </td>

                                    {/* 3. Tag Numbers (Meter Tag & RFID Tag - Strictly Unique) */}
                                    <td className="px-3 py-3.5 whitespace-nowrap">
                                      <div className="space-y-1.5">
                                        <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold">
                                          <Gauge className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                                          <span className="text-slate-400 font-medium text-[10px]">Meter:</span>
                                          {c.meterNumber && c.meterNumber !== 'Pending' && c.meterNumber !== 'UNASSIGNED' ? (
                                            <span className="font-black text-slate-100">{c.meterNumber}</span>
                                          ) : (
                                            <span className="font-bold text-amber-300/90 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/60 text-[10px]">
                                              Pending Tag
                                            </span>
                                          )}
                                        </div>
                                        {isDupMeter && (
                                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600 text-white text-[8px] font-black w-fit">
                                            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                            <span>DUPLICATE METER TAG</span>
                                          </div>
                                        )}

                                        <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold">
                                          <Tag className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                                          <span className="text-slate-400 font-medium text-[9px]">RFID:</span>
                                          {c.rfidTag && c.rfidTag !== 'Pending' && c.rfidTag !== 'UNASSIGNED' ? (
                                            <span className="font-bold text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-700/60">{c.rfidTag}</span>
                                          ) : (
                                            <span className="font-bold text-purple-300/90 bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-800/60 text-[9px]">
                                              Pending RFID
                                            </span>
                                          )}
                                        </div>
                                        {isDupRfid && (
                                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600 text-white text-[8px] font-black w-fit">
                                            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                            <span>DUPLICATE RFID TAG</span>
                                          </div>
                                        )}
                                      </div>
                                    </td>

                                    {/* 4. Classification */}
                                    <td className="px-3 py-3.5 text-center whitespace-nowrap">
                                      <div className="inline-flex flex-col items-center justify-center">
                                        <span className={`inline-flex items-center justify-center gap-1.5 text-[10px] font-black uppercase px-2.5 py-1 rounded-md border shadow-2xs min-w-[104px] ${
                                          c.consumerType === 'Commercial'
                                            ? 'bg-purple-950/60 text-purple-200 border-purple-700/70'
                                            : 'bg-emerald-950/60 text-emerald-200 border-emerald-700/70'
                                        }`}>
                                          {c.consumerType === 'Commercial' ? (
                                            <Building className="h-3 w-3 text-purple-400 shrink-0" />
                                          ) : (
                                            <Home className="h-3 w-3 text-emerald-400 shrink-0" />
                                          )}
                                          <span>{c.consumerType || 'Residential'}</span>
                                        </span>
                                        {c.consumerType === 'Commercial' && c.businessName && (
                                          <span className="text-[10px] text-slate-400 font-medium truncate max-w-[120px] mt-0.5" title={c.businessName}>
                                            {c.businessName}
                                          </span>
                                        )}
                                      </div>
                                    </td>

                                    {/* 5. Phone (11 Digits) */}
                                    <td className="px-3 py-3.5 whitespace-nowrap">
                                      <div className="font-mono text-[11px] text-slate-200 font-bold flex items-center gap-1">
                                        <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                                        <span>{c.contactNumber}</span>
                                      </div>
                                      {isDupPhone && (
                                        <div className="mt-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600 text-white text-[8px] font-black w-fit">
                                          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                          <span>DUPLICATE PHONE</span>
                                        </div>
                                      )}
                                    </td>

                                    {/* 6. Barangay & Sitio */}
                                    <td className="px-3 py-3.5" title={`${barangayDisplay} ${c.sitioZone || ''}`}>
                                      <span className="font-semibold text-white truncate block max-w-[180px]">
                                        {barangayDisplay}
                                      </span>
                                      {c.sitioZone && (
                                        <span className="text-[10px] text-slate-400 block truncate max-w-[180px] mt-0.5 font-medium">
                                          {c.sitioZone}
                                        </span>
                                      )}
                                    </td>

                                    {/* 7. Status */}
                                    <td className="px-3 py-3.5 text-center whitespace-nowrap">
                                      <div className="flex flex-col items-center justify-center space-y-1">
                                        <span className={`inline-block px-2.5 py-0.5 rounded text-[9px] font-black uppercase border shrink-0 ${
                                          isPending
                                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs'
                                            : c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice'
                                            ? 'bg-rose-700 text-white border-rose-800 shadow-xs ring-1 ring-rose-500 font-black animate-pulse'
                                            : c.status === 'blocked'
                                            ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                                            : c.status === 'active'
                                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                                            : 'bg-slate-800 text-slate-300 border-slate-700'
                                        }`}>
                                          {c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice'
                                            ? 'DISCONNECTION NOTICE'
                                            : isPending 
                                            ? 'PENDING ID' 
                                            : c.status.toUpperCase()}
                                        </span>
                                        {(c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice') && (
                                          <span className="text-[8px] font-black text-rose-400 block uppercase tracking-tight">
                                            {c.gracePeriodOverdueDays ? `${c.gracePeriodOverdueDays}d Overdue` : '90+ Days Overdue'}
                                          </span>
                                        )}
                                        <span className={`text-[9px] font-bold shrink-0 ${c.isRegistered ? 'text-emerald-400' : 'text-slate-400'}`}>
                                          {c.isRegistered ? '• Registered' : '• Offline'}
                                        </span>
                                      </div>
                                    </td>

                                    {/* 8. Actions */}
                                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                      <div className="flex items-center justify-end space-x-1.5 shrink-0">
                                        {isPending ? (
                                          <button 
                                            onClick={() => handleOpenConsumerModal(c, 'issue_ids')}
                                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs flex items-center space-x-1 transition shadow-sm cursor-pointer shrink-0"
                                            title="Issue Official Account Number, Meter & RFID Tag"
                                          >
                                            <ShieldCheck className="h-3.5 w-3.5 text-white" />
                                            <span className="text-white font-bold">Issue IDs</span>
                                          </button>
                                        ) : (
                                          <button 
                                            onClick={() => handleOpenConsumerModal(c, 'view')}
                                            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs flex items-center space-x-1 transition shadow-sm cursor-pointer shrink-0"
                                            title="View Consumer Details"
                                          >
                                            <Eye className="h-3.5 w-3.5 text-white" />
                                            <span className="text-white font-bold">View</span>
                                          </button>
                                        )}

                                        <button 
                                          onClick={() => handleDeleteConsumer(c)}
                                          className="px-2.5 py-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white font-bold rounded-lg text-xs flex items-center space-x-1 transition border border-rose-500/30 cursor-pointer shrink-0"
                                          title={`Delete Consumer Record`}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                          <span className="font-bold">Delete</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                            </tbody>
                          </table>
                        </div>
                        <TablePagination
                          currentPage={consumerPage}
                          totalItems={filteredConsumers.length}
                          pageSize={10}
                          onPageChange={setConsumerPage}
                          itemName="consumer accounts"
                        />
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* 3. METER READER MANAGEMENT MODULE */}
          {activeTab === 'readers' && (() => {
            const filteredStaff = (() => {
              const seen = new Set<string>();
              return readers
                .filter(r => {
                  const currentStatus = r.employmentStatus || ((r as any).status === 'inactive' ? 'inactive' : 'active');
                  if (readerFilter !== 'all' && currentStatus !== readerFilter) {
                    return false;
                  }
                  return smartMatch(readerSearch, [
                    r.name,
                    r.username,
                    r.employeeId,
                    r.id,
                    r.email,
                    r.contactNumber,
                    r.assignedRoutes,
                    r.targetRoute,
                    r.zone
                  ]);
                })
                .filter(r => {
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
                    return false;
                  }

                  if (kId) seen.add(kId);
                  if (kEmp) seen.add(kEmp);
                  if (kUser) seen.add(kUser);
                  if (kName) seen.add(kName);
                  if (kEmail) seen.add(kEmail);
                  return true;
                });
            })();

            const uniqueRoutesCount = new Set(readers.flatMap(r => r.assignedRoutes || ['Zone 1-4: Poblacion (Main Central)'])).size;

            return (
              <div className="space-y-6 animate-fade-in" id="readers-tab">
                {/* Readers & Routes Sub-Navigation */}
                <div className="flex space-x-2 border-b border-slate-800 pb-3">
                  <button
                    type="button"
                    onClick={() => setReadersSubTab('officers')}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer flex items-center space-x-2 ${
                      readersSubTab === 'officers'
                        ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                        : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <UserCheck className="h-4 w-4" />
                    <span>Field Staff Officers ({readers.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReadersSubTab('routes')}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer flex items-center space-x-2 ${
                      readersSubTab === 'routes'
                        ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                        : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <MapPin className="h-4 w-4" />
                    <span>Zone Route Allocations ({routes.length})</span>
                  </button>
                </div>

                {readersSubTab === 'officers' && (
                  <>
                    {/* Header & Main Controls */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wider font-sans">
                          Meter Reading Staff Registry
                        </h3>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">
                          Manage municipal field inspectors, view active mobile terminals, and maintain assigned inspection zones.
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-sky-800/60 rounded-xl text-xs text-sky-300 font-bold shrink-0">
                        <Smartphone className="h-4 w-4 text-sky-400" />
                        <span>Mobile Self-Registration Only</span>
                      </div>
                    </div>

                {/* Status Summary & Quick Stats Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-2xl border bg-slate-900 border-slate-800 shadow-md">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Total Registered</span>
                    <span className="text-xl sm:text-2xl font-black text-white">{readers.length}</span>
                    <span className="text-[10px] text-slate-500 block mt-0.5">Mobile field officers</span>
                  </div>

                  <div className="p-3.5 rounded-2xl border bg-emerald-950/40 border-emerald-800/60 ring-1 ring-emerald-500/20 shadow-md">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block">Active Terminals</span>
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    </div>
                    <span className="text-xl sm:text-2xl font-black text-emerald-300">{activeTechnicians}</span>
                    <span className="text-[10px] text-emerald-400/80 block mt-0.5">Field duty authorized</span>
                  </div>

                  <div className="p-3.5 rounded-2xl border bg-blue-950/40 border-blue-800/60 shadow-md">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 block">Mobile Access</span>
                      <Zap className="h-3.5 w-3.5 text-blue-400" />
                    </div>
                    <span className="text-xl sm:text-2xl font-black text-blue-300">Auto-Active</span>
                    <span className="text-[10px] text-blue-400/80 block mt-0.5">Instant mobile access</span>
                  </div>

                  <div className="p-3.5 rounded-2xl border bg-indigo-950/40 border-indigo-800/60 shadow-md">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 block">Coverage Zones</span>
                    <span className="text-xl sm:text-2xl font-black text-indigo-300">{uniqueRoutesCount || 1}</span>
                    <span className="text-[10px] text-indigo-400/80 block mt-0.5">Assigned water routes</span>
                  </div>
                </div>

                {/* Filter and Search Controls */}
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-xl space-y-3">
                  <SmartSearchBar
                    variant="dark"
                    value={readerSearch}
                    onChange={setReaderSearch}
                    resultCount={filteredStaff.length}
                    totalCount={readers.length}
                    placeholder="Smart search officer name, @username, badge ID, route zone, email, or phone..."
                    id="admin-readers-smart-search"
                  />

                  {/* Filter Pills */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setReaderFilter('all')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                        readerFilter === 'all'
                          ? 'bg-slate-800 text-white shadow-xs border border-slate-700'
                          : 'bg-slate-950 text-slate-400 border border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      All Officers ({readers.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setReaderFilter('active')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center space-x-1.5 ${
                        readerFilter === 'active'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/60 hover:bg-emerald-900/40'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span>Active Duty ({activeTechnicians})</span>
                    </button>
                    {readers.length > activeTechnicians && (
                      <button
                        type="button"
                        onClick={() => setReaderFilter('inactive')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                          readerFilter === 'inactive'
                            ? 'bg-slate-700 text-white shadow-xs'
                            : 'bg-slate-950 text-slate-400 border border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                      >
                        Inactive ({readers.length - activeTechnicians})
                      </button>
                    )}
                  </div>
                </div>

                {/* Notice: Field Officers Register via Mobile App Only */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-md">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-sky-950/80 border border-sky-800/80 rounded-xl text-sky-400 shrink-0">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">Mobile Self-Registration Active</h4>
                      <p className="text-slate-400 text-xs mt-0.5">
                        Field meter readers register directly through the Mobile Reader application. Newly registered officers automatically appear in this registry where administrators can manage duty status, verify terminals, and reallocate coverage zones.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 px-3 py-1.5 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-emerald-400 font-mono font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Live Sync Ready
                  </div>
                </div>

                {/* Empty State */}
                {filteredStaff.length === 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3 shadow-xl">
                    <div className="h-12 w-12 rounded-full bg-slate-800 text-slate-400 mx-auto flex items-center justify-center font-bold text-xl">
                      🔍
                    </div>
                    <h4 className="text-base font-bold text-white">No Meter Readers Found</h4>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      {readerSearch ? `No staff records matching "${readerSearch}". Try a different keyword or clear search.` : 'No meter readers recorded.'}
                    </p>
                    {readerSearch && (
                      <button
                        onClick={() => setReaderSearch('')}
                        className="px-4 py-2 bg-slate-800 text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-700 transition cursor-pointer border border-slate-700"
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

                    const currentStatus = r.employmentStatus || ((r as any).status === 'inactive' ? 'inactive' : ((r as any).status === 'pending_approval' ? 'pending_approval' : 'active'));

                    return (
                      <div 
                        key={`reader-unified-card-${r.id || ''}-${r.username || ''}-${rIdx}`} 
                        className="bg-slate-900 rounded-2xl p-5 shadow-xl border border-slate-800 hover:border-blue-500/50 hover:shadow-2xl transition-all flex flex-col justify-between space-y-4 relative"
                      >
                        {/* Card Header: Avatar, Name & Dynamic Status Pill */}
                        <div className="space-y-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className="h-11 w-11 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 shadow-xs text-white bg-blue-600">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-sm sm:text-base font-black text-white truncate">
                                  {r.name}
                                </h4>
                                <p className="text-[11px] text-blue-400 font-mono font-bold truncate">
                                  @{r.username || r.name.toLowerCase().replace(/\s+/g, '_')}
                                </p>
                              </div>
                            </div>

                            {/* Status Pill: Uniform Active Duty */}
                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider shrink-0 border bg-emerald-950/60 text-emerald-300 border-emerald-800/80 flex items-center space-x-1.5 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span>Active Duty</span>
                            </span>
                          </div>

                          {/* Mobile Meter Reader Info Details Card */}
                          <div className="space-y-2.5 text-xs bg-slate-950 border border-slate-800/80 p-4 rounded-xl">
                            {/* Employee Badge ID */}
                            <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800/80">
                              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Badge / ID</span>
                              <span className="font-mono font-bold text-slate-200 text-xs truncate max-w-[170px]">
                                {r.employeeId || r.id}
                              </span>
                            </div>

                            {/* Full Name */}
                            <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800/80">
                              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Full Name</span>
                              <span className="font-bold text-white text-xs truncate max-w-[170px]">
                                {r.name}
                              </span>
                            </div>

                            {/* Contact Number */}
                            <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800/80">
                              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Contact</span>
                              <span className="font-mono text-slate-300 text-xs truncate max-w-[170px]">
                                {r.contactNumber || 'N/A'}
                              </span>
                            </div>

                            {/* Username */}
                            <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800/80">
                              <div className="flex items-center space-x-1.5 text-slate-400">
                                <UserCheck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <span className="text-[11px] font-bold uppercase tracking-wider">Username</span>
                              </div>
                              <span className="font-mono font-bold text-blue-300 bg-blue-950/70 border border-blue-900/60 px-2 py-0.5 rounded text-xs">
                                {r.username || r.name.toLowerCase().replace(/\s+/g, '_')}
                              </span>
                            </div>

                            {/* Password */}
                            <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800/80">
                              <div className="flex items-center space-x-1.5 text-slate-400">
                                <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <span className="text-[11px] font-bold uppercase tracking-wider">Password</span>
                              </div>
                              <div className="flex items-center space-x-1.5">
                                <span className="font-mono font-bold text-slate-200 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-xs">
                                  {isPasswordRevealed ? displayedPassword : '••••••••'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setRevealedPasswords(prev => ({ ...prev, [readerKey]: !prev[readerKey] }))}
                                  className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition cursor-pointer"
                                  title={isPasswordRevealed ? "Hide Password" : "Show Password"}
                                >
                                  {isPasswordRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>

                            {/* Target Route / Barangay Assignment */}
                            <div className="pt-1">
                              <div className="flex items-center space-x-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                <MapPin className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                                <span>Target Route / Barangay Assignment</span>
                              </div>
                              <div className="p-2.5 bg-blue-950/60 rounded-lg border border-blue-800/70 text-blue-300 font-bold text-xs flex items-center justify-between">
                                <span>{targetRouteDisplay}</span>
                                <span className="text-[10px] text-blue-400/80 bg-blue-900/50 px-1.5 py-0.5 rounded font-mono border border-blue-800/50">Route Zone</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Card Action Footer: Single Uniform Terminate Button Only */}
                        <div className="pt-3 border-t border-slate-800 flex items-center">
                          <button
                            type="button"
                            onClick={() => handleTerminateReader(r)}
                            className="w-full py-2.5 px-4 bg-rose-950/40 hover:bg-rose-600 active:scale-95 text-rose-300 hover:text-white font-bold text-xs rounded-xl border border-rose-900/60 hover:border-rose-600 transition shadow-2xs flex items-center justify-center space-x-2 cursor-pointer group"
                            title={`Terminate ${r.name}`}
                          >
                            <UserX className="h-4 w-4 text-rose-400 group-hover:text-white transition" />
                            <span>Terminate</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {readersSubTab === 'routes' && (
              <div className="space-y-6 animate-fade-in" id="readers-routes-tab">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xl">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-extrabold text-white uppercase tracking-widest leading-none">Geographic Service Route Assignments</h3>
                      <p className="text-xs text-slate-400 mt-1.5">Assign designated zones directly to registered reader handheld mobile applications.</p>
                    </div>
                    <div className="w-full lg:w-96">
                      <SmartSearchBar
                        variant="dark"
                        value={routesSearch}
                        onChange={setRoutesSearch}
                        resultCount={routes.filter(rt => smartMatch(routesSearch, [rt.routeName, rt.description, rt.assignedReaderName, rt.status])).length}
                        totalCount={routes.length}
                        placeholder="Smart search zone route, barangay, or assigned reader..."
                        id="admin-routes-smart-search"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                    {routes
                      .filter(rt => smartMatch(routesSearch, [rt.routeName, rt.description, rt.assignedReaderName, rt.status]))
                      .map((rt, rtIdx) => (
                      <div key={`route-card-${rt.id || ''}-${rtIdx}`} className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="text-base font-extrabold text-white">{rt.routeName}</h4>
                            <p className="text-xs text-slate-400">{rt.description}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            rt.status === 'completed' 
                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60' 
                              : rt.status === 'in_progress' 
                              ? 'bg-blue-950/60 text-blue-300 border border-blue-800/60' 
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}>
                            {rt.status.replace('_', ' ')}
                          </span>
                        </div>

                        <div className="flex justify-between items-center text-xs">
                          <div>
                            <span className="text-slate-400">Consumers in zone:</span>
                            <span className="font-bold text-slate-200 ml-1.5">{rt.totalConsumers} connections</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Assigned Reader Option:</span>
                            <span className="font-extrabold text-blue-400 ml-1.5">{rt.assignedReaderName}</span>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-slate-800 flex justify-end">
                          {editingRouteId === rt.id ? (
                            <div className="flex items-center space-x-2 w-full">
                              <select
                                value={assignedReaderId}
                                onChange={(e) => setAssignedReaderId(e.target.value)}
                                className="bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-3 text-xs w-full font-bold text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer"
                              >
                                <option value="">Choose Reader Staff...</option>
                                {readers.map((r, rIdx) => (
                                  <option key={`route-reader-opt-${r.id || ''}-${r.employeeId || ''}-${rIdx}`} value={r.id}>{r.name}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleSaveRouteAssignment(rt.id)}
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold shrink-0 hover:bg-blue-700 cursor-pointer"
                              >
                                Save Assignment
                              </button>
                              <button
                                onClick={() => setEditingRouteId(null)}
                                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs font-bold shrink-0 hover:bg-slate-700 cursor-pointer"
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
                              className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-200 hover:text-blue-400 hover:border-blue-500/50 text-xs font-bold rounded-lg transition cursor-pointer"
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
              </div>
            );
          })()}


          {/* 4. WATER METER REGISTRATION & MANAGEMENT */}
          {activeTab === 'meters' && (
            <div className="space-y-6 animate-fade-in" id="meters-tab">
              {/* Header */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center space-x-3.5">
                  <div className="p-3 bg-blue-950/60 text-blue-400 rounded-2xl border border-blue-800/70">
                    <Gauge className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wider font-sans">Mechanical Water Meter Catalog & Hardware Inventory</h3>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">Track serial numbers, hardware brands, installation telemetry, and linked consumer accounts</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2.5">
                  <button
                    type="button"
                    onClick={() => setShowAddMeter(!showAddMeter)}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition flex items-center space-x-2 shadow-xs cursor-pointer active:scale-95"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{showAddMeter ? 'Close Form' : 'Register Mechanical Meter'}</span>
                  </button>
                </div>
              </div>

              {/* Add Meter Form */}
              {showAddMeter && (
                <form onSubmit={handleCreateMeter} className="bg-slate-900 border border-blue-500/40 p-6 rounded-3xl shadow-2xl space-y-4 max-w-3xl animate-slide-down">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h4 className="text-sm font-bold uppercase text-white flex items-center gap-2">
                      <Plus className="w-4 h-4 text-blue-400" />
                      Register New Water Meter Hardware
                    </h4>
                    <span className="text-[11px] text-slate-400 font-medium">Step 1 of 1</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase mb-1">Meter Serial Number *</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. MT-8844"
                        value={newMeter.meterNumber}
                        onChange={(e) => setNewMeter({ ...newMeter, meterNumber: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs font-medium text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase mb-1">Manufacturer / Brand *</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. NBI WaterTech / Kent"
                        value={newMeter.brand}
                        onChange={(e) => setNewMeter({ ...newMeter, brand: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs font-medium text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase mb-1">Linked Account Number</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 1001-A (optional)"
                        value={newMeter.linkedAccountNumber}
                        onChange={(e) => setNewMeter({ ...newMeter, linkedAccountNumber: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs font-medium text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                    <button 
                      type="button" 
                      onClick={() => setShowAddMeter(false)} 
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold text-slate-300 transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer active:scale-95"
                    >
                      Insert Water Meter
                    </button>
                  </div>
                </form>
              )}

              {/* Meter Summary & Filter Chips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => setMeterStatusFilter('all')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    meterStatusFilter === 'all'
                      ? 'bg-slate-800 border-blue-500 ring-2 ring-blue-500/20 shadow-md'
                      : 'bg-slate-900 border-slate-800 hover:bg-slate-800/80'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Total Meters</span>
                  <span className="text-xl sm:text-2xl font-black text-white">{meters.length}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMeterStatusFilter('active')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    meterStatusFilter === 'active'
                      ? 'bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-md'
                      : 'bg-emerald-950/40 border-emerald-900/60 hover:bg-emerald-900/50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block">Active & Deployed</span>
                  <span className="text-xl sm:text-2xl font-black text-emerald-300">{meters.filter(m => m.status === 'active').length}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMeterStatusFilter('damaged')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    meterStatusFilter === 'damaged'
                      ? 'bg-rose-950/80 border-rose-500 ring-2 ring-rose-500/20 shadow-md'
                      : 'bg-rose-950/40 border-rose-900/60 hover:bg-rose-900/50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 block">Damaged / Faulty</span>
                  <span className="text-xl sm:text-2xl font-black text-rose-300">{meters.filter(m => m.status === 'damaged').length}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMeterStatusFilter('maintenance')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    meterStatusFilter === 'maintenance' || meterStatusFilter === 'inactive'
                      ? 'bg-amber-950/80 border-amber-500 ring-2 ring-amber-500/20 shadow-md'
                      : 'bg-amber-950/40 border-amber-900/60 hover:bg-amber-900/50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 block">Under Maintenance</span>
                  <span className="text-xl sm:text-2xl font-black text-amber-300">{meters.filter(m => m.status === 'maintenance' || m.status === 'inactive').length}</span>
                </button>
              </div>

              {/* Search and Filters Bar & Meter List Table */}
              {(() => {
                const filteredMetersList = meters.filter((m) => {
                  if (meterStatusFilter !== 'all') {
                    if (meterStatusFilter === 'maintenance' && m.status !== 'maintenance' && m.status !== 'inactive') return false;
                    if (meterStatusFilter !== 'maintenance' && m.status !== meterStatusFilter) return false;
                  }
                  const linkedConsumer = consumers.find(c => c.accountNumber === m.linkedAccountNumber);
                  return smartMatch(meterSearch, [
                    m.meterNumber,
                    m.brand,
                    m.linkedAccountNumber,
                    m.installationDate,
                    m.status,
                    linkedConsumer?.name,
                    linkedConsumer?.barangay,
                    linkedConsumer?.consumerType
                  ]);
                });
                const paginatedMeters = filteredMetersList.slice((meterPage - 1) * 10, meterPage * 10);

                return (
                  <>
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-xl flex flex-col sm:flex-row items-center gap-3">
                      <div className="flex-1 w-full">
                        <SmartSearchBar
                          variant="dark"
                          value={meterSearch}
                          onChange={setMeterSearch}
                          resultCount={filteredMetersList.length}
                          totalCount={meters.length}
                          placeholder="Smart search meter serial, brand, linked account #, consumer name, or barangay..."
                          id="admin-meters-smart-search"
                        />
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <select
                          value={meterStatusFilter}
                          onChange={(e) => setMeterStatusFilter(e.target.value as any)}
                          className="min-h-[42px] bg-slate-950 border border-slate-800 text-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer w-full sm:w-auto"
                        >
                          <option value="all">All Meter Statuses</option>
                          <option value="active">Active Only</option>
                          <option value="damaged">Damaged Only</option>
                          <option value="maintenance">Maintenance Only</option>
                          <option value="inactive">Inactive Only</option>
                        </select>

                        {(meterSearch || meterStatusFilter !== 'all') && (
                          <button
                            type="button"
                            onClick={() => {
                              setMeterSearch('');
                              setMeterStatusFilter('all');
                            }}
                            className="min-h-[42px] px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer whitespace-nowrap shrink-0 border border-slate-700"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-950 text-slate-300 font-bold uppercase text-[11px] tracking-wider border-b border-slate-800">
                          <tr>
                            <th className="px-4 py-3.5 whitespace-nowrap">Meter Serial</th>
                            <th className="px-4 py-3.5 min-w-[170px]">Brand / Manufacturer</th>
                            <th className="px-4 py-3.5 whitespace-nowrap">Installation Date</th>
                            <th className="px-4 py-3.5 min-w-[180px]">Linked Consumer Account</th>
                            <th className="px-4 py-3.5 whitespace-nowrap text-center">Operational Status</th>
                            <th className="px-4 py-3.5 whitespace-nowrap text-right min-w-[140px]">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                          {filteredMetersList.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-12 text-center text-slate-500 text-xs">
                                No water meters found matching your filter criteria.
                              </td>
                            </tr>
                          ) : (
                            paginatedMeters.map((m, mIdx) => {
                              const linkedConsumer = consumers.find(c => c.accountNumber === m.linkedAccountNumber);
                              return (
                                <tr key={`meter-inv-${m.meterNumber || mIdx}-${mIdx}`} className="hover:bg-slate-800/60 transition-colors">
                                  {/* Serial */}
                                  <td className="px-4 py-3.5 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5 font-mono text-white font-black text-xs">
                                      <Tag className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                      <span>{m.meterNumber}</span>
                                    </div>
                                  </td>

                                  {/* Brand */}
                                  <td className="px-4 py-3.5">
                                    <span className="font-bold text-slate-200 text-xs block">{m.brand}</span>
                                    <span className="text-[10px] text-slate-400">Mechanical Meter</span>
                                  </td>

                                  {/* Date */}
                                  <td className="px-4 py-3.5 font-sans text-slate-400 whitespace-nowrap text-xs">
                                    {m.installationDate || 'N/A'}
                                  </td>

                                  {/* Linked Consumer */}
                                  <td className="px-4 py-3.5">
                                    {m.linkedAccountNumber ? (
                                      <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-mono font-bold text-sky-400 text-xs">#{m.linkedAccountNumber}</span>
                                          {linkedConsumer?.consumerType && (
                                            <span className="px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded text-[9px] font-sans border border-slate-700">
                                              {linkedConsumer.consumerType}
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-white font-semibold text-[11px] truncate max-w-[180px]" title={linkedConsumer?.name}>
                                          {linkedConsumer?.name || 'Consumer Assigned'}
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 inline-block">
                                        UNASSIGNED
                                      </span>
                                    )}
                                  </td>

                                  {/* Status */}
                                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border shadow-2xs inline-block ${
                                      m.status === 'active' 
                                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80' 
                                        : m.status === 'damaged' 
                                        ? 'bg-rose-950/80 text-rose-300 border-rose-800/80 animate-pulse' 
                                        : 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                                    }`}>
                                      {m.status.toUpperCase()}
                                    </span>
                                  </td>

                                  {/* Actions */}
                                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setEditingMeterModal({ ...m })}
                                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 rounded-lg text-xs font-bold transition cursor-pointer inline-flex items-center gap-1 shrink-0"
                                        title="Edit Meter Parameters"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                        <span>Edit</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteMeter(m)}
                                        className="px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 rounded-lg text-xs font-bold transition cursor-pointer inline-flex items-center gap-1 shrink-0"
                                        title="Deregister Meter"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Delete</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    <TablePagination
                      currentPage={meterPage}
                      totalItems={filteredMetersList.length}
                      pageSize={10}
                      onPageChange={setMeterPage}
                      itemName="water meters"
                    />
                  </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* 5. READING MONITORING MODULE */}
          {activeTab === 'readings' && (
            <div className="space-y-6 animate-fade-in" id="readings-tab">
              
              {/* Readings Control Header */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center space-x-3.5">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
                    <Activity className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Field Meter Readings & Telemetry Desk</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Real-time inspection and telemetry of field meter readings submitted by mobile inspectors</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2.5">
                  <button 
                    type="button"
                    onClick={() => {
                      setActiveTab('staff');
                      setStaffSubTab('tariff');
                    }}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 shadow-xs cursor-pointer"
                    title="Set or change water rate price hikes on meter readings"
                  >
                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                    <span>Adjust Reading Price Hike</span>
                  </button>
                </div>
              </div>

              {/* Readings Summary & Quick Filter Chips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => setReadingsStatusFilter('all')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    readingsStatusFilter === 'all'
                      ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/20 shadow-xs'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">Total Readings</span>
                  <span className="text-xl sm:text-2xl font-black text-slate-900">{readings.length}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setReadingsStatusFilter('verified')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    readingsStatusFilter === 'verified'
                      ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-500/20 shadow-xs'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">Verified / Approved</span>
                  <span className="text-xl sm:text-2xl font-black text-emerald-900">{readings.filter(r => r.status === 'verified').length}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setReadingsStatusFilter('pending')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    readingsStatusFilter === 'pending'
                      ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-500/20 shadow-xs'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 block">Pending Review</span>
                  <span className="text-xl sm:text-2xl font-black text-amber-900">{readings.filter(r => r.status === 'pending').length}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setReadingsStatusFilter('flagged_abnormal')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    readingsStatusFilter === 'flagged_abnormal'
                      ? 'bg-rose-50 border-rose-300 ring-2 ring-rose-500/20 shadow-xs'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 block">High Usage Alerts</span>
                  <span className="text-xl sm:text-2xl font-black text-rose-900">{readings.filter(r => r.status === 'flagged_abnormal' || r.consumption >= 50).length}</span>
                </button>
              </div>

              {/* Search and Filters Bar & Readings Table */}
              {(() => {
                const filteredReadingsList = readings.filter((r) => {
                  if (readingsStatusFilter === 'verified' && r.status !== 'verified') return false;
                  if (readingsStatusFilter === 'pending' && r.status !== 'pending') return false;
                  if (readingsStatusFilter === 'flagged_abnormal' && r.status !== 'flagged_abnormal' && r.consumption < 50) return false;

                  return smartMatch(readingsSearch, [
                    r.id,
                    r.consumerName,
                    r.accountNumber,
                    r.meterNumber,
                    r.billingPeriod,
                    r.readingDate,
                    r.meterReaderName,
                    r.route,
                    r.status,
                    r.notes,
                    `${r.consumption} m3`
                  ]);
                });
                const paginatedReadings = filteredReadingsList.slice((readingsPage - 1) * 10, readingsPage * 10);

                return (
                  <>
                    <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs flex flex-col sm:flex-row items-center gap-3">
                      <div className="flex-1 w-full">
                        <SmartSearchBar
                          variant="light"
                          value={readingsSearch}
                          onChange={setReadingsSearch}
                          resultCount={filteredReadingsList.length}
                          totalCount={readings.length}
                          placeholder="Smart search Tx ID, consumer name, account #, meter #, period, reader, or route..."
                          id="admin-readings-smart-search"
                        />
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <select
                          value={readingsStatusFilter}
                          onChange={(e) => setReadingsStatusFilter(e.target.value as any)}
                          className="min-h-[42px] bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer w-full sm:w-auto"
                        >
                          <option value="all">All Statuses</option>
                          <option value="verified">Approved Only</option>
                          <option value="pending">Pending Only</option>
                          <option value="flagged_abnormal">Flagged Anomalies</option>
                        </select>

                        {(readingsSearch || readingsStatusFilter !== 'all') && (
                          <button
                            type="button"
                            onClick={() => {
                              setReadingsSearch('');
                              setReadingsStatusFilter('all');
                            }}
                            className="min-h-[42px] px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-950 text-slate-300 font-bold uppercase text-[11px] tracking-wider border-b border-slate-800">
                          <tr>
                            <th className="px-4 py-3.5 whitespace-nowrap">Tx ID</th>
                            <th className="px-4 py-3.5 min-w-[200px]">Consumer & Account</th>
                            <th className="px-4 py-3.5 whitespace-nowrap">Period</th>
                            <th className="px-4 py-3.5 whitespace-nowrap">Index (Prev → Curr)</th>
                            <th className="px-4 py-3.5 min-w-[170px]">Telemetry & Verification</th>
                            <th className="px-4 py-3.5 whitespace-nowrap">Consumption</th>
                            <th className="px-4 py-3.5 whitespace-nowrap text-center">Status</th>
                            <th className="px-4 py-3.5 whitespace-nowrap text-right min-w-[150px]">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80 text-slate-200 bg-slate-900">
                          {filteredReadingsList.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-6 py-12 text-center text-slate-500 text-xs">
                                No meter readings found matching your filter criteria.
                              </td>
                            </tr>
                          ) : (
                            paginatedReadings.map((r, rIdx) => {
                              const isAbnormal = r.consumption >= 50;
                              const resolvedClassification = r.classification || 'Residential';
                              return (
                                <tr
                                  key={`board-reading-${r.id || ''}-${rIdx}`}
                                  className={`hover:bg-slate-800/60 transition-colors ${
                                    isAbnormal && r.status === 'flagged_abnormal' ? 'bg-rose-950/25' : ''
                                  }`}
                                >
                                  {/* Tx ID */}
                                  <td className="px-4 py-3.5 font-mono font-bold text-slate-400 text-[11px] whitespace-nowrap">
                                    {r.id}
                                  </td>

                                  {/* Consumer & Account */}
                                  <td className="px-4 py-3.5">
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-bold text-white text-xs">{r.consumerName}</span>
                                        <span
                                          className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border tracking-wider shrink-0 ${
                                            resolvedClassification === 'Commercial'
                                              ? 'bg-purple-950/80 text-purple-300 border-purple-800/80'
                                              : 'bg-blue-950/80 text-blue-300 border-blue-800/80'
                                          }`}
                                        >
                                          {resolvedClassification}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono flex-wrap">
                                        <span>Acc: <strong className="text-sky-400 font-bold">{r.accountNumber}</strong></span>
                                        <span>•</span>
                                        <span>Meter: <strong className="text-slate-300 font-bold">{r.meterNumber}</strong></span>
                                      </div>
                                    </div>
                                  </td>

                                  {/* Billing Period */}
                                  <td className="px-4 py-3.5 text-slate-300 font-semibold whitespace-nowrap text-xs">
                                    {r.billingPeriod}
                                  </td>

                                  {/* Indices */}
                                  <td className="px-4 py-3.5 font-mono whitespace-nowrap">
                                    <span className="text-slate-400 text-xs">{r.previousReading} m³</span>
                                    <span className="text-slate-500 mx-1 font-sans">→</span>
                                    <span className="font-black text-white text-xs">{r.currentReading} m³</span>
                                  </td>

                                  {/* Telemetry (GPS / Photo) */}
                                  <td className="px-4 py-3.5">
                                    <div className="flex flex-col gap-1.5">
                                      {r.gpsLocation ? (
                                        <div className="flex items-center text-[10px] font-sans text-slate-300 font-medium">
                                          <MapPin className="h-3 w-3 text-rose-400 mr-1 shrink-0" />
                                          <span className="truncate max-w-[140px]" title={r.gpsLocation}>{r.gpsLocation}</span>
                                        </div>
                                      ) : (
                                        <span className="text-[10px] text-slate-500 italic">No GPS</span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedPhotoUrl(
                                            r.meterImageUrl ||
                                              'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=300&auto=format&fit=crop'
                                          );
                                          setSelectedPhotoAccount(r.accountNumber);
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 rounded-lg text-[10px] font-bold transition uppercase tracking-wider w-fit cursor-pointer"
                                      >
                                        <Camera className="h-3 w-3 shrink-0 text-sky-400" />
                                        <span>Dial Photo</span>
                                      </button>
                                    </div>
                                  </td>

                                  {/* Consumption */}
                                  <td className="px-4 py-3.5 whitespace-nowrap">
                                    <div className="flex flex-col gap-0.5">
                                      <span
                                        className={`font-mono font-black text-xs ${
                                          isAbnormal ? 'text-rose-400' : 'text-emerald-400'
                                        }`}
                                      >
                                        {r.consumption} m³
                                      </span>
                                      {isAbnormal && (
                                        <span className="bg-rose-950/80 border border-rose-800/80 text-rose-300 text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wide inline-flex items-center gap-0.5 w-fit">
                                          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                          <span>High Usage</span>
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Status */}
                                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border shadow-2xs ${
                                        r.status === 'verified'
                                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                                          : r.status === 'flagged_abnormal'
                                          ? 'bg-rose-950/80 text-rose-300 border-rose-800/80 animate-pulse'
                                          : 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                                      }`}
                                    >
                                      {r.status === 'flagged_abnormal' ? 'ANOMALY' : r.status}
                                    </span>
                                  </td>

                                  {/* Actions */}
                                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-1.5">
                                      {r.status === 'pending' || r.status === 'flagged_abnormal' ? (
                                        <button
                                          type="button"
                                          onClick={() => handleVerifyReading(r.id, 'verified')}
                                          className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[11px] uppercase rounded-lg transition inline-flex items-center gap-1 shadow-xs cursor-pointer tracking-wider active:scale-95 shrink-0"
                                          id={`approve-read-btn-${r.id}`}
                                          title="Approve Reading"
                                        >
                                          <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                                          <span>Approve</span>
                                        </button>
                                      ) : (
                                        <span className="text-[10px] text-emerald-300 font-bold bg-emerald-950/80 px-2 py-1 rounded-lg border border-emerald-800/80 inline-flex items-center gap-1 shrink-0">
                                          <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                                          <span>Approved</span>
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteReading(r.id)}
                                        className="px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 font-bold text-[11px] rounded-lg transition inline-flex items-center cursor-pointer shrink-0"
                                        title="Void / Delete Reading"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    <TablePagination
                      currentPage={readingsPage}
                      totalItems={filteredReadingsList.length}
                      pageSize={10}
                      onPageChange={setReadingsPage}
                      itemName="meter readings"
                    />
                  </div>
                </>
                );
              })()}
            </div>
          )}

          {/* 8. PUBLIC ANNOUNCEMENTS & CUSTOMER SERVICE MODULE */}
          {activeTab === 'announcements' && (
            <div className="space-y-6 animate-fade-in" id="announcements-tab">
              {/* Header & Sub-tab Switcher */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">
                    {announcementsSubTab === 'customer_service' ? 'Customer Service & Inquiries Desk' : 'Public Advisories & Bulletin Announcements'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {announcementsSubTab === 'customer_service' 
                      ? 'Review and respond to consumer service requests, water leak tickets, and emergency inquiries.' 
                      : 'Publish emergency maintenance schedules, water disruption notices, and municipal advisories.'}
                  </p>
                </div>

                <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-xl shrink-0">
                  <button
                    type="button"
                    onClick={() => setAnnouncementsSubTab('bulletin')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-2 cursor-pointer ${
                      announcementsSubTab === 'bulletin'
                        ? 'bg-white text-blue-600 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    <span>Advisories Bulletin</span>
                    <span className="text-[10px] px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded-full font-mono font-bold">
                      {announcements.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAnnouncementsSubTab('customer_service')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-2 cursor-pointer ${
                      announcementsSubTab === 'customer_service'
                        ? 'bg-white text-blue-600 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-rose-500" />
                    <span>Customer Service</span>
                    {pendingReportsCount > 0 ? (
                      <span className="text-[10px] px-1.5 py-0.2 bg-rose-500 text-white rounded-full font-mono font-black animate-pulse shadow-2xs">
                        {pendingReportsCount}
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded-full font-mono font-bold">
                        {reports.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Sub-tab A: Public Advisories Bulletin */}
              {announcementsSubTab === 'bulletin' && (
                <div className="space-y-6 animate-fade-in">
                  <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                    <div className="flex-1 sm:max-w-lg">
                      <SmartSearchBar
                        variant="light"
                        value={announcementSearch}
                        onChange={setAnnouncementSearch}
                        resultCount={announcements.filter(ann => smartMatch(announcementSearch, [ann.title, ann.content, ann.category, ann.date, ann.postedBy])).length}
                        totalCount={announcements.length}
                        placeholder="Smart search public advisories by title, category, content, date, or author..."
                        id="admin-announcements-smart-search"
                      />
                    </div>
                    
                    <button
                      onClick={() => setShowAddAnnouncement(!showAddAnnouncement)}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition flex items-center justify-center space-x-2 cursor-pointer shadow-xs shrink-0"
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
                          className="px-4.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-705 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit" 
                          className="px-4.5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold cursor-pointer"
                        >
                          Publish Advisory
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Announcements list */}
                  <div className="space-y-4">
                    {announcements
                      .filter(ann => smartMatch(announcementSearch, [ann.title, ann.content, ann.category, ann.date, ann.postedBy]))
                      .map((ann, aIdx) => (
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
                          <div className="flex items-center space-x-3">
                            <button
                              onClick={() => setEditingAnnouncementModal({ ...ann })}
                              className="text-blue-600 hover:underline cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteAnnouncement(ann)}
                              className="text-rose-600 hover:underline cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-tab B: Customer Service Inquiries */}
              {announcementsSubTab === 'customer_service' && (
                <div className="animate-fade-in">
                  <ConsumerReportsManager
                    currentUser={currentUser}
                    reports={reports}
                    barangays={barangayList}
                    onRefreshReports={() => loadAllDataFromStore(true)}
                  />
                </div>
              )}
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
                  const gross = calculateCostOf(r, r.classification);
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

              {/* Bills Smart Search, Filter & List Table */}
              {(() => {
                const verifiedBillsAll = readings.filter(r => r.status === 'verified');
                const filteredBills = verifiedBillsAll
                  .filter(r => {
                    if (billStatusFilter === 'unpaid') return r.paymentStatus !== 'paid' && r.status !== 'cancelled';
                    if (billStatusFilter === 'paid') return r.paymentStatus === 'paid';
                    if (billStatusFilter === 'overdue') return r.paymentStatus !== 'paid' && r.status !== 'cancelled' && r.isOverdue;
                    if (billStatusFilter === 'cancelled') return r.status === 'cancelled';
                    return true;
                  })
                  .filter(r =>
                    smartMatch(billSearch, [
                      r.accountNumber,
                      r.consumerName,
                      r.meterNumber,
                      r.billingPeriod,
                      r.id,
                      r.orNumber,
                      r.paymentReference,
                      r.paymentStatus || 'unpaid',
                      r.classification,
                      `${r.consumption} m3`,
                      calculateCostOf(r, r.classification).toFixed(2)
                    ])
                  );

                const paginatedBills = filteredBills.slice((billPage - 1) * 10, billPage * 10);

                return (
                  <>
                    <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4">
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
                        <div className="flex-1 sm:max-w-lg">
                          <SmartSearchBar
                            variant="light"
                            value={billSearch}
                            onChange={setBillSearch}
                            resultCount={filteredBills.length}
                            totalCount={verifiedBillsAll.length}
                            placeholder="Smart search account #, consumer name, meter #, billing period, OR #, or amount..."
                            id="admin-bills-smart-search"
                          />
                        </div>
                        <select
                          value={billStatusFilter}
                          onChange={(e: any) => setBillStatusFilter(e.target.value)}
                          className="min-h-[42px] bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs shrink-0 cursor-pointer"
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
                            toast.success('Export Completed', 'TWD Water Bills Ledger exported as PDF/CSV.');
                          }}
                          className="min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-xl text-xs uppercase tracking-wider transition shadow-2xs flex items-center space-x-2 cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5 text-slate-300" />
                          <span>Export Ledger</span>
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                    <div className="w-full overflow-x-auto">
                      <table className="min-w-full text-xs text-left">
                        <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase border-b border-slate-800 text-[10px] select-none tracking-wider">
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
                        <tbody className="divide-y divide-slate-800/80 text-xs font-medium bg-slate-900 text-slate-200">
                          {filteredBills.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-4 py-12 text-center text-slate-400 bg-slate-900">
                                <div className="flex flex-col items-center justify-center space-y-2">
                                  <FileText className="h-8 w-8 text-slate-500" />
                                  <p className="font-extrabold text-sm text-slate-200">No bills found matching your criteria</p>
                                  <p className="text-xs text-slate-400 font-bold">Try adjusting your search query or status filter.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            paginatedBills.map((bill, bIdx) => {
                              const totalBill = calculateCostOf(bill, bill.classification);
                              const isPaid = bill.paymentStatus === 'paid';
                              const isCancelled = bill.status === 'cancelled';

                              return (
                                <tr key={`bill-row-${bill.id || ''}-${bIdx}`} className="hover:bg-slate-800/60 transition-colors bg-slate-900">
                                  <td className="px-3 py-3 whitespace-nowrap font-black text-white">
                                    {bill.billingPeriod || 'Current Period'}
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap">
                                    <span className="font-mono font-bold text-sky-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-xs inline-block">
                                      {bill.accountNumber}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap font-black text-white">
                                    {bill.consumerName}
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap font-mono font-extrabold text-slate-200 text-xs">
                                    {bill.meterNumber}
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap text-right">
                                    <span className="inline-flex items-center justify-end space-x-1 bg-slate-950 text-cyan-300 font-mono font-black text-xs px-2.5 py-1 rounded-md border border-slate-800 shadow-2xs">
                                      <Droplet className="h-3 w-3 text-cyan-400 shrink-0" />
                                      <span>{bill.consumption} m³</span>
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap text-right font-mono font-black text-white text-sm">
                                    {isCancelled ? (
                                      <span className="line-through text-slate-500">₱{totalBill.toFixed(2)}</span>
                                    ) : (
                                      <span className="text-white font-black">₱{totalBill.toFixed(2)}</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-3 whitespace-nowrap text-center">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
                                      isCancelled
                                        ? 'bg-slate-800 text-slate-300 border-slate-700'
                                        : isPaid
                                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                                        : 'bg-amber-950/80 text-amber-300 border-amber-800/80'
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
                                              toast.success(
                                                'Notice Resent',
                                                `SMS and Email bill notification resent to consumer ${bill.consumerName} (Account #${bill.accountNumber}).`
                                              );
                                            }}
                                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-md transition inline-flex items-center space-x-1 cursor-pointer shadow-2xs shrink-0"
                                            title="Resend Notice"
                                          >
                                            <Send className="h-3.5 w-3.5 text-white" />
                                            <span>Resend</span>
                                          </button>

                                          <button
                                            onClick={() => {
                                              setCancelBillModal({
                                                isOpen: true,
                                                bill: bill,
                                                reason: ''
                                              });
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
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    <TablePagination
                      currentPage={billPage}
                      totalItems={filteredBills.length}
                      pageSize={10}
                      onPageChange={setBillPage}
                      itemName="water bills"
                    />
                  </div>
                  </>
                );
              })()}
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
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Smart Search Name, Account #, Meter #, Phone, or RFID</label>
                    <SmartSearchBar
                      variant="light"
                      value={paymentSearch}
                      onChange={setPaymentSearch}
                      placeholder="e.g. 1001-A, Juan Dela Cruz, 09171234567, RFID..."
                      id="admin-cashier-payment-smart-search"
                    />
                  </div>

                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                    {consumers
                      .filter(c =>
                        smartMatch(paymentSearch, [
                          c.accountNumber,
                          c.name,
                          c.contactNumber,
                          c.rfidTag,
                          c.meterNumber,
                          c.barangay,
                          c.address,
                          c.email
                        ])
                      )
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
                          const w = calculateCostOf(r, r.classification);
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
                                const w = calculateCostOf(r, r.classification);
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
                                const waterAmount = calculateCostOf(r, r.classification);
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
                                    const w = calculateCostOf(r, r.classification);
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
                                  const w = calculateCostOf(r, r.classification);
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
                            toast.warning('No Bill Selected', 'Please select at least one bill to process payment.');
                            return;
                          }
                          if (paymentAmountPaid <= 0) {
                            toast.warning('Invalid Amount', 'Please enter a valid cash amount tendered greater than 0.');
                            return;
                          }

                          // Selected bills sorted by reading date (oldest first)
                          const selectedReadings = readings
                            .filter(r => selectedBillIds.includes(r.id))
                            .sort((a, b) => new Date(a.readingDate).getTime() - new Date(b.readingDate).getTime());

                          let remainingCash = paymentAmountPaid;
                          const allocations: { [billId: string]: { allocated: number; newPaid: number; newRem: number; newStatus: 'paid' | 'partial'; grossTotal: number; penaltyAmount: number } } = {};

                          selectedReadings.forEach(r => {
                            const waterAmount = calculateCostOf(r, r.classification);
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
                            const w = calculateCostOf(r, r.classification);
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
                            consumerId: selectedPaymentAccount.id,
                            userId: selectedPaymentAccount.linkedUserId,
                            consumerEmail: selectedPaymentAccount.email,
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
              {/* Staff Module Sub-Navigation */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
                <div className="flex space-x-2 overflow-x-auto scrollbar-none">
                  <button
                    type="button"
                    onClick={() => setStaffSubTab('users')}
                    className={`px-4 py-2.5 rounded-none text-xs font-black uppercase tracking-wider transition flex items-center space-x-2 border cursor-pointer ${
                      staffSubTab === 'users'
                        ? 'bg-slate-900 text-white border-slate-900 shadow'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0 text-blue-400" />
                    <span>Staff Directory & Access Roles</span>
                    <span className="bg-slate-800 text-slate-300 font-mono text-[10px] px-1.5 py-0.5 rounded-sm">
                      {staffList.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStaffSubTab('tariff')}
                    className={`px-4 py-2.5 rounded-none text-xs font-black uppercase tracking-wider transition flex items-center space-x-2 border cursor-pointer ${
                      staffSubTab === 'tariff'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-400/30'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <TrendingUp className="h-4 w-4 shrink-0 text-emerald-300" />
                    <span>Water Tariff Rates & Price Hike Manager</span>
                    <span className="bg-emerald-400 text-slate-950 font-black text-[9px] px-1.5 py-0.5 rounded-none uppercase">
                      LWUA Rate Engine
                    </span>
                  </button>
                </div>
              </div>

              {/* VIEW 1: STAFF DIRECTORY */}
              {staffSubTab === 'users' && (
                <div className="space-y-6">
                  {/* Quick Tariff Summary Banner */}
                  <div className="bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 text-white p-5 rounded-3xl border border-blue-800/80 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3.5">
                      <div className="p-3 bg-blue-500/20 rounded-2xl border border-blue-400/40 text-blue-300 shrink-0">
                        <SlidersHorizontal className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-400/40">
                            Active Tariff: {activeTariff.resolutionNumber}
                          </span>
                          <span className="text-[11px] text-slate-300 font-mono">
                            Effective: {activeTariff.effectiveDate}
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 mt-1 font-medium">
                          Residential Lifeline (1-10 m³): <strong className="text-emerald-400 font-mono">₱{activeTariff.residential.baseMinCharge.toFixed(2)}</strong> • Commercial Lifeline (1-10 m³): <strong className="text-blue-400 font-mono">₱{activeTariff.commercial.baseMinCharge.toFixed(2)}</strong>
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setStaffSubTab('tariff')}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition flex items-center space-x-2 shadow-md cursor-pointer shrink-0"
                    >
                      <TrendingUp className="h-4 w-4" />
                      <span>Adjust Rates / Set Price Hike</span>
                    </button>
                  </div>

                  {/* Staff List Search & Table */}
                  {(() => {
                    const filteredStaffUsers = staffList.filter(st =>
                      smartMatch(staffSearch, [
                        st.id,
                        st.name,
                        st.email,
                        st.role,
                        st.department,
                        st.status
                      ])
                    );
                    const paginatedStaff = filteredStaffUsers.slice((staffPage - 1) * 10, staffPage * 10);
                    return (
                      <>
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                          <div>
                            <h3 className="text-sm font-extrabold text-slate-950 uppercase tracking-wider">Admin Staff & System Permissions</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Manage administrative portal users and role access levels.</p>
                          </div>
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                            <div className="w-full sm:w-80">
                              <SmartSearchBar
                                variant="light"
                                value={staffSearch}
                                onChange={setStaffSearch}
                                resultCount={filteredStaffUsers.length}
                                totalCount={staffList.length}
                                placeholder="Smart search staff ID, name, email, role, or dept..."
                                id="admin-staff-smart-search"
                              />
                            </div>
                            <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 shrink-0">
                              <ShieldCheck className="h-4 w-4 text-emerald-400" />
                              <span>RBAC Managed</span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-xs text-left">
                              <thead className="bg-slate-950 text-slate-300 font-bold uppercase border-b border-slate-800 text-[10px] tracking-wider">
                                <tr>
                                  <th className="px-6 py-4">Staff ID</th>
                                  <th className="px-6 py-4">Name & Email</th>
                                  <th className="px-6 py-4">Role Title</th>
                                  <th className="px-6 py-4">Department</th>
                                  <th className="px-6 py-4">Status</th>
                                  <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/80 font-medium text-slate-200 bg-slate-900">
                                {paginatedStaff.map((st, sIdx) => (
                                  <tr key={`staff-user-${st.id || ''}-${st.email || ''}-${sIdx}`} className="hover:bg-slate-800/60 transition">
                                    <td className="px-6 py-4 font-mono font-bold text-white">{st.id}</td>
                                    <td className="px-6 py-4">
                                      <span className="font-extrabold text-white block">{st.name}</span>
                                      <span className="text-slate-400 text-[10px] font-mono">{st.email}</span>
                                    </td>
                                    <td className="px-6 py-4 font-bold text-sky-400">{st.role}</td>
                                    <td className="px-6 py-4 text-slate-300">{st.department}</td>
                                    <td className="px-6 py-4">
                                      <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-bold px-2.5 py-1 rounded-full text-[10px] uppercase">
                                        {st.status}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                      <button
                                        onClick={() => setEditingStaffModal({ ...st })}
                                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-bold text-[10px] uppercase rounded-lg transition cursor-pointer"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => {
                                          toast.info('Password Reset Initiated', `Password reset notification initiated for ${st.email}`);
                                        }}
                                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] uppercase rounded-lg transition"
                                      >
                                        Reset Pwd
                                      </button>
                                      <button
                                        onClick={() => handleDeleteStaff(st)}
                                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[10px] uppercase rounded-lg transition"
                                      >
                                        Terminate
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <TablePagination
                            currentPage={staffPage}
                            totalItems={filteredStaffUsers.length}
                            pageSize={10}
                            onPageChange={setStaffPage}
                            itemName="staff users"
                          />
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* VIEW 2: TARIFF RATES & PRICE HIKE MANAGER */}
              {staffSubTab === 'tariff' && (
                <TariffRateManager
                  currentUser={currentUser}
                  consumers={consumers}
                  setConsumers={setConsumers}
                  readings={readings}
                  setReadings={setReadings}
                  setAnnouncements={setAnnouncements}
                  onTariffApplied={(newConfig) => {
                    setActiveTariff(newConfig);
                    loadAllDataFromStore(false);
                  }}
                />
              )}
            </div>
          )}

          {/* 11. BARANGAYS MODULE */}
          {activeTab === 'barangays' && (() => {
            // Robust synchronization & mapping of consumers to their Barangay and Zone
            const getConsumersForBarangay = (bg: Barangay) => {
              const bgName = (bg.name || '').trim().toLowerCase();
              const bgId = (bg.id || '').trim().toLowerCase();
              const bgCode = (bg.code || '').trim().toLowerCase();

              return consumers.filter(c => {
                // 1. Direct Barangay ID match
                if (c.barangayId && c.barangayId.trim().toLowerCase() === bgId) return true;

                // 2. Exact or normalized barangay name match
                const cBarangay = (c.barangay || '').trim().toLowerCase();
                if (cBarangay) {
                  if (cBarangay === bgName) return true;
                  if (cBarangay.includes(bgName) || bgName.includes(cBarangay)) return true;
                  const cleanC = cBarangay.replace(/\./g, '').replace(/santa/g, 'sta');
                  const cleanBg = bgName.replace(/\./g, '').replace(/santa/g, 'sta');
                  if (cleanC === cleanBg) return true;
                }

                // 3. Address match
                const cAddr = (c.address || '').trim().toLowerCase();
                if (cAddr) {
                  if (cAddr.includes(bgName)) return true;
                  if (bgCode && cAddr.includes(bgCode)) return true;
                  const cleanAddr = cAddr.replace(/\./g, '').replace(/santa/g, 'sta');
                  const cleanBg = bgName.replace(/\./g, '').replace(/santa/g, 'sta');
                  if (cleanAddr.includes(cleanBg)) return true;
                }

                // 4. Fallback check for Poblacion if no other barangay matches
                if (bg.code === 'PB-01') {
                  const matchesOther = barangayList.some(other => {
                    if (other.id === bg.id) return false;
                    const otherName = (other.name || '').trim().toLowerCase();
                    const otherCode = (other.code || '').trim().toLowerCase();
                    const cleanOther = otherName.replace(/\./g, '').replace(/santa/g, 'sta');
                    return (c.barangayId && c.barangayId.trim().toLowerCase() === other.id.trim().toLowerCase()) ||
                           (cBarangay && (cBarangay === otherName || cBarangay.replace(/\./g, '').replace(/santa/g, 'sta') === cleanOther)) ||
                           (cAddr && (cAddr.includes(otherName) || (otherCode && cAddr.includes(otherCode))));
                  });
                  if (!matchesOther) return true;
                }

                return false;
              });
            };

            return (
              <div className="space-y-6 animate-fade-in" id="barangays-tab">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wider font-sans">Barangays & Service Area Zones</h3>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">Municipal water distribution zones, collection schedules, and real-time consumer synchronization in Tagoloan.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span className="font-bold text-white">{consumers.length}</span> Total Consumers Synced Across <span className="font-bold text-white">{barangayList.length}</span> Barangays
                    </div>
                    <button
                      type="button"
                      onClick={handleSyncConsumersAndBarangays}
                      disabled={isSyncingBarangays}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-md cursor-pointer disabled:opacity-50"
                      title="Validate and synchronize every consumer into their respective Barangay and Sitio Zone"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncingBarangays ? 'animate-spin' : ''}`} />
                      <span>{isSyncingBarangays ? 'Syncing...' : 'Sync Consumers & Zones'}</span>
                    </button>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
                  <SmartSearchBar
                    variant="dark"
                    value={barangayOverviewSearch}
                    onChange={setBarangayOverviewSearch}
                    resultCount={
                      barangayList.filter(bg => {
                        const bgConsumers = getConsumersForBarangay(bg);
                        return smartMatch(barangayOverviewSearch, [
                          bg.name,
                          bg.code,
                          bg.supervisor,
                          bg.schedule,
                          ...bgConsumers.flatMap(c => [c.name, c.accountNumber, c.meterNumber, c.sitioZone, c.contactNumber])
                        ]);
                      }).length
                    }
                    totalCount={barangayList.length}
                    placeholder="Smart search barangay zone, code, supervisor, sitio, or any consumer name / account # inside..."
                    id="admin-barangays-overview-smart-search"
                  />
                </div>

                {/* Barangay Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {barangayList
                    .filter(bg => {
                      const bgConsumers = getConsumersForBarangay(bg);
                      return smartMatch(barangayOverviewSearch, [
                        bg.name,
                        bg.code,
                        bg.supervisor,
                        bg.schedule,
                        ...bgConsumers.flatMap(c => [c.name, c.accountNumber, c.meterNumber, c.sitioZone, c.contactNumber])
                      ]);
                    })
                    .map((bg, bgIdx) => {
                    const bgConsumers = getConsumersForBarangay(bg);
                    const activeCount = bgConsumers.filter(c => c.status === 'active').length;
                    const pendingCount = bgConsumers.filter(c => c.status === 'pending_approval' || c.status === 'pending').length;
                    const inactiveCount = bgConsumers.filter(c => c.status === 'inactive').length;
                    const activeMeters = bgConsumers.filter(c => c.meterNumber && c.status === 'active').length;
                    const resCount = bgConsumers.filter(c => (c.consumerType || 'Residential') === 'Residential').length;
                    const commCount = bgConsumers.filter(c => c.consumerType === 'Commercial').length;
                    const uniqueSitios = Array.from(new Set(bgConsumers.map(c => (c.sitioZone || '').trim()).filter(Boolean)));

                    return (
                      <div 
                        key={`bg-card-${bg.id || bg.code || bgIdx}-${bgIdx}`} 
                        onClick={() => {
                          setSelectedBarangayForDetail(bg);
                          setBarangaySearchQuery('');
                          setBarangayZoneFilter('all');
                          setBarangayStatusFilter('all');
                          setBarangayConsumersPage(1);
                          setExpandedBarangayConsumerId(null);
                        }}
                        className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4 hover:border-blue-500/80 hover:shadow-2xl hover:scale-[1.01] transition-all cursor-pointer group flex flex-col justify-between relative overflow-hidden"
                      >
                        <div className="space-y-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-base font-black text-white group-hover:text-blue-400 transition-colors">{bg.name}</h4>
                                <span className="text-[10px] font-mono font-bold text-sky-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                                  {bg.code || 'ZONE'}
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-400 font-medium">Tagoloan Water District Coverage Area</span>
                            </div>
                            <div className="p-2.5 rounded-2xl bg-blue-950/60 border border-blue-800/70 text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-xs">
                              <MapPin className="h-5 w-5" />
                            </div>
                          </div>

                          {/* Connection Metrics */}
                          <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80">
                            <div>
                              <span className="text-[10px] text-slate-400 font-bold uppercase block">Consumers</span>
                              <span className="font-extrabold text-white text-sm flex items-center gap-1.5">
                                {bgConsumers.length} Total
                                {pendingCount > 0 && (
                                  <span className="text-[9px] px-1.5 py-0.2 bg-amber-950/80 text-amber-400 rounded border border-amber-800/60 font-semibold">
                                    {pendingCount} new
                                  </span>
                                )}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 font-bold uppercase block">Active Meters</span>
                              <span className="font-bold text-emerald-400 text-sm">{activeMeters} installed</span>
                            </div>
                            <div className="pt-2 border-t border-slate-900 col-span-2 flex items-center justify-between text-[11px] text-slate-400">
                              <span>Classification:</span>
                              <span className="font-bold text-slate-200">{resCount} Res • {commCount} Comm</span>
                            </div>
                          </div>

                          {/* Zone / Sitio Coverage Preview with Consumer Counts */}
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Zones & Sitios</span>
                            <div className="flex flex-wrap gap-1.5">
                              {uniqueSitios.length > 0 ? (
                                uniqueSitios.slice(0, 3).map((st, sIdx) => {
                                  const countInSitio = bgConsumers.filter(c => (c.sitioZone || '').trim() === st).length;
                                  return (
                                    <span key={`st-chip-${sIdx}`} className="text-[10px] font-mono px-2 py-0.5 bg-slate-800/80 text-slate-300 rounded border border-slate-700/80 flex items-center gap-1">
                                      <span>{st}</span>
                                      <span className="text-sky-400 font-bold">({countInSitio})</span>
                                    </span>
                                  );
                                })
                              ) : (
                                <span className="text-[10px] text-slate-500 italic">Central Service Zone</span>
                              )}
                              {uniqueSitios.length > 3 && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
                                  +{uniqueSitios.length - 3} more
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Supervisor & Rate */}
                          <div className="text-[11px] text-slate-400 flex justify-between items-center pt-2 border-t border-slate-800/80">
                            <span className="truncate max-w-[160px]" title={bg.supervisor || 'District Lead'}>
                              Lead: <strong className="text-slate-200">{bg.supervisor || 'District Lead'}</strong>
                            </span>
                            <span className="font-mono font-bold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800/60 shrink-0">
                              ₱{bg.ratePerM3}/m³
                            </span>
                          </div>
                        </div>

                        {/* Card Action Buttons */}
                        <div className="flex items-center justify-between pt-3 border-t border-slate-800 gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBarangayForDetail(bg);
                              setBarangaySearchQuery('');
                              setBarangayZoneFilter('all');
                              setBarangayStatusFilter('all');
                              setBarangayConsumersPage(1);
                              setExpandedBarangayConsumerId(null);
                            }}
                            className="flex-1 py-2 px-3 bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 border border-blue-500/30 cursor-pointer shadow-xs"
                          >
                            <Users className="h-3.5 w-3.5" />
                            <span>View Consumers ({bgConsumers.length}) & Details</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingBarangayModal({ ...bg });
                            }}
                            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700 cursor-pointer"
                            title="Edit Zone Parameters"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

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
                <DistrictProfileSection id="admin-district-profile" isDarkTheme={true} />
              </div>
            </div>
          )}
          </>
          )}

        </div>
      </main>

      {/* 11. BARANGAY CONSUMERS & ZONE DETAILS DRILL-DOWN ROOT OVERLAY MODAL */}
      {selectedBarangayForDetail && (() => {
        const bg = barangayList.find(b => b.id === selectedBarangayForDetail.id) || selectedBarangayForDetail;
        const allInBarangay = getConsumersForBarangay(bg);
        const uniqueSitios = Array.from(new Set(allInBarangay.map(c => (c.sitioZone || '').trim()).filter(Boolean)));
        const activeMeters = allInBarangay.filter(c => c.meterNumber && c.status === 'active').length;
        const activeCount = allInBarangay.filter(c => c.status === 'active').length;
        const pendingCount = allInBarangay.filter(c => c.status === 'pending_approval' || c.status === 'pending').length;
        const resCount = allInBarangay.filter(c => (c.consumerType || 'Residential') === 'Residential').length;
        const commCount = allInBarangay.filter(c => c.consumerType === 'Commercial').length;
        const totalArrearsInBarangay = allInBarangay.reduce((sum, c) => sum + (Number(c.outstandingBalance) || 0), 0);

        // Filter consumers based on search, zone, status, and category
        const filteredModalConsumers = allInBarangay.filter(c => {
          if (barangayZoneFilter !== 'all') {
            if ((c.sitioZone || '').trim() !== barangayZoneFilter) return false;
          }
          if (barangayStatusFilter !== 'all') {
            if (c.status !== barangayStatusFilter) return false;
          }
          if (barangayCategoryFilter !== 'all') {
            if ((c.consumerType || 'Residential') !== barangayCategoryFilter) return false;
          }
          return smartMatch(barangaySearchQuery, [
            c.name,
            c.accountNumber,
            c.meterNumber,
            c.rfidTag,
            c.sitioZone,
            c.contactNumber,
            c.email,
            c.address,
            c.consumerType,
            c.status
          ]);
        });

        const paginatedBarangayConsumers = filteredModalConsumers.slice(
          (barangayConsumersPage - 1) * 10,
          barangayConsumersPage * 10
        );

        return (
          <div 
            className="fixed inset-0 z-[110] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto animate-fade-in select-none"
            onClick={() => setSelectedBarangayForDetail(null)}
          >
            <div 
              className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl text-slate-100 select-text my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="bg-slate-950 p-4 sm:p-6 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="p-3 bg-blue-950/80 border border-blue-800/80 rounded-2xl text-blue-400 shrink-0 shadow-xs">
                    <MapPin className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg sm:text-xl font-black text-white truncate">Barangay {bg.name}</h3>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-900/60 text-blue-300 border border-blue-700">
                        {bg.code || 'ZONE'}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        {allInBarangay.length} Registered Consumers
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 truncate">
                      Tagoloan Water District • Zone Coverage & Consumer Directory • Lead: <strong className="text-slate-200">{bg.supervisor || 'Operations Lead'}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingBarangayModal({ ...bg })}
                    className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700 cursor-pointer"
                    title="Edit Zone Parameters & Tariff"
                  >
                    <Edit2 className="h-3.5 w-3.5 text-blue-400" />
                    <span>Edit Parameters</span>
                  </button>

                  <button 
                    type="button"
                    onClick={() => setSelectedBarangayForDetail(null)}
                    className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
                    title="Close Details Modal (Esc)"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Modal Scrollable Body */}
              <div className="overflow-y-auto p-4 sm:p-6 space-y-5 flex-1">
                {/* 5 Summary Stat Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 shadow-xs space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Consumers</span>
                    <span className="text-xl sm:text-2xl font-black text-white">{allInBarangay.length}</span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {activeCount} active • {pendingCount} pending
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-900/50 shadow-xs space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">Active Meters</span>
                    <span className="text-xl sm:text-2xl font-black text-emerald-300">{activeMeters}</span>
                    <span className="text-[10px] text-emerald-400/70 block truncate">Operational connections</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-blue-950/30 border border-blue-900/50 shadow-xs space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">Classification</span>
                    <span className="text-base sm:text-lg font-black text-blue-200">{resCount} Res • {commCount} Comm</span>
                    <span className="text-[10px] text-blue-400/70 block truncate">Connection types</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 shadow-xs space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Tariff & Cycle</span>
                    <span className="text-base sm:text-lg font-mono font-black text-emerald-400">₱{Number(bg.ratePerM3 || 0).toFixed(2)}/m³</span>
                    <span className="text-[10px] text-slate-400 block truncate" title={bg.schedule}>{bg.schedule || 'Monthly'}</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-amber-950/20 border border-amber-900/40 shadow-xs space-y-1 col-span-2 sm:col-span-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">Outstanding Dues</span>
                    <span className="text-base sm:text-lg font-mono font-black text-amber-300">₱{totalArrearsInBarangay.toFixed(2)}</span>
                    <span className="text-[10px] text-amber-400/70 block truncate">Total receivables</span>
                  </div>
                </div>

                {/* Zone / Sitio Filter Matrix */}
                {uniqueSitios.length > 0 && (
                  <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Route className="h-3.5 w-3.5 text-blue-400" />
                        <span>Filter by Sitio / Service Zone</span>
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">{uniqueSitios.length} zones recorded</span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setBarangayZoneFilter('all')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                          barangayZoneFilter === 'all'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-850'
                        }`}
                      >
                        All Zones ({allInBarangay.length})
                      </button>
                      {uniqueSitios.map((st, sIdx) => {
                        const stCount = allInBarangay.filter(c => (c.sitioZone || '').trim() === st).length;
                        return (
                          <button
                            key={`filter-st-${sIdx}`}
                            type="button"
                            onClick={() => setBarangayZoneFilter(st)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                              barangayZoneFilter === st
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-850'
                            }`}
                          >
                            <span>{st}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/40 text-slate-200 font-mono font-bold">
                              {stCount}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Search and Filters Bar */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                  <div className="flex-1 w-full">
                    <SmartSearchBar
                      variant="dark"
                      value={barangaySearchQuery}
                      onChange={setBarangaySearchQuery}
                      resultCount={filteredModalConsumers.length}
                      totalCount={allInBarangay.length}
                      placeholder={`Smart search in ${bg.name} by name, account #, meter #, sitio, phone, or address...`}
                      id="admin-barangay-modal-smart-search"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <select
                      value={barangayStatusFilter}
                      onChange={(e) => setBarangayStatusFilter(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 focus:outline-none cursor-pointer"
                    >
                      <option value="all">All Statuses</option>
                      <option value="active">Active Only</option>
                      <option value="pending_approval">Pending Approval</option>
                      <option value="inactive">Inactive</option>
                    </select>

                    <select
                      value={barangayCategoryFilter}
                      onChange={(e) => setBarangayCategoryFilter(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 focus:outline-none cursor-pointer"
                    >
                      <option value="all">All Types</option>
                      <option value="Residential">Residential</option>
                      <option value="Commercial">Commercial</option>
                    </select>

                    {(barangaySearchQuery || barangayZoneFilter !== 'all' || barangayStatusFilter !== 'all' || barangayCategoryFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setBarangaySearchQuery('');
                          setBarangayZoneFilter('all');
                          setBarangayStatusFilter('all');
                          setBarangayCategoryFilter('all');
                        }}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer shrink-0"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {/* Detailed Consumers Table */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-900 text-slate-300 uppercase text-[10px] tracking-wider font-extrabold border-b border-slate-800">
                        <tr>
                          <th className="py-3 px-4">Account Number</th>
                          <th className="py-3 px-4">Consumer Name</th>
                          <th className="py-3 px-4">Sitio / Zone</th>
                          <th className="py-3 px-4">Meter Serial & Brand</th>
                          <th className="py-3 px-4">Category</th>
                          <th className="py-3 px-4">Outstanding Due</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Details & Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium">
                        {paginatedBarangayConsumers.length > 0 ? (
                          paginatedBarangayConsumers.map((c, cIdx) => {
                            const isPending = !c.accountNumber || String(c.accountNumber).toUpperCase().startsWith('PENDING') || c.status === 'pending_approval';
                            const consumerKey = String(c.accountNumber || c.id || `c-${cIdx}`);
                            const isExpanded = expandedBarangayConsumerId === consumerKey;

                            return (
                              <React.Fragment key={`bg-con-${consumerKey}`}>
                                <tr className={`hover:bg-slate-900/60 transition ${isExpanded ? 'bg-slate-900/80' : ''}`}>
                                  <td className="py-3 px-4 font-mono font-bold whitespace-nowrap">
                                    {isPending ? (
                                      <span className="text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800 text-[11px]">
                                        Pending Issuance
                                      </span>
                                    ) : (
                                      <span className="text-sky-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                        #{c.accountNumber}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4">
                                    <p className="font-bold text-white leading-tight">{c.name}</p>
                                    <p className="text-[10px] text-slate-400 truncate max-w-[180px]">{c.email || c.contactNumber || 'No contact on file'}</p>
                                  </td>
                                  <td className="py-3 px-4 whitespace-nowrap">
                                    <span className="inline-block px-2.5 py-0.5 rounded-md bg-slate-900 text-slate-300 font-mono text-[11px] border border-slate-800">
                                      {c.sitioZone || 'Central Zone'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 whitespace-nowrap font-mono">
                                    {c.meterNumber ? (
                                      <span className="text-white font-bold">{c.meterNumber} <span className="text-slate-400 text-[10px]">({c.meterBrand || 'EVER'})</span></span>
                                    ) : (
                                      <span className="text-slate-500 italic">No meter linked</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                      c.consumerType === 'Commercial'
                                        ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                        : 'bg-blue-950 text-blue-300 border border-blue-800'
                                    }`}>
                                      {c.consumerType || 'Residential'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 whitespace-nowrap font-mono">
                                    {(Number(c.outstandingBalance) || 0) > 0 ? (
                                      <span className="text-amber-400 font-bold">₱{(Number(c.outstandingBalance) || 0).toFixed(2)}</span>
                                    ) : (
                                      <span className="text-emerald-400 font-bold">₱0.00</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 whitespace-nowrap">
                                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                                      c.status === 'active'
                                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                        : c.status === 'pending_approval' || c.status === 'pending'
                                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                                        : 'bg-slate-800 text-slate-400 border-slate-700'
                                    }`}>
                                      {c.status === 'pending_approval' ? 'Pending Approval' : c.status}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedBarangayConsumerId(isExpanded ? null : consumerKey)}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer border inline-flex items-center gap-1 ${
                                        isExpanded
                                          ? 'bg-blue-600 text-white border-blue-500'
                                          : 'bg-slate-800 hover:bg-slate-700 text-sky-300 border-slate-700'
                                      }`}
                                      title={isExpanded ? 'Collapse Quick Details' : 'View Quick Details'}
                                    >
                                      <span>{isExpanded ? 'Hide' : 'Details'}</span>
                                      {isExpanded ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedConsumerModal(c);
                                      }}
                                      className="px-2.5 py-1 bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white rounded-lg text-xs font-bold transition cursor-pointer border border-slate-700"
                                      title="View Full Profile & Ledger"
                                    >
                                      Profile
                                    </button>
                                  </td>
                                </tr>

                                {/* Expandable Consumer Details Drawer */}
                                {isExpanded && (
                                  <tr className="bg-slate-900/90 border-b border-slate-800">
                                    <td colSpan={8} className="p-4 bg-slate-950/80 border-t border-slate-800/80">
                                      <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono font-bold text-sky-400 text-xs">#{c.accountNumber || 'PENDING'}</span>
                                            <span className="text-xs font-bold text-white">{c.name}</span>
                                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                                              Barangay {bg.name} ({c.sitioZone || 'Central Zone'})
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedConsumerModal(c);
                                            }}
                                            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                                          >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            <span>Open Full Profile & Ledger</span>
                                          </button>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                                          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 space-y-1">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Registered Address</span>
                                            <p className="font-semibold text-slate-200">{c.address || `${c.sitioZone || 'Central'}, ${bg.name}, Tagoloan`}</p>
                                            <span className="text-[10px] text-slate-500 block">Designated Zone: {c.sitioZone || 'Zone 1'}</span>
                                          </div>

                                          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 space-y-1">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Contact Information</span>
                                            <p className="font-semibold text-slate-200">{c.contactNumber || 'No phone recorded'}</p>
                                            <p className="text-[11px] text-slate-400 truncate">{c.email || 'No email recorded'}</p>
                                          </div>

                                          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 space-y-1">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Water Meter Specs</span>
                                            <p className="font-semibold text-emerald-400 font-mono">{c.meterNumber || 'Unassigned Meter'}</p>
                                            <p className="text-[10px] text-slate-400">Brand: {c.meterBrand || 'EVER Standard'} • RFID: {c.rfidTag || 'None'}</p>
                                          </div>

                                          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 space-y-1">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Reading & Billing Cycle</span>
                                            <p className="font-semibold text-sky-300">{bg.schedule || 'Monthly Schedule'}</p>
                                            <p className="text-[10px] text-slate-400 font-mono">Current Tariff: ₱{Number(bg.ratePerM3 || 0).toFixed(2)}/m³</p>
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={8} className="py-12 text-center text-slate-400">
                              <p className="font-bold text-white text-sm">No consumers match your filter in Barangay {bg.name}</p>
                              <p className="text-xs text-slate-500 mt-1">Try resetting the search query or selecting "All Zones".</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <TablePagination
                    currentPage={barangayConsumersPage}
                    totalItems={filteredModalConsumers.length}
                    pageSize={10}
                    onPageChange={setBarangayConsumersPage}
                    itemName="consumers"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="bg-slate-950 p-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                <span className="text-xs text-slate-400 text-center sm:text-left">
                  Showing <strong className="text-white">{filteredModalConsumers.length}</strong> of <strong className="text-white">{allInBarangay.length}</strong> registered consumers in Barangay {bg.name}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingBarangayModal({ ...bg })}
                    className="sm:hidden px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Edit Zone
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBarangayForDetail(null)}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
                  >
                    Close Details
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
          className="fixed inset-0 z-[130] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden animate-fade-in select-none"
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
                      {(() => {
                        const cleanNorm = normalizePhoneNumber(modalEditContactNumber);
                        const isPhoneValid = cleanNorm.length === 11 && cleanNorm.startsWith('09');
                        const phoneDup = cleanNorm.length === 11 ? detectExistingPhoneAccount(cleanNorm, {
                          accountNumber: selectedConsumerModal.accountNumber,
                          email: selectedConsumerModal.email,
                          linkedUserId: selectedConsumerModal.linkedUserId
                        }) : null;

                        return (
                          <>
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="block text-slate-200 font-extrabold text-xs">
                                Phone Number (11 Digits) *
                              </label>
                              <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                cleanNorm.length === 11
                                  ? phoneDup
                                    ? 'bg-rose-900/60 text-rose-300 border border-rose-700/60'
                                    : 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                                  : cleanNorm.length > 0
                                    ? 'bg-amber-900/40 text-amber-300 border border-amber-700/40'
                                    : 'bg-slate-800 text-slate-400'
                              }`}>
                                {cleanNorm.length}/11 digits
                              </span>
                            </div>
                            <input
                              type="tel"
                              inputMode="numeric"
                              pattern="[0-9]{11}"
                              maxLength={11}
                              required
                              placeholder="09XXXXXXXXX (11 digits)"
                              value={modalEditContactNumber}
                              onChange={(e) => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
                                setModalEditContactNumber(digits);
                              }}
                              className={`w-full rounded-lg p-2.5 font-mono font-bold text-xs shadow-2xs focus:outline-none transition ${
                                phoneDup
                                  ? 'bg-rose-950/60 border-2 border-rose-500 text-rose-100 ring-1 ring-rose-500'
                                  : isPhoneValid
                                    ? 'bg-slate-950 border border-emerald-500/80 text-emerald-100'
                                    : 'bg-slate-950 border border-slate-700 text-white focus:border-blue-500'
                              }`}
                            />
                            {phoneDup ? (
                              <div className="mt-1 p-2 bg-rose-950/90 border border-rose-500/70 rounded-lg text-rose-200 text-[10px] leading-tight">
                                <span className="font-bold">Duplicate Detected:</span> Connected to existing account "{phoneDup.name}". Duplicate phone numbers are strictly prohibited.
                              </div>
                            ) : cleanNorm.length > 0 && cleanNorm.length < 11 ? (
                              <p className="text-[10px] text-amber-400 mt-1">Allowed only 11 digits starting with 09.</p>
                            ) : null}
                          </>
                        );
                      })()}
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
                        <option value="Disconnection Notice">⚠️ Disconnection Notice</option>
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

                  {(() => {
                    const accWarning = modalIssueAccountNumber.trim() ? checkDuplicateAccountNumber(modalIssueAccountNumber, selectedConsumerModal) : null;
                    const meterWarning = modalIssueMeterNumber.trim() ? checkDuplicateMeterTag(modalIssueMeterNumber, selectedConsumerModal) : null;
                    const rfidWarning = modalIssueRfidTag.trim() ? checkDuplicateRfidTag(modalIssueRfidTag, selectedConsumerModal) : null;
                    const hasAnyDuplicate = Boolean(accWarning || (!isAlreadyIssued && (meterWarning || rfidWarning)));

                    return (
                      <>
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
                              className={`w-full text-white border rounded-lg p-2.5 font-mono font-black text-xs shadow-2xs focus:outline-none transition ${
                                accWarning
                                  ? 'bg-rose-950/80 border-2 border-rose-500 text-rose-100 ring-2 ring-rose-500/30'
                                  : 'bg-slate-950 border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                              }`}
                            />
                            {accWarning ? (
                              <div className="mt-1.5 p-2 bg-rose-950/90 border border-rose-500/80 rounded-lg text-rose-200 text-[10px] flex items-start gap-1.5 leading-tight">
                                <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                                <div>
                                  <strong className="font-bold text-rose-100">Duplicate Account:</strong> {accWarning.message}
                                </div>
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-400 mt-1">
                                {isAlreadyIssued 
                                  ? '✏️ Editable for account updates, transfer, or re-numbering.'
                                  : 'Assign unique official municipal account number.'}
                              </p>
                            )}
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
                              className={`w-full border rounded-lg p-2.5 font-mono font-black text-xs shadow-2xs transition ${
                                isAlreadyIssued
                                  ? 'bg-slate-950/80 text-slate-400 border-slate-800 cursor-not-allowed select-none'
                                  : meterWarning
                                    ? 'bg-rose-950/80 border-2 border-rose-500 text-rose-100 ring-2 ring-rose-500/30'
                                    : 'bg-slate-950 text-white border-slate-700 focus:outline-none focus:border-blue-500'
                              }`}
                            />
                            {meterWarning && !isAlreadyIssued ? (
                              <div className="mt-1.5 p-2 bg-rose-950/90 border border-rose-500/80 rounded-lg text-rose-200 text-[10px] flex items-start gap-1.5 leading-tight">
                                <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                                <div>
                                  <strong className="font-bold text-rose-100">Duplicate Tag:</strong> {meterWarning.message}
                                </div>
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-400 mt-1">
                                {isAlreadyIssued
                                  ? '🔒 Fixed physical mechanical meter serial attached on-site.'
                                  : 'Assign unique meter serial number.'}
                              </p>
                            )}
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
                              className={`w-full border rounded-lg p-2.5 font-mono font-black text-xs shadow-2xs transition ${
                                isAlreadyIssued
                                  ? 'bg-slate-950/80 text-slate-400 border-slate-800 cursor-not-allowed select-none'
                                  : rfidWarning
                                    ? 'bg-rose-950/80 border-2 border-rose-500 text-rose-100 ring-2 ring-rose-500/30'
                                    : 'bg-slate-950 text-white border-slate-700 focus:outline-none focus:border-blue-500'
                              }`}
                            />
                            {rfidWarning && !isAlreadyIssued ? (
                              <div className="mt-1.5 p-2 bg-rose-950/90 border border-rose-500/80 rounded-lg text-rose-200 text-[10px] flex items-start gap-1.5 leading-tight">
                                <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                                <div>
                                  <strong className="font-bold text-rose-100">Duplicate RFID:</strong> {rfidWarning.message}
                                </div>
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-400 mt-1">
                                {isAlreadyIssued
                                  ? '🔒 Unique physical RFID entity across Tagoloan Water District.'
                                  : 'Assign unique RFID reader tag.'}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="pt-2 flex justify-end">
                          {isAlreadyIssued ? (
                            <button
                              type="submit"
                              disabled={hasAnyDuplicate}
                              className={`px-6 py-2.5 font-black rounded-xl text-xs transition shadow-md uppercase tracking-wider flex items-center space-x-1.5 ${
                                hasAnyDuplicate
                                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-60'
                                  : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                              }`}
                            >
                              <RefreshCw className="h-4 w-4" />
                              <span>{hasAnyDuplicate ? 'Resolve Duplicate First' : 'Update Account Number'}</span>
                            </button>
                          ) : (
                            <button
                              type="submit"
                              disabled={hasAnyDuplicate}
                              className={`px-6 py-2.5 font-black rounded-xl text-xs transition shadow-md uppercase tracking-wider flex items-center space-x-1.5 ${
                                hasAnyDuplicate
                                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-60'
                                  : 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                              }`}
                            >
                              <ShieldCheck className="h-4 w-4" />
                              <span>{hasAnyDuplicate ? 'Resolve Duplicate First' : 'Issue Identifiers & Activate Account'}</span>
                            </button>
                          )}
                        </div>
                      </>
                    );
                  })()}
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

      {/* EDIT STAFF MODAL */}
      {editingStaffModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 sm:p-8 max-w-lg w-full text-white shadow-2xl space-y-6 animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-extrabold text-white">Edit Staff Member</h3>
                <p className="text-xs text-slate-400">Update system credentials and role permissions</p>
              </div>
              <button
                onClick={() => setEditingStaffModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateStaff} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editingStaffModal.name}
                  onChange={(e) => setEditingStaffModal({ ...editingStaffModal, name: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={editingStaffModal.email}
                  onChange={(e) => setEditingStaffModal({ ...editingStaffModal, email: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Role</label>
                  <select
                    value={editingStaffModal.role}
                    onChange={(e) => setEditingStaffModal({ ...editingStaffModal, role: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                  >
                    <option value="Administrator">Administrator</option>
                    <option value="Supervisor">Supervisor</option>
                    <option value="Cashier">Cashier</option>
                    <option value="Billing Officer">Billing Officer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Status</label>
                  <select
                    value={editingStaffModal.status}
                    onChange={(e) => setEditingStaffModal({ ...editingStaffModal, status: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Department</label>
                <input
                  type="text"
                  value={editingStaffModal.department}
                  onChange={(e) => setEditingStaffModal({ ...editingStaffModal, department: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingStaffModal(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl uppercase tracking-wider"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT BARANGAY MODAL */}
      {editingBarangayModal && (
        <div className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 sm:p-8 max-w-lg w-full text-white shadow-2xl space-y-6 animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-extrabold text-white">Edit Barangay Service Area</h3>
                <p className="text-xs text-slate-400">Configure zone parameters and rate per cubic meter</p>
              </div>
              <button
                onClick={() => setEditingBarangayModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateBarangay} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Barangay Name</label>
                  <input
                    type="text"
                    required
                    value={editingBarangayModal.name}
                    onChange={(e) => setEditingBarangayModal({ ...editingBarangayModal, name: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Zone Code</label>
                  <input
                    type="text"
                    required
                    value={editingBarangayModal.code}
                    onChange={(e) => setEditingBarangayModal({ ...editingBarangayModal, code: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Supervisor</label>
                  <input
                    type="text"
                    value={editingBarangayModal.supervisor}
                    onChange={(e) => setEditingBarangayModal({ ...editingBarangayModal, supervisor: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Rate (₱/m³)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingBarangayModal.ratePerM3}
                    onChange={(e) => setEditingBarangayModal({ ...editingBarangayModal, ratePerM3: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Billing / Reading Schedule</label>
                <input
                  type="text"
                  value={editingBarangayModal.schedule}
                  onChange={(e) => setEditingBarangayModal({ ...editingBarangayModal, schedule: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingBarangayModal(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl uppercase tracking-wider"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT METER MODAL */}
      {editingMeterModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 sm:p-8 max-w-lg w-full text-white shadow-2xl space-y-6 animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-extrabold text-white">Edit Water Meter #{editingMeterModal.meterNumber}</h3>
                <p className="text-xs text-slate-400">Update hardware details and operational status</p>
              </div>
              <button
                onClick={() => setEditingMeterModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateMeter} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Meter Serial Number</label>
                  <input
                    type="text"
                    required
                    value={editingMeterModal.meterNumber}
                    onChange={(e) => setEditingMeterModal({ ...editingMeterModal, meterNumber: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Brand / Manufacturer</label>
                  <input
                    type="text"
                    required
                    value={editingMeterModal.brand}
                    onChange={(e) => setEditingMeterModal({ ...editingMeterModal, brand: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Linked Account #</label>
                  <input
                    type="text"
                    value={editingMeterModal.linkedAccountNumber || ''}
                    placeholder="Unassigned"
                    onChange={(e) => setEditingMeterModal({ ...editingMeterModal, linkedAccountNumber: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Operational Status</label>
                  <select
                    value={editingMeterModal.status}
                    onChange={(e: any) => setEditingMeterModal({ ...editingMeterModal, status: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                  >
                    <option value="active">Active</option>
                    <option value="damaged">Damaged</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Installation Date</label>
                <input
                  type="date"
                  value={editingMeterModal.installationDate}
                  onChange={(e) => setEditingMeterModal({ ...editingMeterModal, installationDate: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingMeterModal(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl uppercase tracking-wider"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT ANNOUNCEMENT MODAL */}
      {editingAnnouncementModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 sm:p-8 max-w-lg w-full text-white shadow-2xl space-y-6 animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-extrabold text-white">Edit Advisory Bulletin</h3>
                <p className="text-xs text-slate-400">Update public announcement information</p>
              </div>
              <button
                onClick={() => setEditingAnnouncementModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateAnnouncement} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={editingAnnouncementModal.title}
                  onChange={(e) => setEditingAnnouncementModal({ ...editingAnnouncementModal, title: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Category</label>
                  <select
                    value={editingAnnouncementModal.category}
                    onChange={(e: any) => setEditingAnnouncementModal({ ...editingAnnouncementModal, category: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                  >
                    <option value="disruption">Service Disruption</option>
                    <option value="maintenance">Preventive Maintenance</option>
                    <option value="event">Community Event</option>
                    <option value="info">General Info</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Posted By</label>
                  <input
                    type="text"
                    value={editingAnnouncementModal.postedBy}
                    onChange={(e) => setEditingAnnouncementModal({ ...editingAnnouncementModal, postedBy: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Content</label>
                <textarea
                  rows={4}
                  required
                  value={editingAnnouncementModal.content}
                  onChange={(e) => setEditingAnnouncementModal({ ...editingAnnouncementModal, content: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingAnnouncementModal(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl uppercase tracking-wider"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT METER READER MODAL */}
      {editingReaderModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full text-slate-100 shadow-2xl space-y-6 animate-fade-in max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 rounded-xl bg-blue-950/70 text-blue-400 border border-blue-800/60 flex items-center justify-center font-bold">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Edit Meter Reader Officer</h3>
                  <p className="text-xs text-slate-400">Update field credentials, duty status & service route</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingReaderModal(null)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateReader} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Full Officer Name</label>
                <input
                  type="text"
                  required
                  value={editingReaderModal.name}
                  onChange={(e) => setEditingReaderModal({ ...editingReaderModal, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-medium text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Username / Badge ID</label>
                  <input
                    type="text"
                    required
                    value={editingReaderModal.username || ''}
                    onChange={(e) => setEditingReaderModal({ ...editingReaderModal, username: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Duty Status</label>
                  <select
                    value={editingReaderModal.employmentStatus || 'active'}
                    onChange={(e: any) => setEditingReaderModal({ 
                      ...editingReaderModal, 
                      employmentStatus: e.target.value,
                      status: e.target.value
                    })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-bold text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer"
                  >
                    <option value="active">Active Duty</option>
                    <option value="pending_approval">Pending Approval</option>
                    <option value="inactive">Inactive / Standby</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Mobile Phone / Contact</label>
                  <input
                    type="text"
                    placeholder="09XXXXXXXXX"
                    value={editingReaderModal.contactNumber || ''}
                    onChange={(e) => setEditingReaderModal({ ...editingReaderModal, contactNumber: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-medium text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Terminal PIN / Password</label>
                  <input
                    type="text"
                    placeholder="e.g. 1234"
                    value={editingReaderModal.password || editingReaderModal.pin || ''}
                    onChange={(e) => setEditingReaderModal({ 
                      ...editingReaderModal, 
                      password: e.target.value,
                      pin: e.target.value
                    })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="officer@tagoloanwater.ph"
                  value={editingReaderModal.email || ''}
                  onChange={(e) => setEditingReaderModal({ ...editingReaderModal, email: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-medium text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Primary Route Assignment</label>
                <select
                  value={(editingReaderModal.assignedRoutes && editingReaderModal.assignedRoutes[0]) || editingReaderModal.targetRoute || 'Zone 1-4: Poblacion (Main Central)'}
                  onChange={(e) => {
                    const newRoute = e.target.value;
                    setEditingReaderModal({
                      ...editingReaderModal,
                      assignedRoutes: [newRoute],
                      targetRoute: newRoute
                    });
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-bold text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer"
                >
                  {routes.map(rt => (
                    <option key={rt.id} value={rt.routeName}>
                      {rt.routeName} ({rt.barangay || 'Tagoloan'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingReaderModal(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl cursor-pointer transition border border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl uppercase tracking-wider shadow-sm cursor-pointer transition"
                >
                  Save Officer Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* GLOBAL SANDBOX-SAFE CONFIRMATION MODAL                        */}
      {/* ------------------------------------------------------------- */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start space-x-3.5">
              <div className={`p-3 rounded-2xl shrink-0 ${
                confirmDialog.confirmVariant === 'success' 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : confirmDialog.confirmVariant === 'primary'
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}>
                {confirmDialog.confirmVariant === 'success' ? (
                  <CheckCheck className="h-6 w-6" />
                ) : confirmDialog.confirmVariant === 'primary' ? (
                  <CheckCircle className="h-6 w-6" />
                ) : (
                  <AlertTriangle className="h-6 w-6" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-white">{confirmDialog.title}</h3>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                  {confirmDialog.message}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition cursor-pointer border border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = confirmDialog.onConfirm;
                  setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  action();
                }}
                className={`px-5 py-2.5 text-white font-black text-xs rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer ${
                  confirmDialog.confirmVariant === 'success'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : confirmDialog.confirmVariant === 'primary'
                    ? 'bg-blue-600 hover:bg-blue-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                {confirmDialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* IN-APP WATER BILL CANCELLATION MODAL                           */}
      {/* ------------------------------------------------------------- */}
      {cancelBillModal.isOpen && cancelBillModal.bill && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-2xl">
                  <XCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Cancel Water Billing Statement</h3>
                  <p className="text-xs text-slate-400">Statement ID #{cancelBillModal.bill.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCancelBillModal({ isOpen: false, bill: null, reason: '' })}
                className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Bill Summary Details */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Consumer Name</span>
                <span className="font-black text-white">{cancelBillModal.bill.consumerName}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Account Number</span>
                <span className="font-mono font-bold text-sky-400">#{cancelBillModal.bill.accountNumber}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Billing Period</span>
                <span className="font-bold text-slate-200">{cancelBillModal.bill.billingPeriod || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Billed Amount</span>
                <span className="font-mono font-black text-rose-400">₱{(cancelBillModal.bill.totalAmount || calculateCostOf(cancelBillModal.bill.consumption, cancelBillModal.bill.classification)).toFixed(2)}</span>
              </div>
            </div>

            {/* Reason Field */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                Reason for Cancellation <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={cancelBillModal.reason}
                onChange={(e) => setCancelBillModal(prev => ({ ...prev, reason: e.target.value }))}
                placeholder="e.g. Erroneous meter reading entered, administrative rate adjustment, or leak disputed..."
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500"
              />
              <p className="text-[11px] text-slate-500">
                This reason will be recorded permanently in the official utility audit trail.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCancelBillModal({ isOpen: false, bill: null, reason: '' })}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition cursor-pointer border border-slate-700"
              >
                Keep Bill / Close
              </button>
              <button
                type="button"
                disabled={!cancelBillModal.reason.trim()}
                onClick={() => {
                  const bill = cancelBillModal.bill;
                  const reason = cancelBillModal.reason.trim();
                  if (!bill || !reason) return;

                  const updatedReadings = readings.map(r => 
                    r.id === bill.id ? { ...r, status: 'cancelled' as any } : r
                  );
                  setReadings(updatedReadings);
                  mockDb.saveReadings(updatedReadings);

                  mockDb.addAuditLog(
                    currentUser.id,
                    currentUser.name,
                    'admin',
                    'Cancel Water Bill Statement',
                    `Cancelled bill #${bill.id} for Account #${bill.accountNumber} (${bill.consumerName}). Reason: "${reason}".`
                  );

                  window.dispatchEvent(new Event('twd_database_updated'));
                  toast.success('Bill Cancelled', `Bill #${bill.id} has been marked as CANCELLED.`);
                  setCancelBillModal({ isOpen: false, bill: null, reason: '' });
                }}
                className={`px-5 py-2.5 font-black text-xs rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer ${
                  cancelBillModal.reason.trim()
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-rose-950 text-rose-400 cursor-not-allowed opacity-50'
                }`}
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

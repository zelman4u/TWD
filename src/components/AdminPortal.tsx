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
  Lock,
  X,
  Printer,
  Search,
  Send,
  FileText
} from 'lucide-react';
import { mockDb } from '../mockDb';
import { User, Consumer, MeterReader, WaterMeter, MeterReading, RouteAssignment, Announcement, AuditLog } from '../types';
import { DashboardSkeleton, TableSkeleton, CardsGridSkeleton } from './common/SkeletonLoader';
import AdminAnalyticsSection from './charts/AdminAnalyticsSection';
import { useToast } from '../context/ToastContext';

interface AdminPortalProps {
  currentUser: User;
  onLogout: () => void;
}

export default function AdminPortal({ currentUser, onLogout }: AdminPortalProps) {
  const toast = useToast();
  // Tariff calculation helper
  const calculateCostOf = (usage: number, classification?: string) => {
    const isCommercial = classification === 'Commercial';
    const minCharge = isCommercial ? 270.00 : 180.00; // first 10 m³
    if (usage <= 10) return minCharge;
    
    let bill = minCharge;
    let remaining = usage - 10;
    
    // Tier 1: 11-20 m³
    const tier1 = Math.min(remaining, 10);
    bill += tier1 * (isCommercial ? 30.00 : 20.00);
    remaining -= tier1;
    
    if (remaining > 0) {
      // Tier 2: 21-30 m³
      const tier2 = Math.min(remaining, 10);
      bill += tier2 * (isCommercial ? 35.00 : 25.00);
      remaining -= tier2;
    }
    
    if (remaining > 0) {
      // Tier 3: 31+ m³
      bill += remaining * (isCommercial ? 42.00 : 30.00);
    }
    
    return bill;
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
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());

  // Database States loaded from mockDb
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [readers, setReaders] = useState<MeterReader[]>([]);
  const [meters, setMeters] = useState<WaterMeter[]>([]);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [routes, setRoutes] = useState<RouteAssignment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Filtering & Search states
  const [consumerSearch, setConsumerSearch] = useState('');
  const [consumerStatusFilter, setConsumerStatusFilter] = useState<'all' | 'active' | 'inactive' | 'archived' | 'pending_approval'>('all');
  
  // Modals / Add Form States
  const [showAddMeter, setShowAddMeter] = useState(false);
  const [showAddReader, setShowAddReader] = useState(false);
  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);

  // Field Data Inspection States
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [selectedPhotoAccount, setSelectedPhotoAccount] = useState<string | null>(null);

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
    size: '1/2 inch',
    installationDate: new Date().toISOString().split('T')[0],
    status: 'active' as const,
    linkedAccountNumber: ''
  });

  const [newReader, setNewReader] = useState({
    name: '',
    contactNumber: '',
    assignedRoute: 'Poblacion'
  });

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
  const [modalEditMeterSize, setModalEditMeterSize] = useState('1/2 inch');
  const [modalEditStatus, setModalEditStatus] = useState<'active' | 'inactive' | 'blocked' | 'archived'>('active');

  // Issue IDs Form State
  const [modalIssueAccountNumber, setModalIssueAccountNumber] = useState('');
  const [modalIssueRfidTag, setModalIssueRfidTag] = useState('');

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
    const adminIdx = allUsers.findIndex(u => u.id === currentUser.id || u.email.toLowerCase() === 'admin@tagoloanwater.gov.ph');
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
    setLastSyncTime(new Date().toLocaleTimeString());
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
            const exists = currentLocal.find(lr => lr.id === ar.id || (lr.email && lr.email.toLowerCase() === ar.username?.toLowerCase()));
            if (!exists) {
              // Add new mobile registrant to local store
              const newReaderObj: MeterReader = {
                id: ar.id,
                name: ar.name,
                email: ar.username || ar.email || `${ar.id.toLowerCase()}@tagoloanwater.gov.ph`,
                employeeId: ar.id,
                contactNumber: ar.contactNumber || 'N/A',
                assignedRoutes: ar.assignedRoutes || [ar.zone || 'Poblacion'],
                employmentStatus: (ar.employmentStatus === 'active' || ar.status === 'active') ? 'active' : 'pending_approval',
                completedReadings: 0,
                pendingReadings: 0,
                performanceRating: 5.0
              };
              currentLocal.push(newReaderObj);
              hasChanges = true;
            } else if (ar.employmentStatus && exists.employmentStatus !== ar.employmentStatus) {
              exists.employmentStatus = ar.employmentStatus;
              hasChanges = true;
            }
          });

          if (hasChanges) {
            mockDb.saveReaders([...currentLocal]);
            setReaders([...currentLocal]);
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
                meterSize: ac.meterSize || '1/2 inch',
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
              if (ac.accountNumber && !existing.accountNumber) {
                existing.accountNumber = ac.accountNumber;
                existing.meterNumber = ac.meterNumber || `MT-${ac.accountNumber}`;
                existing.status = ac.status || 'active';
                existing.rfidTag = ac.rfidTag || `RFID-${ac.accountNumber}`;
                hasChanges = true;
              } else if (ac.status && ac.status !== existing.status) {
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

    // 3. Active real-time auto-polling every 4 seconds to catch live field mobile submissions
    const pollTimer = setInterval(() => {
      loadAllDataFromStore(false);
    }, 4000);

    return () => {
      window.removeEventListener('twd_database_updated', handleDbUpdate);
      window.removeEventListener('storage', handleStorage);
      clearInterval(pollTimer);
    };
  }, []);

  const handleManualRefresh = () => {
    loadAllDataFromStore(true);
  };

  // Action: Open Consumer View/Edit/Issue IDs Modal
  const handleOpenConsumerModal = (c: Consumer, initialTab: 'view' | 'edit' | 'issue_ids' = 'view') => {
    setSelectedConsumerModal(c);
    setConsumerModalTab(initialTab);
    
    // Populate edit fields
    setModalEditName(c.name || '');
    setModalEditEmail(c.email || '');
    setModalEditContactNumber(c.contactNumber || '');
    setModalEditAddress(c.address || '');
    setModalEditConsumerType(c.consumerType || 'Residential');
    setModalEditBusinessName(c.businessName || '');
    setModalEditBusinessType(c.businessType || '');
    setModalEditHouseholdInfo(c.householdInfo || '');
    setModalEditMeterSize(c.meterSize || '1/2 inch');
    setModalEditStatus(c.status || 'active');

    // Populate issue IDs fields (generate suggested account number and tag if unissued)
    if (c.accountNumber) {
      setModalIssueAccountNumber(c.accountNumber);
      setModalIssueRfidTag(c.rfidTag || `RFID-${c.accountNumber}`);
    } else {
      // Suggest sequential/barangay-based account number
      const brgCode = c.barangayId || 'TWD';
      const randomSeq = Math.floor(1000 + Math.random() * 9000);
      const suggestedAcc = `${brgCode}-${randomSeq}`;
      setModalIssueAccountNumber(suggestedAcc);
      setModalIssueRfidTag(`RFID-${suggestedAcc}`);
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
      if (c.email && item.email.toLowerCase() === c.email.toLowerCase()) return false;
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
      meterSize: modalEditMeterSize,
      status: modalEditStatus
    };

    const newConsumers = consumers.map(item => item.accountNumber === selectedConsumerModal.accountNumber ? updated : item);
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

    alert(`Consumer details for ${updated.name} updated successfully! Consumer portal automatically synced.`);
  };

  // Action: Issue IDs & RFID Tag (Issue IDs Tab in Modal)
  const handleIssueIdentifiers = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConsumerModal) return;

    // Safety check: Prevent re-issuing or altering already issued IDs
    if (selectedConsumerModal.accountNumber && selectedConsumerModal.rfidTag) {
      alert(`Official Account Number (#${selectedConsumerModal.accountNumber}) and RFID Tag (${selectedConsumerModal.rfidTag}) have already been issued for this consumer and are permanently locked.`);
      return;
    }

    const newAccNum = modalIssueAccountNumber.trim().toUpperCase();
    const newTag = modalIssueRfidTag.trim().toUpperCase();

    if (!newAccNum) {
      alert('Account Number is required.');
      return;
    }

    // Verify Account Number uniqueness
    const duplicateAcc = consumers.find(c => c.accountNumber === newAccNum && c.accountNumber !== selectedConsumerModal.accountNumber);
    if (duplicateAcc) {
      alert(`Account Number #${newAccNum} is already assigned to consumer "${duplicateAcc.name}". Please enter a unique Account Number.`);
      return;
    }

    // Verify Tag Number uniqueness
    if (newTag) {
      const duplicateTag = consumers.find(c => c.rfidTag === newTag && c.accountNumber !== selectedConsumerModal.accountNumber);
      if (duplicateTag) {
        alert(`RFID / Tag Number "${newTag}" is already assigned to consumer "${duplicateTag.name}". Please enter a unique RFID Tag.`);
        return;
      }
    }

    const previousAccountNumber = selectedConsumerModal.accountNumber;
    const previousEmail = selectedConsumerModal.email;
    const previousUserId = selectedConsumerModal.linkedUserId;

    // Generate or retain meter number
    const assignedMeter = selectedConsumerModal.meterNumber || `MT-${Math.floor(10000 + Math.random() * 90000)}`;

    const updated: Consumer = {
      ...selectedConsumerModal,
      accountNumber: newAccNum,
      meterNumber: assignedMeter,
      rfidTag: newTag || `RFID-${newAccNum}`,
      status: 'active',
      isRegistered: true
    };

    // 1. Update consumers list (match by accountNumber or email or linkedUserId)
    const newConsumers = consumers.map(item => {
      const isMatch = (previousAccountNumber && item.accountNumber === previousAccountNumber) ||
                      (previousEmail && item.email.toLowerCase() === previousEmail.toLowerCase()) ||
                      (previousUserId && item.linkedUserId === previousUserId);
      return isMatch ? updated : item;
    });
    mockDb.saveConsumers(newConsumers);
    setConsumers(newConsumers);
    setSelectedConsumerModal(updated);

    // 2. Update linked User record in users database so consumer login connects to the issued account
    const allUsers = mockDb.getUsers();
    const updatedUsers = allUsers.map(u => {
      const isUserMatch = (previousUserId && u.id === previousUserId) ||
                          (previousEmail && u.email.toLowerCase() === previousEmail.toLowerCase()) ||
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

    // 3. Register or assign mechanical water meter into meters registry
    const allMeters = mockDb.getMeters();
    const meterExists = allMeters.some(m => m.meterNumber === assignedMeter);
    if (!meterExists) {
      const newMeterRecord: WaterMeter = {
        meterNumber: assignedMeter,
        brand: 'Aichi / Actaris Precision',
        size: selectedConsumerModal.meterSize || '1/2 inch',
        installationDate: new Date().toISOString().split('T')[0],
        status: 'active',
        linkedAccountNumber: newAccNum
      };
      const updatedMeters = [...allMeters, newMeterRecord];
      mockDb.saveMeters(updatedMeters);
      setMeters(updatedMeters);
    } else {
      const updatedMeters = allMeters.map(m => m.meterNumber === assignedMeter ? { ...m, linkedAccountNumber: newAccNum, status: 'active' as const } : m);
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

    // 5. Send Activation Announcement Notification to Consumer
    mockDb.addNotification({
      accountNumber: newAccNum,
      title: `Official Account Number & Meter Issued!`,
      message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${newAccNum} and Meter Serial is #${assignedMeter}. Smart RFID Tag: ${updated.rfidTag}. Your full dashboard and telemetry are now active.`,
      type: 'announcement'
    });

    // 6. Sync issued consumer identifiers to backend API
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
      `Issued Account Number #${newAccNum}, Meter #${assignedMeter}, and RFID Tag "${updated.rfidTag}" to ${updated.name}. Consumer portal account activated and synchronized.`
    );

    alert(`Official Identifiers (Account #${newAccNum}, Meter #${assignedMeter}, RFID Tag: ${updated.rfidTag}) assigned permanently! Consumer account is now fully active.`);
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

    const created: WaterMeter = {
      meterNumber: newMeter.meterNumber.trim().toUpperCase(),
      brand: newMeter.brand,
      size: newMeter.size,
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
      size: '1/2 inch',
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
    if (!newReader.name) return;

    const created: MeterReader = {
      id: `reader-${Date.now()}`,
      name: newReader.name,
      contactNumber: newReader.contactNumber,
      employmentStatus: 'active',
      assignedRoutes: [newReader.assignedRoute],
      completedReadings: 0,
      pendingReadings: 15,
      performanceRating: 5.0
    };

    const updated = [...readers, created];
    mockDb.saveReaders(updated);
    setReaders(updated);

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'admin',
      'Enroll Meter Reader',
      `Hired field technician officer "${created.name}" and provisioned task handheld sync account.`
    );

    setNewReader({
      name: '',
      contactNumber: '',
      assignedRoute: 'Poblacion East'
    });
    setShowAddReader(false);
    loadAllDataFromStore();
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
    const updated = readings.map(r => {
      if (r.id === readingId) {
        return { ...r, status };
      }
      return r;
    });

    mockDb.saveReadings(updated);
    setReadings(updated);

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

  // Filtered lists logic
  const filteredConsumers = consumers.filter(c => {
    const term = consumerSearch.toLowerCase();
    const matchesSearch = (c.name || '').toLowerCase().includes(term) || 
                          (c.accountNumber || '').toLowerCase().includes(term) ||
                          (c.email || '').toLowerCase().includes(term) ||
                          (c.address || '').toLowerCase().includes(term);
    const matchesStatus = consumerStatusFilter === 'all' || 
                          c.status === consumerStatusFilter ||
                          (consumerStatusFilter === 'pending_approval' && (!c.accountNumber || c.status === 'pending_approval'));
    return matchesSearch && matchesStatus;
  });

  // Basic stats for dashboard banners
  const totalConsumersWeight = consumers.length;
  const registeredWebUsers = consumers.filter(c => c.isRegistered).length;
  const completedReadingsCount = readings.filter(r => r.status === 'verified').length;
  const pendingReadingsCount = readings.filter(r => r.status === 'pending').length;
  const flaggedAbnormalCount = readings.filter(r => r.status === 'flagged_abnormal').length;
  const activeTechnicians = readers.filter(r => r.employmentStatus === 'active').length;

  return (
    <div className="min-h-screen bg-slate-50 flex" id="administrative-portal">
      {/* Side Navigation panel */}
      <aside className="w-64 bg-slate-900 text-slate-400 flex flex-col justify-between shrink-0 border-r border-slate-850">
        <div>
          {/* Platform Title */}
          <div className="h-20 flex items-center px-6 border-b border-slate-800 space-x-3 text-white">
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

          {/* Connected User Badge */}
          <div className="px-5 py-4 bg-slate-850/40 border-b border-slate-800 flex items-center space-x-3">
            <div className="h-8 w-8 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold text-xs">
              AD
            </div>
            <div className="truncate">
              <h4 className="text-xs font-bold text-white leading-normal truncate">{currentUser.email?.toLowerCase() === 'admin@tagoloanwater.gov.ph' ? 'Admin' : currentUser.name}</h4>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Office Director</p>
            </div>
          </div>

          {/* Nav links - Admin Portal Modules */}
          <nav className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-170px)] scrollbar-thin">
            {/* Dashboard Module */}
            <button
              id="admin-nav-dashboard"
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <Activity className="h-4 w-4 shrink-0 text-blue-400" />
              <span>Dashboard</span>
            </button>

            {/* Records Module */}
            <button
              id="admin-nav-records"
              onClick={() => setActiveTab('records')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'records' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <FolderLock className="h-4 w-4 shrink-0 text-amber-400" />
              <span>Records</span>
            </button>

            {/* Consumers Module */}
            <button
              id="admin-nav-consumers"
              onClick={() => setActiveTab('consumers')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'consumers' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <Users className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>Consumers</span>
            </button>

            {/* Approvals Module */}
            <button
              id="admin-nav-approvals"
              onClick={() => setActiveTab('approvals')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
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
              onClick={() => setActiveTab('bills')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'bills' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-purple-400" />
              <span>Bills</span>
            </button>

            {/* Process Payment Module */}
            <button
              id="admin-nav-payments"
              onClick={() => setActiveTab('payments')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'payments' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <TrendingUp className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>Process Payment</span>
            </button>

            {/* Meter Readings Module */}
            <button
              id="admin-nav-readings"
              onClick={() => setActiveTab('readings')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'readings' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <Droplet className="h-4 w-4 shrink-0 text-cyan-400" />
              <span>Meter Readings</span>
            </button>

            {/* Water Meters Module */}
            <button
              id="admin-nav-meters"
              onClick={() => setActiveTab('meters')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'meters' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-indigo-400" />
              <span>Water Meters</span>
            </button>

            {/* Meter Readers Module */}
            <button
              id="admin-nav-readers"
              onClick={() => setActiveTab('readers')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'readers' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <UserCheck className="h-4 w-4 shrink-0 text-teal-400" />
              <span>Meter Readers</span>
            </button>

            {/* Staff Module */}
            <button
              id="admin-nav-staff"
              onClick={() => setActiveTab('staff')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'staff' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <UserPlus className="h-4 w-4 shrink-0 text-rose-400" />
              <span>Staff</span>
            </button>

            {/* Barangays Module */}
            <button
              id="admin-nav-barangays"
              onClick={() => setActiveTab('barangays')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'barangays' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <MapPin className="h-4 w-4 shrink-0 text-orange-400" />
              <span>Barangays</span>
            </button>

            {/* Announcements Module */}
            <button
              id="admin-nav-announcements"
              onClick={() => setActiveTab('announcements')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'announcements' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <BookOpen className="h-4 w-4 shrink-0 text-yellow-400" />
              <span>Announcements</span>
            </button>

            {/* Profile Module */}
            <button
              id="admin-nav-profile"
              onClick={() => setActiveTab('profile')}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition text-left ${
                activeTab === 'profile' ? 'bg-blue-600 text-white shadow-md' : 'hover:text-white hover:bg-slate-800/50 text-slate-400'
              }`}
            >
              <Building className="h-4 w-4 shrink-0 text-slate-300" />
              <span>Profile</span>
            </button>
          </nav>
        </div>

        {/* Logout Module */}
        <div className="p-3 border-t border-slate-800">
          <button
            onClick={onLogout}
            id="admin-nav-logout"
            className="w-full py-2.5 hover:bg-red-950/20 text-slate-400 hover:text-red-400 text-xs font-bold uppercase tracking-widest rounded-lg transition flex items-center justify-center space-x-2 border border-slate-800 hover:border-red-900/50"
          >
            <LogOut className="h-4 w-4 text-red-500" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Administrative Workplace Area */}
      <main className="flex-grow flex flex-col h-screen overflow-y-auto">
        {/* Upper Action Bar */}
        <header className="h-20 bg-white border-b border-slate-200/85 px-8 flex items-center justify-between shadow-sm shrink-0">
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-900 uppercase">
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
            <p className="text-[11px] text-slate-500">Tagoloan Water District Municipal Digitalization Desk</p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Quick manual refresh data button */}
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer"
              title={`Last synchronized at ${lastSyncTime}`}
              id="admin-manual-refresh-btn"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Fetching...' : 'Refresh Data'}</span>
            </button>

            <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold text-[10px] uppercase tracking-wider px-2 py-1 rounded hidden sm:inline-block">
              Live {lastSyncTime}
            </span>
          </div>
        </header>

        {/* TAB WORKSPACE MODULE CONTENT */}
        <div className="p-8 flex-grow">
          
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
                        {consumers.map((c) => (
                          <tr key={c.accountNumber} className="hover:bg-slate-50 transition">
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
                          <th className="px-6 py-3.5">Brand & Size</th>
                          <th className="px-6 py-3.5">Installation Date</th>
                          <th className="px-6 py-3.5">Assigned Account</th>
                          <th className="px-6 py-3.5">Meter Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {meters.map((m) => (
                          <tr key={m.meterNumber} className="hover:bg-slate-50 transition">
                            <td className="px-6 py-3.5 font-mono font-bold text-slate-900">{m.meterNumber}</td>
                            <td className="px-6 py-3.5 font-bold text-slate-800">{m.brand} ({m.size})</td>
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
                        {readings.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50 transition">
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
                        {readings.filter(r => r.status === 'verified').map((r) => {
                          const waterAmount = Math.max(220, r.consumption * 24.50);
                          const totalBill = waterAmount + 50 + 20 + 15 + (waterAmount * 0.12);
                          return (
                            <tr key={r.id} className="hover:bg-slate-50 transition">
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
                        {readings.filter(r => r.paymentStatus === 'paid').map((r) => {
                          const waterAmount = Math.max(220, r.consumption * 24.50);
                          const totalBill = waterAmount + 50 + 20 + 15 + (waterAmount * 0.12);
                          return (
                            <tr key={r.id} className="hover:bg-slate-50 transition">
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
                        {auditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50">
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
                      {readings.filter(r => r.status === 'pending').map((reading) => {
                        const waterAmount = Math.max(220, reading.consumption * 24.50);
                        const basicFee = 50;
                        const envFee = 20;
                        const maintFee = 15;
                        const vat = waterAmount * 0.12;
                        const totalCalculatedBill = waterAmount + basicFee + envFee + maintFee + vat;

                        return (
                          <div key={reading.id} className="bg-white border-2 border-amber-300 rounded-3xl p-6 shadow-md hover:shadow-lg transition space-y-4">
                            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-100 pb-4">
                              <div className="flex items-center space-x-4">
                                <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold font-mono text-sm shrink-0">
                                  #{reading.accountNumber}
                                </div>
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <h4 className="text-base font-extrabold text-slate-900">{reading.consumerName}</h4>
                                    <span className="bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                                      {reading.route}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-500 mt-0.5">
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
                                <span className="text-[10px] text-slate-400 font-bold uppercase block">Base Water Fee</span>
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
                                {/* Reject Button */}
                                <button
                                  onClick={() => {
                                    const reason = prompt('Enter rejection note for meter reader (e.g. Unclear meter dial photo):');
                                    if (reason) {
                                      const updated = readings.map(r => r.id === reading.id ? { ...r, status: 'rejected' as const, notes: `REJECTED: ${reason}` } : r);
                                      mockDb.saveReadings(updated);
                                      setReadings(updated);
                                      mockDb.addAuditLog(currentUser.id, currentUser.name, 'admin', 'Rejected Reading', `Rejected reading #${reading.id} for Account #${reading.accountNumber}. Reason: ${reason}`);
                                      alert(`Reading #${reading.id} rejected and returned to meter reader.`);
                                    }
                                  }}
                                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold rounded-xl text-xs transition uppercase"
                                >
                                  Reject
                                </button>

                                {/* Correct Index Button */}
                                <button
                                  onClick={() => {
                                    const newCurrentStr = prompt(`Correct current reading for Account #${reading.accountNumber}:`, String(reading.currentReading));
                                    if (newCurrentStr) {
                                      const newCurrent = parseInt(newCurrentStr, 10);
                                      if (!isNaN(newCurrent) && newCurrent >= reading.previousReading) {
                                        const newConsumption = newCurrent - reading.previousReading;
                                        const updated = readings.map(r => r.id === reading.id ? { 
                                          ...r, 
                                          currentReading: newCurrent, 
                                          consumption: newConsumption,
                                          status: 'verified' as const,
                                          notes: `ADMIN CORRECTED & APPROVED: Original ${reading.currentReading} -> Corrected ${newCurrent}`
                                        } : r);
                                        mockDb.saveReadings(updated);
                                        setReadings(updated);
                                        mockDb.addAuditLog(currentUser.id, currentUser.name, 'admin', 'Corrected & Approved Reading', `Corrected reading for Account #${reading.accountNumber} to ${newCurrent} m³ and approved auto-generated bill.`);
                                        alert(`Reading corrected and approved! Auto-generated bill published to Consumer Portal.`);
                                      } else {
                                        alert('Invalid reading value.');
                                      }
                                    }
                                  }}
                                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold rounded-xl text-xs transition uppercase"
                                >
                                  Correct & Approve
                                </button>

                                {/* Approve Button */}
                                <button
                                  onClick={() => {
                                    const updated = readings.map(r => r.id === reading.id ? { ...r, status: 'verified' as const, paymentStatus: 'unpaid' as const, remainingBalance: totalCalculatedBill, paidAmount: 0 } : r);
                                    mockDb.saveReadings(updated);
                                    setReadings(updated);

                                    // Recalculate consumer arrears
                                    const consumerUnpaid = updated.filter(
                                      r => r.accountNumber === reading.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid'
                                    );
                                    const newArrears = consumerUnpaid.reduce((sum, r) => {
                                      const w = Math.max(220, r.consumption * 24.50);
                                      const gross = w + 85 + (w * 0.12);
                                      const paid = r.paidAmount || 0;
                                      return sum + Math.max(0, gross - paid);
                                    }, 0);

                                    const updatedConsumers = consumers.map(c => 
                                      c.accountNumber === reading.accountNumber
                                        ? { ...c, outstandingBalance: newArrears }
                                        : c
                                    );
                                    mockDb.saveConsumers(updatedConsumers);
                                    setConsumers(updatedConsumers);

                                    // Dispatch Smart Notification to Consumer Portal
                                    mockDb.addNotification({
                                      accountNumber: reading.accountNumber,
                                      title: `Water Bill Issued - ${reading.billingPeriod || 'New Statement'}`,
                                      message: `Your water billing statement for ${reading.billingPeriod} has been computed and issued with ${reading.consumption} m³ total consumption (₱${totalCalculatedBill.toFixed(2)}). Due date: ${reading.dueDate || '20th of Month'}. Settle online or in-office.`,
                                      type: 'billing',
                                      readingId: reading.id,
                                      billingPeriod: reading.billingPeriod,
                                      remainingBalance: totalCalculatedBill
                                    });

                                    mockDb.addAuditLog(currentUser.id, currentUser.name, 'admin', 'Approved Reading & Generated Bill', `Approved reading #${reading.id} for Account #${reading.accountNumber}. Auto-generated bill ₱${totalCalculatedBill.toFixed(2)} published to Consumer Portal.`);
                                    alert(`✅ Reading approved! Bill for ₱${totalCalculatedBill.toFixed(2)} has been issued with smart notification dispatched.`);
                                  }}
                                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs transition shadow-md uppercase tracking-wider flex items-center justify-center space-x-1 cursor-pointer"
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  <span>APPROVE & ISSUE BILL</span>
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
                            const filteredHistory = readings
                              .filter(r => r.status !== 'pending')
                              .filter(r => 
                                r.accountNumber.toLowerCase().includes(approvalHistorySearch.toLowerCase()) ||
                                r.consumerName.toLowerCase().includes(approvalHistorySearch.toLowerCase()) ||
                                r.meterNumber.toLowerCase().includes(approvalHistorySearch.toLowerCase()) ||
                                (r.notes && r.notes.toLowerCase().includes(approvalHistorySearch.toLowerCase()))
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

                            return filteredHistory.map((r) => {
                              const waterAmount = Math.max(220, r.consumption * 24.50);
                              const totalBill = waterAmount + 50 + 20 + 15 + (waterAmount * 0.12);
                              const isCorrected = r.notes && r.notes.includes('CORRECTED');
                              const isRejected = r.status === ('rejected' as any) || (r.notes && r.notes.includes('REJECTED'));

                              return (
                                <tr key={r.id} className="hover:bg-slate-50/80 transition">
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
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                
                {/* Search Bar & Filters */}
                <div className="flex flex-wrap items-center gap-3 w-full sm:max-w-2xl">
                  <input 
                    type="text" 
                    placeholder="Search account number, client name, or service address..."
                    value={consumerSearch}
                    onChange={(e) => setConsumerSearch(e.target.value)}
                    className="flex-1 min-w-[200px] bg-white border border-slate-200 rounded-lg py-2.5 px-3.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                  
                  <select
                    value={consumerStatusFilter}
                    onChange={(e: any) => setConsumerStatusFilter(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg py-2.5 px-3 text-xs font-bold text-slate-700"
                  >
                    <option value="all">All Statuses</option>
                    <option value="pending_approval">Pending ID Issuance</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="blocked">Blocked</option>
                    <option value="archived">Archived</option>
                  </select>

                  <button
                    onClick={() => {
                      const headers = ['Name', 'Email', 'Phone', 'Barangay', 'Status', 'Account Number', 'Meter Number', 'Address', 'Block Reason', 'Outstanding Balance'];
                      const rows = filteredConsumers.map(c => [
                        c.name, c.email, c.contactNumber, c.address, c.status.toUpperCase(), c.accountNumber, c.meterNumber, c.address, c.blockReason || '', c.outstandingBalance || 0
                      ]);
                      exportToCsv('twd_consumers_master_export.csv', headers, rows);
                    }}
                    className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition shadow-sm cursor-pointer shrink-0"
                  >
                    <Download className="h-4 w-4 text-white" />
                    <span>Export CSV</span>
                  </button>
                </div>

              </div>

              {/* Citizen Self-Service Registration System Architecture Notice */}
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
                    <span>{filteredConsumers.length} Master Accounts</span>
                  </span>
                </div>
              </div>

              {/* Consumers Grid/Table */}
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
                      {filteredConsumers.map((c) => {
                        const addrParts = c.address.split(',').map(p => p.trim());
                        const barangayDisplay = c.barangay || (addrParts.length >= 2 ? addrParts[1] : c.address);

                        return (
                          <tr key={c.accountNumber || c.email || c.linkedUserId || c.name} className="hover:bg-slate-50/70 transition">
                            <td className="px-4 py-3 space-y-0.5 truncate">
                              <span className="font-bold text-[13px] text-slate-900 block truncate" title={c.name}>{c.name}</span>
                              <div className="flex items-center space-x-1.5 truncate">
                                {c.accountNumber ? (
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
                              <div className="flex items-center space-x-1.5 truncate">
                                <span className="font-mono text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded shrink-0">
                                  {c.barangayId || 'TWD'}
                                </span>
                                <span className="font-semibold text-slate-900 truncate">
                                  {barangayDisplay}
                                </span>
                              </div>
                              {c.sitioZone && (
                                <span className="text-[10px] text-slate-500 block truncate mt-0.5 font-medium">
                                  {c.sitioZone}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <div className="space-y-0.5">
                                <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                  !c.accountNumber || c.status === 'pending_approval'
                                    ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse'
                                    : c.status === 'blocked'
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                    : c.status === 'active'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : c.status === 'inactive'
                                    ? 'bg-slate-100 text-slate-700 border border-slate-200'
                                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                                }`}>
                                  {!c.accountNumber || c.status === 'pending_approval' ? 'PENDING ID' : c.status.toUpperCase()}
                                </span>
                                <span className={`block text-[9px] font-bold truncate ${c.isRegistered ? 'text-emerald-600' : 'text-slate-400'}`}>
                                  {c.isRegistered ? '• Registered' : '• Offline'}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                {!c.accountNumber ? (
                                  <button 
                                    onClick={() => handleOpenConsumerModal(c, 'issue_ids')}
                                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center space-x-1 transition shadow-2xs cursor-pointer shrink-0"
                                    title="Issue Official Account Number & RFID Tag"
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

              {/* Consumer View/Edit/Issue IDs Modal */}
              {selectedConsumerModal && (
                <div 
                  className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in select-none"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setSelectedConsumerModal(null);
                  }}
                >
                  <div className="bg-slate-900 rounded-2xl sm:rounded-3xl max-w-2xl lg:max-w-3xl w-full border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh]">
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
                        <span>Issue IDs & Tag</span>
                      </button>
                    </div>

                    {/* Modal Body - Scrollable Content Area */}
                    <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6 space-y-4 text-left bg-slate-900 text-slate-100">
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
                              <span className="font-mono font-black text-blue-300 text-xs truncate block">{selectedConsumerModal.meterNumber || 'UNASSIGNED'} ({selectedConsumerModal.meterSize || '1/2 inch'})</span>
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

                      {/* ISSUE IDS TAB */}
                      {consumerModalTab === 'issue_ids' && (
                        <form onSubmit={handleIssueIdentifiers} className="bg-slate-800 p-5 rounded-xl border border-slate-700 space-y-4 text-xs">
                          {selectedConsumerModal.accountNumber && selectedConsumerModal.rfidTag ? (
                            <div className="bg-amber-950/60 p-4 rounded-xl border border-amber-600/60 space-y-1.5 shadow-2xs">
                              <h5 className="font-black text-amber-200 flex items-center space-x-1.5 text-xs">
                                <Lock className="h-4 w-4 text-amber-400 mr-1 inline shrink-0" />
                                <span>Official Identifiers Issued & Read-Only</span>
                              </h5>
                              <p className="text-amber-100 font-medium text-[11px] leading-relaxed">
                                Consumer <strong>{selectedConsumerModal.name}</strong> has already been issued an Official Account Number (<strong>#{selectedConsumerModal.accountNumber}</strong>) and Smart RFID Tag (<strong>{selectedConsumerModal.rfidTag}</strong>). Issued identifiers are permanently assigned and cannot be edited.
                              </p>
                            </div>
                          ) : (
                            <div className="bg-blue-950/60 p-4 rounded-xl border border-blue-600/60 space-y-1">
                              <h5 className="font-black text-blue-200 flex items-center space-x-1.5 text-xs">
                                <ShieldCheck className="h-4 w-4 text-blue-400 mr-1 inline shrink-0" />
                                <span>Issue Official Identifiers & Smart RFID Tag</span>
                              </h5>
                              <p className="text-blue-100 font-medium text-[11px]">
                                Assign or verify official 7-digit Account Number and RFID Smart Tag for <strong>{selectedConsumerModal.name}</strong>.
                              </p>
                            </div>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-slate-200 font-extrabold text-xs">Official Account Number *</label>
                                {selectedConsumerModal.accountNumber && (
                                  <span className="text-[10px] font-black text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-600/60 flex items-center space-x-0.5">
                                    <Lock className="h-3 w-3 mr-0.5 inline shrink-0" /> Read-Only
                                  </span>
                                )}
                              </div>
                              <input
                                type="text"
                                required
                                placeholder="e.g. 1002026"
                                value={modalIssueAccountNumber}
                                onChange={(e) => setModalIssueAccountNumber(e.target.value)}
                                readOnly={Boolean(selectedConsumerModal.accountNumber)}
                                className={`w-full border rounded-lg p-2.5 font-mono font-black text-xs shadow-2xs ${
                                  selectedConsumerModal.accountNumber
                                    ? 'bg-slate-950/80 text-slate-400 border-slate-700 cursor-not-allowed select-none'
                                    : 'bg-slate-950 text-white border-slate-700 focus:outline-none focus:border-blue-500'
                                }`}
                              />
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-slate-200 font-extrabold text-xs">RFID Smart Tag Number *</label>
                                {selectedConsumerModal.rfidTag && (
                                  <span className="text-[10px] font-black text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-600/60 flex items-center space-x-0.5">
                                    <Lock className="h-3 w-3 mr-0.5 inline shrink-0" /> Read-Only
                                  </span>
                                )}
                              </div>
                              <input
                                type="text"
                                required
                                placeholder="e.g. RFID-88204"
                                value={modalIssueRfidTag}
                                onChange={(e) => setModalIssueRfidTag(e.target.value)}
                                readOnly={Boolean(selectedConsumerModal.rfidTag)}
                                className={`w-full border rounded-lg p-2.5 font-mono font-black text-xs shadow-2xs ${
                                  selectedConsumerModal.rfidTag
                                    ? 'bg-slate-950/80 text-slate-400 border-slate-700 cursor-not-allowed select-none'
                                    : 'bg-slate-950 text-white border-slate-700 focus:outline-none focus:border-blue-500'
                                }`}
                              />
                            </div>
                          </div>

                          <div className="pt-2 flex justify-end">
                            {selectedConsumerModal.accountNumber && selectedConsumerModal.rfidTag ? (
                              <div className="px-4 py-2 bg-slate-950 border border-slate-700 text-slate-400 font-black rounded-xl text-xs flex items-center space-x-1.5 select-none">
                                <Lock className="h-3.5 w-3.5 text-slate-500" />
                                <span>Identifiers Already Issued & Locked</span>
                              </div>
                            ) : (
                              <button
                                type="submit"
                                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs transition shadow-md uppercase tracking-wider cursor-pointer"
                              >
                                Issue Identifiers & Activate
                              </button>
                            )}
                          </div>
                        </form>
                      )}
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
            </div>
          )}

          {/* 3. METER READER MANAGEMENT MODULE */}
          {activeTab === 'readers' && (
            <div className="space-y-6 animate-fade-in" id="readers-tab">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-extrabold text-slate-950 uppercase tracking-wider">Meter Reading Staff registry</h3>
                
                <button
                  onClick={() => setShowAddReader(!showAddReader)}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition flex items-center space-x-2 shrink-0"
                >
                  <Plus className="h-4.5 w-4.5" />
                  <span>Enroll Field Officer</span>
                </button>
              </div>

              {/* PENDING APPROVAL QUEUE BANNER */}
              {readers.some(r => r.employmentStatus === 'pending_approval') && (
                <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className="h-8 w-8 rounded-xl bg-amber-500/20 text-amber-800 flex items-center justify-center font-bold">
                        ⏳
                      </div>
                      <div>
                        <h4 className="text-sm font-extrabold text-amber-950">
                          Pending Field Reader Registrations ({readers.filter(r => r.employmentStatus === 'pending_approval').length})
                        </h4>
                        <p className="text-xs text-amber-800">
                          Pending meter reader accounts require administrator confirmation before activation.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    {readers.filter(r => r.employmentStatus === 'pending_approval').map(pendingReader => (
                      <div key={pendingReader.id} className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm flex flex-col justify-between space-y-3">
                        <div>
                          <div className="flex justify-between items-start">
                            <div>
                              <h5 className="text-sm font-bold text-slate-900">{pendingReader.name}</h5>
                              <p className="text-[11px] text-slate-500 font-mono">Badge: {pendingReader.employeeId || pendingReader.id}</p>
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              PENDING APPROVAL
                            </span>
                          </div>

                          <div className="mt-2 space-y-1 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg">
                            <div className="flex justify-between">
                              <span>Email:</span>
                              <span className="font-mono text-slate-800">{pendingReader.email || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Phone:</span>
                              <span className="font-mono text-slate-800">{pendingReader.contactNumber || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Assigned Route:</span>
                              <span className="font-bold text-blue-600">{pendingReader.assignedRoutes.join(', ') || 'Poblacion'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              // Approve reader
                              const updatedReaders = readers.map(r => {
                                if (r.id === pendingReader.id) {
                                  return { ...r, employmentStatus: 'active' as const };
                                }
                                return r;
                              });
                              mockDb.saveReaders(updatedReaders);
                              setReaders(updatedReaders);

                              // Sync to backend Express / Vercel API
                              try {
                                fetch(`/api/staff/${encodeURIComponent(pendingReader.id)}/status`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: 'active', assignedRoutes: pendingReader.assignedRoutes })
                                }).catch(() => {});
                              } catch {}

                              // Update linked User if exists
                              const allUsers = mockDb.getUsers();
                              const updatedUsers = allUsers.map(u => {
                                if (u.id === pendingReader.linkedUserId || (pendingReader.email && u.email.toLowerCase() === pendingReader.email.toLowerCase())) {
                                  return { ...u, status: 'active' as const };
                                }
                                return u;
                              });
                              mockDb.saveUsers(updatedUsers);

                              // Audit log
                              mockDb.addAuditLog(
                                currentUser.id,
                                currentUser.name,
                                'admin',
                                'Approve Meter Reader',
                                `Approved field meter reader account for ${pendingReader.name} (Badge: ${pendingReader.employeeId || pendingReader.id}).`
                              );

                              toast.success('Reader Approved', `${pendingReader.name} has been activated.`);
                            }}
                            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition shadow-sm"
                          >
                            ✓ Approve & Activate
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const confirmReject = window.confirm(`Decline application for ${pendingReader.name}?`);
                              if (!confirmReject) return;

                              const updatedReaders = readers.filter(r => r.id !== pendingReader.id);
                              mockDb.saveReaders(updatedReaders);
                              setReaders(updatedReaders);

                              toast.info('Application Removed', `Reader registration for ${pendingReader.name} declined.`);
                            }}
                            className="px-3 py-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 font-bold text-xs rounded-lg transition border border-slate-200"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add Meter Reader Form */}
              {showAddReader && (
                <form onSubmit={handleCreateReader} className="bg-white border border-slate-200 p-6 rounded-2xl shadow-lg space-y-4 max-w-2xl">
                  <h4 className="text-sm font-bold uppercase text-slate-850">Enroll Field Officer Specs</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Full Name</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Rodrigo Garcia"
                        value={newReader.name}
                        onChange={(e) => setNewReader({ ...newReader, name: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Contact Number</label>
                      <input 
                        type="tel" 
                        placeholder="e.g. 0915-111-2222"
                        value={newReader.contactNumber}
                        onChange={(e) => setNewReader({ ...newReader, contactNumber: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Assign Primary Route</label>
                      <select 
                        value={newReader.assignedRoute}
                        onChange={(e) => setNewReader({ ...newReader, assignedRoute: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs font-bold text-slate-700"
                      >
                        <option value="Poblacion East">Poblacion East</option>
                        <option value="Natumolan">Natumolan</option>
                        <option value="Baluarte">Baluarte</option>
                        <option value="Sta. Ana">Sta. Ana</option>
                        <option value="Sta. Cruz">Sta. Cruz</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                    <button 
                      type="button" 
                      onClick={() => setShowAddReader(false)} 
                      className="px-4.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="px-4.5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
                    >
                      Submit Account
                    </button>
                  </div>
                </form>
              )}

              {/* Readers Catalog Layout */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {readers.map((r) => (
                  <div key={r.id} className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                    <div className="space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-base font-extrabold text-slate-900">{r.name}</h4>
                          <p className="text-[10px] text-slate-400 tracking-wider font-mono">ID: {r.id} {r.employeeId ? `(${r.employeeId})` : ''}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          r.employmentStatus === 'active' 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                            : r.employmentStatus === 'pending_approval'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-100'
                        }`}>
                          {r.employmentStatus === 'active' ? 'ACTIVE FIELD DUTY' : r.employmentStatus === 'pending_approval' ? 'PENDING APPROVAL' : 'SUSPENDED/LEAVE'}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                        <div className="flex justify-between">
                          <span>Primary Route Coverage:</span>
                          <span className="font-bold text-slate-800">{r.assignedRoutes.join(', ')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Verified Submissions:</span>
                          <span className="font-mono font-bold text-slate-800">{r.completedReadings} m³ indices</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Assigned Leads Pending:</span>
                          <span className="font-mono font-bold text-amber-600">{r.pendingReadings} lines</span>
                        </div>
                        <div className="flex justify-between">
                          <span>District rating:</span>
                          <span className="font-bold text-slate-850">⭐ {r.performanceRating.toFixed(1)} / 5.0</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-50 mt-4 flex items-center justify-between">
                      <p className="text-[10px] text-slate-500 font-mono">Phone: {r.contactNumber || 'N/A'}</p>
                      
                      <div className="flex items-center space-x-2">
                        {r.employmentStatus === 'pending_approval' ? (
                          <button
                            onClick={() => {
                              const updated = readers.map(x => {
                                if (x.id === r.id) {
                                  return { ...x, employmentStatus: 'active' as const };
                                }
                                return x;
                              });
                              mockDb.saveReaders(updated);
                              setReaders(updated);

                              const allUsers = mockDb.getUsers();
                              const updatedUsers = allUsers.map(u => {
                                if (u.id === r.linkedUserId || (r.email && u.email.toLowerCase() === r.email.toLowerCase())) {
                                  return { ...u, status: 'active' as const };
                                }
                                return u;
                              });
                              mockDb.saveUsers(updatedUsers);

                              mockDb.addAuditLog(currentUser.id, currentUser.name, 'admin', 'Approve Meter Reader', `Approved meter reader: ${r.name}`);
                              toast.success('Approved', `${r.name} authorized for mobile access.`);
                            }}
                            className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded-md font-bold hover:bg-emerald-700"
                          >
                            Approve
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              const nextStatus = r.employmentStatus === 'active' ? 'inactive' as const : 'active' as const;
                              const updated = readers.map(x => {
                                if (x.id === r.id) {
                                  return { ...x, employmentStatus: nextStatus };
                                }
                                return x;
                              });
                              mockDb.saveReaders(updated);
                              setReaders(updated);

                              // Sync user status
                              const allUsers = mockDb.getUsers();
                              const updatedUsers = allUsers.map(u => {
                                if (u.id === r.linkedUserId || (r.email && u.email.toLowerCase() === r.email.toLowerCase())) {
                                  return { ...u, status: nextStatus };
                                }
                                return u;
                              });
                              mockDb.saveUsers(updatedUsers);

                              mockDb.addAuditLog(currentUser.id, currentUser.name, 'admin', 'Toggle Employment Status', `Switched staff status of reader ${r.name} to ${nextStatus}.`);
                              toast.info('Status Updated', `${r.name} status changed to ${nextStatus}.`);
                            }}
                            className="text-xs text-blue-600 font-bold hover:underline"
                          >
                            {r.employmentStatus === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port Size</label>
                      <select 
                        value={newMeter.size}
                        onChange={(e) => setNewMeter({ ...newMeter, size: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs text-slate-700 font-bold"
                      >
                        <option value="1/2 inch">1/2 inch Standard</option>
                        <option value="3/4 inch">3/4 inch Heavy duty</option>
                        <option value="1 inch">1 inch Commercial</option>
                      </select>
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
                        <th className="px-6 py-4">Mechanical Port Size</th>
                        <th className="px-6 py-4">Installation Date</th>
                        <th className="px-6 py-4 font-mono">Linked Consumer Link</th>
                        <th className="px-6 py-3 text-right">Operational Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                      {meters.map((m) => (
                        <tr key={m.meterNumber} className="hover:bg-slate-50/70">
                          <td className="px-6 py-4 font-mono text-slate-900 font-black">{m.meterNumber}</td>
                          <td className="px-6 py-4 font-bold">{m.brand}</td>
                          <td className="px-6 py-4">{m.size}</td>
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
                        {consumers.map(c => (
                          <option key={c.accountNumber} value={c.accountNumber}>
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
                      {readings.map((r) => {
                        const isAbnormal = r.consumption >= 50;
                        const resolvedClassification = r.classification || 'Residential';
                        return (
                          <tr key={r.id} className={`hover:bg-slate-55 transition ${isAbnormal && r.status === 'flagged_abnormal' ? 'bg-rose-500/10' : ''}`}>
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
                            <td className="px-6 py-4 text-right space-x-1.5">
                              {r.status === 'pending' || r.status === 'flagged_abnormal' ? (
                                <>
                                  <button
                                    onClick={() => handleVerifyReading(r.id, 'verified')}
                                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase rounded transition"
                                    id={`check-read-btn-${r.id}`}
                                  >
                                    Verify Index
                                  </button>
                                  {r.status !== 'flagged_abnormal' && (
                                    <button
                                      onClick={() => handleVerifyReading(r.id, 'flagged_abnormal')}
                                      className="px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 font-bold text-[10px] uppercase rounded transition"
                                      id={`flag-read-btn-${r.id}`}
                                    >
                                      Flag Abnormal
                                    </button>
                                  )}
                                </>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-medium">No actions remaining</span>
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
                  {routes.map((rt) => (
                    <div key={rt.id} className="bg-slate-50 border border-slate-150 rounded-2xl p-6 space-y-4">
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
                              {readers.map(r => (
                                <option key={r.id} value={r.id}>{r.name}</option>
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
                {announcements.map((ann) => (
                  <div key={ann.id} className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
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
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/50">
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
                  const w = Math.max(220, r.consumption * 24.50);
                  return sum + (w + 50 + 20 + 15 + (w * 0.12));
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
                            const q = billSearch.toLowerCase();
                            return r.accountNumber.toLowerCase().includes(q) || r.consumerName.toLowerCase().includes(q) || (r.billingPeriod && r.billingPeriod.toLowerCase().includes(q));
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

                        return filteredBills.map((bill) => {
                          const waterAmount = Math.max(220, bill.consumption * 24.50);
                          const totalBill = waterAmount + 50 + 20 + 15 + (waterAmount * 0.12);
                          const isPaid = bill.paymentStatus === 'paid';
                          const isCancelled = bill.status === 'cancelled';

                          return (
                            <tr key={bill.id} className="hover:bg-slate-50 transition-colors bg-white">
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
                                      alert(`Printing official billing statement for Account #${bill.accountNumber}\nPeriod: ${bill.billingPeriod || 'Current Period'}\nAmount: ₱${totalBill.toFixed(2)}`);
                                    }}
                                    className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-md transition inline-flex items-center space-x-1 cursor-pointer shadow-2xs border border-slate-900 shrink-0"
                                    title="Print Statement"
                                  >
                                    <Printer className="h-3.5 w-3.5 text-blue-400" />
                                    <span>Print</span>
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
                        const q = paymentSearch.toLowerCase();
                        return (
                          c.accountNumber.toLowerCase().includes(q) ||
                          c.name.toLowerCase().includes(q) ||
                          c.contactNumber?.includes(q) ||
                          c.rfidTag?.toLowerCase().includes(q)
                        );
                      })
                      .sort((a, b) => {
                        const aUnpaid = readings.filter(r => r.accountNumber === a.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid').length;
                        const bUnpaid = readings.filter(r => r.accountNumber === b.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid').length;
                        return bUnpaid - aUnpaid; // Prioritize unpaid consumers first
                      })
                      .map((c) => {
                        const isSelected = selectedPaymentAccount?.accountNumber === c.accountNumber;
                        const consumerReadings = readings.filter(r => r.accountNumber === c.accountNumber && r.status === 'verified');
                        const unpaidReadings = consumerReadings.filter(r => r.paymentStatus !== 'paid');
                        const unpaidCount = unpaidReadings.length;

                        // Total due calculation including overdue penalties
                        const totalArrears = unpaidReadings.reduce((acc, r) => {
                          const w = Math.max(220, r.consumption * 24.50);
                          const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                          const pen = isOverdue ? Math.round(w * 0.10) : 0;
                          const gross = w + 85 + (w * 0.12) + pen;
                          const paid = r.paidAmount || 0;
                          return acc + Math.max(0, gross - paid);
                        }, 0);

                        return (
                          <div
                            key={c.accountNumber}
                            onClick={() => {
                              setSelectedPaymentAccount(c);
                              const unpaidList = readings.filter(r => r.accountNumber === c.accountNumber && r.status === 'verified' && r.paymentStatus !== 'paid');
                              const unpaidIds = unpaidList.map(r => r.id);
                              setSelectedBillIds(unpaidIds);
                              
                              // Auto calculate exact total due
                              const exactDue = unpaidList.reduce((acc, r) => {
                                const w = Math.max(220, r.consumption * 24.50);
                                const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                                const pen = isOverdue ? Math.round(w * 0.10) : 0;
                                const gross = w + 85 + (w * 0.12) + pen;
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
                              .map((r) => {
                                const waterAmount = Math.max(220, r.consumption * 24.50);
                                const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                                const penaltyAmount = isOverdue ? Math.round(waterAmount * 0.10) : 0;
                                const grossTotal = waterAmount + 85 + (waterAmount * 0.12) + penaltyAmount;
                                const alreadyPaid = r.paidAmount || 0;
                                const netBalanceDue = Math.max(0, grossTotal - alreadyPaid);
                                const isChecked = selectedBillIds.includes(r.id);

                                return (
                                  <div 
                                    key={r.id} 
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
                                    const w = Math.max(220, r.consumption * 24.50);
                                    const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                                    const pen = isOverdue ? Math.round(w * 0.10) : 0;
                                    const gross = w + 85 + (w * 0.12) + pen;
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
                                  const w = Math.max(220, r.consumption * 24.50);
                                  const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                                  const pen = isOverdue ? Math.round(w * 0.10) : 0;
                                  const gross = w + 85 + (w * 0.12) + pen;
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
                            const waterAmount = Math.max(220, r.consumption * 24.50);
                            const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                            const penaltyAmount = isOverdue ? Math.round(waterAmount * 0.10) : 0;
                            const grossTotal = waterAmount + 85 + (waterAmount * 0.12) + penaltyAmount;
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
                            const w = Math.max(220, r.consumption * 24.50);
                            const isOverdue = r.billingPeriod.includes('March') || r.billingPeriod.includes('April') || r.billingPeriod.includes('May');
                            const pen = isOverdue ? Math.round(w * 0.10) : 0;
                            const gross = w + 85 + (w * 0.12) + pen;
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
                        currentUsers.push({
                          id: created.id,
                          name: created.name,
                          email: created.email,
                          role: created.role.toLowerCase() === 'administrator' ? 'admin' : (created.role.toLowerCase() === 'cashier' ? 'cashier' : 'staff'),
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
                    {staffList.map((st) => (
                      <tr key={st.id} className="hover:bg-slate-50">
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
                {barangayList.map((bg) => {
                  const liveCount = consumers.filter(c => 
                    c.barangayId === bg.id || 
                    (c.barangay && c.barangay.toLowerCase() === bg.name.toLowerCase()) || 
                    (c.address && c.address.toLowerCase().includes(bg.name.toLowerCase()))
                  ).length;
                  const displayCount = Math.max(bg.consumers || 0, liveCount);

                  return (
                    <div key={bg.id} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center space-x-1.5">
                            <span className="bg-blue-100 text-blue-800 font-mono font-bold text-[10px] px-2.5 py-0.5 rounded-md">
                              {bg.code}
                            </span>
                            <span className="bg-slate-100 text-slate-700 font-mono font-bold text-[10px] px-2 py-0.5 rounded-md border border-slate-200">
                              {bg.id}
                            </span>
                          </div>
                          <h4 className="text-base font-black text-slate-900 mt-2">{bg.name}</h4>
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
              />
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

    </div>
  );
}

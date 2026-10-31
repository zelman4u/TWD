/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Compass, 
  Users, 
  Droplet, 
  BookOpen, 
  Activity, 
  Lock, 
  LogOut, 
  HelpCircle,
  FileText,
  User,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  ChevronRight,
  Calculator,
  Calendar,
  Waves,
  CreditCard,
  Smartphone,
  ReceiptText,
  FileCheck,
  ShieldCheck,
  Wifi,
  Send,
  CheckCircle2,
  X,
  Menu,
  Clock,
  Bell,
  BarChart3,
  ListFilter,
  Eye,
  EyeOff,
  Printer,
  RefreshCw,
  MapPin,
  Tag,
  Hash,
  Phone,
  Mail,
  Home,
  Briefcase,
  Layers,
  Info,
  AlertTriangle,
  ArrowRight,
  LayoutDashboard,
  ExternalLink,
  Check,
  Upload,
  Camera,
  ZoomIn,
  Download,
  AlertOctagon,
  Image as ImageIcon,
  Award,
  MessageSquare,
  Plus,
  UserCheck,
  Gauge,
  Wrench,
  Building
} from 'lucide-react';
import { mockDb } from '../mockDb';
import { User as UserType, Consumer, MeterReading, Announcement, ConsumerNotification, ConsumerReport, WaterMeterInstallationRequest } from '../types';
import { ConsumerPortalSkeleton, TableSkeleton, CardsGridSkeleton } from './common/SkeletonLoader';
import DataLoadingIndicator from './common/DataLoadingIndicator';
import { OverdueBillBanner } from './consumer/OverdueBillBanner';
import { DynamicDueAlert } from './consumer/DynamicDueAlert';
import { UploadReceiptModal } from './consumer/UploadReceiptModal';
import { MonthlyUsageReportModal, downloadConsumerUsageReportPdf } from './consumer/MonthlyUsageReportModal';
import { BillDetails } from './consumer/BillDetails';
import { ConsumerReportsSection } from './consumer/ConsumerReportsSection';
import { ConsumerInstallationSection } from './consumer/ConsumerInstallationSection';
import { useToast } from '../context/ToastContext';
import { useLoading } from '../context/LoadingContext';
import { calculateWaterTariff, getActiveTariffConfig, getReadingEffectiveBillAmount, isOfficialBillIssued, saveActiveTariffConfig, WaterTariffConfig } from '../utils/tariffCalculator';
import { inferNotificationType, isTransactionalPaymentOrReceiptItem, normalizeAdvisoryComparisonTitle, sanitizeAnnouncements } from '../utils/announcementSanitizer';
import { apiClient, safeBackendFetch } from '../services/apiClient';
import { initRealtimeSocket, sendRealtimeMessage } from '../services/realtimeSocket';
import {
  resolveConsumerAccountInFirestore,
  ensureRealtimeFirestoreListeners,
  subscribeToConsumerIdentityInFirestore,
  isRealIssuedAccountNumber,
  syncDocToFirestore,
  COLLECTIONS
} from '../services/firebaseDb';
import { TablePagination } from './common/TablePagination';
import { SmartSearchBar } from './common/SmartSearchBar';
import { smartMatch } from '../utils/smartSearch';
import {
  formatMeterStatusLabel,
  formatMeterStatusUpdateDate,
  normalizeMeterStatus
} from '../utils/meterStatusNotification';
import {
  filterInstallationRequestsForConsumer,
  formatInstallationDateDisplay,
  isPendingConsumerStatus
} from '../utils/installationWorkflow';
import {
  getNotificationAdminAttribution,
  buildReferencedNoticeFromNotification,
  getReportCategoryForNotification,
  getReportUrgencyForNotification,
  buildContextualInquiryTitle,
  findLinkedReportForNotification,
  normalizeCompactParagraphs,
  normalizeSingleLinePreview
} from '../utils/notificationContext';

interface ConsumerPortalProps {
  currentUser: UserType;
  onLogout: () => void;
}

export default function ConsumerPortal({ currentUser, onLogout }: ConsumerPortalProps) {
  const toast = useToast();
  const { showLoading, hideLoading } = useLoading();

  // Navigation Modules: Dashboard, Installation, My Bills, My Usage, Reports & Inquiries, Notifications, My Profile
  const [activeTab, setActiveTab] = useState<'dashboard' | 'installation' | 'bills' | 'usage' | 'reports' | 'notifications' | 'profile'>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Loading States
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTabLoading, setIsTabLoading] = useState(false);

  // Tab switching with data readiness indicator
  const handleConsumerTabChange = (tab: typeof activeTab) => {
    if (tab === activeTab) return;
    setIsTabLoading(true);
    setActiveTab(tab);
    if (mobileSidebarOpen) setMobileSidebarOpen(false);
    setTimeout(() => {
      setIsTabLoading(false);
    }, 220);
  };

  const getConsumerTabLoadingMessage = (tab: typeof activeTab) => {
    switch (tab) {
      case 'dashboard': return { title: 'Compiling Water Service Dashboard...', subtitle: 'Fetching current cubic meter index, billing summary, and active notices' };
      case 'installation': return { title: 'Loading Water Meter Installation Tracker...', subtitle: 'Retrieving installation schedule, field progress, and account validation status' };
      case 'bills': return { title: 'Loading My Water Bills Ledger...', subtitle: 'Calculating itemized tariff breakdown, due dates, and official payment receipts' };
      case 'usage': return { title: 'Querying Historical Consumption Telemetry...', subtitle: 'Aggregating monthly cubic meter trends and conservation metrics' };
      case 'reports': return { title: 'Querying Consumer Service Reports...', subtitle: 'Retrieving water leak reports, pressure issues, and administrative reply threads' };
      case 'notifications': return { title: 'Retrieving Account Alerts & Bulletins...', subtitle: 'Loading water advisory notices, billing alerts, and payment confirmations' };
      case 'profile': return { title: 'Loading Consumer Profile Information...', subtitle: 'Fetching registered address, account credentials, and meter tag identifiers' };
      default: return { title: 'Fetching Consumer Records...', subtitle: 'Synchronizing with Tagoloan Water District database' };
    }
  };

  // Core Data States
  const [consumerRecord, setConsumerRecord] = useState<Consumer | null>(null);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [allHistoryReadings, setAllHistoryReadings] = useState<MeterReading[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<ConsumerNotification[]>([]);
  const [reports, setReports] = useState<ConsumerReport[]>([]);
  const [installationRequests, setInstallationRequests] = useState<WaterMeterInstallationRequest[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());

  // Notification spotlight, bell dropdown, and notification detail modal states
  const [spotlightReading, setSpotlightReading] = useState<MeterReading | null>(null);
  const [highlightedReadingId, setHighlightedReadingId] = useState<string | null>(null);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [selectedBellNotification, setSelectedBellNotification] = useState<ConsumerNotification | null>(null);

  // Immediate Real-Time Payment Confirmation Toast/Banner
  const [paymentConfirmationToast, setPaymentConfirmationToast] = useState<{
    period: string;
    amount: number;
    remaining?: number;
    isPartial?: boolean;
    reference: string;
    date: string;
  } | null>(null);

  // Immediate Real-Time Account & Meter ID Issuance Confirmation Banner
  const [idConfirmedBanner, setIdConfirmedBanner] = useState<{
    accountNumber: string;
    meterNumber: string;
    confirmedAt: string;
    isUpdate?: boolean;
  } | null>(null);

  // Profile Edit States
  const [editName, setEditName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editSitioZone, setEditSitioZone] = useState('');
  const [editHouseholdInfo, setEditHouseholdInfo] = useState('');
  const [editBusinessName, setEditBusinessName] = useState('');
  const [editBusinessType, setEditBusinessType] = useState('');
  const [passwordOld, setPasswordOld] = useState('');
  const [passwordNew, setPasswordNew] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPasswordOld, setShowPasswordOld] = useState(false);
  const [showPasswordNew, setShowPasswordNew] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'err'; msg: string } | null>(null);
  const [phoneValidationError, setPhoneValidationError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isDownloadingUsagePdf, setIsDownloadingUsagePdf] = useState(false);

  // My Bills, My Usage & Notifications Smart Search + Filter State
  const [billFilter, setBillFilter] = useState<'all' | 'unpaid' | 'paid' | 'partial'>('all');
  const [consumerBillSearch, setConsumerBillSearch] = useState('');
  const [consumerUsageSearch, setConsumerUsageSearch] = useState('');
  const [consumerNotifSearch, setConsumerNotifSearch] = useState('');
  const [consumerBillsPage, setConsumerBillsPage] = useState(1);
  const [consumerUsagePage, setConsumerUsagePage] = useState(1);

  useEffect(() => {
    setConsumerBillsPage(1);
  }, [billFilter, consumerBillSearch]);

  useEffect(() => {
    setConsumerUsagePage(1);
  }, [consumerUsageSearch]);

  // Notifications Filter State
  const [notifFilter, setNotifFilter] = useState<'all' | 'installation' | 'meter_status' | 'billing' | 'payment' | 'account_issue' | 'announcement'>('all');

  // Official Office Receipt Upload & Validation Modal States
  const [isUploadReceiptOpen, setIsUploadReceiptOpen] = useState(false);
  const [uploadReceiptReading, setUploadReceiptReading] = useState<MeterReading | null>(null);
  const [viewingReceiptReading, setViewingReceiptReading] = useState<MeterReading | null>(null);

  // Digital Receipt Modal
  const [receiptDetailModal, setReceiptDetailModal] = useState<MeterReading | null>(null);

  // Bill Details Modal States
  const [billDetailsReading, setBillDetailsReading] = useState<MeterReading | null>(null);
  const [isBillDetailsOpen, setIsBillDetailsOpen] = useState(false);

  // Monthly Usage & Household Benchmark Report Modal State
  const [isUsageReportModalOpen, setIsUsageReportModalOpen] = useState(false);

  // Dynamic Tariff Schedule State & Modal
  const [activeTariff, setActiveTariff] = useState<WaterTariffConfig>(() => getActiveTariffConfig());
  const [showTariffScheduleModal, setShowTariffScheduleModal] = useState(false);

  // Track previous readings to detect admin payment modifications
  const prevReadingsRef = useRef<MeterReading[]>([]);
  const consumerRecordRef = useRef<Consumer | null>(null);
  const readingsRef = useRef<MeterReading[]>([]);
  const notifsRef = useRef<any[]>([]);
  const installationsRef = useRef<WaterMeterInstallationRequest[]>([]);
  const announcementsRef = useRef<any[]>([]);
  const lastMetaSyncRef = useRef<number>(0);
  const lastBillingsSyncRef = useRef<number>(0);
  const lastReportsSyncRef = useRef<number>(0);
  const lastAccountResolveRef = useRef<number>(0);
  const syncTimeoutRef = useRef<any>(null);
  const debounceDbUpdateRef = useRef<any>(null);
  const alertedOverdueRef = useRef<Set<string>>(new Set());
  const announcedIssuedBillIdsRef = useRef<Set<string>>(new Set());
  const dismissedSpotlightIdsRef = useRef<Set<string>>(new Set());
  const hasHydratedReadingsOnceRef = useRef<boolean>(false);
  const wasAccountPendingRef = useRef<boolean | null>(null);
  const lastAnnouncedAccountRef = useRef<string>('');
  const confirmedIssuedAccRef = useRef<string>('');
  const reconciledIssuedAccRef = useRef<string>('');
  const notifDropdownRef = useRef<HTMLDivElement | null>(null);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);

  // Close Notification Bell dropdown on outside click or Escape key
  useEffect(() => {
    if (!showNotifDropdown) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(event.target as Node)) {
        setShowNotifDropdown(false);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowNotifDropdown(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showNotifDropdown]);

  const [bellReplyText, setBellReplyText] = useState('');
  const [isSubmittingBellReply, setIsSubmittingBellReply] = useState(false);

  // Reset inline reply draft when switching notifications in the Bell Detail Modal
  useEffect(() => {
    setBellReplyText('');
  }, [selectedBellNotification?.id]);

  // Close Notification Detail Modal on Escape key
  useEffect(() => {
    if (!selectedBellNotification) return;
    const handleModalEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedBellNotification(null);
      }
    };
    document.addEventListener('keydown', handleModalEsc);
    return () => {
      document.removeEventListener('keydown', handleModalEsc);
    };
  }, [selectedBellNotification]);

  // Helper: Check whether a consumer record has officially issued IDs
  const isConsumerRecordIssued = (rec?: Consumer | null): boolean => {
    if (!rec) return false;
    if (!isRealIssuedAccountNumber(rec.accountNumber)) {
      return false;
    }
    const mtr = (rec.meterNumber || '').trim().toUpperCase();
    if (mtr && mtr.startsWith('PENDING')) {
      return false;
    }
    return true;
  };

  // Helper: Detect whether a notification is a Consumer Report / Concern Reply notification
  const isReportNotification = (n?: ConsumerNotification | null): boolean => {
    if (!n) return false;
    if (n.type && n.type !== 'report') return false;
    if (n.type === 'report' || Boolean(n.reportId || n.ticketNumber)) return true;
    const combined = `${n.title || ''} ${n.message || ''}`;
    return /concern\s*#?twd-cr-|ticket\s*#?twd-cr-|official reply on concern/i.test(combined);
  };

  // Direct Contextual Reply inside Notification Bell Detail Modal
  const handleSendBellNotificationReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBellNotification || !bellReplyText.trim() || !consumerRecord) return;

    const n = selectedBellNotification;
    const cleanMsg = bellReplyText.trim();
    const existingLinkedReport = findLinkedReportForNotification(n, reports);

    setIsSubmittingBellReply(true);
    try {
      if (existingLinkedReport) {
        const replyId = `REP-MSG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const replyTimestamp = new Date().toISOString();
        const senderId = consumerRecord.accountNumber || currentUser.id || 'consumer';
        const senderName = consumerRecord.name || currentUser.name || 'Consumer';

        const updated = mockDb.replyToReport(existingLinkedReport.id, {
          id: replyId,
          timestamp: replyTimestamp,
          senderId,
          senderName,
          senderRole: 'consumer',
          message: cleanMsg,
        });

        setBellReplyText('');
        const refreshed = getConsumerReportsFromLocal(consumerRecord);
        setReports(refreshed);

        if (updated) {
          sendRealtimeMessage('CONSUMER_REPLIED_TO_REPORT', {
            report: updated,
            reply: {
              id: replyId,
              reportId: updated.id,
              senderId,
              senderName,
              senderRole: 'consumer',
              message: cleanMsg,
              timestamp: replyTimestamp,
            },
            ticketNumber: updated.ticketNumber,
            message: `Consumer ${senderName} replied regarding "${updated.referencedNotice?.subject || updated.title}" [Ticket #${updated.ticketNumber}].`,
          });

          toast.success(
            'Reply Sent to Administration',
            `Your reply was added to Ticket #${updated.ticketNumber} with the referenced Official Notice attached.`
          );

          apiClient
            .replyToReport(existingLinkedReport.id, {
              id: replyId,
              replyId,
              timestamp: replyTimestamp,
              senderId,
              senderName,
              senderRole: 'consumer',
              message: cleanMsg,
              report: existingLinkedReport,
            })
            .then((res) => {
              if (res?.report) {
                mockDb.mergeExternalReports([res.report]);
                setReports(getConsumerReportsFromLocal(consumerRecord));
              }
            })
            .catch(() => {});
        }
      } else {
        const referencedNotice = buildReferencedNoticeFromNotification(n, consumerRecord);
        const contextualTitle = buildContextualInquiryTitle(n, consumerRecord);
        const category = getReportCategoryForNotification(n);
        const urgency = getReportUrgencyForNotification(n);

        const created = mockDb.createReport({
          accountNumber: consumerRecord.accountNumber || currentUser.linkedAccountNumber || 'PENDING',
          consumerName: consumerRecord.name || currentUser.name || 'Valued Consumer',
          consumerEmail: (consumerRecord.email || currentUser.email || '').trim().toLowerCase(),
          consumerPhone: consumerRecord.contactNumber || '',
          barangay: consumerRecord.barangay || 'Poblacion',
          address: consumerRecord.address || '',
          meterNumber: n.meterNumber || consumerRecord.meterNumber || '',
          category,
          urgency,
          title: contextualTitle,
          description: cleanMsg,
          sourceNotificationId: n.id,
          referencedNotice,
        });

        setBellReplyText('');
        setReports(getConsumerReportsFromLocal(consumerRecord));

        sendRealtimeMessage('CONSUMER_REPORT_CREATED', {
          report: created,
          ticketNumber: created.ticketNumber,
          consumerName: created.consumerName,
          accountNumber: created.accountNumber,
          category: created.category,
          title: created.title,
          urgency: created.urgency,
          message: `Consumer ${created.consumerName} (#${created.accountNumber}) replied directly to Official Notice "${referencedNotice.subject}" [${created.ticketNumber}].`,
        });

        toast.success(
          'Contextual Reply Sent to Administration',
          `Ticket #${created.ticketNumber} created with Official Notice "${referencedNotice.subject}" automatically attached so Admin knows your exact concern.`
        );

        apiClient
          .createReport(created)
          .then((res) => {
            if (res?.report) {
              mockDb.mergeExternalReports([res.report]);
              setReports(getConsumerReportsFromLocal(consumerRecord));
            }
          })
          .catch(() => {});
      }
    } finally {
      setIsSubmittingBellReply(false);
    }
  };

  // Helper: Resolve exact report ID or ticket number from a notification
  const resolveNotificationReportTarget = (n?: ConsumerNotification | null): string | null => {
    if (!n) return null;
    if (n.reportId) return n.reportId;
    if (n.ticketNumber) return n.ticketNumber;
    const combined = `${n.title || ''} ${n.message || ''}`;
    const match = combined.match(/TWD-CR-\d{4}-\d+/i);
    if (match?.[0]) {
      const cleanTicket = match[0].toUpperCase();
      const found = mockDb.getReports().find(r => r.ticketNumber.toUpperCase() === cleanTicket);
      return found ? found.id : cleanTicket;
    }
    return null;
  };

  // Helper: Read local reports strictly belonging to this consumer (by accountNumber or email)
  const getConsumerReportsFromLocal = (rec?: Consumer | null): ConsumerReport[] => {
    const activeRec = rec ?? consumerRecordRef.current;
    const acc = (activeRec?.accountNumber || currentUser.linkedAccountNumber || '').trim();
    const byAcc =
      acc && !acc.toUpperCase().startsWith('PENDING')
        ? mockDb.getReports(acc)
        : [];
    const myEmail = (activeRec?.email || currentUser.email || '').trim().toLowerCase();
    const byEmail = myEmail
      ? mockDb.getReports().filter(rep => (rep.consumerEmail || '').trim().toLowerCase() === myEmail)
      : [];
    const seenIds = new Set<string>();
    return [...byAcc, ...byEmail]
      .filter(rep => {
        if (!rep?.id || seenIds.has(rep.id)) return false;
        seenIds.add(rep.id);
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  };

  // Helper: Read local notifications strictly belonging to this consumer
  const getConsumerNotificationsFromLocal = (rec?: Consumer | null): ConsumerNotification[] => {
    const activeRec = rec ?? consumerRecordRef.current;
    if (activeRec) {
      return mockDb.getNotifications(activeRec.accountNumber, {
        userId: activeRec.linkedUserId || currentUser.id,
        email: activeRec.email || currentUser.email,
        consumerId: activeRec.id
      });
    }
    return mockDb.getNotifications(currentUser.linkedAccountNumber, {
      userId: currentUser.id,
      email: currentUser.email
    });
  };

  // Fast bi-directional reconciliation of reports & notifications (works in <2s on Vercel even when Firestore quota is full)
  const syncConsumerReportsAndNotifications = (silent = true) => {
    const activeRec = consumerRecordRef.current;
    const localReports = getConsumerReportsFromLocal(activeRec);
    setReports(localReports);

    const localNotifs = getConsumerNotificationsFromLocal(activeRec);
    if (JSON.stringify(notifsRef.current) !== JSON.stringify(localNotifs)) {
      notifsRef.current = localNotifs;
      setNotifications(localNotifs);
    }

    const nowMs = Date.now();
    const shouldPollReportsAndNotifs = !silent || nowMs - lastReportsSyncRef.current >= 4000;

    const acc = (activeRec?.accountNumber || currentUser.linkedAccountNumber || '').trim();
    const validAcc = acc && !acc.toUpperCase().startsWith('PENDING') ? acc : undefined;
    const myEmail = (activeRec?.email || currentUser.email || '').trim().toLowerCase() || undefined;

    if (shouldPollReportsAndNotifs && (validAcc || myEmail)) {
      lastReportsSyncRef.current = nowMs;
      apiClient
        .reconcileReports(
          {
            reports: localReports.slice(0, 20),
            accountNumber: validAcc,
            email: myEmail
          },
          { skipLogging: true }
        )
        .then(res => {
          if (res?.success && Array.isArray(res.reports)) {
            if (res.reports.length > 0) {
              mockDb.mergeExternalReports(res.reports);
            }
            setReports(getConsumerReportsFromLocal());
          }
        })
        .catch(() => {
          apiClient
            .getReports({ accountNumber: validAcc, email: myEmail }, { skipLogging: true })
            .then(res => {
              if (res?.success && Array.isArray(res.reports) && res.reports.length > 0) {
                mockDb.mergeExternalReports(res.reports);
                setReports(getConsumerReportsFromLocal());
              }
            })
            .catch(() => {});
        });
    }

    if (validAcc && (!silent || nowMs - lastBillingsSyncRef.current >= 3500)) {
      lastBillingsSyncRef.current = nowMs;
      const validAccUpper = validAcc.replace(/^#/, '').trim().toUpperCase();
      const recMeterUpper = (activeRec?.meterNumber || '').trim().toUpperCase();
      apiClient
        .getBillings({ accountNumber: validAccUpper }, { skipLogging: true })
        .then(bRes => {
          if (bRes?.success && Array.isArray(bRes.readings) && bRes.readings.length > 0) {
            const mergedReadings = mockDb.mergeExternalReadings(bRes.readings);
            const customerVerified = mergedReadings
              .filter(r => {
                const rAccUpper = (r.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
                const rMeterUpper = (r.meterNumber || '').trim().toUpperCase();
                return (
                  ((validAccUpper && rAccUpper === validAccUpper) ||
                    (recMeterUpper && !recMeterUpper.startsWith('PENDING') && rMeterUpper === recMeterUpper)) &&
                  r.status === 'verified'
                );
              })
              .sort(
                (a, b) =>
                  new Date(b.readingDate).getTime() - new Date(a.readingDate).getTime() ||
                  new Date(b.billingIssuedAt || 0).getTime() - new Date(a.billingIssuedAt || 0).getTime()
              );
            if (JSON.stringify(readingsRef.current) !== JSON.stringify(customerVerified)) {
              loadConsumerInfo(true);
            }
          }
        })
        .catch(() => {});
    }

    const localInstallations = filterInstallationRequestsForConsumer(
      activeRec,
      mockDb.getInstallationRequests(),
      currentUser.email,
      currentUser.id
    );
    if (JSON.stringify(installationsRef.current) !== JSON.stringify(localInstallations)) {
      installationsRef.current = localInstallations;
      setInstallationRequests(localInstallations);
    }

    if (shouldPollReportsAndNotifs) {
      const notifParams = new URLSearchParams();
      if (validAcc) notifParams.set('accountNumber', validAcc);
      if (activeRec?.linkedUserId || currentUser.id) notifParams.set('userId', activeRec?.linkedUserId || currentUser.id);
      if (myEmail) notifParams.set('email', myEmail);
      if (activeRec?.id) notifParams.set('consumerId', activeRec.id);
      if ([...notifParams.keys()].length > 0) {
        safeBackendFetch(`/api/notifications?${notifParams.toString()}`)
          .then(res => (res ? res.json() : null))
          .then(nData => {
            if (nData?.success && Array.isArray(nData.notifications) && nData.notifications.length > 0) {
              if (mockDb.mergeExternalNotifications(nData.notifications)) {
                const refreshed = getConsumerNotificationsFromLocal();
                notifsRef.current = refreshed;
                setNotifications(refreshed);
              }
            }
          })
          .catch(() => {});
      }

      apiClient
        .getInstallations(
          {
            email: myEmail,
            userId: activeRec?.linkedUserId || currentUser.id,
            applicationNumber: activeRec?.applicationNumber,
          },
          { skipLogging: true }
        )
        .then((instData) => {
          if (instData?.success && Array.isArray(instData.installations) && instData.installations.length > 0) {
            mockDb.mergeExternalInstallations(instData.installations);
            const refreshedInst = filterInstallationRequestsForConsumer(
              consumerRecordRef.current,
              mockDb.getInstallationRequests(),
              currentUser.email,
              currentUser.id
            );
            if (JSON.stringify(installationsRef.current) !== JSON.stringify(refreshedInst)) {
              installationsRef.current = refreshedInst;
              setInstallationRequests(refreshedInst);
            }
          }
        })
        .catch(() => {});
    }
  };

  // Helper: Match whether an incoming consumer or notification payload belongs to the logged-in consumer
  const doesPayloadBelongToCurrentUser = (payload: any): boolean => {
    if (!payload) return false;
    const targetConsumer = payload.consumer || payload.request || payload.report || payload;
    const myEmail = (currentUser.email || consumerRecordRef.current?.email || '').trim().toLowerCase();
    const myUid = (currentUser.id || consumerRecordRef.current?.linkedUserId || '').trim();
    const myAcc = (currentUser.linkedAccountNumber || consumerRecordRef.current?.accountNumber || '').trim().toUpperCase();
    const myAppNo = (consumerRecordRef.current?.applicationNumber || installationsRef.current[0]?.applicationNumber || '').trim().toUpperCase();
    const myName = (currentUser.name || consumerRecordRef.current?.name || '').trim().toLowerCase();

    const pEmail = (targetConsumer.email || targetConsumer.consumerEmail || payload.email || payload.consumerEmail || '').trim().toLowerCase();
    const pUid = (targetConsumer.linkedUserId || payload.linkedUserId || payload.userId || '').trim();
    const pAcc = (targetConsumer.accountNumber || targetConsumer.assignedAccountNumber || payload.accountNumber || '').trim().toUpperCase();
    const pPrevAcc = (payload.previousAccountNumber || '').trim().toUpperCase();
    const pAppNo = (targetConsumer.applicationNumber || payload.applicationNumber || '').trim().toUpperCase();
    const pName = (targetConsumer.name || targetConsumer.consumerName || '').trim().toLowerCase();

    if (pAcc === 'ALL' || pAcc === 'BROADCAST' || pAcc === 'DISTRICT') return true;
    if (myUid && pUid && myUid === pUid) return true;
    if (myEmail && pEmail && myEmail === pEmail) return true;
    if (myAppNo && pAppNo && myAppNo === pAppNo) return true;
    if (myAcc && !myAcc.startsWith('PENDING') && ((pAcc && myAcc === pAcc) || (pPrevAcc && myAcc === pPrevAcc))) return true;
    if (myName && pName && myName === pName && !pEmail && !pUid) return true;
    return false;
  };

  // Helper: Persist confirmed consumer + user session + notification and surface instant confirmation UI
  const applyAutomaticIdConfirmation = (
    issuedConsumer: Consumer,
    incomingNotif?: ConsumerNotification,
    isUpdate = false,
    triggerBanner = true
  ) => {
    if (!issuedConsumer || !isConsumerRecordIssued(issuedConsumer)) return;

    const accNum = issuedConsumer.accountNumber.trim().toUpperCase();
    const meterNum = (issuedConsumer.meterNumber || `MT-${accNum}`).trim().toUpperCase();

    const normalizedConsumer: Consumer = {
      ...consumerRecordRef.current,
      ...issuedConsumer,
      accountNumber: accNum,
      meterNumber: meterNum,
      status: issuedConsumer.status && !isPendingConsumerStatus(issuedConsumer.status) ? issuedConsumer.status : 'active',
      isRegistered: true
    };

    // 1. Update local consumers store & remove any stale pending duplicate ONLY if changed
    const localConsumers = mockDb.getConsumers();
    let matched = false;
    const updatedConsumers = localConsumers.map(lc => {
      const same =
        (lc.accountNumber && lc.accountNumber.toUpperCase() === accNum) ||
        (normalizedConsumer.email && lc.email && lc.email.toLowerCase() === normalizedConsumer.email.toLowerCase()) ||
        (normalizedConsumer.linkedUserId && lc.linkedUserId && lc.linkedUserId === normalizedConsumer.linkedUserId);
      if (same) {
        matched = true;
        return { ...lc, ...normalizedConsumer };
      }
      return lc;
    });
    if (!matched) {
      updatedConsumers.unshift(normalizedConsumer);
    }
    if (JSON.stringify(localConsumers) !== JSON.stringify(updatedConsumers)) {
      mockDb.saveConsumers(updatedConsumers);
    }

    // 2. Update local users store & active currentUser session so linkedAccountNumber is permanently bound ONLY if changed
    const localUsers = mockDb.getUsers();
    const updatedUsers = localUsers.map(u => {
      const isMe =
        (currentUser.id && u.id === currentUser.id) ||
        (normalizedConsumer.linkedUserId && u.id === normalizedConsumer.linkedUserId) ||
        (currentUser.email && u.email && u.email.toLowerCase() === currentUser.email.toLowerCase());
      if (isMe) {
        return { ...u, linkedAccountNumber: accNum, status: 'active' as const };
      }
      return u;
    });
    if (JSON.stringify(localUsers) !== JSON.stringify(updatedUsers)) {
      mockDb.saveUsers(updatedUsers);
    }

    const sessionUser = mockDb.getCurrentUser();
    if (sessionUser && (sessionUser.id === currentUser.id || (sessionUser.email && currentUser.email && sessionUser.email.toLowerCase() === currentUser.email.toLowerCase()))) {
      if (sessionUser.linkedAccountNumber !== accNum || sessionUser.status !== 'active') {
        mockDb.setCurrentUser({
          ...sessionUser,
          linkedAccountNumber: accNum,
          status: 'active'
        });
      }
    }

    // 3. Re-associate prior pending notifications & ensure official account_issue notification exists
    mockDb.updateConsumerNotifications(
      {
        userId: normalizedConsumer.linkedUserId || currentUser.id,
        email: normalizedConsumer.email || currentUser.email,
        consumerId: normalizedConsumer.id
      },
      {
        accountNumber: accNum,
        userId: normalizedConsumer.linkedUserId || currentUser.id,
        consumerEmail: normalizedConsumer.email || currentUser.email
      }
    );

    if (incomingNotif) {
      mockDb.mergeExternalNotifications([{
        ...incomingNotif,
        accountNumber: accNum,
        userId: incomingNotif.userId || normalizedConsumer.linkedUserId || currentUser.id,
        consumerEmail: incomingNotif.consumerEmail || normalizedConsumer.email || currentUser.email
      }]);
    } else {
      const existingNotifs = mockDb.getNotifications(accNum, {
        userId: normalizedConsumer.linkedUserId || currentUser.id,
        email: normalizedConsumer.email || currentUser.email,
        consumerId: normalizedConsumer.id
      });
      const hasIssuanceNotif = existingNotifs.some(
        n =>
          n.type === 'account_issue' &&
          !(n.title || '').toLowerCase().includes('registration application submitted') &&
          (n.accountNumber || '').replace(/^#/, '').trim().toUpperCase() === accNum
      );
      if (!hasIssuanceNotif) {
        mockDb.addNotification({
          accountNumber: accNum,
          consumerId: normalizedConsumer.id,
          userId: normalizedConsumer.linkedUserId || currentUser.id,
          consumerEmail: normalizedConsumer.email || currentUser.email,
          title: isUpdate ? `Account Number Updated to #${accNum}` : `Official Account Number & Meter Tag Issued!`,
          message: `Your water service account has been officially confirmed and activated by Tagoloan Water District Administration. Your permanent Account Number is #${accNum} and Meter Tag Number is #${meterNum}.`,
          type: 'account_issue'
        });
      }
    }

    confirmedIssuedAccRef.current = accNum;

    // 4. Refresh React state immediately so portal unlocks without reload
    if (JSON.stringify(consumerRecordRef.current) !== JSON.stringify(normalizedConsumer)) {
      consumerRecordRef.current = normalizedConsumer;
      setConsumerRecord(normalizedConsumer);
    }
    wasAccountPendingRef.current = false;

    const refreshedNotifs = mockDb.getNotifications(accNum, {
      userId: normalizedConsumer.linkedUserId || currentUser.id,
      email: normalizedConsumer.email || currentUser.email,
      consumerId: normalizedConsumer.id
    });
    if (JSON.stringify(notifsRef.current) !== JSON.stringify(refreshedNotifs)) {
      notifsRef.current = refreshedNotifs;
      setNotifications(refreshedNotifs);
    }

    // 5. Announce confirmation banner & toast once per newly confirmed account number
    if (triggerBanner && lastAnnouncedAccountRef.current !== accNum) {
      lastAnnouncedAccountRef.current = accNum;
      setIdConfirmedBanner({
        accountNumber: accNum,
        meterNumber: meterNum,
        confirmedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isUpdate
      });
      toast.success(
        isUpdate ? `Account Updated to #${accNum}` : 'Official Account Confirmed & Activated!',
        `Account #${accNum} and Meter Tag #${meterNum} have been issued by Administration. Your portal and notifications are now live.`,
        7000
      );
    }
  };

  // Tariff calculation helper (honors locked billAmount on existing readings; uses active tariff only for new/un-stamped usage)
  const calculateCostOf = (
    usageOrReading: number | MeterReading,
    classification: 'Residential' | 'Commercial' = 'Residential'
  ) => {
    const cls = classification === 'Commercial' ? 'Commercial' : 'Residential';
    if (typeof usageOrReading === 'number') {
      return calculateWaterTariff(usageOrReading, cls);
    }
    return getReadingEffectiveBillAmount(usageOrReading, cls);
  };

  // Real-Time Data Loader
  const loadConsumerInfo = (silent = false) => {
    if (!silent) setIsSyncing(true);

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      // Detect whether the active persisted consumer session was still unlinked before reconciliation
      const sessionBefore = mockDb.getCurrentUser() || currentUser;
      const sessionWasUnlinked = Boolean(
        !sessionBefore?.linkedAccountNumber ||
        sessionBefore.linkedAccountNumber.toUpperCase().startsWith('PENDING') ||
        isPendingConsumerStatus(sessionBefore.status)
      );

      // Heal any locally stored issued accounts & notifications first
      mockDb.reconcileIssuedAccounts();

      const resolvePayload = {
        email: currentUser.email || consumerRecordRef.current?.email,
        userId: currentUser.id || consumerRecordRef.current?.linkedUserId,
        accountNumber: consumerRecordRef.current?.accountNumber || sessionBefore?.linkedAccountNumber || currentUser.linkedAccountNumber,
        name: currentUser.name || consumerRecordRef.current?.name,
        contactNumber: consumerRecordRef.current?.contactNumber
      };

      const applyRemoteResolution = (resolvedData: { isIssued?: boolean; consumer?: Consumer | null; notifications?: ConsumerNotification[] } | null) => {
        if (!resolvedData) return;
        if (Array.isArray(resolvedData.notifications) && resolvedData.notifications.length > 0) {
          const notifMerged = mockDb.mergeExternalNotifications(resolvedData.notifications);
          if (notifMerged) {
            const refreshedNotifs = mockDb.getNotifications(
              resolvedData.consumer?.accountNumber || consumerRecordRef.current?.accountNumber || currentUser.linkedAccountNumber,
              {
                userId: resolvedData.consumer?.linkedUserId || currentUser.id,
                email: resolvedData.consumer?.email || currentUser.email,
                consumerId: resolvedData.consumer?.id
              }
            );
            if (JSON.stringify(notifsRef.current) !== JSON.stringify(refreshedNotifs)) {
              notifsRef.current = refreshedNotifs;
              setNotifications(refreshedNotifs);
            }
          }
        }

        const matchedRemote = resolvedData.consumer;
        if (matchedRemote) {
          if (isConsumerRecordIssued(matchedRemote)) {
            const remoteAccUpper = matchedRemote.accountNumber.trim().toUpperCase();
            if (confirmedIssuedAccRef.current !== remoteAccUpper) {
              const shouldShowBanner = wasAccountPendingRef.current === true || sessionWasUnlinked;
              applyAutomaticIdConfirmation(matchedRemote, undefined, false, shouldShowBanner);
            }
          } else {
            const currentLocal = mockDb.getConsumers();
            const idx = currentLocal.findIndex(lc =>
              (matchedRemote.accountNumber && lc.accountNumber === matchedRemote.accountNumber) ||
              (matchedRemote.email && lc.email && lc.email.toLowerCase() === matchedRemote.email.toLowerCase()) ||
              (matchedRemote.linkedUserId && lc.linkedUserId === matchedRemote.linkedUserId)
            );
            if (idx < 0) {
              currentLocal.unshift(matchedRemote);
              mockDb.saveConsumers(currentLocal);
            }
            if (!isConsumerRecordIssued(consumerRecordRef.current)) {
              consumerRecordRef.current = idx >= 0 ? currentLocal[idx] : matchedRemote;
              setConsumerRecord(consumerRecordRef.current);
            }
          }
        }
      };

      const alreadyIssuedLocally = isConsumerRecordIssued(consumerRecordRef.current);
      const shouldRunRemoteResolve =
        !alreadyIssuedLocally ||
        !silent ||
        Date.now() - lastAccountResolveRef.current >= 30000;

      if (shouldRunRemoteResolve) {
        lastAccountResolveRef.current = Date.now();
        // 1a. Direct Cloud Firestore resolution (works across all devices, browsers, and Vercel deployments)
        resolveConsumerAccountInFirestore(resolvePayload)
          .then(fsResolved => {
            if (fsResolved) applyRemoteResolution(fsResolved);
          })
          .catch(() => {});

        // 1b. Authoritative account & notification resolution against backend API
        safeBackendFetch('/api/consumers/resolve-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-portal': 'consumer' },
          body: JSON.stringify(resolvePayload)
        })
          .then(res => (res ? res.json() : null))
          .then(resolvedData => {
            if (resolvedData?.success) applyRemoteResolution(resolvedData);
          })
          .catch(() => {});
      }

      const consumers = mockDb.getConsumers();
      const allReadings = mockDb.getReadings();
      const allUsers = mockDb.getUsers();
      
      // Find latest live user data in case admin updated it in background
      const liveUser = allUsers.find(
        u => (currentUser.id && u.id === currentUser.id) ||
             (currentUser.email && u.email && u.email.toLowerCase() === currentUser.email.toLowerCase()) ||
             (currentUser.linkedAccountNumber && !currentUser.linkedAccountNumber.toUpperCase().startsWith('PENDING') && u.linkedAccountNumber === currentUser.linkedAccountNumber) ||
             (currentUser.name && u.name && u.name.toLowerCase() === currentUser.name.toLowerCase())
      );

      // Match linked account number, user id, email, phone, or verified name
      const matching = consumers.filter(c => {
        // 1. Valid Issued Account Number Match
        const userAcc = (currentUser.linkedAccountNumber || liveUser?.linkedAccountNumber || '').trim();
        if (userAcc && !userAcc.toUpperCase().startsWith('PENDING') && c.accountNumber && c.accountNumber.toUpperCase() === userAcc.toUpperCase()) {
          return true;
        }
        // 2. User ID Match
        const uid = currentUser.id || liveUser?.id;
        if (uid && c.linkedUserId && c.linkedUserId === uid) {
          return true;
        }
        // 3. Email Match
        const userEmail = (currentUser.email || liveUser?.email || '').trim().toLowerCase();
        const consumerEmail = (c.email || '').trim().toLowerCase();
        if (userEmail && consumerEmail && userEmail === consumerEmail) {
          return true;
        }
        // 4. Name match whenever emails do not belong to a different account
        const userName = (currentUser.name || liveUser?.name || '').trim().toLowerCase();
        const consumerName = (c.name || '').trim().toLowerCase();
        if (userName && consumerName && userName === consumerName) {
          if (!userEmail || !consumerEmail || userEmail === consumerEmail) {
            return true;
          }
        }
        return false;
      });

      // Sort matching so active issued record always takes top precedence over stale pending records
      matching.sort((a, b) => (isConsumerRecordIssued(b) ? 1 : 0) - (isConsumerRecordIssued(a) ? 1 : 0));

      const userLinkedAcc = isRealIssuedAccountNumber(liveUser?.linkedAccountNumber)
        ? liveUser!.linkedAccountNumber!.trim().toUpperCase()
        : isRealIssuedAccountNumber(currentUser.linkedAccountNumber)
          ? currentUser.linkedAccountNumber!.trim().toUpperCase()
          : '';

      let record = matching.length > 0 ? matching[0] : null;

      // Upgrade unissued record or synthesize record if user session already carries an Admin-issued linkedAccountNumber
      if (userLinkedAcc && (!record || !isConsumerRecordIssued(record))) {
        record = {
          ...(record || {
            name: liveUser?.name || currentUser.name,
            address: 'Tagoloan, Misamis Oriental',
            barangay: 'Poblacion',
            barangayId: 'BRG-01',
            sitioZone: 'Zone 1',
            contactNumber: '',
            email: liveUser?.email || currentUser.email || '',
            consumerType: 'Residential',
            meterSize: '1/2"',
            outstandingBalance: 0,
            isRegistered: true,
            linkedUserId: liveUser?.id || currentUser.id,
          }),
          accountNumber: userLinkedAcc,
          meterNumber:
            record?.meterNumber && !record.meterNumber.toUpperCase().startsWith('PENDING')
              ? record.meterNumber
              : `MT-${userLinkedAcc}`,
          status: 'active',
        };
      }

      if (record) {
        const nowIssued = isConsumerRecordIssued(record);
        const wasPendingBefore = wasAccountPendingRef.current;

        if (nowIssued) {
          const normalizedRecord: Consumer =
            isPendingConsumerStatus(record.status)
              ? { ...record, status: 'active' }
              : record;
          record = normalizedRecord;

          const normalizedAccUpper = record.accountNumber.trim().toUpperCase();

          // Check if consumer's issuance notification is already present; if session was unlinked or notification missing, apply full confirmation once
          const existingLocalNotifs = mockDb.getNotifications(record.accountNumber, {
            userId: record.linkedUserId || currentUser.id,
            email: record.email || currentUser.email,
            consumerId: record.id
          });
          const hasIssuanceNotif = existingLocalNotifs.some(
            n => n.type === 'account_issue' && !(n.title || '').toLowerCase().includes('registration application submitted')
          );

          if (
            confirmedIssuedAccRef.current !== normalizedAccUpper &&
            (wasPendingBefore === true || sessionWasUnlinked || !hasIssuanceNotif)
          ) {
            applyAutomaticIdConfirmation(record, undefined, false, wasPendingBefore === true || sessionWasUnlinked);
          } else {
            confirmedIssuedAccRef.current = normalizedAccUpper;
            wasAccountPendingRef.current = false;
            if (!lastAnnouncedAccountRef.current) {
              lastAnnouncedAccountRef.current = normalizedAccUpper;
            }
            if (JSON.stringify(consumerRecordRef.current) !== JSON.stringify(record)) {
              consumerRecordRef.current = record;
              setConsumerRecord(record);
            }
          }

          // Reconcile confirmed local record once per issued account with backend REST store (never write to Firestore in polling loop)
          if (reconciledIssuedAccRef.current !== normalizedAccUpper) {
            reconciledIssuedAccRef.current = normalizedAccUpper;
            const accountIssueNotifs = mockDb.getNotifications(record.accountNumber, {
              userId: record.linkedUserId || currentUser.id,
              email: record.email || currentUser.email,
              consumerId: record.id
            }).filter(n => n.type === 'account_issue' && !(n.title || '').toLowerCase().includes('registration application submitted'));

            safeBackendFetch('/api/consumers/reconcile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-portal': 'consumer' },
              body: JSON.stringify({
                consumers: [record],
                notifications: accountIssueNotifs
              })
            }).catch(() => {});
          }
        } else {
          wasAccountPendingRef.current = true;
          if (JSON.stringify(consumerRecordRef.current) !== JSON.stringify(record)) {
            consumerRecordRef.current = record;
            setConsumerRecord(record);
          }
        }
        
        // Filter readings belonging strictly to this customer's valid issued identifiers (case-insensitive)
        const recAccClean = (record.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
        const recMeterClean = (record.meterNumber || '').trim().toUpperCase();
        const hasValidAccId = Boolean(recAccClean && !recAccClean.startsWith('PENDING'));
        const hasValidMeterId = Boolean(recMeterClean && !recMeterClean.startsWith('PENDING'));

        const allCustomerReads = hasValidAccId || hasValidMeterId
          ? allReadings.filter(r => {
              if (r.status === 'cancelled') return false;
              const rAcc = (r.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
              const rMeter = (r.meterNumber || '').trim().toUpperCase();
              return (hasValidAccId && rAcc === recAccClean) || (hasValidMeterId && rMeter === recMeterClean);
            })
          : [];
        // Sort newest first deterministically: readingDate desc -> cumulative meter dial (currentReading/presentReading) desc -> timestamp desc
        // This guarantees multiple readings sent on the same day never invert their Previous -> Present -> Current chain.
        allCustomerReads.sort(
          (a, b) =>
            new Date(b.readingDate || 0).getTime() - new Date(a.readingDate || 0).getTime() ||
            Number(b.currentReading ?? b.presentReading ?? 0) - Number(a.currentReading ?? a.presentReading ?? 0) ||
            new Date(b.billingIssuedAt || b.submittedAt || 0).getTime() - new Date(a.billingIssuedAt || a.submittedAt || 0).getTime()
        );
        
        // CRITICAL GHOST-PROCESS PREVENTION:
        // Only APPROVED / VERIFIED readings trigger billing operations, payable ledgers, and overdue calculations!
        const verifiedReads = allCustomerReads.filter(r => r.status === 'verified');
        
        // Detect newly issued bills AND newly recorded Admin/Cashier payments in real time
        if (hasHydratedReadingsOnceRef.current) {
          verifiedReads.forEach(newR => {
            const oldR = prevReadingsRef.current.find(o => o.id === newR.id);
            const wasIssuedBefore = oldR ? isOfficialBillIssued(oldR) : false;
            const isIssuedNow = isOfficialBillIssued(newR);

            if (!wasIssuedBefore && isIssuedNow && !announcedIssuedBillIdsRef.current.has(newR.id)) {
              announcedIssuedBillIdsRef.current.add(newR.id);
              dismissedSpotlightIdsRef.current.delete(newR.id);
              setSpotlightReading(newR);
              if (newR.paymentStatus !== 'paid') {
                const presDial = newR.presentReading ?? newR.currentReading;
                toast.info(
                  `Water Bill Issued — ${newR.billingPeriod}`,
                  `Prev: ${newR.previousReading} m³ → Pres: ${presDial} m³ (${newR.consumption} m³ used). Total Due: ₱${calculateCostOf(newR, record.consumerType).toFixed(2)}.`,
                  6500
                );
              }
            }

            if (oldR) {
              if (oldR.paymentStatus !== 'paid' && newR.paymentStatus === 'paid') {
                setPaymentConfirmationToast({
                  period: newR.billingPeriod,
                  amount: newR.paidAmount || calculateCostOf(newR, record.consumerType),
                  remaining: 0,
                  isPartial: false,
                  reference: newR.orNumber || newR.paymentReference || `OR-${Math.floor(100000 + Math.random() * 900000)}`,
                  date: newR.paymentDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                });
              } else if (oldR.paymentStatus === 'unpaid' && newR.paymentStatus === 'partial') {
                const gross = calculateCostOf(newR, record.consumerType);
                const rem = newR.remainingBalance ?? Math.max(0, gross - (newR.paidAmount || 0));
                setPaymentConfirmationToast({
                  period: newR.billingPeriod,
                  amount: newR.paidAmount || 0,
                  remaining: rem,
                  isPartial: true,
                  reference: newR.orNumber || newR.paymentReference || `OR-${Math.floor(100000 + Math.random() * 900000)}`,
                  date: newR.paymentDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                });
              }
            } else if (isIssuedNow && newR.paymentStatus === 'paid') {
              setPaymentConfirmationToast({
                period: newR.billingPeriod,
                amount: newR.paidAmount || calculateCostOf(newR, record.consumerType),
                remaining: 0,
                isPartial: false,
                reference: newR.orNumber || newR.paymentReference || `OR-${Math.floor(100000 + Math.random() * 900000)}`,
                date: newR.paymentDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              });
            }
          });
        } else {
          verifiedReads.forEach(r => {
            if (isOfficialBillIssued(r)) {
              announcedIssuedBillIdsRef.current.add(r.id);
            }
          });
          hasHydratedReadingsOnceRef.current = true;
        }
        
        // Check and generate automated overdue alert notifications & 3-month disconnection notices ONLY for Admin-issued bills!
        const issuedBills = verifiedReads.filter(r => isOfficialBillIssued(r));
        const unpaidList = issuedBills.filter(r => r.paymentStatus !== 'paid');

        // Keep spotlightReading synchronized with live updates (e.g. when Admin clears payment) or auto-spotlight active unpaid bill
        setSpotlightReading(prevSpot => {
          if (prevSpot) {
            const refreshedSpot = verifiedReads.find(v => v.id === prevSpot.id);
            if (refreshedSpot) {
              return JSON.stringify(refreshedSpot) !== JSON.stringify(prevSpot) ? refreshedSpot : prevSpot;
            }
          }
          if (unpaidList.length > 0 && !dismissedSpotlightIdsRef.current.has(unpaidList[0].id)) {
            return unpaidList[0];
          }
          return prevSpot;
        });
        
        // 1. Per-bill overdue alert (only for past Admin-issued unpaid bills)
        issuedBills.forEach(r => {
          if (r.paymentStatus !== 'paid') {
            let dueDateObj: Date;
            if (r.dueDate) {
              dueDateObj = new Date(r.dueDate);
            } else if (r.readingDate) {
              dueDateObj = new Date(r.readingDate);
              dueDateObj.setDate(dueDateObj.getDate() + 15);
            } else {
              dueDateObj = new Date('2026-06-20');
            }

            const isPastDue = new Date() > dueDateObj;
            if (isPastDue && !alertedOverdueRef.current.has(r.id)) {
              const gross = calculateCostOf(r, record.consumerType);
              const paid = r.paidAmount || 0;
              const net = Math.max(0, gross - paid);

              if (net > 0) {
                const existingNotifs = mockDb.getNotifications(record.accountNumber, {
                  userId: record.linkedUserId || currentUser.id,
                  email: record.email || currentUser.email,
                  consumerId: record.id
                });
                const hasAlert = existingNotifs.some(
                  n => (n.readingId === r.id || n.billingPeriod === r.billingPeriod) &&
                       ((n.title || '').toLowerCase().includes('overdue') || (n.title || '').toLowerCase().includes('urgent'))
                );

                if (!hasAlert) {
                  alertedOverdueRef.current.add(r.id);
                  mockDb.addNotification({
                    accountNumber: record.accountNumber,
                    consumerId: record.id,
                    userId: record.linkedUserId || currentUser.id,
                    consumerEmail: record.email || currentUser.email,
                    title: `URGENT: Water Tariff Overdue — ${r.billingPeriod}`,
                    message: `Your water tariff bill of ₱${net.toFixed(2)} for ${r.billingPeriod} (${r.consumption} m³) is past its due date. Standard 10% late surcharge applies. Settle online or upload your office payment receipt to prevent service disruption.`,
                    type: 'billing',
                    readingId: r.id,
                    billingPeriod: r.billingPeriod,
                    remainingBalance: net
                  });
                }
              }
            }
          }
        });

        // 2. Official 3-Month Disconnection & Cutting Notice Check (3+ cycles or 90+ days of past unpaid approved bills)
        const has3MonthsOverdue = unpaidList.length >= 3 || unpaidList.some(r => {
          let d = r.dueDate ? new Date(r.dueDate) : (r.readingDate ? new Date(r.readingDate) : new Date());
          const diff = (new Date().getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
          return diff >= 90 || r.isDisconnectionNoticeIssued;
        });

        if (has3MonthsOverdue && unpaidList.length > 0) {
          const existingNotifs = mockDb.getNotifications(record.accountNumber, {
            userId: record.linkedUserId || currentUser.id,
            email: record.email || currentUser.email,
            consumerId: record.id
          });
          const hasDisconnectionAlert = existingNotifs.some(
            n => n.type === 'disconnection' || (n.title || '').toLowerCase().includes('disconnection') || (n.title || '').toLowerCase().includes('cutting')
          );
          if (!hasDisconnectionAlert) {
            const primaryOverdue = unpaidList[0];
            const gross = calculateCostOf(primaryOverdue, record.consumerType);
            const net = Math.max(0, gross - (primaryOverdue.paidAmount || 0));
            mockDb.addNotification({
              accountNumber: record.accountNumber,
              consumerId: record.id,
              userId: record.linkedUserId || currentUser.id,
              consumerEmail: record.email || currentUser.email,
              title: `CRITICAL: 3-Month Disconnection & Cutting Order Notice`,
              message: `Your water account #${record.accountNumber} has unpaid statements exceeding 3 consecutive months. In accordance with Tagoloan Water District policy, a physical curb-stop disconnection order is pending. Pay at least 50% partial or upload your office receipt immediately to stop cutting.`,
              type: 'disconnection',
              readingId: primaryOverdue.id,
              billingPeriod: primaryOverdue.billingPeriod,
              remainingBalance: net
            });
          }
        }

        // If zero balance, reset alerts
        if (unpaidList.length === 0) {
          alertedOverdueRef.current.clear();
        }

        prevReadingsRef.current = verifiedReads;
        if (JSON.stringify(readingsRef.current) !== JSON.stringify(verifiedReads)) {
          readingsRef.current = verifiedReads;
          setReadings(verifiedReads);
        }
        setAllHistoryReadings(allCustomerReads);

        // Synchronize consumer notifications & concern reports (local + bi-directional backend sync)
        syncConsumerReportsAndNotifications(true);
      } else {
        if (consumerRecordRef.current !== null) {
          consumerRecordRef.current = null;
          setConsumerRecord(null);
        }
        syncConsumerReportsAndNotifications(true);
      }

      const allAnnouncements = mockDb.getAnnouncements();
      if (JSON.stringify(announcementsRef.current) !== JSON.stringify(allAnnouncements)) {
        announcementsRef.current = allAnnouncements;
        setAnnouncements(allAnnouncements);
      }

      // Throttle District Advisories & Tariff Config background REST checks to once per 30s (instant push still via WS/BroadcastChannel)
      const nowMs = Date.now();
      if (!silent || nowMs - lastMetaSyncRef.current >= 30000) {
        lastMetaSyncRef.current = nowMs;
        apiClient.getAnnouncements({ skipLogging: true })
          .then(res => {
            if (res?.announcements && Array.isArray(res.announcements)) {
              const mergedAnns = mockDb.mergeExternalAnnouncements(res.announcements);
              if (JSON.stringify(announcementsRef.current) !== JSON.stringify(mergedAnns)) {
                announcementsRef.current = mergedAnns;
                setAnnouncements(mergedAnns);
              }
            }
          })
          .catch(() => {});

        apiClient.getTariffConfig({ skipLogging: true })
          .then(res => {
            if (res?.config && (res.config.version || 0) > (getActiveTariffConfig().version || 0)) {
              saveActiveTariffConfig(res.config);
              setActiveTariff(res.config);
            }
          })
          .catch(() => {});
      }

      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setIsInitialLoading(false);
      setIsSyncing(false);
    }, silent ? 0 : 40);
  };

  // Initial Load & Real-Time Sync Event Listeners
  useEffect(() => {
    // Clear notifications and active cache on user identity switch to prevent cross-account display
    setNotifications([]);
    notifsRef.current = [];
    setInstallationRequests([]);
    installationsRef.current = [];
    setConsumerRecord(null);
    consumerRecordRef.current = null;
    setReadings([]);
    readingsRef.current = [];
    prevReadingsRef.current = [];
    alertedOverdueRef.current.clear();
    confirmedIssuedAccRef.current = '';
    lastAccountResolveRef.current = 0;
    lastReportsSyncRef.current = 0;

    ensureRealtimeFirestoreListeners();
    loadConsumerInfo();

    // 0. Live Cloud Firestore Push Subscription for instant cross-device ID confirmation (works on Vercel & mobile)
    const cleanupFirestoreIdentity = subscribeToConsumerIdentityInFirestore(
      {
        userId: currentUser.id,
        email: currentUser.email,
        accountNumber: currentUser.linkedAccountNumber,
        name: currentUser.name,
      },
      (resolved) => {
        if (resolved.notifications && resolved.notifications.length > 0) {
          mockDb.mergeExternalNotifications(resolved.notifications);
        }
        if (resolved.isIssued && resolved.consumer && isConsumerRecordIssued(resolved.consumer)) {
          const prevAcc = (consumerRecordRef.current?.accountNumber || '').trim().toUpperCase();
          const nextAcc = resolved.consumer.accountNumber.trim().toUpperCase();
          const wasUnissued = !isConsumerRecordIssued(consumerRecordRef.current);
          const isAccChanged = Boolean(prevAcc && prevAcc !== nextAcc);
          const issuanceNotif = resolved.notifications?.find(
            (n) =>
              n.type === 'account_issue' &&
              !(n.title || '').toLowerCase().includes('registration application submitted')
          );
          if (wasUnissued || isAccChanged) {
            applyAutomaticIdConfirmation(resolved.consumer, issuanceNotif, isAccChanged, true);
          } else {
            loadConsumerInfo(true);
          }
        }
      }
    );

    // 1. Instantaneous reactive sync with minimal 40ms debounce (ignores notification-only writes to prevent feedback loops)
    const handleDbUpdate = (e: Event) => {
      const changedKey = (e as CustomEvent)?.detail?.key as string | undefined;
      if (changedKey === 'twd_live_v4_audit') return;
      const freshNotifs = getConsumerNotificationsFromLocal();
      if (JSON.stringify(notifsRef.current) !== JSON.stringify(freshNotifs)) {
        notifsRef.current = freshNotifs;
        setNotifications(freshNotifs);
      }
      if (changedKey === 'twd_live_v4_notifications') {
        return;
      }
      setReports(getConsumerReportsFromLocal());
      if (debounceDbUpdateRef.current) clearTimeout(debounceDbUpdateRef.current);
      debounceDbUpdateRef.current = setTimeout(() => {
        loadConsumerInfo(true);
      }, 40);
    };
    window.addEventListener('twd_database_updated', handleDbUpdate);

    // 2. Cross-tab synchronization when Admin modifies data in another browser tab
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === 'twd_live_v4_audit' ||
        (e.key === 'twd_sync_ping' && (e.newValue || '').endsWith('_twd_live_v4_audit'))
      ) {
        return;
      }
      if (
        e.key === 'twd_live_v4_notifications' ||
        (e.key === 'twd_sync_ping' && (e.newValue || '').endsWith('_twd_live_v4_notifications'))
      ) {
        const freshNotifs = getConsumerNotificationsFromLocal();
        if (JSON.stringify(notifsRef.current) !== JSON.stringify(freshNotifs)) {
          notifsRef.current = freshNotifs;
          setNotifications(freshNotifs);
        }
        return;
      }
      if (e.key?.startsWith('twd_') || e.key === 'twd_sync_ping') {
        setReports(getConsumerReportsFromLocal());
        const freshNotifs = getConsumerNotificationsFromLocal();
        if (JSON.stringify(notifsRef.current) !== JSON.stringify(freshNotifs)) {
          notifsRef.current = freshNotifs;
          setNotifications(freshNotifs);
        }
        if (debounceDbUpdateRef.current) clearTimeout(debounceDbUpdateRef.current);
        debounceDbUpdateRef.current = setTimeout(() => {
          loadConsumerInfo(true);
        }, 40);
      }
    };
    window.addEventListener('storage', handleStorage);

    // 3. Tariff rate update listener for instant price hike propagation
    const handleTariffUpdated = () => {
      setActiveTariff(getActiveTariffConfig());
      loadConsumerInfo(true);
    };
    window.addEventListener('twd_tariff_updated', handleTariffUpdated);

    // 4. Dedicated Live WebSocket + BroadcastChannel Stream for 0ms ID confirmation, bill issuance, payment clearance & report replies
    const cleanupWs = initRealtimeSocket((data) => {
      if (
        data.type === 'CONSUMER_IDS_ISSUED' ||
        data.type === 'CONSUMER_ACTIVATED_FOR_READER' ||
        data.type === 'CONSUMER_UPDATED'
      ) {
        const payload = data.payload;
        if (doesPayloadBelongToCurrentUser(payload)) {
          const incomingConsumer = payload?.consumer;
          if (incomingConsumer && isConsumerRecordIssued(incomingConsumer)) {
            applyAutomaticIdConfirmation(
              incomingConsumer,
              payload?.notification,
              Boolean(payload?.isUpdate),
              true
            );
            return;
          }
        }
        loadConsumerInfo(true);
      } else if (data.type === 'CONSUMER_NOTIFICATION_CREATED') {
        const notif = data.payload?.notification;
        if (notif && doesPayloadBelongToCurrentUser(notif)) {
          const alreadyHad = notifsRef.current.some(existing => existing.id === notif.id);
          mockDb.mergeExternalNotifications([notif]);
          const refreshedNotifs = getConsumerNotificationsFromLocal();
          if (JSON.stringify(notifsRef.current) !== JSON.stringify(refreshedNotifs)) {
            notifsRef.current = refreshedNotifs;
            setNotifications(refreshedNotifs);
          }
          if (!alreadyHad && inferNotificationType(notif) === 'meter_status') {
            const statusNorm = normalizeMeterStatus(notif.meterStatus);
            const statusText = formatMeterStatusLabel(statusNorm);
            if (statusNorm === 'active') {
              toast.success(
                'Water Meter Status Update',
                `Your water meter status has been updated to ${statusText}. Check your Notification Center for details.`
              );
            } else {
              toast.warning(
                'Important Notice Regarding Your Water Meter',
                `Your water meter status has been marked as ${statusText}. Open your Notification Center for full details.`
              );
            }
          } else if (!alreadyHad && inferNotificationType(notif) === 'installation') {
            toast.info(
              notif.title || 'Water Meter Installation Update',
              'A new update on your water meter installation request is available in your Notification Center.'
            );
          }
        }
      } else if (
        data.type === 'INSTALLATION_REQUEST_UPDATED' ||
        data.type === 'INSTALLATION_REQUEST_SUBMITTED'
      ) {
        const payload = data.payload;
        const incomingReq = payload?.request as WaterMeterInstallationRequest | undefined;
        if (incomingReq) {
          mockDb.mergeExternalInstallations([incomingReq]);
        }
        const belongsToMe =
          doesPayloadBelongToCurrentUser(payload) ||
          (incomingReq && doesPayloadBelongToCurrentUser(incomingReq)) ||
          (payload?.notification && doesPayloadBelongToCurrentUser(payload.notification));
        if (payload?.notification && belongsToMe) {
          mockDb.mergeExternalNotifications([payload.notification]);
        }
        if (belongsToMe) {
          const refreshedInst = filterInstallationRequestsForConsumer(
            consumerRecordRef.current,
            mockDb.getInstallationRequests(),
            currentUser.email,
            currentUser.id
          );
          installationsRef.current = refreshedInst;
          setInstallationRequests(refreshedInst);
          const refreshedNotifs = getConsumerNotificationsFromLocal();
          notifsRef.current = refreshedNotifs;
          setNotifications(refreshedNotifs);

          if (data.type === 'INSTALLATION_REQUEST_UPDATED' && incomingReq) {
            if (payload?.consumer && isConsumerRecordIssued(payload.consumer)) {
              applyAutomaticIdConfirmation(payload.consumer, payload?.notification, false, true);
              return;
            }
            toast.info(
              `Installation Update — ${incomingReq.status}`,
              incomingReq.status === 'Installed'
                ? `Physical installation for ${incomingReq.applicationNumber} is completed and awaiting administrative validation.`
                : `Application ${incomingReq.applicationNumber} status updated to ${incomingReq.status}.`
            );
          }
        }
        loadConsumerInfo(true);
      } else if (data.type === 'METER_STATUS_UPDATED') {
        const payload = data.payload;
        const notif = payload?.notification;
        const belongsToMe =
          doesPayloadBelongToCurrentUser(payload) ||
          (notif && doesPayloadBelongToCurrentUser(notif));
        if (belongsToMe && notif) {
          const alreadyHad = notifsRef.current.some(existing => existing.id === notif.id);
          mockDb.mergeExternalNotifications([notif]);
          const refreshedNotifs = getConsumerNotificationsFromLocal();
          if (JSON.stringify(notifsRef.current) !== JSON.stringify(refreshedNotifs)) {
            notifsRef.current = refreshedNotifs;
            setNotifications(refreshedNotifs);
          }
          if (!alreadyHad) {
            const statusNorm = normalizeMeterStatus(notif.meterStatus || payload?.newStatus);
            const statusText = formatMeterStatusLabel(statusNorm);
            if (statusNorm === 'active') {
              toast.success(
                'Water Meter Status Update',
                `Your water meter status has been updated to ${statusText}. Check your Notification Center for details.`
              );
            } else {
              toast.warning(
                'Important Notice Regarding Your Water Meter',
                `Your water meter status has been marked as ${statusText}. Open your Notification Center for full details.`
              );
            }
          }
        }
      } else if (
        data.type === 'CONSUMER_REPORT_REPLY' ||
        data.type === 'ADMIN_REPLIED_TO_REPORT' ||
        data.type === 'consumer:report:replied'
      ) {
        const payload = data.payload;
        const belongsToMe =
          doesPayloadBelongToCurrentUser(payload) ||
          doesPayloadBelongToCurrentUser(payload?.report) ||
          doesPayloadBelongToCurrentUser(payload?.notification);
        if (payload?.report) {
          mockDb.mergeExternalReports([payload.report]);
        }
        if (payload?.notification && belongsToMe) {
          mockDb.mergeExternalNotifications([payload.notification]);
        }
        if (belongsToMe) {
          setReports(getConsumerReportsFromLocal());
          const refreshedNotifs = getConsumerNotificationsFromLocal();
          notifsRef.current = refreshedNotifs;
          setNotifications(refreshedNotifs);
          toast.info(
            'New Administrative Reply',
            payload?.message || 'The water district desk replied to your report.'
          );
        }
        syncConsumerReportsAndNotifications(true);
      } else if (data.type === 'ANNOUNCEMENT_PUBLISHED') {
        const ann = data.payload?.announcement;
        if (ann && !isTransactionalPaymentOrReceiptItem(ann)) {
          const merged = mockDb.mergeExternalAnnouncements([ann]);
          announcementsRef.current = merged;
          setAnnouncements(merged);
          toast.info('Official District Advisory', ann.title || 'A new water district advisory has been posted.');
        }
        loadConsumerInfo(true);
      } else if (data.type === 'ANNOUNCEMENT_UPDATED' || data.type === 'ANNOUNCEMENT_DELETED') {
        if (data.type === 'ANNOUNCEMENT_DELETED' && data.payload?.id) {
          mockDb.deleteAnnouncement(data.payload.id);
        } else if (data.payload?.announcement) {
          mockDb.mergeExternalAnnouncements([data.payload.announcement]);
        }
        loadConsumerInfo(true);
      } else if (data.type === 'tariff:updated') {
        if (data.payload?.config) {
          saveActiveTariffConfig(data.payload.config);
        }
        setActiveTariff(getActiveTariffConfig());
        loadConsumerInfo(true);
      } else if (
        data.type === 'CONSUMER_REPORT_UPDATED' ||
        data.type === 'REPORT_STATUS_CHANGED' ||
        data.type === 'CONSUMER_REPORT_CREATED' ||
        data.type === 'consumer:report:created' ||
        data.type === 'CONSUMER_REPLIED_TO_REPORT'
      ) {
        if (data.payload?.report) {
          mockDb.mergeExternalReports([data.payload.report]);
          setReports(getConsumerReportsFromLocal());
        }
        syncConsumerReportsAndNotifications(true);
      } else if (
        data.type === 'READING_APPROVED_BILL_ISSUED' ||
        data.type === 'bill:issued' ||
        data.type === 'BILLING_ISSUED'
      ) {
        const payload = data.payload;
        const incomingBills = Array.isArray(payload?.readings)
          ? payload.readings
          : payload?.reading
            ? [payload.reading]
            : [];
        if (incomingBills.length > 0) {
          mockDb.mergeExternalReadings(incomingBills);
        }
        const belongsToMe =
          doesPayloadBelongToCurrentUser(payload) ||
          incomingBills.some((b: any) => doesPayloadBelongToCurrentUser(b));
        if (payload?.notification && belongsToMe) {
          mockDb.mergeExternalNotifications([payload.notification]);
          const refreshedNotifs = getConsumerNotificationsFromLocal();
          notifsRef.current = refreshedNotifs;
          setNotifications(refreshedNotifs);
        }
        if (belongsToMe && incomingBills[0]) {
          const bill = incomingBills[0] as MeterReading;
          announcedIssuedBillIdsRef.current.add(bill.id);
          dismissedSpotlightIdsRef.current.delete(bill.id);
          setSpotlightReading(bill);
          toast.info(
            `Water Bill Issued — ${bill.billingPeriod}`,
            `Meter reading: ${bill.consumption} m³ (Index: ${bill.currentReading}). Total Due: ₱${calculateCostOf(bill, consumerRecordRef.current?.consumerType).toFixed(2)}.`,
            6500
          );
        }
        loadConsumerInfo(true);
      } else if (
        data.type === 'PAYMENT_RECORDED' ||
        data.type === 'payment:recorded'
      ) {
        const payload = data.payload;
        const incomingPaid = Array.isArray(payload?.readings)
          ? payload.readings
          : payload?.reading
            ? [payload.reading]
            : [];
        if (incomingPaid.length > 0) {
          mockDb.mergeExternalReadings(incomingPaid);
        }
        const belongsToMe =
          doesPayloadBelongToCurrentUser(payload) ||
          incomingPaid.some((b: any) => doesPayloadBelongToCurrentUser(b));
        if (payload?.notification && belongsToMe) {
          mockDb.mergeExternalNotifications([payload.notification]);
          const refreshedNotifs = getConsumerNotificationsFromLocal();
          notifsRef.current = refreshedNotifs;
          setNotifications(refreshedNotifs);
        }
        if (belongsToMe) {
          const primaryBill = incomingPaid[0] as MeterReading | undefined;
          if (primaryBill) {
            announcedIssuedBillIdsRef.current.add(primaryBill.id);
          }
          const isPartial = primaryBill ? primaryBill.paymentStatus === 'partial' : (payload?.remainingBalance || 0) > 0;
          setPaymentConfirmationToast({
            period: primaryBill?.billingPeriod || payload?.billingPeriod || 'Water Bill',
            amount: payload?.amountPaid || primaryBill?.paidAmount || 0,
            remaining: payload?.remainingBalance ?? primaryBill?.remainingBalance ?? 0,
            isPartial,
            reference: payload?.orNumber || primaryBill?.orNumber || 'OR-ISSUED',
            date: payload?.paymentDate || primaryBill?.paymentDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          });
        }
        loadConsumerInfo(true);
      }
    });

    // 5a. Fast 2-second lightweight live sync for Reports, Replies, Billings & Notifications
    const reportSyncInterval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        syncConsumerReportsAndNotifications(true);
      }
    }, 2000);

    // 5b. Full consumer account & billing sync every 5 seconds
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        loadConsumerInfo(true);
      }
    }, 5000);

    const handleVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        syncConsumerReportsAndNotifications(true);
        loadConsumerInfo(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('twd_database_updated', handleDbUpdate);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('twd_tariff_updated', handleTariffUpdated);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(reportSyncInterval);
      clearInterval(interval);
      cleanupFirestoreIdentity();
      cleanupWs();
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (debounceDbUpdateRef.current) clearTimeout(debounceDbUpdateRef.current);
    };
  }, [currentUser?.id, currentUser?.email]);

  // Populate profile edit fields when record is loaded or updated by admin
  useEffect(() => {
    if (consumerRecord) {
      setEditName(consumerRecord.name);
      setEditContact(consumerRecord.contactNumber || '');
      setEditEmail(consumerRecord.email || '');
      setEditAddress(consumerRecord.address || '');
      setEditSitioZone(consumerRecord.sitioZone || '');
      setEditHouseholdInfo(consumerRecord.householdInfo || '');
      setEditBusinessName(consumerRecord.businessName || '');
      setEditBusinessType(consumerRecord.businessType || '');
    }
  }, [consumerRecord]);

  // Check Account Setup Pending Status (Awaiting Admin Account & Meter Issuance)
  const isAccountPending = !isConsumerRecordIssued(consumerRecord) && !isRealIssuedAccountNumber(currentUser.linkedAccountNumber);

  // Compute Account Metrics & Unbreakable Reading Basis (Previous -> Present -> Current)
  // These 3 reading indices are NEVER absent on an active consumer account:
  // - Previous Reading: baseline index from the prior cycle (never lost when new readings arrive)
  // - Present Reading: dial index recorded by the meter reader at inspection
  // - Current Reading: latest tracked dial index & net consumption (Present - Previous)
  const latestRead = (readings && readings.length > 0) ? readings[0] : null;
  const pendingInspectionRead = (allHistoryReadings || []).find(
    r => r.status === 'pending' || r.status === 'flagged_abnormal'
  ) || null;

  const prevReadingVal = latestRead
    ? Math.max(0, Number(latestRead.previousReading ?? 0))
    : Math.max(0, Number(consumerRecord?.previousReading ?? 0));
  const presReadingVal = latestRead
    ? Math.max(prevReadingVal, Number(latestRead.presentReading ?? latestRead.currentReading ?? prevReadingVal))
    : Math.max(prevReadingVal, Number(consumerRecord?.presentReading ?? consumerRecord?.currentReading ?? prevReadingVal));
  const currReadingVal = latestRead
    ? Math.max(presReadingVal, Number(latestRead.currentReading ?? presReadingVal))
    : Math.max(presReadingVal, Number(consumerRecord?.currentReading ?? presReadingVal));
  const currentConsumptionVal = latestRead
    ? Math.max(0, Number(latestRead.consumption ?? (presReadingVal - prevReadingVal)))
    : Math.max(0, Number(consumerRecord?.lastConsumption ?? (presReadingVal - prevReadingVal)));

  // Official Billings issued by Administration
  const billedReadings = readings.filter(r => isOfficialBillIssued(r));
  const latestBill = billedReadings.length > 0 ? billedReadings[0] : null;

  // If no billing has been issued by Administration yet (or account is pending), current bill is 0.00
  const currentBillAmount = (consumerRecord && latestBill && !isAccountPending)
    ? (latestBill.paymentStatus === 'paid' ? 0 : Math.max(0, calculateCostOf(latestBill, consumerRecord.consumerType) - (latestBill.paidAmount || 0)))
    : 0;
  
  // Unpaid, Paid, and Partial Admin-issued bills
  const unpaidBills = billedReadings.filter(r => r.paymentStatus !== 'paid');
  const paidBills = billedReadings.filter(r => r.paymentStatus === 'paid');
  const partialBills = billedReadings.filter(r => r.paymentStatus === 'partial');
  const unpaidFullBills = billedReadings.filter(r => r.paymentStatus === 'unpaid' || !r.paymentStatus);

  // Helper to determine overdue status (only on Admin-issued billings)
  const isReadingOverdue = (reading: MeterReading) => {
    if (!isOfficialBillIssued(reading)) return false;
    if (reading.paymentStatus === 'paid') return false;
    let dueDateObj: Date;
    if (reading.dueDate) {
      dueDateObj = new Date(reading.dueDate);
    } else if (reading.readingDate) {
      dueDateObj = new Date(reading.readingDate);
      dueDateObj.setDate(dueDateObj.getDate() + 15);
    } else {
      return false;
    }
    if (Number.isNaN(dueDateObj.getTime())) return false;
    return new Date() > dueDateObj;
  };

  const overdueBills = billedReadings.filter(r => isReadingOverdue(r));
  
  // Dynamic accurate outstanding sum across Admin-issued billings only
  const outstandingSum = unpaidBills.reduce((acc, b) => {
    const total = calculateCostOf(b, consumerRecord?.consumerType);
    const paid = b.paidAmount || 0;
    return acc + Math.max(0, total - paid);
  }, 0);

  const partialBalanceSum = partialBills.reduce((acc, b) => {
    const total = calculateCostOf(b, consumerRecord?.consumerType);
    const paid = b.paidAmount || 0;
    return acc + Math.max(0, total - paid);
  }, 0);

  // Trend vs Previous Month & Problem / Leak Detection
  const previousMonthRead = readings[1] || null;
  const consumptionDiff = previousMonthRead ? currentConsumptionVal - previousMonthRead.consumption : 0;
  const consumptionPercentChange = previousMonthRead && previousMonthRead.consumption > 0
    ? ((consumptionDiff / previousMonthRead.consumption) * 100).toFixed(1)
    : null;

  const isAbnormalSpike = Boolean(
    latestRead && (
      latestRead.status === 'flagged_abnormal' ||
      currentConsumptionVal >= 45 ||
      (previousMonthRead && previousMonthRead.consumption >= 5 && consumptionDiff >= 12 && (consumptionDiff / previousMonthRead.consumption) >= 0.4)
    )
  );

  // Chart Data preparation (chronological order)
  const chartReadings = [...readings].reverse().slice(-6); // last 6 verified readings in chronological order
  const chartBillings = [...billedReadings].reverse().slice(-6); // last 6 Admin-issued billings in chronological order

  // Unread notification count
  const unreadNotifCount = notifications.filter(n => !n.read).length;
  // Unread admin reply count on filed reports
  const unreadReportsCount = reports.filter(r => r.hasUnreadAdminReply).length;

  // Helper: Resolve an exact linked MeterReading for billing/payment/disconnection notifications
  const resolveNotificationLinkedReading = (notif?: ConsumerNotification | null): MeterReading | undefined => {
    if (!notif) return undefined;
    const effType = inferNotificationType(notif);
    if (effType === 'announcement' || effType === 'account_issue' || effType === 'installation' || effType === 'report' || isReportNotification(notif)) {
      return undefined;
    }
    const candidateBills = readings.filter(r => isOfficialBillIssued(r));
    if (notif.readingId) {
      const byId = candidateBills.find(r => r.id === notif.readingId) || readings.find(r => r.id === notif.readingId);
      if (byId) return byId;
    }
    if (notif.orNumber) {
      const targetOr = notif.orNumber.trim().toLowerCase();
      const byOr = candidateBills.find(
        r => (r.orNumber || r.paymentReference || '').trim().toLowerCase() === targetOr
      );
      if (byOr) return byOr;
    }
    if (notif.billingPeriod) {
      const targetBp = notif.billingPeriod.trim().toLowerCase();
      const byBp = candidateBills.find(r => (r.billingPeriod || '').trim().toLowerCase() === targetBp);
      if (byBp) return byBp;
    }
    const nTitle = (notif.title || '').toLowerCase();
    const nMsg = (notif.message || '').toLowerCase();
    return candidateBills.find(r => {
      const bp = (r.billingPeriod || '').trim().toLowerCase();
      return bp ? nTitle.includes(bp) || nMsg.includes(bp) : false;
    });
  };

  // Action: Open Notification Detail Pop-Up Modal (marks notification as read and closes bell popover)
  const handleOpenNotificationDetailModal = (notif: ConsumerNotification) => {
    if (!notif.read && notif.id && !notif.id.startsWith('ADVISORY-PREVIEW-')) {
      mockDb.markNotificationRead(notif.id);
      const updated = notifications.map(n => (n.id === notif.id ? { ...n, read: true } : n));
      notifsRef.current = updated;
      setNotifications(updated);
    }
    setShowNotifDropdown(false);
    setSelectedBellNotification({ ...notif, read: true });
  };

  // Action: Handle clicking a notification action to route accurately to the requested view (Reports & Inquiries ONLY for report replies)
  const handleNotificationClick = (
    notif: ConsumerNotification,
    targetPreference?: 'dashboard' | 'installation' | 'bills' | 'announcements' | 'profile' | 'reports'
  ) => {
    // 1. Mark as read in storage and state
    if (!notif.read && notif.id && !notif.id.startsWith('ADVISORY-PREVIEW-')) {
      mockDb.markNotificationRead(notif.id);
      const updated = notifications.map(n => (n.id === notif.id ? { ...n, read: true } : n));
      notifsRef.current = updated;
      setNotifications(updated);
    }
    setShowNotifDropdown(false);
    setSelectedBellNotification(null);

    const scrollMainToTop = () => {
      setTimeout(() => {
        mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }, 60);
    };

    // STRICT RULE: Report / Concern Reply notifications MUST ONLY route to Reports & Inquiries (never Dashboard or Profile)
    if (isReportNotification(notif)) {
      const targetReport = resolveNotificationReportTarget(notif);
      if (targetReport) {
        setSelectedReportId(targetReport);
      }
      syncConsumerReportsAndNotifications(true);
      setActiveTab('reports');
      scrollMainToTop();
      return;
    }

    // Determine effective target for non-report notifications
    const effectiveNotifType = inferNotificationType(notif);
    const effectiveTarget: 'dashboard' | 'installation' | 'bills' | 'announcements' | 'profile' | 'reports' =
      targetPreference ||
      (effectiveNotifType === 'installation'
        ? 'installation'
        : effectiveNotifType === 'account_issue'
        ? 'profile'
        : effectiveNotifType === 'announcement'
        ? 'announcements'
        : effectiveNotifType === 'billing' || effectiveNotifType === 'balance'
        ? 'bills'
        : 'dashboard');

    if (effectiveTarget === 'installation') {
      setActiveTab('installation');
      scrollMainToTop();
      return;
    }

    if (effectiveTarget === 'profile') {
      setActiveTab('profile');
      scrollMainToTop();
      return;
    }

    if (effectiveTarget === 'announcements') {
      setActiveTab('notifications');
      setNotifFilter('announcement');
      scrollMainToTop();
      return;
    }

    if (effectiveTarget === 'reports') {
      const targetReport = resolveNotificationReportTarget(notif);
      if (targetReport) {
        setSelectedReportId(targetReport);
      }
      setActiveTab('reports');
      scrollMainToTop();
      return;
    }

    // Resolve matching Admin-billed reading for Dashboard or Bills navigation
    const candidateBills = readings.filter(r => isOfficialBillIssued(r));
    let matchedReading: MeterReading | undefined;
    if (notif.readingId) {
      matchedReading = candidateBills.find(r => r.id === notif.readingId);
    }
    if (!matchedReading && notif.billingPeriod) {
      matchedReading = candidateBills.find(r => (r.billingPeriod || '').toLowerCase() === (notif.billingPeriod || '').toLowerCase());
    }
    if (!matchedReading) {
      const nTitle = (notif.title || '').toLowerCase();
      const nMsg = (notif.message || '').toLowerCase();
      matchedReading = candidateBills.find(r => {
        const bp = (r.billingPeriod || '').toLowerCase();
        return bp ? (nTitle.includes(bp) || nMsg.includes(bp)) : false;
      });
    }
    if (!matchedReading && candidateBills.length > 0 && effectiveNotifType !== 'account_issue') {
      matchedReading = candidateBills[0];
    }

    if (matchedReading) {
      setSpotlightReading(matchedReading);
      setHighlightedReadingId(matchedReading.id);
    }

    // If clicked directly without explicit tab override and it's a paid receipt notification, open receipt modal
    if (!targetPreference && effectiveNotifType === 'payment' && matchedReading && matchedReading.paymentStatus === 'paid') {
      setReceiptDetailModal(matchedReading);
      return;
    }

    if (effectiveTarget === 'bills') {
      setActiveTab('bills');
      if (matchedReading) {
        if (matchedReading.paymentStatus === 'paid') {
          setBillFilter('paid');
        } else if (matchedReading.paymentStatus === 'partial') {
          setBillFilter('partial');
        } else {
          setBillFilter('unpaid');
        }
      }
      scrollMainToTop();
    } else {
      setActiveTab('dashboard');
      scrollMainToTop();
    }
  };

  const handleMarkAllNotifsRead = () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    mockDb.markAllNotificationsRead(unreadIds);
    const updatedNotifs = notifications.map(n => ({ ...n, read: true }));
    notifsRef.current = updatedNotifs;
    setNotifications(updatedNotifs);
    toast.success('Notifications Updated', 'All notifications have been marked as read.');
  };

  // Direct One-Click PDF Download Handler for My Usage
  const handleDirectDownloadUsagePdf = async () => {
    if (!consumerRecord || isDownloadingUsagePdf) return;
    setIsDownloadingUsagePdf(true);
    try {
      await downloadConsumerUsageReportPdf({
        consumer: consumerRecord,
        allHistoryReadings,
      });
      toast.success(
        'Usage Report Downloaded',
        `Downloaded Monthly Water Usage & Efficiency Report PDF for Account #${consumerRecord.accountNumber || 'Consumer'}.`
      );
    } catch (err) {
      console.error('Direct Usage PDF download error:', err);
      toast.error(
        'PDF Generation Failed',
        'Unable to generate the PDF report directly. Opening interactive report preview instead.'
      );
      setIsUsageReportModalOpen(true);
    } finally {
      setIsDownloadingUsagePdf(false);
    }
  };

  // Cashier Receipt Verification & Payment Trigger
  const handleStartPayment = (reading: MeterReading, _presetMode: 'full' | 'partial' = 'full') => {
    setUploadReceiptReading(reading);
    setIsUploadReceiptOpen(true);
  };

  const handleOpenSimulatedPayment = (
    reading: MeterReading, 
    _mode: 'full' | 'partial' = 'full',
    _tab: 'online' | 'receipt' = 'receipt'
  ) => {
    setUploadReceiptReading(reading);
    setIsUploadReceiptOpen(true);
  };

  // Normalize Philippine mobile number to standard 11-digit 09XXXXXXXXX format
  const normalizePhone11 = (raw?: string | null): string => {
    if (!raw) return '';
    let digits = String(raw).replace(/\D/g, '');
    if (digits.startsWith('63') && digits.length === 12) {
      digits = '0' + digits.slice(2);
    } else if (digits.length === 10 && digits.startsWith('9')) {
      digits = '0' + digits;
    }
    return digits;
  };

  // Validate 11-digit PH mobile number & check duplicates across all consumers, portal users, and field readers
  const validatePhoneInput = (rawPhone: string): { valid: boolean; normalized: string; error: string | null } => {
    const trimmed = (rawPhone || '').trim();
    if (!trimmed) {
      return { valid: false, normalized: '', error: 'Mobile phone number is required.' };
    }
    const normalized = normalizePhone11(trimmed);
    if (!/^09\d{9}$/.test(normalized)) {
      return {
        valid: false,
        normalized,
        error: 'Enter a valid 11-digit Philippine mobile number starting with 09 (e.g. 09171234567).',
      };
    }

    const myAccount = (consumerRecord?.accountNumber || currentUser.linkedAccountNumber || '').trim().toUpperCase();
    const myUserId = (currentUser.id || consumerRecord?.linkedUserId || '').trim();
    const myEmail = (currentUser.email || consumerRecord?.email || '').trim().toLowerCase();

    // 1. Check Consumer records
    const duplicateConsumer = mockDb.getConsumers().find((c) => {
      const cPhone = normalizePhone11(c.contactNumber);
      if (!cPhone || cPhone !== normalized) return false;
      const cAcc = (c.accountNumber || '').trim().toUpperCase();
      const cUid = (c.linkedUserId || '').trim();
      const cEmail = (c.email || '').trim().toLowerCase();
      const isSelf =
        (myAccount && cAcc && myAccount === cAcc) ||
        (myUserId && cUid && myUserId === cUid) ||
        (myEmail && cEmail && myEmail === cEmail);
      return !isSelf;
    });
    if (duplicateConsumer) {
      return {
        valid: false,
        normalized,
        error: `Mobile number ${normalized} is already registered to another account. Duplicate phone numbers are not allowed.`,
      };
    }

    // 2. Check Portal User records
    const duplicateUser = mockDb.getUsers().find((u) => {
      const uPhone = normalizePhone11(u.contactNumber);
      if (!uPhone || uPhone !== normalized) return false;
      const uId = (u.id || '').trim();
      const uAcc = (u.linkedAccountNumber || '').trim().toUpperCase();
      const uEmail = (u.email || '').trim().toLowerCase();
      const isSelf =
        (myUserId && uId && myUserId === uId) ||
        (myAccount && uAcc && myAccount === uAcc) ||
        (myEmail && uEmail && myEmail === uEmail);
      return !isSelf;
    });
    if (duplicateUser) {
      return {
        valid: false,
        normalized,
        error: `Mobile number ${normalized} is already linked to another user account. Duplicate phone numbers are not allowed.`,
      };
    }

    // 3. Check Field Reader / Staff records
    const duplicateReader = mockDb.getReaders().find((r) => {
      const rPhone = normalizePhone11(r.contactNumber);
      if (!rPhone || rPhone !== normalized) return false;
      const rId = (r.id || '').trim();
      const rEmail = (r.email || '').trim().toLowerCase();
      const isSelf = (myUserId && rId && myUserId === rId) || (myEmail && rEmail && myEmail === rEmail);
      return !isSelf;
    });
    if (duplicateReader) {
      return {
        valid: false,
        normalized,
        error: `Mobile number ${normalized} is already registered to a district staff account. Duplicate phone numbers are not allowed.`,
      };
    }

    return { valid: true, normalized, error: null };
  };

  // Profile Update Handler (with strict duplicate phone validation + Firestore & Backend persistence)
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consumerRecord || isSavingProfile) return;

    const newName = editName.trim() || consumerRecord.name;
    const newEmail = (editEmail.trim() || consumerRecord.email || '').toLowerCase();

    // 1. Validate Phone Number & Reject Duplicates
    const phoneCheck = validatePhoneInput(editContact);
    if (!phoneCheck.valid) {
      setPhoneValidationError(phoneCheck.error);
      setStatusMsg({ type: 'err', msg: phoneCheck.error || 'Invalid or duplicate phone number.' });
      toast.error('Phone Validation Failed', phoneCheck.error || 'Duplicate or invalid phone number.');
      return;
    }
    setPhoneValidationError(null);
    const normalizedPhone = phoneCheck.normalized;

    // 2. Check Duplicate Email across other users/consumers
    const myAccount = (consumerRecord.accountNumber || currentUser.linkedAccountNumber || '').trim().toUpperCase();
    const myUserId = (currentUser.id || consumerRecord.linkedUserId || '').trim();
    const prevEmail = (consumerRecord.email || currentUser.email || '').trim().toLowerCase();

    if (newEmail) {
      const emailTakenByUser = mockDb.getUsers().find((u) => {
        const uEmail = (u.email || '').trim().toLowerCase();
        if (!uEmail || uEmail !== newEmail) return false;
        const isSelf =
          (myUserId && u.id === myUserId) ||
          (myAccount && (u.linkedAccountNumber || '').trim().toUpperCase() === myAccount) ||
          (prevEmail && uEmail === prevEmail);
        return !isSelf;
      });
      if (emailTakenByUser) {
        const errText = `Email address ${newEmail} is already registered to another account.`;
        setStatusMsg({ type: 'err', msg: errText });
        toast.error('Duplicate Email Detected', errText);
        return;
      }
    }

    setIsSavingProfile(true);
    try {
      const updatedFields: Partial<Consumer> = {
        name: newName,
        contactNumber: normalizedPhone,
        email: newEmail,
        address: editAddress.trim() || consumerRecord.address,
        sitioZone: editSitioZone.trim() || consumerRecord.sitioZone,
        householdInfo: editHouseholdInfo.trim() || consumerRecord.householdInfo,
        businessName: editBusinessName.trim() || consumerRecord.businessName,
        businessType: editBusinessType.trim() || consumerRecord.businessType,
      };

      // 3. Validate & Persist on Backend Server first (checks global cross-device phone duplicates)
      const identifier =
        consumerRecord.accountNumber ||
        consumerRecord.linkedUserId ||
        currentUser.id ||
        consumerRecord.email ||
        newEmail;
      if (identifier) {
        const res = await safeBackendFetch(`/api/consumers/${encodeURIComponent(identifier)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...updatedFields,
            linkedUserId: currentUser.id || consumerRecord.linkedUserId,
          }),
        });
        if (res && !res.ok && (res.status === 409 || res.status === 400)) {
          let serverErr = 'Phone number is already taken by another registered account.';
          try {
            const payload = await res.json();
            if (payload?.error) serverErr = payload.error;
          } catch {}
          setPhoneValidationError(serverErr);
          setStatusMsg({ type: 'err', msg: serverErr });
          toast.error('Update Rejected', serverErr);
          setIsSavingProfile(false);
          return;
        }
      }

      // 4. Update Consumer Record in local store & Firestore
      let updatedConsumerObj: Consumer = { ...consumerRecord, ...updatedFields };
      const allConsumers = mockDb.getConsumers();
      let consumerMatched = false;
      const updatedConsumers = allConsumers.map((c) => {
        const isTarget =
          (myAccount && (c.accountNumber || '').trim().toUpperCase() === myAccount) ||
          (myUserId && c.linkedUserId && c.linkedUserId === myUserId) ||
          (prevEmail && c.email && c.email.trim().toLowerCase() === prevEmail);
        if (isTarget) {
          consumerMatched = true;
          updatedConsumerObj = { ...c, ...updatedFields };
          return updatedConsumerObj;
        }
        return c;
      });
      if (!consumerMatched) {
        updatedConsumers.unshift(updatedConsumerObj);
      }
      mockDb.saveConsumers(updatedConsumers);
      setEditContact(normalizedPhone);
      setConsumerRecord(updatedConsumerObj);
      consumerRecordRef.current = updatedConsumerObj;

      const consumerDocId =
        updatedConsumerObj.accountNumber ||
        updatedConsumerObj.linkedUserId ||
        currentUser.id ||
        updatedConsumerObj.email;
      if (consumerDocId) {
        syncDocToFirestore(COLLECTIONS.CONSUMERS, consumerDocId, updatedConsumerObj, true);
      }

      // 5. Synchronize matching Portal User record & Firestore
      let syncedUserObj: UserType | null = null;
      const allUsers = mockDb.getUsers().map((u) => {
        const isMe =
          (myUserId && u.id === myUserId) ||
          (myAccount && (u.linkedAccountNumber || '').trim().toUpperCase() === myAccount) ||
          (prevEmail && u.email && u.email.trim().toLowerCase() === prevEmail);
        if (isMe) {
          const nextU: UserType = { ...u, name: newName, email: newEmail, contactNumber: normalizedPhone };
          syncedUserObj = nextU;
          return nextU;
        }
        return u;
      });
      mockDb.saveUsers(allUsers);

      if (syncedUserObj) {
        const uObj = syncedUserObj as UserType;
        syncDocToFirestore(COLLECTIONS.USERS, uObj.id || uObj.email || currentUser.id, uObj, true);
      }

      // 6. Synchronize meter readings under this account if issued
      if (myAccount && !myAccount.startsWith('PENDING')) {
        const allReadings = mockDb.getReadings().map((r) =>
          (r.accountNumber || '').trim().toUpperCase() === myAccount
            ? { ...r, consumerName: newName }
            : r
        );
        mockDb.saveReadings(allReadings);
      }

      // 7. Synchronize active session user
      const latestSession = mockDb.getCurrentUser() || currentUser;
      const updatedCurrentUser: UserType = {
        ...latestSession,
        name: newName,
        email: newEmail,
        contactNumber: normalizedPhone,
      };
      mockDb.setCurrentUser(updatedCurrentUser);

      mockDb.addAuditLog(
        currentUser.id,
        newName,
        'consumer',
        'Update Profile Information',
        `Updated personal and contact details (${normalizedPhone}) for consumer account #${consumerRecord.accountNumber || 'PENDING'}.`
      );

      setStatusMsg({ type: 'success', msg: 'Profile and contact information saved successfully!' });
      toast.success('Profile Saved', 'Your personal details and verified mobile number have been updated.');
      loadConsumerInfo(true);
      setTimeout(() => setStatusMsg(null), 4500);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Password Change Handler (validates current password, blocks reusing old/same password, and persists new password everywhere)
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUpdatingPassword) return;
    setPasswordError(null);

    if (!passwordOld || !passwordNew || !passwordConfirm) {
      const msg = 'Please fill in your current password, new password, and confirmation.';
      setPasswordError(msg);
      toast.warning('Incomplete Form', msg);
      return;
    }

    // Locate stored user record to verify current password & prevent reusing previous password
    const myUserId = (currentUser.id || consumerRecord?.linkedUserId || '').trim();
    const myEmail = (currentUser.email || consumerRecord?.email || '').trim().toLowerCase();
    const myAccount = (consumerRecord?.accountNumber || currentUser.linkedAccountNumber || '').trim().toUpperCase();

    const storedUsers = mockDb.getUsers();
    const sessionUserNow = mockDb.getCurrentUser();
    const matchedUser = storedUsers.find(
      (u) =>
        (myUserId && u.id === myUserId) ||
        (myEmail && u.email && u.email.trim().toLowerCase() === myEmail) ||
        (myAccount && !myAccount.startsWith('PENDING') && (u.linkedAccountNumber || '').trim().toUpperCase() === myAccount)
    );

    const activeStoredPassword =
      (matchedUser && (matchedUser.passwordUpdatedAt || 0) >= (sessionUserNow?.passwordUpdatedAt || 0)
        ? matchedUser.password
        : sessionUserNow?.password) ??
      matchedUser?.password ??
      sessionUserNow?.password ??
      currentUser.password;

    // 1. Verify current password matches stored password
    if (activeStoredPassword && passwordOld !== activeStoredPassword) {
      const msg = 'Your current password is incorrect. Please enter your valid existing password.';
      setPasswordError(msg);
      setStatusMsg({ type: 'err', msg });
      toast.error('Incorrect Current Password', msg);
      return;
    }

    // 2. Strictly disallow reusing the same / old password
    if (passwordNew === passwordOld || (activeStoredPassword && passwordNew === activeStoredPassword)) {
      const msg = 'New password cannot be the same as your current or previous password. Please create a new, unique password.';
      setPasswordError(msg);
      setStatusMsg({ type: 'err', msg });
      toast.error('Same Password Not Allowed', msg);
      return;
    }

    // 3. Enforce minimum security length
    if (passwordNew.length < 6) {
      const msg = 'New password must be at least 6 characters long.';
      setPasswordError(msg);
      setStatusMsg({ type: 'err', msg });
      toast.error('Weak Password', msg);
      return;
    }

    // 4. Confirm new password match
    if (passwordNew !== passwordConfirm) {
      const msg = 'New password and confirmation password do not match.';
      setPasswordError(msg);
      setStatusMsg({ type: 'err', msg });
      toast.error('Password Mismatch', msg);
      return;
    }

    const pwUpdatedAt = Date.now();
    setIsUpdatingPassword(true);
    try {
      // 5. Sync password change to Backend API (/api/consumers/change-password)
      const res = await safeBackendFetch('/api/consumers/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: myUserId || undefined,
          email: myEmail || undefined,
          accountNumber: myAccount || undefined,
          currentPassword: passwordOld,
          newPassword: passwordNew,
          passwordUpdatedAt: pwUpdatedAt,
        }),
      });

      if (res && !res.ok && (res.status === 400 || res.status === 401)) {
        let serverErr = 'Unable to update password.';
        try {
          const payload = await res.json();
          if (payload?.error) serverErr = payload.error;
        } catch {}
        setPasswordError(serverErr);
        setStatusMsg({ type: 'err', msg: serverErr });
        toast.error('Password Change Rejected', serverErr);
        setIsUpdatingPassword(false);
        return;
      }

      // 6. Atomically persist updated password in local override authority, all matching User records, active session, and BOTH Firestore user docs (id + email_...)
      mockDb.updateUserPassword(
        {
          userId: myUserId || currentUser.id,
          email: myEmail || currentUser.email,
          accountNumber: myAccount || currentUser.linkedAccountNumber,
        },
        passwordNew,
        pwUpdatedAt
      );

      mockDb.addAuditLog(
        currentUser.id,
        currentUser.name,
        'consumer',
        'Password Rotation',
        `Changed access password for consumer user "${myEmail || currentUser.email}".`
      );

      setPasswordOld('');
      setPasswordNew('');
      setPasswordConfirm('');
      setShowPasswordOld(false);
      setShowPasswordNew(false);
      setShowPasswordConfirm(false);
      setPasswordError(null);
      setStatusMsg({ type: 'success', msg: 'Account password updated and saved! Use your new password on your next sign-in.' });
      toast.success('Password Saved', 'Your new password is now active. Please use your updated password the next time you sign in.');
      setTimeout(() => setStatusMsg(null), 4500);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Initial skeleton view while loading data
  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <ConsumerPortalSkeleton />
      </div>
    );
  }

  // Fallback if no consumer record found after loading
  if (!consumerRecord) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-8 space-y-4 text-white">
        <AlertCircle className="h-12 w-12 text-rose-500 animate-pulse" />
        <h2 className="text-base font-black uppercase tracking-wider">Account Linking Notice</h2>
        <p className="text-xs text-slate-400 text-center max-w-md">
          We could not find an existing water account linked to email <strong>{currentUser.email}</strong>.
          Please contact the Tagoloan Water District administration or sign up through the registration portal.
        </p>
        <button 
          onClick={onLogout} 
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
        >
          Return to Portal Login
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans" id="consumer-portal-container">
      
      {/* Mobile Backdrop */}
      {mobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/70 z-40 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR NAVIGATION - ALWAYS VISIBLE ON DESKTOP & SLIDE-OUT ON MOBILE */}
      <aside 
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 bg-slate-900 text-white flex flex-col border-r border-slate-800 transition-transform duration-300 ease-in-out shrink-0 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        id="consumer-sidebar-nav"
      >
        {/* District Brand Header */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
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
              <h1 className="text-sm font-black text-white tracking-tight leading-tight">
                Tagoloan Water
              </h1>
              <p className="text-[10px] uppercase font-bold tracking-wider text-blue-400">
                Consumer Portal
              </p>
            </div>
          </div>
          <button 
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Consumer Quick Identity Card */}
        <div className="p-4 mx-4 mt-4 bg-slate-800/80 rounded-2xl border border-slate-700/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Connected Account</span>
            {isAccountPending ? (
              <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                <span>
                  {consumerRecord.status === 'installation_not_scheduled'
                    ? 'Schedule Needed'
                    : consumerRecord.status === 'pending_installation' || installationRequests.length > 0
                    ? installationRequests[0]?.status === 'Installed'
                      ? 'Awaiting Validation'
                      : 'Pending Installation'
                    : 'Pending Issuance'}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="h-1 w-1 rounded-full bg-emerald-400 animate-ping"></span>
                <span>Confirmed • {consumerRecord.status === 'active' ? 'Active' : consumerRecord.status}</span>
              </span>
            )}
          </div>
          <div>
            <h4 className="text-xs font-black text-white truncate">{consumerRecord.name}</h4>
            <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono tabular-nums text-[10px]">
              <span className="text-blue-300 bg-blue-950/60 px-1.5 py-0.2 rounded border border-blue-800/50">
                {isAccountPending
                  ? consumerRecord.applicationNumber || installationRequests[0]?.applicationNumber
                    ? `${consumerRecord.applicationNumber || installationRequests[0]?.applicationNumber}`
                    : 'Acc #PENDING'
                  : `Acc #${consumerRecord.accountNumber}`}
              </span>
              <span className="text-slate-300 bg-slate-700/60 px-1.5 py-0.2 rounded">
                Tag #{isAccountPending ? 'PENDING' : (consumerRecord.meterNumber || 'ISSUED')}
              </span>
            </div>
          </div>
        </div>

        {/* Visible Modules Navigation Section */}
        <div className="flex-1 px-4 py-5 overflow-y-auto space-y-6">
          <div className="space-y-1.5">
            <span className="px-3 text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              PORTAL MODULES
            </span>

            {/* Module 1: Dashboard */}
            <button
              onClick={() => handleConsumerTabChange('dashboard')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-dashboard"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'dashboard' ? 'bg-white/20' : 'bg-slate-800 text-blue-400 group-hover:text-blue-300'}`}>
                  <Activity className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">Dashboard</div>
                  <div className={`text-[10px] truncate ${activeTab === 'dashboard' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Overview & real-time stats
                  </div>
                </div>
              </div>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${activeTab === 'dashboard' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
            </button>

            {/* Module: Water Meter Installation (shown when pending/unscheduled or has installation history) */}
            {(isAccountPending || consumerRecord.hasExistingMeter === false || installationRequests.length > 0) && (
              <button
                onClick={() => handleConsumerTabChange('installation')}
                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                  activeTab === 'installation'
                    ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
                id="sidebar-mod-installation"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className={`p-1.5 rounded-lg ${activeTab === 'installation' ? 'bg-white/20' : 'bg-slate-800 text-cyan-400 group-hover:text-cyan-300'}`}>
                    <Wrench className="h-4 w-4" />
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-bold leading-tight">Meter Installation</div>
                    <div className={`text-[10px] truncate ${activeTab === 'installation' ? 'text-blue-100' : 'text-slate-400'}`}>
                      Schedule & activation tracker
                    </div>
                  </div>
                </div>
                {isAccountPending ? (
                  <span className="px-2 py-0.5 bg-amber-400 text-slate-950 text-[9px] font-black rounded-md whitespace-nowrap shrink-0">
                    {installationRequests[0] && installationRequests[0].status !== 'Cancelled'
                      ? installationRequests[0].status === 'Installed'
                        ? 'Validate'
                        : 'Tracked'
                      : 'Schedule'}
                  </span>
                ) : (
                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'installation' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
                )}
              </button>
            )}

            {/* Module 2: My Bills */}
            <button
              onClick={() => handleConsumerTabChange('bills')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'bills'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-bills"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'bills' ? 'bg-white/20' : 'bg-slate-800 text-emerald-400 group-hover:text-emerald-300'}`}>
                  <CreditCard className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">My Bills</div>
                  <div className={`text-[10px] truncate ${activeTab === 'bills' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Billing ledger & pay online
                  </div>
                </div>
              </div>
              {unpaidBills.length > 0 ? (
                <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full shadow-xs">
                  {unpaidBills.length} unpaid
                </span>
              ) : (
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'bills' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
              )}
            </button>

            {/* Module 3: My Usage */}
            <button
              onClick={() => handleConsumerTabChange('usage')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'usage'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-usage"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'usage' ? 'bg-white/20' : 'bg-slate-800 text-sky-400 group-hover:text-sky-300'}`}>
                  <BarChart3 className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">My Usage</div>
                  <div className={`text-[10px] truncate ${activeTab === 'usage' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Meter reading history & trends
                  </div>
                </div>
              </div>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'usage' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
            </button>

            {/* Module: Reports & Concerns */}
            <button
              onClick={() => handleConsumerTabChange('reports')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'reports'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-reports"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'reports' ? 'bg-white/20' : 'bg-slate-800 text-teal-400 group-hover:text-teal-300'}`}>
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">Reports & Inquiries</div>
                  <div className={`text-[10px] truncate ${activeTab === 'reports' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Leaks, pressure & admin replies
                  </div>
                </div>
              </div>
              {unreadReportsCount > 0 ? (
                <span className="px-1.5 py-0.5 bg-amber-400 text-slate-950 text-[10px] font-black rounded-full shadow-xs animate-pulse">
                  {unreadReportsCount} new
                </span>
              ) : (
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'reports' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
              )}
            </button>

            {/* Module 4: Notifications */}
            <button
              onClick={() => handleConsumerTabChange('notifications')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'notifications'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-notifications"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'notifications' ? 'bg-white/20' : 'bg-slate-800 text-amber-400 group-hover:text-amber-300'}`}>
                  <Bell className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">Notifications</div>
                  <div className={`text-[10px] truncate ${activeTab === 'notifications' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Receipts & district alerts
                  </div>
                </div>
              </div>
              {unreadNotifCount > 0 ? (
                <span className="px-1.5 py-0.5 bg-blue-500 text-white text-[10px] font-black rounded-full">
                  {unreadNotifCount}
                </span>
              ) : (
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'notifications' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
              )}
            </button>

            {/* Module 5: My Profile */}
            <button
              onClick={() => handleConsumerTabChange('profile')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'profile'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-profile"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'profile' ? 'bg-white/20' : 'bg-slate-800 text-purple-400 group-hover:text-purple-300'}`}>
                  <User className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">My Profile</div>
                  <div className={`text-[10px] truncate ${activeTab === 'profile' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Contact details & security
                  </div>
                </div>
              </div>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'profile' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
            </button>
          </div>

          {/* District Assistance Support Box */}
          <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/50 space-y-2 text-xs">
            <div className="flex items-center space-x-2 text-blue-400 font-bold">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] uppercase tracking-wider">Water District Office</span>
            </div>
            <p className="text-[11px] text-slate-300">
              Call: <a href="tel:0888904946" className="text-white hover:text-blue-300 transition font-bold">(088) 890 – 4946</a>
            </p>
            <p className="text-[10px] text-slate-400">
              Hours: <span className="text-slate-300 font-medium">Mon-Fri: 8:00am – 5:00pm</span>
            </p>
            <p className="text-[10px] text-slate-400 truncate">
              Email: <a href="mailto:tagoloan_waterdistrict@yahoo.com" className="text-blue-400 hover:underline">tagoloan_waterdistrict@yahoo.com</a>
            </p>
            <p className="text-[10px] text-slate-400">
              Office: <span className="text-slate-300">Arellano St, Poblacion</span>
            </p>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800 shrink-0">
          <button
            onClick={onLogout}
            className="w-full py-2.5 px-3 bg-slate-800/80 hover:bg-rose-600/90 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 border border-slate-700/80 hover:border-rose-500 cursor-pointer"
            id="sidebar-logout-btn"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN VIEWPORT AREA */}
      <div ref={mainScrollRef} className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto bg-slate-950 text-slate-100">
        
        {/* Top Header Bar */}
        <header className="sticky top-0 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 z-30 shadow-md px-4 sm:px-8 py-3.5 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-3 sm:space-x-3.5 min-w-0">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700 cursor-pointer shrink-0"
              aria-label="Open Sidebar Menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="hidden sm:inline text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Consumer Portal
                </span>
                <span className="hidden sm:inline text-slate-600">/</span>
                <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-blue-400 truncate">
                  {activeTab === 'dashboard' && 'Dashboard Overview'}
                  {activeTab === 'installation' && 'Water Meter Installation'}
                  {activeTab === 'bills' && 'My Water Bills'}
                  {activeTab === 'usage' && 'Consumption & Usage'}
                  {activeTab === 'reports' && 'Service Reports & Inquiries'}
                  {activeTab === 'notifications' && 'Notifications & Alerts'}
                  {activeTab === 'profile' && 'Consumer Profile'}
                </span>
              </div>
              <h2 className="text-sm sm:text-base font-black text-white capitalize tracking-tight mt-0.5 truncate">
                {activeTab === 'dashboard' && 'Account & Telemetry Dashboard'}
                {activeTab === 'installation' && 'Installation Scheduling & Account Activation'}
                {activeTab === 'bills' && 'Billing Ledger & Online Settle'}
                {activeTab === 'usage' && 'Meter Telemetry & Historical Readings'}
                {activeTab === 'reports' && 'Service Concerns & Administrator Replies'}
                {activeTab === 'notifications' && 'Official Advisories & Receipts'}
                {activeTab === 'profile' && 'Personal Information & Security'}
              </h2>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
            {outstandingSum > 0 && activeTab !== 'bills' && (
              <button
                onClick={() => {
                  setActiveTab('bills');
                  if (unpaidBills.length > 0) handleStartPayment(unpaidBills[0]);
                }}
                className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span className="tabular-nums">Pay ₱{outstandingSum.toFixed(2)}</span>
              </button>
            )}

            {/* Responsive Notification Bell with Dropdown Popover */}
            <div className="relative" ref={notifDropdownRef}>
              <button
                type="button"
                onClick={() => setShowNotifDropdown(prev => !prev)}
                aria-expanded={showNotifDropdown}
                aria-label="Open Notifications Menu"
                className={`relative p-2.5 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border transition cursor-pointer ${
                  showNotifDropdown
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                    : 'bg-slate-800/90 text-slate-200 hover:text-white hover:bg-slate-800 border-slate-700'
                }`}
                title="Notifications & Advisories"
                id="header-notif-bell-btn"
              >
                <Bell className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4.5 min-w-[18px] px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white ring-2 ring-slate-900 tabular-nums">
                    {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
                  </span>
                )}
              </button>

              {/* Quick Notification Dropdown Popover - Responsive Fixed on Mobile, Anchored Popover on Desktop */}
              {showNotifDropdown && (
                <div 
                  className="fixed inset-x-3 top-16 sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-2 sm:w-96 bg-slate-900 text-slate-100 rounded-2xl shadow-2xl border border-slate-700/90 z-50 overflow-hidden animate-slide-down"
                  id="header-notif-dropdown"
                >
                  <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <Bell className="h-4 w-4 text-blue-400" />
                      <span className="text-xs font-black text-white uppercase tracking-wider">
                        Notifications
                      </span>
                      {unreadNotifCount > 0 && (
                        <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 font-black text-[10px] rounded-md tabular-nums">
                          {unreadNotifCount} unread
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      {unreadNotifCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllNotifsRead}
                          className="text-[10px] font-bold text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
                        >
                          Mark all read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowNotifDropdown(false)}
                        className="sm:hidden p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                        aria-label="Close notifications"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[65vh] sm:max-h-96 overflow-y-auto divide-y divide-slate-800/80">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.slice(0, 25).map((n, idx) => {
                        const effectiveType = inferNotificationType(n);
                        const isReport = isReportNotification(n) || effectiveType === 'report';
                        const isAnnouncement = !isReport && effectiveType === 'announcement';
                        const isInstallation = !isReport && !isAnnouncement && effectiveType === 'installation';
                        const isMeterStatus = !isReport && !isAnnouncement && !isInstallation && effectiveType === 'meter_status';
                        const meterStatusNorm = isMeterStatus ? normalizeMeterStatus(n.meterStatus) : 'active';
                        const isBilling = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && (effectiveType === 'billing' || effectiveType === 'balance');
                        const isReceiptUpload = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'receipt_upload';
                        const isPayment = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && (effectiveType === 'payment' || isReceiptUpload);
                        const isAccountIssue = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'account_issue';
                        const isDisconnection = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'disconnection';
                        const isPartialAlert =
                          !isReport &&
                          (isPayment || isBilling) &&
                          ((n.title || '').toLowerCase().includes('partial') ||
                            (n.message || '').toLowerCase().includes('remaining'));

                        const categoryLabel = isReport
                          ? 'Support Inquiry'
                          : isAnnouncement
                          ? 'District Advisory'
                          : isInstallation
                          ? `Meter Installation${n.installationStatus ? ` · ${n.installationStatus}` : ''}`
                          : isMeterStatus
                          ? `Meter Status · ${formatMeterStatusLabel(meterStatusNorm)}`
                          : isDisconnection
                          ? 'Disconnection Notice'
                          : isAccountIssue
                          ? 'Account & ID'
                          : isPartialAlert
                          ? 'Balance Notice'
                          : isBilling
                          ? 'Bill Issued'
                          : isReceiptUpload
                          ? 'Receipt Verified'
                          : isPayment
                          ? 'Payment Receipt'
                          : 'Notice';

                        const attribution = getNotificationAdminAttribution(n);
                        const linkedThread = findLinkedReportForNotification(n, reports);

                        return (
                          <button
                            type="button"
                            key={`dropdown-notif-${n.id || idx}`}
                            onClick={() => handleOpenNotificationDetailModal(n)}
                            className={`w-full text-left p-3.5 hover:bg-slate-800/80 transition cursor-pointer flex items-start space-x-3 group ${
                              !n.read ? 'bg-blue-950/35' : ''
                            }`}
                          >
                            <div className={`p-2 rounded-xl shrink-0 mt-0.5 border ${
                              isReport || isAnnouncement
                                ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60'
                                : isInstallation
                                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60'
                                : isMeterStatus
                                ? meterStatusNorm === 'damaged'
                                  ? 'bg-rose-950/80 text-rose-300 border-rose-800/60'
                                  : meterStatusNorm === 'maintenance'
                                  ? 'bg-amber-950/80 text-amber-300 border-amber-800/60'
                                  : meterStatusNorm === 'active'
                                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
                                  : 'bg-slate-800 text-slate-300 border-slate-700'
                                : isDisconnection
                                ? 'bg-rose-950/80 text-rose-300 border-rose-800/60'
                                : isAccountIssue
                                ? 'bg-purple-950/80 text-purple-300 border-purple-800/60'
                                : isPartialAlert
                                ? 'bg-amber-950/80 text-amber-300 border-amber-800/60'
                                : isBilling
                                ? 'bg-blue-950/80 text-blue-300 border-blue-800/60'
                                : isPayment
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}>
                              {isReport ? (
                                <MessageSquare className="h-4 w-4" />
                              ) : isAnnouncement ? (
                                <Bell className="h-4 w-4" />
                              ) : isInstallation ? (
                                <Wrench className="h-4 w-4" />
                              ) : isMeterStatus ? (
                                <Gauge className="h-4 w-4" />
                              ) : isDisconnection ? (
                                <AlertOctagon className="h-4 w-4" />
                              ) : isAccountIssue ? (
                                <UserCheck className="h-4 w-4" />
                              ) : isPartialAlert ? (
                                <AlertTriangle className="h-4 w-4" />
                              ) : isBilling ? (
                                <ReceiptText className="h-4 w-4" />
                              ) : isPayment ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <Info className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1.5 mb-1">
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  {attribution.isFromAdmin && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-950/90 text-sky-300 border border-sky-800/70 text-[9px] font-black uppercase tracking-wider shrink-0">
                                      <Building className="h-2.5 w-2.5 text-sky-400" />
                                      <span>{attribution.senderBadgeLabel}</span>
                                    </span>
                                  )}
                                  {linkedThread && !isReport && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-950/90 text-indigo-300 border border-indigo-800/70 text-[9px] font-mono font-bold shrink-0">
                                      <span>Replied · {linkedThread.ticketNumber}</span>
                                    </span>
                                  )}
                                  {isReport && n.referencedNotice && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-950/90 text-indigo-300 border border-indigo-800/70 text-[9px] font-bold truncate max-w-[170px]">
                                      <span className="truncate">
                                        {n.referencedNotice.meterStatus
                                          ? `Re: Meter (${formatMeterStatusLabel(n.referencedNotice.meterStatus)})`
                                          : `Re: ${n.referencedNotice.subject}`}
                                      </span>
                                    </span>
                                  )}
                                </div>
                                {!n.read && (
                                  <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0" aria-label="Unread notification"></span>
                                )}
                              </div>
                              <h4 className="text-xs font-bold text-white truncate">
                                {n.title || n.subject}
                              </h4>
                              <p className="text-[11px] text-slate-300 line-clamp-2 leading-snug mt-0.5">
                                {normalizeSingleLinePreview(n.message)}
                              </p>
                              <div className="flex items-center justify-between gap-2 mt-1.5 pt-1 border-t border-slate-800/80 text-[10px]">
                                <div className="flex items-center gap-1.5 text-slate-400 min-w-0 truncate">
                                  <span className="font-semibold text-slate-300 truncate">{categoryLabel}</span>
                                  <span aria-hidden="true" className="text-slate-600">·</span>
                                  <span className="font-mono tabular-nums shrink-0">
                                    {new Date(n.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                  </span>
                                </div>
                                <span className="font-bold text-blue-400 group-hover:text-blue-300 inline-flex items-center gap-0.5 shrink-0">
                                  <span>{attribution.canReplyDirectly ? 'Read & Reply' : 'Read full info'}</span>
                                  <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="p-2.5 bg-slate-950 border-t border-slate-800 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('notifications');
                        setShowNotifDropdown(false);
                      }}
                      className="text-xs font-bold text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
                    >
                      View All Notifications ({notifications.length})
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 bg-slate-800/90 rounded-xl border border-slate-700">
              <span className={`h-2 w-2 rounded-full ${isAccountPending ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></span>
              <span className="text-[11px] font-mono font-bold text-slate-200">
                {isAccountPending ? 'Pending Issuance' : `#${consumerRecord.accountNumber}`}
              </span>
            </div>

            <button
              onClick={onLogout}
              className="p-2.5 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-300 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-700 transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Body Content */}
        <main className="flex-1 p-4 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">

        {/* IMMEDIATE REAL-TIME ACCOUNT & METER ID CONFIRMATION BANNER */}
        {idConfirmedBanner && (
          <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 text-white rounded-2xl p-5 shadow-lg border border-emerald-400/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-slide-down">
            <div className="flex items-start space-x-3.5">
              <div className="p-2.5 bg-white/20 rounded-xl text-white shrink-0 mt-0.5">
                <UserCheck className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider flex flex-wrap items-center gap-2">
                  <span>{idConfirmedBanner.isUpdate ? 'Account Number Updated & Confirmed!' : 'Official Account & Meter Confirmed!'}</span>
                  <span className="text-[10px] font-mono font-black bg-white/20 px-2.5 py-0.5 rounded-full">
                    Account #{idConfirmedBanner.accountNumber}
                  </span>
                  <span className="text-[10px] font-mono font-bold bg-black/20 px-2.5 py-0.5 rounded-full">
                    Meter #{idConfirmedBanner.meterNumber}
                  </span>
                </h4>
                <p className="text-xs text-emerald-50 mt-1 leading-relaxed">
                  Tagoloan Water District Administration has officially issued and confirmed your water service identifiers ({idConfirmedBanner.confirmedAt}). Your Consumer Portal dashboard, telemetry history, billing ledger, and official activation notification are now active.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <button
                onClick={() => {
                  setActiveTab('notifications');
                  setNotifFilter('account_issue');
                  setIdConfirmedBanner(null);
                }}
                className="px-3.5 py-2 bg-white text-emerald-800 hover:bg-emerald-50 rounded-xl text-xs font-black transition cursor-pointer shadow-xs"
              >
                View Notification
              </button>
              <button
                onClick={() => setIdConfirmedBanner(null)}
                className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
                aria-label="Dismiss confirmation banner"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        {/* IMMEDIATE REAL-TIME PAYMENT CONFIRMATION BANNER / TOAST */}
        {paymentConfirmationToast && (
          <div className="bg-emerald-600 text-white rounded-2xl p-5 shadow-lg border border-emerald-500 flex items-start justify-between gap-4 animate-slide-down">
            <div className="flex items-start space-x-3.5">
              <div className="p-2 bg-white/20 rounded-xl text-white shrink-0 mt-0.5">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                  <span>Payment Settle Confirmed!</span>
                  <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">
                    Official Receipt #{paymentConfirmationToast.reference}
                  </span>
                </h4>
                <p className="text-xs text-emerald-100 mt-1 leading-relaxed">
                  Your water tariff payment of <strong>₱{paymentConfirmationToast.amount.toFixed(2)}</strong> for billing cycle <strong>{paymentConfirmationToast.period}</strong> has been cleared and stamped into the central district records on {paymentConfirmationToast.date}. Outstanding balance updated.
                </p>
              </div>
            </div>
            <button
              onClick={() => setPaymentConfirmationToast(null)}
              className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* STATUS / ERROR TOAST */}
        {statusMsg && (
          <div className={`p-4 rounded-2xl text-xs flex items-center justify-between gap-3 shadow-md ${
            statusMsg.type === 'success'
              ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-500/40'
              : 'bg-rose-950/80 text-rose-200 border border-rose-500/40'
          }`}>
            <div className="flex items-center space-x-3">
              <AlertCircle className={`h-5 w-5 shrink-0 ${statusMsg.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`} />
              <span className="font-semibold">{statusMsg.msg}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMsg(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* AUTOMATED OVERDUE BILL NOTIFICATION BANNER */}
        {consumerRecord && overdueBills.length > 0 && !isAccountPending && (
          <OverdueBillBanner
            overdueBills={overdueBills}
            consumerRecord={consumerRecord}
            onPayNow={(reading, mode) => handleOpenSimulatedPayment(reading, mode || 'full')}
            onViewBillDetails={(reading) => {
              setActiveTab('bills');
              setBillFilter('unpaid');
              setHighlightedReadingId(reading.id);
              setSpotlightReading(reading);
            }}
            onUploadReceipt={(reading) => {
              setUploadReceiptReading(reading);
              setIsUploadReceiptOpen(true);
            }}
            calculateCostOf={calculateCostOf}
          />
        )}

        {/* ACCOUNT STATUS: ONLY DISPLAYED IN DASHBOARD MODULE */}
        {activeTab === 'dashboard' && (
          isAccountPending ? (
            <div className="space-y-5">
              <div className="bg-slate-900 border border-amber-500/40 rounded-3xl p-6 sm:p-8 text-slate-100 space-y-5 shadow-lg">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex items-start space-x-4">
                    <div className="p-3 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-2xl shrink-0">
                      {consumerRecord.hasExistingMeter === false || installationRequests.length > 0 ? (
                        <Wrench className="h-7 w-7" />
                      ) : (
                        <Clock className="h-7 w-7" />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300 font-semibold">
                        <span>
                          {consumerRecord.status === 'installation_not_scheduled'
                            ? 'Installation Not Scheduled'
                            : installationRequests[0]?.status === 'Installed'
                            ? 'Water Meter Installed · Awaiting Account Validation'
                            : consumerRecord.status === 'pending_installation' || installationRequests.length > 0
                            ? `Pending Water Meter Installation (${installationRequests[0]?.status || 'Pending Review'})`
                            : 'Account Setup Pending'}
                        </span>
                        {(consumerRecord.applicationNumber || installationRequests[0]?.applicationNumber) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-sky-300">
                              App #{consumerRecord.applicationNumber || installationRequests[0]?.applicationNumber}
                            </span>
                          </>
                        )}
                      </div>
                      <h3 className="text-lg font-black text-white">
                        {consumerRecord.status === 'installation_not_scheduled'
                          ? 'Schedule Your Water Meter Installation to Unlock Official Account Issuance'
                          : installationRequests[0]?.status === 'Installed'
                          ? 'Physical Water Meter Installed — Pending Administrative Validation'
                          : consumerRecord.hasExistingMeter === false || installationRequests.length > 0
                          ? 'Water Meter Installation & Official Account Activation in Progress'
                          : 'Official Account & Meter Identifiers Pending Administrative Issuance'}
                      </h3>
                      <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                        {consumerRecord.hasExistingMeter === false || installationRequests.length > 0 ? (
                          <>
                            Your official permanent <strong className="text-white">Account Number</strong> and{' '}
                            <strong className="text-white">Meter Tag Number</strong> will be issued strictly after physical water meter installation is completed and verified by the Tagoloan Water District administrator.
                          </>
                        ) : (
                          <>
                            Your registration application for water connection service has been received and verified. The Tagoloan Water District administration office is currently provisioning your official permanent <strong className="text-white">Account Number</strong> and physical <strong className="text-white">Meter Tag Number</strong>.
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-800 text-xs">
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 font-medium block">Applicant Name</span>
                    <span className="font-bold text-white mt-0.5 block">{consumerRecord.name}</span>
                  </div>
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 font-medium block">Designated Barangay</span>
                    <span className="font-bold text-white mt-0.5 block">{consumerRecord.barangay || 'Poblacion'}</span>
                  </div>
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 font-medium block">Classification</span>
                    <span className="font-bold text-white mt-0.5 block">{consumerRecord.consumerType || 'Residential'}</span>
                  </div>
                </div>
              </div>

              {(consumerRecord.hasExistingMeter === false ||
                isPendingConsumerStatus(consumerRecord.status) ||
                installationRequests.length > 0) && (
                <ConsumerInstallationSection
                  user={currentUser}
                  consumerRecord={consumerRecord}
                  installationRequests={installationRequests}
                  onRefresh={() => loadConsumerInfo(true)}
                  compactHeader
                />
              )}
            </div>
          ) : (
            /* OFFICIAL IDENTIFIERS ACTIVE BANNER */
            <div className="bg-gradient-to-r from-blue-700 via-blue-650 to-sky-600 rounded-3xl p-6 sm:p-7 text-white shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 h-48 w-48 bg-white/5 rounded-full blur-2xl transform translate-x-1/4 -translate-y-1/4"></div>
              
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center relative">
                <div className="md:col-span-8 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-blue-100 font-semibold">
                    <span className="text-white font-bold">
                      {consumerRecord.consumerType || 'Residential'} Line
                    </span>
                    <span aria-hidden="true" className="text-blue-200/70">·</span>
                    <span className="text-emerald-200 font-bold">
                      Line Active
                    </span>
                  </div>
                  
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight">{consumerRecord.name}</h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-100">
                    <span className="flex items-center space-x-1">
                      <MapPin className="h-3.5 w-3.5 text-sky-300 shrink-0" />
                      <span>{consumerRecord.address}</span>
                    </span>
                    <span className="flex items-center space-x-1 font-bold text-amber-200">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span>Barangay: {consumerRecord.barangay || 'Poblacion'}</span>
                    </span>
                  </div>
                </div>

                {/* Official Account Number & Tag Number Identifiers Display */}
                <div className="md:col-span-4 bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/15 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-blue-200 font-medium">Account Number:</span>
                    <span className="font-mono tabular-nums font-black text-amber-300 text-sm">
                      {consumerRecord.accountNumber}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-blue-200 font-medium">Meter Tag Number:</span>
                    <span className="font-mono tabular-nums font-black text-white text-sm">
                      {consumerRecord.meterNumber || 'MT-7711'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-blue-200 font-medium">Classification:</span>
                    <span className="font-bold text-blue-100">{consumerRecord.consumerType || 'Residential'}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        )}

        {/* ------------------------------------------------------------- */}
        {/* DATA LOADING INDICATOR FOR INITIAL LOAD, SYNC, OR TAB SWITCH  */}
        {/* ------------------------------------------------------------- */}
        {isInitialLoading || isSyncing || isTabLoading ? (
          <DataLoadingIndicator 
            variant="card"
            message={getConsumerTabLoadingMessage(activeTab).title}
            subMessage={getConsumerTabLoadingMessage(activeTab).subtitle}
            badgeText="TAGOLOAN CONSUMER LEDGER"
          />
        ) : (
          <>
            {/* ------------------------------------------------------------- */}
            {/* MODULE: WATER METER INSTALLATION & ACCOUNT ACTIVATION         */}
            {/* ------------------------------------------------------------- */}
            {activeTab === 'installation' && (
              <div className="space-y-6 animate-fade-in" id="consumer-tab-installation">
                <ConsumerInstallationSection
                  user={currentUser}
                  consumerRecord={consumerRecord}
                  installationRequests={installationRequests}
                  onRefresh={() => loadConsumerInfo(true)}
                />
              </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* MODULE 1: DASHBOARD                                          */}
            {/* ------------------------------------------------------------- */}
            {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-fade-in" id="consumer-tab-dashboard">
            
            {/* DYNAMIC DUE ALERT & OVERDUE FLAGGING COMPONENT */}
            {consumerRecord && billedReadings.length > 0 && (
              <DynamicDueAlert
                consumerRecord={consumerRecord}
                readings={billedReadings}
                overdueBills={overdueBills}
                unpaidBills={unpaidBills}
                onPayNow={(reading, mode) => handleOpenSimulatedPayment(reading, mode || 'full')}
                onViewBillDetails={(reading) => {
                  setBillDetailsReading(reading);
                  setIsBillDetailsOpen(true);
                }}
                onUploadReceipt={(reading) => {
                  setUploadReceiptReading(reading);
                  setIsUploadReceiptOpen(true);
                }}
                calculateCostOf={calculateCostOf}
              />
            )}

            {/* OFFICIAL WATER TARIFF UPDATE & PRICE HIKE ADVISORY BANNER */}
            <div className="bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-5 sm:p-6 border border-blue-800/80 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fade-in" id="consumer-tariff-advisory-banner">
              <div className="flex items-start sm:items-center space-x-3.5">
                <div className="p-3 bg-blue-500/20 rounded-2xl border border-blue-400/40 text-blue-300 shrink-0">
                  <Waves className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-400/40">
                      Approved Tariff Schedule: {activeTariff.resolutionNumber}
                    </span>
                    <span className="text-[11px] text-slate-300 font-mono">
                      Effective: {activeTariff.effectiveDate}
                    </span>
                  </div>
                  <h4 className="text-sm font-black text-white">
                    Official Notice of Water Tariff Adjustment
                  </h4>
                  <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                    Tagoloan Water District has updated its basic water service rates under Board Resolution {activeTariff.resolutionNumber}. 
                    {consumerRecord?.consumerType === 'Commercial' ? ' Commercial' : ' Domestic / Residential'} baseline minimum (1 – 10 m³) is set at{' '}
                    <strong className="text-emerald-400 font-mono">
                      ₱{(consumerRecord?.consumerType === 'Commercial' ? activeTariff.commercial.baseMinCharge : activeTariff.residential.baseMinCharge).toFixed(2)}
                    </strong>. Applies automatically to new meter readings going forward; previously issued statements retain their original billed rates.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowTariffScheduleModal(true)}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition flex items-center space-x-2 shadow-md cursor-pointer shrink-0 self-end md:self-center"
              >
                <FileText className="h-4 w-4" />
                <span>View Rate Schedule</span>
              </button>
            </div>
            
            {/* SPOTLIGHT: METER READING & BILL ISSUED NOTIFICATION FOCUS CARD */}
            {spotlightReading && isOfficialBillIssued(spotlightReading) && (
              <div 
                className="bg-slate-900 border border-blue-500/60 rounded-3xl p-6 shadow-xl relative overflow-hidden animate-slide-down ring-2 ring-blue-500/20 text-slate-100"
                id="dashboard-reading-spotlight"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-5 border-b border-slate-800">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      <span className="text-blue-400">Issued Meter Reading & Bill</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="text-slate-300">Period: {spotlightReading.billingPeriod}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className={
                        spotlightReading.paymentStatus === 'paid'
                          ? 'text-emerald-400 font-bold'
                          : spotlightReading.paymentStatus === 'partial'
                          ? 'text-amber-400 font-bold'
                          : 'text-rose-400 font-bold'
                      }>
                        {spotlightReading.paymentStatus === 'paid' ? 'Paid in Full' : spotlightReading.paymentStatus === 'partial' ? 'Partial Balance' : 'Unpaid Statement'}
                      </span>
                    </div>

                    <h3 className="text-xl font-black text-white tracking-tight">
                      Official Meter Reading for {spotlightReading.billingPeriod}
                    </h3>
                    <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                      Your meter reading was approved by Administration. Baseline <strong className="text-slate-100 font-mono tabular-nums">{spotlightReading.previousReading} m³</strong> to Present <strong className="text-white font-mono tabular-nums">{spotlightReading.presentReading ?? spotlightReading.currentReading} m³</strong> yielded <strong className="text-sky-300 font-mono tabular-nums">{spotlightReading.consumption} m³</strong> net usage with a calculated bill of <strong className="text-emerald-400 font-mono tabular-nums">₱{calculateCostOf(spotlightReading, consumerRecord?.consumerType).toFixed(2)}</strong>.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 self-end lg:self-center">
                    <button
                      onClick={() => {
                        if (spotlightReading?.id) {
                          dismissedSpotlightIdsRef.current.add(spotlightReading.id);
                        }
                        setSpotlightReading(null);
                      }}
                      className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                      title="Dismiss Spotlight"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* 4 Index & Bill Basis Metric Tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 my-5">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 space-y-1">
                    <span className="text-[11px] font-semibold text-slate-400 block">
                      Previous Reading
                    </span>
                    <span className="text-lg font-black font-mono tabular-nums text-slate-200 block">
                      {spotlightReading.previousReading} m³
                    </span>
                    <span className="text-[10px] text-slate-500">Baseline from prior cycle</span>
                  </div>

                  <div className="bg-slate-950 border border-blue-500/30 rounded-2xl p-3.5 space-y-1">
                    <span className="text-[11px] font-semibold text-blue-400 block">
                      Present Reading
                    </span>
                    <span className="text-lg font-black font-mono tabular-nums text-white block">
                      {spotlightReading.presentReading ?? spotlightReading.currentReading} m³
                    </span>
                    <span className="text-[10px] text-blue-400 font-medium">Recorded at inspection</span>
                  </div>

                  <div className="bg-slate-950 border border-sky-500/30 rounded-2xl p-3.5 space-y-1">
                    <span className="text-[11px] font-semibold text-sky-400 block">
                      Current Reading & Usage
                    </span>
                    <span className="text-lg font-black font-mono tabular-nums text-sky-300 block">
                      {spotlightReading.consumption} m³
                    </span>
                    <span className="text-[10px] text-sky-400/80 font-mono tabular-nums font-medium">
                      Index {spotlightReading.currentReading} m³ · Net used
                    </span>
                  </div>

                  <div className="bg-slate-950 border border-emerald-500/30 rounded-2xl p-3.5 space-y-1">
                    <span className="text-[11px] font-semibold text-emerald-400 block">
                      Calculated Bill
                    </span>
                    <span className="text-lg font-black font-mono tabular-nums text-emerald-300 block">
                      ₱{calculateCostOf(spotlightReading, consumerRecord?.consumerType).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-emerald-400/80 font-medium">
                      {spotlightReading.paymentStatus === 'paid' ? 'Settled in full' : `Due ${spotlightReading.dueDate || '20th of Month'}`}
                    </span>
                  </div>
                </div>

                {/* Footer Strip with Reading Meta & Direct Action Buttons */}
                <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 font-medium">
                    <span>Reading Date: <strong className="text-slate-200">{spotlightReading.readingDate}</strong></span>
                    <span aria-hidden="true">·</span>
                    <span>Field Officer: <strong className="text-slate-200">{spotlightReading.meterReaderName || 'Field Tech'}</strong></span>
                    <span aria-hidden="true">·</span>
                    <span>Due Date: <strong className="text-rose-400">{spotlightReading.dueDate || '20th of Month'}</strong></span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    <button
                      onClick={() => {
                        setBillDetailsReading(spotlightReading);
                        setIsBillDetailsOpen(true);
                      }}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-blue-300 font-bold text-xs rounded-xl transition flex items-center justify-center space-x-1.5 cursor-pointer"
                      id="spotlight-bill-breakdown-btn"
                      title="View itemized fixed, volumetric, and tax breakdown"
                    >
                      <Calculator className="h-4 w-4 text-blue-400" />
                      <span>Bill Details</span>
                    </button>
                    {spotlightReading.paymentStatus !== 'paid' ? (
                      <>
                        <button
                          onClick={() => {
                            setActiveTab('bills');
                            handleStartPayment(spotlightReading, 'full');
                          }}
                          className="flex-1 sm:flex-initial px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 cursor-pointer"
                        >
                          <CreditCard className="h-4 w-4" />
                          <span>Pay Online (₱{calculateCostOf(spotlightReading, consumerRecord?.consumerType).toFixed(2)})</span>
                        </button>
                        <button
                          onClick={() => {
                            setUploadReceiptReading(spotlightReading);
                            setIsUploadReceiptOpen(true);
                          }}
                          className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
                          title="Upload physical cashier receipt"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>Upload Receipt</span>
                        </button>
                        <button
                          onClick={() => {
                            setActiveTab('bills');
                            setHighlightedReadingId(spotlightReading.id);
                          }}
                          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
                        >
                          <ReceiptText className="h-3.5 w-3.5" />
                          <span>View in My Bills</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setReceiptDetailModal(spotlightReading)}
                          className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 cursor-pointer"
                        >
                          <ReceiptText className="h-4 w-4" />
                          <span>View Official Receipt</span>
                        </button>
                        {spotlightReading.paymentReceiptUrl && (
                          <button
                            onClick={() => setViewingReceiptReading(spotlightReading)}
                            className="px-4 py-2.5 bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border border-blue-700/60 font-bold text-xs rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
                            title="View uploaded cashier slip photo"
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            <span>Uploaded Slip</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setActiveTab('bills');
                            setBillFilter('paid');
                            setHighlightedReadingId(spotlightReading.id);
                          }}
                          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
                        >
                          <ReceiptText className="h-3.5 w-3.5" />
                          <span>View in My Bills</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {/* 4 CORE OVERVIEW METRIC CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              
              {/* Card 1: Current Month Consumption */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-md space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-semibold text-slate-400 block">
                      Current Consumption
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 block mt-0.5">
                      Prev {prevReadingVal} → Pres {presReadingVal} m³
                    </span>
                  </div>
                  <div className="p-2 bg-blue-500/15 text-blue-400 border border-blue-500/20 rounded-xl">
                    <Droplet className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-3xl font-black text-white font-mono tabular-nums">
                      {currentConsumptionVal}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">m³ (cubic meters)</span>
                  </div>
                  <div className="flex items-center space-x-1 text-[11px] mt-1">
                    {previousMonthRead && consumptionDiff > 0 ? (
                      <span className="text-rose-400 font-bold flex items-center tabular-nums">
                        <TrendingUp className="h-3.5 w-3.5 mr-0.5" />
                        +{consumptionDiff} m³ ({consumptionPercentChange}%)
                      </span>
                    ) : previousMonthRead && consumptionDiff < 0 ? (
                      <span className="text-emerald-400 font-bold flex items-center tabular-nums">
                        <TrendingDown className="h-3.5 w-3.5 mr-0.5" />
                        {consumptionDiff} m³ ({consumptionPercentChange}%)
                      </span>
                    ) : previousMonthRead ? (
                      <span className="text-slate-400 font-medium">Constant vs last month</span>
                    ) : (
                      <span className="text-slate-400 font-medium">{latestRead ? 'Initial baseline reading' : 'No recorded cycles yet'}</span>
                    )}
                    {previousMonthRead && <span className="text-slate-500">vs prev</span>}
                  </div>
                </div>
              </div>

              {/* Card 2: Latest Meter Reading */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-md space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-semibold text-slate-400 block">
                      Latest Meter Reading
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-sky-400/90 block mt-0.5">
                      Baseline: {prevReadingVal} m³
                    </span>
                  </div>
                  <div className="p-2 bg-sky-500/15 text-sky-400 border border-sky-500/20 rounded-xl">
                    <Activity className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-3xl font-black text-white font-mono tabular-nums">
                      {currReadingVal}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">m³ Index</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 font-medium">
                    <span>
                      {latestRead ? `Recorded: ${latestRead.readingDate}` : consumerRecord?.lastReadingDate ? `Recorded: ${consumerRecord.lastReadingDate}` : 'Baseline index active'}
                    </span>
                    {latestRead && isOfficialBillIssued(latestRead) ? (
                      <span className="text-[10px] font-bold text-sky-400">
                        Billed
                      </span>
                    ) : pendingInspectionRead ? (
                      <span className="text-[10px] font-bold text-amber-400">
                        New Read Pending
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Card 3: Current Bill Amount */}
              <div 
                onClick={() => {
                  if (latestBill && !isAccountPending) {
                    if (latestBill.paymentStatus === 'paid') {
                      setReceiptDetailModal(latestBill);
                    } else {
                      setBillDetailsReading(latestBill);
                      setIsBillDetailsOpen(true);
                    }
                  }
                }}
                className={`bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-md space-y-3 relative overflow-hidden ${
                  latestBill && !isAccountPending
                    ? 'hover:border-indigo-500/60 hover:bg-slate-900/90 transition-all cursor-pointer group'
                    : ''
                }`}
                id="card-current-bill-amount"
                title={latestBill && !isAccountPending ? 'Click to view full itemized bill or official receipt' : 'Billing statement will be available once issued by Administration'}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-semibold text-slate-400 block">
                      Current Bill Amount
                    </span>
                    {latestBill && !isAccountPending ? (
                      latestBill.paymentStatus === 'paid' ? (
                        <span className="text-[11px] font-semibold text-emerald-400 group-hover:text-emerald-300 flex items-center mt-0.5">
                          <span>Settled {latestBill.orNumber ? `· ${latestBill.orNumber}` : '· Official OR'}</span>
                          <ArrowRight className="h-3 w-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-indigo-400 group-hover:text-indigo-300 flex items-center mt-0.5">
                          <span>View 3-Pillar Breakdown</span>
                          <ArrowRight className="h-3 w-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
                        </span>
                      )
                    ) : (
                      <span className="text-[11px] font-medium text-slate-500 block mt-0.5">
                        Awaiting Admin Billing
                      </span>
                    )}
                  </div>
                  <div className={`p-2 rounded-xl border ${
                    latestBill && !isAccountPending && latestBill.paymentStatus === 'paid'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 group-hover:bg-emerald-600 group-hover:text-white transition-colors'
                      : latestBill && !isAccountPending
                        ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20 group-hover:bg-indigo-600 group-hover:text-white transition-colors'
                        : 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20 opacity-70'
                  }`}>
                    <Calculator className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline space-x-1">
                    <span className={`text-3xl font-black font-mono tabular-nums ${
                      latestBill && !isAccountPending
                        ? latestBill.paymentStatus === 'paid'
                          ? 'text-emerald-400'
                          : 'text-indigo-300'
                        : 'text-slate-400'
                    }`}>
                      ₱{currentBillAmount.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 font-medium">
                    <span>
                      Cycle: {latestBill ? latestBill.billingPeriod : 'No Billing Issued Yet'}
                    </span>
                    <span className={`text-[10px] font-semibold ${
                      latestBill?.paymentStatus === 'paid' ? 'text-emerald-400' : 'text-slate-500'
                    }`}>
                      {latestBill
                        ? latestBill.paymentStatus === 'paid'
                          ? 'Paid · View Receipt'
                          : 'Fixed + Vol + Tax'
                        : 'No Receipt Yet'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Outstanding Balance */}
              <div className={`bg-slate-900 border rounded-3xl p-5 shadow-md space-y-3 ${
                outstandingSum > 0 
                  ? 'border-rose-500/40' 
                  : 'border-emerald-500/40'
              }`}>
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold text-slate-400">
                    Outstanding Balance
                  </span>
                  <div className={`p-2 rounded-xl border ${
                    outstandingSum > 0
                      ? 'bg-rose-500/15 text-rose-400 border-rose-500/25'
                      : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                  }`}>
                    <ReceiptText className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline space-x-1">
                    <span className={`text-3xl font-black font-mono tabular-nums ${
                      outstandingSum > 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      ₱{outstandingSum.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] text-slate-300 font-medium">
                      {outstandingSum > 0 
                        ? `${unpaidBills.length} bill(s)${partialBills.length > 0 ? ` (${partialBills.length} partial)` : ''}`
                        : 'Account cleared'}
                    </span>
                    {outstandingSum > 0 && (
                      <button
                        onClick={() => {
                          setActiveTab('bills');
                          if (unpaidBills.length > 0) handleStartPayment(unpaidBills[0], 'full');
                        }}
                        className="text-xs font-bold text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                      >
                        Settle Now →
                      </button>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* PERMANENT METER READING BASIS & CONTINUITY PANEL (Previous -> Present -> Current) */}
            {!isAccountPending && (
              <div
                className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-md space-y-4"
                id="consumer-reading-continuity-panel"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-800">
                  <div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <h3 className="text-sm font-bold text-white">
                        Meter Reading Basis & Consumption Continuity
                      </h3>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="text-xs font-mono tabular-nums text-sky-400 font-semibold">
                        Meter #{consumerRecord?.meterNumber || latestRead?.meterNumber || 'Assigned'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Your Previous Reading sets the baseline, Present Reading records usage at inspection, and Current Reading tracks latest water consumption for billing and leak detection.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('usage')}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center space-x-1.5 cursor-pointer self-start sm:self-center shrink-0"
                  >
                    <BarChart3 className="h-3.5 w-3.5 text-sky-400" />
                    <span>View Monthly Usage</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                </div>

                {/* 3-Column Reading Continuity Basis */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 1. Previous Reading (Baseline) */}
                  <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Previous Reading
                      </span>
                      <span className="text-[11px] font-medium text-slate-500">
                        Baseline Index
                      </span>
                    </div>
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-black font-mono tabular-nums text-slate-200">
                        {prevReadingVal}
                      </span>
                      <span className="text-xs font-semibold text-slate-400">m³</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      {previousMonthRead
                        ? `Carried forward from ${previousMonthRead.billingPeriod} (${previousMonthRead.readingDate})`
                        : 'Preserved baseline index prior to latest inspection'}
                    </p>
                  </div>

                  {/* 2. Present Reading (Inspection) */}
                  <div className="bg-slate-950/90 border border-blue-500/30 rounded-2xl p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                        Present Reading
                      </span>
                      <span className="text-[11px] font-medium text-blue-300/80">
                        Inspection Index
                      </span>
                    </div>
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-black font-mono tabular-nums text-white">
                        {presReadingVal}
                      </span>
                      <span className="text-xs font-semibold text-slate-400">m³</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      {latestRead
                        ? `Recorded on ${latestRead.readingDate} (${latestRead.billingPeriod})`
                        : 'Awaiting first approved field meter inspection'}
                    </p>
                  </div>

                  {/* 3. Current Reading & Latest Consumption */}
                  <div className="bg-slate-950/90 border border-sky-500/30 rounded-2xl p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                        Current Reading & Usage
                      </span>
                      <span className="text-[11px] font-mono tabular-nums font-semibold text-sky-300">
                        Dial: {currReadingVal} m³
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline space-x-2">
                        <span className="text-2xl font-black font-mono tabular-nums text-sky-300">
                          {currentConsumptionVal}
                        </span>
                        <span className="text-xs font-semibold text-slate-300">m³ used</span>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400">
                        {presReadingVal} − {prevReadingVal} = {currentConsumptionVal} m³
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      {latestBill
                        ? `Assessed Bill: ₱${calculateCostOf(latestBill, consumerRecord?.consumerType).toFixed(2)} (${latestBill.paymentStatus === 'paid' ? 'Paid' : 'Billed'})`
                        : latestRead
                        ? `Estimated Charge: ₱${calculateCostOf(latestRead, consumerRecord?.consumerType).toFixed(2)}`
                        : 'Tracks latest consumption & billing basis'}
                    </p>
                  </div>
                </div>

                {/* Comparison, Expense Management & Leak / Problem Detection Strip */}
                <div className="pt-3 border-t border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {isAbnormalSpike ? (
                      <span className="text-rose-400 font-bold flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>High Usage Alert — Possible Concealed Leak Detected:</span>
                      </span>
                    ) : consumptionDiff < 0 && previousMonthRead ? (
                      <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>Lower Water Usage vs Prior Cycle:</span>
                      </span>
                    ) : (
                      <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>Reading Continuity & Leak Check:</span>
                      </span>
                    )}
                    <span className="text-slate-400">
                      {isAbnormalSpike
                        ? `Latest usage (${currentConsumptionVal} m³) rose sharply${previousMonthRead ? ` from ${previousMonthRead.consumption} m³` : ''}. Inspect indoor fixtures, float valves, and service lines.`
                        : previousMonthRead
                        ? `Compared to ${previousMonthRead.billingPeriod} (${previousMonthRead.consumption} m³), usage changed by ${consumptionDiff > 0 ? `+${consumptionDiff}` : consumptionDiff} m³.`
                        : latestRead
                        ? `Baseline ${prevReadingVal} m³ → Present ${presReadingVal} m³ verified with normal consumption.`
                        : 'Previous baseline will automatically chain forward when your meter is read.'}
                    </span>
                  </div>

                  {pendingInspectionRead && (
                    <div className="text-[11px] font-mono tabular-nums text-amber-300 bg-amber-950/40 border border-amber-700/40 rounded-xl px-3 py-1.5 shrink-0">
                      New Field Inspection Logged ({pendingInspectionRead.previousReading} → {pendingInspectionRead.presentReading ?? pendingInspectionRead.currentReading} m³ · {pendingInspectionRead.consumption} m³) — Awaiting Admin Approval
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* OFFICIAL DISTRICT ADVISORIES & ANNOUNCEMENTS BULLETIN */}
            {announcements.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md space-y-4" id="dashboard-advisories-section">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-blue-500/15 text-blue-400 rounded-2xl border border-blue-500/25">
                      <Bell className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-white">
                          Official District Advisories & Announcements
                        </h3>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="text-xs text-blue-400 font-semibold">
                          {announcements.length} Active Bulletin{announcements.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Live public service bulletins, scheduled maintenance advisories, and board announcements from Tagoloan Water District
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setActiveTab('notifications');
                      setNotifFilter('announcement');
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold rounded-xl transition flex items-center space-x-1.5 cursor-pointer self-start sm:self-auto shrink-0"
                  >
                    <span>View All Advisories</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {announcements.slice(0, 3).map((ann, idx) => {
                    const cat = (ann.category || (ann as any).type || 'info').toLowerCase();
                    const isAlert = cat === 'alert' || cat === 'emergency' || cat === 'urgent';
                    const isMaint = cat === 'maintenance' || cat === 'warning';
                    return (
                      <div
                        key={`dash-ann-${ann.id || idx}`}
                        className={`rounded-2xl p-4 border flex flex-col justify-between gap-3 transition bg-slate-950 ${
                          isAlert
                            ? 'border-rose-500/40'
                            : isMaint
                            ? 'border-amber-500/40'
                            : 'border-slate-800'
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className={`font-semibold capitalize ${
                              isAlert
                                ? 'text-rose-400'
                                : isMaint
                                ? 'text-amber-400'
                                : 'text-blue-400'
                            }`}>
                              {cat}
                            </span>
                            <span className="font-mono tabular-nums text-slate-500">{ann.date}</span>
                          </div>
                          <h4 className="text-xs font-bold text-white leading-snug">{ann.title}</h4>
                          <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{ann.content}</p>
                        </div>
                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                          <span>By: {ann.postedBy || (ann as any).author || 'TWD Administration'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CONSUMER SERVICE ASSISTANCE & REPORT CONCERN DASHBOARD BANNER */}
            <div className="bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 text-white border border-blue-800/80 rounded-3xl p-6 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-6" id="dashboard-reports-banner">
              <div className="flex items-start space-x-4">
                <div className="p-3 bg-blue-500/20 text-blue-300 rounded-2xl border border-blue-400/30 shrink-0 mt-0.5">
                  <MessageSquare className="h-6 w-6" />
                </div>
                <div className="space-y-1.5 max-w-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 bg-blue-500/30 border border-blue-400/40 text-blue-200 text-[10px] font-black uppercase tracking-wider rounded-md">
                      24/7 Consumer Assistance Desk
                    </span>
                    {unreadReportsCount > 0 && (
                      <span className="px-2.5 py-0.5 bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider rounded-md animate-pulse">
                        {unreadReportsCount} Admin Reply Awaiting Review
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-black text-white">
                    Need Help? Report a Water Leak, Pressure Drop, or Billing Concern
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Have an issue at your service connection? File an official report directly to Tagoloan Water District. 
                    Admins and maintenance crew receive instant alerts and respond directly to your ticket with status updates.
                  </p>
                  
                  {reports.length > 0 && (
                    <div className="pt-1 flex items-center gap-2 text-xs text-slate-300">
                      <span className="font-semibold text-blue-200">Latest Ticket:</span>
                      <span className="font-mono text-white font-bold bg-white/10 px-2 py-0.5 rounded text-[11px]">
                        {reports[0].ticketNumber}
                      </span>
                      <span className="truncate max-w-xs text-slate-300 font-medium">({reports[0].title})</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0 w-full md:w-auto">
                <button
                  onClick={() => {
                    setActiveTab('reports');
                  }}
                  className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 shadow-md cursor-pointer flex-1 md:flex-initial"
                >
                  <Plus className="h-4 w-4" />
                  <span>Report An Issue</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab('reports');
                    if (reports.length > 0) {
                      setSelectedReportId(reports[0].id);
                    }
                  }}
                  className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white font-bold text-xs uppercase tracking-wider rounded-xl border border-white/20 transition flex items-center justify-center gap-1.5 cursor-pointer flex-1 md:flex-initial"
                >
                  <Eye className="h-4 w-4" />
                  <span>View My Tickets ({reports.length})</span>
                </button>
              </div>
            </div>

            {/* EMBEDDED DASHBOARD BILL DETAILS BREAKDOWN COMPONENT — ONLY DISPLAY RECEIPT/STATEMENT WHEN ADMIN HAS ISSUED BILLING */}
            {consumerRecord && (
              latestBill && !isAccountPending ? (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div className="flex items-center space-x-3">
                      <div className="p-2.5 bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 rounded-2xl">
                        <Calculator className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-bold text-white">
                            Current Water Bill Details & Tariff Itemization
                          </h3>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="text-xs font-semibold text-indigo-400">
                            Fixed + Volumetric + Taxes
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          Itemized accounting breakdown of your assessed water charges for <strong className="text-white font-bold">{latestBill.billingPeriod}</strong> ({consumerRecord.consumerType} classification)
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {latestBill.paymentStatus === 'paid' && (
                        <button
                          onClick={() => setReceiptDetailModal(latestBill)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition flex items-center space-x-1.5 shadow-sm cursor-pointer"
                          title="Open Official Cashier Receipt (OR)"
                        >
                          <ReceiptText className="h-3.5 w-3.5" />
                          <span>View Official Receipt {latestBill.orNumber ? `(${latestBill.orNumber})` : ''}</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setBillDetailsReading(latestBill);
                          setIsBillDetailsOpen(true);
                        }}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
                        title="Open full interactive breakdown modal"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Expand Modal View</span>
                      </button>
                    </div>
                  </div>

                  <BillDetails
                    reading={latestBill}
                    consumer={consumerRecord}
                    calculateCostOf={calculateCostOf}
                    isModal={false}
                    onPayBill={(r) => {
                      setActiveTab('bills');
                      handleStartPayment(r, 'full');
                    }}
                  />
                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-md" id="dashboard-no-billing-notice">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start space-x-4">
                      <div className="p-3 bg-slate-950 border border-slate-800 text-slate-400 rounded-2xl shrink-0">
                        <ReceiptText className="h-6 w-6" />
                      </div>
                      <div className="space-y-1.5 max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-bold text-white">
                            No Official Billing Statement or Receipt Issued Yet
                          </h3>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="text-xs font-semibold text-amber-400">
                            Awaiting Admin Billing
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          For transparency, your Water Billing Notice and official receipt are hidden until Tagoloan Water District Administration generates and issues a billing statement for Account <strong className="text-slate-200 font-mono">#{consumerRecord.accountNumber || 'PENDING'}</strong>.
                          {latestRead
                            ? ` Your latest verified meter reading (${latestRead.consumption} m³ recorded on ${latestRead.readingDate}) is on file and awaiting official billing issuance by Administration.`
                            : ' No billing cycle has been issued for your account yet.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* TWO ANALYTICAL VISUAL CHARTS: CONSUMPTION CHART & BILLING CHART */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Monthly Consumption Chart */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Monthly Consumption Trend
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      Historical volume consumed in cubic meters (m³)
                    </p>
                  </div>
                  <span className="text-xs font-mono tabular-nums font-semibold text-blue-400">
                    6-Cycle View
                  </span>
                </div>

                {chartReadings.length > 0 ? (
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 pt-8 h-64 flex items-end justify-around relative">
                    <div className="absolute left-4 top-3 text-[10px] font-mono text-slate-500">
                      Y-Axis: m³ Consumption
                    </div>
                    {chartReadings.map((r, idx) => {
                      const maxVal = Math.max(...chartReadings.map(c => c.consumption), 30);
                      const barHeight = Math.max(20, Math.min(180, (r.consumption / maxVal) * 170));
                      const isAbnormal = r.status === 'flagged_abnormal' || r.consumption > 40;

                      return (
                        <div key={`chart-cons-${r.id || r.billingPeriod || idx}`} className="flex flex-col items-center space-y-2 w-14 group">
                          <span className="text-[10px] font-mono tabular-nums font-bold text-slate-300 opacity-85 group-hover:opacity-100 transition">
                            {r.consumption} m³
                          </span>
                          <div 
                            className={`w-8 rounded-t-lg transition-all duration-500 ${
                              isAbnormal 
                                ? 'bg-rose-500 hover:bg-rose-400 shadow-sm' 
                                : 'bg-blue-500 hover:bg-blue-400 shadow-sm'
                            }`}
                            style={{ height: `${barHeight}px` }}
                            title={`${r.billingPeriod}: ${r.consumption} m³`}
                          ></div>
                          <span className="text-[10px] font-medium text-slate-400 truncate w-full text-center">
                            {r.billingPeriod.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-64 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-center text-xs text-slate-500">
                    No consumption data recorded yet.
                  </div>
                )}
              </div>

              {/* Monthly Billing Chart */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Monthly Billing History
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      Calculated tariff costs in Philippine Pesos (₱)
                    </p>
                  </div>
                  <span className="text-xs font-mono tabular-nums font-semibold text-indigo-400">
                    Tariff Tier
                  </span>
                </div>

                {chartBillings.length > 0 ? (
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 pt-8 h-64 flex items-end justify-around relative">
                    <div className="absolute left-4 top-3 text-[10px] font-mono text-slate-500">
                      Y-Axis: Billed Amount (₱)
                    </div>
                    {chartBillings.map((r, idx) => {
                      const cost = calculateCostOf(r, consumerRecord.consumerType);
                      const maxCost = Math.max(...chartBillings.map(c => calculateCostOf(c, consumerRecord.consumerType)), 500);
                      const barHeight = Math.max(20, Math.min(180, (cost / maxCost) * 170));
                      const isPaid = r.paymentStatus === 'paid';

                      return (
                        <div key={`chart-cost-${r.id || r.billingPeriod || idx}`} className="flex flex-col items-center space-y-2 w-14 group">
                          <span className="text-[10px] font-mono tabular-nums font-bold text-slate-300 opacity-85 group-hover:opacity-100 transition">
                            ₱{cost > 999 ? `${(cost/1000).toFixed(1)}k` : cost.toFixed(0)}
                          </span>
                          <div 
                            className={`w-8 rounded-t-lg transition-all duration-500 ${
                              isPaid 
                                ? 'bg-emerald-500 hover:bg-emerald-400 shadow-sm' 
                                : 'bg-amber-500 hover:bg-amber-400 shadow-sm'
                            }`}
                            style={{ height: `${barHeight}px` }}
                            title={`${r.billingPeriod}: ₱${cost.toFixed(2)} (${isPaid ? 'PAID' : 'UNPAID'})`}
                          ></div>
                          <span className="text-[10px] font-medium text-slate-400 truncate w-full text-center">
                            {r.billingPeriod.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-64 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-center text-xs text-slate-500">
                    No official billings issued by Administration yet.
                  </div>
                )}
              </div>

            </div>

            {/* RECENT BILLS LIST & RECENT READINGS LIST */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Recent Bills List (7 Cols) */}
              <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <ReceiptText className="h-4 w-4 text-blue-400" />
                    <span>Recent Bills</span>
                  </h3>
                  <button 
                    onClick={() => setActiveTab('bills')}
                    className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center cursor-pointer"
                  >
                    <span>View All Bills</span>
                    <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                  </button>
                </div>

                <div className="divide-y divide-slate-800">
                  {billedReadings.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                      <ReceiptText className="h-8 w-8 mx-auto text-slate-600" />
                      <p className="font-semibold text-slate-300">No billing statements issued yet.</p>
                      <p className="text-[11px] text-slate-500">Statements and receipts will appear here automatically once billing is issued by Administration.</p>
                    </div>
                  ) : (
                    billedReadings.slice(0, 3).map((r, idx) => {
                      const cost = calculateCostOf(r, consumerRecord.consumerType);
                      const isPaid = r.paymentStatus === 'paid';
                      const isPartial = r.paymentStatus === 'partial';
                      const paidAmt = r.paidAmount || 0;
                      const remainingDue = Math.max(0, cost - paidAmt);

                      const isHighlight = highlightedReadingId === r.id;

                      return (
                        <div 
                          key={`dash-bill-${r.id || idx}`} 
                          className={`py-3.5 px-3 rounded-2xl transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                            isHighlight ? 'bg-blue-950/50 border border-blue-500/50 shadow-xs' : 'hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-xs font-bold ${isHighlight ? 'text-blue-300' : 'text-white'}`}>
                                {r.billingPeriod} Statement
                              </span>
                              <span aria-hidden="true" className="text-slate-600">·</span>
                              <span className={`text-[11px] font-semibold ${
                                isPaid 
                                  ? 'text-emerald-400' 
                                  : isPartial
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                              }`}>
                                {isPaid ? 'Paid in Full' : isPartial ? `Partial (₱${remainingDue.toFixed(2)} Due)` : 'Unpaid'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium">
                              Consumption: <strong className="text-slate-200 font-mono tabular-nums font-bold">{r.consumption} m³</strong> · Due: <span className="text-slate-300 font-semibold">{r.dueDate || '20th of Month'}</span>
                            </p>
                            {isPartial && (
                              <p className="text-[11px] text-amber-400 font-semibold font-mono tabular-nums">
                                Credited: ₱{paidAmt.toFixed(2)} · Remaining: ₱{remainingDue.toFixed(2)}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center space-x-3 text-right shrink-0 w-full sm:w-auto justify-between sm:justify-end">
                            <div>
                              <span className="font-mono tabular-nums font-black text-white text-sm block">
                                {isPartial ? `₱${remainingDue.toFixed(2)}` : `₱${cost.toFixed(2)}`}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono tabular-nums font-medium block">
                                {isPaid 
                                  ? (r.paymentDate ? `Paid ${r.paymentDate}` : 'Settled')
                                  : isPartial 
                                  ? `Total Bill ₱${cost.toFixed(2)}` 
                                  : 'Amount Payable'}
                              </span>
                            </div>
                            {isPaid ? (
                              <button
                                onClick={() => setReceiptDetailModal(r)}
                                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer"
                                id={`dashboard-receipt-btn-${r.id}`}
                                title="Click to view Official Electronic Payment Receipt"
                              >
                                <ReceiptText className="h-4 w-4" />
                                <span>Receipt</span>
                              </button>
                            ) : isPartial ? (
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => setReceiptDetailModal(r)}
                                  className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer"
                                  title="View Partial Payment Receipt"
                                >
                                  <ReceiptText className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveTab('bills');
                                    handleStartPayment(r, 'full');
                                  }}
                                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer"
                                  id={`dashboard-pay-partial-${r.id}`}
                                >
                                  <CreditCard className="h-4 w-4" />
                                  <span>Pay ₱{remainingDue.toFixed(2)}</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setActiveTab('bills');
                                  handleStartPayment(r, 'full');
                                }}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer"
                                id={`dashboard-pay-btn-${r.id}`}
                              >
                                <CreditCard className="h-4 w-4" />
                                <span>Pay Bill</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Recent Readings List (5 Cols) */}
              <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity className="h-4 w-4 text-sky-400" />
                    <span>Recent Readings</span>
                  </h3>
                  <button 
                    onClick={() => setActiveTab('usage')}
                    className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center cursor-pointer"
                  >
                    <span>Full Ledger</span>
                    <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                  </button>
                </div>

                <div className="divide-y divide-slate-800">
                  {readings.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                      <Activity className="h-8 w-8 mx-auto text-slate-600" />
                      <p className="font-semibold text-slate-300">No physical readings logged yet.</p>
                      <p className="text-[11px] text-slate-500">Field meter recordings will appear here in chronological order.</p>
                    </div>
                  ) : (
                    readings.slice(0, 4).map((r, idx) => {
                      const presVal = r.presentReading ?? r.currentReading;
                      return (
                        <div key={`dash-read-${r.id || idx}`} className="py-3.5 space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-200">
                              {r.billingPeriod || r.readingDate}
                              <span className="text-[10px] text-slate-500 font-normal ml-1.5">({r.readingDate})</span>
                            </span>
                            <span className={`text-[11px] font-semibold ${
                              r.status === 'flagged_abnormal'
                                ? 'text-rose-400'
                                : 'text-emerald-400'
                            }`}>
                              {r.status === 'flagged_abnormal' ? 'High / Flagged' : 'Verified'}
                            </span>
                          </div>
                          <div className="flex justify-between items-baseline text-xs">
                            <span className="text-slate-400 font-mono tabular-nums text-[11px]">
                              Prev {r.previousReading} → Pres {presVal} m³
                            </span>
                            <span className="font-mono tabular-nums font-black text-sky-400 text-sm">
                              {r.consumption} m³
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 2: MY BILLS                                           */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'bills' && (
          <div className="space-y-6 animate-fade-in" id="consumer-tab-bills">
            
            {/* Complete Bills Search, Filter & Responsive Ledger */}
            {(() => {
              const filteredBills = billedReadings
                .filter(r => {
                  if (billFilter === 'unpaid') return r.paymentStatus !== 'paid';
                  if (billFilter === 'paid') return r.paymentStatus === 'paid';
                  if (billFilter === 'partial') return r.paymentStatus === 'partial';
                  return true;
                })
                .filter(r =>
                  smartMatch(consumerBillSearch, [
                    r.billingPeriod,
                    r.id,
                    r.orNumber,
                    r.paymentReference,
                    r.transactionId,
                    r.dueDate,
                    r.readingDate,
                    r.meterNumber,
                    r.paymentStatus || 'unpaid',
                    `${r.consumption} m3`,
                    calculateCostOf(r, consumerRecord?.consumerType).toFixed(2)
                  ])
                );
              const paginatedBills = filteredBills.slice((consumerBillsPage - 1) * 10, consumerBillsPage * 10);

              return (
                <>
                  {/* Header, Smart Search & Filter Controls */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-lg space-y-5 text-white">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
                      <div>
                        <div className="flex items-center space-x-2.5">
                          <span className="p-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl">
                            <ReceiptText className="h-4 w-4" />
                          </span>
                          <h3 className="text-base font-black text-white uppercase tracking-wider">
                            Complete Water Bill History
                          </h3>
                        </div>
                        <p className="text-xs text-slate-400 mt-1.5 font-medium">
                          Audit all historical bills, due dates, outstanding dues, and official receipts.
                        </p>
                      </div>

                      {/* Status Filter Tabs */}
                      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-950/90 rounded-2xl border border-slate-800 shadow-inner">
                        <div className="hidden sm:flex items-center space-x-1.5 pl-2.5 pr-1 text-slate-400 text-[11px] font-black uppercase tracking-wider">
                          <ListFilter className="h-3.5 w-3.5 text-blue-400" />
                          <span>Filter:</span>
                        </div>

                        <button
                          onClick={() => setBillFilter('all')}
                          className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center space-x-1.5 cursor-pointer ${
                            billFilter === 'all' 
                              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 border border-blue-500' 
                              : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80'
                          }`}
                          id="filter-bills-all"
                        >
                          <span>All</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                            billFilter === 'all' ? 'bg-black/30 text-white' : 'bg-slate-800 text-slate-300'
                          }`}>
                            {billedReadings.length}
                          </span>
                        </button>

                        <button
                          onClick={() => setBillFilter('unpaid')}
                          className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center space-x-1.5 cursor-pointer ${
                            billFilter === 'unpaid' 
                              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 border border-rose-500' 
                              : 'bg-slate-900 text-rose-300 hover:text-rose-200 hover:bg-rose-950/40 border border-rose-900/60'
                          }`}
                          id="filter-bills-unpaid"
                        >
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          <span>Unpaid</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                            billFilter === 'unpaid' ? 'bg-black/30 text-white' : 'bg-rose-950/80 text-rose-300'
                          }`}>
                            {unpaidBills.length}
                          </span>
                        </button>

                        <button
                          onClick={() => setBillFilter('partial')}
                          className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center space-x-1.5 cursor-pointer ${
                            billFilter === 'partial' 
                              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 border border-amber-500' 
                              : 'bg-slate-900 text-amber-300 hover:text-amber-200 hover:bg-amber-950/40 border border-amber-900/60'
                          }`}
                          id="filter-bills-partial"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>Partial</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                            billFilter === 'partial' ? 'bg-black/30 text-white' : 'bg-amber-950/80 text-amber-300'
                          }`}>
                            {partialBills.length}
                          </span>
                        </button>

                        <button
                          onClick={() => setBillFilter('paid')}
                          className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center space-x-1.5 cursor-pointer ${
                            billFilter === 'paid' 
                              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 border border-emerald-500' 
                              : 'bg-slate-900 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-950/40 border border-emerald-900/60'
                          }`}
                          id="filter-bills-paid"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span>Paid</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                            billFilter === 'paid' ? 'bg-black/30 text-white' : 'bg-emerald-950/80 text-emerald-300'
                          }`}>
                            {paidBills.length}
                          </span>
                        </button>
                      </div>
                    </div>

                    <SmartSearchBar
                      variant="dark"
                      value={consumerBillSearch}
                      onChange={setConsumerBillSearch}
                      resultCount={filteredBills.length}
                      totalCount={billedReadings.length}
                      placeholder="Smart search bills by billing period, OR #, reference ID, amount, m³, due date, or status..."
                      id="consumer-bills-smart-search"
                    />
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl text-slate-100">
                  {/* Desktop & Tablet Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-950 text-slate-300 font-black uppercase text-[11px] tracking-wider border-b border-slate-800">
                        <tr>
                          <th className="px-4 py-3.5 whitespace-nowrap">Billing Period</th>
                          <th className="px-4 py-3.5 whitespace-nowrap">Index (m³)</th>
                          <th className="px-4 py-3.5 whitespace-nowrap">Consumption</th>
                          <th className="px-4 py-3.5 whitespace-nowrap">Gross Amount</th>
                          <th className="px-4 py-3.5 whitespace-nowrap">Paid / Credit</th>
                          <th className="px-4 py-3.5 whitespace-nowrap">Net Balance Due</th>
                          <th className="px-4 py-3.5 whitespace-nowrap">Due Date</th>
                          <th className="px-4 py-3.5 whitespace-nowrap">Status</th>
                          <th className="px-4 py-3.5 text-right whitespace-nowrap">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium">
                        {paginatedBills.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                              <div className="max-w-md mx-auto space-y-2">
                                <ReceiptText className="h-8 w-8 mx-auto text-slate-600" />
                                <p className="text-sm font-bold text-slate-200">
                                  {billedReadings.length === 0
                                    ? 'No Official Billings or Receipts Issued Yet'
                                    : 'No Matching Bills Found'}
                                </p>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                  {billedReadings.length === 0
                                    ? 'Your billing statements and official receipts will appear here automatically once Tagoloan Water District Administration generates and issues your billing.'
                                    : 'Try clearing your search query or switching the status filter above.'}
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : paginatedBills.map((r, idx) => {
                        const totalAmount = calculateCostOf(r, consumerRecord.consumerType);
                        const isPaid = r.paymentStatus === 'paid';
                        const isPartial = r.paymentStatus === 'partial';
                        const paidAmt = r.paidAmount || 0;
                        const remainingDue = Math.max(0, totalAmount - paidAmt);
                        const isHighlight = highlightedReadingId === r.id;

                        return (
                          <tr 
                            key={`tbl-bill-${r.id || idx}`} 
                            className={`transition-colors duration-150 ${
                              isHighlight 
                                ? 'bg-blue-950/80 border-l-4 border-l-blue-500 ring-1 ring-blue-500/40 text-white' 
                                : 'hover:bg-slate-800/60'
                            }`}
                          >
                            {/* Billing Period & ID */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <div className="flex items-center space-x-2">
                                <span className={`font-black text-xs ${isHighlight ? 'text-blue-300 font-extrabold' : 'text-white'}`}>
                                  {r.billingPeriod}
                                </span>
                                {isHighlight && (
                                  <span className="px-2 py-0.5 bg-blue-600 text-white font-black text-[9px] uppercase tracking-wider rounded shadow-xs">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-400 font-mono font-medium block">
                                Statement #{r.id}
                              </span>
                            </td>

                            {/* Meter Readings Index (Previous -> Present) */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono tabular-nums text-slate-300 font-medium">
                              <div>
                                <span className="text-slate-400">Prev {r.previousReading}</span> → <strong className="text-white font-bold">Pres {r.presentReading ?? r.currentReading}</strong>
                              </div>
                              <span className="text-[10px] text-slate-500 block">
                                Current Index: {r.currentReading} m³
                              </span>
                            </td>

                            {/* Consumption Volume */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono tabular-nums font-bold text-sky-300">
                              {r.consumption} m³
                            </td>

                            {/* Gross Bill */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono font-black text-white text-sm">
                              ₱{totalAmount.toFixed(2)}
                            </td>

                            {/* Paid / Credited */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono font-bold text-emerald-300">
                              {paidAmt > 0 ? (
                                <span className="bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/80">
                                  ₱{paidAmt.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-slate-500">₱0.00</span>
                              )}
                            </td>

                            {/* Remaining Balance Due */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono font-black text-sm">
                              {isPaid ? (
                                <span className="text-emerald-400 font-bold">₱0.00</span>
                              ) : isPartial ? (
                                <span className="text-amber-300 font-black bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/80">
                                  ₱{remainingDue.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-rose-300 font-black bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800/80">
                                  ₱{totalAmount.toFixed(2)}
                                </span>
                              )}
                            </td>

                            {/* Due Date */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-slate-300 font-semibold">
                              {r.dueDate || '20th of Month'}
                            </td>

                            {/* Payment Status Badge */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                isPaid 
                                  ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800' 
                                  : isPartial
                                  ? 'bg-amber-950/90 text-amber-300 border border-amber-800'
                                  : 'bg-rose-950/90 text-rose-300 border border-rose-800'
                              }`}>
                                {isPaid ? 'Paid in Full' : isPartial ? 'Partial Balance' : 'Unpaid'}
                              </span>
                            </td>

                            {/* Action Buttons */}
                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center space-x-1.5">
                                <button
                                  onClick={() => {
                                    setBillDetailsReading(r);
                                    setIsBillDetailsOpen(true);
                                  }}
                                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs rounded-xl transition inline-flex items-center space-x-1 cursor-pointer border border-slate-700"
                                  id={`table-breakdown-btn-${r.id}`}
                                  title="View Itemized 3-Pillar Bill Breakdown"
                                >
                                  <Calculator className="h-3.5 w-3.5 text-indigo-400" />
                                  <span className="hidden lg:inline">Breakdown</span>
                                </button>
                                {isPaid ? (
                                  <div className="inline-flex items-center space-x-1.5">
                                    <button
                                      onClick={() => setReceiptDetailModal(r)}
                                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer border border-emerald-500"
                                      id={`table-receipt-btn-${r.id}`}
                                      title="View Official Electronic Payment Receipt"
                                    >
                                      <ReceiptText className="h-3.5 w-3.5" />
                                      <span>Receipt</span>
                                    </button>
                                    {r.paymentReceiptUrl && (
                                      <button
                                        onClick={() => setViewingReceiptReading(r)}
                                        className="px-2.5 py-1.5 bg-blue-900/60 hover:bg-blue-800 text-blue-300 font-bold text-xs rounded-xl transition inline-flex items-center space-x-1 cursor-pointer border border-blue-700"
                                        title="View Uploaded Cashier Slip"
                                      >
                                        <ImageIcon className="h-3.5 w-3.5" />
                                        <span className="hidden xl:inline">Slip</span>
                                      </button>
                                    )}
                                  </div>
                                ) : isPartial ? (
                                  <div className="inline-flex items-center space-x-1.5">
                                    <button
                                      onClick={() => setReceiptDetailModal(r)}
                                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer border border-slate-700"
                                      title="View Partial Receipt"
                                    >
                                      <ReceiptText className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        setUploadReceiptReading(r);
                                        setIsUploadReceiptOpen(true);
                                      }}
                                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-black text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer"
                                      id={`table-pay-partial-${r.id}`}
                                      title="Upload municipal cashier receipt to settle remaining balance"
                                    >
                                      <Upload className="h-3.5 w-3.5" />
                                      <span>Settle Balance (₱{remainingDue.toFixed(2)})</span>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center space-x-1.5">
                                    <button
                                      onClick={() => {
                                        setUploadReceiptReading(r);
                                        setIsUploadReceiptOpen(true);
                                      }}
                                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-black text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer"
                                      id={`table-pay-btn-${r.id}`}
                                      title="Upload physical Official Receipt (OR) issued by municipal cashier"
                                    >
                                      <ReceiptText className="h-3.5 w-3.5" />
                                      <span>Upload Cashier Receipt (OTC)</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View for Perfect Fitting on Small Screens */}
              <div className="block md:hidden divide-y divide-slate-800/80">
                {paginatedBills.length === 0 ? (
                  <div className="p-8 text-center space-y-2 text-slate-400">
                    <ReceiptText className="h-8 w-8 mx-auto text-slate-600" />
                    <p className="text-sm font-bold text-slate-200">
                      {billedReadings.length === 0
                        ? 'No Official Billings or Receipts Issued Yet'
                        : 'No Matching Bills Found'}
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {billedReadings.length === 0
                        ? 'Statements and official receipts will appear here once Administration generates and issues your billing.'
                        : 'Try clearing your search query or switching the status filter.'}
                    </p>
                  </div>
                ) : paginatedBills.map((r, idx) => {
                    const totalAmount = calculateCostOf(r, consumerRecord.consumerType);
                    const isPaid = r.paymentStatus === 'paid';
                    const isPartial = r.paymentStatus === 'partial';
                    const paidAmt = r.paidAmount || 0;
                    const remainingDue = Math.max(0, totalAmount - paidAmt);
                    const isHighlight = highlightedReadingId === r.id;

                    return (
                      <div 
                        key={`mob-bill-${r.id || idx}`}
                        className={`p-4 space-y-3 transition-colors ${
                          isHighlight ? 'bg-blue-950/60 border-l-4 border-l-blue-500' : 'hover:bg-slate-850'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-black text-white text-sm">{r.billingPeriod}</span>
                              {isHighlight && (
                                <span className="px-1.5 py-0.2 bg-blue-600 text-white font-black text-[9px] uppercase rounded">
                                  Selected
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono font-medium">#{r.id}</span>
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            isPaid 
                              ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800' 
                              : isPartial
                              ? 'bg-amber-950/90 text-amber-300 border border-amber-800'
                              : 'bg-rose-950/90 text-rose-300 border border-rose-800'
                          }`}>
                            {isPaid ? 'Paid' : isPartial ? 'Partial' : 'Unpaid'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Consumption</span>
                            <span className="font-mono font-black text-blue-300">{r.consumption} m³</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Gross Bill</span>
                            <span className="font-mono font-black text-white">₱{totalAmount.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Due Date</span>
                            <span className="text-slate-300 font-semibold">{r.dueDate || '20th'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Balance Due</span>
                            <span className={`font-mono font-black ${isPaid ? 'text-emerald-400' : isPartial ? 'text-amber-300' : 'text-rose-300'}`}>
                              ₱{(isPaid ? 0 : isPartial ? remainingDue : totalAmount).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => {
                              setBillDetailsReading(r);
                              setIsBillDetailsOpen(true);
                            }}
                            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs rounded-xl transition flex items-center justify-center space-x-1 cursor-pointer border border-slate-700"
                            id={`mob-breakdown-btn-${r.id}`}
                            title="View itemized breakdown"
                          >
                            <Calculator className="h-3.5 w-3.5 text-indigo-400" />
                            <span>Breakdown</span>
                          </button>
                          {isPaid ? (
                            <div className="flex items-center gap-1.5 flex-1">
                              <button
                                onClick={() => setReceiptDetailModal(r)}
                                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                              >
                                <ReceiptText className="h-3.5 w-3.5" />
                                <span>Receipt</span>
                              </button>
                              {r.paymentReceiptUrl && (
                                <button
                                  onClick={() => setViewingReceiptReading(r)}
                                  className="px-3 py-2 bg-blue-900/60 hover:bg-blue-800 text-blue-300 font-bold text-xs rounded-xl border border-blue-700 cursor-pointer"
                                  title="View Uploaded Slip"
                                >
                                  <ImageIcon className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ) : isPartial ? (
                            <div className="flex items-center space-x-1.5 flex-1">
                              <button
                                onClick={() => setReceiptDetailModal(r)}
                                className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer border border-slate-700"
                                title="Receipt"
                              >
                                <ReceiptText className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setUploadReceiptReading(r);
                                  setIsUploadReceiptOpen(true);
                                }}
                                className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                              >
                                <Upload className="h-3.5 w-3.5" />
                                <span>Settle Balance (₱{remainingDue.toFixed(2)})</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-1">
                              <button
                                onClick={() => {
                                  setUploadReceiptReading(r);
                                  setIsUploadReceiptOpen(true);
                                }}
                                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                              >
                                <ReceiptText className="h-3.5 w-3.5" />
                                <span>Upload Cashier Receipt (OTC)</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              <TablePagination
                currentPage={consumerBillsPage}
                totalItems={filteredBills.length}
                pageSize={10}
                onPageChange={setConsumerBillsPage}
                itemName="water bills"
              />
            </div>
            </>
          );
        })()}

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 3: MY USAGE                                           */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'usage' && (
          <div className="space-y-6 animate-fade-in" id="consumer-tab-usage">
            
            {/* Header & Usage Summary Statistics */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-lg space-y-6 text-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-white">
                    Meter Reading History & Usage Analytics
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Complete timeline of physical meter inspections conducted by authorized Tagoloan Water District field readers.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDirectDownloadUsagePdf}
                  disabled={isDownloadingUsagePdf}
                  className={`px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl flex items-center space-x-2 transition shadow-md shadow-blue-600/20 cursor-pointer self-start sm:self-auto shrink-0 ${
                    isDownloadingUsagePdf ? 'opacity-70 cursor-wait' : ''
                  }`}
                  id="usage-direct-download-pdf-btn"
                >
                  {isDownloadingUsagePdf ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Downloading PDF...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Download Usage Report (PDF)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Household Consumption vs District Average Benchmark Feature Banner */}
              <div className="bg-gradient-to-r from-blue-950 via-indigo-950 to-slate-950 rounded-2xl p-5 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-blue-800/50">
                <div className="flex items-start space-x-3.5">
                  <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl border border-blue-500/30 shrink-0">
                    <Award className="h-5 w-5" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xs font-bold text-white">
                        Monthly Water Usage & Efficiency Report
                      </h4>
                      <span aria-hidden="true" className="text-blue-400/50">·</span>
                      <span className="text-[11px] font-semibold text-emerald-400">
                        PDF Available
                      </span>
                    </div>
                    <p className="text-xs text-blue-100/85 max-w-2xl leading-relaxed">
                      Preview and download an official PDF report summarizing your monthly consumption against the Tagoloan municipal average household usage. Includes efficiency rating, tariff breakdown, and official document signatures.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsUsageReportModalOpen(true)}
                  className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 transition shadow-sm cursor-pointer shrink-0"
                  id="usage-open-report-modal-btn"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Generate PDF Report</span>
                </button>
              </div>

              {/* Summary Stats Grid (calculated from approved cycles when available so pending drafts never double-count) */}
              {(() => {
                const statsSource = readings.length > 0 ? readings : allHistoryReadings;
                const totalVol = statsSource.reduce((acc, r) => acc + (r.consumption || 0), 0);
                const avgVol = statsSource.length > 0 ? (totalVol / statsSource.length).toFixed(1) : '0';
                const peakVol = statsSource.length > 0 ? Math.max(...statsSource.map(r => r.consumption || 0)) : 0;
                const maxBarM3 = Math.max(25, peakVol);
                const monthlySeries = [...statsSource].slice(0, 8).reverse();

                return (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                        <span className="text-[11px] text-slate-400 font-semibold block">Total Volume Consumed</span>
                        <span className="text-2xl font-black font-mono tabular-nums text-sky-400 mt-1 block">
                          {totalVol} m³
                        </span>
                        <span className="text-[11px] text-slate-500 mt-0.5 block font-mono tabular-nums">
                          Latest Index: {currReadingVal} m³
                        </span>
                      </div>
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                        <span className="text-[11px] text-slate-400 font-semibold block">Average Monthly Usage</span>
                        <span className="text-2xl font-black font-mono tabular-nums text-white mt-1 block">
                          {avgVol} m³
                        </span>
                        <span className="text-[11px] text-slate-500 mt-0.5 block">
                          Across {statsSource.length} reading cycle{statsSource.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                        <span className="text-[11px] text-slate-400 font-semibold block">Peak Cycle Consumption</span>
                        <span className="text-2xl font-black font-mono tabular-nums text-rose-400 mt-1 block">
                          {peakVol} m³
                        </span>
                        <span className="text-[11px] text-slate-500 mt-0.5 block font-mono tabular-nums">
                          Baseline Now: {prevReadingVal} → {presReadingVal} m³
                        </span>
                      </div>
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                        <span className="text-[11px] text-slate-400 font-semibold block">Audited Reading Cycles</span>
                        <span className="text-2xl font-black font-mono tabular-nums text-emerald-400 mt-1 block">
                          {readings.length} Approved
                        </span>
                        <span className="text-[11px] text-slate-500 mt-0.5 block">
                          {allHistoryReadings.length > readings.length
                            ? `${allHistoryReadings.length - readings.length} awaiting Admin approval`
                            : 'All field readings verified'}
                        </span>
                      </div>
                    </div>

                    {/* Monthly Consumption & Expense Comparison Breakdown */}
                    {monthlySeries.length > 0 && (
                      <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                              Monthly Water Consumption & Reading Progression
                            </h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Cycle-by-cycle comparison of Previous baseline, Present inspection reading, net m³ consumed, and billed expense.
                            </p>
                          </div>
                          <span className="text-[11px] font-mono tabular-nums text-slate-400">
                            Showing {monthlySeries.length} recent cycle{monthlySeries.length === 1 ? '' : 's'}
                          </span>
                        </div>

                        <div className="space-y-3">
                          {monthlySeries.map((cycleRead, idx) => {
                            const priorCycle = idx > 0 ? monthlySeries[idx - 1] : null;
                            const deltaM3 = priorCycle ? (cycleRead.consumption || 0) - (priorCycle.consumption || 0) : 0;
                            const presIndex = cycleRead.presentReading ?? cycleRead.currentReading;
                            const pctWidth = Math.max(6, Math.min(100, Math.round(((cycleRead.consumption || 0) / maxBarM3) * 100)));
                            const estBill = calculateCostOf(cycleRead, consumerRecord?.consumerType);
                            const spikeFlag =
                              cycleRead.status === 'flagged_abnormal' ||
                              (cycleRead.consumption || 0) >= 45 ||
                              (priorCycle && priorCycle.consumption >= 5 && deltaM3 >= 12);

                            return (
                              <div key={`monthly-prog-${cycleRead.id || idx}`} className="space-y-1.5">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                                    <span className="font-bold text-white">{cycleRead.billingPeriod || cycleRead.readingDate}</span>
                                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                                      Prev {cycleRead.previousReading} → Pres {presIndex} m³
                                    </span>
                                    {spikeFlag && (
                                      <span className="text-[11px] font-semibold text-rose-400">
                                        · High Usage Spike
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 font-mono tabular-nums">
                                    {priorCycle && (
                                      <span className={`text-[11px] font-semibold ${
                                        deltaM3 > 0 ? 'text-rose-400' : deltaM3 < 0 ? 'text-emerald-400' : 'text-slate-500'
                                      }`}>
                                        {deltaM3 > 0 ? `+${deltaM3} m³` : deltaM3 < 0 ? `${deltaM3} m³` : '0 m³'} vs prev
                                      </span>
                                    )}
                                    <span className="font-black text-sky-400">{cycleRead.consumption} m³</span>
                                    <span className="text-slate-300 font-bold">₱{estBill.toFixed(2)}</span>
                                  </div>
                                </div>
                                <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      spikeFlag ? 'bg-rose-500' : 'bg-sky-500'
                                    }`}
                                    style={{ width: `${pctWidth}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Comprehensive Reading History Table */}
            {(() => {
              const filteredUsageReadings = allHistoryReadings.filter(r =>
                smartMatch(consumerUsageSearch, [
                  r.readingDate,
                  r.billingPeriod,
                  r.meterNumber,
                  `${r.consumption} m3`,
                  r.previousReading,
                  r.presentReading ?? r.currentReading,
                  r.currentReading,
                  r.status,
                  r.meterReaderName,
                  r.notes
                ])
              );
              const paginatedUsageReadings = filteredUsageReadings.slice((consumerUsagePage - 1) * 10, consumerUsagePage * 10);
              return (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl text-slate-100">
                  <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black text-white uppercase tracking-wider">Historical Meter Reading Log (Previous · Present · Current)</h4>
                      <p className="text-xs text-slate-400 mt-0.5">Complete ledger preserving every Previous baseline, Present inspection reading, Current dial index, consumption variance, and billed statement.</p>
                    </div>
                    <div className="w-full sm:w-96">
                      <SmartSearchBar
                        variant="dark"
                        value={consumerUsageSearch}
                        onChange={setConsumerUsageSearch}
                        resultCount={filteredUsageReadings.length}
                        totalCount={allHistoryReadings.length}
                        placeholder="Search period, date, prev/present index, m³, or status..."
                        id="consumer-usage-smart-search"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-slate-950 text-slate-300 font-bold text-xs border-b border-slate-800">
                        <tr>
                          <th className="px-5 py-4">Billing Cycle & Date</th>
                          <th className="px-5 py-4">Previous Reading</th>
                          <th className="px-5 py-4">Present Reading</th>
                          <th className="px-5 py-4">Current & Usage (m³)</th>
                          <th className="px-5 py-4">Bill & Expense</th>
                          <th className="px-5 py-4">Status & Leak Check</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                        {paginatedUsageReadings.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                              {consumerUsageSearch.trim()
                                ? `No meter readings match "${consumerUsageSearch}".`
                                : 'No meter reading inspections recorded yet for this account.'}
                            </td>
                          </tr>
                        ) : (
                          paginatedUsageReadings.map((r, idx) => {
                            const fullIdx = allHistoryReadings.findIndex(item => item.id === r.id);
                            const olderRead = fullIdx >= 0 ? allHistoryReadings[fullIdx + 1] : null;
                            const diffVsOlder = olderRead ? (r.consumption || 0) - (olderRead.consumption || 0) : null;
                            const presIndex = r.presentReading ?? r.currentReading;
                            const billIssued = isOfficialBillIssued(r);
                            const billTotal = calculateCostOf(r, consumerRecord?.consumerType);
                            const highUsage =
                              r.status === 'flagged_abnormal' ||
                              (r.consumption || 0) >= 45 ||
                              (olderRead && olderRead.consumption >= 5 && (diffVsOlder || 0) >= 12);

                            return (
                              <tr key={`usage-tbl-${r.id || idx}`} className="hover:bg-slate-800/60 transition">
                                <td className="px-5 py-4">
                                  <span className="font-bold text-white block">{r.billingPeriod || 'Field Cycle'}</span>
                                  <span className="text-[11px] text-slate-400 font-mono tabular-nums block mt-0.5">
                                    Read: {r.readingDate} · #{r.meterNumber}
                                  </span>
                                </td>
                                <td className="px-5 py-4 font-mono tabular-nums">
                                  <span className="text-slate-200 font-bold text-sm">{r.previousReading} m³</span>
                                  <span className="text-[10px] text-slate-500 block">Prior baseline</span>
                                </td>
                                <td className="px-5 py-4 font-mono tabular-nums">
                                  <span className="text-white font-bold text-sm">{presIndex} m³</span>
                                  <span className="text-[10px] text-blue-400/90 block">Inspection index</span>
                                </td>
                                <td className="px-5 py-4 font-mono tabular-nums">
                                  <div className="flex items-baseline gap-2">
                                    <span className="font-black text-sky-400 text-sm">{r.consumption} m³</span>
                                    <span className="text-[11px] text-slate-400">(Index {r.currentReading})</span>
                                  </div>
                                  {diffVsOlder !== null ? (
                                    <span className={`text-[10px] font-semibold block mt-0.5 ${
                                      diffVsOlder > 0 ? 'text-rose-400' : diffVsOlder < 0 ? 'text-emerald-400' : 'text-slate-500'
                                    }`}>
                                      {diffVsOlder > 0 ? `+${diffVsOlder} m³` : diffVsOlder < 0 ? `${diffVsOlder} m³` : 'Same m³'} vs prior read
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-500 block mt-0.5">Initial baseline cycle</span>
                                  )}
                                </td>
                                <td className="px-5 py-4 font-mono tabular-nums">
                                  {billIssued ? (
                                    <div className="space-y-1">
                                      <span className="font-bold text-white block">₱{billTotal.toFixed(2)}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (r.paymentStatus === 'paid') {
                                            setReceiptDetailModal(r);
                                          } else {
                                            setBillDetailsReading(r);
                                            setIsBillDetailsOpen(true);
                                          }
                                        }}
                                        className="text-[11px] font-sans font-bold text-sky-400 hover:text-sky-300 hover:underline cursor-pointer"
                                      >
                                        {r.paymentStatus === 'paid' ? 'View Receipt →' : 'View Bill Notice →'}
                                      </button>
                                    </div>
                                  ) : (
                                    <div>
                                      <span className="text-slate-400 font-semibold block">₱{billTotal.toFixed(2)} est.</span>
                                      <span className="text-[10px] font-sans text-amber-400 block">Pending Admin Approval</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-5 py-4">
                                  <span className={`font-semibold text-xs block ${
                                    r.status === 'flagged_abnormal'
                                      ? 'text-rose-400'
                                      : r.status === 'pending'
                                      ? 'text-amber-400'
                                      : 'text-emerald-400'
                                  }`}>
                                    {r.status === 'flagged_abnormal'
                                      ? 'Flagged Abnormal — Pending Review'
                                      : r.status === 'pending'
                                      ? 'Submitted — Awaiting Admin Approval'
                                      : r.paymentStatus === 'paid'
                                      ? 'Approved & Paid'
                                      : 'Approved & Billed'}
                                  </span>
                                  <span className={`text-[11px] block mt-0.5 ${
                                    highUsage ? 'text-rose-300/90' : 'text-slate-400'
                                  }`}>
                                    {highUsage
                                      ? 'Elevated consumption — check pipes/valves'
                                      : r.notes || 'Normal consumption trajectory'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <TablePagination
                    currentPage={consumerUsagePage}
                    totalItems={filteredUsageReadings.length}
                    pageSize={10}
                    onPageChange={setConsumerUsagePage}
                    itemName="reading records"
                  />
                </div>
              );
            })()}

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE: SERVICE REPORTS & CONCERNS                            */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'reports' && consumerRecord && (
          <ConsumerReportsSection
            consumer={consumerRecord}
            currentUser={currentUser}
            reports={reports}
            onRefreshReports={() => syncConsumerReportsAndNotifications(false)}
            selectedReportId={selectedReportId}
            onClearSelectedReport={() => setSelectedReportId(null)}
          />
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 4: NOTIFICATIONS                                      */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'notifications' && (
          <div className="space-y-6 animate-fade-in" id="consumer-tab-notifications">
            
            {/* Notifications Search, Filter & Grid */}
            {(() => {
              const cleanAnnouncements = sanitizeAnnouncements(announcements);
              const announcementTitleKeys = new Set(
                cleanAnnouncements
                  .map(ann => normalizeAdvisoryComparisonTitle(ann.title))
                  .filter(Boolean)
              );

              // Prevent duplicate cards when a published District Advisory exists in both `announcements` and broadcast `notifications`
              const displayNotifications = notifications.filter(n => {
                const effType = inferNotificationType(n);
                if (effType === 'announcement') {
                  const normKey = normalizeAdvisoryComparisonTitle(n.title);
                  if (normKey && announcementTitleKeys.has(normKey)) {
                    return false;
                  }
                }
                return true;
              });

              const countInstallation = displayNotifications.filter(n => {
                const t = inferNotificationType(n);
                return !isReportNotification(n) && t === 'installation';
              }).length;
              const countMeterStatus = displayNotifications.filter(n => {
                const t = inferNotificationType(n);
                return !isReportNotification(n) && t === 'meter_status';
              }).length;
              const countAccountAndId = displayNotifications.filter(n => {
                const t = inferNotificationType(n);
                return t === 'account_issue' || t === 'disconnection' || t === 'report' || isReportNotification(n);
              }).length;
              const countBilling = displayNotifications.filter(n => {
                const t = inferNotificationType(n);
                return !isReportNotification(n) && (t === 'billing' || t === 'balance');
              }).length;
              const countPayments = displayNotifications.filter(n => {
                const t = inferNotificationType(n);
                return !isReportNotification(n) && (t === 'payment' || t === 'receipt_upload');
              }).length;
              const countStandaloneAdvisoryNotifs = displayNotifications.filter(
                n => !isReportNotification(n) && inferNotificationType(n) === 'announcement'
              ).length;
              const countAdvisories = cleanAnnouncements.length + countStandaloneAdvisoryNotifs;

              const filteredNotifications = displayNotifications
                .filter(n => {
                  const effType = inferNotificationType(n);
                  if (notifFilter === 'all') return true;
                  if (notifFilter === 'installation') return !isReportNotification(n) && effType === 'installation';
                  if (notifFilter === 'meter_status') return !isReportNotification(n) && effType === 'meter_status';
                  if (notifFilter === 'billing') return !isReportNotification(n) && (effType === 'billing' || effType === 'balance');
                  if (notifFilter === 'payment') return !isReportNotification(n) && (effType === 'payment' || effType === 'receipt_upload');
                  if (notifFilter === 'account_issue') return effType === 'account_issue' || effType === 'disconnection' || effType === 'report' || isReportNotification(n);
                  if (notifFilter === 'announcement') return !isReportNotification(n) && effType === 'announcement';
                  return notifFilter === effType;
                })
                .filter(n =>
                  smartMatch(consumerNotifSearch, [
                    n.title,
                    n.subject,
                    n.message,
                    inferNotificationType(n),
                    n.billingPeriod,
                    n.consumerName,
                    n.accountNumber,
                    n.applicationNumber,
                    n.installationStatus,
                    n.meterNumber,
                    n.meterStatus ? formatMeterStatusLabel(n.meterStatus) : undefined,
                    n.remarks,
                    new Date(n.timestamp).toLocaleString()
                  ])
                );
              const showAnnouncements = notifFilter === 'all' || notifFilter === 'announcement';
              const filteredAnnouncements = showAnnouncements
                ? cleanAnnouncements.filter(ann =>
                    smartMatch(consumerNotifSearch, [
                      ann.title,
                      ann.content,
                      ann.category,
                      ann.date,
                      ann.postedBy
                    ])
                  )
                : [];
              const totalVisible = filteredNotifications.length + filteredAnnouncements.length;

              return (
                <>
                  {/* Header, Smart Search & Filter - Dark Slate Theme */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4 text-slate-100">
                    <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-base font-bold text-white">
                            Notification Center & History
                          </h3>
                          {unreadNotifCount > 0 && (
                            <button
                              type="button"
                              onClick={handleMarkAllNotifsRead}
                              className="text-xs font-bold text-blue-400 hover:text-blue-300 underline cursor-pointer"
                            >
                              Mark all {unreadNotifCount} as read
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          Complete history of water meter installation updates, meter status notices, payment confirmations, account activations, and district advisories.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-950 rounded-2xl border border-slate-800">
                        <button
                          type="button"
                          onClick={() => setNotifFilter('all')}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                            notifFilter === 'all' 
                              ? 'bg-blue-600 text-white shadow-sm' 
                              : 'text-slate-300 hover:text-white hover:bg-slate-800'
                          }`}
                          id="filter-notif-all"
                        >
                          All ({displayNotifications.length + cleanAnnouncements.length})
                        </button>
                        {countInstallation > 0 && (
                          <button
                            type="button"
                            onClick={() => setNotifFilter('installation')}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                              notifFilter === 'installation'
                                ? 'bg-cyan-600 text-white shadow-sm'
                                : 'text-cyan-300 hover:text-white hover:bg-slate-800'
                            }`}
                            id="filter-notif-installation"
                          >
                            Installation ({countInstallation})
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setNotifFilter('meter_status')}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                            notifFilter === 'meter_status'
                              ? 'bg-amber-600 text-white shadow-sm'
                              : 'text-amber-300 hover:text-white hover:bg-slate-800'
                          }`}
                          id="filter-notif-meter-status"
                        >
                          Meter Status ({countMeterStatus})
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotifFilter('account_issue')}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                            notifFilter === 'account_issue' 
                              ? 'bg-purple-600 text-white shadow-sm' 
                              : 'text-purple-300 hover:text-white hover:bg-slate-800'
                          }`}
                          id="filter-notif-account"
                        >
                          Account & ID ({countAccountAndId})
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotifFilter('billing')}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                            notifFilter === 'billing' 
                              ? 'bg-sky-600 text-white shadow-sm' 
                              : 'text-sky-300 hover:text-white hover:bg-slate-800'
                          }`}
                          id="filter-notif-billing"
                        >
                          Bills & Balances ({countBilling})
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotifFilter('payment')}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                            notifFilter === 'payment' 
                              ? 'bg-emerald-600 text-white shadow-sm' 
                              : 'text-emerald-300 hover:text-white hover:bg-slate-800'
                          }`}
                          id="filter-notif-payment"
                        >
                          Payments ({countPayments})
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotifFilter('announcement')}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                            notifFilter === 'announcement' 
                              ? 'bg-indigo-600 text-white shadow-sm' 
                              : 'text-indigo-300 hover:text-white hover:bg-slate-800'
                          }`}
                          id="filter-notif-advisories"
                        >
                          Advisories ({countAdvisories})
                        </button>
                      </div>
                    </div>

                    <SmartSearchBar
                      variant="dark"
                      value={consumerNotifSearch}
                      onChange={setConsumerNotifSearch}
                      resultCount={totalVisible}
                      totalCount={displayNotifications.length + cleanAnnouncements.length}
                      placeholder="Smart search water meter status updates, remarks, advisories, account ID notices, or billing alerts..."
                      id="consumer-notifications-smart-search"
                    />
                  </div>

                  {totalVisible === 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 text-center space-y-2 text-slate-400">
                      <Bell className="h-8 w-8 mx-auto text-slate-600" />
                      <p className="text-sm font-bold text-slate-200">
                        {consumerNotifSearch.trim() ? `No notifications match "${consumerNotifSearch}"` : 'No notifications in this category'}
                      </p>
                      <p className="text-xs text-slate-500">Water meter status notices, billing statements, and district advisories will appear here.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                  {/* Account, Installation, Meter Status, Payment, Billing & Standalone Advisory Notifications */}
                  {filteredNotifications.map((n, idx) => {
                    const effectiveType = inferNotificationType(n);
                    const isReport = isReportNotification(n) || effectiveType === 'report';
                    const isAnnouncement = !isReport && effectiveType === 'announcement';
                    const isInstallation = !isReport && !isAnnouncement && effectiveType === 'installation';
                    const isMeterStatus = !isReport && !isAnnouncement && !isInstallation && effectiveType === 'meter_status';
                    const meterStatusNorm = isMeterStatus ? normalizeMeterStatus(n.meterStatus) : 'active';
                    const meterStatusLabel = formatMeterStatusLabel(meterStatusNorm);
                    const isBilling = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && (effectiveType === 'billing' || effectiveType === 'balance');
                    const isReceiptUpload = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'receipt_upload';
                    const isPayment = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && (effectiveType === 'payment' || isReceiptUpload);
                    const isAccountIssue = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'account_issue';
                    const isDisconnection = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'disconnection';
                    const isPartialAlert =
                      !isReport &&
                      (isPayment || isBilling) &&
                      ((n.title || '').toLowerCase().includes('partial') ||
                        (n.message || '').toLowerCase().includes('remaining'));

                    return (
                      <div 
                        key={`notif-tab-${n.id || idx}`}
                        onClick={() => handleOpenNotificationDetailModal(n)}
                        className={`border rounded-2xl p-5 shadow-md flex flex-col lg:flex-row items-start justify-between gap-4 transition cursor-pointer ${
                          !n.read
                            ? 'bg-blue-950/30 border-blue-500/50 text-white hover:border-blue-400/70'
                            : 'bg-slate-900 border-slate-800 text-slate-100 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start space-x-3.5 min-w-0 flex-1">
                          <div className={`p-2.5 rounded-xl border shrink-0 mt-0.5 ${
                            isReport || isAnnouncement
                              ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                              : isInstallation
                              ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                              : isMeterStatus
                              ? meterStatusNorm === 'damaged'
                                ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                : meterStatusNorm === 'maintenance'
                                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                : meterStatusNorm === 'active'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : 'bg-slate-700/40 text-slate-300 border-slate-600/60'
                              : isDisconnection
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              : isAccountIssue
                              ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                              : isPartialAlert
                              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                              : isBilling
                              ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                              : isPayment
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}>
                            {isReport ? (
                              <MessageSquare className="h-5 w-5" />
                            ) : isAnnouncement ? (
                              <Bell className="h-5 w-5" />
                            ) : isInstallation ? (
                              <Wrench className="h-5 w-5" />
                            ) : isMeterStatus ? (
                              <Gauge className="h-5 w-5" />
                            ) : isDisconnection ? (
                              <AlertOctagon className="h-5 w-5" />
                            ) : isAccountIssue ? (
                              <UserCheck className="h-5 w-5" />
                            ) : isPartialAlert ? (
                              <AlertTriangle className="h-5 w-5" />
                            ) : isBilling ? (
                              <ReceiptText className="h-5 w-5" />
                            ) : isPayment ? (
                              <CheckCircle2 className="h-5 w-5" />
                            ) : (
                              <Info className="h-5 w-5" />
                            )}
                          </div>
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className={`font-bold ${
                                isReport || isAnnouncement
                                  ? 'text-indigo-400'
                                  : isInstallation
                                  ? 'text-cyan-400'
                                  : isMeterStatus
                                  ? meterStatusNorm === 'damaged'
                                    ? 'text-rose-400'
                                    : meterStatusNorm === 'maintenance'
                                    ? 'text-amber-400'
                                    : meterStatusNorm === 'active'
                                    ? 'text-emerald-400'
                                    : 'text-slate-300'
                                  : isDisconnection
                                  ? 'text-rose-400'
                                  : isAccountIssue
                                  ? 'text-purple-400'
                                  : isPartialAlert
                                  ? 'text-amber-400'
                                  : isBilling
                                  ? 'text-sky-400'
                                  : isPayment
                                  ? 'text-emerald-400'
                                  : 'text-slate-300'
                              }`}>
                                {isReport
                                  ? 'Reports & Inquiries'
                                  : isAnnouncement
                                  ? 'District Advisory'
                                  : isInstallation
                                  ? 'Water Meter Installation'
                                  : isMeterStatus
                                  ? 'Water Meter Status Notice'
                                  : isDisconnection
                                  ? 'Disconnection Notice'
                                  : isAccountIssue
                                  ? 'Account & ID Notice'
                                  : isPartialAlert
                                  ? 'Remaining Balance'
                                  : isBilling
                                  ? 'Bill Issued'
                                  : isReceiptUpload
                                  ? 'Receipt Verified'
                                  : isPayment
                                  ? 'Payment Success'
                                  : 'System Notice'}
                              </span>
                              {(() => {
                                const cardAttr = getNotificationAdminAttribution(n);
                                const cardThread = findLinkedReportForNotification(n, reports);
                                return (
                                  <>
                                    {cardAttr.isFromAdmin && (
                                      <>
                                        <span aria-hidden="true" className="text-slate-600">·</span>
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-950/90 text-sky-300 border border-sky-800/70 text-[10px] font-bold">
                                          <Building className="h-2.5 w-2.5 text-sky-400" />
                                          <span>{cardAttr.senderBadgeLabel} ({cardAttr.senderName})</span>
                                        </span>
                                      </>
                                    )}
                                    {cardThread && !isReport && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-950/90 text-indigo-300 border border-indigo-800/70 text-[10px] font-mono font-bold">
                                        <span>Replied · {cardThread.ticketNumber}</span>
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                              <span aria-hidden="true" className="text-slate-600">·</span>
                              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                                {new Date(n.timestamp).toLocaleString()}
                              </span>
                              {!n.read && (
                                <>
                                  <span aria-hidden="true" className="text-slate-600">·</span>
                                  <span className="text-[11px] font-bold text-blue-400">Unread</span>
                                </>
                              )}
                            </div>
                            <h4 className="text-sm font-bold text-white">{n.title || n.subject}</h4>

                            {/* Structured Installation Summary Strip */}
                            {isInstallation && (n.applicationNumber || n.installationStatus || n.confirmedDate || n.preferredDate) && (
                              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] my-1.5">
                                {n.applicationNumber && (
                                  <div>
                                    <span className="text-slate-400 uppercase font-bold text-[10px] block">Application No.</span>
                                    <span className="font-mono tabular-nums text-cyan-300 font-bold">{n.applicationNumber}</span>
                                  </div>
                                )}
                                {n.installationStatus && (
                                  <div>
                                    <span className="text-slate-400 uppercase font-bold text-[10px] block">Installation Status</span>
                                    <span className="text-white font-bold">{n.installationStatus}</span>
                                  </div>
                                )}
                                {(n.confirmedDate || n.preferredDate) && (
                                  <div>
                                    <span className="text-slate-400 uppercase font-bold text-[10px] block">
                                      {n.confirmedDate ? 'Confirmed Date' : 'Preferred Date'}
                                    </span>
                                    <span className="font-mono tabular-nums text-slate-200">
                                      {formatInstallationDateDisplay(n.confirmedDate || n.preferredDate)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Structured Water Meter Status Summary Strip */}
                            {isMeterStatus && (
                              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11px] my-1.5">
                                <div>
                                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Consumer</span>
                                  <span className="text-white font-semibold">{n.consumerName || consumerRecord?.name || 'Registered Consumer'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Account Number</span>
                                  <span className="font-mono tabular-nums text-sky-300 font-bold">
                                    #{n.accountNumber || consumerRecord?.accountNumber}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Water Meter Status</span>
                                  <span className={`font-black uppercase ${
                                    meterStatusNorm === 'damaged'
                                      ? 'text-rose-400'
                                      : meterStatusNorm === 'maintenance'
                                      ? 'text-amber-400'
                                      : meterStatusNorm === 'active'
                                      ? 'text-emerald-400'
                                      : 'text-slate-300'
                                  }`}>
                                    {meterStatusLabel}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Date Updated</span>
                                  <span className="font-mono tabular-nums text-slate-200">
                                    {formatMeterStatusUpdateDate(n.statusUpdateDate || n.timestamp)}
                                  </span>
                                </div>
                                {n.remarks && (
                                  <div className="sm:col-span-2 lg:col-span-4 pt-1.5 border-t border-slate-800/80">
                                    <span className="text-slate-400 uppercase font-bold text-[10px] mr-1.5">Administrator Remarks:</span>
                                    <span className="text-slate-200">{n.remarks}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            <p className="text-xs text-slate-300 leading-snug max-w-3xl line-clamp-3">
                              {normalizeCompactParagraphs(n.message, {
                                stripAdminEnvelope: true,
                                hideDuplicateRemarks: isMeterStatus,
                              }).join(' ')}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 self-end lg:self-center shrink-0">
                          {isReport ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenNotificationDetailModal(n);
                                }}
                                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap shrink-0"
                                title="Read & Reply Directly"
                              >
                                <Send className="h-3.5 w-3.5" />
                                <span>Read & Reply</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNotificationClick(n, 'reports');
                                }}
                                className="px-3.5 py-2 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-200 font-bold text-xs rounded-xl border border-indigo-700/60 transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap shrink-0"
                                title="Open in Reports & Inquiries"
                              >
                                <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
                                <span>Full Ticket</span>
                              </button>
                            </>
                          ) : isAnnouncement ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleNotificationClick(n, 'announcements');
                              }}
                              className="px-3.5 py-2 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-200 font-bold text-xs rounded-xl border border-indigo-700/60 transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap shrink-0"
                              title="View in District Advisories"
                            >
                              <Bell className="h-3.5 w-3.5 text-indigo-400" />
                              <span>District Advisories</span>
                            </button>
                          ) : (
                            <>
                              {getNotificationAdminAttribution(n).canReplyDirectly && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenNotificationDetailModal(n);
                                  }}
                                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap shrink-0"
                                  title="Open Official Notice and Reply Directly to Admin"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  <span>{findLinkedReportForNotification(n, reports) ? 'View Reply Thread' : 'Reply to Notice'}</span>
                                </button>
                              )}

                              {isInstallation && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleNotificationClick(n, 'installation');
                                  }}
                                  className="px-3.5 py-2 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 font-bold text-xs rounded-xl border border-cyan-700/60 transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap shrink-0"
                                  title="Open Water Meter Installation Tracker"
                                >
                                  <Wrench className="h-3.5 w-3.5 text-cyan-400" />
                                  <span>Track Installation</span>
                                </button>
                              )}

                              {/* View Account Profile Button (for Account & ID notifications) */}
                              {isAccountIssue && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleNotificationClick(n, 'profile');
                                  }}
                                  className="px-3.5 py-2 bg-purple-950/60 hover:bg-purple-900/80 text-purple-200 font-bold text-xs rounded-xl border border-purple-700/60 transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap shrink-0"
                                  title="Navigate to My Account Profile"
                                >
                                  <UserCheck className="h-3.5 w-3.5 text-purple-400" />
                                  <span>View Account Profile</span>
                                </button>
                              )}

                              {/* View on Dashboard Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNotificationClick(n, 'dashboard');
                                }}
                                className="px-3.5 py-2 bg-blue-950/60 hover:bg-blue-900/80 text-blue-200 font-bold text-xs rounded-xl border border-blue-700/60 transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap shrink-0"
                                title="Navigate to Consumer Dashboard"
                              >
                                <LayoutDashboard className="h-3.5 w-3.5 text-blue-400" />
                                <span>View on Dashboard</span>
                              </button>

                              {/* View in Bills Button */}
                              {(isBilling || isPayment) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleNotificationClick(n, 'bills');
                                  }}
                                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap shrink-0"
                                  title="View Statement in My Bills"
                                >
                                  <ReceiptText className="h-3.5 w-3.5 text-sky-400" />
                                  <span>View in Bills</span>
                                </button>
                              )}

                              {/* Direct Pay Action if Unpaid */}
                              {isBilling && unpaidBills.length > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const targetBill = billedReadings.find(r => r.id === n.readingId || r.billingPeriod === n.billingPeriod) || unpaidBills[0];
                                    setActiveTab('bills');
                                    handleStartPayment(targetBill, 'full');
                                  }}
                                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
                                >
                                  <CreditCard className="h-3.5 w-3.5" />
                                  <span>Settle Now</span>
                                </button>
                              )}
                            </>
                          )}

                          {!n.read && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                mockDb.markNotificationRead(n.id);
                                setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item));
                              }}
                              className="text-xs font-bold text-slate-400 hover:text-white hover:underline shrink-0 cursor-pointer px-2 py-1"
                            >
                              Mark Read
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* District Announcements */}
                  {filteredAnnouncements.map((ann, idx) => (
                    <div
                      key={`ann-${ann.id || idx}`}
                      onClick={() =>
                        handleOpenNotificationDetailModal({
                          id: `ADVISORY-PREVIEW-${ann.id || idx}`,
                          accountNumber: 'ALL',
                          title: ann.title,
                          message: ann.content,
                          timestamp: ann.date || new Date().toISOString(),
                          type: 'announcement',
                          read: true,
                        })
                      }
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-md flex items-start justify-between gap-4 text-slate-100 transition cursor-pointer"
                    >
                      <div className="flex items-start space-x-3.5">
                        <div className="p-2.5 bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 rounded-xl shrink-0 mt-0.5">
                          <Bell className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-indigo-400 capitalize">
                              {ann.category || (ann as any).type || 'Advisory'}
                            </span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span className="text-[11px] font-mono tabular-nums text-slate-400">{ann.date}</span>
                          </div>
                          <h4 className="text-sm font-bold text-white">{ann.title}</h4>
                          <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">{ann.content}</p>
                          <p className="text-[11px] font-medium text-slate-500 pt-1">Issued by: {ann.postedBy || (ann as any).author || 'TWD Administration'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                    </div>
                  )}
                </>
              );
            })()}

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 5: MY PROFILE                                         */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'profile' && (
          <div className="space-y-8 animate-fade-in" id="consumer-tab-profile">
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Edit Personal Information & Contact Details (7 Cols) */}
              <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-lg space-y-6 text-slate-100">
                <div>
                  <h3 className="text-base font-bold text-white">
                    Edit Personal Information & Contact Details
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Keep your registered 11-digit mobile contact, email, and service address updated. Duplicate mobile numbers registered to other accounts are strictly prevented.
                  </p>
                </div>

                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Full Legal Name
                    </label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:outline-none rounded-xl py-2.5 px-3.5 text-xs text-white font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Contact Mobile Number (11 Digits)
                      </label>
                      <input
                        type="tel"
                        required
                        maxLength={13}
                        placeholder="09171234567"
                        value={editContact}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditContact(val);
                          if (val.trim()) {
                            const check = validatePhoneInput(val);
                            setPhoneValidationError(check.error);
                          } else {
                            setPhoneValidationError('Mobile phone number is required.');
                          }
                        }}
                        className={`w-full bg-slate-950 border rounded-xl py-2.5 px-3.5 text-xs text-white font-mono tabular-nums font-bold focus:outline-none ${
                          phoneValidationError
                            ? 'border-rose-500 focus:border-rose-400 ring-1 ring-rose-500/40'
                            : 'border-slate-700 focus:border-blue-500'
                        }`}
                      />
                      {phoneValidationError ? (
                        <p className="mt-1.5 text-[11px] text-rose-400 font-semibold flex items-start gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-400" />
                          <span>{phoneValidationError}</span>
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Must be a unique PH mobile number (e.g. 0917XXXXXXX).
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Registered Email
                      </label>
                      <input
                        type="email"
                        required
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:outline-none rounded-xl py-2.5 px-3.5 text-xs text-white font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Sitio / Zone / House #
                      </label>
                      <input
                        type="text"
                        value={editSitioZone}
                        onChange={(e) => setEditSitioZone(e.target.value)}
                        placeholder="e.g. Zone 2, Sitio Sto. Nino"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:outline-none rounded-xl py-2.5 px-3.5 text-xs text-white placeholder:text-slate-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Full Service Address
                      </label>
                      <input
                        type="text"
                        required
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:outline-none rounded-xl py-2.5 px-3.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  {consumerRecord.consumerType === 'Commercial' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Business Name
                        </label>
                        <input
                          type="text"
                          value={editBusinessName}
                          onChange={(e) => setEditBusinessName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:outline-none rounded-xl py-2.5 px-3.5 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Business Type
                        </label>
                        <input
                          type="text"
                          value={editBusinessType}
                          onChange={(e) => setEditBusinessType(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:outline-none rounded-xl py-2.5 px-3.5 text-xs text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Household Information / Members
                      </label>
                      <input
                        type="text"
                        value={editHouseholdInfo}
                        onChange={(e) => setEditHouseholdInfo(e.target.value)}
                        placeholder="e.g. 4 family members"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:outline-none rounded-xl py-2.5 px-3.5 text-xs text-white placeholder:text-slate-600"
                      />
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSavingProfile || Boolean(phoneValidationError)}
                      className={`px-6 py-2.5 font-bold text-xs rounded-xl shadow-md transition flex items-center space-x-2 ${
                        isSavingProfile || Boolean(phoneValidationError)
                          ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                      }`}
                    >
                      {isSavingProfile ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Saving Profile...</span>
                        </>
                      ) : (
                        <span>Save Profile Changes</span>
                      )}
                    </button>
                  </div>

                </form>
              </div>

              {/* Right Column: Security Credentials & Official Parameters (5 Cols) */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Official Parameters Read-Only Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4 text-slate-100">
                  <h4 className="text-xs font-bold text-slate-300">
                    Official Connection Parameters
                  </h4>

                  <div className="divide-y divide-slate-800 text-xs">
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-400">Official Account Number:</span>
                      <span className="font-mono tabular-nums font-bold text-amber-300">{consumerRecord.accountNumber || 'Pending Issuance'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-400">Water Meter Tag Number:</span>
                      <span className="font-mono tabular-nums font-bold text-sky-400">{consumerRecord.meterNumber || 'Pending Issuance'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-400">Assigned Barangay:</span>
                      <span className="font-bold text-white">{consumerRecord.barangay || 'Poblacion East'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-400">Classification:</span>
                      <span className="font-bold text-white">{consumerRecord.consumerType || 'Residential'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-400">Connection Status:</span>
                      <span className="font-bold text-emerald-400 capitalize">
                        {consumerRecord.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Change Password Form */}
                <form onSubmit={handleUpdatePassword} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4 text-slate-100">
                  <div className="border-b border-slate-800 pb-2.5">
                    <h4 className="text-sm font-bold text-white">
                      Change Account Password
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      New password must be at least 6 characters and different from your current password.
                    </p>
                  </div>

                  {passwordError && (
                    <div className="p-3 bg-rose-950/80 border border-rose-500/40 rounded-xl text-xs text-rose-200 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                      <span className="font-medium">{passwordError}</span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <input
                      type="email"
                      name="username"
                      autoComplete="username"
                      value={currentUser.email || consumerRecord.email || ''}
                      readOnly
                      tabIndex={-1}
                      aria-hidden="true"
                      className="sr-only"
                    />
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Current Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPasswordOld ? 'text' : 'password'}
                          autoComplete="current-password"
                          required
                          value={passwordOld}
                          onChange={(e) => {
                            setPasswordOld(e.target.value);
                            setPasswordError(null);
                          }}
                          placeholder="Enter current password"
                          className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:outline-none rounded-xl py-2.5 pl-3 pr-10 text-xs text-white placeholder:text-slate-600"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswordOld((prev) => !prev)}
                          className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-white transition cursor-pointer"
                          title={showPasswordOld ? 'Hide current password' : 'Show current password'}
                          aria-label={showPasswordOld ? 'Hide current password' : 'Show current password'}
                        >
                          {showPasswordOld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        New Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPasswordNew ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          minLength={6}
                          value={passwordNew}
                          onChange={(e) => {
                            setPasswordNew(e.target.value);
                            setPasswordError(null);
                          }}
                          placeholder="At least 6 characters (must be new)"
                          className={`w-full bg-slate-950 border rounded-xl py-2.5 pl-3 pr-10 text-xs text-white placeholder:text-slate-600 focus:outline-none ${
                            passwordNew && passwordOld && passwordNew === passwordOld
                              ? 'border-rose-500 focus:border-rose-400'
                              : 'border-slate-700 focus:border-blue-500'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswordNew((prev) => !prev)}
                          className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-white transition cursor-pointer"
                          title={showPasswordNew ? 'Hide new password' : 'Show new password'}
                          aria-label={showPasswordNew ? 'Hide new password' : 'Show new password'}
                        >
                          {showPasswordNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {passwordNew && passwordOld && passwordNew === passwordOld && (
                        <p className="mt-1 text-[11px] text-rose-400 font-semibold">
                          New password cannot be the same as your current password.
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Confirm New Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPasswordConfirm ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          value={passwordConfirm}
                          onChange={(e) => {
                            setPasswordConfirm(e.target.value);
                            setPasswordError(null);
                          }}
                          placeholder="Re-enter new password"
                          className={`w-full bg-slate-950 border rounded-xl py-2.5 pl-3 pr-10 text-xs text-white placeholder:text-slate-600 focus:outline-none ${
                            passwordConfirm && passwordNew && passwordConfirm !== passwordNew
                              ? 'border-rose-500 focus:border-rose-400'
                              : 'border-slate-700 focus:border-blue-500'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswordConfirm((prev) => !prev)}
                          className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-white transition cursor-pointer"
                          title={showPasswordConfirm ? 'Hide confirmation password' : 'Show confirmation password'}
                          aria-label={showPasswordConfirm ? 'Hide confirmation password' : 'Show confirmation password'}
                        >
                          {showPasswordConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {passwordConfirm && passwordNew && passwordConfirm !== passwordNew && (
                        <p className="mt-1 text-[11px] text-rose-400 font-semibold">
                          Confirmation does not match new password.
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      isUpdatingPassword ||
                      Boolean(passwordNew && passwordOld && passwordNew === passwordOld) ||
                      Boolean(passwordConfirm && passwordNew && passwordConfirm !== passwordNew)
                    }
                    className={`w-full py-2.5 font-bold text-xs rounded-xl transition flex items-center justify-center space-x-2 ${
                      isUpdatingPassword ||
                      Boolean(passwordNew && passwordOld && passwordNew === passwordOld) ||
                      Boolean(passwordConfirm && passwordNew && passwordConfirm !== passwordNew)
                        ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md cursor-pointer'
                    }`}
                  >
                    {isUpdatingPassword ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Saving New Password...</span>
                      </>
                    ) : (
                      <span>Update & Save Password</span>
                    )}
                  </button>
                </form>

              </div>

            </div>

          </div>
        )}
        </>
      )}

      </main>

      {/* DIGITAL RECEIPT MODAL */}
      {receiptDetailModal && isOfficialBillIssued(receiptDetailModal) && (receiptDetailModal.paymentStatus === 'paid' || receiptDetailModal.paymentStatus === 'partial' || (receiptDetailModal.paidAmount || 0) > 0) && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in print:bg-white print:p-0"
          onClick={() => setReceiptDetailModal(null)}
        >
          <div 
            className="bg-slate-900 border border-slate-800 text-slate-100 print:bg-white print:text-slate-900 print:border-slate-200 rounded-3xl w-full max-w-sm p-6 sm:p-7 space-y-5 relative overflow-hidden shadow-2xl animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setReceiptDetailModal(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer print:hidden"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="text-center space-y-1.5 pt-2">
              <div className="h-12 w-12 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-2xl mx-auto flex items-center justify-center">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <p className="text-[11px] font-semibold text-slate-400 print:text-slate-500">
                Tagoloan Water District
              </p>
              <h3 className="text-base font-black text-white print:text-slate-900 leading-tight">
                Official Electronic Payment Receipt
              </h3>
            </div>

            <div className="border-t border-b border-slate-800 print:border-slate-200 border-dashed py-4 space-y-2.5 text-xs text-slate-300 print:text-slate-700 font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Consumer Name:</span>
                <span className="font-bold text-white print:text-slate-900 font-sans">{consumerRecord.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Billing Cycle:</span>
                <span className="font-bold text-white print:text-slate-900">{receiptDetailModal.billingPeriod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Account Number:</span>
                <span className="font-bold text-amber-300 print:text-slate-900">{receiptDetailModal.accountNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Water Meter Tag:</span>
                <span className="font-bold text-sky-400 print:text-blue-700">{receiptDetailModal.meterNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Method:</span>
                <span className="font-bold text-slate-200 print:text-slate-800 uppercase">{receiptDetailModal.paymentMethod || 'Online Gateway'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Official Receipt #:</span>
                <span className="font-bold text-white print:text-slate-900 uppercase">{receiptDetailModal.orNumber || receiptDetailModal.paymentReference || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Date Settled:</span>
                <span className="font-bold text-slate-200 print:text-slate-800">{receiptDetailModal.paymentDate || 'N/A'}</span>
              </div>
              {(() => {
                const totalCost = calculateCostOf(receiptDetailModal, consumerRecord.consumerType);
                const isPart = receiptDetailModal.paymentStatus === 'partial';
                const paid = receiptDetailModal.paidAmount || totalCost;
                const rem = Math.max(0, totalCost - paid);

                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">Payment Status:</span>
                      <span className={`font-bold font-sans ${isPart ? 'text-amber-400 print:text-amber-700' : 'text-emerald-400 print:text-emerald-700'}`}>
                        {isPart ? 'Partial Payment Credited' : 'Paid in Full (Settled)'}
                      </span>
                    </div>
                    {isPart && (
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-sans">Gross Statement Total:</span>
                        <span className="font-bold text-slate-200 print:text-slate-800">₱{totalCost.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="pt-2.5 border-t border-slate-800 print:border-slate-200 border-dashed flex justify-between items-baseline">
                      <span className="text-sm font-bold text-white print:text-slate-900 font-sans">{isPart ? 'Amount Credited:' : 'Total Amount Paid:'}</span>
                      <span className="text-xl font-black text-emerald-400 print:text-emerald-700 font-sans tabular-nums">
                        ₱{paid.toFixed(2)}
                      </span>
                    </div>
                    {isPart && (
                      <div className="flex justify-between items-baseline pt-1">
                        <span className="text-xs font-bold text-rose-400 print:text-rose-700 font-sans">Remaining Balance Due:</span>
                        <span className="text-sm font-black text-rose-400 print:text-rose-700 font-sans tabular-nums">
                          ₱{rem.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="text-center space-y-0.5">
              <p className="text-sm font-mono tracking-[4px] text-slate-600 print:text-slate-300">|||||| |||| ||||||</p>
              <p className="text-[10px] text-slate-400 font-mono font-semibold">TWD-OR-{receiptDetailModal.id}</p>
            </div>

            <div className="flex gap-2 print:hidden">
              <button 
                onClick={() => window.print()}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Print</span>
              </button>
              <button 
                onClick={() => setReceiptDetailModal(null)}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* BILL DETAILS ITEMIZED BREAKDOWN MODAL */}
      {consumerRecord && isBillDetailsOpen && (billDetailsReading || latestBill) && isOfficialBillIssued(billDetailsReading || latestBill) && (
        <BillDetails
          reading={billDetailsReading || latestBill}
          consumer={consumerRecord}
          calculateCostOf={calculateCostOf}
          isModal={true}
          isOpen={isBillDetailsOpen}
          onClose={() => {
            setIsBillDetailsOpen(false);
            setBillDetailsReading(null);
          }}
          onPayBill={(r) => {
            setIsBillDetailsOpen(false);
            setActiveTab('bills');
            handleStartPayment(r, 'full');
          }}
        />
      )}

      {/* OFFICIAL CASHIER RECEIPT UPLOAD & VALIDATION MODAL */}
      {consumerRecord && (
        <UploadReceiptModal
          isOpen={isUploadReceiptOpen}
          reading={uploadReceiptReading || unpaidBills[0] || latestBill}
          allReadings={billedReadings}
          consumerRecord={consumerRecord}
          onClose={() => {
            setIsUploadReceiptOpen(false);
            setUploadReceiptReading(null);
          }}
          onReceiptValidated={(receipt) => {
            setPaymentConfirmationToast({
              period: receipt.billingPeriod,
              amount: receipt.amountPaid,
              remaining: receipt.remainingBalance,
              isPartial: receipt.isPartial,
              reference: receipt.orNumber,
              date: receipt.paymentDate
            });
            loadConsumerInfo(true);
          }}
          calculateCostOf={calculateCostOf}
        />
      )}

      {/* CONSUMER MONTHLY USAGE & HOUSEHOLD BENCHMARK REPORT MODAL */}
      {consumerRecord && (
        <MonthlyUsageReportModal
          isOpen={isUsageReportModalOpen}
          consumer={consumerRecord}
          readings={readings}
          allHistoryReadings={allHistoryReadings}
          onClose={() => setIsUsageReportModalOpen(false)}
        />
      )}

      {/* UPLOADED PHYSICAL RECEIPT VIEWER MODAL */}
      {viewingReceiptReading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-xl w-full text-white shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-black uppercase tracking-wider">Validated Cashier Slip</h3>
                  <p className="text-xs text-slate-400">Official Physical Receipt Verification</p>
                </div>
              </div>
              <button
                onClick={() => setViewingReceiptReading(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs bg-slate-950 p-3 rounded-2xl border border-slate-800 font-mono">
                <div>
                  <span className="text-slate-500 text-[10px] block">OR Number</span>
                  <strong className="text-amber-400 text-sm">{viewingReceiptReading.orNumber || 'OR-PENDING'}</strong>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 text-[10px] block">Amount Credited</span>
                  <strong className="text-emerald-400 text-sm">₱{(viewingReceiptReading.paidAmount || 0).toFixed(2)}</strong>
                </div>
              </div>

              {viewingReceiptReading.paymentReceiptUrl ? (
                <div className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 p-2 max-h-96 flex items-center justify-center">
                  <img
                    src={viewingReceiptReading.paymentReceiptUrl}
                    alt="Physical Cashier Receipt"
                    className="max-h-80 w-auto object-contain rounded-xl shadow"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400 bg-slate-950 rounded-2xl border border-slate-800">
                  No image photo attached for this statement.
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <span>Billing Period: <strong className="text-slate-200">{viewingReceiptReading.billingPeriod}</strong></span>
                <span>Date: <strong className="text-slate-200">{viewingReceiptReading.paymentDate || 'Verified'}</strong></span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setViewingReceiptReading(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl cursor-pointer transition"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Official Tariff Schedule & Price Hike Modal */}
      {showTariffScheduleModal && (
        <div 
          className="fixed inset-0 z-[120] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
          onClick={() => setShowTariffScheduleModal(false)}
        >
          <div 
            className="bg-slate-900 rounded-3xl max-w-xl w-full border border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6 text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-blue-950 text-blue-400 rounded-2xl border border-blue-800/80 shrink-0">
                  <FileText className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-black uppercase text-blue-300 bg-blue-950 border border-blue-800 px-2 py-0.5 rounded">
                      Official Schedule
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {activeTariff.resolutionNumber}
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-white mt-0.5">
                    Water Tariff Rates & Price Adjustment Schedule
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setShowTariffScheduleModal(false)}
                className="text-slate-400 hover:text-slate-200 font-bold text-sm cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 bg-slate-950 border border-blue-900/60 rounded-2xl text-xs text-slate-200 leading-relaxed">
              <strong className="text-blue-300">Official Advisory:</strong> {activeTariff.memoNotes || 'Tagoloan Water District operational tariff schedule adjustment implemented under Presidential Decree No. 198 and LWUA regulatory guidelines.'}
              <div className="mt-1 text-[11px] text-blue-400 font-medium">
                Effective Implementation Date: <strong className="text-white">{activeTariff.effectiveDate}</strong>
              </div>
            </div>

            {/* Rates Table */}
            <div className="space-y-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-white">
                Active Rate Brackets for {consumerRecord?.consumerType === 'Commercial' ? 'Commercial Connections' : 'Domestic / Residential Connections'}
              </h4>

              <div className="border border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
                <table className="min-w-full text-xs text-left">
                  <thead className="bg-slate-950 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4">Consumption Tier</th>
                      <th className="py-2.5 px-4">Volume Range</th>
                      <th className="py-2.5 px-4 text-right">Approved Rate (₱)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-medium text-slate-200">
                    {consumerRecord?.consumerType === 'Commercial' ? (
                      <>
                        <tr className="bg-blue-950/40">
                          <td className="py-2.5 px-4 font-bold text-white">Lifeline Minimum Base</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">1 – 10 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-blue-400">₱{activeTariff.commercial.baseMinCharge.toFixed(2)} (Flat)</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 1: Incremental</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">11 – 20 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.commercial.tier1_rate.toFixed(2)} / m³</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 2: Commercial</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">21 – 30 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.commercial.tier2_rate.toFixed(2)} / m³</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 3: Commercial</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">31 – 40 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.commercial.tier3_rate.toFixed(2)} / m³</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 4: High Commercial</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">41 – 50 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.commercial.tier4_rate.toFixed(2)} / m³</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 5: Industrial / Max</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">51+ m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.commercial.tier5_rate.toFixed(2)} / m³</td>
                        </tr>
                      </>
                    ) : (
                      <>
                        <tr className="bg-emerald-950/40">
                          <td className="py-2.5 px-4 font-bold text-white">Lifeline Minimum Base</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">1 – 10 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-400">₱{activeTariff.residential.baseMinCharge.toFixed(2)} (Flat)</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 1: Incremental</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">11 – 20 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.residential.tier1_rate.toFixed(2)} / m³</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 2: Standard Domestic</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">21 – 30 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.residential.tier2_rate.toFixed(2)} / m³</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 3: Moderate Domestic</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">31 – 40 m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.residential.tier3_rate.toFixed(2)} / m³</td>
                        </tr>
                        <tr className="hover:bg-slate-850">
                          <td className="py-2.5 px-4">Tier 4: Heavy Consumption</td>
                          <td className="py-2.5 px-4 text-slate-400 font-mono">41+ m³</td>
                          <td className="py-2.5 px-4 text-right font-mono text-white">₱{activeTariff.residential.tier4_rate.toFixed(2)} / m³</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 font-mono">
                <span>Statutory Franchise Tax: <strong className="text-slate-200">{(activeTariff.franchiseTaxRate * 100).toFixed(0)}%</strong></span>
                <span>Late Payment Surcharge: <strong className="text-slate-200">{(activeTariff.latePaymentSurchargeRate * 100).toFixed(0)}%</strong></span>
              </div>
            </div>

            <div className="pt-2 flex justify-end border-t border-slate-800">
              <button
                onClick={() => setShowTariffScheduleModal(false)}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl cursor-pointer transition shadow-md"
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATION DETAIL POP-UP MODAL */}
      {selectedBellNotification && (() => {
        const n = selectedBellNotification;
        const effectiveType = inferNotificationType(n);
        const isReport = isReportNotification(n) || effectiveType === 'report';
        const isAnnouncement = !isReport && effectiveType === 'announcement';
        const isInstallation = !isReport && !isAnnouncement && effectiveType === 'installation';
        const isMeterStatus = !isReport && !isAnnouncement && !isInstallation && effectiveType === 'meter_status';
        const meterStatusNorm = isMeterStatus ? normalizeMeterStatus(n.meterStatus) : 'active';
        const meterStatusLabel = formatMeterStatusLabel(meterStatusNorm);
        const isBilling = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && (effectiveType === 'billing' || effectiveType === 'balance');
        const isReceiptUpload = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'receipt_upload';
        const isPayment = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && (effectiveType === 'payment' || isReceiptUpload);
        const isAccountIssue = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'account_issue';
        const isDisconnection = !isReport && !isAnnouncement && !isInstallation && !isMeterStatus && effectiveType === 'disconnection';
        const isPartialAlert =
          !isReport &&
          (isPayment || isBilling) &&
          ((n.title || '').toLowerCase().includes('partial') ||
            (n.message || '').toLowerCase().includes('remaining'));

        const categoryLabel = isReport
          ? 'Reports & Inquiries Update'
          : isAnnouncement
          ? 'District Advisory'
          : isInstallation
          ? `Water Meter Installation${n.installationStatus ? ` · ${n.installationStatus}` : ''}`
          : isMeterStatus
          ? `Water Meter Status Notice · ${meterStatusLabel}`
          : isDisconnection
          ? 'Disconnection Notice'
          : isAccountIssue
          ? 'Account & Meter ID Notice'
          : isPartialAlert
          ? 'Remaining Balance Notice'
          : isBilling
          ? 'Official Billing Statement'
          : isReceiptUpload
          ? 'Cashier Receipt Verification'
          : isPayment
          ? 'Payment Confirmation'
          : 'System Notice';

        const linkedReading = resolveNotificationLinkedReading(n);
        const reportTarget = isReport ? resolveNotificationReportTarget(n) : null;
        const matchedReport =
          findLinkedReportForNotification(n, reports) ||
          (reportTarget
            ? reports.find(
                r =>
                  r.id === reportTarget ||
                  r.ticketNumber.toUpperCase() === String(reportTarget).toUpperCase()
              )
            : undefined);

        const attribution = getNotificationAdminAttribution(n);
        const isPreviewAdvisory = Boolean(n.id && n.id.startsWith('ADVISORY-PREVIEW-'));
        const canReplyInModal = attribution.canReplyDirectly && !isPreviewAdvisory;
        const effectiveRefNotice =
          n.referencedNotice ||
          matchedReport?.referencedNotice ||
          (!isReport && canReplyInModal ? buildReferencedNoticeFromNotification(n, consumerRecord) : undefined);

        const parsedDate = n.timestamp ? new Date(n.timestamp) : null;
        const formattedTimestamp =
          parsedDate && !Number.isNaN(parsedDate.getTime())
            ? parsedDate.toLocaleString([], {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
            : n.timestamp || 'N/A';

        const rawAcc = (n.accountNumber || '').trim();
        const scopeLabel =
          !rawAcc || rawAcc.toUpperCase() === 'ALL' || isAnnouncement
            ? 'All Registered Consumers (District-Wide)'
            : rawAcc.toUpperCase().startsWith('PENDING')
            ? consumerRecord.accountNumber && !consumerRecord.accountNumber.toUpperCase().startsWith('PENDING')
              ? `Account #${consumerRecord.accountNumber}`
              : n.applicationNumber
              ? `Application #${n.applicationNumber}`
              : 'Pending Account Issuance'
            : `Account #${rawAcc}`;

        const effectiveBillingPeriod = n.billingPeriod || linkedReading?.billingPeriod;
        const effectiveOrNumber =
          n.orNumber ||
          (isPayment ? linkedReading?.orNumber || linkedReading?.paymentReference : undefined);
        const effectiveAmountPaid =
          typeof n.amountPaid === 'number'
            ? n.amountPaid
            : isPayment && typeof linkedReading?.paidAmount === 'number' && linkedReading.paidAmount > 0
            ? linkedReading.paidAmount
            : undefined;
        const effectiveBalance =
          typeof n.remainingBalance === 'number'
            ? n.remainingBalance
            : isBilling && linkedReading
            ? Math.max(
                0,
                calculateCostOf(linkedReading, consumerRecord.consumerType) - (linkedReading.paidAmount || 0)
              )
            : undefined;
        const attachedReceiptImg =
          n.receiptUrl || (isPayment && linkedReading?.paymentReceiptUrl ? linkedReading.paymentReceiptUrl : undefined);

        const humanReplies = matchedReport
          ? mockDb
              .dedupeReplies(matchedReport.replies)
              .filter(
                rep =>
                  !(rep.id || '').startsWith('ACK-') && rep.senderId !== 'system-admin-ack'
              )
          : [];

        const firstReplyMatchesDesc =
          matchedReport &&
          humanReplies.length > 0 &&
          humanReplies[0].senderRole === 'consumer' &&
          humanReplies[0].message.trim().toLowerCase() ===
            (matchedReport.description || '').trim().toLowerCase();

        const followUpReplies = firstReplyMatchesDesc
          ? humanReplies.slice(1)
          : humanReplies;

        const hasAdminHumanReply = humanReplies.some(
          rep => rep.senderRole === 'admin' || rep.senderRole === 'staff'
        );

        const noticeParagraphs = normalizeCompactParagraphs(n.message, {
          stripAdminEnvelope: true,
          hideDuplicateRemarks: isMeterStatus || isInstallation,
        });

        const hasBillingOrAccountSummary = Boolean(
          !isMeterStatus &&
            !isInstallation &&
            !isReport &&
            (effectiveBillingPeriod ||
              linkedReading ||
              effectiveOrNumber ||
              typeof effectiveAmountPaid === 'number' ||
              typeof effectiveBalance === 'number' ||
              (isAccountIssue && !isAccountPending))
        );

        return (
          <div
            className="fixed inset-0 z-[130] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in"
            onClick={() => setSelectedBellNotification(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="notif-detail-modal-title"
          >
            <div
              className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl overflow-hidden flex flex-col animate-scale-up"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Zone 1: Compact Unified Header */}
              <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-start justify-between gap-3 shrink-0">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`p-2 rounded-xl border shrink-0 mt-0.5 ${
                      isReport || isAnnouncement
                        ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                        : isInstallation
                        ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                        : isMeterStatus
                        ? meterStatusNorm === 'damaged'
                          ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                          : meterStatusNorm === 'maintenance'
                          ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          : meterStatusNorm === 'active'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-700/40 text-slate-300 border-slate-600/60'
                        : isDisconnection
                        ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                        : isAccountIssue
                        ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                        : isPartialAlert
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : isBilling
                        ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                        : isPayment
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {isReport ? (
                      <MessageSquare className="h-4 w-4" />
                    ) : isAnnouncement ? (
                      <Bell className="h-4 w-4" />
                    ) : isInstallation ? (
                      <Wrench className="h-4 w-4" />
                    ) : isMeterStatus ? (
                      <Gauge className="h-4 w-4" />
                    ) : isDisconnection ? (
                      <AlertOctagon className="h-4 w-4" />
                    ) : isAccountIssue ? (
                      <UserCheck className="h-4 w-4" />
                    ) : isPartialAlert ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : isBilling ? (
                      <ReceiptText className="h-4 w-4" />
                    ) : isPayment ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Info className="h-4 w-4" />
                    )}
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                      {attribution.isFromAdmin && (
                        <>
                          <span className="font-bold text-sky-300">
                            {attribution.senderBadgeLabel}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                        </>
                      )}
                      <span className="font-semibold text-slate-200">{categoryLabel}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono tabular-nums">{formattedTimestamp}</span>
                    </div>

                    <h3
                      id="notif-detail-modal-title"
                      className="text-sm sm:text-base font-bold text-white leading-snug break-words"
                    >
                      {n.title || n.subject}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                      {attribution.isFromAdmin && (
                        <>
                          <span>
                            Sent by: <strong className="text-sky-300 font-semibold">{attribution.senderFullLabel}</strong>
                          </span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                        </>
                      )}
                      <span>{scopeLabel}</span>
                      {(matchedReport?.ticketNumber || n.ticketNumber) && (
                        <>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="font-mono tabular-nums text-indigo-300 font-semibold">
                            {matchedReport?.ticketNumber || n.ticketNumber}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedBellNotification(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer shrink-0"
                  aria-label="Close notification details"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Zone 2: Clean Compact Summary + Message & Conversation Stream */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3.5 space-y-3 bg-slate-900">
                {/* Compact Summary Bar — Water Meter Installation */}
                {isInstallation && (
                  <div className="rounded-xl bg-slate-950/90 border border-slate-800 px-3.5 py-2.5 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-300">
                        {n.applicationNumber && (
                          <span>
                            Application:{' '}
                            <strong className="font-mono tabular-nums text-cyan-300">
                              {n.applicationNumber}
                            </strong>
                          </span>
                        )}
                        {(n.confirmedDate || n.preferredDate) && (
                          <>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span>
                              {n.confirmedDate ? 'Confirmed Date:' : 'Preferred Date:'}{' '}
                              <strong className="font-mono tabular-nums text-white">
                                {formatInstallationDateDisplay(n.confirmedDate || n.preferredDate)}
                              </strong>
                            </span>
                          </>
                        )}
                      </div>
                      {n.installationStatus && (
                        <span className="font-bold whitespace-nowrap shrink-0 text-cyan-400">
                          {n.installationStatus}
                        </span>
                      )}
                    </div>
                    {n.remarks && n.remarks.trim() && (
                      <p className="text-[11px] text-slate-200 pt-1 border-t border-slate-800/80 leading-snug">
                        <span className="text-slate-400 font-semibold">Admin Remarks: </span>
                        {n.remarks.trim()}
                      </p>
                    )}
                  </div>
                )}

                {/* Compact Summary Bar — Meter Status */}
                {isMeterStatus && (
                  <div className="rounded-xl bg-slate-950/90 border border-slate-800 px-3.5 py-2.5 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-300">
                        <span>
                          Meter:{' '}
                          <strong className="font-mono tabular-nums text-white">
                            #{n.meterNumber || consumerRecord.meterNumber || 'N/A'}
                          </strong>
                        </span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span>
                          Account:{' '}
                          <strong className="font-mono tabular-nums text-sky-300">
                            #{n.accountNumber || consumerRecord.accountNumber}
                          </strong>
                        </span>
                      </div>
                      <span
                        className={`font-bold whitespace-nowrap shrink-0 ${
                          meterStatusNorm === 'damaged'
                            ? 'text-rose-400'
                            : meterStatusNorm === 'maintenance'
                            ? 'text-amber-300'
                            : meterStatusNorm === 'active'
                            ? 'text-emerald-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {n.previousMeterStatus
                          ? `${n.previousMeterStatus} → ${meterStatusLabel}`
                          : `Status: ${meterStatusLabel}`}
                      </span>
                    </div>
                    {n.remarks && n.remarks.trim() && (
                      <p className="text-[11px] text-slate-200 pt-1 border-t border-slate-800/80 leading-snug">
                        <span className="text-slate-400 font-semibold">Admin Remarks: </span>
                        {n.remarks.trim()}
                      </p>
                    )}
                  </div>
                )}

                {/* Compact Summary Bar — Referenced Official Notice on Admin Reply */}
                {isReport && effectiveRefNotice && (() => {
                  const refMeterNorm = effectiveRefNotice.meterStatus
                    ? normalizeMeterStatus(effectiveRefNotice.meterStatus)
                    : null;
                  const refMeterLabel = refMeterNorm ? formatMeterStatusLabel(refMeterNorm) : null;
                  return (
                    <div className="rounded-xl bg-slate-950/90 border border-slate-800 px-3.5 py-2.5 text-xs space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-sky-400 font-semibold mr-1.5">Referenced Notice:</span>
                          <span className="font-bold text-white">{effectiveRefNotice.subject}</span>
                        </div>
                        {refMeterLabel && (
                          <span
                            className={`font-bold text-[11px] whitespace-nowrap shrink-0 ${
                              refMeterNorm === 'damaged'
                                ? 'text-rose-400'
                                : refMeterNorm === 'maintenance'
                                ? 'text-amber-300'
                                : refMeterNorm === 'active'
                                ? 'text-emerald-400'
                                : 'text-slate-300'
                            }`}
                          >
                            {effectiveRefNotice.previousMeterStatus
                              ? `${effectiveRefNotice.previousMeterStatus} → ${refMeterLabel}`
                              : `Meter Status: ${refMeterLabel}`}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                        {effectiveRefNotice.meterNumber && (
                          <>
                            <span>
                              Meter{' '}
                              <strong className="font-mono tabular-nums text-slate-200">
                                #{effectiveRefNotice.meterNumber}
                              </strong>
                            </span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                          </>
                        )}
                        {effectiveRefNotice.accountNumber && (
                          <>
                            <span>
                              Account{' '}
                              <strong className="font-mono tabular-nums text-sky-300">
                                #{effectiveRefNotice.accountNumber}
                              </strong>
                            </span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                          </>
                        )}
                        <span className="font-mono tabular-nums">
                          {formatMeterStatusUpdateDate(
                            effectiveRefNotice.statusUpdateDate || effectiveRefNotice.sentAt
                          )}
                        </span>
                      </div>
                      {effectiveRefNotice.remarks && (
                        <p className="text-[11px] text-slate-300 pt-1 border-t border-slate-800/80 leading-snug">
                          <span className="text-slate-400 font-semibold">Original Admin Remarks: </span>
                          {effectiveRefNotice.remarks}
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Compact Summary Bar — Billing / Payment / Account Identifiers */}
                {hasBillingOrAccountSummary && (
                  <div className="rounded-xl bg-slate-950/90 border border-slate-800 px-3.5 py-2.5 text-xs flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    {effectiveBillingPeriod && (
                      <span>
                        <span className="text-slate-400">Cycle: </span>
                        <strong className="text-white">{effectiveBillingPeriod}</strong>
                      </span>
                    )}
                    {(isBilling || isPayment || isDisconnection) && linkedReading && (
                      <span>
                        <span className="text-slate-400">Readings: </span>
                        <strong className="font-mono tabular-nums text-sky-300">
                          {linkedReading.previousReading} → {linkedReading.presentReading ?? linkedReading.currentReading} m³ ({linkedReading.consumption} m³)
                        </strong>
                      </span>
                    )}
                    {effectiveOrNumber && (
                      <span>
                        <span className="text-slate-400">OR #: </span>
                        <strong className="font-mono tabular-nums text-amber-300">{effectiveOrNumber}</strong>
                      </span>
                    )}
                    {typeof effectiveAmountPaid === 'number' && (
                      <span>
                        <span className="text-slate-400">Paid: </span>
                        <strong className="font-mono tabular-nums text-emerald-400">
                          ₱{effectiveAmountPaid.toFixed(2)}
                        </strong>
                      </span>
                    )}
                    {typeof effectiveBalance === 'number' && (
                      <span>
                        <span className="text-slate-400">Balance: </span>
                        <strong
                          className={`font-mono tabular-nums ${
                            effectiveBalance > 0 ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          ₱{effectiveBalance.toFixed(2)}
                        </strong>
                      </span>
                    )}
                    {linkedReading?.dueDate && (isBilling || isDisconnection) && (
                      <span>
                        <span className="text-slate-400">Due: </span>
                        <strong className="text-amber-300">{linkedReading.dueDate}</strong>
                      </span>
                    )}
                    {isAccountIssue && !isAccountPending && (
                      <>
                        <span>
                          <span className="text-slate-400">Account: </span>
                          <strong className="font-mono tabular-nums text-amber-300">
                            #{consumerRecord.accountNumber}
                          </strong>
                        </span>
                        {consumerRecord.meterNumber && (
                          <span>
                            <span className="text-slate-400">Meter: </span>
                            <strong className="font-mono tabular-nums text-sky-400">
                              #{consumerRecord.meterNumber}
                            </strong>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Primary Message or Unified Conversation Stream */}
                {isReport && matchedReport ? (
                  <div className="space-y-2.5">
                    {/* Consumer's Initial Inquiry / Reply */}
                    <div className="flex flex-col items-end">
                      <div className="max-w-[92%] space-y-1">
                        <div className="flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
                          <span className="font-bold text-slate-200">You ({consumerRecord.name})</span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="font-mono tabular-nums">
                            {new Date(matchedReport.createdAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="rounded-xl bg-slate-800 border border-slate-700 px-3.5 py-2.5 text-xs sm:text-[13px] text-slate-100 leading-snug space-y-1.5">
                          {normalizeCompactParagraphs(matchedReport.description).map((p, idx) => (
                            <p key={idx}>{p}</p>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Chronological Replies */}
                    {followUpReplies.map((rep, rIdx) => {
                      const fromAdmin = rep.senderRole === 'admin' || rep.senderRole === 'staff';
                      const repParagraphs = normalizeCompactParagraphs(rep.message, {
                        stripAdminEnvelope: true,
                      });
                      return (
                        <div
                          key={rep.id || rIdx}
                          className={`flex flex-col ${fromAdmin ? 'items-start' : 'items-end'}`}
                        >
                          <div className="max-w-[92%] space-y-1">
                            <div
                              className={`flex items-center gap-1.5 text-[11px] text-slate-400 ${
                                fromAdmin ? 'justify-start' : 'justify-end'
                              }`}
                            >
                              <span className={fromAdmin ? 'font-bold text-sky-300' : 'font-bold text-slate-200'}>
                                {fromAdmin ? `Admin (${rep.senderName})` : `You (${consumerRecord.name})`}
                              </span>
                              <span aria-hidden="true" className="text-slate-600">·</span>
                              <span className="font-mono tabular-nums">
                                {new Date(rep.timestamp).toLocaleString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <div
                              className={`rounded-xl px-3.5 py-2.5 text-xs sm:text-[13px] leading-snug space-y-1.5 border ${
                                fromAdmin
                                  ? 'bg-blue-950/75 text-slate-100 border-blue-800/70'
                                  : 'bg-slate-800 text-slate-100 border-slate-700'
                              }`}
                            >
                              {repParagraphs.map((p, pIdx) => (
                                <p key={pIdx}>{p}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {!hasAdminHumanReply && (
                      <p className="text-[11px] text-slate-400 text-center pt-1">
                        Delivered to Tagoloan Water District Administration ({matchedReport.ticketNumber}) — awaiting reply.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Compact Normalized Notice Body */}
                    <div className="space-y-1.5 text-[13px] sm:text-sm text-slate-100 leading-snug break-words">
                      {noticeParagraphs.length > 0 ? (
                        noticeParagraphs.map((para, pIdx) => <p key={pIdx}>{para}</p>)
                      ) : (
                        <p>{n.message}</p>
                      )}
                    </div>

                    {/* Attached Receipt Image Preview if Available */}
                    {attachedReceiptImg && (
                      <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-2 flex items-center justify-center max-h-48">
                        <img
                          src={attachedReceiptImg}
                          alt="Attached Payment Receipt"
                          referrerPolicy="no-referrer"
                          className="max-h-44 w-auto object-contain rounded-lg"
                        />
                      </div>
                    )}

                    {/* Inline Thread if Consumer Already Replied to This Official Notice */}
                    {matchedReport && (
                      <div className="pt-2.5 border-t border-slate-800 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-bold text-slate-200">
                            Conversation on This Notice
                          </span>
                          <span className="font-mono tabular-nums text-indigo-300 font-semibold">
                            {matchedReport.ticketNumber}
                          </span>
                        </div>

                        {/* Initial Consumer Reply */}
                        <div className="flex flex-col items-end">
                          <div className="max-w-[92%] space-y-0.5">
                            <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
                              <span className="font-bold text-slate-200">You</span>
                              <span aria-hidden="true" className="text-slate-600">·</span>
                              <span className="font-mono tabular-nums">
                                {new Date(matchedReport.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <div className="rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-slate-100 leading-snug space-y-1">
                              {normalizeCompactParagraphs(matchedReport.description).map((p, idx) => (
                                <p key={idx}>{p}</p>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Follow-up Messages */}
                        {followUpReplies.map((rep, rIdx) => {
                          const fromAdmin = rep.senderRole === 'admin' || rep.senderRole === 'staff';
                          return (
                            <div
                              key={rep.id || rIdx}
                              className={`flex flex-col ${fromAdmin ? 'items-start' : 'items-end'}`}
                            >
                              <div className="max-w-[92%] space-y-0.5">
                                <div
                                  className={`flex items-center gap-1.5 text-[10px] text-slate-400 ${
                                    fromAdmin ? 'justify-start' : 'justify-end'
                                  }`}
                                >
                                  <span className={fromAdmin ? 'font-bold text-sky-300' : 'font-bold text-slate-200'}>
                                    {fromAdmin ? `Admin (${rep.senderName})` : 'You'}
                                  </span>
                                  <span aria-hidden="true" className="text-slate-600">·</span>
                                  <span className="font-mono tabular-nums">
                                    {new Date(rep.timestamp).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                <div
                                  className={`rounded-xl px-3 py-2 text-xs leading-snug space-y-1 border ${
                                    fromAdmin
                                      ? 'bg-blue-950/75 text-slate-100 border-blue-800/70'
                                      : 'bg-slate-800 text-slate-100 border-slate-700'
                                  }`}
                                >
                                  {normalizeCompactParagraphs(rep.message, {
                                    stripAdminEnvelope: true,
                                  }).map((p, pIdx) => (
                                    <p key={pIdx}>{p}</p>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {!hasAdminHumanReply && (
                          <p className="text-[11px] text-slate-400 text-right">
                            Delivered to Administration — awaiting official reply.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Zone 3: Pinned Always-Visible Reply Bar & Compact Footer */}
              <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 shrink-0 space-y-2">
                {canReplyInModal && (
                  <form onSubmit={handleSendBellNotificationReply} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-sky-300 flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {matchedReport
                            ? 'Reply to Administration on this notice thread'
                            : 'Reply directly to Administration about this notice'}
                        </span>
                      </span>
                      <span className="text-slate-400 font-mono tabular-nums text-[10px] shrink-0">
                        {matchedReport ? matchedReport.ticketNumber : 'Notice auto-attached'}
                      </span>
                    </div>

                    <div className="flex items-end gap-2">
                      <textarea
                        rows={2}
                        value={bellReplyText}
                        onChange={(e) => setBellReplyText(e.target.value)}
                        disabled={isSubmittingBellReply}
                        placeholder={
                          isMeterStatus
                            ? `Write your reply regarding this ${meterStatusLabel.toLowerCase()} water meter notice...`
                            : matchedReport
                            ? 'Write a follow-up message to Administration...'
                            : 'Write your reply or question to Administration...'
                        }
                        className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none resize-none leading-snug"
                      />
                      <button
                        type="submit"
                        disabled={isSubmittingBellReply || !bellReplyText.trim()}
                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>{isSubmittingBellReply ? 'Sending...' : 'Send Reply'}</span>
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex items-center justify-between gap-2 pt-0.5 text-xs">
                  <div className="flex flex-wrap items-center gap-3 min-w-0">
                    {(isReport || matchedReport) && (
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(n, 'reports')}
                        className="text-indigo-300 hover:text-indigo-200 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <span>Open in Inquiries</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}

                    {isAnnouncement && (
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(n, 'announcements')}
                        className="text-indigo-300 hover:text-indigo-200 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <span>All Advisories</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}

                    {isInstallation && (
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(n, 'installation')}
                        className="text-cyan-300 hover:text-cyan-200 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <span>Track Installation</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}

                    {isAccountIssue && (
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(n, 'profile')}
                        className="text-purple-300 hover:text-purple-200 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <span>Account Profile</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}

                    {isPayment &&
                      linkedReading &&
                      isOfficialBillIssued(linkedReading) &&
                      (linkedReading.paymentStatus === 'paid' ||
                        linkedReading.paymentStatus === 'partial' ||
                        (linkedReading.paidAmount || 0) > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBellNotification(null);
                            setReceiptDetailModal(linkedReading);
                          }}
                          className="text-emerald-300 hover:text-emerald-200 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <span>Official Receipt</span>
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}

                    {(isBilling || isDisconnection) &&
                      linkedReading &&
                      isOfficialBillIssued(linkedReading) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBellNotification(null);
                            setBillDetailsReading(linkedReading);
                            setIsBillDetailsOpen(true);
                          }}
                          className="text-sky-300 hover:text-sky-200 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <span>Itemized Statement</span>
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}

                    {(isBilling || isPayment || isDisconnection) && (
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(n, 'bills')}
                        className="text-slate-300 hover:text-white font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <span>My Bills</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedBellNotification(null)}
                    className={
                      canReplyInModal
                        ? 'text-slate-300 hover:text-white font-semibold cursor-pointer whitespace-nowrap ml-auto'
                        : 'px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition cursor-pointer whitespace-nowrap ml-auto'
                    }
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-6 border-t border-slate-800 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs space-y-1">
          <p className="font-semibold text-slate-300">Tagoloan Water District • Official Consumer Portal</p>
          <p className="text-slate-500 text-[11px]">
            Municipal Hall Compound, Poblacion, Tagoloan, Misamis Oriental • Hotline: (088) 555-0145
          </p>
        </div>
      </footer>

      </div>
    </div>
  );
}

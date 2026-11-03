/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Wrench,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  UserCheck,
  MapPin,
  Phone,
  Mail,
  FileText,
  ShieldCheck,
  X,
  RefreshCw,
  Lock,
  Sparkles,
  Hash,
  Tag,
  Gauge,
  Building,
  Home,
  Check,
  ArrowRight,
} from 'lucide-react';
import {
  Barangay,
  Consumer,
  InstallationStatus,
  User,
  WaterMeterInstallationRequest,
} from '../../types';
import { mockDb } from '../../mockDb';
import {
  INSTALLATION_STATUS_OPTIONS,
  formatInstallationDateDisplay,
  isPendingConsumerStatus,
} from '../../utils/installationWorkflow';
import { SmartSearchBar } from '../common/SmartSearchBar';
import { TablePagination } from '../common/TablePagination';
import { smartMatch } from '../../utils/smartSearch';
import { sendRealtimeMessage } from '../../services/realtimeSocket';
import { useToast } from '../../context/ToastContext';
import { compareInstallationsCanonical } from '../../utils/canonicalSort';
import { formatOdometerReading } from '../../utils/odometer';

export interface WaterMeterInstallationsManagerProps {
  requests: WaterMeterInstallationRequest[];
  consumers: Consumer[];
  barangays: Barangay[];
  adminUser: User;
  initialSelectedRequestId?: string | null;
  onClearInitialSelection?: () => void;
  onRefreshData: () => void;
}

const METER_BRANDS = [
  'EVER',
  'NBI WaterTech',
  'Itron',
  'Sensus',
  'Zenner',
  'Arad',
  'Badger Meter',
];

const METER_SIZES = ['1/2"', '3/4"', '1"', '1 1/2"', '2"'];

function getStatusBadgeClasses(status: InstallationStatus): string {
  switch (status) {
    case 'Pending Review':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
    case 'Approved':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/40';
    case 'Scheduled':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/40';
    case 'Rescheduled':
      return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40';
    case 'Installation in Progress':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40';
    case 'Installed':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    case 'Cancelled':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700';
  }
}

export const WaterMeterInstallationsManager: React.FC<WaterMeterInstallationsManagerProps> = ({
  requests,
  consumers,
  barangays,
  adminUser,
  initialSelectedRequestId,
  onClearInitialSelection,
  onRefreshData,
}) => {
  const toast = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | InstallationStatus | 'Awaiting Validation'>('All');
  const [currentPage, setCurrentPage] = useState(1);

  // Modal 0: Complete Read-Only Request & Applicant Details Viewer (Row Click)
  const [viewingRequestDetail, setViewingRequestDetail] = useState<WaterMeterInstallationRequest | null>(null);

  // Modal 1: Review & Schedule Management
  const [reviewingRequest, setReviewingRequest] = useState<WaterMeterInstallationRequest | null>(null);
  const [editStatus, setEditStatus] = useState<InstallationStatus>('Pending Review');
  const [editConfirmedDate, setEditConfirmedDate] = useState('');
  const [editCompletionDate, setEditCompletionDate] = useState('');
  const [editAdminRemarks, setEditAdminRemarks] = useState('');
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Modal 2: Post-Installation Meter Registration & Account Validation
  const [validatingRequest, setValidatingRequest] = useState<WaterMeterInstallationRequest | null>(null);
  const [valSerialNumber, setValSerialNumber] = useState('');
  const [valMeterBrand, setValMeterBrand] = useState('EVER');
  const [valMeterSize, setValMeterSize] = useState('1/2"');
  const [valMeterTagNumber, setValMeterTagNumber] = useState('');
  const [valAccountNumber, setValAccountNumber] = useState('');
  const [valCompletionDate, setValCompletionDate] = useState('');
  const [valError, setValError] = useState<string | null>(null);
  const [isValidatingAccount, setIsValidatingAccount] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const openReviewModal = (req: WaterMeterInstallationRequest) => {
    const wasUnread = mockDb.isInstallationUnreadForAdmin(req);
    mockDb.markInstallationReadByAdmin(req.id, req);
    if (wasUnread) {
      onRefreshData();
    }
    setReviewingRequest({ ...req, hasUnreadAdminAlert: false });
    // When opening a Pending Review request, pre-select 'Approved' so the next action is immediately clear
    setEditStatus(req.status === 'Pending Review' ? 'Approved' : req.status);
    setEditConfirmedDate(req.confirmedInstallationDate || req.preferredInstallationDate || '');
    setEditCompletionDate(req.completionDate || new Date().toISOString().split('T')[0]);
    setEditAdminRemarks(req.adminRemarks || '');
  };

  const generateSuggestedAccountNumber = (req: WaterMeterInstallationRequest): string => {
    const matchedBrgy = barangays.find(
      (b) =>
        (req.barangayId && b.id === req.barangayId) ||
        (req.barangay && b.name.toLowerCase() === req.barangay.toLowerCase())
    );
    const brgyPrefix = matchedBrgy?.id || req.barangayId || 'BRG-01';
    const existingSet = new Set(
      consumers.map((c) => (c.accountNumber || '').trim().toUpperCase())
    );
    for (let i = 0; i < 30; i++) {
      const suffix = Math.floor(1000 + Math.random() * 9000);
      const candidate = `${brgyPrefix}-${suffix}`.toUpperCase();
      if (!existingSet.has(candidate)) return candidate;
    }
    return `${brgyPrefix}-${Date.now().toString().slice(-4)}`.toUpperCase();
  };

  const generateSuggestedMeterTag = (): string => {
    const meters = mockDb.getMeters();
    const existingTags = new Set([
      ...meters.map((m) => (m.meterNumber || '').trim().toUpperCase()),
      ...consumers.map((c) => (c.meterNumber || '').trim().toUpperCase()),
    ]);
    for (let i = 0; i < 30; i++) {
      const num = Math.floor(10000 + Math.random() * 90000);
      const candidate = `MT-${num}`;
      if (!existingTags.has(candidate)) return candidate;
    }
    return `MT-${Date.now().toString().slice(-5)}`;
  };

  const generateSuggestedSerialNumber = (): string => {
    const year = new Date().getFullYear();
    for (let i = 0; i < 30; i++) {
      const rand = Math.floor(100000 + Math.random() * 900000);
      const candidate = `SN-TWD-${year}-${rand}`;
      if (!mockDb.checkDuplicateMeterSerial(candidate)) return candidate;
    }
    return `SN-TWD-${year}-${Date.now().toString().slice(-6)}`;
  };

  const openValidationModal = (req: WaterMeterInstallationRequest) => {
    if (req.status !== 'Installed') {
      toast.warning(
        'Installation Confirmation Required',
        `Account validation is locked until physical installation status is confirmed as "Installed" (currently "${req.status}").`
      );
      return;
    }
    const wasUnread = mockDb.isInstallationUnreadForAdmin(req);
    mockDb.markInstallationReadByAdmin(req.id, req);
    if (wasUnread) {
      onRefreshData();
    }
    const suggestedTag = req.assignedMeterTagNumber || generateSuggestedMeterTag();
    const suggestedAcc = req.assignedAccountNumber || generateSuggestedAccountNumber(req);

    setValidatingRequest({ ...req, hasUnreadAdminAlert: false });
    setValSerialNumber(req.meterSerialNumber || '');
    setValMeterBrand(req.meterBrand || 'EVER');
    setValMeterSize(req.meterSize || (req.consumerType === 'Commercial' ? '3/4"' : '1/2"'));
    setValMeterTagNumber(suggestedTag);
    setValAccountNumber(suggestedAcc);
    setValCompletionDate(req.completionDate || new Date().toISOString().split('T')[0]);
    setValError(null);
  };

  // Handle deep-link selection from Admin Notification Bell or Consumers tab
  useEffect(() => {
    if (!initialSelectedRequestId) return;
    const cleanTargetId = String(initialSelectedRequestId).split('::')[0].trim();
    if (!cleanTargetId) return;

    const candidatePool =
      Array.isArray(requests) && requests.length > 0
        ? requests
        : mockDb.getInstallationRequests();
    const found = candidatePool.find(
      (r) => r.id === cleanTargetId || r.applicationNumber === cleanTargetId
    );
    if (found) {
      setStatusFilter('All');
      setSearchQuery('');
      setViewingRequestDetail(null);
      if (found.status === 'Installed' && found.accountValidationStatus !== 'validated') {
        openValidationModal(found);
      } else {
        openReviewModal(found);
      }
      onClearInitialSelection?.();
    }
  }, [initialSelectedRequestId, requests]);

  // Metrics
  const stats = useMemo(() => {
    const total = requests.length;
    const pendingReview = requests.filter((r) => r.status === 'Pending Review').length;
    const scheduledActive = requests.filter((r) =>
      ['Approved', 'Scheduled', 'Rescheduled', 'Installation in Progress'].includes(r.status)
    ).length;
    const awaitingValidation = requests.filter(
      (r) => r.status === 'Installed' && r.accountValidationStatus !== 'validated'
    ).length;
    const validated = requests.filter((r) => r.accountValidationStatus === 'validated').length;
    return { total, pendingReview, scheduledActive, awaitingValidation, validated };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    return requests
      .filter((r) => {
        if (statusFilter === 'Awaiting Validation') {
          if (!(r.status === 'Installed' && r.accountValidationStatus !== 'validated')) return false;
        } else if (statusFilter !== 'All' && r.status !== statusFilter) {
          return false;
        }
        return smartMatch(searchQuery, [
          r.applicationNumber,
          r.consumerName,
          r.consumerEmail,
          r.contactNumber,
          r.address,
          r.barangay,
          r.sitioZone,
          r.status,
          r.preferredInstallationDate,
          r.confirmedInstallationDate,
          r.adminRemarks,
          r.consumerRemarks,
          r.assignedAccountNumber,
          r.assignedMeterTagNumber,
          r.meterSerialNumber,
          r.responsiblePersonnel,
        ]);
      })
      .sort(
        (a, b) =>
          Number(Boolean(b.hasUnreadAdminAlert)) - Number(Boolean(a.hasUnreadAdminAlert)) ||
          new Date(b.updatedAt || b.submissionDate || 0).getTime() -
            new Date(a.updatedAt || a.submissionDate || 0).getTime() ||
          compareInstallationsCanonical(a, b)
      );
  }, [requests, statusFilter, searchQuery]);

  const safePage = Math.min(currentPage, Math.max(1, Math.ceil(filteredRequests.length / 10)));

  const paginatedRequests = useMemo(() => {
    const start = (safePage - 1) * 10;
    return filteredRequests.slice(start, start + 10);
  }, [filteredRequests, safePage]);

  const handleSaveScheduleAndStatus = (proceedToValidation = false) => {
    if (!reviewingRequest) return;

    if (
      reviewingRequest.status === 'Pending Review' &&
      editStatus === 'Pending Review' &&
      editAdminRemarks.trim() === (reviewingRequest.adminRemarks || '').trim()
    ) {
      toast.warning(
        'Select Next Status Action',
        'Please update the status (for example "Approved" to accept the schedule, or "Installed" once the water meter is mounted) so the consumer receives an official update.'
      );
      return;
    }

    const needsScheduleDate = ['Approved', 'Scheduled', 'Rescheduled'].includes(editStatus);
    if (needsScheduleDate && !editConfirmedDate.trim()) {
      toast.error('Schedule Date Required', 'Please select a confirmed or revised installation schedule date.');
      return;
    }

    setIsSavingSchedule(true);
    try {
      const updated = mockDb.updateInstallationRequestStatus(reviewingRequest.id, {
        status: editStatus,
        confirmedInstallationDate: editConfirmedDate.trim() || undefined,
        completionDate: editStatus === 'Installed' ? editCompletionDate.trim() || undefined : undefined,
        adminRemarks: editAdminRemarks.trim(),
        adminId: adminUser.id,
        adminName: adminUser.name || 'TWD Administrator',
      });

      if (updated) {
        const matchedDispatchedNotif = mockDb
          .getAllNotifications()
          .find(
            (n) =>
              n.installationRequestId === updated.id &&
              n.installationStatus === updated.status
          );

        sendRealtimeMessage('INSTALLATION_REQUEST_UPDATED', {
          request: updated,
          notification: matchedDispatchedNotif || undefined,
          requestId: updated.id,
          applicationNumber: updated.applicationNumber,
          status: updated.status,
          consumerEmail: updated.consumerEmail,
          userId: updated.linkedUserId,
        });

        if (matchedDispatchedNotif) {
          sendRealtimeMessage('CONSUMER_NOTIFICATION_CREATED', {
            notification: matchedDispatchedNotif,
            accountNumber: matchedDispatchedNotif.accountNumber,
            consumerEmail: updated.consumerEmail,
            userId: updated.linkedUserId,
          });
        }

        onRefreshData();
        if (updated.status === 'Installed') {
          toast.success(
            'Water Meter Marked Installed · Consumer Notified',
            `${updated.consumerName} has been notified that their water meter is installed and to wait while their account is validated. You may now validate & issue IDs.`
          );
        } else {
          toast.success(
            'Installation Status Updated',
            `Application ${updated.applicationNumber} updated to "${updated.status}". Official notification sent to ${updated.consumerName}.`
          );
        }
        setReviewingRequest(null);
        if (proceedToValidation && updated.status === 'Installed') {
          openValidationModal(updated);
        }
      }
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleValidateAndActivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatingRequest) return;
    setValError(null);

    if (validatingRequest.status !== 'Installed') {
      setValError('Physical installation must be confirmed as "Installed" before issuing Account and Meter Tag Numbers.');
      return;
    }

    if (!valSerialNumber.trim()) {
      setValError('Please enter the physical Water Meter Serial Number.');
      return;
    }
    if (!valMeterTagNumber.trim()) {
      setValError('Please assign the official Meter Tag Number.');
      return;
    }
    if (!valAccountNumber.trim()) {
      setValError('Please generate or enter the official Account Number.');
      return;
    }
    if (!valCompletionDate.trim()) {
      setValError('Please record the Installation Completion Date.');
      return;
    }

    setIsValidatingAccount(true);
    try {
      const result = await mockDb.validateInstallationAndActivateAccount({
        requestId: validatingRequest.id,
        meterSerialNumber: valSerialNumber.trim(),
        meterTagNumber: valMeterTagNumber.trim(),
        meterBrand: valMeterBrand,
        meterSize: valMeterSize,
        accountNumber: valAccountNumber.trim(),
        completionDate: valCompletionDate.trim(),
        adminId: adminUser.id,
        adminName: adminUser.name || 'TWD Administrator',
      });

      if (!result.success || !result.request || !result.consumer) {
        setValError(result.error || 'Unable to validate meter installation. Please verify your inputs.');
        return;
      }

      sendRealtimeMessage('INSTALLATION_REQUEST_UPDATED', {
        requestId: result.request.id,
        applicationNumber: result.request.applicationNumber,
        status: result.request.status,
        accountValidationStatus: 'validated',
        accountNumber: result.consumer.accountNumber,
        meterNumber: result.consumer.meterNumber,
      });

      sendRealtimeMessage('CONSUMER_IDS_ISSUED', {
        accountNumber: result.consumer.accountNumber,
        meterNumber: result.consumer.meterNumber,
        email: result.consumer.email,
        linkedUserId: result.consumer.linkedUserId,
        name: result.consumer.name,
      });

      onRefreshData();
      toast.success(
        'Account Validated & Activated',
        `Official Account #${result.consumer.accountNumber} and Meter Tag #${result.consumer.meterNumber} issued to ${result.consumer.name}.`
      );
      setValidatingRequest(null);
    } finally {
      setIsValidatingAccount(false);
    }
  };

  // Consumers who registered with "Schedule Later" (no installation request submitted yet)
  const unscheduledApplicantsCount = useMemo(() => {
    return consumers.filter(
      (c) =>
        isPendingConsumerStatus(c.status) &&
        (c.status === 'installation_not_scheduled' || c.hasExistingMeter === false) &&
        !requests.some(
          (r) =>
            (c.applicationNumber && r.applicationNumber === c.applicationNumber) ||
            (c.email && r.consumerEmail.toLowerCase() === c.email.toLowerCase())
        )
    ).length;
  }, [consumers, requests]);

  return (
    <div className="space-y-6">
      {/* KPI SUMMARY STRIP — Locked 3-row CSS Grid guarantees pixel-exact horizontal number alignment */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 items-stretch">
        <div className="h-full bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md grid grid-rows-[20px_36px_auto] content-start gap-1.5 text-left">
          <div className="h-5 flex items-center justify-between gap-2 text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider truncate">Total Requests</span>
            <Wrench className="h-4 w-4 text-sky-400 shrink-0" />
          </div>
          <div className="h-9 flex items-center">
            <span className="text-2xl leading-none font-black text-white font-mono tabular-nums">
              {stats.total}
            </span>
          </div>
          <div className="text-[11px] leading-snug text-slate-400 self-start">
            {unscheduledApplicantsCount > 0
              ? `${unscheduledApplicantsCount} applicant(s) yet to schedule`
              : 'All active meter applications'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'Pending Review' ? 'All' : 'Pending Review')}
          className={`h-full text-left bg-slate-900 border rounded-2xl p-4 shadow-md grid grid-rows-[20px_36px_auto] content-start gap-1.5 transition cursor-pointer ${
            statusFilter === 'Pending Review'
              ? 'border-amber-500 ring-1 ring-amber-500/30'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="h-5 flex items-center justify-between gap-2 text-amber-300">
            <span className="text-[10px] font-bold uppercase tracking-wider truncate">Pending Review</span>
            <Clock className="h-4 w-4 text-amber-400 shrink-0" />
          </div>
          <div className="h-9 flex items-center">
            <span className="text-2xl leading-none font-black text-amber-400 font-mono tabular-nums">
              {stats.pendingReview}
            </span>
          </div>
          <div className="text-[11px] leading-snug text-slate-400 self-start">
            Awaiting schedule confirmation
          </div>
        </button>

        <div className="h-full bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md grid grid-rows-[20px_36px_auto] content-start gap-1.5 text-left">
          <div className="h-5 flex items-center justify-between gap-2 text-blue-300">
            <span className="text-[10px] font-bold uppercase tracking-wider truncate">Scheduled / Field</span>
            <Calendar className="h-4 w-4 text-blue-400 shrink-0" />
          </div>
          <div className="h-9 flex items-center">
            <span className="text-2xl leading-none font-black text-blue-400 font-mono tabular-nums">
              {stats.scheduledActive}
            </span>
          </div>
          <div className="text-[11px] leading-snug text-slate-400 self-start">
            Approved, Scheduled &amp; In Progress
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setStatusFilter(statusFilter === 'Awaiting Validation' ? 'All' : 'Awaiting Validation')
          }
          className={`h-full text-left bg-slate-900 border rounded-2xl p-4 shadow-md grid grid-rows-[20px_36px_auto] content-start gap-1.5 transition cursor-pointer ${
            statusFilter === 'Awaiting Validation'
              ? 'border-cyan-500 ring-1 ring-cyan-500/30'
              : stats.awaitingValidation > 0
              ? 'border-cyan-500/40 hover:border-cyan-400'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="h-5 flex items-center justify-between gap-2 text-cyan-300">
            <span className="text-[10px] font-bold uppercase tracking-wider truncate">Awaiting Validation</span>
            <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
          </div>
          <div className="h-9 flex items-center">
            <span className="text-2xl leading-none font-black text-cyan-400 font-mono tabular-nums">
              {stats.awaitingValidation}
            </span>
          </div>
          <div className="text-[11px] leading-snug text-slate-400 self-start">
            Installed · Ready to issue IDs
          </div>
        </button>

        <div className="h-full bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md grid grid-rows-[20px_36px_auto] content-start gap-1.5 text-left col-span-2 sm:col-span-1">
          <div className="h-5 flex items-center justify-between gap-2 text-emerald-300">
            <span className="text-[10px] font-bold uppercase tracking-wider truncate">Validated &amp; Active</span>
            <UserCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          </div>
          <div className="h-9 flex items-center">
            <span className="text-2xl leading-none font-black text-emerald-400 font-mono tabular-nums">
              {stats.validated}
            </span>
          </div>
          <div className="text-[11px] leading-snug text-slate-400 self-start">
            Account &amp; Meter Tag issued
          </div>
        </div>
      </div>

      {/* CLEAR 3-STEP ADMINISTRATIVE WORKFLOW GUIDE */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-sky-400 shrink-0" />
            <span>Administrative Installation &amp; Account Validation Workflow</span>
          </span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Consumers are notified automatically at every step
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2.5">
            <span className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono font-black text-xs flex items-center justify-center shrink-0">
              1
            </span>
            <div>
              <div className="font-bold text-amber-300">Accept &amp; Confirm Schedule</div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                When <strong className="text-slate-200">Pending Review</strong>, click{' '}
                <strong className="text-amber-300">Accept / Update Status</strong> to approve &amp; confirm the installation date.
              </p>
            </div>
          </div>

          <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-2.5">
            <span className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-black text-xs flex items-center justify-center shrink-0">
              2
            </span>
            <div>
              <div className="font-bold text-emerald-300">Mark Water Meter Installed</div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                Update status to <strong className="text-emerald-300">Installed</strong>. This automatically notifies the Consumer that their water meter is installed and to wait for account validation.
              </p>
            </div>
          </div>

          <div className="bg-slate-950 border border-cyan-500/30 rounded-xl p-3 flex items-start gap-2.5">
            <span className="w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono font-black text-xs flex items-center justify-center shrink-0">
              3
            </span>
            <div>
              <div className="font-bold text-cyan-300">Validate Account &amp; Issue IDs</div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                Click <strong className="text-cyan-300">Validate &amp; Issue IDs</strong> to record the Meter Serial # and issue the Consumer&apos;s official Account # &amp; Meter Tag #.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* SEARCH & STATUS FILTER TOOLBAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="flex-1 max-w-2xl">
            <SmartSearchBar
              variant="dark"
              value={searchQuery}
              onChange={setSearchQuery}
              resultCount={filteredRequests.length}
              totalCount={requests.length}
              placeholder="Search by consumer name, application #, barangay, phone, serial #, meter tag #, or account #..."
              id="admin-installations-smart-search"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
            <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
            <span>
              Official Account &amp; Meter Tag issuance unlocks strictly once status is{' '}
              <strong className="text-emerald-400">Installed</strong>.
            </span>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {(
            [
              'All',
              'Pending Review',
              'Approved',
              'Scheduled',
              'Rescheduled',
              'Installation in Progress',
              'Installed',
              'Awaiting Validation',
              'Cancelled',
            ] as const
          ).map((tab) => {
            const isActive = statusFilter === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 border transition cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* INSTALLATION REQUESTS TABLE */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-4 py-3.5 border-r border-slate-800/80 whitespace-nowrap">
                  Application # &amp; Submitted
                </th>
                <th className="px-4 py-3.5 border-r border-slate-800/80">Consumer &amp; Contact</th>
                <th className="px-4 py-3.5 border-r border-slate-800/80">Address / Barangay</th>
                <th className="px-4 py-3.5 border-r border-slate-800/80 whitespace-nowrap">
                  Installation Schedule
                </th>
                <th className="px-4 py-3.5 border-r border-slate-800/80 text-center whitespace-nowrap">
                  Installation Status
                </th>
                <th className="px-4 py-3.5 border-r border-slate-800/80">
                  Validation &amp; Meter Details
                </th>
                <th className="px-4 py-3.5 border-r border-slate-800/80">Administrator Remarks</th>
                <th className="px-4 py-3.5 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-200 bg-slate-900">
              {paginatedRequests.map((req) => {
                const isInstalled = req.status === 'Installed';
                const isValidated = req.accountValidationStatus === 'validated';
                const isUnreadAlert = mockDb.isInstallationUnreadForAdmin(req);
                const submittedDisplay = formatInstallationDateDisplay(req.submissionDate);

                return (
                  <tr
                    key={req.id}
                    onClick={() => {
                      const wasUnread = mockDb.isInstallationUnreadForAdmin(req);
                      mockDb.markInstallationReadByAdmin(req.id, req);
                      if (wasUnread) {
                        onRefreshData();
                      }
                      setViewingRequestDetail({ ...req, hasUnreadAdminAlert: false });
                    }}
                    title="Click row to open complete installation & applicant details"
                    className={`transition cursor-pointer ${
                      isUnreadAlert
                        ? 'bg-sky-950/25 hover:bg-sky-950/40'
                        : isInstalled && !isValidated
                        ? 'bg-cyan-950/15 hover:bg-cyan-950/30'
                        : 'hover:bg-slate-800/70'
                    }`}
                  >
                    {/* Application # & Submission Date */}
                    <td className="px-4 py-3.5 border-r border-slate-800/80 align-top">
                      <div className="flex items-center gap-1.5">
                        {isUnreadAlert && (
                          <span
                            className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0"
                            title="New / Unread Installation Request"
                          />
                        )}
                        <span className="font-mono tabular-nums font-bold text-cyan-300 whitespace-nowrap">
                          {req.applicationNumber}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1">
                        Submitted: {submittedDisplay}
                      </div>
                    </td>

                    {/* Consumer & Contact */}
                    <td className="px-4 py-3.5 border-r border-slate-800/80 align-top min-w-[180px]">
                      <div className="font-bold text-white flex items-center gap-1.5 flex-wrap">
                        <span>{req.consumerName}</span>
                        <span
                          className={`px-1.5 py-0.5 text-[9px] font-black uppercase rounded border ${
                            req.consumerType === 'Commercial'
                              ? 'bg-purple-950/80 text-purple-300 border-purple-800/80'
                              : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                          }`}
                        >
                          {req.consumerType || 'Residential'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1 flex items-center gap-1">
                        <Phone className="h-3 w-3 text-slate-500 shrink-0" />
                        <span>{req.contactNumber || 'N/A'}</span>
                      </div>
                      {req.consumerEmail && (
                        <div className="text-[11px] text-slate-400 truncate max-w-[200px] mt-0.5">
                          {req.consumerEmail}
                        </div>
                      )}
                    </td>

                    {/* Address / Barangay */}
                    <td className="px-4 py-3.5 border-r border-slate-800/80 align-top min-w-[190px]">
                      <div className="text-slate-200 font-medium leading-snug">{req.address}</div>
                      <div className="text-[11px] text-sky-400 font-semibold mt-0.5">
                        Brgy. {req.barangay || 'Tagoloan'}
                        {req.sitioZone ? ` · ${req.sitioZone}` : ''}
                      </div>
                    </td>

                    {/* Requested & Confirmed Schedule */}
                    <td className="px-4 py-3.5 border-r border-slate-800/80 align-top whitespace-nowrap">
                      <div className="text-[11px] text-slate-400">
                        Requested:{' '}
                        <strong className="font-mono tabular-nums text-slate-200">
                          {formatInstallationDateDisplay(req.preferredInstallationDate)}
                        </strong>
                      </div>
                      {req.confirmedInstallationDate ? (
                        <div className="text-[11px] text-sky-300 mt-1">
                          Confirmed:{' '}
                          <strong className="font-mono tabular-nums text-white">
                            {formatInstallationDateDisplay(req.confirmedInstallationDate)}
                          </strong>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 mt-1">
                          Confirmed: Not yet set
                        </div>
                      )}
                      {req.completionDate && (
                        <div className="text-[11px] text-emerald-400 mt-1">
                          Completed:{' '}
                          <strong className="font-mono tabular-nums">
                            {formatInstallationDateDisplay(req.completionDate)}
                          </strong>
                        </div>
                      )}
                    </td>

                    {/* Installation Status */}
                    <td className="px-4 py-3.5 border-r border-slate-800/80 align-top text-center">
                      <div className="inline-flex flex-col items-center gap-1">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border whitespace-nowrap ${getStatusBadgeClasses(
                            req.status
                          )}`}
                        >
                          {req.status}
                        </span>
                        {req.status === 'Pending Review' && (
                          <span className="text-[10px] font-bold text-amber-300/90 whitespace-nowrap">
                            Step 1: Accept / Update Status
                          </span>
                        )}
                        {['Approved', 'Scheduled', 'Rescheduled', 'Installation in Progress'].includes(req.status) && (
                          <span className="text-[10px] font-bold text-emerald-300/90 whitespace-nowrap">
                            Step 2: Mark Installed
                          </span>
                        )}
                        {isInstalled && !isValidated && (
                          <span className="text-[10px] font-bold text-cyan-300 whitespace-nowrap">
                            Consumer Notified · Validate IDs
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Account Validation & Meter Details (Serial Number visible ONLY inside Admin Water Meters module) */}
                    <td className="px-4 py-3.5 border-r border-slate-800/80 align-top min-w-[200px]">
                      {isValidated ? (
                        <div className="space-y-0.5 text-[11px]">
                          <div className="inline-flex items-center gap-1 text-emerald-400 font-bold uppercase text-[10px]">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>Validated &amp; Active</span>
                          </div>
                          <div className="text-slate-300 font-mono tabular-nums">
                            Account: <strong className="text-sky-400">#{req.assignedAccountNumber}</strong>
                          </div>
                          <div className="text-slate-300 font-mono tabular-nums">
                            Meter Tag: <strong className="text-white">#{req.assignedMeterTagNumber}</strong>
                          </div>
                          {req.meterSerialNumber && (
                            <div className="text-slate-400 font-mono tabular-nums text-[10px]">
                              Serial #: <strong className="text-amber-300">{req.meterSerialNumber}</strong>
                            </div>
                          )}
                        </div>
                      ) : isInstalled ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold uppercase whitespace-nowrap">
                            <Sparkles className="h-3 w-3 shrink-0" />
                            <span>Awaiting Validation</span>
                          </span>
                          <p className="text-[11px] text-slate-300 leading-snug">
                            Consumer notified &amp; waiting. Issue Account # &amp; Meter Tag # now.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1 text-[11px] text-slate-400">
                          <span className="inline-flex items-center gap-1 text-slate-400 font-semibold">
                            <Lock className="h-3 w-3 text-slate-500 shrink-0" />
                            <span>Locked until Installed</span>
                          </span>
                          <p className="text-[10px] text-slate-500 leading-snug">
                            Update status to &ldquo;Installed&rdquo; first to notify consumer &amp; unlock IDs.
                          </p>
                        </div>
                      )}
                    </td>

                    {/* Administrator Remarks */}
                    <td className="px-4 py-3.5 border-r border-slate-800/80 align-top max-w-[220px]">
                      {req.adminRemarks ? (
                        <p className="text-[11px] text-slate-200 line-clamp-2 leading-snug">
                          {req.adminRemarks}
                        </p>
                      ) : req.consumerRemarks ? (
                        <p className="text-[11px] text-slate-400 italic line-clamp-2 leading-snug">
                          Applicant note: &ldquo;{req.consumerRemarks}&rdquo;
                        </p>
                      ) : (
                        <span className="text-[11px] text-slate-500">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 align-top text-right">
                      <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openReviewModal(req);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer flex items-center gap-1.5 ${
                            req.status === 'Pending Review'
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-sm'
                              : ['Approved', 'Scheduled', 'Rescheduled', 'Installation in Progress'].includes(
                                  req.status
                                )
                              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                              : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100'
                          }`}
                        >
                          <RefreshCw className="h-3 w-3 shrink-0" />
                          <span>
                            {req.status === 'Pending Review'
                              ? 'Accept / Update Status'
                              : ['Approved', 'Scheduled', 'Rescheduled', 'Installation in Progress'].includes(
                                  req.status
                                )
                              ? 'Update Status / Mark Installed'
                              : 'Update Status'}
                          </span>
                        </button>

                        {isValidated ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openValidationModal(req);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-700/60 text-emerald-300 text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer flex items-center gap-1"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>Validated Details</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!isInstalled}
                            onClick={(e) => {
                              e.stopPropagation();
                              openValidationModal(req);
                            }}
                            title={
                              isInstalled
                                ? 'Register installed meter serial number and issue official Account Number & Meter Tag Number'
                                : 'Locked: Update installation status to Installed first before issuing official Account & Meter Tag Numbers'
                            }
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition flex items-center gap-1 ${
                              isInstalled
                                ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md cursor-pointer'
                                : 'bg-slate-950 border border-slate-800 text-slate-500 cursor-not-allowed opacity-70'
                            }`}
                          >
                            {isInstalled ? (
                              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <Lock className="h-3 w-3 shrink-0" />
                            )}
                            <span>Validate &amp; Issue IDs</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredRequests.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-14 text-center text-slate-400">
                    <Wrench className="h-8 w-8 mx-auto mb-2.5 text-slate-600" />
                    <div className="text-sm font-bold text-slate-300">
                      No water meter installation requests match your current filter.
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Newly registered consumers without an existing water meter will appear here when they submit an installation schedule request.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          currentPage={safePage}
          totalItems={filteredRequests.length}
          pageSize={10}
          onPageChange={setCurrentPage}
          itemName="installation requests"
        />
      </div>

      {/* =====================================================================
          MODAL 1: REVIEW & UPDATE INSTALLATION STATUS / SCHEDULE
      ====================================================================== */}
      {reviewingRequest &&
        (typeof document !== 'undefined'
          ? createPortal(
              <div
                className="fixed inset-0 z-[160] bg-slate-950/85 backdrop-blur-sm flex items-start justify-center pt-2 sm:pt-3 px-3 sm:px-4 pb-6 overflow-y-auto"
                onClick={() => setReviewingRequest(null)}
                role="dialog"
                aria-modal="true"
              >
                <div
                  className="mt-0 self-start bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[calc(100vh-1.25rem)] sm:max-h-[calc(100vh-1.75rem)] shadow-2xl overflow-hidden flex flex-col text-slate-100"
                  onClick={(e) => e.stopPropagation()}
                >
            {/* Header */}
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 shrink-0">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono tabular-nums font-bold text-cyan-300">
                      {reviewingRequest.applicationNumber}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${getStatusBadgeClasses(
                        reviewingRequest.status
                      )}`}
                    >
                      {reviewingRequest.status}
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-white mt-0.5">
                    Review Installation Request &amp; Schedule
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReviewingRequest(null)}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
              {/* Applicant Info Summary */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Consumer Name</span>
                  <strong className="text-white text-sm">{reviewingRequest.consumerName}</strong>
                  <span className="ml-2 text-[10px] text-slate-400">
                    ({reviewingRequest.consumerType || 'Residential'})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Contact Information</span>
                  <strong className="text-slate-200 font-mono tabular-nums">
                    {reviewingRequest.contactNumber || 'N/A'}
                  </strong>
                  <div className="text-[11px] text-slate-400 truncate">{reviewingRequest.consumerEmail}</div>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Service Premises Address &amp; Barangay
                  </span>
                  <strong className="text-slate-200">
                    {reviewingRequest.address} (Brgy. {reviewingRequest.barangay})
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Preferred Installation Date
                  </span>
                  <strong className="text-amber-300 font-mono tabular-nums">
                    {formatInstallationDateDisplay(reviewingRequest.preferredInstallationDate)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Request Submission Date
                  </span>
                  <strong className="text-slate-200 font-mono tabular-nums">
                    {formatInstallationDateDisplay(reviewingRequest.submissionDate)}
                  </strong>
                </div>
                {reviewingRequest.consumerRemarks && (
                  <div className="sm:col-span-2 pt-2 border-t border-slate-800/80">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">
                      Consumer Installation Instructions / Remarks
                    </span>
                    <p className="text-slate-200 mt-0.5 leading-relaxed">
                      {reviewingRequest.consumerRemarks}
                    </p>
                  </div>
                )}
              </div>

              {/* Guided Quick-Action Status Selection Cards */}
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-sky-300">
                  Choose What To Do Next (Updates Status &amp; Notifies Consumer)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-left">
                  <button
                    type="button"
                    onClick={() => {
                      setEditStatus('Approved');
                      if (!editConfirmedDate) {
                        setEditConfirmedDate(
                          reviewingRequest.preferredInstallationDate ||
                            new Date().toISOString().split('T')[0]
                        );
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      editStatus === 'Approved' || editStatus === 'Scheduled'
                        ? 'bg-sky-950/60 border-sky-400 ring-1 ring-sky-400/30'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-black text-sky-300 flex items-center justify-between">
                      <span>1. Accept Schedule</span>
                      {(editStatus === 'Approved' || editStatus === 'Scheduled') && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Approve request &amp; notify consumer of confirmed installation date.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditStatus('Installation in Progress')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      editStatus === 'Installation in Progress'
                        ? 'bg-cyan-950/60 border-cyan-400 ring-1 ring-cyan-400/30'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-black text-cyan-300 flex items-center justify-between">
                      <span>2. In Progress</span>
                      {editStatus === 'Installation in Progress' && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Field crew is on-site installing the physical water meter.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditStatus('Installed');
                      if (!editCompletionDate) {
                        setEditCompletionDate(new Date().toISOString().split('T')[0]);
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      editStatus === 'Installed'
                        ? 'bg-emerald-950/60 border-emerald-400 ring-1 ring-emerald-400/30'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-black text-emerald-300 flex items-center justify-between">
                      <span>3. Meter Installed</span>
                      {editStatus === 'Installed' && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Notifies consumer meter is installed &amp; waiting for account validation.
                    </p>
                  </button>
                </div>
              </div>

              {/* Status & Schedule Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Installation Status <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as InstallationStatus)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {INSTALLATION_STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    {editStatus === 'Rescheduled'
                      ? 'Revised Installation Date *'
                      : 'Confirmed Installation Schedule Date'}
                  </label>
                  <input
                    type="date"
                    value={editConfirmedDate}
                    onChange={(e) => setEditConfirmedDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                {editStatus === 'Installed' && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-emerald-300 mb-1.5">
                      Physical Installation Completion Date
                    </label>
                    <input
                      type="date"
                      value={editCompletionDate}
                      onChange={(e) => setEditCompletionDate(e.target.value)}
                      className="w-full bg-slate-950 border border-emerald-700/60 rounded-xl px-3.5 py-2.5 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Administrator Remarks / Consumer Instructions
                </label>
                <textarea
                  rows={3}
                  value={editAdminRemarks}
                  onChange={(e) => setEditAdminRemarks(e.target.value)}
                  placeholder={
                    editStatus === 'Rescheduled'
                      ? 'Provide the reason for rescheduling and any instructions for the consumer...'
                      : editStatus === 'Installed'
                      ? 'Optional installation completion remarks (Consumer will be notified that their water meter is installed and to wait for account validation)...'
                      : 'Provide schedule confirmation notes, site preparation instructions, or remarks...'
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Automatic Notification Live Outcome Preview */}
              <div
                className={`bg-slate-950 border rounded-xl p-3.5 text-xs leading-relaxed ${
                  editStatus === 'Installed'
                    ? 'border-emerald-700/70 text-emerald-100'
                    : 'border-sky-900/60 text-slate-300'
                }`}
              >
                <strong className={editStatus === 'Installed' ? 'text-emerald-300' : 'text-sky-300'}>
                  Automatic Consumer Notification ({editStatus}):
                </strong>{' '}
                {editStatus === 'Installed' ? (
                  <>
                    Saving will immediately notify <strong className="text-white">{reviewingRequest.consumerName}</strong> that{' '}
                    <strong className="text-emerald-300">their physical water meter has been installed</strong> and instruct them to{' '}
                    <strong className="text-emerald-300">wait while Administration validates and updates their account</strong> to issue their official Account Number and Meter Tag Number.
                  </>
                ) : (
                  <>
                    Saving changes will automatically dispatch an official Tagoloan Water District{' '}
                    <strong className="text-white">&ldquo;{editStatus}&rdquo;</strong> notice to{' '}
                    <strong className="text-white">{reviewingRequest.consumerName}</strong> in their Consumer Portal Notification Center.
                  </>
                )}
              </div>

              {/* Activity Timeline */}
              {reviewingRequest.history && reviewingRequest.history.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                    Installation Request History
                  </h4>
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {[...reviewingRequest.history].reverse().map((h) => (
                      <div
                        key={h.id}
                        className="bg-slate-950 border border-slate-800/90 rounded-xl px-3.5 py-2.5 text-xs flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white">{h.action || h.status}</span>
                          <span className="text-[10px] font-mono tabular-nums text-slate-400">
                            {new Date(h.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          By <strong className="text-slate-300">{h.actorName}</strong> ({h.actorRole})
                          {h.scheduledDate ? ` · Schedule: ${formatInstallationDateDisplay(h.scheduledDate)}` : ''}
                        </div>
                        {h.remarks && <p className="text-[11px] text-slate-300 mt-0.5">{h.remarks}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setReviewingRequest(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer"
              >
                Cancel
              </button>

              {editStatus === 'Installed' && reviewingRequest.accountValidationStatus !== 'validated' && (
                <button
                  type="button"
                  disabled={isSavingSchedule}
                  onClick={() => handleSaveScheduleAndStatus(true)}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer shadow-md flex items-center gap-1.5"
                >
                  <span>Save &amp; Proceed to Account Validation</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                </button>
              )}

              <button
                type="button"
                disabled={isSavingSchedule}
                onClick={() => handleSaveScheduleAndStatus(false)}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer shadow-md flex items-center gap-1.5"
              >
                <Check className="h-3.5 w-3.5 shrink-0" />
                <span>{isSavingSchedule ? 'Saving...' : 'Save Update & Notify Consumer'}</span>
              </button>
            </div>
          </div>
        </div>,
              document.body
            )
          : null)}

      {/* =====================================================================
          MODAL 2: POST-INSTALLATION METER REGISTRATION & ACCOUNT VALIDATION
          (Strictly unlocked ONLY when status === 'Installed')
      ====================================================================== */}
      {validatingRequest &&
        (typeof document !== 'undefined'
          ? createPortal(
              <div
                className="fixed inset-0 z-[165] bg-slate-950/85 backdrop-blur-sm flex items-start justify-center pt-2 sm:pt-3 px-3 sm:px-4 pb-6 overflow-y-auto"
                onClick={() => setValidatingRequest(null)}
                role="dialog"
                aria-modal="true"
              >
                <form
                  onSubmit={handleValidateAndActivateSubmit}
                  className="mt-0 self-start bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[calc(100vh-1.25rem)] sm:max-h-[calc(100vh-1.75rem)] shadow-2xl overflow-hidden flex flex-col text-slate-100"
                  onClick={(e) => e.stopPropagation()}
                >
            {/* Header */}
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 shrink-0">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono tabular-nums font-bold text-cyan-300">
                      {validatingRequest.applicationNumber}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-extrabold uppercase">
                      Physical Meter Installed
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-white mt-0.5">
                    {validatingRequest.accountValidationStatus === 'validated'
                      ? 'Validated Meter Registration & Activated Account'
                      : 'Meter Registration, Account Validation & ID Issuance'}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setValidatingRequest(null)}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
              {valError && (
                <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-700/70 text-rose-200 text-xs flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{valError}</span>
                </div>
              )}

              {/* Step 1: Verified Consumer & Installation Context */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Consumer Name</span>
                  <strong className="text-white text-sm">{validatingRequest.consumerName}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Classification &amp; Barangay</span>
                  <strong className="text-slate-200">
                    {validatingRequest.consumerType || 'Residential'} · Brgy. {validatingRequest.barangay}
                  </strong>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Service Address</span>
                  <strong className="text-slate-200">{validatingRequest.address}</strong>
                </div>
              </div>

              {validatingRequest.accountValidationStatus === 'validated' ? (
                <div className="bg-emerald-950/25 border border-emerald-800/60 rounded-2xl p-5 space-y-4 text-xs">
                  <div className="flex items-center gap-2 text-emerald-400 font-extrabold uppercase tracking-wider">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Official Service Account Validated &amp; Activated</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Official Account Number</span>
                      <strong className="text-sky-300 font-mono tabular-nums text-base">
                        #{validatingRequest.assignedAccountNumber}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Official Meter Tag Number</span>
                      <strong className="text-white font-mono tabular-nums text-base">
                        #{validatingRequest.assignedMeterTagNumber}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">
                        Water Meter Serial Number (Admin Meters Only)
                      </span>
                      <strong className="text-amber-300 font-mono tabular-nums text-sm">
                        {validatingRequest.meterSerialNumber}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Meter Brand &amp; Size</span>
                      <strong className="text-slate-200">
                        {validatingRequest.meterBrand || 'EVER'} · {validatingRequest.meterSize || '1/2"'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Installation Completion Date</span>
                      <strong className="text-slate-200 font-mono tabular-nums">
                        {formatInstallationDateDisplay(validatingRequest.completionDate)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Field Route Assignment</span>
                      <strong className="text-slate-200">
                        {validatingRequest.responsiblePersonnel || 'Auto-Assigned via Mobile Field Terminal'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Initial Odometer Dial</span>
                      <strong className="text-emerald-300 font-mono tabular-nums">{formatOdometerReading(0)} (00000–99999)</strong>
                    </div>
                    {validatingRequest.validatedBy && (
                      <div className="sm:col-span-2 pt-2 border-t border-emerald-800/40 text-slate-400">
                        Validated by <strong className="text-white">{validatingRequest.validatedBy}</strong> on{' '}
                        <span className="font-mono tabular-nums">
                          {validatingRequest.validatedAt
                            ? new Date(validatingRequest.validatedAt).toLocaleString()
                            : 'N/A'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Physical Water Meter Registration Fields (Serial Number restricted to Water Meters module!) */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                        <Gauge className="h-4 w-4 shrink-0" />
                        <span>1. Physical Water Meter Registration</span>
                      </h4>
                      <span className="text-[11px] text-amber-300/90">
                        Serial # visible only in Admin Water Meters
                      </span>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-bold text-slate-200">
                            Water Meter Serial Number <span className="text-rose-400">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setValSerialNumber(generateSuggestedSerialNumber())}
                            className="text-[11px] font-bold text-amber-400 hover:text-amber-300 cursor-pointer"
                          >
                            Auto-Fill Sample Serial #
                          </button>
                        </div>
                        <input
                          type="text"
                          required
                          value={valSerialNumber}
                          onChange={(e) => setValSerialNumber(e.target.value.toUpperCase())}
                          placeholder="e.g., SN-TWD-2026-482910"
                          className="w-full bg-slate-950 border border-amber-700/60 rounded-xl px-3.5 py-2.5 text-xs font-mono tabular-nums text-amber-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                          Manufacturer chassis serial number recorded strictly inside the Admin Water Meters inventory.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-300 mb-1.5">
                            Meter Brand / Model
                          </label>
                          <select
                            value={valMeterBrand}
                            onChange={(e) => setValMeterBrand(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                          >
                            {METER_BRANDS.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-300 mb-1.5">
                            Meter Pipe Size
                          </label>
                          <select
                            value={valMeterSize}
                            onChange={(e) => setValMeterSize(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                          >
                            {METER_SIZES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-300 mb-1.5">
                            Installation Completion Date <span className="text-rose-400">*</span>
                          </label>
                          <input
                            type="date"
                            required
                            value={valCompletionDate}
                            onChange={(e) => setValCompletionDate(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Official Consumer Identifiers Issuance */}
                  <div className="space-y-4 pt-4 border-t border-slate-800">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                      <UserCheck className="h-4 w-4 shrink-0" />
                      <span>2. Official Account Number &amp; Meter Tag Issuance</span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-bold text-slate-200">
                            Account Number <span className="text-rose-400">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setValAccountNumber(generateSuggestedAccountNumber(validatingRequest))}
                            className="text-[11px] font-bold text-sky-400 hover:text-sky-300 cursor-pointer"
                          >
                            Generate
                          </button>
                        </div>
                        <input
                          type="text"
                          required
                          value={valAccountNumber}
                          onChange={(e) => setValAccountNumber(e.target.value.toUpperCase())}
                          placeholder="BRG-01-4821"
                          className="w-full bg-slate-950 border border-sky-700/60 rounded-xl px-3.5 py-2.5 text-xs font-mono tabular-nums font-bold text-sky-300 focus:outline-none focus:border-sky-400"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-bold text-slate-200">
                            Meter Tag Number <span className="text-rose-400">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setValMeterTagNumber(generateSuggestedMeterTag())}
                            className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 cursor-pointer"
                          >
                            Generate
                          </button>
                        </div>
                        <input
                          type="text"
                          required
                          value={valMeterTagNumber}
                          onChange={(e) => setValMeterTagNumber(e.target.value.toUpperCase())}
                          placeholder="MT-48210"
                          className="w-full bg-slate-950 border border-cyan-700/60 rounded-xl px-3.5 py-2.5 text-xs font-mono tabular-nums font-bold text-white focus:outline-none focus:border-cyan-400"
                        />
                      </div>
                    </div>

                    <div className="bg-slate-950 border border-emerald-900/60 rounded-xl p-3.5 text-xs text-slate-300 leading-relaxed space-y-1.5">
                      <div>
                        <strong className="text-emerald-400">Consumer Account Activation:</strong> Completing validation will activate{' '}
                        <strong className="text-white">{validatingRequest.consumerName}</strong>&apos;s water service account with initial 5-digit odometer dial{' '}
                        <strong className="font-mono tabular-nums text-emerald-300">{formatOdometerReading(0)}</strong>, link Meter Tag{' '}
                        <strong className="font-mono tabular-nums text-white">#{valMeterTagNumber || '—'}</strong> to Account{' '}
                        <strong className="font-mono tabular-nums text-sky-300">#{valAccountNumber || '—'}</strong>, and automatically send the official Account Activated notification to their Consumer Portal (without exposing the physical Meter Serial Number).
                      </div>
                      <div className="text-[11px] text-sky-300/90 pt-1.5 border-t border-slate-800/80">
                        Field meter reader assignment for <strong className="text-white">Brgy. {validatingRequest.barangay}</strong> is handled automatically by the Mobile Field Terminal.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setValidatingRequest(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer"
              >
                {validatingRequest.accountValidationStatus === 'validated' ? 'Close' : 'Cancel'}
              </button>

              {validatingRequest.accountValidationStatus !== 'validated' && (
                <button
                  type="submit"
                  disabled={isValidatingAccount}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer shadow-md flex items-center gap-1.5"
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>
                    {isValidatingAccount
                      ? 'Validating & Activating...'
                      : 'Verify Installation, Issue IDs & Activate Account'}
                  </span>
                </button>
              )}
            </div>
          </form>
        </div>,
              document.body
            )
          : null)}

      {/* Complete Read-Only Installation Request & Applicant Details Modal (Row Click) */}
      {viewingRequestDetail &&
        (typeof document !== 'undefined'
          ? createPortal(
              <div
                className="fixed inset-0 z-[160] bg-slate-950/85 backdrop-blur-sm flex items-start justify-center pt-2 sm:pt-3 px-3 sm:px-4 pb-6 overflow-y-auto"
                onClick={() => setViewingRequestDetail(null)}
                role="dialog"
                aria-modal="true"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0 self-start w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 max-h-[calc(100vh-1.25rem)] sm:max-h-[calc(100vh-1.75rem)] flex flex-col"
                >
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-cyan-500/15 border border-cyan-500/30 rounded-xl text-cyan-400 shrink-0">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-black text-white truncate">
                      {viewingRequestDetail.consumerName}
                    </h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase border ${getStatusBadgeClasses(
                        viewingRequestDetail.status
                      )}`}
                    >
                      {viewingRequestDetail.status}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono tabular-nums text-slate-400 truncate mt-0.5">
                    Application #{viewingRequestDetail.applicationNumber} · Submitted {formatInstallationDateDisplay(viewingRequestDetail.submissionDate)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingRequestDetail(null)}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950 border border-slate-800 rounded-xl p-4">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Consumer Name</span>
                  <span className="font-bold text-white">{viewingRequestDetail.consumerName}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Classification</span>
                  <span className="font-semibold text-slate-200">{viewingRequestDetail.consumerType || 'Residential'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Contact Number</span>
                  <span className="font-mono tabular-nums text-slate-200">{viewingRequestDetail.contactNumber || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Email Address</span>
                  <span className="text-slate-200">{viewingRequestDetail.consumerEmail || 'N/A'}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Service Address &amp; Barangay</span>
                  <span className="text-slate-200 font-medium">
                    {viewingRequestDetail.address} (Brgy. {viewingRequestDetail.barangay || 'Tagoloan'})
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950 border border-slate-800 rounded-xl p-4">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Requested Schedule</span>
                  <span className="font-mono tabular-nums font-bold text-slate-200">
                    {formatInstallationDateDisplay(viewingRequestDetail.preferredInstallationDate)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Confirmed Schedule</span>
                  <span className="font-mono tabular-nums font-bold text-sky-300">
                    {viewingRequestDetail.confirmedInstallationDate
                      ? formatInstallationDateDisplay(viewingRequestDetail.confirmedInstallationDate)
                      : 'Not yet confirmed'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Completion Date</span>
                  <span className="font-mono tabular-nums font-bold text-emerald-400">
                    {viewingRequestDetail.completionDate
                      ? formatInstallationDateDisplay(viewingRequestDetail.completionDate)
                      : 'Pending completion'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950 border border-slate-800 rounded-xl p-4">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Official Account #</span>
                  <span className="font-mono tabular-nums font-bold text-sky-400">
                    {viewingRequestDetail.assignedAccountNumber ? `#${viewingRequestDetail.assignedAccountNumber}` : 'Pending Validation'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Official Meter Tag #</span>
                  <span className="font-mono tabular-nums font-bold text-white">
                    {viewingRequestDetail.assignedMeterTagNumber ? `#${viewingRequestDetail.assignedMeterTagNumber}` : 'Pending Validation'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Meter Serial #</span>
                  <span className="font-mono tabular-nums font-bold text-amber-300">
                    {viewingRequestDetail.meterSerialNumber || 'Not recorded yet'}
                  </span>
                </div>
              </div>

              {(viewingRequestDetail.consumerRemarks || viewingRequestDetail.adminRemarks || viewingRequestDetail.responsiblePersonnel) && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
                  {viewingRequestDetail.responsiblePersonnel && (
                    <div>
                      <span className="text-[10px] font-bold uppercase text-slate-500 block">Field Route Assignment</span>
                      <span className="text-slate-200 font-semibold">{viewingRequestDetail.responsiblePersonnel}</span>
                    </div>
                  )}
                  {viewingRequestDetail.consumerRemarks && (
                    <div>
                      <span className="text-[10px] font-bold uppercase text-slate-500 block">Applicant Instructions / Remarks</span>
                      <p className="text-slate-300 leading-relaxed">{viewingRequestDetail.consumerRemarks}</p>
                    </div>
                  )}
                  {viewingRequestDetail.adminRemarks && (
                    <div>
                      <span className="text-[10px] font-bold uppercase text-slate-500 block">Administrator Remarks</span>
                      <p className="text-slate-200 leading-relaxed">{viewingRequestDetail.adminRemarks}</p>
                    </div>
                  )}
                </div>
              )}

              {Array.isArray(viewingRequestDetail.history) && viewingRequestDetail.history.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Activity &amp; Schedule History
                  </span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {[...viewingRequestDetail.history]
                      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
                      .map((h) => (
                        <div
                          key={h.id}
                          className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 text-[11px]"
                        >
                          <div>
                            <span className="font-bold text-white">{h.action || h.status}</span>
                            {h.remarks && <p className="text-slate-400 mt-0.5">{h.remarks}</p>}
                          </div>
                          <span className="font-mono tabular-nums text-[10px] text-slate-500 shrink-0">
                            {new Date(h.timestamp).toLocaleString()}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingRequestDetail;
                    setViewingRequestDetail(null);
                    openReviewModal(target);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition cursor-pointer"
                >
                  {viewingRequestDetail.status === 'Pending Review'
                    ? 'Accept / Update Status'
                    : 'Update Status & Schedule'}
                </button>
                {viewingRequestDetail.status === 'Installed' && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = viewingRequestDetail;
                      setViewingRequestDetail(null);
                      openValidationModal(target);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>
                      {viewingRequestDetail.accountValidationStatus === 'validated'
                        ? 'Validated Details'
                        : 'Validate & Issue IDs'}
                    </span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setViewingRequestDetail(null)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
              document.body
            )
          : null)}
    </div>
  );
};

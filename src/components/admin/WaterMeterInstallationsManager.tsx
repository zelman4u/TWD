/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
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

  // Modal 1: Review & Schedule Management
  const [reviewingRequest, setReviewingRequest] = useState<WaterMeterInstallationRequest | null>(null);
  const [editStatus, setEditStatus] = useState<InstallationStatus>('Pending Review');
  const [editConfirmedDate, setEditConfirmedDate] = useState('');
  const [editCompletionDate, setEditCompletionDate] = useState('');
  const [editPersonnel, setEditPersonnel] = useState('');
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
  const [valPersonnel, setValPersonnel] = useState('');
  const [valError, setValError] = useState<string | null>(null);
  const [isValidatingAccount, setIsValidatingAccount] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const openReviewModal = (req: WaterMeterInstallationRequest) => {
    if (req.hasUnreadAdminAlert) {
      mockDb.markInstallationReadByAdmin(req.id);
      onRefreshData();
    }
    setReviewingRequest(req);
    setEditStatus(req.status);
    setEditConfirmedDate(req.confirmedInstallationDate || req.preferredInstallationDate || '');
    setEditCompletionDate(req.completionDate || new Date().toISOString().split('T')[0]);
    setEditPersonnel(req.responsiblePersonnel || '');
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
    if (req.hasUnreadAdminAlert) {
      mockDb.markInstallationReadByAdmin(req.id);
      onRefreshData();
    }
    const suggestedTag = req.assignedMeterTagNumber || generateSuggestedMeterTag();
    const suggestedAcc = req.assignedAccountNumber || generateSuggestedAccountNumber(req);

    setValidatingRequest(req);
    setValSerialNumber(req.meterSerialNumber || '');
    setValMeterBrand(req.meterBrand || 'EVER');
    setValMeterSize(req.meterSize || (req.consumerType === 'Commercial' ? '3/4"' : '1/2"'));
    setValMeterTagNumber(suggestedTag);
    setValAccountNumber(suggestedAcc);
    setValCompletionDate(req.completionDate || new Date().toISOString().split('T')[0]);
    setValPersonnel(req.responsiblePersonnel || '');
    setValError(null);
  };

  // Handle deep-link selection from Admin Notification Bell or Consumers tab
  useEffect(() => {
    if (!initialSelectedRequestId) return;
    const found = requests.find(
      (r) => r.id === initialSelectedRequestId || r.applicationNumber === initialSelectedRequestId
    );
    if (found) {
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
            new Date(a.updatedAt || a.submissionDate || 0).getTime()
      );
  }, [requests, statusFilter, searchQuery]);

  const paginatedRequests = useMemo(() => {
    const start = (currentPage - 1) * 10;
    return filteredRequests.slice(start, start + 10);
  }, [filteredRequests, currentPage]);

  const handleSaveScheduleAndStatus = (proceedToValidation = false) => {
    if (!reviewingRequest) return;

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
        responsiblePersonnel: editPersonnel.trim() || undefined,
        adminRemarks: editAdminRemarks.trim(),
        adminId: adminUser.id,
        adminName: adminUser.name || 'TWD Administrator',
      });

      if (updated) {
        sendRealtimeMessage('INSTALLATION_REQUEST_UPDATED', {
          requestId: updated.id,
          applicationNumber: updated.applicationNumber,
          status: updated.status,
          consumerEmail: updated.consumerEmail,
        });
        onRefreshData();
        toast.success(
          'Installation Updated',
          `Installation request ${updated.applicationNumber} updated to "${updated.status}". Automatic consumer notification dispatched.`
        );
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
    if (!valPersonnel.trim()) {
      setValError('Please record the Responsible Field Personnel who completed the installation.');
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
        responsiblePersonnel: valPersonnel.trim(),
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
      {/* KPI SUMMARY STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Requests</span>
            <Wrench className="h-4 w-4 text-sky-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-white font-mono tabular-nums">{stats.total}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {unscheduledApplicantsCount > 0
                ? `${unscheduledApplicantsCount} applicant(s) yet to schedule`
                : 'All active meter applications'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'Pending Review' ? 'All' : 'Pending Review')}
          className={`text-left bg-slate-900 border rounded-2xl p-4 shadow-md flex flex-col justify-between transition cursor-pointer ${
            statusFilter === 'Pending Review'
              ? 'border-amber-500 ring-1 ring-amber-500/30'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-amber-300">
            <span className="text-[10px] font-bold uppercase tracking-wider">Pending Review</span>
            <Clock className="h-4 w-4 text-amber-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-amber-400 font-mono tabular-nums">
              {stats.pendingReview}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Awaiting schedule confirmation</div>
          </div>
        </button>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-center justify-between text-blue-300">
            <span className="text-[10px] font-bold uppercase tracking-wider">Scheduled / Field</span>
            <Calendar className="h-4 w-4 text-blue-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-blue-400 font-mono tabular-nums">
              {stats.scheduledActive}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Approved, Scheduled & In Progress</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setStatusFilter(statusFilter === 'Awaiting Validation' ? 'All' : 'Awaiting Validation')
          }
          className={`text-left bg-slate-900 border rounded-2xl p-4 shadow-md flex flex-col justify-between transition cursor-pointer ${
            statusFilter === 'Awaiting Validation'
              ? 'border-cyan-500 ring-1 ring-cyan-500/30'
              : stats.awaitingValidation > 0
              ? 'border-cyan-500/40 hover:border-cyan-400'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-cyan-300">
            <span className="text-[10px] font-bold uppercase tracking-wider">Awaiting Validation</span>
            <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-cyan-400 font-mono tabular-nums">
              {stats.awaitingValidation}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Installed · Ready to issue IDs</div>
          </div>
        </button>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-emerald-300">
            <span className="text-[10px] font-bold uppercase tracking-wider">Validated & Active</span>
            <UserCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-emerald-400 font-mono tabular-nums">
              {stats.validated}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Account & Meter Tag issued</div>
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
                const submittedDisplay = formatInstallationDateDisplay(req.submissionDate);

                return (
                  <tr
                    key={req.id}
                    className={`transition ${
                      req.hasUnreadAdminAlert
                        ? 'bg-sky-950/25 hover:bg-sky-950/40'
                        : isInstalled && !isValidated
                        ? 'bg-cyan-950/15 hover:bg-cyan-950/30'
                        : 'hover:bg-slate-800/60'
                    }`}
                  >
                    {/* Application # & Submission Date */}
                    <td className="px-4 py-3.5 border-r border-slate-800/80 align-top">
                      <div className="flex items-center gap-1.5">
                        {req.hasUnreadAdminAlert && (
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
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border whitespace-nowrap ${getStatusBadgeClasses(
                          req.status
                        )}`}
                      >
                        {req.status}
                      </span>
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
                          <p className="text-[11px] text-slate-400 leading-snug">
                            Ready to record Meter Serial # and issue Account # &amp; Meter Tag #.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1 text-[11px] text-slate-400">
                          <span className="inline-flex items-center gap-1 text-slate-400 font-semibold">
                            <Lock className="h-3 w-3 text-slate-500 shrink-0" />
                            <span>Locked until Installed</span>
                          </span>
                          <p className="text-[10px] text-slate-500 leading-snug">
                            Confirm physical installation first before issuing IDs.
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
                          onClick={() => openReviewModal(req)}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer"
                        >
                          Manage Schedule
                        </button>

                        {isValidated ? (
                          <button
                            type="button"
                            onClick={() => openValidationModal(req)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-700/60 text-emerald-300 text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer flex items-center gap-1"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>Validated Details</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!isInstalled}
                            onClick={() => openValidationModal(req)}
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
          currentPage={currentPage}
          totalItems={filteredRequests.length}
          pageSize={10}
          onPageChange={setCurrentPage}
          itemName="installation requests"
        />
      </div>

      {/* =====================================================================
          MODAL 1: REVIEW & UPDATE INSTALLATION STATUS / SCHEDULE
      ====================================================================== */}
      {reviewingRequest && (
        <div
          className="fixed inset-0 z-[140] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setReviewingRequest(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[88vh] shadow-2xl overflow-hidden flex flex-col text-slate-100"
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
                  <>
                    <div>
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
                    <div>
                      <label className="block text-xs font-bold text-emerald-300 mb-1.5">
                        Responsible Field Personnel / Crew
                      </label>
                      <input
                        type="text"
                        value={editPersonnel}
                        onChange={(e) => setEditPersonnel(e.target.value)}
                        placeholder="e.g., TWD Field Crew A / Engr. R. Dalisay"
                        className="w-full bg-slate-950 border border-emerald-700/60 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </>
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
                      ? 'Optional installation completion remarks (Consumer will be notified that account validation is underway)...'
                      : 'Provide schedule confirmation notes, site preparation instructions, or remarks...'
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Automatic Notification Notice */}
              <div className="bg-slate-950 border border-sky-900/60 rounded-xl p-3.5 text-xs text-slate-300 leading-relaxed">
                <strong className="text-sky-300">Automatic Consumer Notification:</strong> Saving changes to the installation status or confirmed schedule will automatically dispatch an official Tagoloan Water District notice to{' '}
                <strong className="text-white">{reviewingRequest.consumerName}</strong> in their Consumer Portal Notification Center.
                {editStatus === 'Installed' && (
                  <span className="block mt-1 text-emerald-300 font-semibold">
                    Note: Marking as &ldquo;Installed&rdquo; notifies the consumer that physical installation is complete and unlocks Step 2 (Meter Serial Registration &amp; Official Account/Meter Tag Issuance).
                  </span>
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
        </div>
      )}

      {/* =====================================================================
          MODAL 2: POST-INSTALLATION METER REGISTRATION & ACCOUNT VALIDATION
          (Strictly unlocked ONLY when status === 'Installed')
      ====================================================================== */}
      {validatingRequest && (
        <div
          className="fixed inset-0 z-[145] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setValidatingRequest(null)}
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleValidateAndActivateSubmit}
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] shadow-2xl overflow-hidden flex flex-col text-slate-100"
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
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Responsible Personnel</span>
                      <strong className="text-slate-200">{validatingRequest.responsiblePersonnel || 'N/A'}</strong>
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
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                        <Gauge className="h-4 w-4 shrink-0" />
                        <span>1. Physical Water Meter Registration</span>
                      </h4>
                      <span className="text-[10px] font-bold text-amber-300/90 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded">
                        Serial # Visible Only in Admin Water Meters
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
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

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">
                          Responsible Field Personnel <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={valPersonnel}
                          onChange={(e) => setValPersonnel(e.target.value)}
                          placeholder="e.g., Engr. R. Dalisay / Field Team A"
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        />
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

                    <div className="bg-slate-950 border border-emerald-900/60 rounded-xl p-3.5 text-xs text-slate-300 leading-relaxed">
                      <strong className="text-emerald-400">Consumer Account Activation:</strong> Completing validation will activate{' '}
                      <strong className="text-white">{validatingRequest.consumerName}</strong>&apos;s water service account, link Meter Tag{' '}
                      <strong className="font-mono tabular-nums text-white">#{valMeterTagNumber || '—'}</strong> to Account{' '}
                      <strong className="font-mono tabular-nums text-sky-300">#{valAccountNumber || '—'}</strong>, and automatically send the official Account Activated notification to their Consumer Portal (without exposing the physical Meter Serial Number).
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
        </div>
      )}
    </div>
  );
};

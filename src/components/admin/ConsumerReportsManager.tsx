/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  AlertTriangle, 
  Droplet, 
  Gauge, 
  HelpCircle, 
  FileText, 
  CheckCircle2, 
  Clock, 
  Send, 
  MessageSquare, 
  ShieldAlert, 
  Camera, 
  MapPin, 
  Phone, 
  User, 
  Filter, 
  RefreshCw,
  Search,
  X,
  Building,
  Check,
  AlertOctagon,
  ChevronRight,
  ExternalLink,
  Zap,
  Maximize2,
  ShieldCheck,
  ImageIcon
} from 'lucide-react';
import { ConsumerReport, ConsumerReportReply, User as UserType, Barangay } from '../../types';
import { mockDb } from '../../mockDb';
import { apiClient } from '../../services/apiClient';
import { sendRealtimeMessage } from '../../services/realtimeSocket';
import { useToast } from '../../context/ToastContext';
import { TablePagination } from '../common/TablePagination';
import { SmartSearchBar } from '../common/SmartSearchBar';
import { smartMatch } from '../../utils/smartSearch';

interface ConsumerReportsManagerProps {
  currentUser: UserType;
  reports: ConsumerReport[];
  onRefreshReports: () => void;
  barangays?: Barangay[];
}

const CATEGORY_MAP: Record<string, { label: string; icon: any; color: string }> = {
  leak: { label: 'Water Leak / Burst', icon: Droplet, color: 'text-blue-700 bg-blue-100 border-blue-200' },
  low_pressure: { label: 'Low Pressure / Dry', icon: Gauge, color: 'text-amber-700 bg-amber-100 border-amber-200' },
  water_quality: { label: 'Dirty / Turbid Water', icon: AlertTriangle, color: 'text-orange-700 bg-orange-100 border-orange-200' },
  billing: { label: 'Billing Discrepancy', icon: FileText, color: 'text-indigo-700 bg-indigo-100 border-indigo-200' },
  meter_issue: { label: 'Defective Meter', icon: AlertOctagon, color: 'text-purple-700 bg-purple-100 border-purple-200' },
  illegal_connection: { label: 'Illegal Connection', icon: ShieldAlert, color: 'text-rose-700 bg-rose-100 border-rose-200' },
  other: { label: 'General Inquiry', icon: HelpCircle, color: 'text-slate-700 bg-slate-100 border-slate-200' },
};

const QUICK_REPLIES = [
  {
    label: 'Dispatch Crew (Leak / Burst)',
    status: 'in_progress' as const,
    crew: 'Field Maintenance Crew - Team Alpha (Engr. Morales)',
    text: 'Good day. We have received your report and dispatched our Field Maintenance Crew (Team Alpha) to inspect and isolate the pipeline. We will update you as soon as excavation or coupling repairs begin.'
  },
  {
    label: 'Water Pressure / Line Flushing',
    status: 'in_progress' as const,
    crew: 'Distribution & Valves Operations Team',
    text: 'We are conducting line maintenance and valve calibration in your barangay zone. A system flush is underway, and standard operating water pressure will normalize shortly.'
  },
  {
    label: 'Billing Statement Reconciled',
    status: 'resolved' as const,
    crew: 'Commercial & Billing Dept.',
    text: 'We have verified your historical index telemetry and photographic reader logs. Your billing ledger has been updated, and any necessary tariff adjustment has been applied to your statement.'
  },
  {
    label: 'Meter Inspection Scheduled',
    status: 'in_progress' as const,
    crew: 'Mechanical Meter Maintenance Section',
    text: 'An official meter testing specialist has been scheduled to inspect your meter assembly. Please ensure the meter box area is accessible during operational hours.'
  },
  {
    label: 'Issue Resolved & Verified',
    status: 'resolved' as const,
    crew: 'TWD Operations Desk',
    text: 'Our field crew has confirmed complete resolution of the reported issue. The line has been restored to optimal operating standards. Thank you for reporting this to Tagoloan Water District!'
  }
];

export function ConsumerReportsManager({
  currentUser,
  reports,
  onRefreshReports,
  barangays = []
}: ConsumerReportsManagerProps) {
  const toast = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'resolved' | 'closed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all');
  const [barangayFilter, setBarangayFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, categoryFilter, urgencyFilter, barangayFilter]);

  // Active report selected for reply modal
  const [activeReport, setActiveReport] = useState<ConsumerReport | null>(null);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<string | null>(null);

  // Reply Composer form
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState<ConsumerReport['status']>('in_progress');
  const [assignedCrew, setAssignedCrew] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Keyboard shortcut (Escape key to dismiss modal or photo lightbox)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedPhotoPreview) {
          setSelectedPhotoPreview(null);
        } else if (activeReport) {
          setActiveReport(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeReport, selectedPhotoPreview]);

  // Lock body scroll when modal is open
  React.useEffect(() => {
    if (activeReport || selectedPhotoPreview) {
      const originalStyle = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [activeReport, selectedPhotoPreview]);

  // Smooth scroll to latest reply on open or update
  React.useEffect(() => {
    if (activeReport && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeReport?.replies?.length]);

  // Keep activeReport live-synced when reports prop receives new consumer follow-up messages
  React.useEffect(() => {
    if (!activeReport) return;
    const latest = reports.find(
      r => r.id === activeReport.id || r.ticketNumber === activeReport.ticketNumber
    );
    if (
      latest &&
      (latest.updatedAt !== activeReport.updatedAt ||
        latest.status !== activeReport.status ||
        latest.replies.length !== activeReport.replies.length)
    ) {
      setActiveReport(latest);
      if (latest.hasUnreadConsumerUpdate) {
        mockDb.markReportReadByAdmin(latest.id);
      }
    }
  }, [reports, activeReport?.id]);

  // Fast 2-second live sync while Admin is viewing Customer Service & Consumer Inquiries
  const refreshReportsRef = React.useRef(onRefreshReports);
  refreshReportsRef.current = onRefreshReports;
  React.useEffect(() => {
    refreshReportsRef.current();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        refreshReportsRef.current();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Filtered reports
  const filteredReports = reports.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
    if (urgencyFilter !== 'all' && r.urgency !== urgencyFilter) return false;
    if (barangayFilter !== 'all' && r.barangay !== barangayFilter) return false;

    if (searchTerm.trim()) {
      const catLabel = CATEGORY_MAP[r.category]?.label || r.category;
      const replyMessages = (r.replies || []).map(rep => rep.message);
      const matches = smartMatch(searchTerm, [
        r.ticketNumber,
        r.consumerName,
        r.accountNumber,
        r.consumerPhone,
        r.consumerEmail,
        r.barangay,
        r.address,
        r.meterNumber,
        r.category,
        catLabel,
        r.urgency,
        r.status,
        r.title,
        r.description,
        r.assignedStaff,
        replyMessages,
      ]);
      if (!matches) return false;
    }

    return true;
  });

  // KPI aggregates
  const totalCount = reports.length;
  const pendingCount = reports.filter(r => r.status === 'pending').length;
  const inProgressCount = reports.filter(r => r.status === 'in_progress').length;
  const resolvedCount = reports.filter(r => r.status === 'resolved' || r.status === 'closed').length;
  const emergencyCount = reports.filter(r => r.urgency === 'emergency').length;

  const handleOpenReport = (report: ConsumerReport) => {
    setActiveReport(report);
    setReplyStatus(report.status === 'pending' ? 'in_progress' : report.status);
    setAssignedCrew(report.assignedStaff || '');
    setReplyText('');
    mockDb.markReportReadByAdmin(report.id);
  };

  const handleApplyQuickReply = (snippet: typeof QUICK_REPLIES[0]) => {
    setReplyText(snippet.text);
    setReplyStatus(snippet.status);
    setAssignedCrew(snippet.crew);
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReport || !replyText.trim()) {
      toast.warning('Reply Message Required', 'Please enter your official reply to the consumer.');
      return;
    }

    const cleanReplyText = replyText.trim();
    const cleanCrew = assignedCrew.trim() || undefined;
    const targetReportSnapshot = activeReport;

    setIsSubmittingReply(true);
    try {
      const replyId = `REP-MSG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const replyTimestamp = new Date().toISOString();
      const replyData = {
        id: replyId,
        timestamp: replyTimestamp,
        senderId: currentUser.id || 'admin',
        senderName: currentUser.name || 'Admin',
        senderRole: 'admin' as const,
        message: cleanReplyText,
        statusUpdate: replyStatus,
        assignedStaff: cleanCrew
      };

      // 1. Save immediately in local store (0ms — also generates consumer report notification)
      const updated = mockDb.replyToReport(targetReportSnapshot.id, replyData, replyStatus, cleanCrew);

      // Find the newly generated report notification so BroadcastChannel / WebSocket delivers it in 0ms
      const createdReportNotif = updated
        ? mockDb
            .getNotifications(updated.accountNumber, { email: updated.consumerEmail })
            .find(n => n.type === 'report' && (n.reportId === updated.id || n.ticketNumber === updated.ticketNumber))
        : undefined;

      // 2. Broadcast immediately via BroadcastChannel + WebSocket (0ms across tabs & connected clients)
      if (updated) {
        sendRealtimeMessage('ADMIN_REPLIED_TO_REPORT', {
          report: updated,
          notification: createdReportNotif,
          accountNumber: updated.accountNumber,
          consumerEmail: updated.consumerEmail,
          ticketNumber: updated.ticketNumber,
          message: `Admin ${replyData.senderName} responded to Ticket #${updated.ticketNumber}: "${replyData.message}" (Status: ${(replyStatus || updated.status).toUpperCase()})`,
        });
        if (createdReportNotif) {
          sendRealtimeMessage('CONSUMER_NOTIFICATION_CREATED', {
            notification: createdReportNotif,
            accountNumber: updated.accountNumber,
            consumerEmail: updated.consumerEmail,
          });
        }
      }

      // 3. Update Admin UI immediately without waiting for network roundtrip
      setReplyText('');
      if (updated) {
        setActiveReport(updated);
      }
      onRefreshReports();

      toast.success(
        'Reply Transmitted to Consumer',
        `Official response logged for Ticket #${targetReportSnapshot.ticketNumber}. Consumer Account #${targetReportSnapshot.accountNumber} has been notified.`
      );

      // 4. Persist asynchronously to backend API (pass pre-reply snapshot + deterministic replyId so server never duplicates)
      apiClient
        .replyToReport(targetReportSnapshot.id, {
          ...replyData,
          replyId,
          report: targetReportSnapshot,
        })
        .then((res) => {
          if (res?.report) {
            mockDb.mergeExternalReports([res.report]);
            onRefreshReports();
          }
          if (res?.notification) {
            mockDb.mergeExternalNotifications([res.notification]);
          }
        })
        .catch((apiErr) => {
          console.warn('[Admin Reply API Sync Warning]:', apiErr);
        });
    } catch (err: any) {
      toast.error('Failed to Send Reply', err?.message || 'Error communicating with server.');
    } finally {
      setIsSubmittingReply(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" id="admin-customer-service-manager">
      
      {/* Customer Service Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 text-white shadow-xl">
        <div className="flex items-start space-x-3.5">
          <div className="p-3 bg-rose-600/20 text-rose-400 rounded-xl border border-rose-500/30 shrink-0">
            <MessageSquare className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-black uppercase tracking-wider text-white flex items-center gap-2">
              <span>Customer Service & Consumer Inquiries</span>
              {pendingCount > 0 && (
                <span className="text-[10px] font-black uppercase px-2.5 py-0.5 bg-rose-500 text-white rounded-full animate-pulse">
                  {pendingCount} Pending Review
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Official customer service response desk for water consumer concerns, emergency leak reports, pressure issues, and service inquiries filed from the Consumer Portal.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onRefreshReports}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition cursor-pointer"
            title="Refresh Inquiries"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Tickets</span>
          </button>
        </div>
      </div>

      {/* Module Title & Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Customer Inquiries</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{totalCount}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Customer Service Log</p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold shrink-0">
            <MessageSquare className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-amber-200/90 shadow-xs flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Pending Initial Review</p>
              {pendingCount > 0 && <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>}
            </div>
            <p className="text-2xl font-black text-amber-600 mt-1">{pendingCount}</p>
            <p className="text-[10px] text-amber-700/80 mt-0.5">Needs Administrative Action</p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center font-bold shrink-0">
            <Clock className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-blue-200/90 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">In Progress / Dispatched</p>
            <p className="text-2xl font-black text-blue-600 mt-1">{inProgressCount}</p>
            <p className="text-[10px] text-blue-600/80 mt-0.5">Field Crews Operating</p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center font-bold shrink-0">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-emerald-200/90 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Resolved Cases</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{resolvedCount}</p>
            <p className="text-[10px] text-emerald-600/80 mt-0.5">Closed Successfully</p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center font-bold shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-rose-200/90 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Emergency Priority</p>
            <p className="text-2xl font-black text-rose-600 mt-1">{emergencyCount}</p>
            <p className="text-[10px] text-rose-600/80 mt-0.5">High Severity / Floods</p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center font-bold shrink-0">
            <AlertOctagon className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Control Panel: Search & Filters */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          
          {/* Smart Search bar */}
          <div className="flex-1 lg:max-w-lg w-full">
            <SmartSearchBar
              variant="light"
              value={searchTerm}
              onChange={setSearchTerm}
              resultCount={filteredReports.length}
              totalCount={reports.length}
              placeholder="Smart search Ticket #, consumer, account #, phone, barangay, or issue..."
              id="admin-reports-smart-search"
            />
          </div>

          {/* Filter dropdowns */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending Review ({pendingCount})</option>
              <option value="in_progress">In Progress ({inProgressCount})</option>
              <option value="resolved">Resolved ({resolvedCount})</option>
              <option value="closed">Closed</option>
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Categories</option>
              <option value="leak">Water Leak / Pipe Burst</option>
              <option value="low_pressure">Low Pressure / No Water</option>
              <option value="water_quality">Dirty Water / Sediments</option>
              <option value="billing">Billing Inquiry</option>
              <option value="meter_issue">Defective Meter</option>
              <option value="illegal_connection">Illegal Connection</option>
              <option value="other">General Inquiry</option>
            </select>

            <select
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Priorities</option>
              <option value="emergency">Emergency</option>
              <option value="urgent">Urgent</option>
              <option value="normal">Normal</option>
            </select>

            <button
              onClick={onRefreshReports}
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer"
              title="Refresh Reports from Server"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Reports Table / List */}
      <div className="bg-slate-900 rounded-none border border-slate-800 shadow-xl overflow-hidden">
        {filteredReports.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="h-12 w-12 rounded-xl bg-slate-800 text-slate-400 mx-auto flex items-center justify-center border border-slate-700">
              <FileText className="h-6 w-6" />
            </div>
            <h4 className="text-sm font-bold text-white">No Customer Service Inquiries Found</h4>
            <p className="text-xs text-slate-400">There are no customer service inquiries matching your current filter criteria.</p>
          </div>
        ) : (() => {
          const paginatedReports = filteredReports.slice((currentPage - 1) * 10, currentPage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-300 uppercase text-[10px] tracking-wider font-extrabold border-b border-slate-800">
                      <th className="py-3.5 px-4">Ticket & Priority</th>
                      <th className="py-3.5 px-4">Consumer & Account</th>
                      <th className="py-3.5 px-4">Concern Category</th>
                      <th className="py-3.5 px-4">Summary & Title</th>
                      <th className="py-3.5 px-4">Status & Action</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900 text-slate-200">
                    {paginatedReports.map((report) => {
                      const catMeta = CATEGORY_MAP[report.category] || CATEGORY_MAP.other;
                      const CatIcon = catMeta.icon;

                      return (
                        <tr
                          key={report.id}
                          className="hover:bg-slate-800/60 transition-colors group cursor-pointer"
                          onClick={() => handleOpenReport(report)}
                        >
                          {/* Ticket & Priority */}
                          <td className="py-4 px-4 whitespace-nowrap">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-sky-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 shadow-2xs">
                                  {report.ticketNumber}
                                </span>
                                {report.hasUnreadConsumerUpdate && (
                                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" title="New update from consumer"></span>
                                )}
                              </div>
                              <div>
                                {report.urgency === 'emergency' && (
                                  <span className="inline-block px-2 py-0.5 bg-rose-950/80 text-rose-300 border border-rose-800/80 font-extrabold text-[9px] uppercase rounded animate-pulse">
                                    Emergency
                                  </span>
                                )}
                                {report.urgency === 'urgent' && (
                                  <span className="inline-block px-2 py-0.5 bg-amber-950/80 text-amber-300 border border-amber-800/80 font-bold text-[9px] uppercase rounded">
                                    Urgent
                                  </span>
                                )}
                                {report.urgency === 'normal' && (
                                  <span className="inline-block px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 font-semibold text-[9px] rounded">
                                    Normal
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Consumer & Account */}
                          <td className="py-4 px-4">
                            <div className="space-y-0.5">
                              <p className="font-black text-white leading-tight">{report.consumerName}</p>
                              <p className="font-mono text-[11px] text-sky-400 font-bold">#{report.accountNumber || 'Pending'}</p>
                              <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                <MapPin className="h-3 w-3 text-slate-500" />
                                <span>{report.barangay}</span>
                                {report.consumerPhone && <span>• {report.consumerPhone}</span>}
                              </p>
                            </div>
                          </td>

                          {/* Category */}
                          <td className="py-4 px-4 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-700 bg-slate-950/80 text-[11px] font-bold text-slate-200">
                              <CatIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                              <span>{catMeta.label}</span>
                            </div>
                          </td>

                          {/* Summary */}
                          <td className="py-4 px-4 max-w-xs">
                            <div className="space-y-0.5">
                              <p className="font-bold text-white truncate">{report.title}</p>
                              <p className="text-[11px] text-slate-400 line-clamp-1">{report.description}</p>
                              <span className="text-[10px] text-slate-500">
                                {new Date(report.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            </div>
                          </td>

                          {/* Status */}
                          <td className="py-4 px-4 whitespace-nowrap">
                            <div className="space-y-1">
                              {report.status === 'pending' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-950/80 text-amber-300 border border-amber-800/80">
                                  <Clock className="h-3 w-3 text-amber-400" />
                                  Pending Review
                                </span>
                              )}
                              {report.status === 'in_progress' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-950/80 text-blue-300 border border-blue-800/80">
                                  <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
                                  In Progress
                                </span>
                              )}
                              {report.status === 'resolved' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-950/80 text-emerald-300 border border-emerald-800/80">
                                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                  Resolved
                                </span>
                              )}
                              {report.status === 'closed' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-400 border border-slate-700">
                                  Closed
                                </span>
                              )}
                              {report.assignedStaff && (
                                <p className="text-[10px] text-slate-400 truncate max-w-[140px]">
                                  Crew: {report.assignedStaff}
                                </p>
                              )}
                            </div>
                          </td>

                          {/* Action */}
                          <td className="py-4 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenReport(report);
                              }}
                              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-extrabold rounded-lg text-xs shadow-xs transition flex items-center gap-1 ml-auto cursor-pointer"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              <span>Review & Reply</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={currentPage}
                totalItems={filteredReports.length}
                pageSize={10}
                onPageChange={setCurrentPage}
                itemName="inquiries"
              />
            </div>
          );
        })()}
      </div>

      {/* MODAL: ADMIN REVIEW & REPLY DRAWER */}
      {activeReport && (
        <div 
          className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-slate-950/90 backdrop-blur-md animate-fade-in select-none"
          onClick={() => setActiveReport(null)}
        >
          <div 
            className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-scale-up select-text text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Modal Header */}
            <div className="bg-slate-950 text-white p-4 sm:p-5 flex items-center justify-between border-b border-slate-800 shrink-0 gap-4">
              <div className="space-y-1.5 min-w-0 pr-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-black text-blue-400 bg-blue-950/90 px-2.5 py-0.5 rounded-lg border border-blue-800/80 shadow-inner">
                    {activeReport.ticketNumber}
                  </span>
                  
                  {/* Category Pill */}
                  <span className="text-[11px] uppercase font-extrabold px-2.5 py-0.5 rounded-lg bg-slate-800/90 text-slate-200 border border-slate-700/80 flex items-center gap-1.5">
                    {(() => {
                      const meta = CATEGORY_MAP[activeReport.category] || CATEGORY_MAP.other;
                      const Icon = meta.icon;
                      return (
                        <>
                          <Icon className="h-3 w-3 text-blue-400" />
                          <span>{meta.label}</span>
                        </>
                      );
                    })()}
                  </span>

                  {/* Urgency Pill */}
                  {activeReport.urgency === 'emergency' && (
                    <span className="bg-rose-950/90 text-rose-300 border border-rose-700/80 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-lg animate-pulse flex items-center gap-1">
                      <AlertOctagon className="h-3 w-3 text-rose-400" />
                      <span>Emergency Priority</span>
                    </span>
                  )}
                  {activeReport.urgency === 'urgent' && (
                    <span className="bg-amber-950/90 text-amber-300 border border-amber-700/80 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-lg flex items-center gap-1">
                      <Clock className="h-3 w-3 text-amber-400" />
                      <span>Urgent Priority</span>
                    </span>
                  )}
                  {activeReport.urgency === 'normal' && (
                    <span className="bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-lg">
                      Normal Priority
                    </span>
                  )}

                  {/* Status Badge */}
                  {activeReport.status === 'pending' && (
                    <span className="bg-amber-950/80 text-amber-300 border border-amber-800/80 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-lg">
                      Pending Review
                    </span>
                  )}
                  {activeReport.status === 'in_progress' && (
                    <span className="bg-blue-950/80 text-blue-300 border border-blue-800/80 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-lg">
                      In Progress / Dispatched
                    </span>
                  )}
                  {activeReport.status === 'resolved' && (
                    <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-lg">
                      Resolved
                    </span>
                  )}
                  {activeReport.status === 'closed' && (
                    <span className="bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-lg">
                      Closed
                    </span>
                  )}
                </div>

                <h3 className="text-base sm:text-lg font-black truncate text-white">{activeReport.title}</h3>
                
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-400">
                  <span>Consumer: <strong className="text-slate-200">{activeReport.consumerName}</strong></span>
                  <span>•</span>
                  <span>Account: <strong className="text-blue-400 font-mono">#{activeReport.accountNumber}</strong></span>
                  <span>•</span>
                  <span>Barangay: <strong className="text-slate-200">{activeReport.barangay}</strong></span>
                  {activeReport.consumerPhone && (
                    <>
                      <span>•</span>
                      <span>Phone: <strong className="text-slate-200">{activeReport.consumerPhone}</strong></span>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveReport(null)}
                className="p-2.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800/90 transition cursor-pointer border border-transparent hover:border-slate-700 shrink-0"
                title="Close modal (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body / Conversation History */}
            <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-5 bg-slate-950/40 text-slate-200">
              
              {/* Detailed Consumer Profile & Location Card */}
              <div className="bg-slate-900/90 rounded-2xl p-4.5 border border-slate-800 shadow-sm space-y-3.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-slate-300 tracking-wider flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-blue-400" />
                    <span>Report & Consumer Dossier</span>
                  </h4>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Filed: {new Date(activeReport.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold flex items-center gap-1 mb-1">
                      <MapPin className="h-3 w-3 text-slate-400" />
                      Physical Location / Landmark
                    </span>
                    <span className="font-bold text-slate-100">{activeReport.address || activeReport.barangay}</span>
                  </div>
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold flex items-center gap-1 mb-1">
                      <Phone className="h-3 w-3 text-slate-400" />
                      Contact Phone
                    </span>
                    <span className="font-bold text-slate-100">{activeReport.consumerPhone || 'N/A'}</span>
                  </div>
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold flex items-center gap-1 mb-1">
                      <Gauge className="h-3 w-3 text-slate-400" />
                      Meter Hardware Serial
                    </span>
                    <span className="font-mono font-bold text-slate-100">{activeReport.meterNumber || 'MT-N/A'}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1.5 flex items-center gap-1">
                    <FileText className="h-3 w-3 text-slate-400" />
                    Original Concern Explanation
                  </span>
                  <div className="text-xs sm:text-sm text-slate-200 leading-relaxed bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/90 font-sans">
                    {activeReport.description}
                  </div>
                </div>

                {activeReport.photoUrl && (
                  <div className="pt-2 border-t border-slate-800/80">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1.5 flex items-center gap-1">
                      <ImageIcon className="h-3 w-3 text-slate-400" />
                      Attached Photographic Proof
                    </span>
                    <div 
                      onClick={() => setSelectedPhotoPreview(activeReport.photoUrl!)}
                      className="inline-flex items-center gap-3 p-2 bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-blue-500/60 rounded-xl transition cursor-pointer group"
                    >
                      <img 
                        src={activeReport.photoUrl} 
                        alt="Photo proof" 
                        className="h-16 w-16 object-cover rounded-lg border border-slate-700/80 group-hover:scale-105 transition" 
                      />
                      <div className="pr-3 text-left">
                        <p className="text-xs font-bold text-slate-200 group-hover:text-blue-400 transition flex items-center gap-1.5">
                          <span>Attached Photo Evidence</span>
                          <Maximize2 className="h-3.5 w-3.5" />
                        </p>
                        <p className="text-[10px] text-slate-400">Click to view in full resolution</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Message Thread */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-slate-300 tracking-wider flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-400" />
                    <span>Conversation & Dispatch Thread</span>
                  </h4>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    {mockDb.dedupeReplies(activeReport.replies).length}{' '}
                    {mockDb.dedupeReplies(activeReport.replies).length === 1 ? 'Message' : 'Messages'}
                  </span>
                </div>
                
                {mockDb.dedupeReplies(activeReport.replies).length === 0 ? (
                  <div className="p-6 bg-slate-900/60 border border-slate-800/80 rounded-2xl text-center text-slate-400 text-xs">
                    No official administrative responses recorded yet. Use the composer below or select a quick template to reply.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {mockDb.dedupeReplies(activeReport.replies).map((reply, idx) => {
                      const isAdmin = reply.senderRole === 'admin' || reply.senderRole === 'staff';
                      const isAutoAck =
                        (reply.id || '').startsWith('ACK-') || reply.senderId === 'system-admin-ack';

                      return (
                        <div
                          key={reply.id || idx}
                          className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}
                        >
                          <div className="max-w-[85%] space-y-1">
                            <div className={`flex items-center gap-2 text-[10px] flex-wrap ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                              {isAdmin ? (
                                <>
                                  <span className="font-bold text-blue-400">
                                    {isAutoAck ? `Automated Acknowledgement (${reply.senderName})` : `Official Admin Response (${reply.senderName})`}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[9px] border ${
                                    isAutoAck
                                      ? 'bg-indigo-950 text-indigo-300 border-indigo-700'
                                      : 'bg-blue-950 text-blue-300 border-blue-800'
                                  }`}>
                                    {isAutoAck ? 'Auto-Ack' : 'Admin'}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="font-bold text-slate-200">{reply.senderName}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-bold uppercase text-[9px]">
                                    Consumer
                                  </span>
                                </>
                              )}
                              <span className="text-slate-400">
                                {new Date(reply.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>

                            <div
                              className={`rounded-2xl p-4 text-xs sm:text-sm leading-relaxed shadow-sm ${
                                isAutoAck
                                  ? 'bg-slate-900/95 text-indigo-100 rounded-tr-xs border border-indigo-500/40'
                                  : isAdmin
                                    ? 'bg-gradient-to-r from-blue-900/90 via-blue-800/90 to-indigo-900/90 text-white rounded-tr-xs border border-blue-500/40 shadow-md'
                                    : 'bg-slate-800/95 text-slate-100 rounded-tl-xs border border-slate-700/80'
                              }`}
                            >
                              <p className="whitespace-pre-wrap">{reply.message}</p>
                              {reply.statusUpdate && (
                                <p className={`mt-2 pt-2 text-[10px] font-bold border-t flex items-center gap-1.5 ${
                                  isAdmin ? 'border-blue-700/50 text-blue-200' : 'border-slate-700/80 text-slate-400'
                                }`}>
                                  <Check className="h-3 w-3 text-emerald-400" />
                                  <span>Status updated to: <strong className="uppercase text-white">{reply.statusUpdate}</strong></span>
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Quick Snippets */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span>Insert Quick Response Template</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_REPLIES.map((snippet, sIdx) => (
                    <button
                      type="button"
                      key={sIdx}
                      onClick={() => handleApplyQuickReply(snippet)}
                      className="px-3 py-1.5 bg-slate-900/90 hover:bg-blue-950/70 border border-slate-800 hover:border-blue-500/70 rounded-xl text-[11px] font-semibold text-slate-300 hover:text-white transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                    >
                      <span>{snippet.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer / Reply Composer */}
            <form onSubmit={handleSubmitReply} className="p-4 sm:p-5 bg-slate-950 border-t border-slate-800 shrink-0 space-y-3.5 text-slate-200">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold uppercase text-slate-300">
                    Update Processing Status
                  </label>
                  <select
                    value={replyStatus}
                    onChange={(e) => setReplyStatus(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-bold text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                  >
                    <option value="pending">Keep as Pending Review</option>
                    <option value="in_progress">In Progress / Field Dispatched</option>
                    <option value="resolved">Mark as Resolved & Verified</option>
                    <option value="closed">Close Case (Archived)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold uppercase text-slate-300">
                    Assign Response Crew / Unit
                  </label>
                  <input
                    type="text"
                    value={assignedCrew}
                    onChange={(e) => setAssignedCrew(e.target.value)}
                    placeholder="e.g. Field Maintenance Crew - Team Alpha"
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-semibold text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase text-slate-300">
                  Official Response Message <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your official reply to the consumer. This will immediately notify them in their portal..."
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden resize-none leading-relaxed"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                  <span>Sending this reply instantly notifies Consumer #{activeReport.accountNumber} via Portal Alert.</span>
                </span>
                
                <div className="flex items-center gap-2.5 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setActiveReport(null)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs rounded-xl transition cursor-pointer border border-slate-700"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingReply || !replyText.trim()}
                    className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-black text-xs sm:text-sm rounded-xl shadow-lg shadow-blue-950/60 transition flex items-center gap-2 cursor-pointer active:scale-98"
                  >
                    <Send className="h-4 w-4" />
                    <span>{isSubmittingReply ? 'Sending Reply...' : 'Send Official Reply & Dispatch'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FULLSCREEN PHOTO LIGHTBOX MODAL */}
      {selectedPhotoPreview && (
        <div 
          className="fixed inset-0 z-[130] bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-fade-in select-none"
          onClick={() => setSelectedPhotoPreview(null)}
        >
          <div className="max-w-4xl w-full flex flex-col items-center space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="w-full flex items-center justify-between text-white pb-2 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-blue-400" />
                <span>Consumer Photo Proof Preview</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedPhotoPreview(null)}
                className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[80vh] overflow-hidden rounded-2xl border border-slate-800 shadow-2xl bg-black">
              <img 
                src={selectedPhotoPreview} 
                alt="Enlarged Proof" 
                className="max-h-[75vh] w-auto max-w-full object-contain mx-auto" 
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

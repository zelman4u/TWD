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
  Plus, 
  MessageSquare, 
  ChevronRight, 
  ShieldAlert, 
  Camera, 
  MapPin, 
  Phone, 
  User, 
  Filter, 
  RefreshCw,
  ArrowLeft,
  X,
  Building,
  Check,
  AlertOctagon,
  Image as ImageIcon,
  Bell
} from 'lucide-react';
import { Consumer, ConsumerReport, ConsumerReportReply, User as UserType } from '../../types';
import { mockDb } from '../../mockDb';
import { apiClient } from '../../services/apiClient';
import { sendRealtimeMessage } from '../../services/realtimeSocket';
import { useToast } from '../../context/ToastContext';
import { SmartSearchBar } from '../common/SmartSearchBar';
import { smartMatch } from '../../utils/smartSearch';
import { formatMeterStatusLabel, formatMeterStatusUpdateDate, normalizeMeterStatus } from '../../utils/meterStatusNotification';
import { Modal, ModalHeader, ModalBody, ModalFooter, ModalButton } from '../ui/Modal';

interface ConsumerReportsSectionProps {
  consumer: Consumer;
  currentUser: UserType;
  reports: ConsumerReport[];
  onRefreshReports: () => void;
  selectedReportId?: string | null;
  onClearSelectedReport?: () => void;
}

const CATEGORIES = [
  { id: 'leak', label: 'Water Leak / Pipe Burst', icon: Droplet, color: 'text-blue-300 bg-blue-950/80 border-blue-800/80', desc: 'Broken distribution pipe, leaking meter coupling, or road bubbling' },
  { id: 'low_pressure', label: 'Low Pressure / No Water', icon: Gauge, color: 'text-amber-300 bg-amber-950/80 border-amber-800/80', desc: 'Sudden pressure drop, intermitted supply, or dry faucets' },
  { id: 'water_quality', label: 'Dirty / Discolored Water', icon: AlertTriangle, color: 'text-orange-300 bg-orange-950/80 border-orange-800/80', desc: 'Turbid, brownish, or sediment-filled water discharge' },
  { id: 'billing', label: 'Billing / Statement Discrepancy', icon: FileText, color: 'text-indigo-300 bg-indigo-950/80 border-indigo-800/80', desc: 'High consumption dispute, penalty inquiry, or payment posting check' },
  { id: 'meter_issue', label: 'Damaged / Defective Meter', icon: AlertOctagon, color: 'text-purple-300 bg-purple-950/80 border-purple-800/80', desc: 'Cracked glass, inverted counter, unreadable dial, or stolen meter' },
  { id: 'illegal_connection', label: 'Report Illegal Connection / Tapping', icon: ShieldAlert, color: 'text-rose-300 bg-rose-950/80 border-rose-800/80', desc: 'Unauthorized bypassing, illegal sub-metering, or tampered seals' },
  { id: 'other', label: 'General Service Inquiry', icon: HelpCircle, color: 'text-slate-300 bg-slate-800/80 border-slate-700', desc: 'Application request, meter relocation, or operational assistance' },
] as const;

export function ConsumerReportsSection({
  consumer,
  currentUser,
  reports,
  onRefreshReports,
  selectedReportId,
  onClearSelectedReport
}: ConsumerReportsSectionProps) {
  const toast = useToast();

  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'in_progress' | 'resolved'>('all');
  const [reportSearch, setReportSearch] = useState('');
  const [showNewReportModal, setShowNewReportModal] = useState(false);
  const [activeThreadReport, setActiveThreadReport] = useState<ConsumerReport | null>(() => {
    if (selectedReportId) {
      const cleanSel = selectedReportId.replace(/^#/, '').trim().toUpperCase();
      return (
        reports.find(
          r =>
            r.id === selectedReportId ||
            r.ticketNumber.toUpperCase() === cleanSel ||
            r.id.toUpperCase() === cleanSel
        ) || null
      );
    }
    return null;
  });
  const threadEndRef = React.useRef<HTMLDivElement>(null);

  // Sync if selectedReportId changes from outside (e.g. notification click) OR if activeThreadReport receives live Admin replies
  React.useEffect(() => {
    if (selectedReportId) {
      const cleanSel = selectedReportId.replace(/^#/, '').trim().toUpperCase();
      const target = reports.find(
        r =>
          r.id === selectedReportId ||
          r.ticketNumber.toUpperCase() === cleanSel ||
          r.id.toUpperCase() === cleanSel
      );
      if (target) {
        setActiveThreadReport(prev => {
          if (
            !prev ||
            prev.id !== target.id ||
            prev.updatedAt !== target.updatedAt ||
            prev.status !== target.status ||
            prev.assignedStaff !== target.assignedStaff ||
            prev.replies.length !== target.replies.length
          ) {
            return target;
          }
          return prev;
        });
        if (target.hasUnreadAdminReply) {
          mockDb.markReportReadByConsumer(target.id);
        }
        return;
      }
    }

    if (activeThreadReport) {
      const latest = reports.find(
        r => r.id === activeThreadReport.id || r.ticketNumber === activeThreadReport.ticketNumber
      );
      if (
        latest &&
        (latest.updatedAt !== activeThreadReport.updatedAt ||
          latest.status !== activeThreadReport.status ||
          latest.assignedStaff !== activeThreadReport.assignedStaff ||
          latest.replies.length !== activeThreadReport.replies.length)
      ) {
        setActiveThreadReport(latest);
        if (latest.hasUnreadAdminReply) {
          mockDb.markReportReadByConsumer(latest.id);
        }
      }
    }
  }, [selectedReportId, reports, activeThreadReport?.id]);

  // Smoothly scroll conversation thread to latest reply when new messages arrive
  React.useEffect(() => {
    if (activeThreadReport && threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeThreadReport?.id, activeThreadReport?.replies?.length]);

  // Fast 2-second live sync while Consumer is viewing the Reports & Inquiries module
  const refreshCallbackRef = React.useRef(onRefreshReports);
  refreshCallbackRef.current = onRefreshReports;
  React.useEffect(() => {
    refreshCallbackRef.current();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        refreshCallbackRef.current();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Close modal on Escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showNewReportModal) {
        setShowNewReportModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showNewReportModal]);

  // New report form states
  const [category, setCategory] = useState<ConsumerReport['category']>('leak');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<ConsumerReport['urgency']>('normal');
  const [addressDetails, setAddressDetails] = useState(consumer.address || '');
  const [phoneContact, setPhoneContact] = useState(consumer.contactNumber || '');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Thread reply states
  const [replyMessage, setReplyMessage] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);

  // All reports owned by this consumer
  const ownedReports = reports.filter(r => (
    r.accountNumber === consumer.accountNumber ||
    (consumer.email && r.consumerEmail && r.consumerEmail.toLowerCase() === consumer.email.toLowerCase()) ||
    r.consumerName.toLowerCase() === consumer.name.toLowerCase()
  ));

  // Filter reports for this consumer by status + Smart Search
  const consumerReports = ownedReports.filter(r => {
    if (activeFilter !== 'all' && r.status !== activeFilter) return false;
    if (!reportSearch.trim()) return true;
    const catMeta = CATEGORIES.find(c => c.id === r.category);
    return smartMatch(reportSearch, [
      r.ticketNumber,
      r.title,
      r.description,
      r.category,
      catMeta?.label,
      r.urgency,
      r.status,
      r.barangay,
      r.address,
      r.assignedStaff,
      (r.replies || []).map(rep => rep.message),
    ]);
  });

  // Handle Create Report (Instantaneous Optimistic UI + Background Server Sync)
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.warning('Title Required', 'Please provide a clear title or summary for your report.');
      return;
    }
    if (!description.trim()) {
      toast.warning('Details Required', 'Please describe the incident or concern with specific details.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        accountNumber: consumer.accountNumber || 'PENDING',
        consumerName: consumer.name,
        consumerEmail: (consumer.email || currentUser.email || '').trim().toLowerCase(),
        consumerPhone: phoneContact.trim() || consumer.contactNumber,
        barangay: consumer.barangay || 'Poblacion',
        address: addressDetails.trim() || consumer.address,
        meterNumber: consumer.meterNumber || '',
        category,
        title: title.trim(),
        description: description.trim(),
        urgency,
        photoUrl: photoUrl.trim()
      };

      // 1. Create immediately in local store (0ms)
      const newReport = mockDb.createReport(payload);

      // 2. Broadcast immediately via BroadcastChannel + WebSocket (0ms across tabs & connected clients)
      sendRealtimeMessage('CONSUMER_REPORT_CREATED', {
        report: newReport,
        ticketNumber: newReport.ticketNumber,
        consumerName: newReport.consumerName,
        accountNumber: newReport.accountNumber,
        consumerEmail: newReport.consumerEmail,
        category: newReport.category,
        title: newReport.title,
        urgency: newReport.urgency,
        message: `New Consumer Concern Filed [${newReport.ticketNumber}] by ${newReport.consumerName} (${newReport.accountNumber}): "${newReport.title}"`,
      });

      // 3. Update UI immediately without waiting for network latency
      setTitle('');
      setDescription('');
      setCategory('leak');
      setUrgency('normal');
      setPhotoUrl('');
      setShowNewReportModal(false);
      setActiveThreadReport(newReport);
      onRefreshReports();

      toast.success(
        'Concern Delivered to Administration!',
        `Ticket #${newReport.ticketNumber} has been delivered. An automated confirmation from TWD Customer Service Desk is waiting in your thread.`
      );

      // 4. Persist asynchronously to Backend REST API
      apiClient
        .createReport({
          ...payload,
          id: newReport.id,
          ticketNumber: newReport.ticketNumber,
          createdAt: newReport.createdAt,
          replies: newReport.replies,
        } as any)
        .then((res) => {
          if (res?.report) {
            mockDb.mergeExternalReports([res.report]);
            onRefreshReports();
          }
        })
        .catch((apiErr) => {
          console.warn('[Consumer Report API Sync]: Handled offline / local store fallback', apiErr);
        });
    } catch (err: any) {
      toast.error('Submission Failed', err?.message || 'Unable to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Post Consumer Reply (Instantaneous Optimistic UI + Background Server Sync)
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThreadReport || !replyMessage.trim()) return;

    const cleanMessage = replyMessage.trim();
    const targetReportSnapshot = activeThreadReport;
    setIsSendingReply(true);
    try {
      const replyId = `REP-MSG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const replyTimestamp = new Date().toISOString();
      const replyData = {
        id: replyId,
        timestamp: replyTimestamp,
        senderId: currentUser.id || consumer.accountNumber,
        senderName: consumer.name,
        senderRole: 'consumer' as const,
        message: cleanMessage
      };

      // 1. Update immediately in local store (0ms)
      const updated = mockDb.replyToReport(targetReportSnapshot.id, replyData);

      // 2. Broadcast immediately via BroadcastChannel + WebSocket (0ms)
      if (updated) {
        sendRealtimeMessage('CONSUMER_REPLIED_TO_REPORT', {
          report: updated,
          ticketNumber: updated.ticketNumber,
          accountNumber: updated.accountNumber,
          message: `Consumer ${consumer.name} posted a follow-up on Ticket #${updated.ticketNumber}.`,
        });
        setActiveThreadReport(updated);
      }

      setReplyMessage('');
      onRefreshReports();
      toast.success('Message Sent', 'Your follow-up has been transmitted to Tagoloan Water District staff.');

      // 3. Persist asynchronously to Backend REST API (pass pre-reply snapshot + deterministic replyId)
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
        })
        .catch((apiErr) => {
          console.warn('[Consumer Reply Sync Warning]:', apiErr);
        });
    } catch (err: any) {
      toast.error('Send Failed', 'Failed to submit reply. Please retry.');
    } finally {
      setIsSendingReply(false);
    }
  };

  const getStatusBadge = (status: ConsumerReport['status']) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-950/90 text-amber-300 border border-amber-800/80">
            <Clock className="h-3 w-3" />
            <span>Pending Review</span>
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-950/90 text-blue-300 border border-blue-800/80">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>In Progress / Dispatched</span>
          </span>
        );
      case 'resolved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-800/80">
            <CheckCircle2 className="h-3 w-3" />
            <span>Resolved</span>
          </span>
        );
      case 'closed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
            <Check className="h-3 w-3" />
            <span>Closed</span>
          </span>
        );
      default:
        return null;
    }
  };

  const getUrgencyBadge = (urgency: ConsumerReport['urgency']) => {
    switch (urgency) {
      case 'emergency':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-600 text-white uppercase tracking-wider">
            <AlertOctagon className="h-3 w-3" />
            Emergency
          </span>
        );
      case 'urgent':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-slate-950 uppercase tracking-wider">
            <AlertTriangle className="h-3 w-3" />
            Urgent
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
            Normal Priority
          </span>
        );
    }
  };

  const selectedCategoryMeta = CATEGORIES.find(c => c.id === category) || CATEGORIES[0];

  return (
    <div className="space-y-6 animate-fade-in" id="consumer-reports-module">
      
      {/* Header Banner */}
      <div className="bg-slate-900 rounded-2xl p-6 text-slate-100 shadow-lg border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-semibold text-blue-400">Consumer Assistance Desk</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-emerald-400 font-medium">Admin Monitored</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Service Reports &amp; Water Inquiries
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Have a water pipe leak, sudden pressure drop, discolored water, or billing concern? File an official report directly to Tagoloan Water District so administrators can review and reply in real time.
            </p>
          </div>

          <div className="shrink-0 flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={() => setShowNewReportModal(true)}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              id="file-new-report-btn"
            >
              <Plus className="h-4 w-4" />
              <span>File New Report</span>
            </button>
            <button
              onClick={onRefreshReports}
              className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm rounded-xl border border-slate-700 transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              title="Check for Admin Replies"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Area: Split into List and Thread View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Reports List & Filters (5 or 12 cols depending on activeThread) */}
        <div className={`space-y-4 ${activeThreadReport ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
          
          {/* Smart Search & Quick Filters */}
          <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-md space-y-3">
            <SmartSearchBar
              variant="dark"
              value={reportSearch}
              onChange={setReportSearch}
              resultCount={consumerReports.length}
              totalCount={ownedReports.length}
              placeholder="Smart search your tickets by Ticket #, issue title, category, status, or admin reply..."
              id="consumer-reports-smart-search"
            />

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none p-1 bg-slate-950 rounded-xl border border-slate-800">
                <button
                  onClick={() => setActiveFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeFilter === 'all'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  All ({ownedReports.length})
                </button>
                <button
                  onClick={() => setActiveFilter('pending')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeFilter === 'pending'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setActiveFilter('in_progress')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeFilter === 'in_progress'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  In Progress
                </button>
                <button
                  onClick={() => setActiveFilter('resolved')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeFilter === 'resolved'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Resolved
                </button>
              </div>

              <span className="text-xs text-slate-400 font-mono tabular-nums font-medium hidden sm:inline">
                Account #{consumer.accountNumber || 'Pending'}
              </span>
            </div>
          </div>

          {/* Reports Card List */}
          {consumerReports.length === 0 ? (
            <div className="bg-slate-900 rounded-3xl p-10 text-center border border-slate-800 shadow-lg space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-blue-950 text-blue-400 border border-blue-800/80 mx-auto flex items-center justify-center">
                <FileText className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-white">No Service Concerns Filed Yet</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  Experiencing an issue with your water line, meter device, or monthly billing statement? Click the button below to submit a ticket.
                </p>
              </div>
              <button
                onClick={() => setShowNewReportModal(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Submit Your First Report</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {consumerReports.map((report) => {
                const isSelected = activeThreadReport?.id === report.id;
                const catMeta = CATEGORIES.find(c => c.id === report.category) || CATEGORIES[0];
                const CatIcon = catMeta.icon;
                const hasUnread = report.hasUnreadAdminReply;

                return (
                  <div
                    key={report.id}
                    onClick={() => {
                      setActiveThreadReport(report);
                      mockDb.markReportReadByConsumer(report.id);
                    }}
                    className={`bg-slate-900 rounded-2xl p-4 sm:p-5 border transition-all cursor-pointer relative overflow-hidden group ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500/30 shadow-lg bg-slate-900'
                        : 'border-slate-800 hover:border-blue-500/60 hover:bg-slate-800/70 shadow-sm'
                    }`}
                  >
                    {/* Unread Admin Reply banner */}
                    {hasUnread && (
                      <div className="absolute top-0 right-0 bg-blue-600 text-white font-black text-[9px] uppercase px-3 py-0.5 rounded-bl-lg shadow-sm flex items-center gap-1">
                        <span>New Admin Reply</span>
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start space-x-3 min-w-0">
                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${catMeta.color}`}>
                          <CatIcon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-slate-200 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-md">
                              {report.ticketNumber}
                            </span>
                            {getUrgencyBadge(report.urgency)}
                            {report.referencedNotice && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-950/90 text-sky-300 border border-sky-800/80 text-[10px] font-bold">
                                <Bell className="h-2.5 w-2.5 text-sky-400 shrink-0" />
                                <span>Re: Admin Notice</span>
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-extrabold text-white group-hover:text-blue-400 transition truncate">
                            {report.title}
                          </h4>
                          <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                            {report.description}
                          </p>
                        </div>
                      </div>

                      <ChevronRight className={`h-5 w-5 shrink-0 transition-transform ${isSelected ? 'text-blue-400 translate-x-1' : 'text-slate-500 group-hover:text-slate-300'}`} />
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <div className="flex items-center gap-2">
                        {getStatusBadge(report.status)}
                        <span className="flex items-center gap-1 font-semibold text-slate-300">
                          <MessageSquare className="h-3 w-3 text-slate-400" />
                          <span>{report.replies.length} {report.replies.length === 1 ? 'message' : 'messages'}</span>
                        </span>
                      </div>

                      <span className="text-slate-400 font-mono">
                        {new Date(report.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Active Conversation Thread View (7 cols) */}
        {activeThreadReport && (
          <div className="lg:col-span-7 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col max-h-[82vh] h-auto min-h-[380px] sticky top-4 text-slate-100">
            
            {/* 1. Thread Header: Identification + Status + Close, Dominant Title, Assigned Crew */}
            <div className="bg-slate-950 text-white px-4 sm:px-5 py-2.5 border-b border-slate-800 shrink-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] min-w-0 text-slate-400">
                  <span className="font-mono tabular-nums font-semibold text-sky-400">
                    {activeThreadReport.ticketNumber}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="capitalize">{activeThreadReport.urgency}</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>{activeThreadReport.barangay}</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="font-mono tabular-nums">
                    {new Date(activeThreadReport.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold leading-tight capitalize whitespace-nowrap ${
                      activeThreadReport.status === 'pending'
                        ? 'bg-amber-950/70 text-amber-300 border-amber-700/60'
                        : activeThreadReport.status === 'in_progress'
                        ? 'bg-sky-950/70 text-sky-300 border-sky-700/60'
                        : activeThreadReport.status === 'resolved'
                        ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {activeThreadReport.status.replace('_', ' ')}
                  </span>
                  <button
                    onClick={() => {
                      setActiveThreadReport(null);
                      if (onClearSelectedReport) onClearSelectedReport();
                    }}
                    className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer shrink-0"
                    title="Close Thread"
                    aria-label="Close thread"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <h3 className="text-[15px] sm:text-base font-bold text-white leading-snug tracking-tight break-words">
                {activeThreadReport.title}
              </h3>

              {activeThreadReport.assignedStaff && (
                <div className="flex items-center gap-1.5 text-[11.5px] text-slate-400 leading-tight">
                  <Building className="h-3 w-3 text-sky-400 shrink-0" />
                  <span>
                    Assigned: <span className="text-slate-200 font-medium">{activeThreadReport.assignedStaff}</span>
                  </span>
                </div>
              )}
            </div>

            {/* 2. Reference Information: Collapsible Official Admin Notice */}
            {activeThreadReport.referencedNotice && (() => {
              const ref = activeThreadReport.referencedNotice;
              const meterNorm = ref.meterStatus ? normalizeMeterStatus(ref.meterStatus) : null;
              const meterLabel = meterNorm ? formatMeterStatusLabel(meterNorm) : null;
              return (
                <details className="group bg-slate-950/60 border-b border-slate-800 px-4 sm:px-5 py-1.5 text-xs shrink-0">
                  <summary className="flex items-center justify-between gap-2 cursor-pointer list-none select-none">
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <Bell className="h-3 w-3 text-sky-400 shrink-0" />
                      <span className="text-[11px] font-medium text-slate-400 shrink-0">Referenced Notice:</span>
                      <span className="font-semibold text-sky-300 truncate">{ref.subject}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 group-hover:text-slate-200 shrink-0">
                      Details
                    </span>
                  </summary>
                  <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 space-y-1 text-[11px] text-slate-400">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {ref.meterNumber && (
                        <span>
                          Meter <strong className="font-mono tabular-nums text-white">#{ref.meterNumber}</strong>
                        </span>
                      )}
                      {meterLabel && (
                        <>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="font-semibold text-slate-200">{meterLabel}</span>
                        </>
                      )}
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono tabular-nums">
                        {formatMeterStatusUpdateDate(ref.statusUpdateDate || ref.sentAt)}
                      </span>
                    </div>
                    {ref.remarks && (
                      <p className="text-xs text-slate-300 leading-relaxed">
                        <strong className="text-slate-400 font-semibold mr-1">Remarks:</strong>
                        {ref.remarks}
                      </p>
                    )}
                  </div>
                </details>
              );
            })()}

            {/* 3. Conversation Body: Proportioned Consumer vs Admin Bubbles */}
            <div className="px-4 sm:px-5 py-3 flex-1 min-h-0 overflow-y-auto space-y-2.5 bg-slate-900">
              {/* Original Consumer Concern */}
              <div className="flex flex-col items-end gap-0.5">
                <div className="flex items-center justify-end gap-1.5 text-[11px] leading-tight text-slate-400 px-1">
                  <span className="font-medium text-slate-300">Your Initial Concern</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="font-mono tabular-nums">
                    {new Date(activeThreadReport.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="w-fit max-w-[82%] sm:max-w-[72%] bg-slate-800 border border-slate-700/85 rounded-2xl rounded-tr-sm px-3 py-2 text-[13.5px] text-slate-100 leading-[1.55] space-y-2 break-words">
                  <p>{activeThreadReport.description}</p>

                  {activeThreadReport.photoUrl && (
                    <div className="pt-2 border-t border-slate-700/80">
                      <span className="text-[11px] font-medium text-slate-400 block mb-1">Attached Photo</span>
                      <div className="inline-block relative rounded-xl overflow-hidden border border-slate-700 max-w-xs">
                        <img
                          src={activeThreadReport.photoUrl}
                          alt="Concern attachment"
                          className="max-h-44 w-auto object-cover"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Chronological Replies (Deduplicated) */}
              {mockDb.dedupeReplies(activeThreadReport.replies).map((reply, idx) => {
                const isAdmin = reply.senderRole === 'admin' || reply.senderRole === 'staff';
                const isAutoAck =
                  (reply.id || '').startsWith('ACK-') || reply.senderId === 'system-admin-ack';

                return (
                  <div
                    key={reply.id || idx}
                    className={`flex flex-col gap-0.5 ${isAdmin ? 'items-start' : 'items-end'}`}
                  >
                    <div className={`flex items-center gap-1.5 text-[11px] leading-tight text-slate-400 px-1 flex-wrap ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                      <span className={`font-medium ${isAdmin ? 'text-sky-300' : 'text-slate-300'}`}>
                        {isAutoAck
                          ? `TWD Desk · ${reply.senderName}`
                          : isAdmin
                          ? `Admin · ${reply.senderName}`
                          : `You (${consumer.name})`}
                      </span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono tabular-nums">
                        {new Date(reply.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div
                      className={`w-fit max-w-[82%] sm:max-w-[72%] rounded-2xl px-3 py-2 text-[13.5px] leading-[1.55] border break-words ${
                        isAutoAck
                          ? 'rounded-tl-sm bg-slate-950/90 text-slate-200 border-indigo-500/40'
                          : isAdmin
                          ? 'rounded-tl-sm bg-[#132b4f] text-slate-50 border-blue-600/45'
                          : 'rounded-tr-sm bg-slate-800 text-slate-100 border-slate-700/85'
                      }`}
                    >
                      <p>{reply.message}</p>

                      {reply.statusUpdate && (
                        <div className="mt-1.5 pt-1 border-t border-white/10 text-[11.5px] font-medium text-slate-300 flex items-center gap-1.5">
                          <RefreshCw className="h-3 w-3 text-sky-400 shrink-0" />
                          <span>Status updated to <strong className="text-white capitalize">{reply.statusUpdate.replace('_', ' ')}</strong></span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>

            {/* 4. Compact Reply Composer Input Form */}
            <form onSubmit={handleSendReply} className="px-4 sm:px-5 py-2 bg-slate-950 border-t border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder="Write your reply to Administration..."
                  className="flex-grow h-[40px] px-3 bg-slate-900 border border-slate-700 rounded-xl text-[13.5px] focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-white placeholder:text-slate-500 transition"
                  disabled={isSendingReply}
                />
                <ModalButton
                  type="submit"
                  variant="primary"
                  disabled={isSendingReply || !replyMessage.trim()}
                  className="h-[40px] px-4"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{isSendingReply ? 'Sending...' : 'Reply'}</span>
                </ModalButton>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* MODAL: SUBMIT NEW CONSUMER REPORT */}
      <Modal
        isOpen={showNewReportModal}
        onClose={() => setShowNewReportModal(false)}
        size="lg"
        zIndexClass="z-[120]"
        ariaLabel="Submit Customer Service Concern or Report"
      >
        <ModalHeader
          tone="info"
          eyebrow={
            <span>
              Official Ticket Submission · Acct #{consumer.accountNumber || 'Pending'}
            </span>
          }
          title="Submit Customer Service Concern or Report"
          subtitle="Tagoloan Water District administrators and response crew will review and respond."
          onClose={() => setShowNewReportModal(false)}
        />

        <form onSubmit={handleSubmitReport} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <ModalBody className="space-y-4">
            {/* Category Picker */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Select Concern Category <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CATEGORIES.map((cat) => {
                  const CatIcon = cat.icon;
                  const isSelected = category === cat.id;

                  return (
                    <button
                      type="button"
                      key={cat.id}
                      onClick={() => setCategory(cat.id as ConsumerReport['category'])}
                      className={`p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-950/60 ring-1 ring-blue-500/30'
                          : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border ${cat.color}`}>
                        <CatIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white leading-tight truncate">{cat.label}</p>
                        <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{cat.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title / Summary */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-300">
                Subject / Summary Title <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g., Underground pipe leak along Sitio Centro gate, or Bill discrepancy for Oct"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-[13.5px] text-white placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            {/* Priority / Urgency */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-300">
                Incident Severity / Urgency Level
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setUrgency('normal')}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                    urgency === 'normal'
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  Normal (24–48h)
                </button>
                <button
                  type="button"
                  onClick={() => setUrgency('urgent')}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                    urgency === 'urgent'
                      ? 'bg-amber-600 text-white border-amber-500'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  Urgent (Within 12h)
                </button>
                <button
                  type="button"
                  onClick={() => setUrgency('emergency')}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                    urgency === 'emergency'
                      ? 'bg-rose-600 text-white border-rose-500'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  Emergency
                </button>
              </div>
            </div>

            {/* Location Details & Contact */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-300">
                  Exact Location / Sitio / Landmark
                </label>
                <div className="relative">
                  <MapPin className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={addressDetails}
                    onChange={(e) => setAddressDetails(e.target.value)}
                    placeholder="e.g., Purok 3 near Barangay Chapel"
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-300">
                  Active Mobile Number
                </label>
                <div className="relative">
                  <Phone className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={phoneContact}
                    onChange={(e) => setPhoneContact(e.target.value)}
                    placeholder="0917-xxx-xxxx"
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-mono placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* Detailed Description */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-300">
                Detailed Explanation of Concern <span className="text-rose-400">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Please describe what you observed, when the issue started, and any symptoms..."
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-[13.5px] text-white placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            {/* Optional Photo URL / Upload */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-300">
                Optional Photo URL or Evidence Link
              </label>
              <div className="relative">
                <Camera className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="url"
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                  placeholder="https://example.com/leak-photo.jpg (optional)"
                  className="w-full pl-9 pr-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-hidden"
                />
              </div>
            </div>
          </ModalBody>

          <ModalFooter align="between">
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Logged with direct ticket tracking and admin response history.
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <ModalButton variant="secondary" onClick={() => setShowNewReportModal(false)}>
                Cancel
              </ModalButton>
              <ModalButton type="submit" variant="primary" disabled={isSubmitting}>
                <Send className="h-3.5 w-3.5" />
                <span>{isSubmitting ? 'Submitting...' : 'Submit Official Report'}</span>
              </ModalButton>
            </div>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}

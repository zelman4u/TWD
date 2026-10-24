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
  Sparkles,
  ArrowLeft,
  X,
  Building,
  Check,
  AlertOctagon,
  Image as ImageIcon
} from 'lucide-react';
import { Consumer, ConsumerReport, ConsumerReportReply, User as UserType } from '../../types';
import { mockDb } from '../../mockDb';
import { apiClient } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';

interface ConsumerReportsSectionProps {
  consumer: Consumer;
  currentUser: UserType;
  reports: ConsumerReport[];
  onRefreshReports: () => void;
  selectedReportId?: string | null;
  onClearSelectedReport?: () => void;
}

const CATEGORIES = [
  { id: 'leak', label: 'Water Leak / Pipe Burst', icon: Droplet, color: 'text-blue-600 bg-blue-50 border-blue-200', desc: 'Broken distribution pipe, leaking meter coupling, or road bubbling' },
  { id: 'low_pressure', label: 'Low Pressure / No Water', icon: Gauge, color: 'text-amber-600 bg-amber-50 border-amber-200', desc: 'Sudden pressure drop, intermitted supply, or dry faucets' },
  { id: 'water_quality', label: 'Dirty / Discolored Water', icon: AlertTriangle, color: 'text-orange-600 bg-orange-50 border-orange-200', desc: 'Turbid, brownish, or sediment-filled water discharge' },
  { id: 'billing', label: 'Billing / Statement Discrepancy', icon: FileText, color: 'text-indigo-600 bg-indigo-50 border-indigo-200', desc: 'High consumption dispute, penalty inquiry, or payment posting check' },
  { id: 'meter_issue', label: 'Damaged / Defective Meter', icon: AlertOctagon, color: 'text-purple-600 bg-purple-50 border-purple-200', desc: 'Cracked glass, inverted counter, unreadable dial, or stolen meter' },
  { id: 'illegal_connection', label: 'Report Illegal Connection / Tapping', icon: ShieldAlert, color: 'text-rose-600 bg-rose-50 border-rose-200', desc: 'Unauthorized bypassing, illegal sub-metering, or tampered seals' },
  { id: 'other', label: 'General Service Inquiry', icon: HelpCircle, color: 'text-slate-600 bg-slate-50 border-slate-200', desc: 'Application request, meter relocation, or operational assistance' },
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
  const [showNewReportModal, setShowNewReportModal] = useState(false);
  const [activeThreadReport, setActiveThreadReport] = useState<ConsumerReport | null>(() => {
    if (selectedReportId) {
      return reports.find(r => r.id === selectedReportId || r.ticketNumber === selectedReportId) || null;
    }
    return null;
  });

  // Sync if selectedReportId changes from outside (e.g. notification click)
  React.useEffect(() => {
    if (selectedReportId) {
      const target = reports.find(r => r.id === selectedReportId || r.ticketNumber === selectedReportId);
      if (target) {
        setActiveThreadReport(target);
        mockDb.markReportReadByConsumer(target.id);
      }
    }
  }, [selectedReportId, reports]);

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

  // Filter reports for this consumer
  const consumerReports = reports.filter(r => {
    const isOwner = r.accountNumber === consumer.accountNumber ||
      (consumer.email && r.consumerEmail && r.consumerEmail.toLowerCase() === consumer.email.toLowerCase()) ||
      r.consumerName.toLowerCase() === consumer.name.toLowerCase();
    if (!isOwner) return false;
    if (activeFilter === 'all') return true;
    return r.status === activeFilter;
  });

  // Handle Create Report
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
        consumerEmail: consumer.email || '',
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

      // 1. Create in mockDb
      const newReport = mockDb.createReport(payload);

      // 2. Sync to Backend REST API
      try {
        await apiClient.createReport(payload);
      } catch (apiErr) {
        console.warn('[Consumer Report API Sync]: Handled offline / local store fallback', apiErr);
      }

      toast.success(
        'Concern Submitted Successfully!',
        `Your report has been logged under Tracking Ticket #${newReport.ticketNumber}. Water District Admins have been notified.`
      );

      // Reset form & state
      setTitle('');
      setDescription('');
      setCategory('leak');
      setUrgency('normal');
      setPhotoUrl('');
      setShowNewReportModal(false);
      onRefreshReports();
      setActiveThreadReport(newReport);
    } catch (err: any) {
      toast.error('Submission Failed', err?.message || 'Unable to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Post Consumer Reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThreadReport || !replyMessage.trim()) return;

    setIsSendingReply(true);
    try {
      const replyData = {
        senderId: currentUser.id || consumer.accountNumber,
        senderName: consumer.name,
        senderRole: 'consumer' as const,
        message: replyMessage.trim()
      };

      // 1. Update in mockDb
      const updated = mockDb.replyToReport(activeThreadReport.id, replyData);

      // 2. Sync to Backend REST API
      try {
        await apiClient.replyToReport(activeThreadReport.id, replyData);
      } catch (apiErr) {
        console.warn('[Consumer Reply Sync Warning]:', apiErr);
      }

      if (updated) {
        setActiveThreadReport(updated);
      }
      setReplyMessage('');
      onRefreshReports();
      toast.success('Message Sent', 'Your follow-up has been transmitted to Tagoloan Water District staff.');
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
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="h-3 w-3" />
            <span>Pending Review</span>
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>In Progress / Dispatched</span>
          </span>
        );
      case 'resolved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            <span>Resolved</span>
          </span>
        );
      case 'closed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-600 text-white uppercase tracking-wider animate-pulse">
            <AlertOctagon className="h-3 w-3" />
            Emergency
          </span>
        );
      case 'urgent':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-white uppercase tracking-wider">
            <AlertTriangle className="h-3 w-3" />
            Urgent
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-700">
            Normal Priority
          </span>
        );
    }
  };

  const selectedCategoryMeta = CATEGORIES.find(c => c.id === category) || CATEGORIES[0];

  return (
    <div className="space-y-6 animate-fade-in" id="consumer-reports-module">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-blue-800/40">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-400 to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-blue-500/30 border border-blue-400/40 text-blue-200 text-xs font-bold uppercase tracking-wider">
                Official Consumer Assistance Desk
              </span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-400/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                Admin Monitored
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
              Service Reports & Water Inquiries
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Have a water pipe leak, sudden pressure drop, discolored water, or billing concern? 
              File an official report directly to Tagoloan Water District. Administrators will be instantly notified 
              and reply directly to your concern with real-time tracking.
            </p>
          </div>

          <div className="shrink-0 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setShowNewReportModal(true)}
              className="px-5 py-3.5 bg-blue-500 hover:bg-blue-400 text-white font-extrabold text-sm rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer group hover:scale-[1.02]"
              id="file-new-report-btn"
            >
              <Plus className="h-5 w-5 group-hover:rotate-90 transition-transform" />
              <span>File New Report</span>
            </button>
            <button
              onClick={onRefreshReports}
              className="px-4 py-3.5 bg-white/10 hover:bg-white/20 text-white font-bold text-sm rounded-xl border border-white/20 transition flex items-center justify-center gap-2 cursor-pointer"
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
          
          {/* Quick Filters */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              <button
                onClick={() => setActiveFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All ({reports.filter(r => r.accountNumber === consumer.accountNumber || r.consumerName.toLowerCase() === consumer.name.toLowerCase()).length})
              </button>
              <button
                onClick={() => setActiveFilter('pending')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeFilter === 'pending'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Pending
              </button>
              <button
                onClick={() => setActiveFilter('in_progress')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeFilter === 'in_progress'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                In Progress
              </button>
              <button
                onClick={() => setActiveFilter('resolved')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeFilter === 'resolved'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Resolved
              </button>
            </div>

            <span className="text-xs text-slate-500 font-medium hidden sm:inline">
              Account #{consumer.accountNumber || 'Pending'}
            </span>
          </div>

          {/* Reports Card List */}
          {consumerReports.length === 0 ? (
            <div className="bg-white rounded-3xl p-10 text-center border border-slate-200 shadow-sm space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center">
                <FileText className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-slate-800">No Service Concerns Filed Yet</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Experiencing an issue with your water line, meter device, or monthly billing statement? Click the button below to submit a ticket.
                </p>
              </div>
              <button
                onClick={() => setShowNewReportModal(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
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
                    className={`bg-white rounded-2xl p-4 sm:p-5 border transition-all cursor-pointer relative overflow-hidden group ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md bg-blue-50/20'
                        : 'border-slate-200/90 hover:border-blue-300 hover:shadow-md'
                    }`}
                  >
                    {/* Unread Admin Reply glowing dot & banner */}
                    {hasUnread && (
                      <div className="absolute top-0 right-0 bg-blue-600 text-white font-black text-[9px] uppercase px-3 py-0.5 rounded-bl-lg shadow-sm flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping"></span>
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
                            <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                              {report.ticketNumber}
                            </span>
                            {getUrgencyBadge(report.urgency)}
                          </div>
                          <h4 className="text-sm font-extrabold text-slate-900 group-hover:text-blue-600 transition truncate">
                            {report.title}
                          </h4>
                          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                            {report.description}
                          </p>
                        </div>
                      </div>

                      <ChevronRight className={`h-5 w-5 shrink-0 transition-transform ${isSelected ? 'text-blue-600 translate-x-1' : 'text-slate-300 group-hover:text-slate-600'}`} />
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <div className="flex items-center gap-2">
                        {getStatusBadge(report.status)}
                        <span className="flex items-center gap-1 font-semibold text-slate-600">
                          <MessageSquare className="h-3 w-3" />
                          <span>{report.replies.length} {report.replies.length === 1 ? 'message' : 'messages'}</span>
                        </span>
                      </div>

                      <span className="text-slate-400">
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
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200/90 shadow-md overflow-hidden flex flex-col h-[750px] sticky top-4">
            
            {/* Thread Header */}
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800 shrink-0">
              <div className="space-y-1 min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-extrabold text-blue-400 bg-blue-950/80 px-2.5 py-0.5 rounded-md border border-blue-800/80">
                    {activeThreadReport.ticketNumber}
                  </span>
                  {getUrgencyBadge(activeThreadReport.urgency)}
                  {getStatusBadge(activeThreadReport.status)}
                </div>
                <h3 className="text-base font-black truncate text-white">
                  {activeThreadReport.title}
                </h3>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-blue-400" />
                    <span>{activeThreadReport.barangay}</span>
                  </span>
                  <span>•</span>
                  <span>Meter: {activeThreadReport.meterNumber || 'MT-N/A'}</span>
                  <span>•</span>
                  <span>Filed: {new Date(activeThreadReport.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  setActiveThreadReport(null);
                  if (onClearSelectedReport) onClearSelectedReport();
                }}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                title="Close Thread"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Crew Assignment Notice Banner if In Progress */}
            {activeThreadReport.assignedStaff && (
              <div className="bg-blue-50/90 border-b border-blue-200 px-5 py-2.5 flex items-center gap-2 text-xs text-blue-900 font-medium">
                <Building className="h-4 w-4 text-blue-600 shrink-0" />
                <span>
                  <strong>Assigned Response Team:</strong> {activeThreadReport.assignedStaff}
                </span>
              </div>
            )}

            {/* Resolution Notice Banner if Resolved */}
            {activeThreadReport.status === 'resolved' && (
              <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-2.5 flex items-center gap-2 text-xs text-emerald-900 font-medium">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Report Resolved:</strong> Water District operations verified resolution for this ticket.
                </span>
              </div>
            )}

            {/* Messages Scroll Area */}
            <div className="p-5 flex-grow overflow-y-auto space-y-4 bg-slate-50/60">
              
              {/* Original Report Summary Card */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-bold text-slate-800">Original Concern Description</span>
                  <span>{new Date(activeThreadReport.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-normal">
                  {activeThreadReport.description}
                </p>

                {/* Photo attachment if available */}
                {activeThreadReport.photoUrl && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <span className="text-[11px] font-bold text-slate-500 block mb-1">Attached Photographic Proof:</span>
                    <a 
                      href={activeThreadReport.photoUrl} 
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-block relative rounded-xl overflow-hidden border border-slate-200 max-w-xs group"
                    >
                      <img 
                        src={activeThreadReport.photoUrl} 
                        alt="Concern attachment" 
                        className="max-h-48 w-auto object-cover group-hover:scale-105 transition" 
                      />
                    </a>
                  </div>
                )}
              </div>

              {/* Chronological Replies */}
              {activeThreadReport.replies.map((reply, idx) => {
                const isAdmin = reply.senderRole === 'admin' || reply.senderRole === 'staff';

                return (
                  <div
                    key={reply.id || idx}
                    className={`flex flex-col ${isAdmin ? 'items-start' : 'items-end'}`}
                  >
                    <div className="max-w-[85%] space-y-1">
                      
                      {/* Sender header badge */}
                      <div className={`flex items-center gap-1.5 text-[11px] ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                        {isAdmin ? (
                          <>
                            <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white font-black text-[9px] uppercase tracking-wider flex items-center gap-1">
                              <Building className="h-2.5 w-2.5" />
                              Tagoloan Water District Admin
                            </span>
                            <span className="font-bold text-slate-700">{reply.senderName}</span>
                          </>
                        ) : (
                          <>
                            <span className="font-bold text-slate-700">You ({consumer.name})</span>
                            <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 font-bold text-[9px] uppercase">Consumer</span>
                          </>
                        )}
                        <span className="text-slate-400">
                          {new Date(reply.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {/* Bubble */}
                      <div
                        className={`rounded-2xl p-3.5 sm:p-4 text-xs sm:text-sm leading-relaxed shadow-xs ${
                          isAdmin
                            ? 'bg-blue-600 text-white rounded-tl-xs border border-blue-700'
                            : 'bg-white text-slate-800 rounded-tr-xs border border-slate-200'
                        }`}
                      >
                        <p>{reply.message}</p>

                        {/* Status update badge inside admin reply if provided */}
                        {reply.statusUpdate && (
                          <div className={`mt-2 pt-2 border-t text-[11px] font-bold flex items-center gap-1.5 ${
                            isAdmin ? 'border-blue-400/50 text-blue-100' : 'border-slate-100 text-slate-600'
                          }`}>
                            <RefreshCw className="h-3 w-3" />
                            <span>Status updated to: {reply.statusUpdate.toUpperCase().replace('_', ' ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reply Composer Input Form */}
            <form onSubmit={handleSendReply} className="p-4 bg-white border-t border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder="Type your message or follow-up to the Administrator..."
                  className="flex-grow px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white text-slate-900 transition"
                  disabled={isSendingReply}
                />
                <button
                  type="submit"
                  disabled={isSendingReply || !replyMessage.trim()}
                  className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5 shrink-0 shadow-md cursor-pointer"
                >
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline">{isSendingReply ? 'Sending...' : 'Reply'}</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">
                Replies are synchronized in real time with the Tagoloan Water District Administrative Operations Desk.
              </p>
            </form>
          </div>
        )}
      </div>

      {/* MODAL: SUBMIT NEW CONSUMER REPORT */}
      {showNewReportModal && (
        <div 
          className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowNewReportModal(false)}
        >
          <div 
            className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden animate-scale-up relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header (Fixed at top) */}
            <div className="shrink-0 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-5 sm:p-6 flex items-center justify-between border-b border-white/10 shadow-xs">
              <div className="space-y-1 pr-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-blue-500/30 text-blue-200 text-[10px] font-extrabold uppercase tracking-wider">
                    Official Ticket Submission
                  </span>
                  <span className="text-[11px] text-blue-200 font-mono font-bold">
                    Acct #{consumer.accountNumber || 'Pending'}
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-black tracking-tight text-white">
                  Submit Customer Service Concern or Report
                </h3>
                <p className="text-xs text-slate-300">
                  Tagoloan Water District administrators and response crew will review and respond.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewReportModal(false)}
                className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition cursor-pointer shrink-0"
                title="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form with Scrollable Body and Pinned Footer */}
            <form onSubmit={handleSubmitReport} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              
              {/* Scrollable Form Content */}
              <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-5">
                {/* Category Picker */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Select Concern Category <span className="text-rose-500">*</span>
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
                          className={`p-3 rounded-xl border text-left flex items-start space-x-3 transition cursor-pointer ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border ${cat.color}`}>
                            <CatIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 leading-tight truncate">{cat.label}</p>
                            <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{cat.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Title / Summary */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Subject / Summary Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Underground pipe leak along Sitio Centro gate, or Bill discrepancy for Oct"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                {/* Priority / Urgency */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Incident Severity / Urgency Level
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setUrgency('normal')}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        urgency === 'normal'
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Normal (Within 24-48h)
                    </button>
                    <button
                      type="button"
                      onClick={() => setUrgency('urgent')}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        urgency === 'urgent'
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Urgent (Within 12h)
                    </button>
                    <button
                      type="button"
                      onClick={() => setUrgency('emergency')}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        urgency === 'emergency'
                          ? 'bg-rose-600 text-white border-rose-600 ring-2 ring-rose-400/30'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Emergency (High Burst/Flood)
                    </button>
                  </div>
                </div>

                {/* Location Details & Contact */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Exact Location / Sitio / Landmark
                    </label>
                    <div className="relative">
                      <MapPin className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        value={addressDetails}
                        onChange={(e) => setAddressDetails(e.target.value)}
                        placeholder="e.g., Purok 3 near Barangay Chapel"
                        className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Active Mobile Number
                    </label>
                    <div className="relative">
                      <Phone className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        value={phoneContact}
                        onChange={(e) => setPhoneContact(e.target.value)}
                        placeholder="0917-xxx-xxxx"
                        className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                  </div>
                </div>

                {/* Detailed Description */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Detailed Explanation of Concern <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Please describe what you observed, when the issue started, and any symptoms (e.g. meter spinning continuously, water pressure dropping, sediment in pipes)..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                {/* Optional Photo URL / Upload */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Optional Photo URL or Evidence Link
                  </label>
                  <div className="relative">
                    <Camera className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="url"
                      value={photoUrl}
                      onChange={(e) => setPhotoUrl(e.target.value)}
                      placeholder="https://example.com/leak-photo.jpg (optional)"
                      className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons Footer - Pinned and Always Fully Shown */}
              <div className="shrink-0 bg-slate-50 border-t border-slate-200 p-4 sm:p-5 flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500 hidden sm:block">
                  Submissions are logged with direct ticket tracking and admin response history.
                </p>
                <div className="flex items-center gap-2.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => setShowNewReportModal(false)}
                    className="px-4 py-2.5 text-slate-700 hover:bg-slate-200 font-bold text-xs rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer"
                  >
                    <Send className="h-4 w-4" />
                    <span>{isSubmitting ? 'Transmitting to Admin...' : 'Submit Official Report'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

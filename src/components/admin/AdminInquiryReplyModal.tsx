import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  Image as ImageIcon,
  Maximize2,
  Send,
  X,
} from 'lucide-react';
import { ConsumerReport, User as UserType } from '../../types';
import { mockDb } from '../../mockDb';
import { apiClient } from '../../services/apiClient';
import { sendRealtimeMessage } from '../../services/realtimeSocket';
import { useToast } from '../../context/ToastContext';
import {
  formatMeterStatusLabel,
  formatMeterStatusUpdateDate,
  normalizeMeterStatus,
} from '../../utils/meterStatusNotification';
import { normalizeCompactParagraphs } from '../../utils/notificationContext';

export const ADMIN_REPORT_CATEGORY_LABELS: Record<string, string> = {
  leak: 'Water Leak / Burst',
  low_pressure: 'Low Pressure / Dry',
  water_quality: 'Dirty / Turbid Water',
  billing: 'Billing Inquiry',
  meter_issue: 'Water Meter Concern',
  illegal_connection: 'Illegal Connection',
  other: 'General Inquiry',
};

export const ADMIN_QUICK_REPLIES = [
  {
    label: 'Meter Inspection Scheduled',
    status: 'in_progress' as const,
    crew: 'Mechanical Meter Maintenance Section',
    text: 'Good day. An official meter technician has been scheduled to inspect your water meter assembly. Please keep the meter area accessible during office hours.',
  },
  {
    label: 'Dispatch Crew (Leak / Line Check)',
    status: 'in_progress' as const,
    crew: 'Field Maintenance Crew - Team Alpha',
    text: 'Good day. We have received your message and dispatched our Field Maintenance Crew to inspect your line and meter connection.',
  },
  {
    label: 'Water Pressure / Line Flushing',
    status: 'in_progress' as const,
    crew: 'Distribution & Valves Operations Team',
    text: 'We are conducting line maintenance and valve calibration in your barangay zone. Standard operating water pressure will normalize shortly.',
  },
  {
    label: 'Billing Statement Reconciled',
    status: 'resolved' as const,
    crew: 'Commercial & Billing Dept.',
    text: 'We have verified your meter reading history and billing ledger. Your statement has been reconciled accordingly.',
  },
  {
    label: 'Issue Resolved & Verified',
    status: 'resolved' as const,
    crew: 'TWD Operations Desk',
    text: 'Our technical team has confirmed resolution of this concern and verified normal meter status. Thank you for coordinating with Tagoloan Water District.',
  },
];

interface AdminInquiryReplyModalProps {
  report: ConsumerReport | null;
  currentUser: UserType;
  onClose: () => void;
  onReportUpdated: (updated: ConsumerReport) => void;
  onOpenInCustomerService?: (report: ConsumerReport) => void;
}

export function AdminInquiryReplyModal({
  report,
  currentUser,
  onClose,
  onReportUpdated,
  onOpenInCustomerService,
}: AdminInquiryReplyModalProps) {
  const toast = useToast();
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState<ConsumerReport['status']>('in_progress');
  const [assignedCrew, setAssignedCrew] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!report) return;
    setReplyStatus(report.status === 'pending' ? 'in_progress' : report.status);
    setAssignedCrew(report.assignedStaff || '');
    setReplyText('');
    if (report.hasUnreadConsumerUpdate) {
      mockDb.markReportReadByAdmin(report.id);
    }
  }, [report?.id]);

  useEffect(() => {
    if (report && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [report?.id, report?.replies?.length]);

  useEffect(() => {
    if (!report && !selectedPhotoPreview) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedPhotoPreview) {
          setSelectedPhotoPreview(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [report, selectedPhotoPreview, onClose]);

  if (!report) return null;

  const categoryLabel =
    ADMIN_REPORT_CATEGORY_LABELS[report.category] || ADMIN_REPORT_CATEGORY_LABELS.other;

  const statusLabel =
    report.status === 'pending'
      ? 'Pending Review'
      : report.status === 'in_progress'
      ? 'In Progress'
      : report.status === 'resolved'
      ? 'Resolved'
      : 'Closed';

  const statusColorClass =
    report.status === 'pending'
      ? 'text-amber-300'
      : report.status === 'in_progress'
      ? 'text-sky-300'
      : report.status === 'resolved'
      ? 'text-emerald-300'
      : 'text-slate-400';

  const urgencyColorClass =
    report.urgency === 'emergency'
      ? 'text-rose-400 font-bold'
      : report.urgency === 'urgent'
      ? 'text-amber-300 font-semibold'
      : 'text-slate-400';

  const humanReplies = mockDb
    .dedupeReplies(report.replies)
    .filter(
      rep =>
        !(rep.id || '').startsWith('ACK-') && rep.senderId !== 'system-admin-ack'
    );

  // Avoid showing the consumer's initial message twice if it was also pushed into replies
  const firstConsumerReplyMatchesDescription =
    humanReplies.length > 0 &&
    humanReplies[0].senderRole === 'consumer' &&
    humanReplies[0].message.trim().toLowerCase() === (report.description || '').trim().toLowerCase();

  const threadReplies = firstConsumerReplyMatchesDescription
    ? humanReplies.slice(1)
    : humanReplies;

  const initialParagraphs = normalizeCompactParagraphs(report.description);

  const handleApplyQuickTemplate = (idxStr: string) => {
    const idx = Number(idxStr);
    if (Number.isNaN(idx) || !ADMIN_QUICK_REPLIES[idx]) return;
    const snippet = ADMIN_QUICK_REPLIES[idx];
    setReplyText(snippet.text);
    setReplyStatus(snippet.status);
    setAssignedCrew(snippet.crew);
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) {
      toast.warning('Reply Message Required', 'Please enter your official reply to the consumer.');
      return;
    }

    const cleanReplyText = replyText.trim();
    const cleanCrew = assignedCrew.trim() || undefined;
    const targetSnapshot = report;

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
        assignedStaff: cleanCrew,
      };

      const updated = mockDb.replyToReport(
        targetSnapshot.id,
        replyData,
        replyStatus,
        cleanCrew
      );

      const createdReportNotif = updated
        ? mockDb
            .getNotifications(updated.accountNumber, { email: updated.consumerEmail })
            .find(
              n =>
                n.replyId === replyId ||
                (n.type === 'report' &&
                  (n.reportId === updated.id || n.ticketNumber === updated.ticketNumber))
            )
        : undefined;

      if (updated) {
        sendRealtimeMessage('ADMIN_REPLIED_TO_REPORT', {
          report: updated,
          notification: createdReportNotif,
          accountNumber: updated.accountNumber,
          consumerEmail: updated.consumerEmail,
          ticketNumber: updated.ticketNumber,
          message: `Admin ${replyData.senderName} responded to Ticket #${updated.ticketNumber}: "${replyData.message}"`,
        });
        if (createdReportNotif) {
          sendRealtimeMessage('CONSUMER_NOTIFICATION_CREATED', {
            notification: createdReportNotif,
            accountNumber: updated.accountNumber,
            consumerEmail: updated.consumerEmail,
          });
        }
      }

      setReplyText('');
      if (updated) {
        onReportUpdated(updated);
      }

      toast.success(
        'Reply Sent to Consumer',
        `Delivered to Account #${targetSnapshot.accountNumber}'s Notification Bell (${targetSnapshot.ticketNumber}).`
      );

      apiClient
        .replyToReport(targetSnapshot.id, {
          ...replyData,
          replyId,
          report: targetSnapshot,
        })
        .then(res => {
          if (res?.report) {
            const merged = mockDb.mergeExternalReports([res.report]);
            const latest = merged.find(r => r.id === targetSnapshot.id);
            if (latest) onReportUpdated(latest);
          }
          if (res?.notification) {
            mockDb.mergeExternalNotifications([res.notification]);
          }
        })
        .catch(() => {});
    } catch (err: any) {
      toast.error('Failed to Send Reply', err?.message || 'Error communicating with server.');
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const ref = report.referencedNotice;
  const meterNorm = ref?.meterStatus ? normalizeMeterStatus(ref.meterStatus) : null;
  const meterLabel = meterNorm ? formatMeterStatusLabel(meterNorm) : null;

  return (
    <>
      <div
        className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-inquiry-modal-title"
      >
        <div
          className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] shadow-2xl overflow-hidden flex flex-col animate-scale-up text-slate-100"
          onClick={e => e.stopPropagation()}
        >
          {/* Zone 1: Compact Unified Header */}
          <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-start justify-between gap-3 shrink-0">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                <span className="font-mono tabular-nums font-bold text-sky-400">
                  {report.ticketNumber}
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-slate-300 font-medium">{categoryLabel}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className={urgencyColorClass}>
                  {report.urgency === 'emergency'
                    ? 'Emergency'
                    : report.urgency === 'urgent'
                    ? 'Urgent'
                    : 'Normal'}
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className={`font-semibold ${statusColorClass}`}>{statusLabel}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="font-mono tabular-nums">
                  {new Date(report.createdAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <h3
                id="admin-inquiry-modal-title"
                className="text-sm sm:text-base font-bold text-white leading-snug break-words"
              >
                {report.title}
              </h3>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                <span>
                  Consumer: <strong className="text-slate-100">{report.consumerName}</strong>
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>
                  Account:{' '}
                  <strong className="font-mono tabular-nums text-sky-300">
                    #{report.accountNumber}
                  </strong>
                </span>
                {(report.meterNumber || ref?.meterNumber) && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span>
                      Meter:{' '}
                      <strong className="font-mono tabular-nums text-slate-200">
                        #{report.meterNumber || ref?.meterNumber}
                      </strong>
                    </span>
                  </>
                )}
                {report.barangay && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-slate-300">{report.barangay}</span>
                  </>
                )}
                {report.consumerPhone && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      {report.consumerPhone}
                    </span>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer shrink-0"
              aria-label="Close modal"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Zone 2: Clean Compact Context + Unified Conversation Thread */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3.5 space-y-3 bg-slate-900">
            {/* Compact Referenced Official Notice Bar */}
            {ref && (
              <div className="rounded-xl bg-slate-950/90 border border-slate-800 px-3.5 py-2.5 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sky-400 font-semibold mr-1.5">
                      Referenced Notice:
                    </span>
                    <span className="font-bold text-white">{ref.subject}</span>
                  </div>
                  {meterLabel && (
                    <span
                      className={`font-bold text-[11px] whitespace-nowrap shrink-0 ${
                        meterNorm === 'damaged'
                          ? 'text-rose-400'
                          : meterNorm === 'maintenance'
                          ? 'text-amber-300'
                          : meterNorm === 'active'
                          ? 'text-emerald-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {ref.previousMeterStatus
                        ? `${ref.previousMeterStatus} → ${meterLabel}`
                        : `Meter Status: ${meterLabel}`}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                  {ref.meterNumber && (
                    <>
                      <span>
                        Meter{' '}
                        <strong className="font-mono tabular-nums text-slate-200">
                          #{ref.meterNumber}
                        </strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                    </>
                  )}
                  <span>
                    Issued{' '}
                    <span className="font-mono tabular-nums text-slate-300">
                      {formatMeterStatusUpdateDate(ref.statusUpdateDate || ref.sentAt)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    Sent by <span className="text-slate-300">{ref.sentByAdmin || 'TWD Administration'}</span>
                  </span>
                </div>

                {ref.remarks && (
                  <p className="text-[11px] text-slate-300 pt-1 border-t border-slate-800/80 leading-snug">
                    <span className="text-slate-400 font-semibold">Original Admin Remarks: </span>
                    {ref.remarks}
                  </p>
                )}
              </div>
            )}

            {/* Unified Chronological Message Stream */}
            <div className="space-y-2.5">
              {/* Initial Consumer Message */}
              <div className="flex flex-col items-start">
                <div className="max-w-[92%] space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="font-bold text-slate-200">{report.consumerName}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span>Consumer</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums">
                      {new Date(report.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-800/95 border border-slate-700/80 px-3.5 py-2.5 text-xs sm:text-[13px] text-slate-100 leading-snug space-y-1.5">
                    {initialParagraphs.length > 0 ? (
                      initialParagraphs.map((p, idx) => <p key={idx}>{p}</p>)
                    ) : (
                      <p>{report.description}</p>
                    )}

                    {report.photoUrl && (
                      <button
                        type="button"
                        onClick={() => setSelectedPhotoPreview(report.photoUrl!)}
                        className="mt-1.5 inline-flex items-center gap-2 p-1.5 bg-slate-900 hover:bg-slate-950 border border-slate-700 rounded-lg transition cursor-pointer text-left"
                      >
                        <img
                          src={report.photoUrl}
                          alt="Attached consumer evidence"
                          referrerPolicy="no-referrer"
                          className="h-10 w-10 object-cover rounded border border-slate-700 shrink-0"
                        />
                        <span className="text-[11px] font-semibold text-sky-300 inline-flex items-center gap-1 pr-1.5 whitespace-nowrap">
                          <span>View Attached Photo</span>
                          <Maximize2 className="h-3 w-3" />
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Follow-up Replies */}
              {threadReplies.map((reply, idx) => {
                const isAdmin = reply.senderRole === 'admin' || reply.senderRole === 'staff';
                const paragraphs = normalizeCompactParagraphs(reply.message, {
                  stripAdminEnvelope: true,
                });

                return (
                  <div
                    key={reply.id || idx}
                    className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}
                  >
                    <div className="max-w-[92%] space-y-1">
                      <div
                        className={`flex items-center gap-1.5 text-[11px] text-slate-400 ${
                          isAdmin ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <span className={isAdmin ? 'font-bold text-sky-300' : 'font-bold text-slate-200'}>
                          {isAdmin ? `Admin (${reply.senderName})` : reply.senderName}
                        </span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="font-mono tabular-nums">
                          {new Date(reply.timestamp).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div
                        className={`rounded-xl px-3.5 py-2.5 text-xs sm:text-[13px] leading-snug space-y-1.5 border ${
                          isAdmin
                            ? 'bg-blue-950/75 text-slate-100 border-blue-800/70'
                            : 'bg-slate-800/95 text-slate-100 border-slate-700/80'
                        }`}
                      >
                        {paragraphs.length > 0 ? (
                          paragraphs.map((p, pIdx) => <p key={pIdx}>{p}</p>)
                        ) : (
                          <p>{reply.message}</p>
                        )}
                        {reply.statusUpdate && (
                          <p className="pt-1 border-t border-slate-700/60 text-[10px] text-slate-300 flex items-center gap-1">
                            <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                            <span>
                              Status set to{' '}
                              <strong className="uppercase text-white">
                                {reply.statusUpdate.replace('_', ' ')}
                              </strong>
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Zone 3: Pinned Always-Visible Reply Composer */}
          <form
            onSubmit={handleSubmitReply}
            className="px-5 py-3 bg-slate-950 border-t border-slate-800 shrink-0 space-y-2"
          >
            {/* Compact Controls Row */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">
                  Status:
                </label>
                <select
                  value={replyStatus}
                  onChange={e => setReplyStatus(e.target.value as ConsumerReport['status'])}
                  className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs font-semibold text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="pending">Pending Review</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>

                <input
                  type="text"
                  value={assignedCrew}
                  onChange={e => setAssignedCrew(e.target.value)}
                  placeholder="Assigned unit / crew (optional)"
                  className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none w-44 sm:w-52"
                />
              </div>

              <select
                value=""
                onChange={e => handleApplyQuickTemplate(e.target.value)}
                className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:border-blue-500 focus:outline-none max-w-[200px]"
                aria-label="Insert quick reply template"
              >
                <option value="">Quick reply template...</option>
                {ADMIN_QUICK_REPLIES.map((q, idx) => (
                  <option key={idx} value={String(idx)}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Side-by-Side Reply Input & Send Button */}
            <div className="flex items-end gap-2">
              <textarea
                required
                rows={2}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder={
                  ref
                    ? `Write official reply to ${report.consumerName} regarding "${ref.subject}"...`
                    : `Write official reply to ${report.consumerName} (#${report.accountNumber})...`
                }
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none resize-none leading-snug"
              />
              <button
                type="submit"
                disabled={isSubmittingReply || !replyText.trim()}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{isSubmittingReply ? 'Sending...' : 'Send Reply'}</span>
              </button>
            </div>

            {/* Subtle Secondary Footer Row */}
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 pt-0.5">
              <span className="truncate">
                {ref
                  ? `Delivers to #${report.accountNumber}'s Notification Bell with "${ref.subject}" attached`
                  : `Delivers directly to Account #${report.accountNumber}'s Notification Bell`}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                {onOpenInCustomerService && (
                  <button
                    type="button"
                    onClick={() => onOpenInCustomerService(report)}
                    className="text-sky-400 hover:text-sky-300 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <span>All Inquiries</span>
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="text-slate-300 hover:text-white font-semibold cursor-pointer whitespace-nowrap"
                >
                  Close
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Photo Lightbox */}
      {selectedPhotoPreview && (
        <div
          className="fixed inset-0 z-[140] bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-fade-in"
          onClick={() => setSelectedPhotoPreview(null)}
        >
          <div
            className="max-w-3xl w-full flex flex-col items-center space-y-2.5"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between text-white pb-2 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <ImageIcon className="h-4 w-4 text-sky-400" />
                <span>Attached Consumer Photo</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedPhotoPreview(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[78vh] overflow-hidden rounded-xl border border-slate-800 bg-black">
              <img
                src={selectedPhotoPreview}
                alt="Consumer attachment"
                referrerPolicy="no-referrer"
                className="max-h-[74vh] w-auto max-w-full object-contain mx-auto"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

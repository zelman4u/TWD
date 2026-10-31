import React, { useState, useMemo } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  Info,
  MapPin,
  Phone,
  Send,
  ShieldCheck,
  User as UserIcon,
  Wrench,
  XCircle,
  AlertCircle,
  History,
} from 'lucide-react';
import { Consumer, User, WaterMeterInstallationRequest } from '../../types';
import { mockDb } from '../../mockDb';
import { sendRealtimeMessage } from '../../services/realtimeSocket';
import { useToast } from '../../context/ToastContext';
import {
  canConsumerSubmitInstallationRequest,
  formatInstallationDateDisplay,
  generateApplicationNumber,
} from '../../utils/installationWorkflow';

interface ConsumerInstallationSectionProps {
  user: User;
  consumerRecord: Consumer | null;
  installationRequests: WaterMeterInstallationRequest[];
  onRefresh: () => void;
  compactHeader?: boolean;
}

export const ConsumerInstallationSection: React.FC<ConsumerInstallationSectionProps> = ({
  user,
  consumerRecord,
  installationRequests,
  onRefresh,
  compactHeader = false,
}) => {
  const toast = useToast();

  const latestRequest = installationRequests[0] || null;
  const submissionCheck = useMemo(
    () =>
      canConsumerSubmitInstallationRequest(
        consumerRecord,
        installationRequests,
        user.email,
        user.id
      ),
    [consumerRecord, installationRequests, user.email, user.id]
  );

  const minSelectableDate = useMemo(() => new Date().toISOString().split('T')[0], []);

  const defaultApplicationNumber = useMemo(() => {
    if (consumerRecord?.applicationNumber) return consumerRecord.applicationNumber;
    if (latestRequest?.applicationNumber && latestRequest.status !== 'Cancelled') {
      return latestRequest.applicationNumber;
    }
    const existing = [
      ...mockDb.getInstallationRequests().map((r) => r.applicationNumber),
      ...mockDb.getConsumers().map((c) => c.applicationNumber),
    ];
    return generateApplicationNumber(existing);
  }, [consumerRecord?.applicationNumber, latestRequest]);

  const [consumerName, setConsumerName] = useState(
    consumerRecord?.name || user.name || ''
  );
  const [contactNumber, setContactNumber] = useState(
    consumerRecord?.contactNumber || user.contactNumber || ''
  );
  const [address, setAddress] = useState(consumerRecord?.address || '');
  const [barangay, setBarangay] = useState(consumerRecord?.barangay || '');
  const [preferredDate, setPreferredDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [consumerRemarks, setConsumerRemarks] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justSubmittedReq, setJustSubmittedReq] = useState<WaterMeterInstallationRequest | null>(null);

  const availableBarangays = useMemo(() => mockDb.getBarangays(), []);

  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!submissionCheck.allowed) {
      setFormError(
        submissionCheck.reason ||
          'An active water meter installation request is already on file for your account.'
      );
      return;
    }

    const cleanName = (consumerName || consumerRecord?.name || user.name || '').trim();
    const cleanContact = (contactNumber || consumerRecord?.contactNumber || '').replace(/\D/g, '').slice(0, 11);
    const cleanBarangay = (barangay || consumerRecord?.barangay || '').trim();
    const cleanAddress =
      (address || consumerRecord?.address || '').trim() ||
      (cleanBarangay ? `${cleanBarangay}, Tagoloan, Misamis Oriental` : '');

    if (!cleanName) {
      setFormError('Please provide your full consumer name.');
      return;
    }
    if (cleanContact.length !== 11 || !cleanContact.startsWith('09')) {
      setFormError('Please provide a valid 11-digit mobile number starting with 09.');
      return;
    }
    if (!cleanBarangay || !cleanAddress) {
      setFormError('Please confirm your service address and Barangay.');
      return;
    }
    if (!preferredDate) {
      setFormError('Please select a preferred installation date.');
      return;
    }
    if (preferredDate < minSelectableDate) {
      setFormError('Preferred installation date cannot be earlier than today.');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = mockDb.createInstallationRequest({
        applicationNumber: defaultApplicationNumber,
        consumerId: consumerRecord?.id || user.id,
        linkedUserId: consumerRecord?.linkedUserId || user.id,
        consumerName: cleanName,
        consumerEmail: (consumerRecord?.email || user.email || '').trim().toLowerCase(),
        contactNumber: cleanContact,
        address: cleanAddress,
        barangay: cleanBarangay,
        barangayId: consumerRecord?.barangayId,
        sitioZone: consumerRecord?.sitioZone,
        consumerType: consumerRecord?.consumerType || 'Residential',
        preferredInstallationDate: preferredDate,
        consumerRemarks: consumerRemarks.trim(),
      });

      sendRealtimeMessage('INSTALLATION_REQUEST_SUBMITTED', { request: created });
      setJustSubmittedReq(created);
      setConsumerRemarks('');
      onRefresh();
      toast.success(
        'Installation Request Submitted',
        `Application ${created.applicationNumber} received! Preferred date: ${formatInstallationDateDisplay(created.preferredInstallationDate)}.`
      );
    } catch (err) {
      console.error('[ConsumerInstallationSection] Submit error:', err);
      setFormError('Unable to submit installation request right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeStepIndex = useMemo(() => {
    if (!latestRequest || latestRequest.status === 'Cancelled') return 0;
    if (latestRequest.accountValidationStatus === 'validated') return 4;
    if (latestRequest.status === 'Installed') return 3;
    if (
      latestRequest.status === 'Approved' ||
      latestRequest.status === 'Scheduled' ||
      latestRequest.status === 'Rescheduled' ||
      latestRequest.status === 'Installation in Progress'
    ) {
      return 2;
    }
    return 1;
  }, [latestRequest]);

  const getStatusBadgeClasses = (status: string) => {
    switch (status) {
      case 'Pending Review':
        return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60';
      case 'Approved':
      case 'Scheduled':
        return 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/60';
      case 'Rescheduled':
        return 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800/60';
      case 'Installation in Progress':
        return 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/60';
      case 'Installed':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60';
      case 'Cancelled':
        return 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
    }
  };

  const getValidationBadge = (req: WaterMeterInstallationRequest) => {
    if (req.accountValidationStatus === 'validated') {
      return {
        label: 'Validated · Account Active',
        classes:
          'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60',
      };
    }
    if (req.status === 'Installed' || req.accountValidationStatus === 'awaiting_validation') {
      return {
        label: 'Awaiting Administrative Validation',
        classes:
          'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60',
      };
    }
    if (req.status === 'Cancelled') {
      return {
        label: 'Request Cancelled',
        classes:
          'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60',
      };
    }
    return {
      label: 'Pending Physical Meter Installation',
      classes:
        'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    };
  };

  const issuedAcc =
    latestRequest?.assignedAccountNumber ||
    (consumerRecord?.accountNumber && !consumerRecord.accountNumber.toUpperCase().startsWith('PENDING')
      ? consumerRecord.accountNumber
      : '');
  const issuedTag =
    latestRequest?.assignedMeterTagNumber ||
    (consumerRecord?.meterNumber && !consumerRecord.meterNumber.toUpperCase().startsWith('PENDING')
      ? consumerRecord.meterNumber
      : '');

  return (
    <div className="space-y-5">
      {!compactHeader && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="h-11 w-11 rounded-2xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                Water Meter Installation & Account Activation
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Schedule your Tagoloan Water District meter installation, track field progress, and view your official Account Number and Meter Tag Number upon validation.
              </p>
            </div>
          </div>
          {(latestRequest?.applicationNumber || consumerRecord?.applicationNumber) && (
            <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-right shrink-0">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                Application Number
              </span>
              <span className="font-mono tabular-nums text-xs font-black text-blue-600 dark:text-blue-400">
                {latestRequest?.applicationNumber || consumerRecord?.applicationNumber}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Immediate Post-Submission Confirmation Banner */}
      {justSubmittedReq && (
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-900 dark:text-emerald-100 space-y-1">
            <p className="font-black text-sm">
              Water Meter Installation Request Successfully Received
            </p>
            <p className="text-emerald-800 dark:text-emerald-200 leading-relaxed">
              Your installation request under Application Number{' '}
              <span className="font-mono tabular-nums font-bold">{justSubmittedReq.applicationNumber}</span>{' '}
              for preferred date{' '}
              <span className="font-mono tabular-nums font-bold">
                {formatInstallationDateDisplay(justSubmittedReq.preferredInstallationDate)}
              </span>{' '}
              has been submitted to Tagoloan Water District. You will receive automatic notifications as our staff confirms your schedule and completes installation.
            </p>
          </div>
        </div>
      )}

      {/* Recommendation & Scheduling Form when Consumer has NOT scheduled yet (or previous request was Cancelled) */}
      {submissionCheck.allowed && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-5 bg-gradient-to-r from-amber-50/80 via-white to-blue-50/60 dark:from-amber-950/20 dark:via-slate-900 dark:to-blue-950/20 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {latestRequest?.status === 'Cancelled'
                      ? 'Submit a New Water Meter Installation Request'
                      : 'Schedule Your Water Meter Installation'}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 whitespace-nowrap">
                    {latestRequest?.status === 'Cancelled'
                      ? 'Previous Request Cancelled'
                      : 'Installation Not Scheduled'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                  We recommend scheduling your physical water meter installation now. Your official{' '}
                  <strong>Account Number</strong> and <strong>Meter Tag Number</strong> will be issued once installation and administrative validation are completed.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmitRequest} className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Consumer Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <UserIcon className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={consumerName}
                    onChange={(e) => setConsumerName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 pl-9 pr-3 py-2 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Registration / Application No.
                </label>
                <div className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/90 px-3 py-2 text-xs font-mono tabular-nums font-bold text-blue-700 dark:text-blue-300 flex items-center justify-between">
                  <span>{defaultApplicationNumber}</span>
                  <span className="text-[9px] font-sans uppercase text-slate-400">Official</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Contact Number (11 Digits) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    required
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    placeholder="09XXXXXXXXX"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 pl-9 pr-3 py-2 text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Barangay <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Select Barangay --</option>
                  {availableBarangays.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Complete Service Address <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <MapPin className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Sitio / Zone / Street, Barangay, Tagoloan, Misamis Oriental"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 pl-9 pr-3 py-2 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Preferred Installation Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  min={minSelectableDate}
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Additional Remarks or Installation Instructions (Optional)
                </label>
                <input
                  type="text"
                  value={consumerRemarks}
                  onChange={(e) => setConsumerRemarks(e.target.value)}
                  placeholder="House landmark, gate instructions, preferred morning/afternoon availability..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {formError && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 p-3 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300 font-semibold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <span>
                  Tagoloan Water District staff will review and confirm your official installation date.
                </span>
              </p>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider shadow-sm transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{isSubmitting ? 'Submitting Request...' : 'Submit Installation Request'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Installation Request Tracking & Details Card */}
      {latestRequest && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Installation Request & Account Activation Tracker
                </h3>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold border whitespace-nowrap ${getStatusBadgeClasses(
                    latestRequest.status
                  )}`}
                >
                  {latestRequest.status}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Real-time schedule, field completion status, and administrative validation for Application{' '}
                <span className="font-mono tabular-nums font-bold text-slate-700 dark:text-slate-200">
                  {latestRequest.applicationNumber}
                </span>
                .
              </p>
            </div>

            {(() => {
              const vBadge = getValidationBadge(latestRequest);
              return (
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold border whitespace-nowrap shrink-0 ${vBadge.classes}`}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>{vBadge.label}</span>
                </span>
              );
            })()}
          </div>

          <div className="p-5 space-y-5">
            {/* 4-Stage Progress Bar */}
            {latestRequest.status !== 'Cancelled' ? (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                {[
                  {
                    step: 1,
                    title: '1. Request Received',
                    desc: formatInstallationDateDisplay(latestRequest.submissionDate),
                  },
                  {
                    step: 2,
                    title: '2. Schedule Confirmed',
                    desc: latestRequest.confirmedInstallationDate
                      ? formatInstallationDateDisplay(latestRequest.confirmedInstallationDate)
                      : 'Pending District Review',
                  },
                  {
                    step: 3,
                    title: '3. Meter Installed',
                    desc: latestRequest.completionDate
                      ? formatInstallationDateDisplay(latestRequest.completionDate)
                      : 'Awaiting Field Crew',
                  },
                  {
                    step: 4,
                    title: '4. Account Activated',
                    desc:
                      latestRequest.accountValidationStatus === 'validated'
                        ? 'Account & Meter Tag Issued'
                        : 'Admin Verification',
                  },
                ].map((item) => {
                  const isCompleted = activeStepIndex >= item.step;
                  const isCurrent = activeStepIndex === item.step;
                  return (
                    <div
                      key={item.step}
                      className={`p-3 rounded-xl border transition ${
                        isCompleted
                          ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/70'
                          : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[11px] font-black ${
                            isCompleted
                              ? 'text-blue-800 dark:text-blue-300'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {item.title}
                        </span>
                        {isCompleted ? (
                          <CheckCircle2
                            className={`h-4 w-4 shrink-0 ${
                              item.step === 4
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-blue-600 dark:text-blue-400'
                            }`}
                          />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                      </div>
                      <p
                        className={`text-[10px] font-mono tabular-nums mt-1 ${
                          isCurrent
                            ? 'font-bold text-slate-800 dark:text-slate-200'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 p-3.5 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
                <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">This installation request was marked as Cancelled.</p>
                  {latestRequest.adminRemarks && (
                    <p className="mt-0.5">Reason / Remarks: {latestRequest.adminRemarks}</p>
                  )}
                  <p className="mt-1 text-[11px] opacity-90">
                    You may submit a new preferred installation schedule using the form above.
                  </p>
                </div>
              </div>
            )}

            {/* Required 8 Tracking Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Application Number
                </span>
                <span className="font-mono tabular-nums text-xs font-black text-slate-900 dark:text-white mt-0.5 block">
                  {latestRequest.applicationNumber}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Installation Request Date
                </span>
                <span className="font-mono tabular-nums text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                  {formatInstallationDateDisplay(latestRequest.submissionDate)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Preferred Installation Date
                </span>
                <span className="font-mono tabular-nums text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                  {formatInstallationDateDisplay(latestRequest.preferredInstallationDate)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Confirmed Installation Date
                </span>
                <span className="font-mono tabular-nums text-xs font-bold text-blue-700 dark:text-blue-300 mt-0.5 block">
                  {latestRequest.confirmedInstallationDate
                    ? formatInstallationDateDisplay(latestRequest.confirmedInstallationDate)
                    : 'Awaiting Confirmation'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Current Installation Status
                </span>
                <span className="text-xs font-black text-slate-900 dark:text-white mt-0.5 block">
                  {latestRequest.status}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Installation Completion Date
                </span>
                <span className="font-mono tabular-nums text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                  {latestRequest.completionDate
                    ? formatInstallationDateDisplay(latestRequest.completionDate)
                    : 'Pending Completion'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 sm:col-span-2">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Account Validation Status
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-white mt-0.5 block">
                  {latestRequest.accountValidationStatus === 'validated'
                    ? 'Verified & Validated — Official Account & Meter Tag Issued'
                    : latestRequest.status === 'Installed'
                      ? 'Physical Meter Installed — Awaiting Administrative Account Validation'
                      : 'Pending Physical Water Meter Installation'}
                </span>
              </div>
            </div>

            {/* Administrator & Applicant Remarks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-800/50">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span>Administrator Remarks / Instructions</span>
                </span>
                <p className="text-xs text-slate-700 dark:text-slate-200 mt-1 leading-relaxed">
                  {latestRequest.adminRemarks || 'No additional remarks from Tagoloan Water District yet.'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span>Service Location & Consumer Instructions</span>
                </span>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
                  {latestRequest.address}
                </p>
                {latestRequest.consumerRemarks && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Note: {latestRequest.consumerRemarks}
                  </p>
                )}
              </div>
            </div>

            {/* Official Account Number & Meter Tag Number Issuance Card (Strictly NO Meter Serial Number here) */}
            {latestRequest.accountValidationStatus === 'validated' && issuedAcc && issuedTag ? (
              <div className="rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Gauge className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-black text-emerald-950 dark:text-emerald-100">
                        Water Service Account Validated & Active
                      </h4>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-600 text-white">
                        Active
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800 dark:text-emerald-200/90 mt-0.5">
                      Your official Tagoloan Water District credentials have been verified and linked to your portal account.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <div className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Official Account Number
                    </span>
                    <span className="font-mono tabular-nums text-xs font-black text-emerald-700 dark:text-emerald-300">
                      {issuedAcc}
                    </span>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Official Meter Tag Number
                    </span>
                    <span className="font-mono tabular-nums text-xs font-black text-blue-700 dark:text-blue-300">
                      {issuedTag}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 p-3.5 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-800 dark:text-white">
                    Official Account Number & Meter Tag Number Issuance:
                  </span>{' '}
                  {latestRequest.status === 'Installed'
                    ? 'Your physical water meter installation is marked as Installed and is now undergoing administrative verification. Your official Account Number and Meter Tag Number will appear here automatically once validated.'
                    : 'Your official Account Number and Meter Tag Number will be issued after physical water meter installation is completed and verified by the Tagoloan Water District administrator.'}
                </div>
              </div>
            )}

            {/* Installation History & Activity Log */}
            {Array.isArray(latestRequest.history) && latestRequest.history.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-blue-500" />
                  <span>Installation Activity & Schedule History</span>
                </h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {[...latestRequest.history]
                    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
                    .map((entry) => (
                      <div
                        key={entry.id}
                        className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 dark:text-white">
                              {entry.action || entry.status}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                              {entry.status}
                            </span>
                            {entry.scheduledDate && (
                              <span className="text-[10px] font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
                                Schedule: {formatInstallationDateDisplay(entry.scheduledDate)}
                              </span>
                            )}
                          </div>
                          {entry.remarks && (
                            <p className="text-[11px] text-slate-600 dark:text-slate-400">{entry.remarks}</p>
                          )}
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0 sm:text-right">
                          <div>{new Date(entry.timestamp).toLocaleString()}</div>
                          <div className="font-sans text-slate-500">
                            {entry.actorRole === 'admin' ? 'Tagoloan Water District' : entry.actorName}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsumerInstallationSection;

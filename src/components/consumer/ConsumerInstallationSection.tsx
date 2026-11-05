import React, { useState, useMemo } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  MapPin,
  Phone,
  Send,
  ShieldCheck,
  User as UserIcon,
  Wrench,
  XCircle,
  AlertCircle,
  History,
  X,
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
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<any | null>(null);

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
    if (!cleanBarangay) {
      setFormError('Please select your official Barangay.');
      return;
    }
    if (!cleanAddress) {
      setFormError('Please provide your complete service address.');
      return;
    }
    if (!preferredDate) {
      setFormError('Please select your preferred installation date.');
      return;
    }

    setIsSubmitting(true);

    try {
      const newReq = mockDb.createInstallationRequest({
        applicationNumber: defaultApplicationNumber,
        consumerName: cleanName,
        contactNumber: cleanContact,
        barangay: cleanBarangay,
        address: cleanAddress,
        preferredInstallationDate: preferredDate,
        consumerRemarks: consumerRemarks.trim() || undefined,
        submittedByUserId: user.id,
        submittedByUserEmail: user.email,
        assignedAccountNumber: consumerRecord?.accountNumber,
      });

      sendRealtimeMessage({
        type: 'INSTALLATION_REQUEST_SUBMITTED',
        payload: {
          applicationNumber: newReq.applicationNumber,
          consumerName: newReq.consumerName,
          preferredDate: newReq.preferredInstallationDate,
          barangay: newReq.barangay,
        },
      });

      mockDb.addNotification({
        accountNumber: consumerRecord?.accountNumber,
        title: 'Water Meter Installation Scheduled',
        message: `Your water meter installation request under Application #${newReq.applicationNumber} has been received for ${formatInstallationDateDisplay(
          newReq.preferredInstallationDate
        )}. Tagoloan Water District staff will inspect your premises.`,
        type: 'system',
        priority: 'high',
      });

      setJustSubmittedReq(newReq);
      setIsScheduleModalOpen(false);
      setConsumerRemarks('');
      toast.success(
        'Installation Request Submitted',
        `Your request under Application #${newReq.applicationNumber} is being processed.`
      );
      onRefresh();
    } catch (err: any) {
      setFormError(err?.message || 'Could not submit installation request. Please retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeStepIndex = useMemo(() => {
    if (!latestRequest) return 0;
    if (latestRequest.status === 'Cancelled') return 0;
    if (latestRequest.accountValidationStatus === 'validated') return 4;
    if (latestRequest.status === 'Installed') return 3;
    if (
      latestRequest.status === 'Scheduled' ||
      latestRequest.confirmedInstallationDate
    )
      return 2;
    return 1;
  }, [latestRequest]);

  const getStatusBadgeClasses = (status: string) => {
    switch (status) {
      case 'Installed':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60 shadow-sm';
      case 'Scheduled':
        return 'bg-blue-950/80 text-blue-300 border-blue-700/60 shadow-sm';
      case 'Pending Review':
        return 'bg-amber-950/80 text-amber-300 border-amber-700/60 shadow-sm';
      case 'Cancelled':
        return 'bg-rose-950/80 text-rose-300 border-rose-700/60 shadow-sm';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getValidationBadge = (req: WaterMeterInstallationRequest) => {
    if (req.accountValidationStatus === 'validated') {
      return {
        label: 'Validated · Account Active',
        classes: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60 shadow-sm',
      };
    }
    if (req.status === 'Installed' || req.accountValidationStatus === 'awaiting_validation') {
      return {
        label: 'Awaiting Administrative Validation',
        classes: 'bg-amber-950/80 text-amber-300 border-amber-700/60 shadow-sm',
      };
    }
    if (req.status === 'Cancelled') {
      return {
        label: 'Request Cancelled',
        classes: 'bg-rose-950/80 text-rose-300 border-rose-700/60 shadow-sm',
      };
    }
    return {
      label: 'Pending Physical Meter Installation',
      classes: 'bg-slate-800 text-slate-300 border-slate-700',
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
    <div className="space-y-6" id="consumer-meter-installation-section">
      {!compactHeader && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0 shadow-inner">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                  Water Meter Installation & Activation Tracker
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Field Operations
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Schedule your physical water meter installation, track field inspection progress, and receive your official Account Number and Meter Tag Number upon administrative validation.
              </p>
            </div>
          </div>
          {(latestRequest?.applicationNumber || consumerRecord?.applicationNumber) && (
            <div className="px-4 py-2.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-right shrink-0 shadow-sm">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                Application Number
              </span>
              <span className="font-mono tabular-nums text-sm font-black text-blue-400">
                {latestRequest?.applicationNumber || consumerRecord?.applicationNumber}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Immediate Post-Submission Confirmation Banner */}
      {justSubmittedReq && (
        <div className="rounded-2xl bg-emerald-950/50 border border-emerald-800/80 p-5 flex items-start gap-3.5 shadow-lg">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-100 space-y-1">
            <p className="font-black text-sm text-emerald-300">
              Water Meter Installation Request Successfully Received
            </p>
            <p className="text-emerald-200/90 leading-relaxed">
              Your installation request under Application Number{' '}
              <span className="font-mono tabular-nums font-bold text-white">{justSubmittedReq.applicationNumber}</span>{' '}
              for preferred date{' '}
              <span className="font-mono tabular-nums font-bold text-white">
                {formatInstallationDateDisplay(justSubmittedReq.preferredInstallationDate)}
              </span>{' '}
              has been recorded in the Tagoloan Water District field registry. You will receive real-time notifications as our crew validates your schedule and completes meter commissioning.
            </p>
          </div>
        </div>
      )}

      {/* Recommendation & Modal Trigger Card when Consumer has NOT scheduled yet (or previous request was Cancelled) */}
      {submissionCheck.allowed && (
        <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
          <div className="p-6 bg-gradient-to-r from-amber-950/30 via-slate-900 to-blue-950/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div className="flex items-start gap-3.5">
              <div className="h-11 w-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-black text-white">
                    {latestRequest?.status === 'Cancelled'
                      ? 'Submit a New Water Meter Installation Request'
                      : 'Schedule Your Physical Water Meter Installation'}
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                    {latestRequest?.status === 'Cancelled'
                      ? 'Previous Request Cancelled'
                      : 'Installation Not Scheduled'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl">
                  Submit your preferred installation schedule to our field technical division. Once physical meter installation is complete and inspected, your official{' '}
                  <strong className="text-slate-200">Account Number</strong> and <strong className="text-slate-200">Meter Tag Number</strong> will be activated.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setIsScheduleModalOpen(true);
              }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-blue-600/30 transition cursor-pointer whitespace-nowrap shrink-0"
              id="schedule-installation-trigger-btn"
            >
              <Calendar className="h-4 w-4 shrink-0" />
              <span>Schedule Installation</span>
            </button>
          </div>
        </div>
      )}

      {/* Installation Request Tracking & Details Card */}
      {latestRequest && (
        <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
          <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-base font-black text-white">
                  Installation Schedule & Activation Tracker
                </h3>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${getStatusBadgeClasses(
                    latestRequest.status
                  )}`}
                >
                  {latestRequest.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Real-time field installation progress and validation log for Application{' '}
                <span className="font-mono tabular-nums font-bold text-blue-400">
                  {latestRequest.applicationNumber}
                </span>
                .
              </p>
            </div>

            {(() => {
              const vBadge = getValidationBadge(latestRequest);
              return (
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border whitespace-nowrap shrink-0 ${vBadge.classes}`}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>{vBadge.label}</span>
                </span>
              );
            })()}
          </div>

          <div className="p-6 space-y-6">
            {/* 4-Stage Progress Bar */}
            {latestRequest.status !== 'Cancelled' ? (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
                        ? 'Account & Tag Issued'
                        : 'Admin Verification',
                  },
                ].map((item) => {
                  const isCompleted = activeStepIndex >= item.step;
                  const isCurrent = activeStepIndex === item.step;
                  return (
                    <div
                      key={item.step}
                      className={`p-3.5 rounded-2xl border transition ${
                        isCompleted
                          ? 'bg-blue-950/40 border-blue-700/60 shadow-sm'
                          : 'bg-slate-950/50 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-black ${
                            isCompleted ? 'text-blue-300' : 'text-slate-400'
                          }`}
                        >
                          {item.title}
                        </span>
                        {isCompleted ? (
                          <CheckCircle2
                            className={`h-4 w-4 shrink-0 ${
                              item.step === 4 ? 'text-emerald-400' : 'text-blue-400'
                            }`}
                          />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        )}
                      </div>
                      <p
                        className={`text-[11px] font-mono tabular-nums mt-1.5 ${
                          isCurrent ? 'font-bold text-white' : 'text-slate-400'
                        }`}
                      >
                        {item.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl bg-rose-950/40 border border-rose-800/70 p-4 flex items-start gap-3 text-xs text-rose-200">
                <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-sm text-rose-300">This installation request was marked as Cancelled.</p>
                  {latestRequest.adminRemarks && (
                    <p className="mt-1">Reason / Remarks: {latestRequest.adminRemarks}</p>
                  )}
                  <p className="mt-1.5 text-[11px] text-rose-300/80">
                    You may submit a new preferred installation schedule using the button above.
                  </p>
                </div>
              </div>
            )}

            {/* Clear Status Notice When Physical Meter Is Installed & Waiting for Account Validation */}
            {latestRequest.status === 'Installed' && latestRequest.accountValidationStatus !== 'validated' && (
              <div className="rounded-2xl bg-emerald-950/40 border border-emerald-800/80 p-5 flex items-start gap-3.5 text-xs text-emerald-200">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-black text-sm text-emerald-300">
                    Water Meter Installed — Waiting for Account Validation
                  </p>
                  <p className="leading-relaxed text-emerald-200/90">
                    Physical water meter installation at your premises has been completed by the Tagoloan Water District field team. Please wait while administration completes the final inspection to issue your official{' '}
                    <strong className="text-white">Account Number</strong> and <strong className="text-white">Meter Tag Number</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* Required 8 Tracking Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Application Number
                </span>
                <span className="font-mono tabular-nums text-xs font-black text-white mt-1 block">
                  {latestRequest.applicationNumber}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Installation Request Date
                </span>
                <span className="font-mono tabular-nums text-xs font-semibold text-slate-200 mt-1 block">
                  {formatInstallationDateDisplay(latestRequest.submissionDate)}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Preferred Installation Date
                </span>
                <span className="font-mono tabular-nums text-xs font-semibold text-slate-200 mt-1 block">
                  {formatInstallationDateDisplay(latestRequest.preferredInstallationDate)}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Confirmed Installation Date
                </span>
                <span className="font-mono tabular-nums text-xs font-bold text-blue-400 mt-1 block">
                  {latestRequest.confirmedInstallationDate
                    ? formatInstallationDateDisplay(latestRequest.confirmedInstallationDate)
                    : 'Awaiting Confirmation'}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Current Installation Status
                </span>
                <span className="text-xs font-black text-white mt-1 block">
                  {latestRequest.status}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Installation Completion Date
                </span>
                <span className="font-mono tabular-nums text-xs font-semibold text-slate-200 mt-1 block">
                  {latestRequest.completionDate
                    ? formatInstallationDateDisplay(latestRequest.completionDate)
                    : 'Pending Completion'}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80 sm:col-span-2">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Account Validation Status
                </span>
                <span className="text-xs font-bold text-white mt-1 block">
                  {latestRequest.accountValidationStatus === 'validated'
                    ? 'Verified & Validated — Official Account & Meter Tag Issued'
                    : latestRequest.status === 'Installed'
                      ? 'Physical Meter Installed — Awaiting Administrative Account Validation'
                      : 'Pending Physical Water Meter Installation'}
                </span>
              </div>
            </div>

            {/* Administrator & Applicant Remarks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-2xl bg-blue-950/30 border border-blue-800/50">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span>Administrator Remarks / Instructions</span>
                </span>
                <p className="text-xs text-slate-200 mt-1.5 leading-relaxed">
                  {latestRequest.adminRemarks || 'No additional remarks from Tagoloan Water District yet.'}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span>Service Location & Consumer Instructions</span>
                </span>
                <p className="text-xs font-semibold text-slate-200 mt-1.5">
                  {latestRequest.address}
                </p>
                {latestRequest.consumerRemarks && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Note: {latestRequest.consumerRemarks}
                  </p>
                )}
              </div>
            </div>

            {/* Official Account Number & Meter Tag Number Issuance Card */}
            {latestRequest.accountValidationStatus === 'validated' && issuedAcc && issuedTag ? (
              <div className="rounded-2xl bg-emerald-950/40 border border-emerald-800/80 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="h-11 w-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-lg">
                    <Gauge className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-black text-emerald-300">
                        Water Service Account Validated & Active
                      </h4>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-600 text-white">
                        Active
                      </span>
                    </div>
                    <p className="text-xs text-emerald-200/90 mt-0.5">
                      Your official Tagoloan Water District credentials have been verified and linked to your portal account.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <div className="px-3.5 py-2 rounded-xl bg-slate-900 border border-emerald-700/60 shadow-sm">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Official Account Number
                    </span>
                    <span className="font-mono tabular-nums text-xs font-black text-emerald-300">
                      {issuedAcc}
                    </span>
                  </div>
                  <div className="px-3.5 py-2 rounded-xl bg-slate-900 border border-blue-700/60 shadow-sm">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Official Meter Tag Number
                    </span>
                    <span className="font-mono tabular-nums text-xs font-black text-blue-300">
                      {issuedTag}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4 flex items-start gap-3 text-xs text-slate-300">
                <Clock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold text-white">
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
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <History className="h-4 w-4 text-blue-400" />
                  <span>Installation Activity & Schedule History</span>
                </h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {[...latestRequest.history]
                    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
                    .map((entry) => (
                      <div
                        key={entry.id}
                        onClick={() => setSelectedHistoryEntry(entry)}
                        title="Click to inspect full activity details"
                        className="p-3 rounded-2xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 hover:border-blue-500/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs transition cursor-pointer"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white">
                              {entry.action || entry.status}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              {entry.status}
                            </span>
                            {entry.scheduledDate && (
                              <span className="text-[10px] font-mono tabular-nums text-blue-400 font-semibold">
                                Schedule: {formatInstallationDateDisplay(entry.scheduledDate)}
                              </span>
                            )}
                          </div>
                          {entry.remarks && (
                            <p className="text-[11px] text-slate-400 line-clamp-1">{entry.remarks}</p>
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

      {/* Water Meter Installation Scheduling Modal */}
      {isScheduleModalOpen && submissionCheck.allowed && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setIsScheduleModalOpen(false)}
        >
          <form
            onSubmit={handleSubmitRequest}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden text-left"
          >
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                  <Wrench className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-black text-white truncate">
                    Schedule Water Meter Installation
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate">
                    Application <span className="font-mono tabular-nums font-bold text-blue-400">{defaultApplicationNumber}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Consumer Name <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <UserIcon className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      value={consumerName}
                      onChange={(e) => setConsumerName(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Contact Number (11 Digits) <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={11}
                      required
                      value={contactNumber}
                      onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                      placeholder="09XXXXXXXXX"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs font-mono tabular-nums font-semibold text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Barangay <span className="text-rose-400">*</span>
                  </label>
                  <select
                    required
                    value={barangay}
                    onChange={(e) => setBarangay(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- Select Barangay --</option>
                    {availableBarangays.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Preferred Installation Date <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    min={minSelectableDate}
                    value={preferredDate}
                    onChange={(e) => setPreferredDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono tabular-nums font-semibold text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Complete Service Address <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <MapPin className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Sitio / Zone / Street, Barangay, Tagoloan, Misamis Oriental"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Additional Remarks or Installation Instructions (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={consumerRemarks}
                    onChange={(e) => setConsumerRemarks(e.target.value)}
                    placeholder="House landmark, gate instructions, preferred morning/afternoon availability..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
              </div>

              {formError && (
                <div className="rounded-xl bg-rose-950/60 border border-rose-800/80 p-3 flex items-center gap-2 text-xs text-rose-300 font-semibold">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-blue-600/30 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{isSubmitting ? 'Submitting...' : 'Submit Installation Request'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Installation Activity Detail Modal */}
      {selectedHistoryEntry && latestRequest && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSelectedHistoryEntry(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden text-left"
          >
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-white">
                  {selectedHistoryEntry.action || selectedHistoryEntry.status}
                </h4>
                <p className="text-[11px] font-mono tabular-nums text-slate-400">
                  Application #{latestRequest.applicationNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistoryEntry(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Status</span>
                  <span className="font-bold text-white">{selectedHistoryEntry.status}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Recorded At</span>
                  <span className="font-mono tabular-nums text-slate-300">
                    {new Date(selectedHistoryEntry.timestamp).toLocaleString()}
                  </span>
                </div>
                {selectedHistoryEntry.scheduledDate && (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Scheduled Date</span>
                    <span className="font-mono tabular-nums font-bold text-blue-400">
                      {formatInstallationDateDisplay(selectedHistoryEntry.scheduledDate)}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Updated By</span>
                  <span className="font-semibold text-slate-200">
                    {selectedHistoryEntry.actorRole === 'admin' ? 'Tagoloan Water District' : selectedHistoryEntry.actorName}
                  </span>
                </div>
              </div>
              {selectedHistoryEntry.remarks && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Remarks & Details</span>
                  <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {selectedHistoryEntry.remarks}
                  </p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedHistoryEntry(null)}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsumerInstallationSection;

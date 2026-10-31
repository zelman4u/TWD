/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  UserCheck,
  AlertCircle,
  ArrowLeft,
  Waves,
  Briefcase,
  Clock,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Lock,
  Phone,
  Gauge,
  Calendar,
  FileText,
  Info,
  Wrench,
} from 'lucide-react';
import { mockDb } from '../mockDb';
import { User, Consumer, Barangay } from '../types';
import { syncDocToFirestore, COLLECTIONS } from '../services/firebaseDb';
import { sendRealtimeMessage } from '../services/realtimeSocket';
import { useLoading } from '../context/LoadingContext';
import { useToast } from '../context/ToastContext';
import { normalizePhoneNumber, detectExistingPhoneAccount } from '../utils/phoneValidation';
import { generateApplicationNumber, formatInstallationDateDisplay } from '../utils/installationWorkflow';

interface RegistrationPageProps {
  onBackToHome: () => void;
  onNavigateToLogin: () => void;
}

export default function RegistrationPage({ onBackToHome, onNavigateToLogin }: RegistrationPageProps) {
  const { showLoading, hideLoading } = useLoading();
  const toast = useToast();

  // Consumer Form State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [phoneDuplicateInfo, setPhoneDuplicateInfo] = useState<{
    detected: boolean;
    accountHolder?: string;
    accountType?: string;
    message?: string;
  } | null>(null);
  const [barangay, setBarangay] = useState('');
  const [sitioZone, setSitioZone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Available Barangays loaded from DB
  const [availableBarangays, setAvailableBarangays] = useState<Barangay[]>([]);

  // Consumer Classification State
  const [consumerType, setConsumerType] = useState<'Residential' | 'Commercial'>('Residential');

  // Water Meter Status & Installation Scheduling State
  const [hasExistingMeter, setHasExistingMeter] = useState<boolean>(false);
  const [scheduleOption, setScheduleOption] = useState<'now' | 'later'>('now');
  const [preferredInstallationDate, setPreferredInstallationDate] = useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [installationRemarks, setInstallationRemarks] = useState('');

  const minSelectableDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [previewApplicationNumber] = useState<string>(() => {
    const existing = [
      ...mockDb.getInstallationRequests().map((r) => r.applicationNumber),
      ...mockDb.getConsumers().map((c) => c.applicationNumber),
    ];
    return generateApplicationNumber(existing);
  });

  // Logic State
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSuccessModal, setIsSuccessModal] = useState(false);
  const [registeredSummary, setRegisteredSummary] = useState<{
    accountNumber: string;
    applicationNumber?: string;
    fullName: string;
    email: string;
    contactNumber: string;
    barangayName: string;
    barangayId?: string;
    sitioZone?: string;
    fullAddress?: string;
    consumerType?: string;
    hasExistingMeter: boolean;
    scheduleOption?: 'now' | 'later';
    preferredInstallationDate?: string;
    installationRemarks?: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    const refreshBarangays = () => {
      setAvailableBarangays(mockDb.getBarangays());
    };
    refreshBarangays();
    window.addEventListener('twd_database_updated', refreshBarangays);
    return () => window.removeEventListener('twd_database_updated', refreshBarangays);
  }, []);

  // Handle contact number input with strict 11-digit constraint & real-time duplicate detection
  const handleContactNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '').slice(0, 11);
    setContactNumber(rawDigits);
    setError(null);

    if (rawDigits.length === 11) {
      if (!rawDigits.startsWith('09')) {
        setPhoneDuplicateInfo({
          detected: true,
          message: 'Mobile number must start with 09 (e.g. 09171234567).',
        });
        return;
      }

      const match = detectExistingPhoneAccount(rawDigits);
      if (match) {
        setPhoneDuplicateInfo({
          detected: true,
          accountHolder: match.name,
          accountType: match.type,
          message: `This mobile number (${rawDigits}) is already connected to an existing account (${match.name}).`,
        });
      } else {
        setPhoneDuplicateInfo({
          detected: false,
        });
      }
    } else {
      setPhoneDuplicateInfo(null);
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('Please provide your full official name.');
      return;
    }

    if (!email.trim() || !contactNumber.trim() || !password.trim()) {
      setError('Please complete all required fields.');
      return;
    }

    const cleanPhone = normalizePhoneNumber(contactNumber);
    if (cleanPhone.length !== 11) {
      setError(`Mobile number must contain exactly 11 digits (e.g. 09171234567). Current length: ${cleanPhone.length} digits.`);
      return;
    }

    if (!cleanPhone.startsWith('09')) {
      setError('Mobile number must start with 09 (e.g. 09171234567).');
      return;
    }

    const existingPhoneAccount = detectExistingPhoneAccount(cleanPhone);
    if (existingPhoneAccount) {
      setError(`Mobile number "${cleanPhone}" is already connected to an existing account (${existingPhoneAccount.name}). Duplicate phone numbers are strictly prohibited in the system.`);
      return;
    }

    if (!confirmPassword.trim()) {
      setError('Please re-enter your password to confirm.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please ensure both password fields are identical.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters in length.');
      return;
    }

    if (!barangay || barangay.trim() === '') {
      setError('Barangay selection is mandatory. Please select your registered Barangay from the list.');
      return;
    }

    if (!sitioZone || sitioZone.trim() === '') {
      setError('Sitio / Zone is mandatory. Please enter your Sitio or Zone.');
      return;
    }

    if (!hasExistingMeter && scheduleOption === 'now') {
      if (!preferredInstallationDate) {
        setError('Please select your preferred water meter installation date.');
        return;
      }
      if (preferredInstallationDate < minSelectableDate) {
        setError('Preferred installation date cannot be earlier than today.');
        return;
      }
    }

    setIsValidating(true);
    showLoading(
      hasExistingMeter
        ? 'Provisioning Consumer Profile...'
        : scheduleOption === 'now'
          ? 'Submitting Registration & Installation Request...'
          : 'Provisioning Registration Application...',
      'Validating details with Tagoloan Water District registry'
    );

    setTimeout(() => {
      const users = mockDb.getUsers();
      const existingUser = users.find((u) => (u.email || '').toLowerCase() === email.trim().toLowerCase());
      if (existingUser) {
        hideLoading();
        setError('An account with this email address already exists. Please log in or use a different email.');
        setIsValidating(false);
        return;
      }

      const duplicatePhoneCheck = detectExistingPhoneAccount(cleanPhone);
      if (duplicatePhoneCheck) {
        hideLoading();
        setError(`Mobile number "${cleanPhone}" is already registered to existing account "${duplicatePhoneCheck.name}". Duplicate phone numbers are strictly not allowed.`);
        setIsValidating(false);
        return;
      }

      const matchedBarangay = mockDb.findOrCreateBarangay(barangay);
      const fullAddress = `${sitioZone.trim()}, ${matchedBarangay.name}, Tagoloan, Misamis Oriental`;
      const consumers = mockDb.getConsumers();

      const officialName = fullName.trim();
      const normalizedEmail = email.trim().toLowerCase();
      const emailDocKey = `email_${normalizedEmail.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const newUserId = `user-${Date.now()}`;

      const initialUserStatus: User['status'] = hasExistingMeter
        ? 'pending_approval'
        : scheduleOption === 'now'
          ? 'pending_installation'
          : 'installation_not_scheduled';

      const initialConsumerStatus: Consumer['status'] = hasExistingMeter
        ? 'pending_approval'
        : scheduleOption === 'now'
          ? 'pending_installation'
          : 'installation_not_scheduled';

      const appNumber = hasExistingMeter ? undefined : previewApplicationNumber;

      const newUser: User = {
        id: newUserId,
        email: normalizedEmail,
        name: officialName,
        role: 'consumer',
        status: initialUserStatus,
        contactNumber: cleanPhone,
        password: password,
        registrationDate: new Date().toISOString().split('T')[0],
      };

      const newConsumer: Consumer = {
        id: newUserId,
        accountNumber: '',
        name: officialName,
        address: fullAddress,
        barangayId: matchedBarangay.id,
        barangay: matchedBarangay.name,
        sitioZone: sitioZone.trim(),
        contactNumber: cleanPhone,
        email: normalizedEmail,
        meterNumber: '',
        rfidTag: '',
        status: initialConsumerStatus,
        applicationNumber: appNumber,
        hasExistingMeter: hasExistingMeter,
        accountValidationStatus: hasExistingMeter ? undefined : 'pending_installation',
        isRegistered: true,
        registrationDate: new Date().toISOString().split('T')[0],
        createdAt: Date.now(),
        linkedUserId: newUserId,
        consumerType: consumerType,
        outstandingBalance: 0,
      };

      mockDb.saveUsers([newUser, ...users]);
      mockDb.saveConsumers([newConsumer, ...consumers]);

      let createdRequestId: string | undefined;
      if (!hasExistingMeter && scheduleOption === 'now' && appNumber) {
        const createdReq = mockDb.createInstallationRequest({
          applicationNumber: appNumber,
          consumerId: newUserId,
          linkedUserId: newUserId,
          consumerName: officialName,
          consumerEmail: normalizedEmail,
          contactNumber: cleanPhone,
          address: fullAddress,
          barangay: matchedBarangay.name,
          barangayId: matchedBarangay.id,
          sitioZone: sitioZone.trim(),
          consumerType: consumerType,
          preferredInstallationDate: preferredInstallationDate,
          consumerRemarks: installationRemarks.trim(),
        });
        createdRequestId = createdReq.id;
        newConsumer.installationRequestId = createdReq.id;
        newConsumer.installationStatus = 'Pending Review';
        sendRealtimeMessage('INSTALLATION_REQUEST_SUBMITTED', { request: createdReq });
      } else if (!hasExistingMeter && scheduleOption === 'later' && appNumber) {
        mockDb.addAuditLog(
          newUserId,
          officialName,
          'consumer',
          'Customer Portal Self-Registration (Installation Not Scheduled)',
          `Registered without an installed water meter (Application #${appNumber}) in Barangay ${matchedBarangay.name}, ${sitioZone.trim()}. Status: INSTALLATION NOT SCHEDULED.`
        );
        mockDb.addNotification({
          accountNumber: 'PENDING',
          consumerId: newUserId,
          userId: newUserId,
          consumerEmail: normalizedEmail,
          consumerName: officialName,
          applicationNumber: appNumber,
          subject: 'Registration Completed — Water Meter Installation Recommended',
          title: 'Registration Completed — Water Meter Installation Recommended',
          message: [
            `Dear ${officialName},`,
            `Your registration under Application Number ${appNumber} for ${fullAddress} has been recorded with status: Installation Not Scheduled.`,
            `We recommend scheduling your water meter installation through your Consumer Portal as soon as possible, because your official Account Number and Meter Tag Number will only be issued after physical meter installation and administrative validation are completed.`,
            `Thank you.`,
            `Tagoloan Water District`,
          ].join('\n\n'),
          type: 'installation',
          sentByAdmin: 'Tagoloan Water District',
          isFromAdmin: true,
        });
      } else {
        mockDb.addAuditLog(
          newUserId,
          officialName,
          'consumer',
          'Customer Portal Self-Registration',
          `Submitted application for existing water connection in Barangay ${matchedBarangay.name}, ${sitioZone.trim()}. Status: PENDING ADMIN ISSUANCE. Classification: ${consumerType}.`
        );
        mockDb.addNotification({
          accountNumber: 'PENDING',
          userId: newUserId,
          consumerEmail: normalizedEmail,
          consumerName: officialName,
          title: 'Registration Application Submitted',
          message: `Your registration application for Barangay ${matchedBarangay.name}, ${sitioZone.trim()} has been submitted. The administration office will verify your existing meter and issue your official Account Number and Meter Tag Number shortly.`,
          type: 'account_issue',
        });
      }

      // Direct guaranteed write to Cloud Firestore collections
      syncDocToFirestore(COLLECTIONS.USERS, newUserId, newUser, true);
      syncDocToFirestore(COLLECTIONS.USERS, emailDocKey, newUser, true);
      syncDocToFirestore(COLLECTIONS.CONSUMERS, newUserId, newConsumer, true);
      syncDocToFirestore(COLLECTIONS.CONSUMERS, emailDocKey, newConsumer, true);

      // Submit to backend server for cross-device visibility
      fetch('/api/consumers/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: officialName,
          fullName: officialName,
          email: normalizedEmail,
          contactNumber: cleanPhone,
          address: fullAddress,
          barangay: matchedBarangay.name,
          barangayId: matchedBarangay.id,
          sitioZone: sitioZone.trim(),
          consumerType: consumerType,
          linkedUserId: newUserId,
          password: password,
          status: initialConsumerStatus,
          applicationNumber: appNumber,
          hasExistingMeter: hasExistingMeter,
          installationRequestId: createdRequestId,
          installationStatus: createdRequestId ? 'Pending Review' : undefined,
          accountValidationStatus: hasExistingMeter ? undefined : 'pending_installation',
        }),
      }).catch((err) => {
        console.warn('[Registration] Backend sync warning:', err);
      });

      // Update barangay consumer count
      const allBarangays = mockDb.getBarangays();
      const updatedBarangays = allBarangays.map((b) => {
        if (b.id === matchedBarangay.id) {
          return {
            ...b,
            consumers: (b.consumers || 0) + 1,
          };
        }
        return b;
      });
      mockDb.saveBarangays(updatedBarangays);

      const displayStatus = hasExistingMeter
        ? 'Pending Admin Issuance'
        : scheduleOption === 'now'
          ? 'Pending Installation'
          : 'Installation Not Scheduled';

      setRegisteredSummary({
        accountNumber: hasExistingMeter
          ? 'Pending Admin Issuance'
          : 'Issued After Meter Installation & Validation',
        applicationNumber: appNumber,
        fullName: officialName,
        email: email.trim(),
        contactNumber: cleanPhone,
        barangayName: matchedBarangay.name,
        barangayId: matchedBarangay.id,
        sitioZone: sitioZone.trim(),
        fullAddress: fullAddress,
        consumerType: consumerType,
        hasExistingMeter: hasExistingMeter,
        scheduleOption: hasExistingMeter ? undefined : scheduleOption,
        preferredInstallationDate: !hasExistingMeter && scheduleOption === 'now' ? preferredInstallationDate : undefined,
        installationRemarks: !hasExistingMeter && scheduleOption === 'now' ? installationRemarks.trim() : undefined,
        status: displayStatus,
      });

      hideLoading();
      setIsValidating(false);
      setIsSuccessModal(true);

      if (!hasExistingMeter && scheduleOption === 'now') {
        toast.success(
          'Installation Request Received',
          `Application ${appNumber} submitted! Preferred date: ${formatInstallationDateDisplay(preferredInstallationDate)}.`
        );
      } else if (!hasExistingMeter && scheduleOption === 'later') {
        toast.info(
          'Registration Completed',
          `Application ${appNumber} saved as Installation Not Scheduled. You can schedule installation anytime in your portal.`
        );
      } else {
        toast.success('Registration Submitted', `Application received for ${officialName}! Awaiting Admin account issuance.`);
      }
    }, 800);
  };

  const computedPreviewAddress = sitioZone.trim() && barangay.trim()
    ? `${sitioZone.trim()}, ${barangay.trim()}, Tagoloan, Misamis Oriental`
    : barangay.trim()
      ? `${barangay.trim()}, Tagoloan, Misamis Oriental`
      : 'Complete Barangay & Sitio/Zone above';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-3 sm:p-4 text-slate-100 relative">
      {/* Dynamic Background Image */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <img
          src="https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg"
          alt="Tagoloan Water District Background"
          referrerPolicy="no-referrer"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w2000';
          }}
          className="w-full h-full object-cover object-center filter brightness-[0.25] contrast-[1.1] scale-105"
        />
        <div className="absolute inset-0 bg-slate-950/80"></div>
      </div>

      <div className="w-full max-w-2xl space-y-3 z-10 my-4">
        {/* Top bar back button */}
        <div className="flex items-center justify-between">
          <button
            onClick={onBackToHome}
            className="inline-flex items-center space-x-1.5 text-slate-300 hover:text-white text-xs font-bold transition px-3 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800 hover:border-slate-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-blue-400" />
            <span>Return to Homepage</span>
          </button>

          <button
            onClick={onNavigateToLogin}
            className="text-xs text-blue-400 font-bold hover:underline cursor-pointer whitespace-nowrap shrink-0"
          >
            Already have an account? Login
          </button>
        </div>

        {!isSuccessModal ? (
          <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 shadow-2xl rounded-3xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-900/80 via-slate-900 to-indigo-900/80 p-5 sm:p-6 text-center border-b border-slate-800">
              <div className="inline-flex p-2.5 bg-blue-500/10 rounded-2xl mb-2 text-blue-400 border border-blue-500/20">
                <UserCheck className="h-6 w-6" />
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Consumer Account Registration
              </h1>
              <p className="text-xs text-slate-300 mt-1 max-w-lg mx-auto">
                Register your Tagoloan water service application, schedule a new water meter installation if needed, and manage your account online.
              </p>
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Account Holder Name */}
                  <div className="space-y-1 text-left sm:col-span-2">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">
                      Full Account Holder Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Juan Dela Cruz"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Contact Number */}
                  <div className="space-y-1 text-left">
                    <div className="flex items-center justify-between">
                      <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">
                        Mobile Number (11 Digits) <span className="text-red-400">*</span>
                      </label>
                      <span
                        className={`text-[9px] font-mono tabular-nums font-bold px-1.5 py-0.5 rounded ${
                          contactNumber.length === 11
                            ? phoneDuplicateInfo?.detected
                              ? 'bg-rose-900/60 text-rose-300 border border-rose-700/60'
                              : 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                            : contactNumber.length > 0
                              ? 'bg-amber-900/40 text-amber-300 border border-amber-700/40'
                              : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {contactNumber.length}/11 digits
                      </span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400">
                        <Phone className="h-3.5 w-3.5" />
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]{11}"
                        maxLength={11}
                        required
                        placeholder="09XXXXXXXXX (11 digits)"
                        value={contactNumber}
                        onChange={handleContactNumberChange}
                        className={`w-full rounded-xl py-2 pl-9 pr-3 text-xs placeholder-slate-500 focus:outline-none transition-all font-mono tabular-nums font-semibold ${
                          phoneDuplicateInfo?.detected
                            ? 'bg-rose-950/40 border-2 border-rose-500 ring-2 ring-rose-500/20 text-rose-100'
                            : contactNumber.length === 11
                              ? 'bg-emerald-950/30 border-2 border-emerald-500 ring-2 ring-emerald-500/20 text-emerald-100'
                              : 'bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-200'
                        }`}
                      />
                    </div>
                    {phoneDuplicateInfo?.detected ? (
                      <div className="flex items-start space-x-1.5 p-2 bg-rose-950/80 border border-rose-500/70 rounded-lg text-rose-200 text-[10px] leading-tight mt-1">
                        <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="font-black text-rose-100">Duplicate Number Detected:</strong> This mobile number is already connected to existing account{' '}
                          <span className="underline font-bold text-white">"{phoneDuplicateInfo.accountHolder || 'Registered Account'}"</span>.
                        </div>
                      </div>
                    ) : contactNumber.length === 11 ? (
                      <p className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium mt-1">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        <span>11-digit mobile number verified unique in district records.</span>
                      </p>
                    ) : (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Allowed only 11 digits starting with 09 (e.g. 09171234567).
                      </p>
                    )}
                  </div>

                  {/* Email */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">
                      Email Address <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="e.g. juan@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Barangay Select */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">
                      Barangay <span className="text-red-400">*</span>
                    </label>
                    <select
                      required
                      value={barangay}
                      onChange={(e) => setBarangay(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="">-- Select Registered Barangay --</option>
                      {availableBarangays.map((b) => (
                        <option key={b.id} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Sitio / Zone */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">
                      Sitio / Zone / Street <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Zone 4, Sitio Riverside"
                      value={sitioZone}
                      onChange={(e) => setSitioZone(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Password */}
                  <div className="space-y-1 text-left sm:col-span-1">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">
                      Portal Password <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400">
                        <Lock className="h-3.5 w-3.5" />
                      </span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        placeholder="Choose a strong password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 pl-9 pr-10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition cursor-pointer p-0.5 focus:outline-none"
                        title={showPassword ? 'Hide password' : 'Show password'}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Re-enter Password */}
                  <div className="space-y-1 text-left sm:col-span-1">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">
                      Re-enter Password <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <span
                        className={`absolute left-3 top-2.5 transition-colors ${
                          confirmPassword.length > 0
                            ? confirmPassword === password
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </span>
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        placeholder="Re-enter password to match"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`w-full rounded-xl py-2 pl-9 pr-10 text-xs placeholder-slate-500 focus:outline-none transition-all ${
                          confirmPassword.length > 0
                            ? confirmPassword === password
                              ? 'bg-emerald-950/20 border-2 border-emerald-500 ring-2 ring-emerald-500/20 text-emerald-100'
                              : 'bg-rose-950/20 border-2 border-rose-500 ring-2 ring-rose-500/20 text-rose-100'
                            : 'bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-200'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition cursor-pointer p-0.5 focus:outline-none"
                        title={showConfirmPassword ? 'Hide password' : 'Show password'}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    {confirmPassword.length > 0 && (
                      <div>
                        {confirmPassword === password ? (
                          <div className="flex items-center space-x-1.5 text-[11px] font-bold text-emerald-400 pt-0.5">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>Passwords match</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1.5 text-[11px] font-bold text-rose-400 pt-0.5">
                            <XCircle className="h-3.5 w-3.5 shrink-0" />
                            <span>Passwords do not match</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Classification Info */}
                  <div className="sm:col-span-2 space-y-2 pt-2 border-t border-slate-800">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider text-left">
                      Connection Classification
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setConsumerType('Residential')}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer whitespace-nowrap ${
                          consumerType === 'Residential'
                            ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <Waves className="h-3.5 w-3.5 shrink-0" />
                        <span>Residential</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConsumerType('Commercial')}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer whitespace-nowrap ${
                          consumerType === 'Commercial'
                            ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <Briefcase className="h-3.5 w-3.5 shrink-0" />
                        <span>Commercial</span>
                      </button>
                    </div>
                  </div>

                  {/* Water Meter Status Question */}
                  <div className="sm:col-span-2 space-y-3 pt-3 border-t border-slate-800 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-[10px] font-black text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Gauge className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                        <span>Do you already have an installed water meter at your premises?</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setHasExistingMeter(false)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                          !hasExistingMeter
                            ? 'bg-sky-600/15 border-sky-500 text-white shadow-sm'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-sky-300">No — New Meter Needed</span>
                          <Wrench className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                          I do not have an installed water meter yet and need Tagoloan Water District installation.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setHasExistingMeter(true)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                          hasExistingMeter
                            ? 'bg-emerald-600/15 border-emerald-500 text-white shadow-sm'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-emerald-300">Yes — Existing Water Meter</span>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                          A Tagoloan Water District meter is already physically installed at my service address.
                        </p>
                      </button>
                    </div>

                    {/* Conditional Installation Scheduling Question when Consumer has NO water meter yet */}
                    {!hasExistingMeter && (
                      <div className="rounded-2xl bg-slate-950/90 border border-slate-800 p-3.5 sm:p-4 space-y-3.5">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                          <div>
                            <p className="text-xs font-black text-white">
                              Would you like to schedule a water meter installation?
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Select whether to request an installation date now or complete registration and schedule later.
                            </p>
                          </div>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[10px] font-mono tabular-nums font-bold text-sky-300 whitespace-nowrap shrink-0">
                            App #: {previewApplicationNumber}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            onClick={() => setScheduleOption('now')}
                            className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                              scheduleOption === 'now'
                                ? 'bg-blue-600/20 border-blue-500 text-white'
                                : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-black text-blue-300">Schedule Installation Now</span>
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 whitespace-nowrap">
                                Recommended
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-300 mt-1 leading-snug">
                              Submit an installation request immediately and choose your preferred installation date.
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={() => setScheduleOption('later')}
                            className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                              scheduleOption === 'later'
                                ? 'bg-amber-600/15 border-amber-500 text-white'
                                : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-black text-amber-300">Schedule Later</span>
                              <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            </div>
                            <p className="text-[10px] text-slate-300 mt-1 leading-snug">
                              Complete registration now with status "Installation Not Scheduled" and request a schedule later.
                            </p>
                          </button>
                        </div>

                        {scheduleOption === 'now' ? (
                          <div className="space-y-3 pt-1 border-t border-slate-800/80">
                            {/* Summary of Auto-Captured Installation Application Details */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 text-[11px]">
                              <div>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                                  Consumer Name
                                </span>
                                <span className="font-semibold text-slate-200 truncate block">
                                  {fullName.trim() || 'Enter Full Name above'}
                                </span>
                              </div>
                              <div>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                                  Registration / Application No.
                                </span>
                                <span className="font-mono tabular-nums font-bold text-sky-400 block">
                                  {previewApplicationNumber}
                                </span>
                              </div>
                              <div>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                                  Contact Number
                                </span>
                                <span className="font-mono tabular-nums font-semibold text-slate-200 block">
                                  {contactNumber || 'Enter 11-digit mobile above'}
                                </span>
                              </div>
                              <div>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                                  Service Address & Barangay
                                </span>
                                <span className="font-medium text-slate-200 truncate block">
                                  {computedPreviewAddress}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1">
                                  <Calendar className="h-3 w-3 text-sky-400 shrink-0" />
                                  <span>
                                    Preferred Installation Date <span className="text-red-400">*</span>
                                  </span>
                                </label>
                                <input
                                  type="date"
                                  required={!hasExistingMeter && scheduleOption === 'now'}
                                  min={minSelectableDate}
                                  value={preferredInstallationDate}
                                  onChange={(e) => setPreferredInstallationDate(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs font-mono tabular-nums text-slate-100 focus:outline-none"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1">
                                  <FileText className="h-3 w-3 text-sky-400 shrink-0" />
                                  <span>Initial Application Status</span>
                                </label>
                                <div className="w-full bg-slate-900/70 border border-slate-800 rounded-xl py-2 px-3 text-xs font-bold text-sky-300 flex items-center justify-between">
                                  <span>Pending Installation</span>
                                  <span className="text-[9px] font-mono uppercase text-slate-400">Auto-Tracked</span>
                                </div>
                              </div>

                              <div className="sm:col-span-2 space-y-1">
                                <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">
                                  Additional Remarks or Installation Instructions (Optional)
                                </label>
                                <textarea
                                  rows={2}
                                  value={installationRemarks}
                                  onChange={(e) => setInstallationRemarks(e.target.value)}
                                  placeholder="e.g. Gate landmark near barangay chapel, preferred morning inspection, contact person on site..."
                                  className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none resize-none"
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl bg-amber-950/40 border border-amber-700/50 p-3 flex items-start gap-2.5 text-amber-200 text-[11px] leading-relaxed">
                            <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-amber-100">
                                Recommendation: Schedule Your Water Meter Installation Soon
                              </p>
                              <p className="text-amber-200/90 mt-0.5">
                                Your registration will be saved as <strong>Installation Not Scheduled</strong> under Application{' '}
                                <span className="font-mono tabular-nums font-bold">{previewApplicationNumber}</span>. Please note that your official{' '}
                                <strong>Account Number</strong> and <strong>Meter Tag Number</strong> will only be issued after physical water meter installation and administrative validation are completed. You may submit an installation schedule anytime from your Consumer Portal.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Error Alert Box */}
                {error && (
                  <div className="bg-rose-500/15 border border-rose-500/40 text-rose-300 p-2.5 rounded-xl text-xs flex items-start space-x-2 text-left">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                    <span className="font-semibold">{error}</span>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isValidating}
                  className="w-full py-2.5 text-white font-black rounded-xl text-xs uppercase tracking-widest transition shadow-lg flex items-center justify-center space-x-2 cursor-pointer mt-2 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 shadow-blue-600/30 border border-blue-400/30 whitespace-nowrap"
                >
                  {isValidating ? (
                    <span>Syncing with District Database...</span>
                  ) : !hasExistingMeter && scheduleOption === 'now' ? (
                    <span>Complete Registration & Submit Installation Request</span>
                  ) : (
                    <span>Complete Registration</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* Confirmation & Registration Summary Modal */
          <div className="bg-slate-900 p-6 sm:p-8 text-center space-y-4 max-w-lg mx-auto rounded-3xl border border-slate-800 shadow-2xl">
            <div className="flex items-center justify-center space-x-3 mb-2">
              <div
                className={`h-14 w-14 rounded-2xl border flex items-center justify-center shadow-lg ${
                  registeredSummary?.scheduleOption === 'now'
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                }`}
              >
                {registeredSummary?.scheduleOption === 'now' ? (
                  <CheckCircle2 className="h-8 w-8" />
                ) : (
                  <Clock className="h-8 w-8" />
                )}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-black text-white">
                {registeredSummary?.scheduleOption === 'now'
                  ? 'Registration & Installation Request Received!'
                  : 'Registration Application Submitted!'}
              </h2>
              <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                {registeredSummary?.scheduleOption === 'now' ? (
                  <>
                    We have successfully received the water meter installation request for{' '}
                    <strong className="text-white">{registeredSummary.fullName}</strong>. Tagoloan Water District staff will review and confirm your schedule, and you will receive updates in your Consumer Portal.
                  </>
                ) : registeredSummary?.scheduleOption === 'later' ? (
                  <>
                    Your account registration for <strong className="text-white">{registeredSummary.fullName}</strong> is saved as{' '}
                    <strong className="text-amber-300">Installation Not Scheduled</strong>. You can schedule your water meter installation anytime after logging into the Consumer Portal.
                  </>
                ) : (
                  <>
                    Your application for <strong className="text-white font-bold">{registeredSummary?.fullName}</strong> has been received by Tagoloan Water District and submitted to the Administrator Portal.
                  </>
                )}
              </p>
            </div>

            <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 text-left space-y-2 text-xs">
              {registeredSummary?.applicationNumber && (
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-400">Registration / Application No.:</span>
                  <span className="font-mono tabular-nums font-bold text-sky-300 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/50 text-[11px]">
                    {registeredSummary.applicationNumber}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center gap-2">
                <span className="text-slate-400">Consumer Name:</span>
                <span className="font-bold text-slate-200">{registeredSummary?.fullName}</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-slate-400">Contact Number:</span>
                <span className="font-mono tabular-nums text-slate-200">{registeredSummary?.contactNumber}</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="text-slate-400 shrink-0">Address & Barangay:</span>
                <span className="font-medium text-slate-200 text-right">{registeredSummary?.fullAddress}</span>
              </div>
              {registeredSummary?.preferredInstallationDate && (
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-400">Preferred Installation Date:</span>
                  <span className="font-mono tabular-nums font-bold text-emerald-300">
                    {formatInstallationDateDisplay(registeredSummary.preferredInstallationDate)}
                  </span>
                </div>
              )}
              {registeredSummary?.installationRemarks && (
                <div className="pt-1 border-t border-slate-800/60">
                  <span className="text-slate-400 block text-[11px]">Installation Instructions / Remarks:</span>
                  <span className="text-slate-300 text-[11px]">{registeredSummary.installationRemarks}</span>
                </div>
              )}
              <div className="flex justify-between items-center gap-2 pt-1.5 border-t border-slate-800/60">
                <span className="text-slate-400">Account & Meter Tag Issuance:</span>
                <span className="font-mono text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40 text-[10px] font-bold">
                  {registeredSummary?.accountNumber}
                </span>
              </div>
              <div className="flex justify-between items-center gap-2 border-t border-slate-800/60 pt-1.5">
                <span className="text-slate-400">Registration Status:</span>
                <span className="font-bold text-sky-400 uppercase text-[10px]">{registeredSummary?.status}</span>
              </div>
            </div>

            {!registeredSummary?.hasExistingMeter && (
              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 text-left text-[11px] text-slate-300 leading-relaxed">
                <strong className="text-sky-300">Important Note:</strong> Official <strong>Account Number</strong> and{' '}
                <strong>Meter Tag Number</strong> are issued strictly after physical water meter installation is completed and verified by the Tagoloan Water District administrator.
              </div>
            )}

            <button
              onClick={onNavigateToLogin}
              className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 text-white font-black rounded-xl text-xs uppercase tracking-widest transition cursor-pointer shadow-lg shadow-blue-600/30 whitespace-nowrap"
            >
              Proceed to Consumer Portal Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


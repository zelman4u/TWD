/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { UserCheck, AlertCircle, CheckCircle, ArrowLeft, Waves, Briefcase, Clock } from 'lucide-react';
import { mockDb } from '../mockDb';
import { User, Consumer, Barangay } from '../types';
import { useLoading } from '../context/LoadingContext';
import { useToast } from '../context/ToastContext';

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
  const [barangay, setBarangay] = useState('');
  const [sitioZone, setSitioZone] = useState('');
  const [password, setPassword] = useState('');
  
  // Available Barangays loaded from DB
  const [availableBarangays, setAvailableBarangays] = useState<Barangay[]>([]);
  
  // Consumer Classification State
  const [consumerType, setConsumerType] = useState<'Residential' | 'Commercial'>('Residential');
  const [meterSize, setMeterSize] = useState('1/2 inch');
  const [householdInfo, setHouseholdInfo] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  
  // Logic State
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSuccessModal, setIsSuccessModal] = useState(false);
  const [registeredSummary, setRegisteredSummary] = useState<{
    accountNumber: string;
    fullName: string;
    email: string;
    barangayName: string;
    barangayId?: string;
    sitioZone?: string;
    fullAddress?: string;
    consumerType?: string;
    meterSize?: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    const list = mockDb.getBarangays();
    setAvailableBarangays(list);
  }, []);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // CONSUMER REGISTRATION FLOW
    if (!barangay || barangay.trim() === '') {
      setError('Barangay selection is mandatory. Please select your registered Barangay from the list.');
      return;
    }

    if (!sitioZone || sitioZone.trim() === '') {
      setError('Sitio / Zone is mandatory. Please enter your Sitio or Zone.');
      return;
    }

    setIsValidating(true);
    showLoading('Provisioning Consumer Profile...', 'Validating details with Tagoloan municipal water registry');

    setTimeout(() => {
      // 1. Check if email already registered
      const users = mockDb.getUsers();
      const existingUser = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
      if (existingUser) {
        hideLoading();
        setError('An account with this email address already exists. Please log in or use a different email.');
        setIsValidating(false);
        return;
      }

      // 2. Auto-match or create Barangay in Admin Database
      const matchedBarangay = mockDb.findOrCreateBarangay(barangay);
      const fullAddress = `${sitioZone.trim()}, ${matchedBarangay.name}, Tagoloan, Misamis Oriental`;

      const consumers = mockDb.getConsumers();
      
      // 3. Consumer registers WITHOUT official account or meter identifiers (issued exclusively by Admin)
      const officialName = fullName.trim();
      const tempId = `PENDING-${Date.now().toString().slice(-6)}`;

      const newUserId = `user-${Date.now()}`;
      const newUser: User = {
        id: newUserId,
        email: email.trim(),
        name: officialName,
        role: 'consumer',
        status: 'pending_approval',
        password: password,
      };

      const newConsumer: Consumer = {
        accountNumber: '',
        name: officialName,
        address: fullAddress,
        barangayId: matchedBarangay.id,
        barangay: matchedBarangay.name,
        sitioZone: sitioZone.trim(),
        contactNumber: contactNumber.trim(),
        email: email.trim(),
        meterNumber: '',
        status: 'pending_approval',
        isRegistered: true,
        registrationDate: new Date().toISOString().split('T')[0],
        linkedUserId: newUserId,
        consumerType: consumerType,
        meterSize: meterSize,
        householdInfo: consumerType === 'Residential' ? householdInfo.trim() : undefined,
        businessName: consumerType === 'Commercial' ? businessName.trim() : undefined,
        businessType: consumerType === 'Commercial' ? businessType.trim() : undefined,
        outstandingBalance: 0
      };

      mockDb.saveUsers([...users, newUser]);
      mockDb.saveConsumers([...consumers, newConsumer]);

      // Submit to backend server to ensure instant visibility across all admin devices
      fetch('/api/consumers/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: officialName,
          fullName: officialName,
          email: email.trim(),
          contactNumber: contactNumber.trim(),
          address: fullAddress,
          barangay: matchedBarangay.name,
          barangayId: matchedBarangay.id,
          sitioZone: sitioZone.trim(),
          consumerType: consumerType,
          meterSize: meterSize,
          householdInfo: consumerType === 'Residential' ? householdInfo.trim() : undefined,
          businessName: consumerType === 'Commercial' ? businessName.trim() : undefined,
          businessType: consumerType === 'Commercial' ? businessType.trim() : undefined,
          linkedUserId: newUserId
        })
      }).catch(err => {
        console.warn('[Registration] Backend sync warning:', err);
      });

      // 4. Update barangay consumer count
      const allBarangays = mockDb.getBarangays();
      const updatedBarangays = allBarangays.map(b => {
        if (b.id === matchedBarangay.id) {
          return {
            ...b,
            consumers: (b.consumers || 0) + 1
          };
        }
        return b;
      });
      mockDb.saveBarangays(updatedBarangays);

      // Log in audit trail
      mockDb.addAuditLog(
        newUserId,
        officialName,
        'consumer',
        'Customer Portal Self-Registration',
        `Submitted application for water connection in Barangay ${matchedBarangay.name} (${matchedBarangay.id}), ${sitioZone.trim()}. Status: PENDING ADMIN ISSUANCE. Classification: ${consumerType} (${meterSize}). Awaiting administrator account and meter tag assignment.`
      );

      // Add Welcome Notification
      mockDb.addNotification({
        accountNumber: '',
        title: `Registration Application Submitted`,
        message: `Your registration application for Barangay ${matchedBarangay.name} (${matchedBarangay.id}), ${sitioZone.trim()} has been submitted. The administration office will review and issue your official Account Number and Meter Tag shortly.`,
        type: 'announcement'
      });

      setRegisteredSummary({
        accountNumber: 'Pending Admin Issuance',
        fullName: officialName,
        email: email.trim(),
        barangayName: matchedBarangay.name,
        barangayId: matchedBarangay.id,
        sitioZone: sitioZone.trim(),
        fullAddress: fullAddress,
        consumerType: consumerType,
        meterSize: meterSize,
        status: 'Pending Admin Issuance'
      });

      hideLoading();
      setIsValidating(false);
      setIsSuccessModal(true);
      toast.success('Registration Submitted', `Application received for ${officialName}! Awaiting Admin account issuance.`);
    }, 800);
  };

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

      <div className="w-full max-w-xl space-y-3 z-10 my-4">
        {/* Top bar back button */}
        <div className="flex items-center justify-between">
          <button 
            onClick={onBackToHome}
            className="inline-flex items-center space-x-1.5 text-slate-300 hover:text-white text-xs font-bold transition px-3 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800 hover:border-slate-700 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-blue-400" />
            <span>Return to Homepage</span>
          </button>
          
          <button 
            onClick={onNavigateToLogin}
            className="text-xs text-blue-400 font-bold hover:underline cursor-pointer"
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
              <p className="text-xs text-slate-300 mt-1 max-w-md mx-auto">
                Register your Tagoloan water connection to view billing records, consumption history, and manage water district services online.
              </p>
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <form onSubmit={handleRegister} className="space-y-4">
                {/* CONSUMER REGISTRATION FIELDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  
                  {/* Account Holder Name */}
                  <div className="space-y-1 text-left sm:col-span-2">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Full Account Holder Name <span className="text-red-400">*</span></label>
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
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Mobile Number <span className="text-red-400">*</span></label>
                    <input 
                      type="tel" 
                      required 
                      placeholder="e.g. 09171234567"
                      value={contactNumber}
                      onChange={(e) => setContactNumber(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Email Address <span className="text-red-400">*</span></label>
                    <input 
                      type="email" 
                      required 
                      placeholder="e.g. juan@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Barangay Select Dropdown */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Barangay (Tagoloan) <span className="text-red-400">*</span></label>
                    <select
                      required
                      value={barangay}
                      onChange={(e) => setBarangay(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="">-- Select Registered Barangay --</option>
                      {availableBarangays.map((b) => (
                        <option key={b.id} value={b.name}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Sitio / Zone */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Sitio / Zone <span className="text-red-400">*</span></label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Zone 2 or Sitio Centro"
                      value={sitioZone}
                      onChange={(e) => setSitioZone(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Password */}
                  <div className="space-y-1 text-left sm:col-span-2">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Portal Access Password <span className="text-red-400">*</span></label>
                    <input 
                      type="password" 
                      required
                      placeholder="Create strong account password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Consumer Classification Box */}
                  <div className="sm:col-span-2 bg-slate-950/60 p-3 rounded-2xl border border-slate-800 space-y-2 text-left">
                    <span className="block text-[9px] font-black text-blue-400 uppercase tracking-wider">Water Service Classification</span>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setConsumerType('Residential')}
                        className={`py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 border cursor-pointer ${
                          consumerType === 'Residential'
                            ? 'bg-blue-600/20 border-blue-500 text-blue-400 shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <Waves className="h-3.5 w-3.5 shrink-0" />
                        <span>Residential</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConsumerType('Commercial')}
                        className={`py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 border cursor-pointer ${
                          consumerType === 'Commercial'
                            ? 'bg-purple-600/20 border-purple-500 text-purple-400 shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <Briefcase className="h-3.5 w-3.5 shrink-0" />
                        <span>Commercial</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                      <div className="space-y-1">
                        <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">Meter Pipe Size <span className="text-red-400">*</span></label>
                        <select
                          value={meterSize}
                          onChange={(e) => setMeterSize(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-1.5 px-2.5 text-xs text-slate-200 focus:outline-none"
                        >
                          <option value="1/2 inch">1/2 inch (Standard Domestic)</option>
                          <option value="3/4 inch">3/4 inch (High Flow / Commercial)</option>
                          <option value="1 inch">1 inch (Industrial / Bulk)</option>
                        </select>
                      </div>

                      {consumerType === 'Residential' ? (
                        <div className="space-y-1">
                          <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">Household Size</label>
                          <input
                            type="text"
                            placeholder="e.g. 4 family members"
                            value={householdInfo}
                            onChange={(e) => setHouseholdInfo(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-1.5 px-2.5 text-xs text-slate-200 focus:outline-none"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="space-y-1">
                            <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">Business Name <span className="text-red-400">*</span></label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. Tagoloan Enterprise"
                              value={businessName}
                              onChange={(e) => setBusinessName(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-1.5 px-2.5 text-xs text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">Business Type <span className="text-red-400">*</span></label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. Restaurant, Retail Store, Hotel"
                              value={businessType}
                              onChange={(e) => setBusinessType(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-1.5 px-2.5 text-xs text-slate-200 focus:outline-none"
                            />
                          </div>
                        </>
                      )}
                    </div>
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
                  className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 disabled:opacity-60 text-white font-black rounded-xl text-xs uppercase tracking-widest transition shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 cursor-pointer border border-blue-400/30 mt-2"
                >
                  {isValidating ? (
                    <span>Syncing with District Database...</span>
                  ) : (
                    <span>Complete Registration</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* Success Modal */
          <div className="bg-slate-900 p-6 sm:p-8 text-center space-y-4 max-w-lg mx-auto rounded-3xl border border-slate-800 shadow-2xl">
            <div className="flex items-center justify-center space-x-3 mb-2">
              <div className="h-14 w-14 rounded-2xl border flex items-center justify-center shadow-lg bg-amber-500/15 text-amber-400 border-amber-500/30">
                <Clock className="h-8 w-8 animate-pulse" />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-black text-white">
                Application Submitted!
              </h2>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Your profile for <strong className="text-white font-bold">{registeredSummary?.fullName}</strong> has been received by Tagoloan Water District. Your official <span className="text-amber-400 font-bold">Account Number</span> and <span className="text-amber-400 font-bold">Meter Tag</span> will be assigned by the Administrator.
              </p>
            </div>

            <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 text-left space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Applicant Name:</span>
                <span className="font-bold text-slate-300">{registeredSummary?.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Account Number:</span>
                <span className="font-mono font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40 text-[11px]">
                  Pending Admin Issuance
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Barangay:</span>
                <span className="font-bold text-orange-400">{registeredSummary?.barangayName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sitio / Zone:</span>
                <span className="font-medium text-slate-300">{registeredSummary?.sitioZone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Registered Email:</span>
                <span className="font-mono text-slate-300">{registeredSummary?.email}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800/60 pt-1.5">
                <span className="text-slate-500">Application Status:</span>
                <span className="font-bold text-amber-400 uppercase text-[10px]">Awaiting Admin Approval</span>
              </div>
            </div>

            <button
              onClick={onNavigateToLogin}
              className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 text-white font-black rounded-xl text-xs uppercase tracking-widest transition cursor-pointer shadow-lg shadow-blue-600/30"
            >
              Proceed to Portal Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

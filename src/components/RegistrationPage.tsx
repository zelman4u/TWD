/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { UserCheck, AlertCircle, CheckCircle, ArrowLeft, Waves, Briefcase, MapPin } from 'lucide-react';
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
  // Form State
  const [accountNumber, setAccountNumber] = useState('');
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
    barangayId: string;
    sitioZone: string;
    fullAddress: string;
    consumerType: string;
    meterSize: string;
    householdInfo?: string;
    businessName?: string;
    businessType?: string;
  } | null>(null);

  useEffect(() => {
    setAvailableBarangays(mockDb.getBarangays());
  }, []);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!barangay || barangay.trim() === '') {
      setError('Barangay selection is mandatory. Please select your registered Barangay from the list.');
      return;
    }

    if (!sitioZone || sitioZone.trim() === '') {
      setError('Sitio / Zone is mandatory. Please enter your Sitio or Zone.');
      return;
    }

    setIsValidating(true);
    showLoading('Provisioning Consumer Profile...', 'Validating water service account with Tagoloan municipal registry');

    setTimeout(() => {
      // 1. Auto-match or create Barangay in Admin Database
      const matchedBarangay = mockDb.findOrCreateBarangay(barangay);
      const fullAddress = `${sitioZone.trim()}, ${matchedBarangay.name}, Tagoloan, Misamis Oriental`;

      const consumers = mockDb.getConsumers();
      
      // 2. Search if the Account Number exists in master catalog
      const targetConsumer = consumers.find(
        c => c.accountNumber.trim().toUpperCase() === accountNumber.trim().toUpperCase()
      );

      // Validate if already registered
      if (targetConsumer && targetConsumer.isRegistered) {
        hideLoading();
        setError(`Account Number "${accountNumber}" has already been linked to an active web portal user profile. Please proceed to login.`);
        setIsValidating(false);
        return;
      }

      // 3. Create or Link User and Consumer in Database
      const currentUsers = mockDb.getUsers();
      const newUserId = `user-consumer-${Date.now()}`;
      const officialName = targetConsumer ? targetConsumer.name : fullName.trim();
      const officialAccount = accountNumber.trim().toUpperCase();

      const newConsumerUser: User = {
        id: newUserId,
        email: email.trim(),
        name: officialName,
        role: 'consumer',
        linkedAccountNumber: officialAccount,
        status: 'active',
        password: password.trim() || undefined
      };

      let updatedConsumers: Consumer[] = [];

      if (targetConsumer) {
        // Update existing consumer record
        updatedConsumers = consumers.map(c => {
          if (c.accountNumber === targetConsumer.accountNumber) {
            return {
              ...c,
              isRegistered: true,
              registrationDate: new Date().toISOString().split('T')[0],
              email: email.trim(),
              contactNumber: contactNumber.trim() || c.contactNumber,
              address: fullAddress,
              barangayId: matchedBarangay.id,
              barangay: matchedBarangay.name,
              sitioZone: sitioZone.trim(),
              linkedUserId: newUserId,
              consumerType: consumerType,
              meterSize: meterSize,
              householdInfo: consumerType === 'Residential' ? householdInfo : undefined,
              businessName: consumerType === 'Commercial' ? businessName : undefined,
              businessType: consumerType === 'Commercial' ? businessType : undefined,
            };
          }
          return c;
        });
      } else {
        // Automatically create new consumer record in Admin Database
        const generatedMeter = `MT-${Math.floor(1000 + Math.random() * 9000)}`;
        const newConsumerRecord: Consumer = {
          accountNumber: officialAccount,
          name: officialName,
          address: fullAddress,
          barangayId: matchedBarangay.id,
          barangay: matchedBarangay.name,
          sitioZone: sitioZone.trim(),
          contactNumber: contactNumber.trim() || '09000000000',
          email: email.trim(),
          meterNumber: generatedMeter,
          status: 'active',
          isRegistered: true,
          registrationDate: new Date().toISOString().split('T')[0],
          linkedUserId: newUserId,
          consumerType: consumerType,
          meterSize: meterSize,
          householdInfo: consumerType === 'Residential' ? householdInfo : undefined,
          businessName: consumerType === 'Commercial' ? businessName : undefined,
          businessType: consumerType === 'Commercial' ? businessType : undefined,
          outstandingBalance: 0
        };
        updatedConsumers = [...consumers, newConsumerRecord];
      }

      // Save database elements
      mockDb.saveConsumers(updatedConsumers);
      
      const existingUserIdx = currentUsers.findIndex(u => u.email.toLowerCase() === email.trim().toLowerCase());
      if (existingUserIdx >= 0) {
        currentUsers[existingUserIdx] = newConsumerUser;
      } else {
        currentUsers.push(newConsumerUser);
      }
      mockDb.saveUsers(currentUsers);

      // Sync Barangay Count
      const allBarangays = mockDb.getBarangays();
      const updatedBarangays = allBarangays.map(b => {
        if (b.id === matchedBarangay.id) {
          return {
            ...b,
            consumers: (b.consumers || 0) + 1,
            activeMeters: (b.activeMeters || 0) + 1
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
        `Self-registered water account #${officialAccount} in Barangay ${matchedBarangay.name} (${matchedBarangay.id}), ${sitioZone.trim()}. Classification: ${consumerType} (${meterSize}). Location & Barangay ID auto-synced to Admin database.`
      );

      // Add Welcome Notification
      mockDb.addNotification({
        accountNumber: officialAccount,
        title: `Welcome to Tagoloan Water District!`,
        message: `Your account #${officialAccount} has been registered for Barangay ${matchedBarangay.name} (${matchedBarangay.id}), ${sitioZone.trim()}. Live billing and consumption records are now accessible.`,
        type: 'announcement'
      });

      setRegisteredSummary({
        accountNumber: officialAccount,
        fullName: officialName,
        email: email.trim(),
        barangayName: matchedBarangay.name,
        barangayId: matchedBarangay.id,
        sitioZone: sitioZone.trim(),
        fullAddress: fullAddress,
        consumerType: consumerType,
        meterSize: meterSize,
        householdInfo: consumerType === 'Residential' ? householdInfo : undefined,
        businessName: consumerType === 'Commercial' ? businessName : undefined,
        businessType: consumerType === 'Commercial' ? businessType : undefined,
      });

      hideLoading();
      setIsValidating(false);
      setIsSuccessModal(true);
      toast.success('Registration Successful', `Account #${officialAccount} registered for ${officialName}!`);
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
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Consumer Account Registration</h1>
              <p className="text-xs text-slate-300 mt-1 max-w-md mx-auto">
                Register your Tagoloan water connection to view billing records and manage water district services online.
              </p>
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  
                  {/* Account Number */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Account Number <span className="text-red-400">*</span></label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. 1001-A or 2001-X"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Account Holder Name */}
                  <div className="space-y-1 text-left">
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

                  {/* Email Address */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Portal Email Username <span className="text-red-400">*</span></label>
                    <input 
                      type="email" 
                      required 
                      placeholder="e.g. juan@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* MANDATORY Barangay Selection */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider flex items-center justify-between">
                      <span>Barangay Location <span className="text-red-400">*</span></span>
                      <span className="text-[8px] text-amber-400 font-bold">Mandatory</span>
                    </label>
                    <div className="relative">
                      <select
                        required
                        value={barangay}
                        onChange={(e) => setBarangay(e.target.value)}
                        className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 pl-3 pr-8 text-xs text-slate-200 focus:outline-none appearance-none"
                      >
                        <option value="" disabled>-- Select Barangay (Required) --</option>
                        {availableBarangays.map((b) => (
                          <option key={b.id} value={b.name} className="bg-slate-900 text-slate-200">
                            {b.name}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
                        <MapPin className="h-3.5 w-3.5 text-orange-400" />
                      </div>
                    </div>
                  </div>

                  {/* MANDATORY Sitio / Zone Input */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider flex items-center justify-between">
                      <span>Sitio / Zone <span className="text-red-400">*</span></span>
                      <span className="text-[8px] text-amber-400 font-bold">Mandatory</span>
                    </label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. Zone 1 or Centro"
                      value={sitioZone}
                      onChange={(e) => setSitioZone(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Password Setting */}
                  <div className="space-y-1 sm:col-span-2 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Configure Account Password <span className="text-red-400">*</span></label>
                    <input 
                      type="password" 
                      required 
                      placeholder="Configure password for portal login"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Consumer Classification Toggle */}
                  <div className="space-y-2 sm:col-span-2 text-left bg-slate-950/60 p-3 rounded-2xl border border-slate-800">
                    <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider">Consumer Classification <span className="text-red-400">*</span></span>
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

                {/* Submit Buttons */}
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
          /* Success Panel */
          <div className="bg-slate-900 p-6 sm:p-8 text-center space-y-4 max-w-lg mx-auto rounded-3xl border border-slate-800">
            <div className="flex items-center justify-center space-x-3 mb-2">
              <div className="h-14 w-14 bg-emerald-500/15 text-emerald-400 rounded-2xl border border-emerald-500/30 flex items-center justify-center shadow-lg">
                <CheckCircle className="h-8 w-8 animate-scale-up" />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-black text-white">Registration Complete!</h2>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Account <strong className="text-blue-400 font-mono font-bold">#{registeredSummary?.accountNumber}</strong> ({registeredSummary?.fullName}) is registered and synchronized to the District master database.
              </p>
            </div>

            <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 text-left space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer Name:</span>
                <span className="font-bold text-slate-300">{registeredSummary?.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Account Number:</span>
                <span className="font-mono font-bold text-blue-400">{registeredSummary?.accountNumber}</span>
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
                <span className="text-slate-500">Portal Email:</span>
                <span className="font-mono text-slate-300">{registeredSummary?.email}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800/60 pt-1.5">
                <span className="text-slate-500">Classification:</span>
                <span className="font-bold text-blue-400">{registeredSummary?.consumerType} ({registeredSummary?.meterSize})</span>
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

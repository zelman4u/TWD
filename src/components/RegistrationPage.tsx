/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { UserCheck, AlertCircle, HelpCircle, CheckCircle, ArrowLeft, Waves, Briefcase, X, MapPin } from 'lucide-react';
import { mockDb } from '../mockDb';
import { User, Consumer, Barangay } from '../types';
import { useLoading } from '../context/LoadingContext';

interface RegistrationPageProps {
  onBackToHome: () => void;
  onNavigateToLogin: () => void;
}

export default function RegistrationPage({ onBackToHome, onNavigateToLogin }: RegistrationPageProps) {
  const { showLoading, hideLoading } = useLoading();
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

  // Auto-fill test cases helper
  const fillUnregistered = (
    acc: string,
    name: string,
    brg: string,
    sz: string,
    phone: string,
    mail: string,
    type: 'Residential' | 'Commercial',
    meter: string,
    hh: string,
    bName: string,
    bType: string
  ) => {
    setAccountNumber(acc);
    setFullName(name);
    setBarangay(brg);
    setSitioZone(sz);
    setContactNumber(phone);
    setEmail(mail);
    setPassword('consumer123');
    setConsumerType(type);
    setMeterSize(meter);
    setHouseholdInfo(hh);
    setBusinessName(bName);
    setBusinessType(bType);
    setError(null);
  };

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

    // Simulated verification delay
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
        setError(`Account Number "${accountNumber}" has already been linked to an active web portal user profile. Please proceed to unified login.`);
        setIsValidating(false);
        return;
      }

      // If pre-existing master record, validate name similarity
      if (targetConsumer) {
        const inputNameNorm = fullName.trim().toLowerCase().replace(/\s/g, '');
        const recordNameNorm = targetConsumer.name.trim().toLowerCase().replace(/\s/g, '');
        
        if (!recordNameNorm.includes(inputNameNorm) && !inputNameNorm.includes(recordNameNorm)) {
          hideLoading();
          setError(`The client name "${fullName}" does not match the official database record (${targetConsumer.name}) for this account. Please verify spelling.`);
          setIsValidating(false);
          return;
        }
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
        status: 'active'
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
      
      currentUsers.push(newConsumerUser);
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
        fullAddress,
        consumerType,
        meterSize,
        householdInfo,
        businessName,
        businessType
      });

      hideLoading();
      setIsValidating(false);
      setIsSuccessModal(true);
    }, 900);
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in" 
      id="consumer-registration-modal"
      onClick={onBackToHome}
    >
      <div 
        className={`w-full bg-slate-900 text-slate-100 relative rounded-3xl z-10 my-auto border-2 border-white/15 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] max-h-[92vh] flex flex-col overflow-hidden ring-1 ring-blue-500/20 ${isSuccessModal ? 'max-w-md' : 'max-w-2xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle Top Inner Sheen */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400/60 to-transparent z-20"></div>

        {/* Close Button Absolute */}
        <button 
          onClick={onBackToHome}
          className="absolute top-3.5 right-3.5 text-slate-400 hover:text-white transition p-1.5 hover:bg-slate-800/80 rounded-xl focus:outline-none cursor-pointer z-30 border border-slate-700/50"
          aria-label="Close Registration"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Normal Registration Interface */}
        {!isSuccessModal ? (
          <div className="flex flex-col max-h-[92vh]">
            {/* Header with Official District Logo */}
            <div className="px-5 sm:px-7 pt-5 pb-3 border-b border-slate-800/80 bg-slate-900/90 shrink-0">
              <div className="flex items-center space-x-3.5">
                {/* Official District Seal Logo */}
                <div className="relative group shrink-0">
                  <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-sky-400 to-indigo-600 rounded-2xl blur-xs opacity-75"></div>
                  <div className="relative h-12 w-12 sm:h-13 sm:w-13 rounded-2xl overflow-hidden bg-slate-950 border-2 border-white/30 shadow-lg shadow-blue-600/30 flex items-center justify-center p-0.5">
                    <img 
                      src="https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg"
                      alt="Tagoloan Water District Logo"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
                      }}
                      className="w-full h-full object-cover rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <h2 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center space-x-2">
                    <span>Consumer Portal Registration</span>
                  </h2>
                  <p className="text-[11px] font-semibold text-slate-400">
                    Tagoloan Water District • Self-Service Digital Connection Setup
                  </p>
                </div>
              </div>
            </div>

            {/* Scrollable Form Content */}
            <div className="overflow-y-auto px-5 sm:px-7 py-4 space-y-3.5 scrollbar-thin">
              <form onSubmit={handleRegister} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  
                  {/* Account Number */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Account Number <span className="text-red-400">*</span></label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. 2001-X"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
                    />
                    <p className="text-[8px] text-slate-500">Official statement account ID.</p>
                  </div>

                  {/* Account Full Name */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Your Full Name <span className="text-red-400">*</span></label>
                    <input 
                      type="text" 
                      required 
                      placeholder="e.g. Ramon Valenzuela"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
                    />
                    <p className="text-[8px] text-slate-500">Name as printed on bill card.</p>
                  </div>

                  {/* Contact Number */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Contact Number</label>
                    <input 
                      type="tel" 
                      placeholder="e.g. 09203334444"
                      value={contactNumber}
                      onChange={(e) => setContactNumber(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
                    />
                  </div>

                  {/* Email Address */}
                  <div className="space-y-1 text-left">
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-wider">Portal Email Username <span className="text-red-400">*</span></label>
                    <input 
                      type="email" 
                      required 
                      placeholder="e.g. ramon@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
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
                            {b.name} ({b.id})
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
                      placeholder="e.g. Zone 3 or Sitio Centro"
                      value={sitioZone}
                      onChange={(e) => setSitioZone(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
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
                      className="w-full bg-slate-950/90 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
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
                            ? 'bg-blue-600/20 border-blue-500 text-blue-400 shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <Briefcase className="h-3.5 w-3.5 shrink-0" />
                        <span>Commercial</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2 pt-2 border-t border-slate-800/60">
                      {/* Common Meter Size */}
                      <div className="space-y-1">
                        <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">Meter Connection Size</label>
                        <select
                          value={meterSize}
                          onChange={(e) => setMeterSize(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-1.5 px-2.5 text-xs text-slate-200 focus:outline-none"
                        >
                          <option value="1/2 inch">1/2 inch (Standard)</option>
                          <option value="3/4 inch">3/4 inch (Medium)</option>
                          <option value="1 inch">1 inch (Large)</option>
                          <option value="1 1/2 inch">1 1/2 inch</option>
                          <option value="2 inch">2 inch (Commercial Main)</option>
                        </select>
                      </div>

                      {consumerType === 'Residential' ? (
                        /* Residential specifics */
                        <div className="space-y-1">
                          <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">Household Info <span className="text-red-400">*</span></label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. 4 family members"
                            value={householdInfo}
                            onChange={(e) => setHouseholdInfo(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-1.5 px-2.5 text-xs text-slate-200 focus:outline-none"
                          />
                        </div>
                      ) : (
                        /* Commercial specifics */
                        <>
                          <div className="space-y-1">
                            <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">Business Name <span className="text-red-400">*</span></label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. Tagoloan Bakery"
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
                  className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 disabled:opacity-60 text-white font-black rounded-xl text-xs uppercase tracking-widest transition shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 cursor-pointer border border-blue-400/30"
                >
                  {isValidating ? (
                    <span>Syncing with Barangay Database...</span>
                  ) : (
                    <span>Submit Registration & Auto-Sync to Admin</span>
                  )}
                </button>
              </form>

              {/* Quick Testing Panel showing unregistered user tags from database */}
              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink mx-3 text-[8px] font-black text-slate-500 uppercase tracking-widest">Tester Quick-Fill Aids</span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>

              <div className="space-y-1.5 text-center bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                <p className="text-[9px] text-slate-400 font-bold">Eligible test accounts with verified barangays:</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-left">
                  <button
                    type="button"
                    onClick={() => fillUnregistered('2001-X', 'Ramon Valenzuela', 'Natumolan', 'Zone 3', '09203334444', 'ramon@temp.com', 'Residential', '1/2 inch', '5 members', '', '')}
                    className="bg-slate-900 border border-slate-800 hover:border-blue-500 text-left p-2 rounded-lg text-xs transition cursor-pointer"
                  >
                    <p className="font-black text-[9px] text-blue-400">#2001-X</p>
                    <p className="text-[9px] text-slate-300 truncate">R. Valenzuela</p>
                    <p className="text-[8px] text-slate-500 truncate">Natumolan</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => fillUnregistered('2002-Y', 'Clara Generosa', 'Sta. Ana', 'Zone 5', '09355556666', 'clara@temp.com', 'Residential', '1/2 inch', '2 members', '', '')}
                    className="bg-slate-900 border border-slate-800 hover:border-blue-500 text-left p-2 rounded-lg text-xs transition cursor-pointer"
                  >
                    <p className="font-black text-[9px] text-blue-400">#2002-Y</p>
                    <p className="text-[9px] text-slate-300 truncate">C. Generosa</p>
                    <p className="text-[8px] text-slate-500 truncate">Sta. Ana</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => fillUnregistered('2003-Z', 'Wilfredo Macabebe', 'Sta. Cruz', 'Zone 2', '09774441234', 'wilfredo@temp.com', 'Commercial', '3/4 inch', '', 'Wilfredo Auto Shop', 'Automotive Workshop')}
                    className="bg-slate-900 border border-slate-800 hover:border-purple-500 text-left p-2 rounded-lg text-xs transition cursor-pointer"
                  >
                    <p className="font-black text-[9px] text-purple-400">#2003-Z</p>
                    <p className="text-[9px] text-slate-300 truncate">W. Macabebe</p>
                    <p className="text-[8px] text-slate-500 truncate">Sta. Cruz</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => fillUnregistered('3001-N', 'Teresa Alonzo', 'Poblacion East', 'Zone 2', '09191234567', 'teresa@twd.ph', 'Residential', '1/2 inch', '3 members', '', '')}
                    className="bg-slate-900 border border-slate-800 hover:border-emerald-500 text-left p-2 rounded-lg text-xs transition cursor-pointer"
                  >
                    <p className="font-black text-[9px] text-emerald-400">#3001-N</p>
                    <p className="text-[9px] text-slate-300 truncate">T. Alonzo</p>
                    <p className="text-[8px] text-slate-500 truncate">Poblacion</p>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Success Panel */
          <div className="bg-slate-900 p-6 sm:p-8 text-center space-y-4 max-w-lg mx-auto">
            {/* Logo and Checkmark */}
            <div className="flex items-center justify-center space-x-3 mb-2">
              <div className="relative h-14 w-14 rounded-2xl overflow-hidden bg-slate-950 border-2 border-white/30 shadow-lg p-0.5">
                <img 
                  src="https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg"
                  alt="Tagoloan Water District Logo"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
                  }}
                  className="w-full h-full object-cover rounded-xl"
                />
              </div>
              <div className="h-14 w-14 bg-emerald-500/15 text-emerald-400 rounded-2xl border border-emerald-500/30 flex items-center justify-center shadow-lg">
                <CheckCircle className="h-8 w-8 animate-scale-up" />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-black text-white">Registration Complete!</h2>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Account <strong className="text-blue-400 font-mono font-bold">#{registeredSummary?.accountNumber}</strong> ({registeredSummary?.fullName}) is registered and automatically synchronized to the Admin master database.
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
                <span className="font-bold text-orange-400">{registeredSummary?.barangayName} ({registeredSummary?.barangayId})</span>
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
              {registeredSummary?.consumerType === 'Residential' ? (
                <div className="flex justify-between">
                  <span className="text-slate-500">Household:</span>
                  <span className="text-slate-300">{registeredSummary?.householdInfo}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Business:</span>
                    <span className="text-slate-300">{registeredSummary?.businessName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Type:</span>
                    <span className="text-slate-300">{registeredSummary?.businessType}</span>
                  </div>
                </>
              )}
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

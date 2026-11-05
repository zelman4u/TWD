/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Mail, Lock, LogIn, AlertCircle, RefreshCw, ArrowLeft, Eye, EyeOff, Smartphone, ExternalLink } from 'lucide-react';
import { User, Consumer } from '../types';
import { mockDb } from '../mockDb';
import { apiClient } from '../services/apiClient';
import {
  COLLECTIONS,
  directFindUserInFirestore,
  resolveConsumerAccountInFirestore,
  syncDocToFirestore,
  removeTerminatedAccountKeys,
  isRealIssuedAccountNumber,
} from '../services/firebaseDb';
import { isPendingConsumerStatus } from '../utils/installationWorkflow';
import { useLoading } from '../context/LoadingContext';
import { useToast } from '../context/ToastContext';

interface UnifiedLoginProps {
  onLoginSuccess: (user: User) => void;
  onBackToHome: () => void;
  onNavigateToRegister: () => void;
}

export default function UnifiedLogin({ onLoginSuccess, onBackToHome, onNavigateToRegister }: UnifiedLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { showLoading, hideLoading } = useLoading();
  const toast = useToast();

  // 3D Mouse Parallax & Float Interaction
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [imgSrc, setImgSrc] = useState('https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg');
  const [imgLoaded, setImgLoaded] = useState(false);

  // Lock body scroll while on login page to guarantee zero page scrolling
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { innerWidth, innerHeight } = window;
    const x = ((e.clientX / innerWidth) - 0.5) * 2;
    const y = ((e.clientY / innerHeight) - 0.5) * 2;
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0, y: 0 });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const rawIdentifier = email.trim();
    const inputPassword = password.trim();

    if (!rawIdentifier || !inputPassword) {
      setError('Please enter both your registered email (or Account #) and password.');
      return;
    }

    setIsLoading(true);
    setError(null);
    showLoading('Authenticating Credentials...', 'Verifying digital security certificate with Tagoloan Water District');

    const isEmailInput = rawIdentifier.includes('@');
    const inputEmail = isEmailInput ? rawIdentifier.toLowerCase() : '';
    const inputAccount = !isEmailInput ? rawIdentifier.replace(/^#/, '').trim().toUpperCase() : '';

    const passwordMatches = (storedPw?: string | null): boolean => {
      if (!storedPw) return false;
      return storedPw === password || storedPw === inputPassword || storedPw.trim() === inputPassword;
    };

    try {
      // 1. Official Admin Authentication Check
      if (inputEmail === 'admin@tagoloanwater.gov.ph') {
        if (passwordMatches('AdminWater2025!')) {
          const adminUser: User = {
            id: 'admin-1',
            email: 'admin@tagoloanwater.gov.ph',
            name: 'Admin',
            role: 'admin',
            status: 'active',
            password: 'AdminWater2025!',
          };

          const users = mockDb.getUsers();
          const existingIdx = users.findIndex((u) => (u.email || '').toLowerCase() === adminUser.email.toLowerCase());
          if (existingIdx >= 0) {
            users[existingIdx] = { ...users[existingIdx], ...adminUser };
          } else {
            users.push(adminUser);
          }
          mockDb.saveUsers(users);

          showLoading(`Access Granted: ${adminUser.name}`, 'Loading District Management Console...');

          setTimeout(() => {
            mockDb.setCurrentUser(adminUser);
            hideLoading();
            setIsLoading(false);
            onLoginSuccess(adminUser);
            setTimeout(() => {
              mockDb.addAuditLog(
                adminUser.id,
                adminUser.name,
                'admin',
                'Administrator Authentication',
                'Official administrator session authenticated and remembered.'
              );
            }, 60);
          }, 220);
          return;
        } else {
          hideLoading();
          setError('Invalid administrator password. Please check your credentials.');
          toast.error('Authentication Failed', 'Invalid administrator password. Please check your credentials.');
          setIsLoading(false);
          return;
        }
      }

      // 2. Real Registered Consumer Authentication Check (Local + Server + Cloud Firestore Resolution)
      mockDb.reconcileIssuedAccounts();
      const users = mockDb.getUsers();
      const localConsumers = mockDb.getConsumers();

      const localMatchedConsumer = localConsumers.find((c) => {
        const cEmail = (c.email || '').trim().toLowerCase();
        const cAcc = (c.accountNumber || '').replace(/^#/, '').trim().toUpperCase();
        return (inputEmail && cEmail === inputEmail) || (inputAccount && cAcc && cAcc === inputAccount);
      });

      const effectiveLookupEmail = inputEmail || (localMatchedConsumer?.email || '').trim().toLowerCase();
      const effectiveLookupAcc =
        inputAccount ||
        (localMatchedConsumer && isRealIssuedAccountNumber(localMatchedConsumer.accountNumber)
          ? localMatchedConsumer.accountNumber.replace(/^#/, '').trim().toUpperCase()
          : '');

      let matchedUser = users.find((u) => {
        if (u.role === 'admin') return false;
        const uEmail = (u.email || '').trim().toLowerCase();
        const uAcc = (u.linkedAccountNumber || '').replace(/^#/, '').trim().toUpperCase();
        return (
          (effectiveLookupEmail && uEmail && uEmail === effectiveLookupEmail) ||
          (effectiveLookupAcc && uAcc && uAcc === effectiveLookupAcc) ||
          (localMatchedConsumer?.linkedUserId && u.id === localMatchedConsumer.linkedUserId)
        );
      });

      // Query central server (bounded timeout) AND Cloud Firestore in parallel WITHOUT mutating state before auth passes
      const [serverResolved, firestoreResolved] = await Promise.all([
        (async () => {
          const controller = new AbortController();
          const abortTimer = setTimeout(() => controller.abort(), 4000);
          try {
            const resp = await fetch('/api/consumers/resolve-account', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                email: effectiveLookupEmail || undefined,
                userId: matchedUser?.id || localMatchedConsumer?.linkedUserId,
                accountNumber: effectiveLookupAcc || matchedUser?.linkedAccountNumber,
                name: matchedUser?.name || localMatchedConsumer?.name,
                password: inputPassword,
                verifyPassword: false,
                includeAuthMeta: true,
              }),
            });
            if (resp.status === 401) {
              const errBody = await resp.json().catch(() => null);
              return { authFailed: Boolean(errBody?.authFailed) };
            }
            if (resp.ok) {
              return await resp.json().catch(() => null);
            }
          } catch {
            // Non-fatal if offline or server waking up
          } finally {
            clearTimeout(abortTimer);
          }
          return null;
        })(),
        resolveConsumerAccountInFirestore({
          email: effectiveLookupEmail || undefined,
          userId: matchedUser?.id || localMatchedConsumer?.linkedUserId,
          accountNumber: effectiveLookupAcc || matchedUser?.linkedAccountNumber,
          name: matchedUser?.name || localMatchedConsumer?.name,
        }).catch(() => null),
      ]);

      // Direct Firestore user lookup if neither local nor parallel resolvers returned a user with a password
      let directFirestoreUser: User | null = null;
      if (
        !matchedUser?.password &&
        !serverResolved?.user?.password &&
        !firestoreResolved?.user?.password &&
        (effectiveLookupEmail || effectiveLookupAcc)
      ) {
        directFirestoreUser = await directFindUserInFirestore(effectiveLookupEmail || effectiveLookupAcc).catch(
          () => null
        );
      }

      if (!matchedUser && serverResolved?.authFailed && !firestoreResolved?.user && !directFirestoreUser) {
        hideLoading();
        setError('Incorrect account password. Please try again.');
        toast.error('Authentication Failed', 'Incorrect account password. Please try again.');
        setIsLoading(false);
        return;
      }

      // Assemble candidate User WITHOUT injecting inputPassword or saving before password verification!
      const resolvedConsumerAny =
        (firestoreResolved?.isIssued ? firestoreResolved.consumer : null) ||
        (serverResolved?.isIssued ? serverResolved.consumer : null) ||
        firestoreResolved?.consumer ||
        serverResolved?.consumer ||
        localMatchedConsumer ||
        null;

      if (!matchedUser) {
        if (serverResolved?.user) {
          matchedUser = { ...(serverResolved.user as User) };
        } else if (firestoreResolved?.user) {
          matchedUser = { ...firestoreResolved.user };
        } else if (directFirestoreUser) {
          matchedUser = { ...directFirestoreUser };
        } else if (resolvedConsumerAny) {
          const isConsIssued = isRealIssuedAccountNumber(resolvedConsumerAny.accountNumber);
          const fallbackPendingStatus: User['status'] =
            resolvedConsumerAny.status === 'pending_installation' ||
            resolvedConsumerAny.status === 'installation_not_scheduled'
              ? resolvedConsumerAny.status
              : 'pending_approval';
          matchedUser = {
            id: resolvedConsumerAny.linkedUserId || resolvedConsumerAny.id || `user-${Date.now()}`,
            email: (resolvedConsumerAny.email || effectiveLookupEmail || '').trim().toLowerCase(),
            name: resolvedConsumerAny.name || 'Consumer',
            role: 'consumer',
            status: isConsIssued ? 'active' : fallbackPendingStatus,
            linkedAccountNumber: isConsIssued
              ? resolvedConsumerAny.accountNumber.replace(/^#/, '').trim().toUpperCase()
              : undefined,
            contactNumber: resolvedConsumerAny.contactNumber,
            registrationDate: resolvedConsumerAny.registrationDate,
          };
        }
      }

      if (!matchedUser) {
        hideLoading();
        setError(
          'Account not found. Please review the registered email address or Account Number, or register a new account below.'
        );
        toast.error('Account Not Found', 'No registered consumer account matched these credentials.');
        setIsLoading(false);
        return;
      }

      // Gather all authoritative password candidates across local override, server, Firestore, and local user
      type PwCandidate = { password: string; ts: number; source: 'override' | 'server' | 'firestore' | 'local' };
      const pwCandidates: PwCandidate[] = [];
      const pushCandidate = (pw: string | undefined, ts: number | undefined, source: PwCandidate['source']) => {
        if (!pw || typeof pw !== 'string' || !pw.trim()) return;
        pwCandidates.push({ password: pw, ts: Number(ts || 0), source });
      };

      try {
        const rawOv = localStorage.getItem('twd_live_v4_password_overrides');
        if (rawOv) {
          const ovMap = JSON.parse(rawOv) || {};
          for (const k of [
            effectiveLookupEmail,
            (matchedUser.email || '').trim().toLowerCase(),
            (matchedUser.id || '').trim().toLowerCase(),
            (matchedUser.linkedAccountNumber || '').trim().toLowerCase(),
          ].filter(Boolean)) {
            const ov = ovMap[k];
            if (ov && ov.password) {
              pushCandidate(ov.password, ov.passwordUpdatedAt, 'override');
            }
          }
        }
      } catch {}

      pushCandidate(serverResolved?.user?.password, serverResolved?.user?.passwordUpdatedAt, 'server');
      pushCandidate(firestoreResolved?.user?.password, firestoreResolved?.user?.passwordUpdatedAt, 'firestore');
      pushCandidate(directFirestoreUser?.password, directFirestoreUser?.passwordUpdatedAt, 'firestore');
      pushCandidate(matchedUser.password, matchedUser.passwordUpdatedAt, 'local');

      // Rank candidates: strictly highest passwordUpdatedAt wins; on tie (both 0), prefer server/firestore over potentially stale local cache
      const sourcePriority: Record<PwCandidate['source'], number> = {
        override: 4,
        server: 3,
        firestore: 2,
        local: 1,
      };
      pwCandidates.sort((a, b) => {
        if (b.ts !== a.ts) return b.ts - a.ts;
        return sourcePriority[b.source] - sourcePriority[a.source];
      });

      let verifiedPassword: string | undefined;
      let verifiedPwTs = 0;

      if (pwCandidates.length > 0) {
        // Unbreakable authentication: if input password matches ANY valid candidate (server, firestore, local override, or local user), authentication succeeds!
        const matchedCandidate = pwCandidates.find((c) => passwordMatches(c.password));
        if (matchedCandidate) {
          verifiedPassword = matchedCandidate.password;
          verifiedPwTs = Math.max(matchedCandidate.ts, Date.now());
        } else if (serverResolved?.passwordVerified) {
          verifiedPassword = inputPassword;
          verifiedPwTs = Number(serverResolved?.user?.passwordUpdatedAt || Date.now());
        } else {
          hideLoading();
          setError('Incorrect account password. Please try again.');
          toast.error('Authentication Failed', 'Incorrect account password. Please try again.');
          setIsLoading(false);
          return;
        }
      } else if (serverResolved?.authFailed) {
        hideLoading();
        setError('Incorrect account password. Please try again.');
        toast.error('Authentication Failed', 'Incorrect account password. Please try again.');
        setIsLoading(false);
        return;
      } else {
        // Legacy pre-seeded utility consumer without an online password yet — bind password ONLY now after valid account match
        verifiedPassword = inputPassword;
        verifiedPwTs = Date.now();
      }

      // Authentication PASSED! Clear any stale local termination tombstones for this active account
      removeTerminatedAccountKeys([
        matchedUser.email,
        matchedUser.id,
        matchedUser.linkedAccountNumber,
        effectiveLookupEmail,
        effectiveLookupAcc,
      ]);

      matchedUser = {
        ...matchedUser,
        email: (matchedUser.email || effectiveLookupEmail || '').trim().toLowerCase(),
        password: verifiedPassword,
        ...(verifiedPwTs > 0 ? { passwordUpdatedAt: verifiedPwTs } : {}),
      };

      // Heal local password override if verified password updated or healed a stale local record
      if (verifiedPassword) {
        mockDb.updateUserPassword(
          {
            userId: matchedUser.id,
            email: matchedUser.email,
            accountNumber: matchedUser.linkedAccountNumber,
          },
          verifiedPassword,
          verifiedPwTs || Date.now()
        );
      }

      // Upgrade matchedUser if Firestore or Server has an active linkedAccountNumber
      const resolvedLinkedAcc =
        firestoreResolved?.user?.linkedAccountNumber ||
        (firestoreResolved?.isIssued ? firestoreResolved.consumer?.accountNumber : '') ||
        serverResolved?.user?.linkedAccountNumber ||
        (serverResolved?.isIssued ? serverResolved.consumer?.accountNumber : '');

      if (
        resolvedLinkedAcc &&
        isRealIssuedAccountNumber(resolvedLinkedAcc) &&
        !isRealIssuedAccountNumber(matchedUser.linkedAccountNumber)
      ) {
        matchedUser = {
          ...matchedUser,
          linkedAccountNumber: resolvedLinkedAcc.replace(/^#/, '').trim().toUpperCase(),
          status: 'active',
        };
      }

      // Merge server-resolved & Firestore-resolved notifications and consumer record before entering portal
      if (serverResolved?.notifications && Array.isArray(serverResolved.notifications)) {
        mockDb.mergeExternalNotifications(serverResolved.notifications);
      }
      if (firestoreResolved?.notifications && Array.isArray(firestoreResolved.notifications)) {
        mockDb.mergeExternalNotifications(firestoreResolved.notifications);
      }

      const incomingCandidates = [
        firestoreResolved?.isIssued ? firestoreResolved.consumer : null,
        serverResolved?.isIssued ? serverResolved.consumer : null,
        firestoreResolved?.consumer,
        serverResolved?.consumer,
      ].filter(Boolean);

      if (incomingCandidates.length > 0) {
        const rc = incomingCandidates[0];
        const rcIssued = Boolean(isRealIssuedAccountNumber(rc.accountNumber) && !isPendingConsumerStatus(rc.status));
        const localCons = mockDb.getConsumers();
        const cIdx = localCons.findIndex(
          (lc) =>
            (isRealIssuedAccountNumber(rc.accountNumber) && lc.accountNumber === rc.accountNumber) ||
            (rc.email && lc.email && lc.email.toLowerCase() === rc.email.toLowerCase()) ||
            (rc.linkedUserId && lc.linkedUserId && lc.linkedUserId === rc.linkedUserId)
        );
        if (cIdx >= 0) {
          if (rcIssued || !isRealIssuedAccountNumber(localCons[cIdx].accountNumber)) {
            localCons[cIdx] = { ...localCons[cIdx], ...rc };
          }
        } else {
          localCons.unshift(rc);
        }
        mockDb.saveConsumers(localCons);
      }

      // Pull any installation requests associated with this consumer from backend asynchronously
      if (matchedUser.role === 'consumer' && (matchedUser.email || matchedUser.id)) {
        apiClient
          .getInstallations({ email: matchedUser.email, userId: matchedUser.id })
          .then((res) => {
            if (res?.installations && Array.isArray(res.installations)) {
              mockDb.mergeExternalInstallations(res.installations);
            }
          })
          .catch(() => {});
      }

      mockDb.reconcileIssuedAccounts();

      // Auto-link issued account number from consumers database if available
      const allConsumers = mockDb.getConsumers();
      const matchedConsumers = allConsumers
        .filter(
          (c) =>
            (c.linkedUserId && c.linkedUserId === matchedUser!.id) ||
            (c.email && matchedUser!.email && c.email.toLowerCase() === matchedUser!.email.toLowerCase()) ||
            (c.name &&
              c.name.toLowerCase() === matchedUser!.name.toLowerCase() &&
              (!c.email || !matchedUser!.email || c.email.toLowerCase() === matchedUser!.email.toLowerCase()))
        )
        .sort((a, b) => {
          const aIssued = isRealIssuedAccountNumber(a.accountNumber) && !isPendingConsumerStatus(a.status) ? 1 : 0;
          const bIssued = isRealIssuedAccountNumber(b.accountNumber) && !isPendingConsumerStatus(b.status) ? 1 : 0;
          return bIssued - aIssued;
        });
      let matchedConsumer = matchedConsumers[0];

      // If this authenticated user is a consumer and has no local consumer record yet, synthesize one immediately
      if (!matchedConsumer && matchedUser.role === 'consumer') {
        const fallbackAcc = isRealIssuedAccountNumber(matchedUser.linkedAccountNumber)
          ? matchedUser.linkedAccountNumber!.replace(/^#/, '').trim().toUpperCase()
          : '';
        const syntheticConsumer: Consumer = {
          id: `cons-${(matchedUser.email || matchedUser.id || 'cons').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          accountNumber: fallbackAcc || 'PENDING',
          meterNumber: fallbackAcc ? `MT-${fallbackAcc}` : 'PENDING',
          name: matchedUser.name || 'Consumer',
          address: 'Tagoloan, Misamis Oriental',
          barangay: 'Poblacion',
          barangayId: 'BRG-01',
          sitioZone: 'Zone 1',
          contactNumber: matchedUser.contactNumber || '',
          email: (matchedUser.email || '').trim().toLowerCase(),
          consumerType: 'Residential',
          meterSize: '1/2"',
          status: fallbackAcc ? 'active' : (matchedUser.status || 'pending_approval'),
          isRegistered: true,
          linkedUserId: matchedUser.id,
          registrationDate: matchedUser.registrationDate || new Date().toISOString().split('T')[0],
          outstandingBalance: 0,
        };
        const updatedConsumers = [syntheticConsumer, ...allConsumers];
        mockDb.saveConsumers(updatedConsumers);
        matchedConsumer = syntheticConsumer;
      }

      if (
        matchedConsumer &&
        isRealIssuedAccountNumber(matchedConsumer.accountNumber) &&
        !isPendingConsumerStatus(matchedConsumer.status)
      ) {
        const userStatus: User['status'] = matchedConsumer.status === 'inactive' ? 'inactive' : 'active';
        matchedUser = {
          ...matchedUser,
          linkedAccountNumber: matchedConsumer.accountNumber.replace(/^#/, '').trim().toUpperCase(),
          status: userStatus,
        };
      } else if (
        matchedConsumer &&
        (matchedConsumer.status === 'pending_installation' || matchedConsumer.status === 'installation_not_scheduled') &&
        matchedUser.status !== matchedConsumer.status
      ) {
        matchedUser = {
          ...matchedUser,
          status: matchedConsumer.status,
        };
      }

      // Persist authenticated user to local users registry & background sync
      const currentUsers = mockDb.getUsers();
      const uIdx = currentUsers.findIndex(
        (u) =>
          u.id === matchedUser!.id ||
          (u.email && matchedUser!.email && u.email.toLowerCase() === matchedUser!.email.toLowerCase())
      );
      if (uIdx >= 0) {
        currentUsers[uIdx] = { ...currentUsers[uIdx], ...matchedUser };
      } else {
        currentUsers.unshift(matchedUser);
      }
      mockDb.saveUsers(currentUsers);

      const finalUser = matchedUser;
      showLoading(`Access Granted: ${finalUser.name}`, 'Loading Portal Dashboard...');

      setTimeout(() => {
        mockDb.setCurrentUser(finalUser);
        hideLoading();
        setIsLoading(false);
        onLoginSuccess(finalUser);

        // Defer non-critical audit & cloud sync off the transition frame so timer handlers stay <5ms
        setTimeout(() => {
          mockDb.addAuditLog(
            finalUser.id,
            finalUser.name,
            finalUser.role,
            'User Login',
            `Portal session initialized for ${finalUser.name}.`
          );
          syncDocToFirestore(COLLECTIONS.USERS, finalUser.id, finalUser, false);
          if (finalUser.email) {
            const emailDocKey = `email_${finalUser.email.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 120);
            syncDocToFirestore(COLLECTIONS.USERS, emailDocKey, finalUser, false);
          }
        }, 80);
      }, 220);
    } catch (err) {
      console.error('[Login] Unexpected authentication error:', err);
      hideLoading();
      setIsLoading(false);
      setError('Unable to complete sign-in right now. Please try again.');
      toast.error('Sign-In Error', 'Unable to complete sign-in right now. Please try again.');
    }
  };

  return (
    <div 
      className="fixed inset-0 h-screen max-h-screen w-screen overflow-hidden flex flex-col justify-center items-center p-3 sm:p-4 select-none bg-slate-950"
      id="unified-login-portal"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Dynamic 3D Parallax Background */}
      <div 
        className="fixed inset-0 pointer-events-none overflow-hidden z-0"
        style={{ perspective: '1000px' }}
      >
        <div 
          className="absolute -inset-[6%] w-[112%] h-[112%] transition-transform duration-500 ease-out animate-float-bg"
          style={{
            transform: `perspective(1000px) rotateX(${mousePos.y * -4}deg) rotateY(${mousePos.x * 5}deg) scale(1.05)`,
            transformStyle: 'preserve-3d',
          }}
        >
          <img 
            src={imgSrc}
            alt="Tagoloan Water District Facility"
            referrerPolicy="no-referrer"
            onLoad={() => setImgLoaded(true)}
            onError={() => {
              setImgSrc('https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w2000');
            }}
            className={`w-full h-full object-cover object-center transition-all duration-1000 ${
              imgLoaded ? 'opacity-85 filter brightness-[0.7] contrast-[1.05]' : 'opacity-0'
            }`}
          />

          <div className="absolute inset-0 bg-slate-950/60"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-slate-950/70"></div>
        </div>
      </div>

      {/* Floating Ambient Orbs */}
      <div className="absolute top-12 right-16 h-72 w-72 bg-blue-500/10 rounded-full blur-3xl animate-float-orb pointer-events-none"></div>
      <div className="absolute bottom-12 left-16 h-80 w-80 bg-cyan-500/10 rounded-full blur-3xl animate-float-orb pointer-events-none" style={{ animationDelay: '-4s' }}></div>

      {/* Login Form Container */}
      <div className="w-full max-w-md space-y-3.5 z-10 relative">
        
        {/* Back navigation */}
        <button 
          onClick={onBackToHome}
          className="inline-flex items-center space-x-2 text-slate-300 hover:text-white text-[11px] font-black uppercase tracking-wider transition ml-1 px-3 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-white/10 hover:border-white/30 shadow-lg cursor-pointer focus:outline-none"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-blue-400" />
          <span>Back to district homepage</span>
        </button>

        {/* Login Card Container */}
        <div className="bg-slate-900/90 backdrop-blur-2xl border-2 border-white/15 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] rounded-3xl p-6 sm:p-7 space-y-4 relative overflow-hidden ring-1 ring-blue-500/20">
          
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400/60 to-transparent"></div>

          <div className="text-center space-y-2">
            <div className="inline-flex relative group">
              <div className="absolute -inset-1.5 bg-gradient-to-r from-blue-600 via-sky-400 to-indigo-600 rounded-2xl blur-sm opacity-70 group-hover:opacity-100 transition duration-300"></div>
              <div className="relative h-14 w-14 sm:h-16 sm:w-16 rounded-2xl overflow-hidden bg-slate-900 border-2 border-white/30 shadow-xl shadow-blue-600/30 flex items-center justify-center p-0.5">
                <img 
                  src={imgSrc}
                  alt="Tagoloan Water District Logo"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    setImgSrc('https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w1000');
                  }}
                  className="w-full h-full object-cover rounded-xl"
                />
              </div>
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Tagoloan Water District</h2>
              <p className="text-[11px] font-semibold text-slate-300">Unified Portal System Access Point</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-3">
            
            {/* Email or Account Number Field */}
            <div>
              <label className="block text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1">Registered Email or Account #</label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400">
                  <Mail className="h-3.5 w-3.5" />
                </span>
                <input 
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  required
                  placeholder="name@domain.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none shadow-inner"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-[9px] font-black text-slate-300 uppercase tracking-widest">Account Password</label>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400">
                  <Lock className="h-3.5 w-3.5" />
                </span>
                <input 
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 rounded-xl py-2 pl-9 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none shadow-inner"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition cursor-pointer p-0.5 focus:outline-none"
                  title={showPassword ? "Hide password" : "Show password"}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-500/15 border border-red-500/40 text-rose-300 p-2.5 rounded-xl text-xs flex items-start space-x-2 animate-shake">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                <span className="font-semibold">{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 disabled:opacity-70 text-white font-black rounded-xl text-xs uppercase tracking-widest transition-all transform hover:-translate-y-0.5 shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 cursor-pointer border border-blue-400/30 mt-2"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Authenticating Role...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Enter Portal</span>
                </>
              )}
            </button>
          </form>

          {/* Registration & Field Reader Terminal Navigation */}
          <div className="text-center pt-2 border-t border-slate-700/60 space-y-1.5">
            <p className="text-[11px] text-slate-300">
              Not yet registered online?{' '}
              <button 
                onClick={onNavigateToRegister}
                className="text-blue-400 font-black hover:text-blue-300 hover:underline font-sans cursor-pointer ml-1"
              >
                Register Your Account
              </button>
            </p>
            <div className="pt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <a
                href="https://mobile-li9q.onrender.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 transition"
              >
                <Smartphone className="h-3 w-3 shrink-0" />
                <span>Handheld Reader Terminal</span>
                <ExternalLink className="h-2.5 w-2.5 opacity-80 shrink-0" />
              </a>
              {typeof window !== 'undefined' && window.location.hostname.toLowerCase() !== 'twd-427m.onrender.com' && (
                <a
                  href="https://twd-427m.onrender.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-blue-300 transition"
                >
                  <span>Live System Site</span>
                  <ExternalLink className="h-2.5 w-2.5 opacity-80 shrink-0" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Mail, Lock, LogIn, AlertCircle, RefreshCw, Key, ArrowLeft, Waves, Sparkles, Building2 } from 'lucide-react';
import { User } from '../types';
import { mockDb } from '../mockDb';
import { useLoading } from '../context/LoadingContext';

interface UnifiedLoginProps {
  onLoginSuccess: (user: User) => void;
  onBackToHome: () => void;
  onNavigateToRegister: () => void;
}

export default function UnifiedLogin({ onLoginSuccess, onBackToHome, onNavigateToRegister }: UnifiedLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { showLoading, hideLoading } = useLoading();

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
    const x = ((e.clientX / innerWidth) - 0.5) * 2; // -1 to 1
    const y = ((e.clientY / innerHeight) - 0.5) * 2; // -1 to 1
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0, y: 0 });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    showLoading('Authenticating Credentials...', 'Verifying digital security certificate with Tagoloan Water District');

    // Simulated network delay with step-by-step feedback
    setTimeout(() => {
      const users = mockDb.getUsers();
      const matchedUser = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());

      if (!matchedUser) {
        hideLoading();
        setError("Account matching coordinates not found. Please review the registered email or sign up below.");
        setIsLoading(false);
        return;
      }

      // Validate simple password rules for mock database
      if (matchedUser.role === 'admin' && password.trim() !== 'admin') {
        hideLoading();
        setError("Invalid credential key entered for TWD Administrator. Tip: use 'admin'.");
        setIsLoading(false);
        return;
      }

      if (matchedUser.role === 'consumer' && password.trim() === '') {
        hideLoading();
        setError("Password credentials cannot be blank.");
        setIsLoading(false);
        return;
      }

      // Successful Auth step feedback
      showLoading(
        `Access Granted: ${matchedUser.name}`,
        `Loading ${matchedUser.role === 'admin' ? 'District Management Console' : 'Consumer Water Dashboard'}...`
      );

      setTimeout(() => {
        mockDb.setCurrentUser(matchedUser);
        mockDb.addAuditLog(
          matchedUser.id,
          matchedUser.name,
          matchedUser.role,
          'User Login',
          `Successful unified portal access granted. Role detected: ${matchedUser.role.toUpperCase()}`
        );

        hideLoading();
        setIsLoading(false);
        onLoginSuccess(matchedUser);
      }, 500);
    }, 800);
  };

  // Helper chips to fill testing credentials
  const fillSampleAdmin = () => {
    setEmail('admin@tagoloanwater.gov.ph');
    setPassword('admin');
  };

  const fillSampleConsumer = () => {
    setEmail('john@example.com');
    setPassword('consumer');
  };

  return (
    <div 
      className="fixed inset-0 h-screen max-h-screen w-screen overflow-hidden flex flex-col justify-center items-center p-3 sm:p-4 select-none bg-slate-950"
      id="unified-login-portal"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* ------------------------------------------------------------- */}
      {/* 3D FLOATING BACKGROUND PICTURE (FITS ENTIRE SCREEN, NO CUTS)  */}
      {/* ------------------------------------------------------------- */}
      <div 
        className="fixed inset-0 pointer-events-none overflow-hidden z-0"
        style={{
          perspective: '1000px',
        }}
      >
        {/* Dynamic 3D Floating Picture Layer covering full viewport + gentle overscan for 3D motion */}
        <div 
          className="absolute -inset-[6%] w-[112%] h-[112%] transition-transform duration-500 ease-out animate-float-bg"
          style={{
            transform: `perspective(1000px) rotateX(${mousePos.y * -4}deg) rotateY(${mousePos.x * 5}deg) scale(1.05)`,
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Full Screen Image Element */}
          <img 
            src={imgSrc}
            alt="Tagoloan Water District Facility"
            referrerPolicy="no-referrer"
            onLoad={() => setImgLoaded(true)}
            onError={() => {
              // Fallback to Google Drive thumbnail endpoint if primary fails
              setImgSrc('https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w2000');
            }}
            className={`w-full h-full object-cover object-center transition-all duration-1000 ${
              imgLoaded ? 'opacity-85 filter brightness-[0.7] contrast-[1.05]' : 'opacity-0'
            }`}
          />

          {/* Smooth Depth Vignette & Dark Overlays (Ensures high contrast for login text) */}
          <div className="absolute inset-0 bg-slate-950/60"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-slate-950/70"></div>
        </div>
      </div>

      {/* Floating Animated Neon Accent Orbs */}
      <div className="absolute top-12 right-16 h-72 w-72 bg-blue-500/10 rounded-full blur-3xl animate-float-orb pointer-events-none"></div>
      <div className="absolute bottom-12 left-16 h-80 w-80 bg-cyan-500/10 rounded-full blur-3xl animate-float-orb pointer-events-none" style={{ animationDelay: '-4s' }}></div>

      {/* ------------------------------------------------------------- */}
      {/* SOLID, FIXED FOREGROUND LOGIN FORM (NO SCROLL / STEADY)       */}
      {/* ------------------------------------------------------------- */}
      <div className="w-full max-w-md space-y-3.5 z-10 relative">
        
        {/* Back navigation */}
        <button 
          onClick={onBackToHome}
          className="inline-flex items-center space-x-2 text-slate-300 hover:text-white text-[11px] font-black uppercase tracking-wider transition ml-1 px-3 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-white/10 hover:border-white/30 shadow-lg cursor-pointer focus:outline-none"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-blue-400" />
          <span>Back to district homepage</span>
        </button>

        {/* Login Card Container - Stable, Grounded, Completely Fits Viewport */}
        <div className="bg-slate-900/90 backdrop-blur-2xl border-2 border-white/15 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] rounded-3xl p-6 sm:p-7 space-y-4 relative overflow-hidden ring-1 ring-blue-500/20">
          
          {/* Subtle Top Inner Sheen */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400/60 to-transparent"></div>

          <div className="text-center space-y-2">
            {/* Official District Seal / Logo from image */}
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
            
            {/* Email Field */}
            <div>
              <label className="block text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1">Registered Email</label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400">
                  <Mail className="h-3.5 w-3.5" />
                </span>
                <input 
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none shadow-inner"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-[9px] font-black text-slate-300 uppercase tracking-widest">Account Password</label>
                <span className="text-[9px] text-blue-400 font-bold hover:underline cursor-pointer">Inquire admin?</span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400">
                  <Lock className="h-3.5 w-3.5" />
                </span>
                <input 
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none shadow-inner"
                />
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
              className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 disabled:opacity-70 text-white font-black rounded-xl text-xs uppercase tracking-widest transition-all transform hover:-translate-y-0.5 shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 cursor-pointer border border-blue-400/30 mt-1"
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

          {/* Spacer */}
          <div className="relative flex py-0.5 items-center">
            <div className="flex-grow border-t border-slate-700/80"></div>
            <span className="flex-shrink mx-3 text-[8px] font-black text-slate-400 uppercase tracking-widest">Developer testing aids</span>
            <div className="flex-grow border-t border-slate-700/80"></div>
          </div>

          {/* Fast Testing Clickable Chips */}
          <div className="space-y-1.5">
            <p className="text-[9px] text-slate-300 font-semibold text-center">Click these buttons to auto-populate credentials:</p>
            <div className="grid grid-cols-2 gap-2">
              <button 
                type="button" 
                onClick={fillSampleAdmin}
                className="py-2 px-2.5 bg-slate-950/90 border border-slate-700/80 hover:border-blue-500 text-left rounded-xl transition group shadow-sm hover:shadow-blue-500/10 cursor-pointer"
              >
                <div className="flex items-center space-x-1.5 text-blue-400 font-black text-[9px] uppercase tracking-wide">
                  <Key className="h-3 w-3" />
                  <span>Systems Admin</span>
                </div>
                <p className="text-[8px] text-slate-400 mt-0.5 truncate font-mono">admin@tagoloanwater.gov.ph</p>
              </button>
              
              <button 
                type="button" 
                onClick={fillSampleConsumer}
                className="py-2 px-2.5 bg-slate-950/90 border border-slate-700/80 hover:border-emerald-500 text-left rounded-xl transition group shadow-sm hover:shadow-emerald-500/10 cursor-pointer"
              >
                <div className="flex items-center space-x-1.5 text-emerald-400 font-black text-[9px] uppercase tracking-wide">
                  <Key className="h-3 w-3" />
                  <span>John Doe (Consumer)</span>
                </div>
                <p className="text-[8px] text-slate-400 mt-0.5 truncate font-mono">john@example.com</p>
              </button>
            </div>
          </div>

          {/* Registration Navigation */}
          <div className="text-center pt-1.5 border-t border-slate-700/60">
            <p className="text-[11px] text-slate-300">
              Not yet registered online?{' '}
              <button 
                onClick={onNavigateToRegister}
                className="text-blue-400 font-black hover:text-blue-300 hover:underline font-sans cursor-pointer ml-1"
              >
                Register Your Account
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Waves, Droplet, RefreshCw, Database, ShieldCheck, Sparkles } from 'lucide-react';

const OFFICIAL_LOGO_URL = 'https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg';
const FALLBACK_LOGO_URL = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';

interface DataLoadingIndicatorProps {
  message?: string;
  subMessage?: string;
  badgeText?: string;
  variant?: 'inline' | 'card' | 'fullscreen' | 'compact';
  className?: string;
  minHeight?: string;
}

export default function DataLoadingIndicator({
  message = 'Fetching live data...',
  subMessage = 'Connecting to Tagoloan Water District database and synchronizing records',
  badgeText,
  variant = 'card',
  className = '',
  minHeight = 'min-h-[300px]'
}: DataLoadingIndicatorProps) {
  const [imgSrc, setImgSrc] = useState(OFFICIAL_LOGO_URL);
  const [imgError, setImgError] = useState(false);

  const handleImageError = () => {
    if (imgSrc === OFFICIAL_LOGO_URL) {
      setImgSrc(FALLBACK_LOGO_URL);
    } else {
      setImgError(true);
    }
  };

  if (variant === 'compact') {
    return (
      <div className={`inline-flex items-center space-x-2.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-blue-500/30 text-blue-200 text-xs font-semibold shadow-sm ${className}`}>
        <div className="h-5 w-5 rounded-md bg-slate-950 border border-white/20 p-0.5 shrink-0 overflow-hidden flex items-center justify-center">
          {!imgError ? (
            <img 
              src={imgSrc} 
              alt="TWD Logo" 
              referrerPolicy="no-referrer"
              onError={handleImageError}
              className="w-full h-full object-contain"
            />
          ) : (
            <Droplet className="h-3 w-3 text-cyan-400" />
          )}
        </div>
        <RefreshCw className="h-3.5 w-3.5 text-cyan-400 animate-spin shrink-0" />
        <span className="truncate">{message}</span>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`flex items-center justify-center py-6 px-4 space-x-3.5 text-slate-400 ${className}`}>
        <div className="relative h-10 w-10 rounded-xl bg-slate-950 border border-blue-400/40 p-1 shadow-md shrink-0 overflow-hidden flex items-center justify-center">
          <div className="absolute inset-0 rounded-xl border border-cyan-400/30 animate-pulse pointer-events-none" />
          {!imgError ? (
            <img 
              src={imgSrc} 
              alt="Tagoloan Water District Official Logo" 
              referrerPolicy="no-referrer"
              onError={handleImageError}
              className="w-full h-full object-contain animate-pulse"
            />
          ) : (
            <Droplet className="h-5 w-5 text-cyan-400 animate-pulse" />
          )}
        </div>
        <div className="text-left">
          <p className="text-xs font-bold text-slate-100 flex items-center space-x-2">
            <span>{message}</span>
            <RefreshCw className="h-3 w-3 text-cyan-400 animate-spin" />
          </p>
          {subMessage && <p className="text-[11px] text-slate-400">{subMessage}</p>}
        </div>
      </div>
    );
  }

  const mainCardContent = (
    <div 
      className={`flex flex-col items-center justify-center text-center p-8 bg-slate-900/80 border border-slate-800/90 rounded-3xl backdrop-blur-md relative overflow-hidden animate-fade-in ${minHeight} ${className}`}
      role="status"
      aria-live="polite"
    >
      {/* Ambient background water glows */}
      <div className="absolute -top-16 -left-16 w-48 h-48 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-16 -right-16 w-48 h-48 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

      {/* Official Municipal District Header Badge */}
      <div className="mb-4 inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-950/70 border border-blue-500/30 text-[10px] font-black uppercase tracking-wider text-blue-300 shadow-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
        <span>TAGOLOAN WATER DISTRICT</span>
        {badgeText && (
          <>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-cyan-300 font-mono">{badgeText}</span>
          </>
        )}
      </div>

      {/* Center Official Logo Photo Presentation */}
      <div className="relative mb-6 flex items-center justify-center">
        {/* Soft atmospheric ambient glow */}
        <div className="absolute -inset-4 rounded-full bg-blue-500/25 blur-xl animate-pulse" />
        
        {/* Animated fluid gradient ring */}
        <div className="absolute -inset-1.5 rounded-3xl bg-linear-to-r from-blue-600 via-cyan-400 to-indigo-600 opacity-80 blur-xs animate-spin-slow" />

        {/* Outer Logo Photo Frame */}
        <div className="relative h-24 w-24 sm:h-28 sm:w-28 rounded-2xl bg-slate-950 border-2 border-white/30 shadow-2xl flex items-center justify-center backdrop-blur-md overflow-hidden p-1.5">
          {!imgError ? (
            <img 
              src={imgSrc}
              alt="Tagoloan Water District Official Logo"
              referrerPolicy="no-referrer"
              onError={handleImageError}
              className="w-full h-full object-contain rounded-xl drop-shadow-md animate-pulse transform transition-transform"
            />
          ) : (
            <div className="relative z-10 flex flex-col items-center justify-center space-y-1">
              <Waves className="h-9 w-9 text-cyan-400 animate-bounce" />
              <span className="text-[9px] font-black font-mono text-cyan-200">TWD</span>
            </div>
          )}

          {/* Shimmer Overlay */}
          <div className="absolute inset-0 bg-linear-to-t from-slate-950/40 via-transparent to-white/10 pointer-events-none" />
        </div>

        {/* Floating Verified Emblem Badge */}
        <div className="absolute -bottom-1.5 -right-1.5 h-7 w-7 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg ring-2 ring-slate-900 animate-bounce">
          <ShieldCheck className="h-4 w-4 text-cyan-200" />
        </div>
      </div>

      {/* Main Title */}
      <h4 className="text-sm sm:text-base font-black text-white tracking-tight mb-1.5 flex items-center justify-center space-x-2">
        <span>{message}</span>
        <RefreshCw className="h-4 w-4 text-cyan-400 animate-spin inline-block shrink-0" />
      </h4>

      {/* Subtext */}
      {subMessage && (
        <p className="text-xs text-slate-300/90 max-w-sm leading-relaxed mb-4 font-medium">
          {subMessage}
        </p>
      )}

      {/* Indeterminate water progress track */}
      <div className="w-52 sm:w-60 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/60 shadow-inner">
        <div className="h-full bg-linear-to-r from-blue-600 via-cyan-400 to-blue-600 rounded-full animate-indeterminate" />
      </div>

      <div className="mt-3.5 flex items-center space-x-2 text-[10px] text-slate-400 font-mono">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span>REPUBLIC OF THE PHILIPPINES • PROVINCE OF MISAMIS ORIENTAL</span>
      </div>
    </div>
  );

  if (variant === 'fullscreen') {
    return (
      <div 
        className="fixed inset-0 z-999 flex items-center justify-center bg-slate-950/85 backdrop-blur-md transition-all duration-300 animate-fade-in p-4"
        role="status"
        aria-live="polite"
      >
        <div className="max-w-md w-full mx-auto">
          {mainCardContent}
        </div>
      </div>
    );
  }

  return mainCardContent;
}

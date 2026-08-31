/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Waves, Droplet, RefreshCw, Sparkles, Database, CheckCircle2 } from 'lucide-react';

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
  minHeight = 'min-h-[280px]'
}: DataLoadingIndicatorProps) {
  if (variant === 'compact') {
    return (
      <div className={`inline-flex items-center space-x-2.5 px-3 py-1.5 rounded-xl bg-blue-900/40 border border-blue-500/30 text-blue-300 text-xs font-semibold ${className}`}>
        <RefreshCw className="h-3.5 w-3.5 text-cyan-400 animate-spin" />
        <span>{message}</span>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`flex items-center justify-center py-6 px-4 space-x-3 text-slate-400 ${className}`}>
        <div className="relative">
          <div className="h-6 w-6 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin" />
          <Droplet className="h-3 w-3 text-cyan-400 absolute inset-0 m-auto animate-pulse" />
        </div>
        <div className="text-left">
          <p className="text-xs font-bold text-slate-200">{message}</p>
          {subMessage && <p className="text-[11px] text-slate-400">{subMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`flex flex-col items-center justify-center text-center p-8 bg-slate-900/60 border border-slate-800/80 rounded-3xl backdrop-blur-xs relative overflow-hidden animate-fade-in ${minHeight} ${className}`}
      role="status"
      aria-live="polite"
    >
      {/* Ambient background glow */}
      <div className="absolute -top-12 -left-12 w-36 h-36 bg-blue-600/10 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -right-12 w-36 h-36 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

      {badgeText && (
        <div className="mb-4 inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-[10px] font-black uppercase tracking-wider text-blue-400">
          <Sparkles className="h-3 w-3 text-cyan-400" />
          <span>{badgeText}</span>
        </div>
      )}

      {/* Center animated water ripple badge */}
      <div className="relative mb-5 flex items-center justify-center">
        <div className="absolute -inset-3 rounded-full bg-blue-500/20 blur-lg animate-pulse" />
        <div className="absolute -inset-1 rounded-2xl bg-linear-to-r from-blue-600 via-cyan-400 to-indigo-600 opacity-70 blur-xs animate-spin-slow" />
        
        <div className="relative h-14 w-14 rounded-xl bg-slate-950 border border-white/20 shadow-xl flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            <Waves className="h-7 w-7 text-cyan-400 animate-pulse" />
            <Droplet className="h-3.5 w-3.5 text-blue-300 absolute -top-1 -right-1 animate-bounce" />
          </div>
        </div>

        <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md ring-2 ring-slate-900">
          <Database className="h-2.5 w-2.5 text-cyan-200" />
        </div>
      </div>

      {/* Main Title */}
      <h4 className="text-sm sm:text-base font-extrabold text-white tracking-tight mb-1 flex items-center justify-center space-x-2">
        <span>{message}</span>
        <RefreshCw className="h-3.5 w-3.5 text-blue-400 animate-spin inline-block" />
      </h4>

      {/* Subtext */}
      {subMessage && (
        <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-4">
          {subMessage}
        </p>
      )}

      {/* Indeterminate loading progress indicator */}
      <div className="w-48 h-1.5 bg-slate-800/80 rounded-full overflow-hidden border border-slate-700/60">
        <div className="h-full bg-linear-to-r from-blue-600 via-cyan-400 to-blue-600 rounded-full animate-indeterminate" />
      </div>

      <div className="mt-3 flex items-center space-x-1.5 text-[10px] text-slate-500 font-mono">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
        <span>TAGOLOAN MUNICIPAL WATER SERVER SYNC</span>
      </div>
    </div>
  );
}

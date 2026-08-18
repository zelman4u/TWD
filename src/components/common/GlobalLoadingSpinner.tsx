/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Waves, Droplet, Sparkles, RefreshCw, ShieldCheck } from 'lucide-react';

interface GlobalLoadingSpinnerProps {
  message?: string;
  subMessage?: string;
  fullscreen?: boolean;
  variant?: 'water' | 'spinner' | 'minimal';
  className?: string;
}

export default function GlobalLoadingSpinner({
  message = 'Processing request...',
  subMessage = 'Connecting to Tagoloan Water District servers',
  fullscreen = true,
  variant = 'water',
  className = ''
}: GlobalLoadingSpinnerProps) {
  const [imgSrc, setImgSrc] = useState('https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg');
  const [imgError, setImgError] = useState(false);

  const content = (
    <div className={`flex flex-col items-center justify-center text-center p-6 sm:p-8 max-w-sm mx-auto ${className}`}>
      {/* Visual Animation Container with Image Logo */}
      <div className="relative mb-5 flex items-center justify-center">
        {/* Outer Glow & Ambient Rings */}
        <div className="absolute -inset-4 rounded-full bg-blue-500/25 blur-xl animate-pulse"></div>
        <div className="absolute -inset-1.5 rounded-3xl bg-linear-to-r from-blue-600 via-cyan-400 to-indigo-600 opacity-80 blur-sm animate-spin-slow"></div>

        {/* Outer Image Logo Frame */}
        <div className="relative h-20 w-20 rounded-2xl bg-slate-900 border-2 border-white/30 shadow-2xl flex items-center justify-center backdrop-blur-md overflow-hidden p-0.5">
          {!imgError ? (
            <img 
              src={imgSrc}
              alt="Tagoloan Water District"
              referrerPolicy="no-referrer"
              onError={() => {
                // Try fallback URL before hiding image
                if (imgSrc.includes('lh3.googleusercontent.com')) {
                  setImgSrc('https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500');
                } else {
                  setImgError(true);
                }
              }}
              className="w-full h-full object-cover rounded-xl animate-pulse"
            />
          ) : (
            <div className="relative z-10 flex flex-col items-center justify-center">
              <Waves className="h-8 w-8 text-blue-400 animate-bounce" />
            </div>
          )}

          {/* Shimmer Overlay */}
          <div className="absolute inset-0 bg-linear-to-t from-slate-950/40 via-transparent to-white/10 pointer-events-none"></div>
        </div>

        {/* Floating Sparkle / Verified Shield Badge */}
        <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg ring-2 ring-slate-900 animate-bounce">
          <Sparkles className="h-3 w-3 text-cyan-200" />
        </div>
      </div>

      {/* Primary Message */}
      <h3 className="text-base font-black text-slate-100 tracking-tight mb-1 animate-pulse">
        {message}
      </h3>

      {/* Subtext */}
      {subMessage && (
        <p className="text-xs text-slate-400 max-w-xs leading-relaxed font-medium">
          {subMessage}
        </p>
      )}

      {/* Subtle Progress Bar */}
      <div className="w-44 h-1.5 bg-slate-800 rounded-full mt-4 overflow-hidden border border-slate-700/60">
        <div className="h-full bg-linear-to-r from-blue-600 via-cyan-400 to-blue-600 rounded-full animate-indeterminate"></div>
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div 
        className="fixed inset-0 z-999 flex items-center justify-center bg-slate-950/80 backdrop-blur-md transition-all duration-300 animate-fade-in"
        id="global-loading-overlay"
        role="status"
        aria-live="polite"
      >
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl p-2 sm:p-4 ring-1 ring-white/10">
          {content}
        </div>
      </div>
    );
  }

  return content;
}

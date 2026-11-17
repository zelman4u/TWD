/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  id?: string;
  dedupeKey?: string;
  sessionDedupeKey?: string;
  cooldownMs?: number;
  type?: ToastType;
  title: string;
  description?: string;
  duration?: number; // Duration in ms, 0 = persistent
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ToastItem extends ToastOptions {
  id: string;
  type: ToastType;
  createdAt: number;
  semanticKey: string;
  repeatCount?: number;
}

type ToastHelperExtraOptions = Omit<ToastOptions, 'type' | 'title' | 'description' | 'duration'>;

interface ToastContextType {
  toasts: ToastItem[];
  showToast: (options: ToastOptions) => string;
  success: (title: string, description?: string, duration?: number, options?: ToastHelperExtraOptions) => string;
  error: (title: string, description?: string, duration?: number) => string;
  warning: (title: string, description?: string, duration?: number, options?: ToastHelperExtraOptions) => string;
  info: (title: string, description?: string, duration?: number, options?: ToastHelperExtraOptions) => string;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const TOAST_DEDUPE_WINDOW_MS = 15000;
const TOAST_DEDUPE_RETENTION_MS = 60000;
const MAX_VISIBLE_TOASTS = 3;
const SESSION_TOAST_KEYS_STORAGE = 'twd_seen_session_toasts_v1';
const MAX_SESSION_TOAST_KEYS = 250;

function readSeenSessionToastKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage?.getItem(SESSION_TOAST_KEYS_STORAGE);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string' && Boolean(k)) : []);
  } catch {
    return new Set();
  }
}

function recordSeenSessionToastKey(key?: string): void {
  if (!key || typeof window === 'undefined') return;
  try {
    const clean = key.trim().toLowerCase();
    if (!clean) return;
    const current = Array.from(readSeenSessionToastKeys());
    if (current.includes(clean)) return;
    const next = [...current, clean].slice(-MAX_SESSION_TOAST_KEYS);
    window.sessionStorage?.setItem(SESSION_TOAST_KEYS_STORAGE, JSON.stringify(next));
  } catch {
    // Ignore storage restriction
  }
}

function hasSeenSessionToastKey(key?: string): boolean {
  if (!key || typeof window === 'undefined') return false;
  const clean = key.trim().toLowerCase();
  if (!clean) return false;
  return readSeenSessionToastKeys().has(clean);
}

function buildToastSemanticKey(options: ToastOptions, type: ToastType): string {
  if (options.dedupeKey) {
    return `k:${options.dedupeKey.trim().toLowerCase()}`;
  }
  if (options.sessionDedupeKey) {
    return `sk:${options.sessionDedupeKey.trim().toLowerCase()}`;
  }
  if (options.id) {
    return `id:${options.id.trim().toLowerCase()}`;
  }
  const cleanTitle = (options.title || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const cleanDesc = (options.description || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${type}::${cleanTitle}::${cleanDesc}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const recentSemanticMapRef = useRef<Map<string, { id: string; timestamp: number }>>(new Map());
  const activeToastsRef = useRef<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearToastTimer = useCallback((id: string) => {
    const existing = toastTimersRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    clearToastTimer(id);
    setToasts((prev) => {
      const next = prev.filter((t) => t.id !== id);
      activeToastsRef.current = next;
      return next;
    });
  }, [clearToastTimer]);

  const dismissAll = useCallback(() => {
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current.clear();
    activeToastsRef.current = [];
    setToasts([]);
  }, []);

  const showToast = useCallback((options: ToastOptions): string => {
    const type: ToastType = options.type || 'info';
    const duration = options.duration !== undefined ? options.duration : 4200;
    const cooldownMs = options.cooldownMs !== undefined ? options.cooldownMs : TOAST_DEDUPE_WINDOW_MS;
    const semanticKey = buildToastSemanticKey(options, type);
    const now = Date.now();

    // Suppress one-time live event toasts already displayed in this browser session
    if (options.sessionDedupeKey && hasSeenSessionToastKey(options.sessionDedupeKey)) {
      return `suppressed:${options.sessionDedupeKey}`;
    }

    // Prune expired semantic entries (> 60s) to keep map bounded
    for (const [k, entry] of recentSemanticMapRef.current.entries()) {
      if (now - entry.timestamp > TOAST_DEDUPE_RETENTION_MS) {
        recentSemanticMapRef.current.delete(k);
      }
    }

    // Suppress if the exact semantic toast is currently visible OR was recently shown within cooldownMs
    // (Do NOT re-insert at top or reset dismiss timer, which previously caused "keep popping" loops!)
    const activeMatch = activeToastsRef.current.find(
      (t) => (options.id && t.id === options.id) || t.semanticKey === semanticKey
    );
    if (activeMatch) {
      return activeMatch.id;
    }

    const recentEntry = recentSemanticMapRef.current.get(semanticKey);
    if (recentEntry && now - recentEntry.timestamp < cooldownMs) {
      return recentEntry.id;
    }

    const targetId =
      options.id || `toast-${now}-${Math.random().toString(36).substring(2, 7)}`;

    recentSemanticMapRef.current.set(semanticKey, { id: targetId, timestamp: now });
    if (options.sessionDedupeKey) {
      recordSeenSessionToastKey(options.sessionDedupeKey);
    }

    const newToast: ToastItem = {
      ...options,
      id: targetId,
      type,
      duration,
      createdAt: now,
      semanticKey,
      repeatCount: 1,
    };

    setToasts((prev) => {
      if (prev.some((t) => t.id === targetId || t.semanticKey === semanticKey)) {
        return prev;
      }
      const next = [newToast, ...prev].slice(0, MAX_VISIBLE_TOASTS);
      activeToastsRef.current = next;
      return next;
    });

    clearToastTimer(targetId);
    if (duration > 0) {
      const timer = setTimeout(() => {
        dismissToast(targetId);
      }, duration);
      toastTimersRef.current.set(targetId, timer);
    }

    return targetId;
  }, [clearToastTimer, dismissToast]);

  const success = useCallback(
    (title: string, description?: string, duration?: number, options?: ToastHelperExtraOptions) =>
      showToast({ ...options, type: 'success', title, description, duration }),
    [showToast]
  );

  const error = useCallback(
    (title: string, description?: string, duration?: number) =>
      showToast({ type: 'error', title, description, duration }),
    [showToast]
  );

  const warning = useCallback(
    (title: string, description?: string, duration?: number, options?: ToastHelperExtraOptions) =>
      showToast({ ...options, type: 'warning', title, description, duration }),
    [showToast]
  );

  const info = useCallback(
    (title: string, description?: string, duration?: number, options?: ToastHelperExtraOptions) =>
      showToast({ ...options, type: 'info', title, description, duration }),
    [showToast]
  );

  return (
    <ToastContext.Provider
      value={{
        toasts,
        showToast,
        success,
        error,
        warning,
        info,
        dismissToast,
        dismissAll,
      }}
    >
      {children}

      {/* Toast Notification Container */}
      <aside
        aria-label="Notifications"
        className="fixed top-4 right-4 z-[9999] flex flex-col space-y-2.5 w-[360px] max-w-[calc(100vw-1.5rem)] pointer-events-none"
        id="twd-toast-container"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => {
            const isSuccess = t.type === 'success';
            const isError = t.type === 'error';
            const isWarning = t.type === 'warning';

            const borderStyles = isSuccess
              ? 'border-emerald-500/35 bg-slate-900/95 text-slate-100'
              : isError
              ? 'border-rose-500/40 bg-slate-900/95 text-slate-100'
              : isWarning
              ? 'border-amber-500/40 bg-slate-900/95 text-slate-100'
              : 'border-sky-500/35 bg-slate-900/95 text-slate-100';

            const iconStyles = isSuccess
              ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30'
              : isError
              ? 'text-rose-400 bg-rose-500/15 border border-rose-500/30'
              : isWarning
              ? 'text-amber-400 bg-amber-500/15 border border-amber-500/30'
              : 'text-sky-400 bg-sky-500/15 border border-sky-500/30';

            const labelStyles = isSuccess
              ? 'text-emerald-400'
              : isError
              ? 'text-rose-400'
              : isWarning
              ? 'text-amber-300'
              : 'text-sky-400';

            const categoryText = isSuccess
              ? 'Confirmed'
              : isError
              ? 'Action Required'
              : isWarning
              ? 'Attention'
              : 'Notice';

            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: -12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, y: -6, transition: { duration: 0.14 } }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                role="status"
                id={`toast-item-${t.id}`}
                className={`pointer-events-auto w-full backdrop-blur-md border rounded-2xl p-3.5 shadow-2xl flex items-start gap-3 relative overflow-hidden ${borderStyles}`}
              >
                {/* Visual Icon */}
                <div className={`p-1.5 rounded-xl shrink-0 mt-0.5 ${iconStyles}`}>
                  {isSuccess && <CheckCircle2 className="h-4 w-4" />}
                  {isError && <AlertCircle className="h-4 w-4" />}
                  {isWarning && <AlertTriangle className="h-4 w-4" />}
                  {!isSuccess && !isError && !isWarning && <Info className="h-4 w-4" />}
                </div>

                {/* Clear 3-step reading order: Category -> Title -> Readable message */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-semibold leading-tight ${labelStyles}`}>
                      {categoryText}
                    </span>
                  </div>
                  <h4 className="text-[13.5px] font-bold tracking-tight text-white leading-snug mt-0.5 break-words">
                    {t.title}
                  </h4>
                  {t.description && (
                    <p className="text-xs text-slate-200 mt-1 leading-relaxed break-words">
                      {t.description}
                    </p>
                  )}
                  {t.action && (
                    <button
                      type="button"
                      onClick={() => {
                        t.action?.onClick();
                        dismissToast(t.id);
                      }}
                      className="mt-2 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap"
                    >
                      {t.action.label}
                    </button>
                  )}
                </div>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  aria-label="Close notification"
                  className="shrink-0 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>

                {/* Subtle progress indicator */}
                {t.duration && t.duration > 0 ? (
                  <motion.div
                    key={`${t.id}-${t.createdAt}`}
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{ duration: t.duration / 1000, ease: 'linear' }}
                    className={`absolute bottom-0 left-0 h-0.5 ${
                      isSuccess
                        ? 'bg-emerald-500'
                        : isError
                        ? 'bg-rose-500'
                        : isWarning
                        ? 'bg-amber-500'
                        : 'bg-sky-500'
                    }`}
                  />
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </aside>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

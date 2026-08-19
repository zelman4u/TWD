/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  id?: string;
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
}

interface ToastContextType {
  toasts: ToastItem[];
  showToast: (options: ToastOptions) => string;
  success: (title: string, description?: string, duration?: number) => string;
  error: (title: string, description?: string, duration?: number) => string;
  warning: (title: string, description?: string, duration?: number) => string;
  info: (title: string, description?: string, duration?: number) => string;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const showToast = useCallback((options: ToastOptions): string => {
    const id = options.id || `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const type: ToastType = options.type || 'info';
    const duration = options.duration !== undefined ? options.duration : 4000;

    const newToast: ToastItem = {
      ...options,
      id,
      type,
      duration,
      createdAt: Date.now(),
    };

    setToasts((prev) => {
      // Keep maximum 5 toasts active
      const filtered = prev.filter((t) => t.id !== id);
      return [newToast, ...filtered].slice(0, 5);
    });

    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, duration);
    }

    return id;
  }, [dismissToast]);

  const success = useCallback(
    (title: string, description?: string, duration?: number) =>
      showToast({ type: 'success', title, description, duration }),
    [showToast]
  );

  const error = useCallback(
    (title: string, description?: string, duration?: number) =>
      showToast({ type: 'error', title, description, duration }),
    [showToast]
  );

  const warning = useCallback(
    (title: string, description?: string, duration?: number) =>
      showToast({ type: 'warning', title, description, duration }),
    [showToast]
  );

  const info = useCallback(
    (title: string, description?: string, duration?: number) =>
      showToast({ type: 'info', title, description, duration }),
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
        className="fixed top-5 right-5 z-[9999] flex flex-col space-y-3 max-w-sm w-full pointer-events-none px-4 sm:px-0"
        id="twd-toast-container"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => {
            const isSuccess = t.type === 'success';
            const isError = t.type === 'error';
            const isWarning = t.type === 'warning';
            const isInfo = t.type === 'info';

            const borderStyles = isSuccess
              ? 'border-emerald-500/30 bg-slate-900/95 text-slate-100 shadow-emerald-950/20'
              : isError
              ? 'border-rose-500/30 bg-slate-900/95 text-slate-100 shadow-rose-950/20'
              : isWarning
              ? 'border-amber-500/30 bg-slate-900/95 text-slate-100 shadow-amber-950/20'
              : 'border-blue-500/30 bg-slate-900/95 text-slate-100 shadow-blue-950/20';

            const iconStyles = isSuccess
              ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-800/60'
              : isError
              ? 'text-rose-400 bg-rose-950/50 border border-rose-800/60'
              : isWarning
              ? 'text-amber-400 bg-amber-950/50 border border-amber-800/60'
              : 'text-blue-400 bg-blue-950/50 border border-blue-800/60';

            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, y: -10, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 450, damping: 30 }}
                role="status"
                id={`toast-item-${t.id}`}
                className={`pointer-events-auto w-full backdrop-blur-md border rounded-2xl p-4 shadow-xl flex items-start space-x-3.5 relative overflow-hidden transition ${borderStyles}`}
              >
                {/* Visual Icon */}
                <div className={`p-2 rounded-xl shrink-0 ${iconStyles}`}>
                  {isSuccess && <CheckCircle2 className="h-4 w-4" />}
                  {isError && <AlertCircle className="h-4 w-4" />}
                  {isWarning && <AlertTriangle className="h-4 w-4" />}
                  {isInfo && <Info className="h-4 w-4" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <h4 className="text-xs font-black tracking-tight text-white uppercase leading-snug">
                    {t.title}
                  </h4>
                  {t.description && (
                    <p className="text-[11px] text-slate-300 font-medium mt-1 leading-relaxed break-words">
                      {t.description}
                    </p>
                  )}
                  {t.action && (
                    <button
                      onClick={() => {
                        t.action?.onClick();
                        dismissToast(t.id);
                      }}
                      className="mt-2.5 px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition"
                    >
                      {t.action.label}
                    </button>
                  )}
                </div>

                {/* Close Button */}
                <button
                  onClick={() => dismissToast(t.id)}
                  aria-label="Close notification"
                  className="shrink-0 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                >
                  <X className="h-3.5 w-3.5" />
                </button>

                {/* Subtle progress indicator */}
                {t.duration && t.duration > 0 ? (
                  <motion.div
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
                        : 'bg-blue-500'
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

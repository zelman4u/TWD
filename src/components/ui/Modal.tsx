/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tagoloan Water District — Reusable Modal Component & Notification Design System
 *
 * Provides standardized responsive widths, compact header/body/footer proportions
 * (keeping chrome lean so notification/message bodies stay front-and-center),
 * internal body scrolling on overflow, portal support, and a clear 4-step reading order:
 * 1) Title -> 2) Main Message -> 3) Additional Details -> 4) Required Action.
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
export type ModalTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const MODAL_SIZE_CLASSES: Record<ModalSize, string> = {
  xs: 'max-w-[calc(100vw-1.5rem)] sm:max-w-sm',
  sm: 'max-w-[calc(100vw-1.5rem)] sm:max-w-md',
  md: 'max-w-[calc(100vw-1.5rem)] sm:max-w-lg',
  lg: 'max-w-[calc(100vw-1.5rem)] sm:max-w-xl md:max-w-2xl',
  xl: 'max-w-[calc(100vw-1.5rem)] sm:max-w-2xl lg:max-w-4xl',
  '2xl': 'max-w-[calc(100vw-1.5rem)] md:max-w-4xl xl:max-w-6xl',
  full: 'max-w-[calc(100vw-1.5rem)]',
};

const TONE_TEXT: Record<ModalTone, string> = {
  neutral: 'text-slate-300',
  info: 'text-sky-400',
  success: 'text-emerald-400',
  warning: 'text-amber-300',
  danger: 'text-rose-400',
};

const TONE_DOT: Record<ModalTone, string> = {
  neutral: 'bg-slate-400',
  info: 'bg-sky-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400',
};

const TONE_SURFACE: Record<ModalTone, string> = {
  neutral: 'bg-slate-950/60 border-slate-800 text-slate-200',
  info: 'bg-sky-950/25 border-sky-500/25 text-slate-200',
  success: 'bg-emerald-950/25 border-emerald-500/25 text-slate-200',
  warning: 'bg-amber-950/25 border-amber-500/30 text-slate-200',
  danger: 'bg-rose-950/25 border-rose-500/30 text-slate-200',
};

const TONE_HEADING: Record<ModalTone, string> = {
  neutral: 'text-slate-200',
  info: 'text-sky-300',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-rose-300',
};

export interface ModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  size?: ModalSize;
  zIndexClass?: string;
  backdropClassName?: string;
  dialogClassName?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  portal?: boolean;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  maxHeightClass?: string;
  children: React.ReactNode;
}

const ModalRoot: React.FC<ModalProps> = ({
  isOpen = true,
  onClose,
  size = 'md',
  zIndexClass = 'z-[110]',
  backdropClassName,
  dialogClassName,
  closeOnEscape = true,
  closeOnBackdrop = true,
  portal = false,
  id,
  ariaLabel,
  ariaLabelledBy,
  className = '',
  maxHeightClass = 'max-h-[88vh]',
  children,
}) => {
  useEffect(() => {
    if (!isOpen || !onClose || !closeOnEscape) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, closeOnEscape]);

  if (!isOpen) return null;

  const content = (
    <div
      id={id}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onClick={(e) => {
        if (closeOnBackdrop && onClose && e.target === e.currentTarget) {
          onClose();
        }
      }}
      className={
        backdropClassName ||
        `fixed inset-0 ${zIndexClass} bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 animate-fade-in`
      }
    >
      <div
        className={
          dialogClassName ||
          `w-full ${MODAL_SIZE_CLASSES[size]} ${maxHeightClass} h-auto flex flex-col overflow-hidden rounded-xl bg-slate-900 border border-slate-800 shadow-2xl text-slate-100 ${className}`
        }
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  if (portal && typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return content;
};

const TONE_BADGE: Record<ModalTone, string> = {
  neutral: 'bg-slate-800/90 border-slate-700/80 text-slate-300',
  info: 'bg-sky-500/10 border-sky-500/25 text-sky-300',
  success: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300',
  warning: 'bg-amber-500/10 border-amber-500/25 text-amber-300',
  danger: 'bg-rose-500/10 border-rose-500/25 text-rose-300',
};

export interface ModalHeaderStatus {
  label: React.ReactNode;
  tone?: ModalTone;
}

export interface NotificationModalHeaderProps {
  title: React.ReactNode;
  idCode?: React.ReactNode;
  status?: ModalHeaderStatus;
  timestamp?: React.ReactNode;
  category?: React.ReactNode;
  context?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: ModalTone;
  actions?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  titleId?: string;
  className?: string;
}

/**
 * Unified, compact header for all notification, advisory, inquiry, and alert modals.
 * - Row 1 (Flexbox): Prominent title + optional inline icon + close/action controls
 * - Row 2 (Single-line Flexbox): ID code, status pill, category/priority, and timestamp
 * - Optional Context Strip: Compact secondary sender/account line when applicable
 */
export const NotificationModalHeader: React.FC<NotificationModalHeaderProps> = ({
  title,
  idCode,
  status,
  timestamp,
  category,
  context,
  icon,
  tone = 'neutral',
  actions,
  onClose,
  closeLabel = 'Close dialog',
  titleId,
  className = '',
}) => {
  const statusTone = status?.tone || tone;
  const hasMetaRow = Boolean(idCode || status || category || timestamp);

  return (
    <div
      className={`px-4 sm:px-5 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0 ${className}`}
    >
      {/* Row 1: Flexbox alignment for Title + Actions + Close */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-start gap-2 min-w-0 flex-1 pt-0.5">
          {icon && (
            <span
              className={`shrink-0 inline-flex items-center justify-center mt-[2px] ${TONE_TEXT[tone]}`}
            >
              {icon}
            </span>
          )}
          <h3
            id={titleId}
            className="text-[15px] sm:text-base font-semibold text-white leading-snug tracking-tight break-words min-w-0"
          >
            {title}
          </h3>
        </div>

        {(actions || onClose) && (
          <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            {actions}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                title="Close"
                className="inline-flex items-center justify-center h-6 w-6 -mr-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Row 2: Single-line Meta-Information (ID, Status, Category, Timestamp) */}
      {hasMetaRow && (
        <div className="mt-1.5 flex items-center justify-between gap-2.5 flex-nowrap min-w-0">
          <div className="flex items-center flex-nowrap gap-2 min-w-0 flex-1 overflow-hidden">
            {idCode && (
              <span className="inline-flex items-center h-5 px-1.5 rounded bg-slate-800/90 border border-slate-700/80 font-mono text-[11px] leading-none font-medium text-slate-200 tabular-nums whitespace-nowrap shrink-0">
                {idCode}
              </span>
            )}
            {status && (
              <span
                className={`inline-flex items-center gap-1.5 h-5 px-2 rounded border text-[11px] leading-none font-medium whitespace-nowrap shrink-0 ${TONE_BADGE[statusTone]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT[statusTone]}`} />
                <span>{status.label}</span>
              </span>
            )}
            {category && (
              <span className="min-w-0 truncate text-[11.5px] leading-5 text-slate-400">
                {category}
              </span>
            )}
          </div>

          {timestamp && (
            <span className="inline-flex items-center h-5 font-mono text-[11px] leading-none tabular-nums text-slate-400 whitespace-nowrap shrink-0">
              {timestamp}
            </span>
          )}
        </div>
      )}

      {/* Optional Compact Secondary Context (Consumer / Sender details) */}
      {context && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-800/75 text-[11.5px] leading-snug text-slate-400">
          {context}
        </div>
      )}
    </div>
  );
};

export interface ModalHeaderProps {
  title: React.ReactNode;
  code?: React.ReactNode;
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  subtitleRight?: React.ReactNode;
  status?: ModalHeaderStatus;
  icon?: React.ReactNode;
  tone?: ModalTone;
  onClose?: () => void;
  closeLabel?: string;
  actions?: React.ReactNode;
  titleId?: string;
  className?: string;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  code,
  eyebrow,
  subtitle,
  subtitleRight,
  status,
  icon,
  tone = 'neutral',
  onClose,
  closeLabel = 'Close dialog',
  actions,
  titleId,
  className = '',
}) => {
  const hasTopBarMeta = Boolean(code || eyebrow || status);
  const statusTone = status?.tone || tone;

  if (!hasTopBarMeta) {
    return (
      <div
        className={`px-4 sm:px-5 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0 ${className}`}
      >
        <div className="flex items-center justify-between gap-3 min-h-[24px]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {icon && (
              <span className={`shrink-0 inline-flex items-center justify-center ${TONE_TEXT[tone]}`}>
                {icon}
              </span>
            )}
            <h3
              id={titleId}
              className="text-[15px] sm:text-base font-semibold text-white leading-snug tracking-tight truncate"
            >
              {title}
            </h3>
          </div>

          {(actions || onClose) && (
            <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
              {actions}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={closeLabel}
                  className="inline-flex items-center justify-center h-6 w-6 -mr-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
        {(subtitle || subtitleRight) && (
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-slate-400 leading-normal">
            {subtitle && <div className="min-w-0">{subtitle}</div>}
            {subtitleRight && <div className="shrink-0 ml-auto">{subtitleRight}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`px-4 sm:px-5 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0 ${className}`}
    >
      {/* Row 1: Single-line aligned bar for code, metadata, status, actions, and close */}
      <div className="flex items-center justify-between gap-3 min-h-[24px] min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon && (
            <span className={`shrink-0 inline-flex items-center justify-center h-5 ${TONE_TEXT[tone]}`}>
              {icon}
            </span>
          )}
          {code && (
            <span className="inline-flex items-center h-5 px-1.5 rounded bg-slate-800/90 border border-slate-700/80 font-mono text-[11px] leading-none font-medium text-slate-200 tabular-nums shrink-0 whitespace-nowrap">
              {code}
            </span>
          )}
          {eyebrow && (
            <div className="min-w-0 truncate text-xs leading-5 text-slate-400">
              {eyebrow}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
          {status && (
            <span
              className={`inline-flex items-center gap-1.5 h-5 px-2 rounded border text-[11px] leading-none font-medium whitespace-nowrap ${TONE_BADGE[statusTone]}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT[statusTone]}`} />
              <span>{status.label}</span>
            </span>
          )}
          {actions}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="inline-flex items-center justify-center h-6 w-6 -mr-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Prominent Title */}
      <h3
        id={titleId}
        className="text-[15px] sm:text-base font-semibold text-white leading-snug tracking-tight mt-1 break-words"
      >
        {title}
      </h3>

      {/* Row 3: Baseline-aligned secondary metadata */}
      {(subtitle || subtitleRight) && (
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-slate-400 leading-normal">
          {subtitle && <div className="min-w-0">{subtitle}</div>}
          {subtitleRight && <div className="shrink-0 ml-auto">{subtitleRight}</div>}
        </div>
      )}
    </div>
  );
};

export interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export const ModalBody: React.FC<ModalBodyProps> = ({
  children,
  className = '',
  noPadding = false,
}) => {
  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto ${
        noPadding ? '' : 'px-4 sm:px-5 py-3 space-y-3'
      } text-[13.5px] leading-[1.6] text-slate-200 break-words ${className}`}
    >
      {children}
    </div>
  );
};

export interface ModalFooterProps {
  children: React.ReactNode;
  align?: 'end' | 'between' | 'start';
  className?: string;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
  children,
  align = 'end',
  className = '',
}) => {
  const alignClass =
    align === 'between'
      ? 'justify-between'
      : align === 'start'
      ? 'justify-start'
      : 'justify-end';

  return (
    <div
      className={`px-4 sm:px-5 py-2 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center ${alignClass} gap-2 shrink-0 ${className}`}
    >
      {children}
    </div>
  );
};

export interface NoticeDetailItem {
  label: string;
  value: React.ReactNode;
  tone?: ModalTone;
  mono?: boolean;
}

export const NoticeDetailGrid: React.FC<{
  items: NoticeDetailItem[];
  columns?: 2 | 3 | 4;
  className?: string;
}> = ({ items, columns = 2, className = '' }) => {
  if (!items || items.length === 0) return null;
  const colClass =
    columns === 4
      ? 'grid-cols-2 sm:grid-cols-4'
      : columns === 3
      ? 'grid-cols-1 sm:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2';

  return (
    <div
      className={`grid ${colClass} gap-2 rounded-xl bg-slate-950/75 border border-slate-800 px-3 py-2 ${className}`}
    >
      {items.map((item, idx) => {
        const valColor =
          item.tone && item.tone !== 'neutral' ? TONE_HEADING[item.tone] : 'text-slate-100';
        return (
          <div key={idx} className="min-w-0">
            <div className="text-[11px] font-medium text-slate-400 leading-tight">
              {item.label}
            </div>
            <div
              className={`text-xs font-semibold mt-0.5 break-words ${valColor} ${
                item.mono ? 'font-mono tabular-nums' : ''
              }`}
            >
              {item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export interface ActionGuidanceBoxProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  tone?: ModalTone;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const ActionGuidanceBox: React.FC<ActionGuidanceBoxProps> = ({
  title = 'Required Next Step',
  description,
  tone = 'info',
  icon,
  children,
  className = '',
}) => {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 flex items-start gap-2.5 ${TONE_SURFACE[tone]} ${className}`}
    >
      {icon && (
        <div className={`shrink-0 mt-0.5 ${TONE_HEADING[tone]}`}>
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && (
          <div className={`text-xs font-semibold leading-snug ${TONE_HEADING[tone]}`}>
            {title}
          </div>
        )}
        {description && (
          <div className="text-[13px] text-slate-200 leading-relaxed break-words">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

export interface ModalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'ghost';
  size?: 'sm' | 'md';
}

const BUTTON_VARIANTS: Record<NonNullable<ModalButtonProps['variant']>, string> = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/40',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700',
  danger: 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-500/40',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/40',
  warning: 'bg-amber-600 hover:bg-amber-500 text-white border border-amber-500/40',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-300 hover:text-white border border-transparent',
};

export const ModalButton: React.FC<ModalButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}) => {
  const sizeClass = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-1.5 text-xs';
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${sizeClass} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
  Button: ModalButton,
  DetailGrid: NoticeDetailGrid,
  Guidance: ActionGuidanceBox,
});

export type ModalShellProps = ModalProps;
export const ModalShell = Modal;

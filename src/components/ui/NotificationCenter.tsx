/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tagoloan Water District — Shared Notification UI Design System
 *
 * Unifies notification bells, dropdown popovers, list item rows, and inline banners
 * across both the Admin Portal and Consumer Portal using consistent proportions,
 * dark-slate surfaces, semantic tone icon boxes, and a clear 4-step reading order:
 * 1) Category & Metadata -> 2) Concise Title -> 3) Readable Preview/Message -> 4) Primary Action.
 */

import React from 'react';
import { Bell, ChevronRight, X } from 'lucide-react';

export type NotificationTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'indigo' | 'cyan' | 'purple';


const NOTIF_TONE_LABEL: Record<NotificationTone, string> = {
  neutral: 'text-slate-300',
  info: 'text-sky-400',
  success: 'text-emerald-400',
  warning: 'text-amber-300',
  danger: 'text-rose-400',
  indigo: 'text-indigo-400',
  cyan: 'text-cyan-400',
  purple: 'text-purple-400',
};

const NOTIF_BANNER_BORDER: Record<NotificationTone, string> = {
  neutral: 'border-slate-700',
  info: 'border-sky-500/45',
  success: 'border-emerald-500/45',
  warning: 'border-amber-500/45',
  danger: 'border-rose-500/45',
  indigo: 'border-indigo-500/45',
  cyan: 'border-cyan-500/45',
  purple: 'border-purple-500/45',
};

export interface NotificationBellButtonProps {
  id?: string;
  unreadCount: number;
  isOpen: boolean;
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
}

export const NotificationBellButton: React.FC<NotificationBellButtonProps> = ({
  id,
  unreadCount,
  isOpen,
  onClick,
  title = 'Notifications',
  ariaLabel = 'Toggle Notifications Menu',
}) => (
  <button
    type="button"
    id={id}
    onClick={onClick}
    aria-expanded={isOpen}
    aria-label={ariaLabel}
    title={title}
    className={`relative h-10 w-10 flex items-center justify-center rounded-xl border transition cursor-pointer shrink-0 ${
      isOpen
        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/25'
        : 'bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white border-slate-700 shadow-xs'
    }`}
  >
    <Bell className={`h-4 w-4 ${isOpen ? 'text-white' : 'text-sky-400'}`} />
    {unreadCount > 0 && (
      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-mono tabular-nums font-bold flex items-center justify-center ring-2 ring-slate-950 leading-none">
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    )}
  </button>
);

export interface NotificationDropdownShellProps {
  id?: string;
  title: string;
  unreadCount: number;
  isEmpty?: boolean;
  emptyText?: string;
  onMarkAllRead?: () => void;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const NotificationDropdownShell: React.FC<NotificationDropdownShellProps> = ({
  id,
  title,
  unreadCount,
  isEmpty = false,
  emptyText = 'No notifications yet.',
  onMarkAllRead,
  onClose,
  footer,
  children,
}) => (
  <div
    id={id}
    className="fixed inset-x-3 top-16 sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-2 sm:w-[430px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-[120] overflow-hidden text-slate-100"
  >
    {/* Unified Compact Header */}
    <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <Bell className="h-4 w-4 text-sky-400 shrink-0" />
        <h4 className="text-sm font-semibold text-white truncate">{title}</h4>
        {unreadCount > 0 && (
          <>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-xs font-mono tabular-nums font-medium text-rose-400 whitespace-nowrap shrink-0">
              {unreadCount} unread
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
        {unreadCount > 0 && onMarkAllRead && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline transition cursor-pointer whitespace-nowrap"
            title="Mark all notifications as read"
          >
            Mark all read
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-1 -mr-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition cursor-pointer shrink-0"
          aria-label="Close notifications"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>

    {/* Scrollable Notification Feed */}
    <div className="max-h-[65vh] sm:max-h-[420px] overflow-y-auto divide-y divide-slate-800/80">
      {isEmpty ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">{emptyText}</div>
      ) : (
        children
      )}
    </div>

    {/* Compact Unified Footer */}
    {footer && (
      <div className="px-4 py-2 bg-slate-900 border-t border-slate-800">
        {footer}
      </div>
    )}
  </div>
);

export interface NotificationItemCardProps {
  tone?: NotificationTone;
  icon: React.ReactNode;
  categoryLabel: string;
  secondaryMeta?: string;
  timestampLabel: string;
  title: string;
  preview: string;
  referenceLabel?: string;
  actionLabel?: string;
  isUnread?: boolean;
  onClick: () => void;
  onMarkRead?: () => void;
}

export const NotificationItemCard: React.FC<NotificationItemCardProps> = ({
  tone = 'info',
  icon,
  categoryLabel,
  secondaryMeta,
  timestampLabel,
  title,
  preview,
  referenceLabel,
  actionLabel = 'Read details',
  isUnread = false,
  onClick,
  onMarkRead,
}) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
    className={`w-full text-left px-4 py-2.5 hover:bg-slate-800/65 transition cursor-pointer flex items-start gap-2.5 group ${
      isUnread ? 'bg-sky-950/25 border-l-2 border-l-sky-400' : ''
    }`}
  >
    <div className={`shrink-0 mt-0.5 ${NOTIF_TONE_LABEL[tone]}`}>
      {icon}
    </div>

    <div className="flex-1 min-w-0 space-y-0.5">
      {/* Row 1: Category · Secondary Meta | Timestamp · Dot · Mark read */}
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-slate-400">
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          <span className={`font-medium truncate ${NOTIF_TONE_LABEL[tone]}`}>
            {categoryLabel}
          </span>
          {secondaryMeta && (
            <>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-300 truncate">{secondaryMeta}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
          <span className="font-mono tabular-nums text-slate-400">{timestampLabel}</span>
          {isUnread && (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" aria-label="Unread notification" />
              {onMarkRead && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead();
                  }}
                  className="ml-0.5 text-[11px] font-medium text-sky-400 hover:text-sky-300 hover:underline transition cursor-pointer whitespace-nowrap"
                  title="Mark this notification as read"
                >
                  Mark read
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Row 2: Prominent Title */}
      <h4 className="text-[13.5px] font-semibold text-white leading-snug line-clamp-1">
        {title}
      </h4>

      {/* Row 3: Compact Body Preview */}
      {preview && (
        <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed break-words">
          {preview}
        </p>
      )}

      {/* Row 4: Reference · Primary Action */}
      <div className="flex items-center justify-between gap-2 pt-0.5 text-[11.5px] text-slate-400">
        <span className="font-mono tabular-nums truncate">
          {referenceLabel || ''}
        </span>
        <span className="font-medium text-sky-400 group-hover:text-sky-300 inline-flex items-center gap-0.5 shrink-0 whitespace-nowrap">
          <span>{actionLabel}</span>
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </div>
  </div>
);

export interface InlineNotificationBannerProps {
  id?: string;
  tone?: NotificationTone;
  icon: React.ReactNode;
  eyebrow: string;
  meta?: string;
  title: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  dismissAriaLabel?: string;
}

export const InlineNotificationBanner: React.FC<InlineNotificationBannerProps> = ({
  id,
  tone = 'info',
  icon,
  eyebrow,
  meta,
  title,
  description,
  actions,
  onDismiss,
  dismissAriaLabel = 'Dismiss notification',
}) => (
  <div
    id={id}
    role="status"
    className={`bg-slate-900 border ${NOTIF_BANNER_BORDER[tone]} text-slate-100 rounded-xl px-4 py-2.5 sm:py-3 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in`}
  >
    <div className="flex items-start gap-2.5 min-w-0">
      <div className={`shrink-0 mt-0.5 ${NOTIF_TONE_LABEL[tone]}`}>
        {icon}
      </div>
      <div className="space-y-0.5 min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-slate-400">
          <span className={`font-medium ${NOTIF_TONE_LABEL[tone]}`}>{eyebrow}</span>
          {meta && (
            <>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono tabular-nums text-slate-300">{meta}</span>
            </>
          )}
        </div>
        <h4 className="text-sm font-semibold text-white leading-snug">{title}</h4>
        <div className="text-xs sm:text-[13px] text-slate-200 leading-relaxed max-w-3xl">
          {description}
        </div>
      </div>
    </div>
    {(actions || onDismiss) && (
      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        {actions}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition cursor-pointer shrink-0"
            aria-label={dismissAriaLabel}
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )}
  </div>
);

export { NotificationModalHeader } from './Modal';
export type { NotificationModalHeaderProps } from './Modal';

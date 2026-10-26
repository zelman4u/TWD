/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import { Search, X } from 'lucide-react';

export interface SmartSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variant?: 'dark' | 'light';
  resultCount?: number;
  totalCount?: number;
  suggestions?: string[];
  className?: string;
  inputClassName?: string;
  id?: string;
  ariaLabel?: string;
}

export const SmartSearchBar: React.FC<SmartSearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Search by name, account #, meter #, barangay, or phone...',
  variant = 'dark',
  resultCount,
  totalCount,
  suggestions,
  className = '',
  inputClassName = '',
  id,
  ariaLabel,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = value.trim().length > 0;
  const showCount = hasQuery && typeof resultCount === 'number';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && value.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      onChange('');
    }
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  const isDark = variant === 'dark';

  return (
    <div className={`w-full ${className}`}>
      <div className="relative flex items-center w-full">
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 pl-3.5 flex items-center transition-colors ${
            hasQuery
              ? isDark
                ? 'text-blue-400'
                : 'text-blue-600'
              : isDark
              ? 'text-slate-400'
              : 'text-slate-400'
          }`}
        >
          <Search className="h-4 w-4 shrink-0" />
        </div>

        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          autoComplete="off"
          spellCheck={false}
          className={`w-full min-h-[42px] rounded-xl pl-10 ${
            showCount ? 'pr-28 sm:pr-32' : value.length > 0 ? 'pr-10' : 'pr-3.5'
          } py-2.5 text-xs sm:text-xs font-medium transition focus:outline-none focus:ring-2 ${
            isDark
              ? 'bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 hover:border-slate-700 focus:border-blue-500 focus:ring-blue-500/25'
              : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 hover:bg-white hover:border-slate-300 focus:bg-white focus:border-blue-500 focus:ring-blue-500/20'
          } ${inputClassName}`}
        />

        {(value.length > 0 || showCount) && (
          <div className="absolute inset-y-0 right-1.5 flex items-center gap-1.5">
            {showCount && (
              <span
                className={`text-[11px] font-mono tabular-nums font-semibold px-2 py-0.5 rounded-lg select-none pointer-events-none ${
                  resultCount === 0
                    ? isDark
                      ? 'text-rose-400 bg-rose-950/60'
                      : 'text-rose-600 bg-rose-50'
                    : isDark
                    ? 'text-sky-300 bg-slate-900 border border-slate-800'
                    : 'text-blue-700 bg-blue-50 border border-blue-100'
                }`}
              >
                {typeof totalCount === 'number'
                  ? `${resultCount}/${totalCount}`
                  : `${resultCount} found`}
              </span>
            )}

            {value.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                title="Clear search (Esc)"
                aria-label="Clear search"
                className={`min-h-[30px] min-w-[30px] rounded-lg flex items-center justify-center transition cursor-pointer ${
                  isDark
                    ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {suggestions && suggestions.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <span
            className={`text-[10px] font-semibold ${
              isDark ? 'text-slate-500' : 'text-slate-400'
            }`}
          >
            Quick search:
          </span>
          {suggestions.map((chip) => {
            const active = value.trim().toLowerCase() === chip.toLowerCase();
            return (
              <button
                key={chip}
                type="button"
                onClick={() => onChange(active ? '' : chip)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white'
                    : isDark
                    ? 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
                }`}
              >
                {chip}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SmartSearchBar;

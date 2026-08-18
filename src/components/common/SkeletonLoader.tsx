/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

// Base primitive for skeleton boxes with fluid shimmering animation
export function SkeletonBox({ className = '', key }: { className?: string; key?: React.Key }) {
  return (
    <div 
      key={key}
      className={`bg-slate-800/70 border border-slate-700/30 rounded-xl relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-linear-to-r before:from-transparent before:via-slate-700/30 before:to-transparent ${className}`}
    />
  );
}

// 1. Dashboard Skeleton: Header, 4 Stat metric tiles, charts section, and summary table
export function DashboardSkeleton({ 
  title = "Loading District Overview...", 
  cardsCount = 4 
}: { 
  title?: string; 
  cardsCount?: number; 
}) {
  return (
    <div className="space-y-6 animate-fade-in p-1 sm:p-2" id="dashboard-skeleton-view">
      {/* Top Banner / Breadcrumb Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <SkeletonBox className="h-5 w-5 rounded-lg" />
            <SkeletonBox className="h-5 w-40 rounded-lg" />
          </div>
          <SkeletonBox className="h-3 w-64 rounded-md" />
        </div>
        <div className="flex items-center space-x-2">
          <SkeletonBox className="h-9 w-28 rounded-xl" />
          <SkeletonBox className="h-9 w-32 rounded-xl" />
        </div>
      </div>

      {/* 4 Metric / KPI Cards Skeleton */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${cardsCount} gap-4`}>
        {Array.from({ length: cardsCount }).map((_, idx) => (
          <div 
            key={idx} 
            className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 space-y-3.5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <SkeletonBox className="h-3.5 w-24 rounded-md" />
              <SkeletonBox className="h-8 w-8 rounded-xl" />
            </div>
            <SkeletonBox className="h-8 w-32 rounded-lg" />
            <div className="flex items-center space-x-2 pt-1 border-t border-slate-800/60">
              <SkeletonBox className="h-3 w-16 rounded-md" />
              <SkeletonBox className="h-3 w-28 rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Middle Grid: Main Visualizer / Chart + Auxiliary Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900/70 border border-slate-800/80 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <SkeletonBox className="h-5 w-48 rounded-lg" />
              <SkeletonBox className="h-3 w-32 rounded-md" />
            </div>
            <SkeletonBox className="h-8 w-24 rounded-xl" />
          </div>
          <div className="h-64 sm:h-72 w-full flex items-end justify-between gap-3 pt-6 px-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <SkeletonBox className={`w-full rounded-t-lg h-${(i % 3 + 2) * 16}`} />
                <SkeletonBox className="h-3 w-8 rounded-sm" />
              </div>
            ))}
          </div>
        </div>

        {/* Side summary list skeleton */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <SkeletonBox className="h-5 w-32 rounded-lg" />
            <SkeletonBox className="h-4 w-12 rounded-md" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3 bg-slate-800/40 rounded-xl border border-slate-800/50 flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3">
                  <SkeletonBox className="h-9 w-9 rounded-xl shrink-0" />
                  <div className="space-y-1.5">
                    <SkeletonBox className="h-3.5 w-24 rounded-md" />
                    <SkeletonBox className="h-2.5 w-32 rounded-sm" />
                  </div>
                </div>
                <SkeletonBox className="h-5 w-16 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Ledger / Activity Table Skeleton */}
      <div className="bg-slate-900/70 border border-slate-800/80 rounded-3xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <SkeletonBox className="h-5 w-44 rounded-lg" />
            <SkeletonBox className="h-3 w-60 rounded-md" />
          </div>
          <div className="flex items-center space-x-2">
            <SkeletonBox className="h-8 w-28 rounded-xl" />
            <SkeletonBox className="h-8 w-24 rounded-xl" />
          </div>
        </div>
        <div className="space-y-2 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 w-full bg-slate-800/30 rounded-xl border border-slate-800/40 flex items-center px-4 justify-between gap-4">
              <SkeletonBox className="h-4 w-28 rounded-md" />
              <SkeletonBox className="h-4 w-36 rounded-md hidden sm:block" />
              <SkeletonBox className="h-4 w-20 rounded-md" />
              <SkeletonBox className="h-6 w-20 rounded-full" />
              <SkeletonBox className="h-7 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 2. Table & Records Skeleton (Consumers, Readings, Bills, Meters, Staff, etc.)
export function TableSkeleton({
  title = "Loading records...",
  rows = 6,
  columns = 5
}: {
  title?: string;
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-6 animate-fade-in shadow-sm">
      {/* Header controls skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <SkeletonBox className="h-6 w-48 rounded-lg" />
          <SkeletonBox className="h-3.5 w-64 rounded-md" />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <SkeletonBox className="h-10 w-52 rounded-xl" />
          <SkeletonBox className="h-10 w-28 rounded-xl" />
          <SkeletonBox className="h-10 w-32 rounded-xl" />
        </div>
      </div>

      {/* Filter chips skeleton */}
      <div className="flex items-center space-x-2 pb-1 overflow-x-auto">
        <SkeletonBox className="h-8 w-20 rounded-xl" />
        <SkeletonBox className="h-8 w-24 rounded-xl" />
        <SkeletonBox className="h-8 w-24 rounded-xl" />
        <SkeletonBox className="h-8 w-28 rounded-xl" />
      </div>

      {/* Table rows skeleton */}
      <div className="border border-slate-800 rounded-2xl overflow-hidden">
        {/* Table Header Bar */}
        <div className="h-12 bg-slate-800/60 border-b border-slate-800 flex items-center px-6 justify-between gap-4">
          {Array.from({ length: columns }).map((_, c) => (
            <SkeletonBox key={c} className={`h-4 ${c === 0 ? 'w-32' : 'w-24'} rounded-md`} />
          ))}
        </div>

        {/* Table Body Rows */}
        <div className="divide-y divide-slate-800/60">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="h-16 px-6 flex items-center justify-between gap-4 bg-slate-900/40">
              <div className="flex items-center space-x-3 flex-1">
                <SkeletonBox className="h-8 w-8 rounded-full shrink-0" />
                <div className="space-y-1.5 flex-1 max-w-xs">
                  <SkeletonBox className="h-4 w-3/4 rounded-md" />
                  <SkeletonBox className="h-2.5 w-1/2 rounded-sm" />
                </div>
              </div>
              <SkeletonBox className="h-4 w-28 rounded-md hidden sm:block" />
              <SkeletonBox className="h-4 w-20 rounded-md" />
              <SkeletonBox className="h-6 w-24 rounded-full" />
              <div className="flex items-center space-x-2">
                <SkeletonBox className="h-8 w-8 rounded-lg" />
                <SkeletonBox className="h-8 w-8 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pagination strip skeleton */}
      <div className="flex items-center justify-between pt-2">
        <SkeletonBox className="h-3.5 w-36 rounded-md" />
        <div className="flex items-center space-x-2">
          <SkeletonBox className="h-8 w-8 rounded-lg" />
          <SkeletonBox className="h-8 w-8 rounded-lg" />
          <SkeletonBox className="h-8 w-8 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// 3. Consumer Portal Dashboard Skeleton
export function ConsumerPortalSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in p-4 sm:p-6 max-w-7xl mx-auto" id="consumer-skeleton-view">
      {/* Consumer Welcome Header Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-3 flex-1">
          <div className="flex items-center space-x-2">
            <SkeletonBox className="h-6 w-28 rounded-full" />
            <SkeletonBox className="h-6 w-36 rounded-full" />
          </div>
          <SkeletonBox className="h-8 w-64 rounded-xl" />
          <SkeletonBox className="h-4 w-80 rounded-md" />
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <SkeletonBox className="h-12 w-full sm:w-36 rounded-2xl" />
          <SkeletonBox className="h-12 w-full sm:w-40 rounded-2xl" />
        </div>
      </div>

      {/* 4 Consumer Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <SkeletonBox className="h-3 w-20 rounded-md" />
              <SkeletonBox className="h-8 w-8 rounded-xl" />
            </div>
            <SkeletonBox className="h-7 w-28 rounded-lg" />
            <SkeletonBox className="h-3 w-36 rounded-md" />
          </div>
        ))}
      </div>

      {/* Meter Dial & Recent Statement Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <SkeletonBox className="h-6 w-48 rounded-lg" />
            <SkeletonBox className="h-7 w-24 rounded-xl" />
          </div>
          <SkeletonBox className="h-64 w-full rounded-2xl" />
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 space-y-4">
          <SkeletonBox className="h-6 w-36 rounded-lg" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="p-4 bg-slate-800/40 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <SkeletonBox className="h-4 w-24 rounded-md" />
                  <SkeletonBox className="h-5 w-16 rounded-full" />
                </div>
                <SkeletonBox className="h-6 w-20 rounded-lg" />
                <SkeletonBox className="h-3 w-32 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. Cards Grid Skeleton (for meter readers, announcements, barangays)
export function CardsGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-fade-in">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <SkeletonBox className="h-10 w-10 rounded-xl" />
              <div className="space-y-1.5">
                <SkeletonBox className="h-4 w-32 rounded-md" />
                <SkeletonBox className="h-3 w-20 rounded-sm" />
              </div>
            </div>
            <SkeletonBox className="h-6 w-16 rounded-full" />
          </div>
          <SkeletonBox className="h-12 w-full rounded-xl" />
          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <SkeletonBox className="h-3 w-24 rounded-md" />
            <SkeletonBox className="h-8 w-20 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

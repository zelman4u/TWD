/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Zap, RefreshCw, AlertOctagon, CheckCircle2, Printer } from 'lucide-react';
import { ScannerStatus } from '../../services/gracePeriodScannerService';

interface GracePeriodScannerCardProps {
  scannerStatus: ScannerStatus;
  disconnectionCount: number;
  activeCount: number;
  isManualScanning: boolean;
  onRunScanNow: () => void;
  onPrintNoticeSummary?: () => void;
}

/**
 * GracePeriodScannerCard
 * 
 * Visual administration monitor for the Automated 2-Month Payment Grace Period Service.
 * Displays real-time heartbeat, scan cycle timestamps, disconnection notice metrics,
 * on-demand manual trigger controls, and official Disconnection Notice Summary printing.
 */
export const GracePeriodScannerCard: React.FC<GracePeriodScannerCardProps> = ({
  scannerStatus,
  disconnectionCount,
  activeCount,
  isManualScanning,
  onRunScanNow,
  onPrintNoticeSummary,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-slate-100 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-start gap-3.5 min-w-0">
        <div className="p-2.5 bg-rose-500/15 text-rose-400 rounded-xl border border-rose-500/30 shrink-0 mt-0.5">
          <Zap className="h-5 w-5" />
        </div>
        
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-xs">
            <span className="font-semibold text-emerald-400">Active (Scans every 60s)</span>
            {scannerStatus.lastScanTimestamp && (
              <>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="font-mono tabular-nums text-slate-400">
                  Last scan {scannerStatus.lastScanTimestamp} (Cycle #{scannerStatus.totalScanCycles})
                </span>
              </>
            )}
          </div>

          <h4 className="text-sm sm:text-base font-bold text-white">
            2-Month Grace Period Scanner
          </h4>
          
          <p className="text-[13px] text-slate-300 leading-relaxed max-w-3xl">
            Monitors accounts against Tagoloan Water District's 60-day payment grace period. Delinquent accounts exceeding 60 days overdue or 2+ unpaid cycles receive an official <strong className="text-rose-300 font-semibold">Disconnection Notice</strong>. Accounts unpaid past approved extensions are disconnected; inactive lines (6+ months) become eligible for assumption.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center flex-wrap">
        <div className="text-right hidden sm:block mr-1">
          <div className="text-xs font-bold text-rose-400 font-mono tabular-nums flex items-center justify-end gap-1">
            <AlertOctagon className="h-3.5 w-3.5 text-rose-400" />
            <span>{disconnectionCount} Disconnection Notice{disconnectionCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="text-xs text-slate-400 flex items-center justify-end gap-1 tabular-nums">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>{activeCount} compliant accounts</span>
          </div>
        </div>

        {onPrintNoticeSummary && (
          <button
            type="button"
            onClick={onPrintNoticeSummary}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition border border-slate-700 cursor-pointer whitespace-nowrap"
            title="Print Disconnection Notice Summary Report"
          >
            <Printer className="h-3.5 w-3.5 text-rose-400" />
            <span>Print Summary</span>
          </button>
        )}

        <button
          type="button"
          onClick={onRunScanNow}
          disabled={isManualScanning}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          title="Manually trigger grace period scan right now"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isManualScanning ? 'animate-spin' : ''}`} />
          <span>{isManualScanning ? 'Scanning...' : 'Scan Now'}</span>
        </button>
      </div>
    </div>
  );
};

export default GracePeriodScannerCard;

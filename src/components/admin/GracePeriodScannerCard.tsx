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
    <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-rose-950 border border-slate-700/80 rounded-2xl p-4 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-start space-x-3.5 min-w-0">
        <div className="relative p-2.5 bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30 shrink-0">
          <Zap className="h-5 w-5" />
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-900"></span>
          </span>
        </div>
        
        <div className="space-y-1 min-w-0">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>Background Service: 2-Month Grace Period Scanner</span>
            </h4>
            <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Active (Scanning Every 60s)</span>
            </span>
            {scannerStatus.lastScanTimestamp && (
              <span className="text-[10px] font-mono text-slate-400">
                • Last scan: {scannerStatus.lastScanTimestamp} (Cycle #{scannerStatus.totalScanCycles})
              </span>
            )}
          </div>
          
          <p className="text-[11px] text-slate-300 leading-relaxed max-w-3xl">
            Automated service monitors account statuses against Tagoloan Water District's 2-month (60 days) payment grace period. Delinquent accounts exceeding 60 days overdue or 2+ unpaid cycles receive an official <strong className="text-rose-300 font-bold">Disconnection Notice</strong>. Consumers can request extensions; accounts still unpaid after extension expire are disconnected. Inactive lines (6+ months) become available for assumption.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center flex-wrap">
        <div className="text-right hidden sm:block mr-1">
          <div className="text-xs font-black text-rose-400 font-mono flex items-center justify-end gap-1">
            <AlertOctagon className="h-3 w-3 text-rose-500" />
            <span>{disconnectionCount} Disconnection Notice{disconnectionCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            <span>{activeCount} compliant accounts</span>
          </div>
        </div>

        {onPrintNoticeSummary && (
          <button
            type="button"
            onClick={onPrintNoticeSummary}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-100 hover:text-white font-black text-xs uppercase tracking-wider rounded-xl flex items-center space-x-1.5 transition border border-slate-700 shadow-xs cursor-pointer"
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
          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider rounded-xl flex items-center space-x-1.5 transition shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

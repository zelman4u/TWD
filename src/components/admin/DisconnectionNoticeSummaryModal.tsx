/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  X, 
  Printer, 
  AlertOctagon, 
  Calendar, 
  Clock, 
  ShieldAlert, 
  CheckCircle2, 
  UserCheck, 
  FileText,
  Building2,
  Filter
} from 'lucide-react';
import { Consumer, MeterReading } from '../../types';

interface DisconnectionNoticeSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  consumers: Consumer[];
  readings: MeterReading[];
  onGrantExtension?: (consumer: Consumer) => void;
  onDisconnectAccount?: (consumer: Consumer) => void;
  onAssumeAccount?: (consumer: Consumer) => void;
}

export const DisconnectionNoticeSummaryModal: React.FC<DisconnectionNoticeSummaryModalProps> = ({
  isOpen,
  onClose,
  consumers,
  readings,
  onGrantExtension,
  onDisconnectAccount,
  onAssumeAccount
}) => {
  const [selectedBarangay, setSelectedBarangay] = useState<string>('all');
  const [activeView, setActiveView] = useState<'summary' | 'single_notice'>('summary');
  const [selectedConsumerForNotice, setSelectedConsumerForNotice] = useState<Consumer | null>(null);

  if (!isOpen) return null;

  // Filter accounts under notice or disconnected
  const noticeConsumers = consumers.filter(
    c => c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice' || c.status === 'disconnected'
  );

  const filteredConsumers = selectedBarangay === 'all'
    ? noticeConsumers
    : noticeConsumers.filter(c => c.barangay === selectedBarangay);

  const barangaysList = Array.from(new Set(noticeConsumers.map(c => c.barangay).filter(Boolean))) as string[];

  const totalArrearsSum = filteredConsumers.reduce((sum, c) => sum + (c.outstandingBalance || 0), 0);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div 
      className="fixed inset-0 z-[130] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-fade-in print:p-0 print:bg-white"
      onClick={onClose}
    >
      <div 
        className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden print:border-none print:shadow-none print:bg-white print:text-black print:max-h-none print:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Control Bar (Hidden on print) */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0 bg-slate-950/70 print:hidden">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30">
              <AlertOctagon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Official Disconnection Notice Summary &amp; Cutoff Roster
              </h3>
              <p className="text-[11px] text-slate-400">
                Tagoloan Water District • 2-Month Delinquent Accounts Roster
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {activeView === 'single_notice' && (
              <button
                type="button"
                onClick={() => setActiveView('summary')}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 rounded-xl transition"
              >
                Back to Summary
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider rounded-xl transition flex items-center space-x-1.5 shadow-md cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Print Report</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
              title="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Filter Toolbar (Hidden on print) */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-900/50 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-bold flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" />
              <span>Filter Barangay:</span>
            </span>
            <select
              value={selectedBarangay}
              onChange={(e) => setSelectedBarangay(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-hidden"
            >
              <option value="all">All Barangays ({noticeConsumers.length})</option>
              {barangaysList.map(b => (
                <option key={b} value={b}>
                  {b} ({noticeConsumers.filter(c => c.barangay === b).length})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono font-bold">
            <span className="text-rose-400">
              {filteredConsumers.length} Accounts on Notice
            </span>
            <span className="text-slate-400">•</span>
            <span className="text-emerald-400">
              Total Delinquent: ₱{totalArrearsSum.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Modal Printable Content Area */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 print:p-0 print:overflow-visible text-slate-200 print:text-black">
          
          {activeView === 'summary' ? (
            /* Printable Summary Table */
            <div id="disconnection-summary-print-doc" className="space-y-6">
              {/* Official Header */}
              <div className="text-center space-y-1 pb-4 border-b-2 border-slate-800 print:border-black">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 print:text-slate-600">
                  Republic of the Philippines • Province of Misamis Oriental
                </p>
                <h2 className="text-lg font-black uppercase tracking-tight text-white print:text-black">
                  TAGOLOAN WATER DISTRICT
                </h2>
                <p className="text-xs text-slate-300 print:text-slate-700 font-medium">
                  Guani Building, National Highway, Tagoloan, Misamis Oriental
                </p>
                <div className="inline-block px-3 py-1 bg-rose-950/80 text-rose-300 border border-rose-800 print:bg-slate-100 print:text-black print:border-black rounded-lg text-xs font-black uppercase tracking-wider mt-2">
                  Official Disconnection Notice Summary Report &amp; Cutting Orders Roster
                </div>
                <p className="text-[10px] text-slate-400 print:text-slate-600 font-mono pt-1">
                  Generated: {new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}
                </p>
              </div>

              {/* Metrics Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center print:border print:border-black print:p-2">
                <div className="p-3 bg-slate-950 border border-slate-800 print:border-none rounded-xl">
                  <span className="text-[10px] uppercase font-bold text-slate-400 print:text-slate-600 block">Total Delinquent</span>
                  <span className="text-lg font-black font-mono text-white print:text-black">{filteredConsumers.length}</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 print:border-none rounded-xl">
                  <span className="text-[10px] uppercase font-bold text-slate-400 print:text-slate-600 block">Under Notice (2 Mo.)</span>
                  <span className="text-lg font-black font-mono text-rose-400 print:text-black">
                    {filteredConsumers.filter(c => c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice').length}
                  </span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 print:border-none rounded-xl">
                  <span className="text-[10px] uppercase font-bold text-slate-400 print:text-slate-600 block">Disconnected (Inactive)</span>
                  <span className="text-lg font-black font-mono text-amber-400 print:text-black">
                    {filteredConsumers.filter(c => c.status === 'disconnected').length}
                  </span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 print:border-none rounded-xl">
                  <span className="text-[10px] uppercase font-bold text-slate-400 print:text-slate-600 block">Accumulated Arrears</span>
                  <span className="text-lg font-black font-mono text-emerald-400 print:text-black">
                    ₱{totalArrearsSum.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Roster Table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-800 print:border-black">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="bg-slate-950 text-slate-400 print:bg-slate-100 print:text-black font-bold uppercase tracking-wider text-[10px] border-b border-slate-800 print:border-black">
                    <tr>
                      <th className="px-3 py-2.5">Acc #</th>
                      <th className="px-3 py-2.5">Consumer Name</th>
                      <th className="px-3 py-2.5">Barangay / Address</th>
                      <th className="px-3 py-2.5">Meter #</th>
                      <th className="px-3 py-2.5 text-right">Overdue</th>
                      <th className="px-3 py-2.5 text-right">Balance Due</th>
                      <th className="px-3 py-2.5">Extension / Cutoff Status</th>
                      <th className="px-3 py-2.5 text-right print:hidden">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 print:divide-black text-slate-200 print:text-black font-medium">
                    {filteredConsumers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                          No accounts currently on Disconnection Notice for the selected filter.
                        </td>
                      </tr>
                    ) : (
                      filteredConsumers.map((c, idx) => {
                        const hasActiveExt = c.extensionGrantedUntil && new Date(c.extensionGrantedUntil).getTime() > Date.now();
                        const isExpiredExt = c.extensionGrantedUntil && new Date(c.extensionGrantedUntil).getTime() <= Date.now();
                        const isDisc = c.status === 'disconnected';

                        return (
                          <tr key={c.accountNumber || idx} className="hover:bg-slate-800/40 print:hover:bg-transparent">
                            <td className="px-3 py-2.5 font-mono font-bold text-white print:text-black whitespace-nowrap">
                              {c.accountNumber}
                            </td>
                            <td className="px-3 py-2.5 font-bold text-white print:text-black">
                              <div>{c.name}</div>
                              {c.previousAccountOwnerName && (
                                <span className="text-[10px] text-slate-400 print:text-slate-600 block">
                                  Assumed from: {c.previousAccountOwnerName}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-slate-300 print:text-slate-800 text-[11px]">
                              {c.barangay || 'Tagoloan'}, {c.sitioZone || c.address}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-sky-300 print:text-black whitespace-nowrap">
                              {c.meterNumber || 'Unassigned'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-300 print:text-black whitespace-nowrap">
                              {c.gracePeriodOverdueDays || 60}d ({c.unpaidCyclesCount || 2} cycles)
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-black text-rose-400 print:text-black whitespace-nowrap">
                              ₱{(c.outstandingBalance || 0).toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-[11px]">
                              {isDisc ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-800 text-slate-300 border border-slate-700 print:border-black">
                                  Disconnected {c.isAvailableForAssumption ? '• 6 Mo. (Assume Ready)' : ''}
                                </span>
                              ) : hasActiveExt ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-950 text-amber-300 border border-amber-800 print:border-black">
                                  Extension: Until {c.extensionGrantedUntil}
                                </span>
                              ) : isExpiredExt ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-950 text-rose-300 border border-rose-800 print:border-black">
                                  Extension Expired
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-950/80 text-rose-300 border border-rose-800 print:border-black">
                                  Cutoff Scheduled
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right print:hidden whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedConsumerForNotice(c);
                                    setActiveView('single_notice');
                                  }}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold rounded-lg border border-slate-700 cursor-pointer"
                                  title="View and print individual notice letter"
                                >
                                  Notice Slip
                                </button>
                                {!isDisc && onGrantExtension && (
                                  <button
                                    type="button"
                                    onClick={() => onGrantExtension(c)}
                                    className="px-2 py-1 bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white text-[10px] font-bold rounded-lg border border-amber-600/40 cursor-pointer"
                                    title="Grant days extension"
                                  >
                                    Extend
                                  </button>
                                )}
                                {!isDisc && onDisconnectAccount && (
                                  <button
                                    type="button"
                                    onClick={() => onDisconnectAccount(c)}
                                    className="px-2 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-bold rounded-lg border border-rose-600/40 cursor-pointer"
                                    title="Physically disconnect account"
                                  >
                                    Disconnect
                                  </button>
                                )}
                                {isDisc && c.isAvailableForAssumption && onAssumeAccount && (
                                  <button
                                    type="button"
                                    onClick={() => onAssumeAccount(c)}
                                    className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg cursor-pointer"
                                    title="Assume / Transfer Account (6+ months inactive)"
                                  >
                                    Assume
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Signatures for Official Report */}
              <div className="pt-8 grid grid-cols-3 gap-6 text-center text-xs print:grid">
                <div className="space-y-8">
                  <p className="text-[11px] text-slate-400 print:text-slate-600">Prepared by:</p>
                  <div className="border-t border-slate-700 print:border-black pt-1">
                    <p className="font-bold text-white print:text-black">Billing &amp; Commercial Division</p>
                    <p className="text-[10px] text-slate-400 print:text-slate-600">Tagoloan Water District</p>
                  </div>
                </div>
                <div className="space-y-8">
                  <p className="text-[11px] text-slate-400 print:text-slate-600">Inspected by:</p>
                  <div className="border-t border-slate-700 print:border-black pt-1">
                    <p className="font-bold text-white print:text-black">Field Operations / Disconnection Officer</p>
                    <p className="text-[10px] text-slate-400 print:text-slate-600">Tagoloan Water District</p>
                  </div>
                </div>
                <div className="space-y-8">
                  <p className="text-[11px] text-slate-400 print:text-slate-600">Approved by:</p>
                  <div className="border-t border-slate-700 print:border-black pt-1">
                    <p className="font-bold text-white print:text-black">General Manager</p>
                    <p className="text-[10px] text-slate-400 print:text-slate-600">Tagoloan Water District</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Printable Individual Notice Letter */
            selectedConsumerForNotice && (
              <div id="single-notice-letter" className="max-w-2xl mx-auto space-y-6 p-6 bg-slate-950 border border-slate-800 rounded-3xl print:border-none print:bg-white print:p-0">
                <div className="text-center space-y-1 pb-4 border-b border-slate-800 print:border-black">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 print:text-slate-600">
                    Republic of the Philippines
                  </p>
                  <h3 className="text-base font-black uppercase text-white print:text-black">
                    TAGOLOAN WATER DISTRICT
                  </h3>
                  <p className="text-xs text-slate-400 print:text-slate-600">
                    Guani Building, National Highway, Tagoloan, Misamis Oriental
                  </p>
                  <div className="inline-block px-3 py-1 bg-rose-950 text-rose-300 border border-rose-800 print:bg-slate-100 print:text-black rounded-lg text-xs font-black uppercase mt-2">
                    OFFICIAL NOTICE OF WATER SERVICE DISCONNECTION
                  </div>
                </div>

                <div className="space-y-3 text-xs leading-relaxed text-slate-300 print:text-black">
                  <div className="flex justify-between font-mono">
                    <span>Date: <strong>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong></span>
                    <span>Notice #: <strong>DISC-{selectedConsumerForNotice.accountNumber}-{Date.now().toString().slice(-4)}</strong></span>
                  </div>

                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl print:bg-slate-50 print:border-black space-y-1">
                    <p><strong>To:</strong> {selectedConsumerForNotice.name}</p>
                    <p><strong>Account Number:</strong> {selectedConsumerForNotice.accountNumber}</p>
                    <p><strong>Meter Tag Number:</strong> {selectedConsumerForNotice.meterNumber}</p>
                    <p><strong>Service Address:</strong> {selectedConsumerForNotice.address}, {selectedConsumerForNotice.barangay}</p>
                  </div>

                  <p>
                    Dear Consumer,
                  </p>
                  <p>
                    Our administrative billing records indicate that your water utility account has exceeded <strong>two (2) months of unpaid billing cycles</strong> with an accumulated outstanding arrears balance of <strong className="text-rose-400 print:text-black font-mono">₱{(selectedConsumerForNotice.outstandingBalance || 0).toFixed(2)}</strong>.
                  </p>
                  <p>
                    In accordance with Tagoloan Water District operational regulations, please be advised that our field disconnection team is scheduled to <strong>physically disconnect your water service connection</strong> within <strong>five (5) working days</strong> from the receipt of this notice, unless full payment or an approved extension agreement is executed.
                  </p>
                  <p>
                    If you require an extension of days to settle this balance, please visit the Tagoloan Water District office or submit a request through the consumer portal immediately.
                  </p>
                  <p>
                    Please note: Disconnected accounts remain accessible in inactive mode, and all prior billing liabilities remain fully accountable to this account. Lines remaining inactive for six (6) months become eligible for assumption transfer.
                  </p>

                  <div className="pt-6 grid grid-cols-2 gap-4 text-center">
                    <div className="space-y-6">
                      <p className="text-[10px] text-slate-400 print:text-slate-600">Issued by:</p>
                      <div className="border-t border-slate-700 print:border-black pt-1">
                        <p className="font-bold">Commercial Accounts Officer</p>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <p className="text-[10px] text-slate-400 print:text-slate-600">Approved by:</p>
                      <div className="border-t border-slate-700 print:border-black pt-1">
                        <p className="font-bold">General Manager, TWD</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

        </div>
      </div>
    </div>
  );
};

export default DisconnectionNoticeSummaryModal;

import React, { useState, useEffect } from 'react';
import { 
  Building,
  Building2, 
  Home,
  Gauge, 
  Activity, 
  Receipt, 
  CreditCard, 
  ShieldCheck, 
  FileSpreadsheet, 
  Search, 
  Filter, 
  Download, 
  Printer,
  Layers,
  Moon,
  Sun,
  CheckCircle, 
  Check, 
  Calendar, 
  MapPin, 
  UserCheck, 
  Clock, 
  Database,
  ArrowUpDown,
  X
} from 'lucide-react';
import { Consumer, WaterMeter, MeterReading, AuditLog } from '../../types';
import { TablePagination } from '../common/TablePagination';
import { SmartSearchBar } from '../common/SmartSearchBar';
import { Modal, ModalHeader, ModalBody, ModalFooter, ModalButton } from '../ui/Modal';
import { smartMatch } from '../../utils/smartSearch';
import {
  isOfficialBillIssued,
  getEffectiveRatePerM3,
  getReadingTotalAssessment
} from '../../utils/tariffCalculator';
import { isPendingConsumerStatus } from '../../utils/installationWorkflow';
import {
  compareAuditLogsCanonical,
  compareConsumersCanonical,
  compareMetersCanonical,
  compareReadingsCanonical,
} from '../../utils/canonicalSort';
import { formatOdometerReading } from '../../utils/odometer';

interface RecordsArchiveViewProps {
  recordsTab: 'consumers' | 'meters' | 'readings' | 'bills' | 'payments' | 'audit';
  setRecordsTab: (tab: any) => void;
  consumers: Consumer[];
  meters: WaterMeter[];
  readings: MeterReading[];
  auditLogs: AuditLog[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  classificationFilter: 'all' | 'Residential' | 'Commercial';
  setClassificationFilter: (c: 'all' | 'Residential' | 'Commercial') => void;
  calculateCostOf: (usageOrReading: number | MeterReading, classification?: string) => number;
  handleVerifyReading: (id: string, status: 'verified' | 'flagged_abnormal') => void;
  handleDeleteReading: (id: string) => void;
  exportToCsv: (filename: string, headers: string[], rows: (string | number | undefined)[][]) => void;
}

type ArchiveModuleKey = 'consumers' | 'meters' | 'readings' | 'bills' | 'payments' | 'audit';

const ALL_ARCHIVE_MODULES: { key: ArchiveModuleKey; title: string; subtitle: string }[] = [
  { key: 'consumers', title: 'MASTER CONSUMERS ARCHIVE REGISTRY', subtitle: 'Connected Accounts, Classification & Service Addresses' },
  { key: 'meters', title: 'WATER METERS ASSET INVENTORY', subtitle: 'Meter Serials, Commissioning Dates & Assignments' },
  { key: 'readings', title: 'METER READINGS & ODOMETER AUDIT TRAIL', subtitle: 'Field Odometer Captures, Consumption & Verification' },
  { key: 'bills', title: 'OFFICIAL WATER BILLS ASSESSMENT LEDGER', subtitle: 'Billing Cycles, Tariff Charges & Settlement Status' },
  { key: 'payments', title: 'PAYMENT RECEIPTS & CASHIER LOG', subtitle: 'Official Receipts, Payment Instruments & Cash Settlements' },
  { key: 'audit', title: 'SYSTEM SECURITY & OPERATIONS AUDIT LOG', subtitle: 'Immutable Administrative & Operator Event Registry' },
];

const ARCHIVE_LOGO_URL = 'https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg';
const ARCHIVE_FALLBACK_LOGO_URL = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
const ARCHIVE_PH_SEAL_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Coat_of_arms_of_the_Philippines.svg/500px-Coat_of_arms_of_the_Philippines.svg.png';

export const RecordsArchiveView: React.FC<RecordsArchiveViewProps> = ({
  recordsTab,
  consumers,
  meters,
  readings,
  auditLogs,
  searchQuery,
  setSearchQuery,
  classificationFilter,
  setClassificationFilter,
  calculateCostOf,
  handleVerifyReading,
  handleDeleteReading,
  exportToCsv
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedArchiveRecord, setSelectedArchiveRecord] = useState<{
    type: 'consumer' | 'meter' | 'reading' | 'bill' | 'payment' | 'audit';
    data: any;
  } | null>(null);
  const [archivePrintState, setArchivePrintState] = useState<{
    scope: 'current_tab' | 'all_tabs' | 'single';
    singleRecord?: { type: 'consumer' | 'meter' | 'reading' | 'bill' | 'payment' | 'audit'; data: any };
  } | null>(null);
  const [archivePrintTheme, setArchivePrintTheme] = useState<'dark' | 'paper'>('dark');

  useEffect(() => {
    setCurrentPage(1);
  }, [recordsTab, searchQuery, classificationFilter]);

  useEffect(() => {
    if (!selectedArchiveRecord && !archivePrintState) return;
    const originalOverflow = document.body.style.overflow;
    if (archivePrintState) {
      document.body.style.overflow = 'hidden';
    }
    const handleEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (archivePrintState) {
          setArchivePrintState(null);
        } else {
          setSelectedArchiveRecord(null);
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      if (archivePrintState) {
        document.body.style.overflow = originalOverflow;
      }
      window.removeEventListener('keydown', handleEsc);
    };
  }, [selectedArchiveRecord, archivePrintState]);

  // Metrics for Cards
  const totalConsumers = consumers.length;
  const activeConsumers = consumers.filter(c => c.status === 'active').length;

  const totalMeters = meters.length;
  const activeMeters = meters.filter(m => m.status === 'active').length;

  const totalReadings = readings.length;
  const verifiedReadings = readings.filter(r => r.status === 'verified').length;

  const bills = readings.filter(r => isOfficialBillIssued(r));
  const paidBills = bills.filter(r => r.paymentStatus === 'paid');
  const totalCollectedAmount = paidBills.reduce((acc, r) => {
    const cost = r.paidAmount && r.paidAmount > 0 ? r.paidAmount : calculateCostOf(r, r.classification);
    return acc + cost;
  }, 0);

  // Filtered Consumers
  const filteredConsumers = consumers
    .filter(c => {
      const isPending = !c.accountNumber || c.accountNumber.trim() === '' || c.accountNumber.toUpperCase().startsWith('PENDING') || isPendingConsumerStatus(c.status);
      const matchesSearch = smartMatch(searchQuery, [
        c.name,
        c.accountNumber,
        c.meterNumber,
        c.address,
        c.barangay,
        c.sitioZone,
        c.contactNumber,
        c.email,
        c.businessName,
        c.consumerType || 'Residential',
        c.status,
        isPending ? 'pending id issuance' : 'active issued',
      ]);
      const matchesType = classificationFilter === 'all' || (c.consumerType || 'Residential') === classificationFilter;
      return matchesSearch && matchesType;
    })
    .sort(compareConsumersCanonical);

  // Filtered Meters
  const filteredMeters = meters
    .filter(m => {
      const linked = consumers.find(c => c.accountNumber === m.linkedAccountNumber);
      return smartMatch(searchQuery, [
        m.meterNumber,
        m.brand,
        m.linkedAccountNumber || 'unassigned',
        linked?.name,
        linked?.barangay,
        linked?.address,
        m.installationDate,
        m.status,
        m.status === 'maintenance' ? 'under maintenance' : m.status,
        m.remarks,
        m.statusUpdatedBy,
      ]);
    })
    .sort(compareMetersCanonical);

  // Filtered Readings
  const filteredReadings = readings
    .filter(r => {
      return smartMatch(searchQuery, [
        r.id,
        r.accountNumber,
        r.consumerName,
        r.meterNumber,
        r.billingPeriod,
        r.readingDate,
        r.meterReaderName,
        r.route,
        r.status,
        r.notes,
        formatOdometerReading(r.previousReading),
        formatOdometerReading(r.currentReading),
        `${r.consumption} m3`,
      ]);
    })
    .sort(compareReadingsCanonical);

  // Filtered Bills
  const filteredBills = bills
    .filter(r => {
      const billAmt = calculateCostOf(r, r.classification).toFixed(2);
      return smartMatch(searchQuery, [
        r.id,
        r.accountNumber,
        r.consumerName,
        r.meterNumber,
        r.billingPeriod,
        r.dueDate,
        r.paymentStatus || 'unpaid',
        r.classification || 'Residential',
        billAmt,
        `${r.consumption} m3`,
      ]);
    })
    .sort(compareReadingsCanonical);

  // Filtered Payments
  const filteredPayments = paidBills
    .filter(r => {
      const paidAmt = (r.paidAmount && r.paidAmount > 0 ? r.paidAmount : calculateCostOf(r, r.classification)).toFixed(2);
      return smartMatch(searchQuery, [
        r.transactionId,
        r.orNumber,
        r.paymentReference,
        r.accountNumber,
        r.consumerName,
        r.billingPeriod,
        r.paymentDate,
        r.readingDate,
        r.paymentMethod || 'Cash',
        paidAmt,
      ]);
    })
    .sort(
      (a, b) =>
        new Date(b.paymentDate || b.readingDate || 0).getTime() -
          new Date(a.paymentDate || a.readingDate || 0).getTime() ||
        compareReadingsCanonical(a, b)
    );

  // Filtered Audit Logs
  const filteredAuditLogs = auditLogs
    .filter(log => {
      const formattedTs = log.timestamp ? new Date(log.timestamp).toLocaleString() : '';
      return smartMatch(searchQuery, [
        log.userName,
        log.userRole,
        log.action,
        log.details,
        log.ipAddress,
        formattedTs,
        log.timestamp,
      ]);
    })
    .sort(compareAuditLogsCanonical);

  const activeTotalCount =
    recordsTab === 'consumers' ? consumers.length :
    recordsTab === 'meters' ? meters.length :
    recordsTab === 'readings' ? readings.length :
    recordsTab === 'bills' ? bills.length :
    recordsTab === 'payments' ? paidBills.length :
    auditLogs.length;

  const activeFilteredCount =
    recordsTab === 'consumers' ? filteredConsumers.length :
    recordsTab === 'meters' ? filteredMeters.length :
    recordsTab === 'readings' ? filteredReadings.length :
    recordsTab === 'bills' ? filteredBills.length :
    recordsTab === 'payments' ? filteredPayments.length :
    filteredAuditLogs.length;

  // CSV Export Triggers
  const handleExportCurrentView = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    if (recordsTab === 'consumers') {
      const headers = ['Account #', 'Consumer Name', 'Address', 'Meter #', 'Type', 'Business Name', 'Status'];
      const rows = filteredConsumers.map(c => [
        c.accountNumber,
        c.name,
        c.address,
        c.meterNumber,
        c.consumerType || 'Residential',
        c.businessName || '',
        c.status
      ]);
      exportToCsv(`TWD_Consumers_Archive_${timestamp}.csv`, headers, rows);
    } else if (recordsTab === 'meters') {
      const headers = ['Meter Tag #', 'Brand/Model', 'Installation Date', 'Assigned Account', 'Status', 'Last Remarks'];
      const rows = filteredMeters.map(m => [
        m.meterNumber,
        m.brand,
        m.installationDate,
        m.linkedAccountNumber || 'Unassigned',
        m.status === 'maintenance' ? 'Under Maintenance' : m.status,
        m.remarks || ''
      ]);
      exportToCsv(`TWD_Meters_Inventory_${timestamp}.csv`, headers, rows);
    } else if (recordsTab === 'readings') {
      const headers = ['Reading ID', 'Account #', 'Consumer Name', 'Previous Dial (00000-99999)', 'Current Dial (00000-99999)', 'Consumption (m³)', 'Date', 'Reader', 'Status'];
      const rows = filteredReadings.map(r => [
        r.id,
        r.accountNumber,
        r.consumerName,
        formatOdometerReading(r.previousReading),
        formatOdometerReading(r.currentReading),
        r.consumption,
        r.readingDate,
        r.meterReaderName || 'Field Reader',
        r.status
      ]);
      exportToCsv(`TWD_Readings_Trail_${timestamp}.csv`, headers, rows);
    } else if (recordsTab === 'bills') {
      const headers = ['Billing Period', 'Account #', 'Consumer Name', 'Consumption (m³)', 'Assessment (PHP)', 'Status'];
      const rows = filteredBills.map(b => [
        b.billingPeriod || 'Current Period',
        b.accountNumber,
        b.consumerName,
        b.consumption,
        calculateCostOf(b, b.classification).toFixed(2),
        b.paymentStatus || 'unpaid'
      ]);
      exportToCsv(`TWD_Bills_Ledger_${timestamp}.csv`, headers, rows);
    } else if (recordsTab === 'payments') {
      const headers = ['Receipt / TXN ID', 'Payment Date', 'Account #', 'Consumer Name', 'Method', 'Amount Paid (PHP)'];
      const rows = filteredPayments.map(p => [
        p.transactionId || 'OR-OFFICIAL',
        p.paymentDate || p.readingDate,
        p.accountNumber,
        p.consumerName,
        p.paymentMethod || 'Cash',
        (p.paidAmount && p.paidAmount > 0 ? p.paidAmount : calculateCostOf(p, p.classification)).toFixed(2)
      ]);
      exportToCsv(`TWD_Payment_Receipts_${timestamp}.csv`, headers, rows);
    } else if (recordsTab === 'audit') {
      const headers = ['Timestamp', 'User Operator', 'Action Performed', 'Event Details', 'Client IP'];
      const rows = filteredAuditLogs.map(a => [
        new Date(a.timestamp).toISOString(),
        a.userName,
        a.action,
        a.details,
        a.ipAddress
      ]);
      exportToCsv(`TWD_Security_Audit_${timestamp}.csv`, headers, rows);
    }
  };

  return (
    <div className="space-y-6" id="records-archive-view">
      {/* 1. ARCHIVE CONTEXT STATS BAR */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 min-h-[18px] text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider truncate">Master Accounts</span>
            <Building2 className="h-4 w-4 text-blue-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white tabular-nums leading-none">{totalConsumers.toLocaleString()}</div>
            <div className="text-xs text-slate-400 font-mono tabular-nums mt-1.5">{activeConsumers} Active Connected</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 min-h-[18px] text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider truncate">Meters Tracked</span>
            <Gauge className="h-4 w-4 text-cyan-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white tabular-nums leading-none">{totalMeters.toLocaleString()}</div>
            <div className="text-xs text-slate-400 font-mono tabular-nums mt-1.5">{activeMeters} Operational</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 min-h-[18px] text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider truncate">Field Readings</span>
            <Activity className="h-4 w-4 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-emerald-400 tabular-nums leading-none">{totalReadings.toLocaleString()}</div>
            <div className="text-xs text-slate-400 font-mono tabular-nums mt-1.5">{verifiedReadings} Verified Records</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 min-h-[18px] text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider truncate">Billed Assessments</span>
            <Receipt className="h-4 w-4 text-sky-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white tabular-nums leading-none">{bills.length.toLocaleString()}</div>
            <div className="text-xs text-slate-400 font-mono tabular-nums mt-1.5">{bills.length - paidBills.length} Pending Collections</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 min-h-[18px] text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider truncate">Cash Collections</span>
            <CreditCard className="h-4 w-4 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-emerald-400 tabular-nums leading-none truncate">₱{totalCollectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-emerald-300 font-mono tabular-nums mt-1.5">{paidBills.length} Valid Official Receipts</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between gap-2 min-h-[18px] text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider truncate">Audit Security</span>
            <ShieldCheck className="h-4 w-4 text-indigo-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white tabular-nums leading-none">{auditLogs.length.toLocaleString()}</div>
            <div className="text-xs text-slate-400 font-mono mt-1.5">Immutable System Events</div>
          </div>
        </div>
      </div>

      {/* 2. REGULATORY ARCHIVE TOOLBAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-xl">
        <div className="flex flex-col sm:flex-row flex-1 items-stretch sm:items-center gap-3">
          <div className="flex-1 max-w-xl w-full">
            <SmartSearchBar
              variant="dark"
              value={searchQuery}
              onChange={setSearchQuery}
              resultCount={activeFilteredCount}
              totalCount={activeTotalCount}
              placeholder={`Smart search ${recordsTab} by name, account #, meter tag #, barangay, phone, or date...`}
              id="records-archive-smart-search"
            />
          </div>

          {recordsTab === 'consumers' && (
            <div className="flex items-center space-x-2 shrink-0">
              <Filter className="h-3.5 w-3.5 text-slate-400 hidden sm:block" />
              <select
                value={classificationFilter}
                onChange={(e) => setClassificationFilter(e.target.value as any)}
                className="w-full sm:w-auto bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-bold py-2.5 px-3 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="all">All Classifications</option>
                <option value="Residential">Residential Only</option>
                <option value="Commercial">Commercial Only</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 shrink-0">
          <span className="text-[11px] font-mono tabular-nums text-slate-400 mr-1">
            Showing <strong className="text-white font-bold">{activeFilteredCount}</strong> of {activeTotalCount} entries
          </span>

          <button
            type="button"
            onClick={() => setArchivePrintState({ scope: 'current_tab' })}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs uppercase tracking-wider rounded-xl border border-slate-700 transition flex items-center space-x-1.5 cursor-pointer shadow-sm whitespace-nowrap shrink-0"
            title={`Print all ${activeFilteredCount} filtered records in the current tab`}
          >
            <Printer className="h-3.5 w-3.5 text-sky-400" />
            <span>Print Tab ({activeFilteredCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setArchivePrintState({ scope: 'all_tabs' })}
            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center space-x-1.5 cursor-pointer shadow-md whitespace-nowrap shrink-0"
            title="Print all 6 archive modules together in one master document"
          >
            <Layers className="h-3.5 w-3.5 text-white" />
            <span>Print All Records</span>
          </button>

          <button
            type="button"
            onClick={handleExportCurrentView}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center space-x-1.5 cursor-pointer shadow-md whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-white" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 3. ARCHIVE DATA PRESENTATION */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* SUBTAB A: CONSUMERS ARCHIVE */}
        {recordsTab === 'consumers' && (() => {
          const safePage = Math.min(currentPage, Math.max(1, Math.ceil(filteredConsumers.length / 10)));
          const paginatedConsumers = filteredConsumers.slice((safePage - 1) * 10, safePage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Account #</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Consumer Name</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Barangay / Address</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Assigned Meter #</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 text-center">Classification</th>
                      <th className="px-5 py-3.5 text-center">Connection Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedConsumers.map((c, cIdx) => {
                      const isPending = !c.accountNumber || c.accountNumber.trim() === '' || c.accountNumber.toUpperCase().startsWith('PENDING') || c.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || isPendingConsumerStatus(c.status);
                      return (
                      <tr
                        key={`rec-cons-${c.id || c.accountNumber || c.email || c.applicationNumber || cIdx}`}
                        onClick={() => setSelectedArchiveRecord({ type: 'consumer', data: c })}
                        title="Click row to open complete consumer archive record"
                        className={`transition cursor-pointer ${isPending ? 'bg-amber-950/20 hover:bg-amber-950/40' : 'hover:bg-slate-800/70'}`}
                      >
                        <td className="px-5 py-3 font-mono font-bold border-r border-slate-800/80">
                          {isPending ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[11px] font-bold">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                              <span>Pending ID</span>
                            </span>
                          ) : (
                            <span className="text-sky-400">{c.accountNumber}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 border-r border-slate-800/80">
                          <div className="flex items-center space-x-1.5">
                            <span className="font-bold text-white">{c.name}</span>
                            {isPending && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase">
                                NEW
                              </span>
                            )}
                          </div>
                          {c.businessName && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              DBA: {c.businessName}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 border-r border-slate-800/80">
                          <div className="flex items-center space-x-1 text-slate-300">
                            <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="truncate max-w-[220px]">{c.address}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 font-mono font-bold text-slate-200 border-r border-slate-800/80">
                          {c.meterNumber && c.meterNumber !== 'Pending' ? c.meterNumber : (
                            <span className="text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/80 text-[10px]">Pending Meter</span>
                          )}
                        </td>
                        <td className="px-5 py-3 border-r border-slate-800/80 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className={`inline-flex items-center justify-center gap-1.5 min-w-[108px] px-2.5 py-1 text-[10px] font-black uppercase rounded border shadow-2xs ${
                              c.consumerType === 'Commercial'
                                ? 'bg-purple-950/80 text-purple-300 border-purple-800/80'
                                : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                            }`}>
                              {c.consumerType === 'Commercial' ? (
                                <Building className="h-3 w-3 text-purple-400 shrink-0" />
                              ) : (
                                <Home className="h-3 w-3 text-emerald-400 shrink-0" />
                              )}
                              <span>{c.consumerType || 'Residential'}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border rounded ${
                            isPending
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 font-black'
                              : c.status === 'active'
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                              : c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice'
                              ? 'bg-rose-950/80 text-rose-300 border-rose-800/80 shadow-2xs font-black'
                              : 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                          }`}>
                            {isPending ? 'PENDING ID' : c.status}
                          </span>
                        </td>
                      </tr>
                      );
                    })}
                    {filteredConsumers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                          <Database className="h-6 w-6 mx-auto mb-2 text-slate-500" />
                          No archived consumers match the search query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={safePage}
                totalItems={filteredConsumers.length}
                pageSize={10}
                onPageChange={setCurrentPage}
                itemName="consumer records"
              />
            </div>
          );
        })()}

        {/* SUBTAB B: METERS INVENTORY */}
        {recordsTab === 'meters' && (() => {
          const safePage = Math.min(currentPage, Math.max(1, Math.ceil(filteredMeters.length / 10)));
          const paginatedMeters = filteredMeters.slice((safePage - 1) * 10, safePage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Meter Tag Number</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Manufacturer / Brand</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Commissioning Date</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Assigned Account</th>
                      <th className="px-5 py-3.5 text-center">Operational State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedMeters.map((m, mIdx) => (
                      <tr
                        key={`rec-meter-${m.meterNumber || m.id || mIdx}`}
                        onClick={() => setSelectedArchiveRecord({ type: 'meter', data: m })}
                        title="Click row to open complete water meter record"
                        className="hover:bg-slate-800/70 transition cursor-pointer"
                      >
                        <td className="px-5 py-3 font-mono font-bold text-white border-r border-slate-800/80">
                          {m.meterNumber}
                        </td>
                        <td className="px-5 py-3 font-bold text-slate-200 border-r border-slate-800/80">
                          {m.brand}
                        </td>
                        <td className="px-5 py-3 font-mono text-slate-400 border-r border-slate-800/80">
                          {m.installationDate}
                        </td>
                        <td className="px-5 py-3 font-mono font-bold text-sky-400 border-r border-slate-800/80">
                          {m.linkedAccountNumber || <span className="text-slate-500 font-normal">Unassigned</span>}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border rounded ${
                            m.status === 'active'
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                              : m.status === 'maintenance'
                              ? 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                              : m.status === 'inactive'
                              ? 'bg-slate-800 text-slate-300 border-slate-700'
                              : 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                          }`}>
                            {m.status === 'maintenance' ? 'Under Maintenance' : m.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredMeters.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                          <Gauge className="h-6 w-6 mx-auto mb-2 text-slate-500" />
                          No meters found matching your filter criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={safePage}
                totalItems={filteredMeters.length}
                pageSize={10}
                onPageChange={setCurrentPage}
                itemName="water meters"
              />
            </div>
          );
        })()}

        {/* SUBTAB C: READINGS TRAIL */}
        {recordsTab === 'readings' && (() => {
          const safePage = Math.min(currentPage, Math.max(1, Math.ceil(filteredReadings.length / 10)));
          const paginatedReadings = filteredReadings.slice((safePage - 1) * 10, safePage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse min-w-[900px]">
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3.5 border-r border-slate-800/80">Reading ID</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80 min-w-[200px]">Consumer Account</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80 text-center">Odometer Dial (Prev → Curr)</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80 text-right">Volume (m³)</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80">Reading Timestamp</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80">Field Reader</th>
                      <th className="px-4 py-3.5 text-center border-r border-slate-800/80">Audit Status</th>
                      <th className="px-4 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedReadings.map((r, rIdx) => (
                      <tr
                        key={`rec-reading-${r.id || rIdx}`}
                        onClick={() => setSelectedArchiveRecord({ type: 'reading', data: r })}
                        title="Click row to open complete meter reading record"
                        className="hover:bg-slate-800/70 transition cursor-pointer"
                      >
                        <td className="px-4 py-3 font-mono font-bold text-slate-400 border-r border-slate-800/80">
                          {r.id}
                        </td>
                        <td className="px-4 py-3 border-r border-slate-800/80">
                          <span className="font-bold font-mono text-sky-400 block text-xs">{r.accountNumber}</span>
                          <span className="text-white font-bold">{r.consumerName}</span>
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-slate-300 text-center border-r border-slate-800/80">
                          {formatOdometerReading(r.previousReading)} → <strong className="text-white font-bold">{formatOdometerReading(r.currentReading)}</strong>
                        </td>
                        <td className="px-4 py-3 font-mono font-black text-sky-400 text-right border-r border-slate-800/80">
                          {r.consumption} m³
                        </td>
                        <td className="px-4 py-3 text-slate-400 font-mono text-[11px] border-r border-slate-800/80">
                          {r.readingDate}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-300 border-r border-slate-800/80">
                          {r.meterReaderName || 'Field Reader'}
                        </td>
                        <td className="px-4 py-3 text-center border-r border-slate-800/80">
                          <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border rounded ${
                            r.status === 'verified'
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                              : r.status === 'pending'
                              ? 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                              : 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {r.status !== 'verified' ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVerifyReading(r.id, 'verified');
                                }}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase transition flex items-center space-x-1 cursor-pointer"
                              >
                                <CheckCircle className="h-3 w-3" />
                                <span>Verify</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-emerald-300 font-bold bg-emerald-950/80 px-2 py-0.5 border border-emerald-800/80 flex items-center space-x-1">
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span>Verified</span>
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteReading(r.id);
                              }}
                              className="px-2 py-1 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 font-bold text-[10px] uppercase rounded border border-rose-800/60 transition cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredReadings.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                          <Activity className="h-6 w-6 mx-auto mb-2 text-slate-500" />
                          No archived readings found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={safePage}
                totalItems={filteredReadings.length}
                pageSize={10}
                onPageChange={setCurrentPage}
                itemName="meter readings"
              />
            </div>
          );
        })()}

        {/* SUBTAB D: BILLS LEDGER */}
        {recordsTab === 'bills' && (() => {
          const safePage = Math.min(currentPage, Math.max(1, Math.ceil(filteredBills.length / 10)));
          const paginatedBills = filteredBills.slice((safePage - 1) * 10, safePage * 10);
          return (
            <div className="w-full min-w-0">
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[900px] table-fixed text-xs text-left border-collapse">
                  <colgroup>
                    <col className="w-[16%]" />
                    <col className="w-[15%]" />
                    <col className="w-[26%]" />
                    <col className="w-[13%]" />
                    <col className="w-[16%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 whitespace-nowrap">Billing Period</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 whitespace-nowrap">Account #</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 whitespace-nowrap">Consumer Name</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 text-right whitespace-nowrap">Volume (m³)</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 text-right whitespace-nowrap">Assessed Amount</th>
                      <th className="px-5 py-3.5 text-center whitespace-nowrap">Settlement Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedBills.map((r, bIdx) => {
                      const totalBill = calculateCostOf(r, r.classification);
                      return (
                        <tr
                          key={`rec-bill-${r.id || bIdx}`}
                          onClick={() => setSelectedArchiveRecord({ type: 'bill', data: r })}
                          title="Click row to open complete bill record"
                          className="hover:bg-slate-800/70 transition cursor-pointer"
                        >
                          <td className="px-5 py-3.5 font-mono tabular-nums font-bold text-white border-r border-slate-800/80 truncate" title={r.billingPeriod || 'Current Period'}>
                            {r.billingPeriod || 'Current Period'}
                          </td>
                          <td className="px-5 py-3.5 font-mono tabular-nums font-bold text-sky-400 border-r border-slate-800/80 truncate" title={r.accountNumber}>
                            {r.accountNumber}
                          </td>
                          <td className="px-5 py-3.5 font-bold text-white border-r border-slate-800/80 truncate" title={r.consumerName}>
                            {r.consumerName}
                          </td>
                          <td className="px-5 py-3.5 font-mono tabular-nums font-bold text-slate-300 text-right border-r border-slate-800/80 whitespace-nowrap">
                            {r.consumption} m³
                          </td>
                          <td className="px-5 py-3.5 font-mono tabular-nums font-black text-white text-right border-r border-slate-800/80 whitespace-nowrap">
                            ₱{totalBill.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-5 py-3.5 text-center whitespace-nowrap">
                            <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border rounded ${
                              r.paymentStatus === 'paid'
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                                : 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                            }`}>
                              {r.paymentStatus || 'unpaid'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredBills.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                          <Receipt className="h-6 w-6 mx-auto mb-2 text-slate-500" />
                          No assessed bills found matching query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={safePage}
                totalItems={filteredBills.length}
                pageSize={10}
                onPageChange={setCurrentPage}
                itemName="water bills"
              />
            </div>
          );
        })()}

        {/* SUBTAB E: PAYMENT RECEIPTS LOG */}
        {recordsTab === 'payments' && (() => {
          const safePage = Math.min(currentPage, Math.max(1, Math.ceil(filteredPayments.length / 10)));
          const paginatedPayments = filteredPayments.slice((safePage - 1) * 10, safePage * 10);
          return (
            <div className="w-full min-w-0">
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[900px] table-fixed text-xs text-left border-collapse">
                  <colgroup>
                    <col className="w-[17%]" />
                    <col className="w-[15%]" />
                    <col className="w-[15%]" />
                    <col className="w-[24%]" />
                    <col className="w-[14%]" />
                    <col className="w-[15%]" />
                  </colgroup>
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 whitespace-nowrap">Official Receipt #</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 whitespace-nowrap">Payment Date</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 whitespace-nowrap">Account #</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 whitespace-nowrap">Consumer Name</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 whitespace-nowrap">Payment Instrument</th>
                      <th className="px-5 py-3.5 text-right whitespace-nowrap">Settled Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedPayments.map((r, pIdx) => {
                      const totalBill = r.paidAmount && r.paidAmount > 0 ? r.paidAmount : calculateCostOf(r, r.classification);
                      return (
                        <tr
                          key={`rec-paid-${r.id || r.transactionId || r.orNumber || pIdx}`}
                          onClick={() => setSelectedArchiveRecord({ type: 'payment', data: r })}
                          title="Click row to open complete payment receipt record"
                          className="hover:bg-slate-800/70 transition cursor-pointer"
                        >
                          <td className="px-5 py-3.5 font-mono tabular-nums font-bold text-emerald-400 border-r border-slate-800/80 truncate">
                            {r.orNumber || r.transactionId || r.paymentReference || 'OR-OFFICIAL'}
                          </td>
                          <td className="px-5 py-3.5 text-slate-300 font-mono tabular-nums border-r border-slate-800/80 whitespace-nowrap">
                            {r.paymentDate || r.readingDate}
                          </td>
                          <td className="px-5 py-3.5 font-mono tabular-nums font-bold text-sky-400 border-r border-slate-800/80 truncate">
                            {r.accountNumber}
                          </td>
                          <td className="px-5 py-3.5 font-bold text-white border-r border-slate-800/80 truncate" title={r.consumerName}>
                            {r.consumerName}
                          </td>
                          <td className="px-5 py-3.5 font-bold text-slate-300 border-r border-slate-800/80 truncate">
                            {r.paymentMethod || 'Cash'}
                          </td>
                          <td className="px-5 py-3.5 font-mono tabular-nums font-black text-emerald-400 text-right whitespace-nowrap">
                            ₱{totalBill.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredPayments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                          <CreditCard className="h-6 w-6 mx-auto mb-2 text-slate-500" />
                          No payment receipts found matching query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={safePage}
                totalItems={filteredPayments.length}
                pageSize={10}
                onPageChange={setCurrentPage}
                itemName="payment receipts"
              />
            </div>
          );
        })()}

        {/* SUBTAB F: SECURITY AUDIT */}
        {recordsTab === 'audit' && (() => {
          const safePage = Math.min(currentPage, Math.max(1, Math.ceil(filteredAuditLogs.length / 10)));
          const paginatedAuditLogs = filteredAuditLogs.slice((safePage - 1) * 10, safePage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Audit Timestamp</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">User Operator</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Action Code</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Operation Details</th>
                      <th className="px-5 py-3.5 text-right">Host IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedAuditLogs.map((log, lIdx) => (
                      <tr
                        key={`rec-audit-${log.id || `${log.timestamp}-${lIdx}`}`}
                        onClick={() => setSelectedArchiveRecord({ type: 'audit', data: log })}
                        title="Click row to open complete security audit entry"
                        className="hover:bg-slate-800/70 transition cursor-pointer"
                      >
                        <td className="px-5 py-3 font-mono text-slate-400 text-[11px] border-r border-slate-800/80">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 font-bold text-white border-r border-slate-800/80">
                          {log.userName}
                        </td>
                        <td className="px-5 py-3 font-mono font-bold text-sky-400 border-r border-slate-800/80">
                          {log.action}
                        </td>
                        <td className="px-5 py-3 text-slate-300 border-r border-slate-800/80">
                          {log.details}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-slate-400 text-[11px]">
                          {log.ipAddress}
                        </td>
                      </tr>
                    ))}
                    {filteredAuditLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                          <ShieldCheck className="h-6 w-6 mx-auto mb-2 text-slate-500" />
                          No security audit log entries match the query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={safePage}
                totalItems={filteredAuditLogs.length}
                pageSize={10}
                onPageChange={setCurrentPage}
                itemName="audit log entries"
              />
            </div>
          );
        })()}
      </div>

      {/* Interactive Archive Record Complete Details Modal */}
      {selectedArchiveRecord && (() => {
        const { type, data } = selectedArchiveRecord;
        const modalTitle =
          type === 'consumer'
            ? 'Consumer Account Archive Details'
            : type === 'meter'
            ? 'Water Meter Registry Details'
            : type === 'reading'
            ? 'Meter Reading Record Details'
            : type === 'bill'
            ? 'Assessed Bill Statement Details'
            : type === 'payment'
            ? 'Payment Receipt Record Details'
            : 'Security Audit Log Entry';

        const eyebrowLabel =
          type === 'consumer'
            ? 'Archive · Consumer Account'
            : type === 'meter'
            ? 'Archive · Meter Asset'
            : type === 'reading'
            ? 'Archive · Reading Trail'
            : type === 'bill'
            ? 'Archive · Assessed Bill'
            : type === 'payment'
            ? 'Archive · Official Receipt'
            : 'Archive · Security Audit';

        const recordIdentifier =
          type === 'consumer'
            ? data.accountNumber || data.applicationNumber || 'Pending ID'
            : type === 'meter'
            ? `Meter Tag #${data.meterNumber}`
            : type === 'audit'
            ? new Date(data.timestamp).toLocaleString()
            : `Record #${data.orNumber || data.transactionId || data.id || 'N/A'}`;

        return (
          <Modal
            isOpen={true}
            onClose={() => setSelectedArchiveRecord(null)}
            size="lg"
            zIndexClass="z-50"
            ariaLabel={modalTitle}
          >
            <ModalHeader
              tone="info"
              icon={<Database className="h-4 w-4" />}
              eyebrow={`${eyebrowLabel} · ${recordIdentifier}`}
              title={modalTitle}
              onClose={() => setSelectedArchiveRecord(null)}
            />

            <ModalBody>
                {type === 'consumer' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/75 border border-slate-800 rounded-xl px-4 py-3 text-xs">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Consumer Name</span>
                      <span className="text-[13.5px] font-bold text-white mt-0.5 block">{data.name}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Official Account #</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-sky-400 mt-0.5 block">
                        {data.accountNumber || 'Pending ID'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Assigned Meter Tag #</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-white mt-0.5 block">
                        {data.meterNumber || 'Pending Meter'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Classification</span>
                      <span className="text-[13.5px] font-semibold text-slate-200 mt-0.5 block">{data.consumerType || 'Residential'}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Contact Number</span>
                      <span className="text-[13.5px] font-mono tabular-nums text-slate-200 mt-0.5 block">{data.contactNumber || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Email Address</span>
                      <span className="text-[13.5px] text-slate-200 mt-0.5 block break-all">{data.email || 'N/A'}</span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-[11px] font-semibold text-slate-400 block">Registered Service Address</span>
                      <span className="text-[13.5px] text-slate-200 mt-0.5 block leading-relaxed">{data.address}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Connection Status</span>
                      <span className="text-[13.5px] font-bold uppercase text-emerald-400 mt-0.5 block">{data.status}</span>
                    </div>
                    {data.applicationNumber && (
                      <div>
                        <span className="text-[11px] font-semibold text-slate-400 block">Application #</span>
                        <span className="text-[13.5px] font-mono tabular-nums text-sky-300 mt-0.5 block">{data.applicationNumber}</span>
                      </div>
                    )}
                  </div>
                )}

                {type === 'meter' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/75 border border-slate-800 rounded-xl px-4 py-3 text-xs">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Meter Tag Number</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-white mt-0.5 block">{data.meterNumber}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Brand / Manufacturer</span>
                      <span className="text-[13.5px] font-semibold text-slate-200 mt-0.5 block">{data.brand}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Commissioning Date</span>
                      <span className="text-[13.5px] font-mono tabular-nums text-slate-200 mt-0.5 block">{data.installationDate || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Assigned Account #</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-sky-400 mt-0.5 block">
                        {data.linkedAccountNumber || 'Unassigned'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Operational Status</span>
                      <span className="text-[13.5px] font-bold uppercase text-emerald-400 mt-0.5 block">{data.status}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Last Odometer Dial</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-white mt-0.5 block">
                        {formatOdometerReading(data.lastReadingValue ?? 0)}
                      </span>
                    </div>
                    {data.remarks && (
                      <div className="sm:col-span-2">
                        <span className="text-[11px] font-semibold text-slate-400 block">Remarks</span>
                        <span className="text-[13.5px] text-slate-200 mt-0.5 block leading-relaxed">{data.remarks}</span>
                      </div>
                    )}
                  </div>
                )}

                {(type === 'reading' || type === 'bill' || type === 'payment') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/75 border border-slate-800 rounded-xl px-4 py-3 text-xs">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Consumer Name</span>
                      <span className="text-[13.5px] font-bold text-white mt-0.5 block">{data.consumerName}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Account Number</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-sky-400 mt-0.5 block">#{data.accountNumber}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Billing Period</span>
                      <span className="text-[13.5px] font-semibold text-slate-200 mt-0.5 block">{data.billingPeriod || 'Current Period'}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Meter Tag Number</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-white mt-0.5 block">{data.meterNumber || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Odometer Dial (00000–99999)</span>
                      <span className="text-[13.5px] font-mono tabular-nums text-slate-200 mt-0.5 block">
                        Prev {formatOdometerReading(data.previousReading)} → Curr {formatOdometerReading(data.currentReading)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">
                        Consumption ({data.classification || 'Residential'} @ ₱{getEffectiveRatePerM3(data.classification === 'Commercial' ? 'Commercial' : 'Residential').toFixed(2)}/m³)
                      </span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-sky-400 mt-0.5 block">{data.consumption} m³</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Basic Water Charge</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-slate-200 mt-0.5 block">
                        ₱{getReadingTotalAssessment(data, data.classification === 'Commercial' ? 'Commercial' : 'Residential').basicCharge.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">2% Franchise Tax</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-indigo-300 mt-0.5 block">
                        ₱{getReadingTotalAssessment(data, data.classification === 'Commercial' ? 'Commercial' : 'Residential').franchiseTax.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Total Assessed Amount</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-white mt-0.5 block">
                        ₱{calculateCostOf(data, data.classification).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Late Penalty (10% After Due)</span>
                      <span className="text-[13.5px] font-mono tabular-nums font-bold text-amber-300 mt-0.5 block">
                        +₱{getReadingTotalAssessment(data, data.classification === 'Commercial' ? 'Commercial' : 'Residential').penaltyAmount.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Settlement Status</span>
                      <span className="text-[13.5px] font-bold uppercase text-emerald-400 mt-0.5 block">
                        {data.paymentStatus || data.status || 'unpaid'}
                      </span>
                    </div>
                    {(data.orNumber || data.transactionId) && (
                      <div>
                        <span className="text-[11px] font-semibold text-slate-400 block">OR / Reference #</span>
                        <span className="text-[13.5px] font-mono tabular-nums text-emerald-300 mt-0.5 block">
                          {data.orNumber || data.transactionId}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Date Recorded</span>
                      <span className="text-[13.5px] font-mono tabular-nums text-slate-200 mt-0.5 block">
                        {data.paymentDate || data.readingDate || 'N/A'}
                      </span>
                    </div>
                    {data.notes && (
                      <div className="sm:col-span-2">
                        <span className="text-[11px] font-semibold text-slate-400 block">Audit Notes</span>
                        <span className="text-[13.5px] text-slate-200 mt-0.5 block leading-relaxed">{data.notes}</span>
                      </div>
                    )}
                  </div>
                )}

                {type === 'audit' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/75 border border-slate-800 rounded-xl px-4 py-3 text-xs">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">User Operator</span>
                      <span className="text-[13.5px] font-bold text-white mt-0.5 block">{data.userName}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Action Code</span>
                      <span className="text-[13.5px] font-mono font-bold text-sky-400 mt-0.5 block">{data.action}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Timestamp</span>
                      <span className="text-[13.5px] font-mono tabular-nums text-slate-200 mt-0.5 block">
                        {new Date(data.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Host IP</span>
                      <span className="text-[13.5px] font-mono tabular-nums text-slate-200 mt-0.5 block">{data.ipAddress || '127.0.0.1'}</span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-[11px] font-semibold text-slate-400 block">Operation Details</span>
                      <p className="text-[13.5px] text-slate-200 leading-relaxed mt-1">{data.details}</p>
                    </div>
                  </div>
                )}
              </ModalBody>

              <ModalFooter>
                <ModalButton
                  variant="success"
                  onClick={() => {
                    const recordCopy = selectedArchiveRecord;
                    setSelectedArchiveRecord(null);
                    setArchivePrintState({ scope: 'single', singleRecord: recordCopy });
                  }}
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print Record</span>
                </ModalButton>
                <ModalButton
                  variant="secondary"
                  onClick={() => setSelectedArchiveRecord(null)}
                >
                  Close
                </ModalButton>
              </ModalFooter>
          </Modal>
        );
      })()}

      {/* Portaled Official Archive Print Preview Modal (Individual Record / Current Tab / All 6 Archive Modules) */}
      <Modal
        portal
        isOpen={Boolean(archivePrintState)}
        onClose={() => setArchivePrintState(null)}
        size="2xl"
        zIndexClass="z-[99999]"
        backdropClassName="fixed inset-0 z-[99999] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-5 overflow-hidden no-print-bg"
        dialogClassName="bg-slate-900 border border-slate-700 max-w-6xl w-full h-[90vh] max-h-[92vh] flex flex-col shadow-2xl rounded-2xl overflow-hidden text-slate-100"
        ariaLabel="Official Archive Print Preview"
      >
        {archivePrintState && (
          <>
            {/* Compact Toolbar (hidden when printing) */}
            <div className="flex-shrink-0 flex justify-between items-center px-4 sm:px-5 py-2.5 sm:py-3 bg-slate-950 border-b border-slate-800 no-print flex-wrap gap-2.5">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-slate-900 rounded-xl border border-slate-700 p-1 flex items-center justify-center shrink-0">
                  <img
                    src={ARCHIVE_LOGO_URL}
                    alt="Logo"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = ARCHIVE_FALLBACK_LOGO_URL;
                    }}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white tracking-tight leading-snug">
                    {archivePrintState.scope === 'single'
                      ? 'Official Individual Archive Record Print Preview'
                      : archivePrintState.scope === 'all_tabs'
                      ? 'Complete Central Archive Compendium (All 6 Modules)'
                      : `${ALL_ARCHIVE_MODULES.find(m => m.key === recordsTab)?.title || 'Archive'} Print Preview`}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {archivePrintState.scope === 'single'
                      ? 'Certified Single-Record Extract · Tagoloan Water District Archive'
                      : archivePrintState.scope === 'all_tabs'
                      ? 'Unpaginated Master Printout of Consumers, Meters, Readings, Bills, Receipts & Audit Logs'
                      : `All ${activeFilteredCount} filtered records included (unpaginated master print)`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {archivePrintState.scope !== 'single' && (
                  <div className="flex items-center bg-slate-900 border border-slate-700 p-0.5 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setArchivePrintState({ scope: 'current_tab' })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                        archivePrintState.scope === 'current_tab'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Current Tab ({activeFilteredCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setArchivePrintState({ scope: 'all_tabs' })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                        archivePrintState.scope === 'all_tabs'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      All 6 Archive Modules
                    </button>
                  </div>
                )}

                <div className="flex items-center bg-slate-900 border border-slate-700 p-0.5 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setArchivePrintTheme('dark')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer whitespace-nowrap ${
                      archivePrintTheme === 'dark'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    <span>Dark Comfort View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setArchivePrintTheme('paper')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer whitespace-nowrap ${
                      archivePrintTheme === 'paper'
                        ? 'bg-slate-200 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    <span>Paper View</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase rounded-xl flex items-center space-x-1.5 shadow-md cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Printer className="h-4 w-4" />
                  <span>
                    {archivePrintState.scope === 'all_tabs'
                      ? 'Print All Records'
                      : archivePrintState.scope === 'single'
                      ? 'Print Record'
                      : 'Print Current Tab'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setArchivePrintState(null)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition cursor-pointer shrink-0"
                  title="Close Preview (Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Preview Sheet Container */}
            <div className={`p-3 sm:p-6 overflow-y-auto overflow-x-auto flex-1 flex justify-center ${
              archivePrintTheme === 'dark' ? 'bg-slate-950' : 'bg-slate-900'
            }`}>
              <div
                id="official-print-document"
                className={`p-6 sm:p-8 w-full max-w-[1100px] shadow-2xl border font-sans space-y-6 ${
                  archivePrintTheme === 'dark'
                    ? 'bg-slate-900 text-slate-100 border-slate-700'
                    : 'bg-slate-50 text-slate-950 border-slate-400'
                }`}
              >
                {/* Official Dual-Logo Letterhead */}
                <div className={`print-header-center flex items-center justify-between border-b-2 pb-4 mb-4 ${
                  archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'
                }`}>
                  <div className="w-20 h-20 flex-shrink-0 flex items-center justify-center">
                    <img
                      src={ARCHIVE_LOGO_URL}
                      alt="Tagoloan Water District Seal"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = ARCHIVE_FALLBACK_LOGO_URL;
                      }}
                      className="h-20 w-20 object-contain"
                    />
                  </div>
                  <div className="text-center flex-1 px-4">
                    <span className={`text-xs font-bold uppercase tracking-widest block ${
                      archivePrintTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                    }`}>
                      Republic of the Philippines
                    </span>
                    <h1 className={`text-xl sm:text-2xl font-black tracking-tight mt-0.5 uppercase ${
                      archivePrintTheme === 'dark' ? 'text-white' : 'text-slate-950'
                    }`}>
                      TAGOLOAN WATER DISTRICT
                    </h1>
                    <p className={`text-xs font-medium mt-0.5 ${
                      archivePrintTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                    }`}>
                      Poblacion, Tagoloan, Misamis Oriental 9001 • Tel: (088) 890-4946
                    </p>
                    <div className={`w-48 h-0.5 mx-auto my-2 ${
                      archivePrintTheme === 'dark' ? 'bg-blue-500' : 'bg-slate-900'
                    }`}></div>
                    <h2 className={`text-base sm:text-lg font-black uppercase tracking-tight ${
                      archivePrintTheme === 'dark' ? 'text-blue-400' : 'text-slate-950'
                    }`}>
                      {archivePrintState.scope === 'single'
                        ? `OFFICIAL RECORD EXTRACT — ${(archivePrintState.singleRecord?.type || 'RECORD').toUpperCase()}`
                        : archivePrintState.scope === 'all_tabs'
                        ? 'CENTRAL RECORDS ARCHIVE — COMPLETE MASTER COMPENDIUM'
                        : ALL_ARCHIVE_MODULES.find(m => m.key === recordsTab)?.title || 'CENTRAL RECORDS ARCHIVE'}
                    </h2>
                    <p className={`text-xs font-semibold mt-0.5 ${
                      archivePrintTheme === 'dark' ? 'text-amber-400' : 'text-slate-700'
                    }`}>
                      Generated: {new Date().toLocaleString()} {searchQuery ? `• Filter: "${searchQuery}"` : '• Complete Unfiltered / Active Scope'}
                    </p>
                  </div>
                  <div className="w-20 h-20 flex-shrink-0 flex items-center justify-center">
                    <img
                      src={ARCHIVE_PH_SEAL_URL}
                      alt="Republic of the Philippines Seal"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = ARCHIVE_FALLBACK_LOGO_URL;
                      }}
                      className="h-20 w-20 object-contain"
                    />
                  </div>
                </div>

                {/* BODY: Single Record Extract OR Multi/Single Archive Module Tables */}
                {archivePrintState.scope === 'single' && archivePrintState.singleRecord ? (() => {
                  const { type, data } = archivePrintState.singleRecord;
                  const rows: [string, string][] =
                    type === 'consumer'
                      ? [
                          ['Account Number', data.accountNumber || 'Pending ID'],
                          ['Consumer Name', data.name || 'N/A'],
                          ['Assigned Meter #', data.meterNumber || 'Pending Meter'],
                          ['Classification', data.consumerType || 'Residential'],
                          ['Business Name (DBA)', data.businessName || '—'],
                          ['Contact Number', data.contactNumber || 'N/A'],
                          ['Email Address', data.email || 'N/A'],
                          ['Service Address', data.address || 'N/A'],
                          ['Connection Status', (data.status || 'active').toUpperCase()],
                          ['Application #', data.applicationNumber || '—'],
                        ]
                      : type === 'meter'
                      ? [
                          ['Meter Tag Number', data.meterNumber || 'N/A'],
                          ['Manufacturer / Brand', data.brand || 'N/A'],
                          ['Commissioning Date', data.installationDate || 'N/A'],
                          ['Assigned Account #', data.linkedAccountNumber || 'Unassigned'],
                          ['Operational Status', (data.status || 'active').toUpperCase()],
                          ['Last Odometer Dial', formatOdometerReading(data.lastReadingValue ?? 0)],
                          ['Remarks', data.remarks || '—'],
                        ]
                      : type === 'audit'
                      ? [
                          ['Timestamp', data.timestamp ? new Date(data.timestamp).toLocaleString() : 'N/A'],
                          ['User Operator', data.userName || 'System'],
                          ['Role', data.userRole || 'Admin'],
                          ['Action Code', data.action || 'EVENT'],
                          ['Host IP', data.ipAddress || '127.0.0.1'],
                          ['Operation Details', data.details || '—'],
                        ]
                      : [
                          ['Record ID', data.id || 'N/A'],
                          ['Account Number', data.accountNumber || 'N/A'],
                          ['Consumer Name', data.consumerName || 'N/A'],
                          ['Meter Tag Number', data.meterNumber || 'N/A'],
                          ['Billing Period', data.billingPeriod || 'Current Period'],
                          ['Odometer Dial', `${formatOdometerReading(data.previousReading)} → ${formatOdometerReading(data.currentReading)}`],
                          ['Consumption', `${data.consumption ?? 0} m³`],
                          ['Total Assessed Amount', `₱${calculateCostOf(data, data.classification).toFixed(2)}`],
                          ['Payment / Audit Status', (data.paymentStatus || data.status || 'unpaid').toUpperCase()],
                          ['Official Receipt / Ref #', data.orNumber || data.transactionId || data.paymentReference || '—'],
                          ['Date Recorded', data.paymentDate || data.readingDate || 'N/A'],
                          ['Notes', data.notes || '—'],
                        ];

                  return (
                    <table className={`w-full text-xs text-left border-collapse border ${
                      archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'
                    }`}>
                      <thead className={archivePrintTheme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-200 text-slate-950'}>
                        <tr>
                          <th className="px-3 py-2.5 border border-slate-700 w-1/3">Archive Field</th>
                          <th className="px-3 py-2.5 border border-slate-700">Recorded Official Value</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${archivePrintTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                        {rows.map(([label, val], idx) => (
                          <tr key={label} className={idx % 2 === 0
                            ? (archivePrintTheme === 'dark' ? 'bg-slate-900' : 'bg-white')
                            : (archivePrintTheme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100')
                          }>
                            <td className="px-3 py-2 font-bold uppercase text-[11px] border border-slate-700">{label}</td>
                            <td className="px-3 py-2 font-mono text-xs border border-slate-700">{val}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })() : (
                  (archivePrintState.scope === 'all_tabs'
                    ? ALL_ARCHIVE_MODULES
                    : ALL_ARCHIVE_MODULES.filter(m => m.key === recordsTab)
                  ).map((mod, modIdx) => (
                    <div
                      key={mod.key}
                      className={`space-y-3 ${
                        archivePrintState.scope === 'all_tabs' && modIdx > 0
                          ? `print-break-before pt-6 border-t-2 ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-400'}`
                          : ''
                      }`}
                    >
                      <div className={`print-avoid-break flex items-center justify-between border-b pb-2 ${
                        archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-400'
                      }`}>
                        <div>
                          <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${
                            archivePrintTheme === 'dark' ? 'text-emerald-400' : 'text-slate-600'
                          }`}>
                            {archivePrintState.scope === 'all_tabs'
                              ? `Archive Module ${modIdx + 1} of ${ALL_ARCHIVE_MODULES.length} • ${mod.subtitle}`
                              : mod.subtitle}
                          </span>
                          <h3 className={`text-sm sm:text-base font-black uppercase tracking-tight ${
                            archivePrintTheme === 'dark' ? 'text-white' : 'text-slate-950'
                          }`}>
                            {mod.title}
                          </h3>
                        </div>
                        <span className={`text-[11px] font-mono font-bold tabular-nums ${
                          archivePrintTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                        }`}>
                          {mod.key === 'consumers'
                            ? `${filteredConsumers.length} records`
                            : mod.key === 'meters'
                            ? `${filteredMeters.length} records`
                            : mod.key === 'readings'
                            ? `${filteredReadings.length} records`
                            : mod.key === 'bills'
                            ? `${filteredBills.length} records`
                            : mod.key === 'payments'
                            ? `${filteredPayments.length} records`
                            : `${filteredAuditLogs.length} records`}
                        </span>
                      </div>

                      <div className="overflow-x-auto w-full">
                        {mod.key === 'consumers' && (
                          <table className={`w-full text-xs text-left border-collapse border ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'}`}>
                            <thead className={archivePrintTheme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-200 text-slate-950'}>
                              <tr>
                                <th className="px-2.5 py-2 border border-slate-700">Account #</th>
                                <th className="px-2.5 py-2 border border-slate-700">Consumer Name</th>
                                <th className="px-2.5 py-2 border border-slate-700">Service Address</th>
                                <th className="px-2.5 py-2 border border-slate-700">Meter #</th>
                                <th className="px-2.5 py-2 border border-slate-700">Class</th>
                                <th className="px-2.5 py-2 text-center border border-slate-700">Status</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${archivePrintTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                              {filteredConsumers.map((c, idx) => (
                                <tr key={`pr-c-${c.id || idx}`}>
                                  <td className="px-2.5 py-1.5 font-mono font-bold border border-slate-700">{c.accountNumber || 'PENDING ID'}</td>
                                  <td className="px-2.5 py-1.5 font-bold border border-slate-700">{c.name}</td>
                                  <td className="px-2.5 py-1.5 border border-slate-700">{c.address}</td>
                                  <td className="px-2.5 py-1.5 font-mono border border-slate-700">{c.meterNumber || 'Pending'}</td>
                                  <td className="px-2.5 py-1.5 border border-slate-700">{c.consumerType || 'Residential'}</td>
                                  <td className="px-2.5 py-1.5 text-center font-bold uppercase border border-slate-700">{c.status}</td>
                                </tr>
                              ))}
                              {filteredConsumers.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-400">No consumer records match the active filter.</td></tr>
                              )}
                            </tbody>
                          </table>
                        )}

                        {mod.key === 'meters' && (
                          <table className={`w-full text-xs text-left border-collapse border ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'}`}>
                            <thead className={archivePrintTheme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-200 text-slate-950'}>
                              <tr>
                                <th className="px-2.5 py-2 border border-slate-700">Meter Tag #</th>
                                <th className="px-2.5 py-2 border border-slate-700">Brand / Model</th>
                                <th className="px-2.5 py-2 border border-slate-700">Commissioning Date</th>
                                <th className="px-2.5 py-2 border border-slate-700">Assigned Account #</th>
                                <th className="px-2.5 py-2 text-center border border-slate-700">Status</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${archivePrintTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                              {filteredMeters.map((m, idx) => (
                                <tr key={`pr-m-${m.meterNumber || idx}`}>
                                  <td className="px-2.5 py-1.5 font-mono font-bold border border-slate-700">{m.meterNumber}</td>
                                  <td className="px-2.5 py-1.5 font-semibold border border-slate-700">{m.brand}</td>
                                  <td className="px-2.5 py-1.5 font-mono border border-slate-700">{m.installationDate}</td>
                                  <td className="px-2.5 py-1.5 font-mono border border-slate-700">{m.linkedAccountNumber || 'Unassigned'}</td>
                                  <td className="px-2.5 py-1.5 text-center font-bold uppercase border border-slate-700">{m.status === 'maintenance' ? 'Under Maintenance' : m.status}</td>
                                </tr>
                              ))}
                              {filteredMeters.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-400">No meter records match the active filter.</td></tr>
                              )}
                            </tbody>
                          </table>
                        )}

                        {mod.key === 'readings' && (
                          <table className={`w-full text-xs text-left border-collapse border ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'}`}>
                            <thead className={archivePrintTheme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-200 text-slate-950'}>
                              <tr>
                                <th className="px-2.5 py-2 border border-slate-700">Reading ID</th>
                                <th className="px-2.5 py-2 border border-slate-700">Account #</th>
                                <th className="px-2.5 py-2 border border-slate-700">Consumer Name</th>
                                <th className="px-2.5 py-2 text-center border border-slate-700">Dial (Prev → Curr)</th>
                                <th className="px-2.5 py-2 text-right border border-slate-700">Volume (m³)</th>
                                <th className="px-2.5 py-2 border border-slate-700">Date</th>
                                <th className="px-2.5 py-2 border border-slate-700">Reader</th>
                                <th className="px-2.5 py-2 text-center border border-slate-700">Status</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${archivePrintTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                              {filteredReadings.map((r, idx) => (
                                <tr key={`pr-r-${r.id || idx}`}>
                                  <td className="px-2.5 py-1.5 font-mono border border-slate-700">{r.id}</td>
                                  <td className="px-2.5 py-1.5 font-mono font-bold border border-slate-700">{r.accountNumber}</td>
                                  <td className="px-2.5 py-1.5 font-bold border border-slate-700">{r.consumerName}</td>
                                  <td className="px-2.5 py-1.5 font-mono text-center border border-slate-700">{formatOdometerReading(r.previousReading)} → {formatOdometerReading(r.currentReading)}</td>
                                  <td className="px-2.5 py-1.5 font-mono text-right font-bold border border-slate-700">{r.consumption} m³</td>
                                  <td className="px-2.5 py-1.5 font-mono border border-slate-700">{r.readingDate}</td>
                                  <td className="px-2.5 py-1.5 border border-slate-700">{r.meterReaderName || 'Field Reader'}</td>
                                  <td className="px-2.5 py-1.5 text-center font-bold uppercase border border-slate-700">{r.status}</td>
                                </tr>
                              ))}
                              {filteredReadings.length === 0 && (
                                <tr><td colSpan={8} className="px-4 py-4 text-center text-slate-400">No reading records match the active filter.</td></tr>
                              )}
                            </tbody>
                          </table>
                        )}

                        {mod.key === 'bills' && (
                          <table className={`w-full text-xs text-left border-collapse border ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'}`}>
                            <thead className={archivePrintTheme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-200 text-slate-950'}>
                              <tr>
                                <th className="px-2.5 py-2 border border-slate-700">Billing Period</th>
                                <th className="px-2.5 py-2 border border-slate-700">Account #</th>
                                <th className="px-2.5 py-2 border border-slate-700">Consumer Name</th>
                                <th className="px-2.5 py-2 text-right border border-slate-700">Volume (m³)</th>
                                <th className="px-2.5 py-2 text-right border border-slate-700">Assessed Amount</th>
                                <th className="px-2.5 py-2 text-center border border-slate-700">Settlement Status</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${archivePrintTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                              {filteredBills.map((b, idx) => (
                                <tr key={`pr-b-${b.id || idx}`}>
                                  <td className="px-2.5 py-1.5 font-mono border border-slate-700">{b.billingPeriod || 'Current Period'}</td>
                                  <td className="px-2.5 py-1.5 font-mono font-bold border border-slate-700">{b.accountNumber}</td>
                                  <td className="px-2.5 py-1.5 font-bold border border-slate-700">{b.consumerName}</td>
                                  <td className="px-2.5 py-1.5 font-mono text-right border border-slate-700">{b.consumption} m³</td>
                                  <td className="px-2.5 py-1.5 font-mono text-right font-bold border border-slate-700">₱{calculateCostOf(b, b.classification).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td className="px-2.5 py-1.5 text-center font-bold uppercase border border-slate-700">{b.paymentStatus || 'unpaid'}</td>
                                </tr>
                              ))}
                              {filteredBills.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-400">No bill records match the active filter.</td></tr>
                              )}
                            </tbody>
                          </table>
                        )}

                        {mod.key === 'payments' && (
                          <table className={`w-full text-xs text-left border-collapse border ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'}`}>
                            <thead className={archivePrintTheme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-200 text-slate-950'}>
                              <tr>
                                <th className="px-2.5 py-2 border border-slate-700">Official Receipt #</th>
                                <th className="px-2.5 py-2 border border-slate-700">Payment Date</th>
                                <th className="px-2.5 py-2 border border-slate-700">Account #</th>
                                <th className="px-2.5 py-2 border border-slate-700">Consumer Name</th>
                                <th className="px-2.5 py-2 border border-slate-700">Method</th>
                                <th className="px-2.5 py-2 text-right border border-slate-700">Settled Amount</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${archivePrintTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                              {filteredPayments.map((p, idx) => {
                                const amt = p.paidAmount && p.paidAmount > 0 ? p.paidAmount : calculateCostOf(p, p.classification);
                                return (
                                  <tr key={`pr-p-${p.id || idx}`}>
                                    <td className="px-2.5 py-1.5 font-mono font-bold border border-slate-700">{p.orNumber || p.transactionId || p.paymentReference || 'OR-OFFICIAL'}</td>
                                    <td className="px-2.5 py-1.5 font-mono border border-slate-700">{p.paymentDate || p.readingDate}</td>
                                    <td className="px-2.5 py-1.5 font-mono font-bold border border-slate-700">{p.accountNumber}</td>
                                    <td className="px-2.5 py-1.5 font-bold border border-slate-700">{p.consumerName}</td>
                                    <td className="px-2.5 py-1.5 border border-slate-700">{p.paymentMethod || 'Cash'}</td>
                                    <td className="px-2.5 py-1.5 font-mono text-right font-bold border border-slate-700">₱{amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  </tr>
                                );
                              })}
                              {filteredPayments.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-400">No payment receipts match the active filter.</td></tr>
                              )}
                            </tbody>
                          </table>
                        )}

                        {mod.key === 'audit' && (
                          <table className={`w-full text-xs text-left border-collapse border ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-600'}`}>
                            <thead className={archivePrintTheme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-200 text-slate-950'}>
                              <tr>
                                <th className="px-2.5 py-2 border border-slate-700">Audit Timestamp</th>
                                <th className="px-2.5 py-2 border border-slate-700">User Operator</th>
                                <th className="px-2.5 py-2 border border-slate-700">Action Code</th>
                                <th className="px-2.5 py-2 border border-slate-700">Operation Details</th>
                                <th className="px-2.5 py-2 text-right border border-slate-700">Host IP</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${archivePrintTheme === 'dark' ? 'divide-slate-800 text-slate-200' : 'divide-slate-300 text-slate-900'}`}>
                              {filteredAuditLogs.map((log, idx) => (
                                <tr key={`pr-a-${log.id || idx}`}>
                                  <td className="px-2.5 py-1.5 font-mono border border-slate-700">{new Date(log.timestamp).toLocaleString()}</td>
                                  <td className="px-2.5 py-1.5 font-bold border border-slate-700">{log.userName}</td>
                                  <td className="px-2.5 py-1.5 font-mono font-bold border border-slate-700">{log.action}</td>
                                  <td className="px-2.5 py-1.5 border border-slate-700">{log.details}</td>
                                  <td className="px-2.5 py-1.5 font-mono text-right border border-slate-700">{log.ipAddress || '127.0.0.1'}</td>
                                </tr>
                              ))}
                              {filteredAuditLogs.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-400">No audit log entries match the active filter.</td></tr>
                              )}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {/* Certification Footer */}
                <div className={`print-avoid-break grid grid-cols-3 gap-6 pt-6 border-t-2 text-xs ${
                  archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'
                }`}>
                  <div className="space-y-4">
                    <span className={`font-bold block ${archivePrintTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      PREPARED & VERIFIED BY:
                    </span>
                    <div className={`border-b pt-6 ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'}`}></div>
                    <div>
                      <span className={`font-black block ${archivePrintTheme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        CENTRAL RECORDS OFFICER
                      </span>
                      <span className={`text-[10px] ${archivePrintTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        Records & Archive Section
                      </span>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <span className={`font-bold block ${archivePrintTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      REVIEWED BY:
                    </span>
                    <div className={`border-b pt-6 ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'}`}></div>
                    <div>
                      <span className={`font-black block ${archivePrintTheme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        COMMERCIAL DIVISION HEAD
                      </span>
                      <span className={`text-[10px] ${archivePrintTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        Tagoloan Water District
                      </span>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <span className={`font-bold block ${archivePrintTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      CERTIFIED OFFICIAL COPY:
                    </span>
                    <div className={`border-b pt-6 ${archivePrintTheme === 'dark' ? 'border-slate-700' : 'border-slate-900'}`}></div>
                    <div>
                      <span className={`font-black block ${archivePrintTheme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        GENERAL MANAGER
                      </span>
                      <span className={`text-[10px] ${archivePrintTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        Tagoloan Water District
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

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
  CheckCircle, 
  Check, 
  Calendar, 
  MapPin, 
  UserCheck, 
  Clock, 
  Database,
  ArrowUpDown
} from 'lucide-react';
import { Consumer, WaterMeter, MeterReading, AuditLog } from '../../types';
import { TablePagination } from '../common/TablePagination';
import { SmartSearchBar } from '../common/SmartSearchBar';
import { smartMatch } from '../../utils/smartSearch';
import { isOfficialBillIssued } from '../../utils/tariffCalculator';

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

  useEffect(() => {
    setCurrentPage(1);
  }, [recordsTab, searchQuery, classificationFilter]);

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
  const filteredConsumers = consumers.filter(c => {
    const isPending = !c.accountNumber || c.accountNumber.trim() === '' || c.accountNumber.toUpperCase().startsWith('PENDING') || c.status === 'pending_approval';
    const matchesSearch = smartMatch(searchQuery, [
      c.name,
      c.accountNumber,
      c.meterNumber,
      c.rfidTag,
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
  });

  // Filtered Meters
  const filteredMeters = meters.filter(m => {
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
    ]);
  });

  // Filtered Readings
  const filteredReadings = readings.filter(r => {
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
      `${r.consumption} m3`,
    ]);
  });

  // Filtered Bills
  const filteredBills = bills.filter(r => {
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
  });

  // Filtered Payments
  const filteredPayments = paidBills.filter(r => {
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
  });

  // Filtered Audit Logs
  const filteredAuditLogs = auditLogs.filter(log => {
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
  });

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
      const headers = ['Meter Serial #', 'Brand/Model', 'Installation Date', 'Assigned Account', 'Status'];
      const rows = filteredMeters.map(m => [
        m.meterNumber,
        m.brand,
        m.installationDate,
        m.linkedAccountNumber || 'Unassigned',
        m.status
      ]);
      exportToCsv(`TWD_Meters_Inventory_${timestamp}.csv`, headers, rows);
    } else if (recordsTab === 'readings') {
      const headers = ['Reading ID', 'Account #', 'Consumer Name', 'Previous (m³)', 'Current (m³)', 'Consumption (m³)', 'Date', 'Reader', 'Status'];
      const rows = filteredReadings.map(r => [
        r.id,
        r.accountNumber,
        r.consumerName,
        r.previousReading,
        r.currentReading,
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Master Accounts</span>
            <Building2 className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-white tabular-nums">{totalConsumers.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono tabular-nums mt-0.5">{activeConsumers} Active Connected</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Meters Tracked</span>
            <Gauge className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-white tabular-nums">{totalMeters.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono tabular-nums mt-0.5">{activeMeters} Operational</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Field Readings</span>
            <Activity className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-emerald-400 tabular-nums">{totalReadings.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono tabular-nums mt-0.5">{verifiedReadings} Verified Records</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Billed Assessments</span>
            <Receipt className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-white tabular-nums">{bills.length.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono tabular-nums mt-0.5">{bills.length - paidBills.length} Pending Collections</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Cash Collections</span>
            <CreditCard className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-emerald-400 tabular-nums">₱{totalCollectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-[10px] text-emerald-300 font-mono tabular-nums mt-0.5">{paidBills.length} Valid Official Receipts</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-md">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Audit Security</span>
            <ShieldCheck className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-white tabular-nums">{auditLogs.length.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">Immutable System Events</div>
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
              placeholder={`Smart search ${recordsTab} by name, account #, serial, barangay, phone, or date...`}
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

        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          <span className="text-[11px] font-mono tabular-nums text-slate-400">
            Showing <strong className="text-white font-bold">{activeFilteredCount}</strong> of {activeTotalCount} entries
          </span>

          <button
            type="button"
            onClick={handleExportCurrentView}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center space-x-1.5 cursor-pointer shadow-md shrink-0"
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
          const paginatedConsumers = filteredConsumers.slice((currentPage - 1) * 10, currentPage * 10);
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
                      const isPending = !c.accountNumber || c.accountNumber.trim() === '' || c.accountNumber.toUpperCase().startsWith('PENDING') || c.accountNumber.toUpperCase() === 'PENDING ADMIN ISSUANCE' || c.status === 'pending_approval';
                      return (
                      <tr key={`rec-cons-${c.accountNumber || c.meterNumber || cIdx}-${cIdx}`} className={`transition ${isPending ? 'bg-amber-950/20 hover:bg-amber-950/40' : 'hover:bg-slate-800/60'}`}>
                        <td className="px-5 py-3 font-mono font-bold border-r border-slate-800/80">
                          {isPending ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[11px] font-bold">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
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
                              ? 'bg-rose-950/80 text-rose-300 border-rose-800/80 shadow-2xs font-black animate-pulse'
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
                currentPage={currentPage}
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
          const paginatedMeters = filteredMeters.slice((currentPage - 1) * 10, currentPage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Meter Serial Number</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Manufacturer / Brand</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Commissioning Date</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Assigned Account</th>
                      <th className="px-5 py-3.5 text-center">Operational State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedMeters.map((m, mIdx) => (
                      <tr key={`rec-meter-${m.meterNumber || m.id || mIdx}-${mIdx}`} className="hover:bg-slate-800/60 transition">
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
                              : 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                          }`}>
                            {m.status}
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
                currentPage={currentPage}
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
          const paginatedReadings = filteredReadings.slice((currentPage - 1) * 10, currentPage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse min-w-[900px]">
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3.5 border-r border-slate-800/80">Reading ID</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80 min-w-[200px]">Consumer Account</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80 text-center">Index (Prev → Curr)</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80 text-right">Volume (m³)</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80">Reading Timestamp</th>
                      <th className="px-4 py-3.5 border-r border-slate-800/80">Field Reader</th>
                      <th className="px-4 py-3.5 text-center border-r border-slate-800/80">Audit Status</th>
                      <th className="px-4 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedReadings.map((r, rIdx) => (
                      <tr key={`rec-reading-${r.id || r.accountNumber || rIdx}-${rIdx}`} className="hover:bg-slate-800/60 transition">
                        <td className="px-4 py-3 font-mono font-bold text-slate-400 border-r border-slate-800/80">
                          {r.id}
                        </td>
                        <td className="px-4 py-3 border-r border-slate-800/80">
                          <span className="font-bold font-mono text-sky-400 block text-xs">{r.accountNumber}</span>
                          <span className="text-white font-bold">{r.consumerName}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-300 text-center border-r border-slate-800/80">
                          {r.previousReading} → <strong className="text-white font-bold">{r.currentReading}</strong>
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
                                onClick={() => handleVerifyReading(r.id, 'verified')}
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
                              onClick={() => handleDeleteReading(r.id)}
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
                currentPage={currentPage}
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
          const paginatedBills = filteredBills.slice((currentPage - 1) * 10, currentPage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Billing Period</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Account #</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Consumer Name</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 text-right">Volume (m³)</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80 text-right">Assessed Amount</th>
                      <th className="px-5 py-3.5 text-center">Settlement Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedBills.map((r, bIdx) => {
                      const totalBill = calculateCostOf(r, r.classification);
                      return (
                        <tr key={`rec-bill-${r.id || r.accountNumber || bIdx}-${bIdx}`} className="hover:bg-slate-800/60 transition">
                          <td className="px-5 py-3 font-mono font-bold text-white border-r border-slate-800/80">
                            {r.billingPeriod || 'Current Period'}
                          </td>
                          <td className="px-5 py-3 font-mono font-bold text-sky-400 border-r border-slate-800/80">
                            {r.accountNumber}
                          </td>
                          <td className="px-5 py-3 font-bold text-white border-r border-slate-800/80">
                            {r.consumerName}
                          </td>
                          <td className="px-5 py-3 font-mono font-bold text-slate-300 text-right border-r border-slate-800/80">
                            {r.consumption} m³
                          </td>
                          <td className="px-5 py-3 font-mono font-black text-white text-right border-r border-slate-800/80">
                            ₱{totalBill.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-5 py-3 text-center">
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
                currentPage={currentPage}
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
          const paginatedPayments = filteredPayments.slice((currentPage - 1) * 10, currentPage * 10);
          return (
            <div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-300 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Official Receipt #</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Payment Date</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Account #</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Consumer Name</th>
                      <th className="px-5 py-3.5 border-r border-slate-800/80">Payment Instrument</th>
                      <th className="px-5 py-3.5 text-right">Settled Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium bg-slate-900">
                    {paginatedPayments.map((r, pIdx) => {
                      const totalBill = r.paidAmount && r.paidAmount > 0 ? r.paidAmount : calculateCostOf(r, r.classification);
                      return (
                        <tr key={`rec-paid-${r.id || r.transactionId || pIdx}-${pIdx}`} className="hover:bg-slate-800/60 transition">
                          <td className="px-5 py-3 font-mono font-bold text-emerald-400 border-r border-slate-800/80">
                            {r.transactionId || `OR-${20260000 + pIdx}`}
                          </td>
                          <td className="px-5 py-3 text-slate-300 font-mono border-r border-slate-800/80">
                            {r.paymentDate || r.readingDate}
                          </td>
                          <td className="px-5 py-3 font-mono font-bold text-sky-400 border-r border-slate-800/80">
                            {r.accountNumber}
                          </td>
                          <td className="px-5 py-3 font-bold text-white border-r border-slate-800/80">
                            {r.consumerName}
                          </td>
                          <td className="px-5 py-3 font-bold text-slate-300 border-r border-slate-800/80">
                            {r.paymentMethod || 'Cash'}
                          </td>
                          <td className="px-5 py-3 font-mono font-black text-emerald-400 text-right">
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
                currentPage={currentPage}
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
          const paginatedAuditLogs = filteredAuditLogs.slice((currentPage - 1) * 10, currentPage * 10);
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
                      <tr key={`rec-audit-${log.id || lIdx}-${lIdx}`} className="hover:bg-slate-800/60 transition">
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
                currentPage={currentPage}
                totalItems={filteredAuditLogs.length}
                pageSize={10}
                onPageChange={setCurrentPage}
                itemName="audit log entries"
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
};

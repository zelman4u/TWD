import React from 'react';
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
  calculateCostOf: (usage: number, classification?: string) => number;
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
  const q = searchQuery.toLowerCase().trim();

  // Metrics for Cards
  const totalConsumers = consumers.length;
  const activeConsumers = consumers.filter(c => c.status === 'active').length;
  const commercialConsumers = consumers.filter(c => c.consumerType === 'Commercial').length;

  const totalMeters = meters.length;
  const activeMeters = meters.filter(m => m.status === 'active').length;

  const totalReadings = readings.length;
  const verifiedReadings = readings.filter(r => r.status === 'verified').length;
  const pendingReadings = readings.filter(r => r.status === 'pending').length;

  const bills = readings.filter(r => r.status === 'verified');
  const paidBills = readings.filter(r => r.paymentStatus === 'paid');
  const totalCollectedAmount = paidBills.reduce((acc, r) => {
    const cost = r.paidAmount && r.paidAmount > 0 ? r.paidAmount : calculateCostOf(r.consumption, r.classification);
    return acc + cost;
  }, 0);

  // Filtered Consumers
  const filteredConsumers = consumers.filter(c => {
    const matchesSearch = !q || 
      (c.name || '').toLowerCase().includes(q) ||
      (c.accountNumber || '').toLowerCase().includes(q) ||
      (c.meterNumber || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q) ||
      (c.businessName || '').toLowerCase().includes(q);
    const matchesType = classificationFilter === 'all' || (c.consumerType || 'Residential') === classificationFilter;
    return matchesSearch && matchesType;
  });

  // Filtered Meters
  const filteredMeters = meters.filter(m => {
    return !q ||
      (m.meterNumber || '').toLowerCase().includes(q) ||
      (m.brand || '').toLowerCase().includes(q) ||
      (m.linkedAccountNumber || '').toLowerCase().includes(q) ||
      (m.status || '').toLowerCase().includes(q);
  });

  // Filtered Readings
  const filteredReadings = readings.filter(r => {
    return !q ||
      (r.accountNumber || '').toLowerCase().includes(q) ||
      (r.consumerName || '').toLowerCase().includes(q) ||
      (r.meterReaderName || '').toLowerCase().includes(q) ||
      (r.id || '').toLowerCase().includes(q);
  });

  // Filtered Bills
  const filteredBills = bills.filter(r => {
    return !q ||
      (r.accountNumber || '').toLowerCase().includes(q) ||
      (r.consumerName || '').toLowerCase().includes(q) ||
      (r.billingPeriod || '').toLowerCase().includes(q);
  });

  // Filtered Payments
  const filteredPayments = paidBills.filter(r => {
    return !q ||
      (r.transactionId || '').toLowerCase().includes(q) ||
      (r.accountNumber || '').toLowerCase().includes(q) ||
      (r.consumerName || '').toLowerCase().includes(q) ||
      (r.paymentMethod || '').toLowerCase().includes(q);
  });

  // Filtered Audit Logs
  const filteredAuditLogs = auditLogs.filter(log => {
    return !q ||
      (log.userName || '').toLowerCase().includes(q) ||
      (log.action || '').toLowerCase().includes(q) ||
      (log.details || '').toLowerCase().includes(q) ||
      (log.ipAddress || '').toLowerCase().includes(q);
  });

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
        calculateCostOf(b.consumption, b.classification).toFixed(2),
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
        (p.paidAmount && p.paidAmount > 0 ? p.paidAmount : calculateCostOf(p.consumption, p.classification)).toFixed(2)
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
        <div className="bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Master Accounts</span>
            <Building2 className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-white">{totalConsumers.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">{activeConsumers} Active Connected</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Meters Tracked</span>
            <Gauge className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-white">{totalMeters.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">{activeMeters} Operational</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Field Readings</span>
            <Activity className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-emerald-400">{totalReadings.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">{verifiedReadings} Verified Records</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Billed Assessments</span>
            <Receipt className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-white">{bills.length.toLocaleString()}</div>
            <div className="text-[10px] text-amber-400 font-mono mt-0.5">{bills.length - paidBills.length} Pending Collections</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Cash Collections</span>
            <CreditCard className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-emerald-400">₱{totalCollectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-[10px] text-emerald-300 font-mono mt-0.5">{paidBills.length} Valid Official Receipts</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Audit Security</span>
            <ShieldCheck className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-white">{auditLogs.length.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">Immutable System Events</div>
          </div>
        </div>
      </div>

      {/* 2. REGULATORY ARCHIVE TOOLBAR */}
      <div className="bg-white border border-slate-200 p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-2xs">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${recordsTab}... (by name, account #, serial, date)`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 pl-9 pr-3 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase"
              >
                Clear
              </button>
            )}
          </div>

          {recordsTab === 'consumers' && (
            <div className="flex items-center space-x-1.5 shrink-0">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={classificationFilter}
                onChange={(e) => setClassificationFilter(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold py-1.5 px-2.5 focus:outline-none focus:border-blue-600"
              >
                <option value="all">All Classifications</option>
                <option value="Residential">Residential Only</option>
                <option value="Commercial">Commercial Only</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 shrink-0">
          <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
            Showing{' '}
            <strong className="text-slate-900 font-bold">
              {recordsTab === 'consumers' && filteredConsumers.length}
              {recordsTab === 'meters' && filteredMeters.length}
              {recordsTab === 'readings' && filteredReadings.length}
              {recordsTab === 'bills' && filteredBills.length}
              {recordsTab === 'payments' && filteredPayments.length}
              {recordsTab === 'audit' && filteredAuditLogs.length}
            </strong>{' '}
            entries
          </span>

          <button
            type="button"
            onClick={handleExportCurrentView}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider transition flex items-center space-x-1.5 cursor-pointer shadow-xs shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 3. ARCHIVE DATA PRESENTATION */}
      <div className="bg-white border border-slate-200 overflow-hidden shadow-2xs">
        {/* SUBTAB A: CONSUMERS ARCHIVE */}
        {recordsTab === 'consumers' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5 border-r border-slate-100">Account #</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Consumer Name</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Barangay / Address</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Assigned Meter #</th>
                  <th className="px-5 py-3.5 border-r border-slate-100 text-center">Classification</th>
                  <th className="px-5 py-3.5 text-center">Connection Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredConsumers.map((c, cIdx) => (
                  <tr key={`rec-cons-${c.accountNumber || c.meterNumber || cIdx}-${cIdx}`} className="hover:bg-slate-50/80 transition">
                    <td className="px-5 py-3 font-mono font-bold text-blue-700 border-r border-slate-100">
                      {c.accountNumber}
                    </td>
                    <td className="px-5 py-3 border-r border-slate-100">
                      <div className="font-bold text-slate-900">{c.name}</div>
                      {c.businessName && (
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          DBA: {c.businessName}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 border-r border-slate-100">
                      <div className="flex items-center space-x-1 text-slate-700">
                        <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[220px]">{c.address}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono font-bold text-slate-800 border-r border-slate-100">
                      {c.meterNumber || 'Pending Serial'}
                    </td>
                    <td className="px-5 py-3 border-r border-slate-100 text-center">
                      <div className="inline-flex flex-col items-center">
                        <span className={`inline-flex items-center justify-center gap-1.5 min-w-[108px] px-2.5 py-1 text-[10px] font-black uppercase rounded border shadow-2xs ${
                          c.consumerType === 'Commercial'
                            ? 'bg-purple-50 text-purple-900 border-purple-300'
                            : 'bg-emerald-50 text-emerald-900 border-emerald-300'
                        }`}>
                          {c.consumerType === 'Commercial' ? (
                            <Building className="h-3 w-3 text-purple-700 shrink-0" />
                          ) : (
                            <Home className="h-3 w-3 text-emerald-700 shrink-0" />
                          )}
                          <span>{c.consumerType || 'Residential'}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border ${
                        c.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : c.status === 'Disconnection Notice' || (c.status as string) === 'disconnection_notice'
                          ? 'bg-rose-600 text-white border-rose-700 shadow-2xs font-black animate-pulse'
                          : 'bg-rose-50 text-rose-800 border-rose-300'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredConsumers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                      <Database className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                      No archived consumers match the search query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SUBTAB B: METERS INVENTORY */}
        {recordsTab === 'meters' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5 border-r border-slate-100">Meter Serial Number</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Manufacturer / Brand</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Commissioning Date</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Assigned Account</th>
                  <th className="px-5 py-3.5 text-center">Operational State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredMeters.map((m, mIdx) => (
                  <tr key={`rec-meter-${m.meterNumber || m.id || mIdx}-${mIdx}`} className="hover:bg-slate-50/80 transition">
                    <td className="px-5 py-3 font-mono font-bold text-slate-900 border-r border-slate-100">
                      {m.meterNumber}
                    </td>
                    <td className="px-5 py-3 font-bold text-slate-800 border-r border-slate-100">
                      {m.brand}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-600 border-r border-slate-100">
                      {m.installationDate}
                    </td>
                    <td className="px-5 py-3 font-mono font-bold text-blue-700 border-r border-slate-100">
                      {m.linkedAccountNumber || <span className="text-slate-400 font-normal">Unassigned</span>}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border ${
                        m.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : m.status === 'maintenance'
                          ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : 'bg-rose-50 text-rose-800 border-rose-300'
                      }`}>
                        {m.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredMeters.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                      <Gauge className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                      No meters found matching your filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SUBTAB C: READINGS TRAIL */}
        {recordsTab === 'readings' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[900px]">
              <thead className="bg-slate-50 text-slate-700 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3.5 border-r border-slate-100">Reading ID</th>
                  <th className="px-4 py-3.5 border-r border-slate-100 min-w-[200px]">Consumer Account</th>
                  <th className="px-4 py-3.5 border-r border-slate-100 text-center">Index (Prev → Curr)</th>
                  <th className="px-4 py-3.5 border-r border-slate-100 text-right">Volume (m³)</th>
                  <th className="px-4 py-3.5 border-r border-slate-100">Reading Timestamp</th>
                  <th className="px-4 py-3.5 border-r border-slate-100">Field Reader</th>
                  <th className="px-4 py-3.5 text-center border-r border-slate-100">Audit Status</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredReadings.map((r, rIdx) => (
                  <tr key={`rec-reading-${r.id || r.accountNumber || rIdx}-${rIdx}`} className="hover:bg-slate-50/80 transition">
                    <td className="px-4 py-3 font-mono font-bold text-slate-600 border-r border-slate-100">
                      {r.id}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-100">
                      <span className="font-bold font-mono text-blue-700 block text-xs">{r.accountNumber}</span>
                      <span className="text-slate-900 font-bold">{r.consumerName}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 text-center border-r border-slate-100">
                      {r.previousReading} → <strong className="text-slate-950 font-bold">{r.currentReading}</strong>
                    </td>
                    <td className="px-4 py-3 font-mono font-black text-blue-700 text-right border-r border-slate-100">
                      {r.consumption} m³
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-[11px] border-r border-slate-100">
                      {r.readingDate}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-800 border-r border-slate-100">
                      {r.meterReaderName || 'Field Reader'}
                    </td>
                    <td className="px-4 py-3 text-center border-r border-slate-100">
                      <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border ${
                        r.status === 'verified'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : r.status === 'pending'
                          ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : 'bg-rose-50 text-rose-800 border-rose-300'
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
                          <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 border border-emerald-200 flex items-center space-x-1">
                            <Check className="h-3 w-3 text-emerald-600" />
                            <span>Verified</span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteReading(r.id)}
                          className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[10px] uppercase transition cursor-pointer"
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
                      <Activity className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                      No archived readings found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SUBTAB D: BILLS LEDGER */}
        {recordsTab === 'bills' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5 border-r border-slate-100">Billing Period</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Account #</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Consumer Name</th>
                  <th className="px-5 py-3.5 border-r border-slate-100 text-right">Volume (m³)</th>
                  <th className="px-5 py-3.5 border-r border-slate-100 text-right">Assessed Amount</th>
                  <th className="px-5 py-3.5 text-center">Settlement Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredBills.map((r, bIdx) => {
                  const totalBill = calculateCostOf(r.consumption, r.classification);
                  return (
                    <tr key={`rec-bill-${r.id || r.accountNumber || bIdx}-${bIdx}`} className="hover:bg-slate-50/80 transition">
                      <td className="px-5 py-3 font-mono font-bold text-slate-900 border-r border-slate-100">
                        {r.billingPeriod || 'Current Period'}
                      </td>
                      <td className="px-5 py-3 font-mono font-bold text-blue-700 border-r border-slate-100">
                        {r.accountNumber}
                      </td>
                      <td className="px-5 py-3 font-bold text-slate-900 border-r border-slate-100">
                        {r.consumerName}
                      </td>
                      <td className="px-5 py-3 font-mono font-bold text-slate-800 text-right border-r border-slate-100">
                        {r.consumption} m³
                      </td>
                      <td className="px-5 py-3 font-mono font-black text-slate-950 text-right border-r border-slate-100">
                        ₱{totalBill.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border ${
                          r.paymentStatus === 'paid'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-amber-50 text-amber-800 border-amber-300'
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
                      <Receipt className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                      No assessed bills found matching query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SUBTAB E: PAYMENT RECEIPTS LOG */}
        {recordsTab === 'payments' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5 border-r border-slate-100">Official Receipt #</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Payment Date</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Account #</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Consumer Name</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Payment Instrument</th>
                  <th className="px-5 py-3.5 text-right">Settled Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredPayments.map((r, pIdx) => {
                  const totalBill = r.paidAmount && r.paidAmount > 0 ? r.paidAmount : calculateCostOf(r.consumption, r.classification);
                  return (
                    <tr key={`rec-paid-${r.id || r.transactionId || pIdx}-${pIdx}`} className="hover:bg-slate-50/80 transition">
                      <td className="px-5 py-3 font-mono font-bold text-emerald-700 border-r border-slate-100">
                        {r.transactionId || `OR-${20260000 + pIdx}`}
                      </td>
                      <td className="px-5 py-3 text-slate-700 font-mono border-r border-slate-100">
                        {r.paymentDate || r.readingDate}
                      </td>
                      <td className="px-5 py-3 font-mono font-bold text-blue-700 border-r border-slate-100">
                        {r.accountNumber}
                      </td>
                      <td className="px-5 py-3 font-bold text-slate-900 border-r border-slate-100">
                        {r.consumerName}
                      </td>
                      <td className="px-5 py-3 font-bold text-slate-800 border-r border-slate-100">
                        {r.paymentMethod || 'Cash'}
                      </td>
                      <td className="px-5 py-3 font-mono font-black text-emerald-700 text-right">
                        ₱{totalBill.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
                {filteredPayments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                      <CreditCard className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                      No payment receipts found matching query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SUBTAB F: SECURITY AUDIT */}
        {recordsTab === 'audit' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-extrabold uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5 border-r border-slate-100">Audit Timestamp</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">User Operator</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Action Code</th>
                  <th className="px-5 py-3.5 border-r border-slate-100">Operation Details</th>
                  <th className="px-5 py-3.5 text-right">Host IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredAuditLogs.map((log, lIdx) => (
                  <tr key={`rec-audit-${log.id || lIdx}-${lIdx}`} className="hover:bg-slate-50/80 transition">
                    <td className="px-5 py-3 font-mono text-slate-600 text-[11px] border-r border-slate-100">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-bold text-slate-900 border-r border-slate-100">
                      {log.userName}
                    </td>
                    <td className="px-5 py-3 font-mono font-bold text-blue-700 border-r border-slate-100">
                      {log.action}
                    </td>
                    <td className="px-5 py-3 text-slate-700 border-r border-slate-100">
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
                      <ShieldCheck className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                      No security audit log entries match the query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

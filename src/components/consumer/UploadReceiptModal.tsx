import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Upload, 
  Camera, 
  ReceiptText, 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  Image as ImageIcon, 
  Calendar, 
  Building2, 
  CreditCard, 
  ShieldCheck, 
  Percent, 
  Trash2, 
  ZoomIn,
  Sparkles,
  Info,
  Layers
} from 'lucide-react';
import { Consumer, MeterReading } from '../../types';
import { mockDb } from '../../mockDb';

interface UploadReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  reading: MeterReading | null;
  allReadings?: MeterReading[];
  consumerRecord: Consumer;
  onSuccess?: (updatedReading: MeterReading, orNumber: string, isPartial: boolean) => void;
  onReceiptValidated?: (receipt: { billingPeriod: string; amountPaid: number; remainingBalance: number; isPartial: boolean; orNumber: string; paymentDate: string }) => void;
  calculateCostOf: (usage: number, classification?: 'Residential' | 'Commercial') => number;
}

export const UploadReceiptModal: React.FC<UploadReceiptModalProps> = ({
  isOpen,
  onClose,
  reading,
  allReadings = [],
  consumerRecord,
  onSuccess,
  onReceiptValidated,
  calculateCostOf,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Available unpaid/partial readings (safely guarded with array fallback)
  const safeAllReadings = Array.isArray(allReadings) && allReadings.length > 0 
    ? allReadings 
    : (reading ? [reading] : mockDb.getReadings().filter(r => r.accountNumber === consumerRecord.accountNumber));

  const unpaidReadings = safeAllReadings.filter(r => r && r.paymentStatus !== 'paid');
  const targetReading = reading || (unpaidReadings.length > 0 ? unpaidReadings[0] : null);

  const [selectedReadingId, setSelectedReadingId] = useState<string>(targetReading?.id || '');
  const activeReading = safeAllReadings.find(r => r.id === selectedReadingId) || targetReading;

  // Calculation
  const grossCost = activeReading 
    ? calculateCostOf(activeReading.consumption, consumerRecord.consumerType)
    : 0;
  const alreadyPaid = activeReading?.paidAmount || 0;
  const currentNetDue = Math.max(0, grossCost - alreadyPaid);

  // Strict 50% minimum rule
  const minPartialAmount = Math.round((currentNetDue * 0.50) * 100) / 100;

  // Form states
  const [settlementType, setSettlementType] = useState<'full' | 'partial'>('full');
  const [paymentAmount, setPaymentAmount] = useState<string>(currentNetDue.toFixed(2));
  const [orNumber, setOrNumber] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [cashierCounter, setCashierCounter] = useState<string>('TWD Main Office - Counter 1');
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState<string | null>(null);
  const [receiptNotes, setReceiptNotes] = useState<string>('');

  // UI / Validation states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showPhotoZoom, setShowPhotoZoom] = useState(false);

  // Synchronize when target reading or modal opens
  useEffect(() => {
    if (activeReading) {
      setSelectedReadingId(activeReading.id);
      const gross = calculateCostOf(activeReading.consumption, consumerRecord.consumerType);
      const paid = activeReading.paidAmount || 0;
      const net = Math.max(0, gross - paid);
      setSettlementType('full');
      setPaymentAmount(net.toFixed(2));
      setOrNumber(`OR-2024-${Math.floor(100000 + Math.random() * 900000)}`);
      setReceiptPhotoUrl(activeReading.paymentReceiptUrl || null);
      setValidationError(null);
    }
  }, [activeReading?.id, isOpen]);

  if (!isOpen) return null;

  const numericPayment = parseFloat(paymentAmount) || 0;
  const isLessThan50Percent = settlementType === 'partial' && numericPayment < minPartialAmount;
  const isGreaterThanBalance = numericPayment > currentNetDue + 0.05;
  const calculatedRemaining = Math.max(0, currentNetDue - numericPayment);

  // File Upload Handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setValidationError('Please upload a valid image file (JPEG, PNG, WEBP).');
      return;
    }
    setValidationError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setReceiptPhotoUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // Generate Sample Official Receipt (for convenience testing)
  const handleGenerateSampleReceipt = () => {
    // High-resolution SVG canvas representation of a genuine TWD Cashier OR
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.fillStyle = '#faf8f5';
    ctx.fillRect(0, 0, 600, 800);

    // Border
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 4;
    ctx.strokeRect(15, 15, 570, 770);

    // Inner thin border
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(25, 25, 550, 750);

    // Official Header
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('REPUBLIC OF THE PHILIPPINES', 300, 60);

    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('TAGOLOAN WATER DISTRICT', 300, 90);

    ctx.fillStyle = '#475569';
    ctx.font = '12px sans-serif';
    ctx.fillText('Poblacion, Tagoloan, Misamis Oriental 9001', 300, 110);
    ctx.fillText('OFFICIAL RECEIPT / CASHIER SLIP', 300, 130);

    // Divider
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 145);
    ctx.lineTo(560, 145);
    ctx.stroke();

    // Receipt Meta
    ctx.textAlign = 'left';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#dc2626';
    ctx.fillText(`OR NO: ${orNumber || 'OR-2024-884912'}`, 50, 175);

    ctx.fillStyle = '#334155';
    ctx.font = '12px sans-serif';
    ctx.fillText(`DATE: ${paymentDate}`, 380, 175);
    ctx.fillText(`COLLECTOR: ${cashierCounter}`, 50, 200);
    ctx.fillText(`PAYOR: ${consumerRecord.name.toUpperCase()}`, 50, 225);
    ctx.fillText(`ACCOUNT NO: ${consumerRecord.accountNumber}`, 50, 250);
    ctx.fillText(`METER NO: ${activeReading?.meterNumber || consumerRecord.meterNumber}`, 50, 275);
    ctx.fillText(`BILLING PERIOD: ${activeReading?.billingPeriod || 'Current Period'}`, 50, 300);

    // Table Header
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(45, 325, 510, 30);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('PARTICULARS / NATURE OF COLLECTION', 60, 345);
    ctx.fillText('AMOUNT (PHP)', 430, 345);

    // Table Row
    ctx.font = '13px sans-serif';
    ctx.fillText('Water Tariff Consumption Charge', 60, 385);
    ctx.fillText(`₱ ${numericPayment.toFixed(2)}`, 430, 385);

    if (settlementType === 'partial') {
      ctx.font = 'italic 11px sans-serif';
      ctx.fillStyle = '#d97706';
      ctx.fillText(`(Partial 50%+ Clearance — Bal: ₱${calculatedRemaining.toFixed(2)})`, 60, 405);
    }

    // Total Line
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(45, 460);
    ctx.lineTo(555, 460);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('TOTAL AMOUNT PAID:', 220, 490);
    ctx.fillStyle = '#15803d';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`₱ ${numericPayment.toFixed(2)}`, 420, 490);

    // Payment Mode stamp
    ctx.fillStyle = '#0284c7';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('PAYMENT METHOD: OVER-THE-COUNTER CASH', 60, 540);
    ctx.fillText('STATUS: FULLY PROCESSED BY TWD TREASURY', 60, 565);

    // Stamp circle
    ctx.save();
    ctx.translate(450, 640);
    ctx.rotate(-0.15);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3;
    ctx.strokeRect(-90, -35, 180, 70);
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TWD PAID', 0, -5);
    ctx.font = '10px sans-serif';
    ctx.fillText('OFFICIALLY VALIDATED', 0, 15);
    ctx.restore();

    // Footer signature
    ctx.textAlign = 'left';
    ctx.fillStyle = '#475569';
    ctx.font = '11px sans-serif';
    ctx.fillText('Authorized Collecting Officer: __________________________', 50, 680);
    ctx.fillText('Customer Acknowledgment: __________________________', 50, 715);
    ctx.font = 'italic 10px sans-serif';
    ctx.fillText('This document serves as proof of payment upon portal validation.', 50, 745);

    const generatedDataUrl = canvas.toDataURL('image/png');
    setReceiptPhotoUrl(generatedDataUrl);
    setValidationError(null);
  };

  // Submit Receipt Confirmation
  const handleSubmitReceipt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReading) {
      setValidationError('No active billing statement selected.');
      return;
    }

    if (!orNumber.trim()) {
      setValidationError('Please provide the Official Receipt (OR) Number from your physical cashier receipt.');
      return;
    }

    if (numericPayment <= 0) {
      setValidationError('Please specify a valid payment amount greater than ₱0.00.');
      return;
    }

    // Strict 50% partial rule validation
    if (settlementType === 'partial' && numericPayment < minPartialAmount) {
      setValidationError(
        `Strict Tagoloan Water District Policy: Partial payments must be at least 50% (₱${minPartialAmount.toFixed(2)}) of the outstanding balance. Payments below 50% are not accepted.`
      );
      return;
    }

    if (!receiptPhotoUrl) {
      setValidationError('Please capture or upload a clear photo of your official payment receipt.');
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);

    setTimeout(() => {
      const newTotalPaid = alreadyPaid + numericPayment;
      const newRemainingBalance = Math.max(0, grossCost - newTotalPaid);
      const isFullSettlement = newRemainingBalance <= 0.01;
      const newPaymentStatus: 'paid' | 'partial' = isFullSettlement ? 'paid' : 'partial';

      // 1. Update reading in mockDb
      const allReadings = mockDb.getReadings();
      const updatedReadings = allReadings.map(r => {
        if (r.id === activeReading.id) {
          return {
            ...r,
            paymentStatus: newPaymentStatus,
            paymentDate: paymentDate,
            paymentMethod: `TWD Office Cashier (${cashierCounter})`,
            orNumber: orNumber.trim(),
            paidAmount: newTotalPaid,
            remainingBalance: newRemainingBalance,
            paymentReceiptUrl: receiptPhotoUrl,
            receiptUploadDate: new Date().toISOString(),
            receiptStatus: 'verified' as const,
            receiptNotes: receiptNotes || `Validated at ${cashierCounter}`,
            isDisconnectionNoticeIssued: isFullSettlement ? false : r.isDisconnectionNoticeIssued,
            penaltyAmount: isFullSettlement ? 0 : r.penaltyAmount,
          };
        }
        return r;
      });
      mockDb.saveReadings(updatedReadings);

      // 2. Update Consumer Master Outstanding Balance
      const conUnpaid = updatedReadings.filter(
        r => r.accountNumber === consumerRecord.accountNumber && r.paymentStatus !== 'paid'
      );
      const newTotalArrears = conUnpaid.reduce((acc, r) => {
        const gross = calculateCostOf(r.consumption, consumerRecord.consumerType);
        const paid = r.paidAmount || 0;
        return acc + Math.max(0, gross - paid);
      }, 0);

      const updatedConsumers = mockDb.getConsumers().map(c => 
        c.accountNumber === consumerRecord.accountNumber
          ? { 
              ...c, 
              outstandingBalance: newTotalArrears,
              status: c.status === 'blocked' && newTotalArrears === 0 ? 'active' : c.status
            }
          : c
      );
      mockDb.saveConsumers(updatedConsumers);

      // 3. Create Official Real-time Notification
      mockDb.addNotification({
        accountNumber: consumerRecord.accountNumber,
        title: isFullSettlement
          ? `Receipt Validated: ${activeReading.billingPeriod} Settled in Full`
          : `Receipt Validated: Partial Payment (₱${numericPayment.toFixed(2)}) Recorded`,
        message: isFullSettlement
          ? `Your official physical cashier receipt (OR #${orNumber}) has been validated! Account balance for ${activeReading.billingPeriod} is cleared in full (₱0.00). Alert notifications stopped.`
          : `Your official cashier receipt (OR #${orNumber}) has been verified. 50%+ partial payment of ₱${numericPayment.toFixed(2)} credited. Remaining balance: ₱${newRemainingBalance.toFixed(2)}.`,
        type: 'receipt_upload',
        orNumber: orNumber.trim(),
        amountPaid: numericPayment,
        remainingBalance: newRemainingBalance,
        readingId: activeReading.id,
        billingPeriod: activeReading.billingPeriod,
        receiptUrl: receiptPhotoUrl
      });

      // 4. Create Audit Log
      mockDb.addAuditLog(
        consumerRecord.linkedUserId || 'consumer',
        consumerRecord.name,
        'consumer',
        'Upload Cashier Payment Receipt',
        `Uploaded official physical receipt (OR #${orNumber}) for ${activeReading.billingPeriod}. Paid: ₱${numericPayment.toFixed(2)}, Remaining: ₱${newRemainingBalance.toFixed(2)} at ${cashierCounter}.`
      );

      // Find updated reading object
      const updatedItem = updatedReadings.find(r => r.id === activeReading.id) || activeReading;

      setIsSubmitting(false);
      if (typeof onSuccess === 'function') {
        onSuccess(updatedItem, orNumber, !isFullSettlement);
      }
      if (typeof onReceiptValidated === 'function') {
        onReceiptValidated({
          billingPeriod: activeReading.billingPeriod,
          amountPaid: numericPayment,
          remainingBalance: newRemainingBalance,
          isPartial: !isFullSettlement,
          orNumber: orNumber.trim(),
          paymentDate: paymentDate
        });
      }
      onClose();
    }, 450);
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in overflow-y-auto"
      onClick={onClose}
      id="upload-receipt-modal-backdrop"
    >
      <div 
        className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl shadow-2xl relative overflow-hidden my-8 animate-scale-up"
        onClick={(e) => e.stopPropagation()}
        id="upload-receipt-modal"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 text-white p-5 sm:p-6 flex items-start justify-between relative">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 bg-blue-600 text-white font-black text-[10px] uppercase tracking-wider rounded-lg flex items-center space-x-1">
                <ReceiptText className="h-3 w-3" />
                <span>Office Payment Verification</span>
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-wider rounded-lg flex items-center space-x-1">
                <ShieldCheck className="h-3 w-3" />
                <span>Instant Alert Clearance</span>
              </span>
            </div>
            <h3 className="text-xl font-black text-white tracking-tight">
              Upload Official Payment Receipt
            </h3>
            <p className="text-xs text-blue-200/90 leading-relaxed max-w-lg">
              Paid in person at the Tagoloan Water District Office? Upload a photo of your Official Receipt (OR) to instantly confirm your account payment and stop billing alerts.
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmitReceipt} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          
          {/* Validation Error Banner */}
          {validationError && (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl flex items-start space-x-3 text-xs animate-shake">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <strong className="font-black block uppercase text-[11px]">Action Required:</strong>
                <p className="leading-relaxed">{validationError}</p>
              </div>
            </div>
          )}

          {/* Statement Selection & Outstanding Status */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-black text-slate-700 uppercase tracking-wider">
                Select Billing Statement Paid:
              </label>
              <span className="text-[11px] font-mono text-slate-500">
                Account: <strong>{consumerRecord.accountNumber}</strong>
              </span>
            </div>

            <select
              value={selectedReadingId}
              onChange={(e) => {
                const target = allReadings.find(r => r.id === e.target.value);
                if (target) {
                  setSelectedReadingId(target.id);
                  const gross = calculateCostOf(target.consumption, consumerRecord.consumerType);
                  const paid = target.paidAmount || 0;
                  const net = Math.max(0, gross - paid);
                  setPaymentAmount(net.toFixed(2));
                }
              }}
              className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500"
            >
              {allReadings.map(r => {
                const gross = calculateCostOf(r.consumption, consumerRecord.consumerType);
                const paid = r.paidAmount || 0;
                const net = Math.max(0, gross - paid);
                return (
                  <option key={r.id} value={r.id}>
                    {r.billingPeriod} — {r.consumption} m³ (Due: ₱{net.toFixed(2)}) [{r.paymentStatus?.toUpperCase() || 'UNPAID'}]
                  </option>
                );
              })}
            </select>

            <div className="grid grid-cols-3 gap-3 pt-2 text-center text-xs">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Gross Bill</span>
                <span className="font-mono font-black text-slate-800 text-sm mt-0.5 block">
                  ₱{grossCost.toFixed(2)}
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Already Credited</span>
                <span className="font-mono font-bold text-emerald-700 text-sm mt-0.5 block">
                  ₱{alreadyPaid.toFixed(2)}
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <span className="text-[10px] text-rose-600 font-black uppercase block">Net Statement Due</span>
                <span className="font-mono font-black text-rose-600 text-sm mt-0.5 block">
                  ₱{currentNetDue.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Settlement Mode Selection: Full vs Partial (Strict 50% Rule) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-slate-800 uppercase tracking-wider">
                Payment Settlement Mode
              </label>
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                Tagoloan Water District Policy: Minimum 50% for Partials
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSettlementType('full');
                  setPaymentAmount(currentNetDue.toFixed(2));
                  setValidationError(null);
                }}
                className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                  settlementType === 'full'
                    ? 'border-blue-600 bg-blue-50/80 ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-blue-700 uppercase">Full Payment (100%)</span>
                  {settlementType === 'full' && <CheckCircle2 className="h-4 w-4 text-blue-600" />}
                </div>
                <span className="text-base font-black font-mono text-slate-900 block mt-1">
                  ₱{currentNetDue.toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-500">Completely clears statement</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSettlementType('partial');
                  setPaymentAmount(minPartialAmount.toFixed(2));
                  setValidationError(null);
                }}
                className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                  settlementType === 'partial'
                    ? 'border-amber-600 bg-amber-50/80 ring-2 ring-amber-500/20'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-800 uppercase">Partial Payment (≥ 50%)</span>
                  {settlementType === 'partial' && <CheckCircle2 className="h-4 w-4 text-amber-600" />}
                </div>
                <span className="text-base font-black font-mono text-amber-900 block mt-1">
                  Min: ₱{minPartialAmount.toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-500">Must be at least 50% of balance</span>
              </button>
            </div>

            {/* Partial Payment Amount Input & Quick Chips */}
            {settlementType === 'partial' && (
              <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-amber-950 uppercase">
                    Enter Partial Amount Paid at Cashier:
                  </label>
                  <span className="text-[10px] font-bold text-amber-800">
                    Min 50%: <strong>₱{minPartialAmount.toFixed(2)}</strong>
                  </span>
                </div>

                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-mono font-bold text-xs">₱</span>
                  <input
                    type="number"
                    step="0.01"
                    min={minPartialAmount}
                    max={currentNetDue}
                    value={paymentAmount}
                    onChange={(e) => {
                      setPaymentAmount(e.target.value);
                      setValidationError(null);
                    }}
                    className={`w-full bg-white border ${
                      isLessThan50Percent ? 'border-rose-500 ring-2 ring-rose-200' : 'border-amber-300'
                    } pl-8 pr-4 py-2.5 text-xs rounded-xl font-mono font-black text-slate-900`}
                    placeholder={`Min ₱${minPartialAmount.toFixed(2)}`}
                  />
                </div>

                {/* Strict 50% validation warning */}
                {isLessThan50Percent && (
                  <p className="text-[11px] text-rose-600 font-bold flex items-center space-x-1 animate-pulse">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                    <span>Strict Rule: Partial payments below ₱{minPartialAmount.toFixed(2)} (50%) are strictly prohibited.</span>
                  </p>
                )}

                {/* Quick percentage helper chips */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Quick Amounts:</span>
                  <button
                    type="button"
                    onClick={() => setPaymentAmount(minPartialAmount.toFixed(2))}
                    className="px-2.5 py-1 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg text-[10px] font-bold text-amber-900 transition cursor-pointer"
                  >
                    50% (₱{minPartialAmount.toFixed(2)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentAmount((Math.round((currentNetDue * 0.75) * 100) / 100).toFixed(2))}
                    className="px-2.5 py-1 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg text-[10px] font-bold text-amber-900 transition cursor-pointer"
                  >
                    75% (₱{(Math.round((currentNetDue * 0.75) * 100) / 100).toFixed(2)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentAmount(currentNetDue.toFixed(2))}
                    className="px-2.5 py-1 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg text-[10px] font-bold text-amber-900 transition cursor-pointer"
                  >
                    100% Full (₱{currentNetDue.toFixed(2)})
                  </button>
                </div>

                <div className="flex justify-between text-xs pt-2 border-t border-amber-200/60 text-amber-900">
                  <span>Balance remaining after this partial credit:</span>
                  <strong className="font-mono text-rose-700">
                    ₱{calculatedRemaining.toFixed(2)}
                  </strong>
                </div>
              </div>
            )}
          </div>

          {/* Cashier Receipt Details (OR Number, Date, Counter) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="space-y-1 sm:col-span-1">
              <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider">
                Official Receipt (OR) # <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={orNumber}
                onChange={(e) => setOrNumber(e.target.value)}
                placeholder="e.g. OR-2024-884912"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1 sm:col-span-1">
              <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider">
                Date of Payment <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1 sm:col-span-1">
              <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider">
                Payment Location / Counter
              </label>
              <select
                value={cashierCounter}
                onChange={(e) => setCashierCounter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-900 focus:bg-white"
              >
                <option value="TWD Main Office - Counter 1">TWD Main Office (Counter 1)</option>
                <option value="TWD Main Office - Counter 2">TWD Main Office (Counter 2)</option>
                <option value="Poblacion Treasury Window">Poblacion Treasury Window</option>
                <option value="Barangay Collection Sub-Station">Barangay Collection Sub-Station</option>
              </select>
            </div>
          </div>

          {/* Receipt Photo Upload Area */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                <Camera className="h-4 w-4 text-blue-600" />
                <span>Upload Physical Receipt Photo (Required)</span>
                <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={handleGenerateSampleReceipt}
                className="text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition flex items-center space-x-1 cursor-pointer"
                title="Generates an authentic demo receipt if you don't have a camera photo ready"
              >
                <Sparkles className="h-3 w-3 text-blue-500" />
                <span>Auto-Generate Sample Receipt</span>
              </button>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />

            {!receiptPhotoUrl ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition ${
                  isDragOver 
                    ? 'border-blue-600 bg-blue-50/80 scale-[1.01]' 
                    : 'border-slate-300 hover:border-blue-500 hover:bg-slate-50'
                }`}
              >
                <div className="max-w-sm mx-auto space-y-3">
                  <div className="h-14 w-14 bg-blue-50 text-blue-600 rounded-2xl mx-auto flex items-center justify-center shadow-xs">
                    <Upload className="h-7 w-7" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-black text-slate-900 uppercase tracking-wide">
                      Click to Browse or Drag & Drop Receipt Photo
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Supports JPG, PNG, WEBP from your phone camera or computer. Make sure the OR # and total amount are clearly readable.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative border border-slate-200 bg-slate-900 rounded-2xl overflow-hidden shadow-md group">
                <img
                  src={receiptPhotoUrl}
                  alt="Official Receipt"
                  className="w-full h-56 object-contain bg-slate-950/80"
                />

                <div className="absolute top-3 right-3 flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setShowPhotoZoom(true)}
                    className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-xl backdrop-blur-xs transition cursor-pointer"
                    title="Zoom in"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptPhotoUrl(null)}
                    className="p-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition cursor-pointer"
                    title="Remove Photo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="font-bold">Receipt Photo Attached & Ready</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[10px] text-blue-300 hover:text-white underline cursor-pointer"
                  >
                    Change Photo
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Optional notes */}
          <div className="space-y-1 text-xs">
            <label className="block text-[11px] font-bold text-slate-600 uppercase">
              Additional Notes / Remarks (Optional)
            </label>
            <input
              type="text"
              value={receiptNotes}
              onChange={(e) => setReceiptNotes(e.target.value)}
              placeholder="e.g. Paid in cash at Poblacion hall by representative"
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:bg-white"
            />
          </div>

          {/* Summary & Submit Action */}
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">
                Total Payment Credited
              </span>
              <span className="text-xl font-black font-mono text-emerald-700">
                ₱{numericPayment.toFixed(2)}
              </span>
              <span className="text-[10px] text-slate-500 block">
                {settlementType === 'full' 
                  ? 'Clears statement balance in full' 
                  : `Remaining balance: ₱${calculatedRemaining.toFixed(2)}`}
              </span>
            </div>

            <div className="flex items-center space-x-2.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 sm:flex-none px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting || isLessThan50Percent || !receiptPhotoUrl || !orNumber.trim()}
                className={`flex-1 sm:flex-none px-6 py-3 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer ${
                  isSubmitting || isLessThan50Percent || !receiptPhotoUrl || !orNumber.trim()
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white'
                }`}
                id="submit-receipt-confirm-btn"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>Verifying Receipt...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>Confirm & Validate Payment</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </form>

        {/* Full Image Zoom Modal */}
        {showPhotoZoom && receiptPhotoUrl && (
          <div 
            className="fixed inset-0 bg-black/90 z-60 flex items-center justify-center p-4"
            onClick={() => setShowPhotoZoom(false)}
          >
            <div className="relative max-w-3xl max-h-[90vh]">
              <img
                src={receiptPhotoUrl}
                alt="Receipt Full Preview"
                className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain"
              />
              <button
                onClick={() => setShowPhotoZoom(false)}
                className="absolute top-4 right-4 p-2 bg-black/70 hover:bg-black text-white rounded-full transition cursor-pointer"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default UploadReceiptModal;

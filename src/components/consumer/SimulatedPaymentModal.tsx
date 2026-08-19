import React, { useState, useEffect } from 'react';
import { 
  X, 
  CreditCard, 
  Smartphone, 
  Waves, 
  ShieldCheck, 
  CheckCircle2, 
  Lock, 
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Printer,
  ReceiptText
} from 'lucide-react';
import { Consumer, MeterReading } from '../../types';
import { mockDb } from '../../mockDb';

interface SimulatedPaymentModalProps {
  isOpen: boolean;
  reading: MeterReading | null;
  consumerRecord: Consumer;
  initialMode?: 'full' | 'partial';
  onClose: () => void;
  onPaymentSuccess: (receipt: any) => void;
  calculateCostOf: (usage: number, classification?: 'Residential' | 'Commercial') => number;
}

export const SimulatedPaymentModal: React.FC<SimulatedPaymentModalProps> = ({
  isOpen,
  reading,
  consumerRecord,
  initialMode = 'full',
  onClose,
  onPaymentSuccess,
  calculateCostOf,
}) => {
  if (!isOpen || !reading) return null;

  const grossAmount = calculateCostOf(reading.consumption, consumerRecord.consumerType);
  const paidAlready = reading.paidAmount || 0;
  const netDue = Math.max(0, grossAmount - paidAlready);

  // Check if bill was overdue
  const dueDateObj = reading.dueDate 
    ? new Date(reading.dueDate) 
    : new Date('2026-06-20');
  const isOverdue = new Date() > dueDateObj && netDue > 0;
  const latePenalty = isOverdue 
    ? (reading.penaltyAmount !== undefined ? reading.penaltyAmount : Math.round(netDue * 0.10 * 100) / 100)
    : 0;

  const [paymentMode, setPaymentMode] = useState<'full' | 'partial'>(initialMode);
  const [includeLateFee, setIncludeLateFee] = useState(isOverdue);
  const [customAmount, setCustomAmount] = useState(netDue.toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState<'gcash' | 'maya' | 'card' | 'bank'>('gcash');

  // Form Fields
  const [gcashPhone, setGcashPhone] = useState(
    consumerRecord.contactNumber ? consumerRecord.contactNumber.replace(/[^0-9]/g, '').slice(-10) : ''
  );
  const [cardName, setCardName] = useState(consumerRecord.name || '');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [bankAccountNum, setBankAccountNum] = useState('');

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<{
    step: number;
    percentage: number;
    title: string;
    description: string;
  } | null>(null);

  // Receipt modal after settlement
  const [generatedReceipt, setGeneratedReceipt] = useState<any | null>(null);

  // Reset states on bill change
  useEffect(() => {
    setPaymentMode(initialMode);
    setCustomAmount(netDue.toFixed(2));
    setIncludeLateFee(isOverdue);
    setIsProcessing(false);
    setProcessingStage(null);
    setGeneratedReceipt(null);
  }, [reading, initialMode]);

  // Compute final payable
  const payableBase = paymentMode === 'full'
    ? netDue
    : Math.min(netDue, Math.max(1, parseFloat(customAmount) || 0));
  
  const totalAmountToPay = payableBase + (includeLateFee ? latePenalty : 0);

  const getMethodLabel = (method: 'gcash' | 'maya' | 'card' | 'bank') => {
    switch (method) {
      case 'gcash': return 'GCash Mobile Wallet';
      case 'maya': return 'Maya Digital Wallet';
      case 'card': return 'Credit/Debit Card (Visa/Mastercard)';
      case 'bank': return 'Landbank Link.BizPortal';
    }
  };

  const handleStartSimulatedPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (totalAmountToPay <= 0) {
      alert('Please enter a valid payment amount greater than ₱0.00');
      return;
    }

    setIsProcessing(true);
    let stage = 0;

    const interval = setInterval(() => {
      stage++;
      if (stage === 1) {
        setProcessingStage({
          step: 1,
          percentage: 25,
          title: `Connecting to ${getMethodLabel(paymentMethod)}...`,
          description: 'Encrypting transaction token and requesting payment authorization.'
        });
      } else if (stage === 2) {
        setProcessingStage({
          step: 2,
          percentage: 55,
          title: 'Verifying Consumer Tariff & Meter Telemetry...',
          description: `Validating Account #${consumerRecord.accountNumber} and clearing overdue status.`
        });
      } else if (stage === 3) {
        setProcessingStage({
          step: 3,
          percentage: 85,
          title: 'Updating Central Tagoloan Water Municipal Ledger...',
          description: 'Recording official payment timestamp and generating Official Electronic Receipt.'
        });
      } else if (stage === 4) {
        clearInterval(interval);

        const transactionId = `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`;
        const paymentReference = `PAYREF-${Math.floor(100000 + Math.random() * 900000)}`;
        const orNumber = `OR-TWD-${Math.floor(100000 + Math.random() * 900000)}`;
        const paymentDate = new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const newTotalPaid = paidAlready + payableBase;
        const newRemainingBalance = Math.max(0, grossAmount - newTotalPaid);
        const isFullSettlement = newRemainingBalance <= 0.01;
        const newPaymentStatus: 'paid' | 'partial' = isFullSettlement ? 'paid' : 'partial';

        const successReceiptData = {
          readingId: reading.id,
          accountNumber: reading.accountNumber,
          consumerName: consumerRecord.name,
          meterNumber: reading.meterNumber,
          amountPaid: totalAmountToPay,
          principalPaid: payableBase,
          penaltyPaid: includeLateFee ? latePenalty : 0,
          grossAmount,
          totalPaid: newTotalPaid,
          remainingBalance: newRemainingBalance,
          paymentMethod: getMethodLabel(paymentMethod),
          billingPeriod: reading.billingPeriod,
          consumption: reading.consumption,
          transactionId,
          paymentReference,
          orNumber,
          paymentDate,
          isPartial: !isFullSettlement,
          wasOverdue: isOverdue,
        };

        // 1. Update reading in mockDb
        const allReadings = mockDb.getReadings();
        const updatedReadings = allReadings.map(r => {
          if (r.id === reading.id) {
            return {
              ...r,
              paymentStatus: newPaymentStatus,
              paymentDate,
              paymentMethod: getMethodLabel(paymentMethod),
              transactionId,
              paymentReference,
              orNumber,
              paidAmount: newTotalPaid,
              remainingBalance: newRemainingBalance,
              penaltyAmount: isOverdue && includeLateFee ? 0 : r.penaltyAmount,
            };
          }
          return r;
        });
        mockDb.saveReadings(updatedReadings);

        // 2. Re-calculate Consumer Master Outstanding Balance
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
            ? { ...c, outstandingBalance: newTotalArrears }
            : c
        );
        mockDb.saveConsumers(updatedConsumers);

        // 3. Add real-time Notification in mockDb
        mockDb.addNotification({
          accountNumber: consumerRecord.accountNumber,
          title: isFullSettlement 
            ? `Payment Confirmed: ${reading.billingPeriod} Settled in Full` 
            : `Partial Payment Credited: ${reading.billingPeriod}`,
          message: isFullSettlement 
            ? `Your payment of ₱${totalAmountToPay.toFixed(2)} for ${reading.billingPeriod} has been cleared in full via ${getMethodLabel(paymentMethod)}. Official Receipt #: ${orNumber}. Overdue notices resolved.`
            : `Partial payment of ₱${totalAmountToPay.toFixed(2)} for ${reading.billingPeriod} has been recorded. Remaining balance of ₱${newRemainingBalance.toFixed(2)} is due. OR #: ${orNumber}.`,
          type: 'payment',
          orNumber,
          amountPaid: totalAmountToPay,
          remainingBalance: newRemainingBalance,
          readingId: reading.id,
          billingPeriod: reading.billingPeriod
        });

        // 4. Add system Audit Log
        mockDb.addAuditLog(
          consumerRecord.linkedUserId || 'consumer',
          consumerRecord.name,
          'consumer',
          'Online Bill Settlement',
          `Authorized payment of ₱${totalAmountToPay.toFixed(2)} for ${reading.billingPeriod} statement via ${getMethodLabel(paymentMethod)}. (OR: ${orNumber})`
        );

        setGeneratedReceipt(successReceiptData);
        setIsProcessing(false);
        setProcessingStage(null);

        // Notify parent
        onPaymentSuccess(successReceiptData);
      }
    }, 600);
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in overflow-y-auto"
      onClick={onClose}
      id="simulated-payment-modal-backdrop"
    >
      <div 
        className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg shadow-2xl relative overflow-hidden my-8 animate-scale-up"
        onClick={(e) => e.stopPropagation()}
        id="simulated-payment-modal"
      >
        {/* Header Ribbon */}
        <div className="bg-slate-900 text-white p-5 sm:p-6 flex items-start justify-between relative overflow-hidden">
          <div className="space-y-1 relative z-10">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 bg-blue-600 text-white font-black text-[10px] uppercase tracking-wider rounded-lg flex items-center space-x-1">
                <Lock className="h-3 w-3" />
                <span>Simulated Secure Gateway</span>
              </span>
              {isOverdue && (
                <span className="px-2.5 py-0.5 bg-rose-600 text-white font-black text-[10px] uppercase tracking-wider rounded-lg flex items-center space-x-1 animate-pulse">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Overdue Clearance</span>
                </span>
              )}
            </div>
            <h3 className="text-lg font-black text-white">
              Settle Water Tariff — {reading.billingPeriod}
            </h3>
            <p className="text-xs text-slate-300">
              Tagoloan Water District Online Settlement Portal
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-white p-1.5 rounded-full hover:bg-slate-800 transition cursor-pointer relative z-10"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* PROCESSING STAGE ANIMATION */}
        {isProcessing && processingStage && (
          <div className="p-8 text-center space-y-6 animate-fade-in">
            <div className="relative h-20 w-20 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"></div>
              <ShieldCheck className="h-8 w-8 text-blue-600" />
            </div>

            <div className="space-y-2">
              <h4 className="text-base font-black text-slate-900">{processingStage.title}</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                {processingStage.description}
              </p>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                <div 
                  className="bg-gradient-to-r from-blue-600 to-emerald-500 h-full transition-all duration-300 ease-out"
                  style={{ width: `${processingStage.percentage}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>Step {processingStage.step} of 4</span>
                <span>{processingStage.percentage}% complete</span>
              </div>
            </div>
          </div>
        )}

        {/* SUCCESS RECEIPT DISPLAY */}
        {!isProcessing && generatedReceipt && (
          <div className="p-6 sm:p-7 space-y-5 animate-fade-in">
            <div className="text-center space-y-1.5">
              <div className="h-14 w-14 bg-emerald-50 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center shadow-xs">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <span className="text-[10px] font-black uppercase text-emerald-700 tracking-widest bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 inline-block">
                Settlement Cleared & Verified
              </span>
              <h3 className="text-lg font-black text-slate-900">
                Official Electronic Payment Receipt
              </h3>
              <p className="text-xs text-slate-500">
                Tagoloan Water District • Misamis Oriental
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4.5 space-y-2.5 text-xs text-slate-700 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Consumer:</span>
                <strong className="text-slate-900 font-sans">{generatedReceipt.consumerName}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Account Number:</span>
                <span className="font-bold text-slate-900">{generatedReceipt.accountNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Billing Period:</span>
                <span className="font-bold text-slate-900">{generatedReceipt.billingPeriod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Meter Serial:</span>
                <span className="font-bold text-blue-700">{generatedReceipt.meterNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Official Receipt #:</span>
                <span className="font-bold text-emerald-700">{generatedReceipt.orNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Payment Channel:</span>
                <span className="font-bold text-slate-800 uppercase">{generatedReceipt.paymentMethod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Date Settled:</span>
                <span className="font-bold text-slate-800">{generatedReceipt.paymentDate}</span>
              </div>
              
              <div className="pt-2.5 border-t border-slate-200 border-dashed flex justify-between items-baseline">
                <span className="text-xs font-bold text-slate-900 font-sans">Total Amount Credited:</span>
                <span className="text-xl font-black text-emerald-700 font-sans">
                  ₱{generatedReceipt.amountPaid.toFixed(2)}
                </span>
              </div>

              {generatedReceipt.isPartial && (
                <div className="flex justify-between text-xs pt-1">
                  <span className="text-rose-600 font-bold font-sans">Remaining Balance Due:</span>
                  <span className="text-rose-600 font-black font-sans">
                    ₱{generatedReceipt.remainingBalance.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                onClick={() => window.print()}
                className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Print Official Receipt</span>
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* CHECKOUT FORM */}
        {!isProcessing && !generatedReceipt && (
          <form onSubmit={handleStartSimulatedPayment} className="p-6 sm:p-7 space-y-5">
            
            {/* Bill Summary Card */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                    Statement Details
                  </span>
                  <h4 className="text-sm font-black text-slate-900 mt-0.5">
                    {reading.billingPeriod} • {reading.consumption} m³ Intake
                  </h4>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                    Outstanding Balance
                  </span>
                  <span className="text-base font-black font-mono text-rose-700">
                    ₱{netDue.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Overdue Warning & Surcharge Box */}
              {isOverdue && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between text-rose-900">
                    <span className="flex items-center space-x-1 font-bold">
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
                      <span>10% Overdue Late Surcharge:</span>
                    </span>
                    <span className="font-mono font-black text-rose-700">+₱{latePenalty.toFixed(2)}</span>
                  </div>

                  <label className="flex items-center space-x-2 text-[11px] text-slate-700 cursor-pointer pt-1 border-t border-rose-200/60">
                    <input 
                      type="checkbox"
                      checked={includeLateFee}
                      onChange={(e) => setIncludeLateFee(e.target.checked)}
                      className="h-3.5 w-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                    />
                    <span>Include 10% Late Surcharge in this settlement (Recommended)</span>
                  </label>
                </div>
              )}
            </div>

            {/* Payment Mode (Full vs Partial) */}
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                Settlement Amount Mode
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMode('full');
                    setCustomAmount(netDue.toFixed(2));
                  }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    paymentMode === 'full'
                      ? 'border-blue-600 bg-blue-50/80 ring-2 ring-blue-500/20'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[10px] font-black text-blue-600 uppercase block">Full Settlement</span>
                  <span className="text-sm font-black font-mono text-slate-900 block mt-0.5">
                    ₱{netDue.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-slate-500">Clears entire statement</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMode('partial')}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    paymentMode === 'partial'
                      ? 'border-amber-600 bg-amber-50/80 ring-2 ring-amber-500/20'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[10px] font-black text-amber-700 uppercase block">Partial Payment</span>
                  <span className="text-sm font-black font-mono text-slate-900 block mt-0.5">
                    Custom Amount
                  </span>
                  <span className="text-[10px] text-slate-500">Pay what you can today</span>
                </button>
              </div>

              {/* Partial Amount Input */}
              {paymentMode === 'partial' && (
                <div className="mt-3 p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                  <label className="block text-[11px] font-bold text-amber-900 uppercase">
                    Enter Amount to Settle (₱)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-slate-400 font-mono font-bold text-xs">₱</span>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      max={netDue}
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      className="w-full bg-white border border-amber-300 pl-8 pr-3 py-2 text-xs rounded-xl focus:border-amber-600 font-mono font-black text-slate-900"
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-amber-800">
                    <span>Remaining balance after payment:</span>
                    <strong className="font-mono text-rose-700">
                      ₱{Math.max(0, netDue - (parseFloat(customAmount) || 0)).toFixed(2)}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2.5">
                Select Payment Channel
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('gcash')}
                  className={`p-3 border rounded-2xl flex flex-col items-center justify-center space-y-1.5 transition cursor-pointer ${
                    paymentMethod === 'gcash'
                      ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold ring-2 ring-blue-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Smartphone className="h-4 w-4 text-blue-600" />
                  <span className="text-[11px]">GCash</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('maya')}
                  className={`p-3 border rounded-2xl flex flex-col items-center justify-center space-y-1.5 transition cursor-pointer ${
                    paymentMethod === 'maya'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-bold ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Smartphone className="h-4 w-4 text-emerald-600" />
                  <span className="text-[11px]">Maya</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`p-3 border rounded-2xl flex flex-col items-center justify-center space-y-1.5 transition cursor-pointer ${
                    paymentMethod === 'card'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold ring-2 ring-indigo-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <CreditCard className="h-4 w-4 text-indigo-600" />
                  <span className="text-[11px]">Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('bank')}
                  className={`p-3 border rounded-2xl flex flex-col items-center justify-center space-y-1.5 transition cursor-pointer ${
                    paymentMethod === 'bank'
                      ? 'border-amber-600 bg-amber-50 text-amber-800 font-bold ring-2 ring-amber-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Waves className="h-4 w-4 text-amber-600" />
                  <span className="text-[11px]">Landbank</span>
                </button>
              </div>
            </div>

            {/* Dynamic Credentials Input */}
            {(paymentMethod === 'gcash' || paymentMethod === 'maya') && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-1.5 text-xs">
                <label className="block text-[10px] font-bold text-slate-500 uppercase">
                  Registered {paymentMethod === 'gcash' ? 'GCash' : 'Maya'} Mobile Number
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400 font-mono font-bold text-xs">+63</span>
                  <input
                    type="tel"
                    required
                    value={gcashPhone}
                    onChange={(e) => setGcashPhone(e.target.value)}
                    className="w-full bg-white border border-slate-300 pl-11 pr-3 py-2 text-xs rounded-xl font-mono font-bold text-slate-900"
                  />
                </div>
                <span className="text-[9px] text-slate-400">
                  Simulated gateway: Instant OTP clearance pre-authorized
                </span>
              </div>
            )}

            {paymentMethod === 'card' && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2.5 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cardholder Name</label>
                  <input
                    type="text"
                    required
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    className="w-full bg-white border border-slate-300 px-3 py-1.5 text-xs rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Card Number</label>
                  <input
                    type="text"
                    required
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    className="w-full bg-white border border-slate-300 px-3 py-1.5 text-xs rounded-xl font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Expiry</label>
                    <input
                      type="text"
                      required
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(e.target.value)}
                      className="w-full bg-white border border-slate-300 px-3 py-1.5 text-xs rounded-xl font-mono text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">CVV</label>
                    <input
                      type="password"
                      required
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                      className="w-full bg-white border border-slate-300 px-3 py-1.5 text-xs rounded-xl font-mono text-center"
                    />
                  </div>
                </div>
              </div>
            )}

            {paymentMethod === 'bank' && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-1.5 text-xs">
                <label className="block text-[10px] font-bold text-slate-500 uppercase">
                  Landbank Link.BizPortal Account #
                </label>
                <input
                  type="text"
                  required
                  value={bankAccountNum}
                  onChange={(e) => setBankAccountNum(e.target.value)}
                  className="w-full bg-white border border-slate-300 px-3 py-2 text-xs rounded-xl font-mono"
                />
              </div>
            )}

            {/* Total Settlement Bar & Submit */}
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">
                  Total Settlement Amount
                </span>
                <span className="text-xl font-black font-mono text-slate-900">
                  ₱{totalAmountToPay.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 sm:flex-none px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 sm:flex-none px-6 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center justify-center space-x-1.5 cursor-pointer"
                  id="confirm-simulated-payment-btn"
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Authorize ₱{totalAmountToPay.toFixed(2)}</span>
                </button>
              </div>
            </div>

          </form>
        )}

      </div>
    </div>
  );
};

export default SimulatedPaymentModal;

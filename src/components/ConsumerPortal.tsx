/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Compass, 
  Users, 
  Droplet, 
  BookOpen, 
  Activity, 
  Lock, 
  LogOut, 
  HelpCircle,
  FileText,
  User,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  ChevronRight,
  Calculator,
  Calendar,
  Waves,
  CreditCard,
  Smartphone,
  ReceiptText,
  FileCheck,
  ShieldCheck,
  Wifi,
  Send,
  CheckCircle2,
  X,
  Menu,
  Clock,
  Bell,
  BarChart3,
  ListFilter,
  Eye,
  Printer,
  RefreshCw,
  MapPin,
  Tag,
  Hash,
  Phone,
  Mail,
  Home,
  Briefcase,
  Layers,
  Sparkles,
  Info,
  AlertTriangle,
  ArrowRight,
  LayoutDashboard,
  ExternalLink,
  Check
} from 'lucide-react';
import { mockDb } from '../mockDb';
import { User as UserType, Consumer, MeterReading, Announcement, ConsumerNotification } from '../types';
import { ConsumerPortalSkeleton, TableSkeleton, CardsGridSkeleton } from './common/SkeletonLoader';
import { OverdueBillBanner } from './consumer/OverdueBillBanner';
import { SimulatedPaymentModal } from './consumer/SimulatedPaymentModal';
import { useToast } from '../context/ToastContext';

interface ConsumerPortalProps {
  currentUser: UserType;
  onLogout: () => void;
}

export default function ConsumerPortal({ currentUser, onLogout }: ConsumerPortalProps) {
  const toast = useToast();
  // Navigation Modules: Dashboard, My Bills, My Usage, Notifications, My Profile
  const [activeTab, setActiveTab] = useState<'dashboard' | 'bills' | 'usage' | 'notifications' | 'profile'>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Loading States
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Core Data States
  const [consumerRecord, setConsumerRecord] = useState<Consumer | null>(null);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<ConsumerNotification[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());

  // Notification spotlight and highlight states
  const [spotlightReading, setSpotlightReading] = useState<MeterReading | null>(null);
  const [highlightedReadingId, setHighlightedReadingId] = useState<string | null>(null);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  // Immediate Real-Time Payment Confirmation Toast/Banner
  const [paymentConfirmationToast, setPaymentConfirmationToast] = useState<{
    period: string;
    amount: number;
    remaining?: number;
    isPartial?: boolean;
    reference: string;
    date: string;
  } | null>(null);

  // Profile Edit States
  const [editName, setEditName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editSitioZone, setEditSitioZone] = useState('');
  const [editHouseholdInfo, setEditHouseholdInfo] = useState('');
  const [editBusinessName, setEditBusinessName] = useState('');
  const [editBusinessType, setEditBusinessType] = useState('');
  const [passwordOld, setPasswordOld] = useState('');
  const [passwordNew, setPasswordNew] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'err'; msg: string } | null>(null);

  // My Bills Filter State
  const [billFilter, setBillFilter] = useState<'all' | 'unpaid' | 'paid' | 'partial'>('all');

  // Notifications Filter State
  const [notifFilter, setNotifFilter] = useState<'all' | 'billing' | 'payment' | 'announcement'>('all');

  // Payment Checkout States
  const [activePaymentBill, setActivePaymentBill] = useState<MeterReading | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'gcash' | 'maya' | 'bank'>('gcash');
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial'>('full');
  const [partialCustomAmount, setPartialCustomAmount] = useState<string>('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentStep, setPaymentStep] = useState<{ step: number; percentage: number; text: string } | null>(null);
  const [successReceipt, setSuccessReceipt] = useState<any>(null);

  // Global Simulated Payment Gateway Modal States
  const [isSimulatedModalOpen, setIsSimulatedModalOpen] = useState(false);
  const [simulatedModalReading, setSimulatedModalReading] = useState<MeterReading | null>(null);
  const [simulatedModalMode, setSimulatedModalMode] = useState<'full' | 'partial'>('full');

  // Digital Receipt Modal
  const [receiptDetailModal, setReceiptDetailModal] = useState<MeterReading | null>(null);

  // Checkout Form Fields
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [gcashPhone, setGcashPhone] = useState('');
  const [bankAccountNum, setBankAccountNum] = useState('');

  // Track previous readings to detect admin payment modifications
  const prevReadingsRef = useRef<MeterReading[]>([]);

  // Tariff calculation helper
  const calculateCostOf = (usage: number, classification: 'Residential' | 'Commercial' = 'Residential') => {
    const isCommercial = classification === 'Commercial';
    const minCharge = isCommercial ? 270.00 : 180.00; // first 10 m³
    if (usage <= 10) return minCharge;
    
    let bill = minCharge;
    let remaining = usage - 10;
    
    // Tier 1: 11-20 m³
    const tier1 = Math.min(remaining, 10);
    bill += tier1 * (isCommercial ? 30.00 : 20.00);
    remaining -= tier1;
    
    if (remaining > 0) {
      // Tier 2: 21-30 m³
      const tier2 = Math.min(remaining, 10);
      bill += tier2 * (isCommercial ? 36.00 : 24.00);
      remaining -= tier2;
    }
    
    if (remaining > 0) {
      // Tier 3: 31+ m³
      bill += remaining * (isCommercial ? 45.00 : 30.00);
    }
    return bill;
  };

  // Real-Time Data Loader
  const loadConsumerInfo = (silent = false) => {
    if (!silent) setIsSyncing(true);

    setTimeout(() => {
      // 1. First attempt to fetch latest live record from backend API
      const searchParam = currentUser.linkedAccountNumber || currentUser.email || currentUser.id;
      if (searchParam) {
        fetch(`/api/consumers?search=${encodeURIComponent(searchParam)}`)
          .then(res => res.json())
          .then(apiData => {
            if (apiData && (apiData.consumers || apiData.data)) {
              const list: any[] = apiData.consumers || apiData.data || [];
              const matchedApi = list.find((c: any) => 
                (c.accountNumber && c.accountNumber === currentUser.linkedAccountNumber) ||
                (c.email && c.email.toLowerCase() === currentUser.email?.toLowerCase()) ||
                (c.linkedUserId && c.linkedUserId === currentUser.id)
              );
              if (matchedApi) {
                const currentLocal = mockDb.getConsumers();
                const idx = currentLocal.findIndex(lc => 
                  (matchedApi.accountNumber && lc.accountNumber === matchedApi.accountNumber) ||
                  (matchedApi.email && lc.email && lc.email.toLowerCase() === matchedApi.email.toLowerCase()) ||
                  (matchedApi.linkedUserId && lc.linkedUserId === matchedApi.linkedUserId)
                );
                if (idx >= 0) {
                  currentLocal[idx] = { ...currentLocal[idx], ...matchedApi };
                } else {
                  currentLocal.unshift(matchedApi);
                }
                mockDb.saveConsumers(currentLocal);
                setConsumerRecord(matchedApi);
              }
            }
          })
          .catch(() => {});
      }

      const consumers = mockDb.getConsumers();
      const allReadings = mockDb.getReadings();
      
      // Match linked account number or email
      const record = consumers.find(
        c => c.accountNumber === currentUser.linkedAccountNumber || 
             c.email.toLowerCase() === currentUser.email.toLowerCase() ||
             c.linkedUserId === currentUser.id
      );

      if (record) {
        setConsumerRecord(record);
        
        // Filter readings belonging strictly to this customer's valid issued identifiers
        const filteredReads = (record.accountNumber && record.accountNumber.trim() !== '' && !record.accountNumber.startsWith('PENDING')) || (record.meterNumber && record.meterNumber.trim() !== '' && !record.meterNumber.startsWith('PENDING'))
          ? allReadings.filter(
              r => (record.accountNumber && r.accountNumber === record.accountNumber) ||
                   (record.meterNumber && r.meterNumber === record.meterNumber)
            )
          : [];
        // Sort newest first
        filteredReads.sort((a, b) => new Date(b.readingDate).getTime() - new Date(a.readingDate).getTime());
        
        // Check if any bill was recently marked as PAID or PARTIAL by an Admin / Cashier in background
        if (prevReadingsRef.current.length > 0) {
          filteredReads.forEach(newR => {
            const oldR = prevReadingsRef.current.find(o => o.id === newR.id);
            if (oldR) {
              if (oldR.paymentStatus !== 'paid' && newR.paymentStatus === 'paid') {
                // Bill just settled in full!
                setPaymentConfirmationToast({
                  period: newR.billingPeriod,
                  amount: newR.paidAmount || calculateCostOf(newR.consumption, record.consumerType),
                  remaining: 0,
                  isPartial: false,
                  reference: newR.orNumber || newR.paymentReference || `OR-${Math.floor(100000 + Math.random() * 900000)}`,
                  date: newR.paymentDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                });
              } else if (oldR.paymentStatus === 'unpaid' && newR.paymentStatus === 'partial') {
                // Partial payment logged by admin / cashier!
                const gross = calculateCostOf(newR.consumption, record.consumerType);
                const rem = newR.remainingBalance ?? Math.max(0, gross - (newR.paidAmount || 0));
                setPaymentConfirmationToast({
                  period: newR.billingPeriod,
                  amount: newR.paidAmount || 0,
                  remaining: rem,
                  isPartial: true,
                  reference: newR.orNumber || newR.paymentReference || `OR-${Math.floor(100000 + Math.random() * 900000)}`,
                  date: newR.paymentDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                });
              }
            }
          });
        }
        // Check and generate automated overdue alert notifications if any bill is past due
        filteredReads.forEach(r => {
          if (r.paymentStatus !== 'paid') {
            let dueDateObj: Date;
            if (r.dueDate) {
              dueDateObj = new Date(r.dueDate);
            } else if (r.readingDate) {
              dueDateObj = new Date(r.readingDate);
              dueDateObj.setDate(dueDateObj.getDate() + 15);
            } else {
              dueDateObj = new Date('2026-06-20');
            }

            const isPastDue = new Date() > dueDateObj;
            if (isPastDue) {
              const gross = calculateCostOf(r.consumption, record.consumerType);
              const paid = r.paidAmount || 0;
              const net = Math.max(0, gross - paid);

              if (net > 0) {
                const existingNotifs = mockDb.getNotifications(record.accountNumber);
                const hasAlert = existingNotifs.some(
                  n => (n.readingId === r.id || n.billingPeriod === r.billingPeriod) &&
                       (n.title.toLowerCase().includes('overdue') || n.title.toLowerCase().includes('urgent'))
                );

                if (!hasAlert) {
                  mockDb.addNotification({
                    accountNumber: record.accountNumber,
                    title: `URGENT: Water Tariff Overdue — ${r.billingPeriod}`,
                    message: `Your water tariff bill of ₱${net.toFixed(2)} for ${r.billingPeriod} (${r.consumption} m³) is past its due date. Standard 10% late surcharge applies. Settle online now to avoid disconnection notice.`,
                    type: 'billing',
                    readingId: r.id,
                    billingPeriod: r.billingPeriod,
                    remainingBalance: net
                  });
                }
              }
            }
          }
        });

        prevReadingsRef.current = filteredReads;
        setReadings(filteredReads);

        // Load consumer notifications
        const notifs = mockDb.getNotifications(record.accountNumber);
        setNotifications(notifs);
      }

      setAnnouncements(mockDb.getAnnouncements());
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setIsInitialLoading(false);
      setIsSyncing(false);
    }, silent ? 0 : 350);
  };

  // Initial Load & Real-Time Sync Event Listeners
  useEffect(() => {
    loadConsumerInfo();

    // 1. Instantaneous reactive sync when Admin modifies data in same window
    const handleDbUpdate = () => {
      loadConsumerInfo(true);
    };
    window.addEventListener('twd_database_updated', handleDbUpdate);

    // 2. Cross-tab synchronization when Admin modifies data in another browser tab
    const handleStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('twd_') || e.key === 'twd_sync_ping') {
        loadConsumerInfo(true);
      }
    };
    window.addEventListener('storage', handleStorage);

    // 3. Fast automated fallback polling every 3 seconds
    const interval = setInterval(() => {
      loadConsumerInfo(true);
    }, 3000);

    return () => {
      window.removeEventListener('twd_database_updated', handleDbUpdate);
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, [currentUser]);

  // Populate profile edit fields when record is loaded or updated by admin
  useEffect(() => {
    if (consumerRecord) {
      setEditName(consumerRecord.name);
      setEditContact(consumerRecord.contactNumber || '');
      setEditEmail(consumerRecord.email || '');
      setEditAddress(consumerRecord.address || '');
      setEditSitioZone(consumerRecord.sitioZone || '');
      setEditHouseholdInfo(consumerRecord.householdInfo || '');
      setEditBusinessName(consumerRecord.businessName || '');
      setEditBusinessType(consumerRecord.businessType || '');
    }
  }, [consumerRecord]);

  // Check Account Setup Pending Status (Awaiting Admin Account & Meter Issuance)
  const isAccountPending = Boolean(
    consumerRecord && (
      !consumerRecord.accountNumber ||
      consumerRecord.accountNumber.trim() === '' ||
      consumerRecord.status === 'pending_approval' ||
      consumerRecord.status === 'inactive' || 
      consumerRecord.accountNumber.startsWith('PENDING') ||
      consumerRecord.meterNumber.startsWith('PENDING') ||
      !consumerRecord.meterNumber ||
      consumerRecord.meterNumber.trim() === '' ||
      currentUser.status === 'pending_approval'
    )
  );

  // Compute Account Metrics & Arrears
  const latestRead = (readings && readings.length > 0) ? readings[0] : null;
  const currentConsumptionVal = latestRead ? latestRead.consumption : 0;
  // If there are no issued readings for this account yet or account is pending issuance, current bill is 0.00
  const currentBillAmount = (consumerRecord && latestRead && !isAccountPending)
    ? (latestRead.paymentStatus === 'paid' ? 0 : Math.max(0, calculateCostOf(currentConsumptionVal, consumerRecord.consumerType) - (latestRead.paidAmount || 0)))
    : 0;
  
  // Unpaid and Partial bills
  const unpaidBills = readings.filter(r => r.paymentStatus !== 'paid');
  const paidBills = readings.filter(r => r.paymentStatus === 'paid');
  const partialBills = readings.filter(r => r.paymentStatus === 'partial');
  const unpaidFullBills = readings.filter(r => r.paymentStatus === 'unpaid' || !r.paymentStatus);

  // Helper to determine overdue status
  const isReadingOverdue = (reading: MeterReading) => {
    if (reading.paymentStatus === 'paid') return false;
    let dueDateObj: Date;
    if (reading.dueDate) {
      dueDateObj = new Date(reading.dueDate);
    } else if (reading.readingDate) {
      dueDateObj = new Date(reading.readingDate);
      dueDateObj.setDate(dueDateObj.getDate() + 15);
    } else {
      dueDateObj = new Date('2026-06-20');
    }
    return new Date() > dueDateObj;
  };

  const overdueBills = readings.filter(r => isReadingOverdue(r));
  
  // Dynamic accurate outstanding sum
  const outstandingSum = unpaidBills.reduce((acc, b) => {
    const total = calculateCostOf(b.consumption, consumerRecord?.consumerType);
    const paid = b.paidAmount || 0;
    return acc + Math.max(0, total - paid);
  }, 0);

  const partialBalanceSum = partialBills.reduce((acc, b) => {
    const total = calculateCostOf(b.consumption, consumerRecord?.consumerType);
    const paid = b.paidAmount || 0;
    return acc + Math.max(0, total - paid);
  }, 0);

  // Trend vs Previous Month
  const previousMonthRead = readings[1] || null;
  const consumptionDiff = previousMonthRead ? currentConsumptionVal - previousMonthRead.consumption : 0;
  const consumptionPercentChange = previousMonthRead && previousMonthRead.consumption > 0
    ? ((consumptionDiff / previousMonthRead.consumption) * 100).toFixed(1)
    : null;

  // Chart Data preparation (chronological order)
  const chartReadings = [...readings].reverse().slice(-6); // last 6 months in chronological order

  // Unread notification count
  const unreadNotifCount = notifications.filter(n => !n.read).length;

  // Action: Handle clicking a notification to route to Dashboard or Bills and highlight the reading
  const handleNotificationClick = (notif: ConsumerNotification, targetPreference?: 'dashboard' | 'bills' | 'announcements') => {
    // 1. Mark as read in storage and state
    mockDb.markNotificationRead(notif.id);
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));

    // 2. Resolve matching reading
    let matchedReading: MeterReading | undefined;
    if (notif.readingId) {
      matchedReading = readings.find(r => r.id === notif.readingId);
    }
    if (!matchedReading && notif.billingPeriod) {
      matchedReading = readings.find(r => r.billingPeriod.toLowerCase() === notif.billingPeriod?.toLowerCase());
    }
    if (!matchedReading) {
      matchedReading = readings.find(r => 
        notif.title.toLowerCase().includes(r.billingPeriod.toLowerCase()) || 
        notif.message.toLowerCase().includes(r.billingPeriod.toLowerCase())
      );
    }
    if (!matchedReading && readings.length > 0) {
      matchedReading = readings[0];
    }

    if (matchedReading) {
      setSpotlightReading(matchedReading);
      setHighlightedReadingId(matchedReading.id);
    }

    setShowNotifDropdown(false);

    // 3. If it's a payment receipt notification and already paid, open digital receipt directly
    if (notif.type === 'payment' && matchedReading && matchedReading.paymentStatus === 'paid') {
      setReceiptDetailModal(matchedReading);
      return;
    }

    // 4. Navigate to the requested view
    if (targetPreference === 'bills') {
      setActiveTab('bills');
      if (matchedReading) {
        if (matchedReading.paymentStatus === 'paid') {
          setBillFilter('paid');
        } else if (matchedReading.paymentStatus === 'partial') {
          setBillFilter('partial');
        } else {
          setBillFilter('unpaid');
        }
      }
    } else if (targetPreference === 'announcements' || notif.type === 'announcement') {
      setActiveTab('notifications');
      setNotifFilter('announcement');
    } else {
      // Default: show on Dashboard with the spotlight reading card and metrics
      setActiveTab('dashboard');
    }
  };

  const handleMarkAllNotifsRead = () => {
    notifications.forEach(n => {
      if (!n.read) mockDb.markNotificationRead(n.id);
    });
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  // Quick simulated payment trigger
  const handleOpenSimulatedPayment = (reading: MeterReading, mode: 'full' | 'partial' = 'full') => {
    setSimulatedModalReading(reading);
    setSimulatedModalMode(mode);
    setIsSimulatedModalOpen(true);
  };

  // Checkout Handlers
  const handleStartPayment = (reading: MeterReading, presetMode: 'full' | 'partial' = 'full') => {
    handleOpenSimulatedPayment(reading, presetMode);
    setActivePaymentBill(reading);
    setSuccessReceipt(null);
    setPaymentStep(null);
    setIsProcessingPayment(false);

    const gross = calculateCostOf(reading.consumption, consumerRecord?.consumerType);
    const already = reading.paidAmount || 0;
    const netDue = Math.max(0, gross - already);

    setPaymentMode(presetMode);
    setPartialCustomAmount(netDue.toFixed(2));
    
    // Clear inputs for user's real-time entry
    setCardName(consumerRecord?.name || currentUser.name || '');
    setCardNumber('');
    setCardExpiry('');
    setCardCvv('');
    setGcashPhone(consumerRecord?.contactNumber ? consumerRecord.contactNumber.replace(/[^0-9]/g, '').slice(-10) : '');
    setBankAccountNum('');
  };

  const getMethodLabel = (method: 'card' | 'gcash' | 'maya' | 'bank') => {
    if (method === 'card') return 'Credit/Debit Card';
    if (method === 'gcash') return 'GCash Wallet';
    if (method === 'maya') return 'Maya Digital Wallet';
    return 'Landbank Link.BizPortal';
  };

  const handleConfirmPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePaymentBill || !consumerRecord) return;

    const grossBillAmt = calculateCostOf(activePaymentBill.consumption, consumerRecord.consumerType);
    const alreadyPaidAmt = activePaymentBill.paidAmount || 0;
    const remainingDue = Math.max(0, grossBillAmt - alreadyPaidAmt);

    const amountToPay = paymentMode === 'full' 
      ? remainingDue 
      : Math.min(Math.max(1, parseFloat(partialCustomAmount) || 0), remainingDue);

    if (amountToPay <= 0) {
      alert("Please enter a valid payment amount greater than ₱0.00.");
      return;
    }

    setIsProcessingPayment(true);
    let currentStep = 0;
    
    const interval = setInterval(() => {
      currentStep++;
      if (currentStep === 1) {
        setPaymentStep({ step: 1, percentage: 25, text: `Connecting to ${getMethodLabel(paymentMethod)} Gateway...` });
      } else if (currentStep === 2) {
        setPaymentStep({ step: 2, percentage: 60, text: 'Authorizing water tariff settlement credentials...' });
      } else if (currentStep === 3) {
        setPaymentStep({ step: 3, percentage: 85, text: 'Updating Tagoloan central municipal ledger...' });
      } else if (currentStep === 4) {
        clearInterval(interval);
        
        const transactionId = `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`;
        const paymentReference = `PAYREF-${Math.floor(100000 + Math.random() * 900000)}`;
        const orNumber = `OR-TWD-${Math.floor(100000 + Math.random() * 900000)}`;
        const paymentDate = new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const newTotalPaid = alreadyPaidAmt + amountToPay;
        const newRemainingBalance = Math.max(0, grossBillAmt - newTotalPaid);
        const isFullSettlement = newRemainingBalance <= 0.01;
        const newPaymentStatus: 'paid' | 'partial' = isFullSettlement ? 'paid' : 'partial';

        const successPayload = {
          readingId: activePaymentBill.id,
          accountNumber: activePaymentBill.accountNumber,
          amount: amountToPay,
          grossAmount: grossBillAmt,
          totalPaid: newTotalPaid,
          remainingBalance: newRemainingBalance,
          paymentMethod: getMethodLabel(paymentMethod),
          billingPeriod: activePaymentBill.billingPeriod,
          transactionId,
          paymentReference,
          orNumber,
          paymentDate,
          isPartial: !isFullSettlement,
          message: isFullSettlement 
            ? 'Payment successfully processed and verified in full.' 
            : `Partial payment of ₱${amountToPay.toFixed(2)} recorded. Remaining balance: ₱${newRemainingBalance.toFixed(2)}.`
        };

        // Update reading in mockDb
        const allReadings = mockDb.getReadings();
        const updated = allReadings.map(r => {
          if (r.id === successPayload.readingId) {
            return {
              ...r,
              paymentStatus: newPaymentStatus,
              paymentDate: successPayload.paymentDate,
              paymentMethod: successPayload.paymentMethod,
              transactionId: successPayload.transactionId,
              paymentReference: successPayload.paymentReference,
              orNumber: successPayload.orNumber,
              paidAmount: newTotalPaid,
              remainingBalance: newRemainingBalance
            };
          }
          return r;
        });
        mockDb.saveReadings(updated);

        // Re-calculate Consumer Master Outstanding Balance
        const conUnpaid = updated.filter(
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

        // Add Smart Notification
        mockDb.addNotification({
          accountNumber: consumerRecord.accountNumber,
          title: isFullSettlement 
            ? `Payment Confirmed - ${successPayload.billingPeriod}` 
            : `Partial Payment Recorded - ${successPayload.billingPeriod}`,
          message: isFullSettlement 
            ? `Your payment of ₱${amountToPay.toFixed(2)} for ${successPayload.billingPeriod} has been cleared in full via ${successPayload.paymentMethod}. Official Receipt #: ${orNumber}. Outstanding balance: ₱0.00.`
            : `Partial payment of ₱${amountToPay.toFixed(2)} for ${successPayload.billingPeriod} has been received via ${successPayload.paymentMethod}. Official Receipt #: ${orNumber}. Remaining balance of ₱${newRemainingBalance.toFixed(2)} is due by ${activePaymentBill.dueDate || '20th of Month'}.`,
          type: 'payment',
          orNumber,
          amountPaid: amountToPay,
          remainingBalance: newRemainingBalance
        });

        // Add Audit Log
        mockDb.addAuditLog(
          currentUser.id,
          currentUser.name,
          'consumer',
          isFullSettlement ? 'Settle Bill Online' : 'Partial Payment Online',
          `${isFullSettlement ? 'Settled in full' : 'Made partial payment of ₱' + amountToPay.toFixed(2)} for billing cycle ${successPayload.billingPeriod} (Total Paid: ₱${newTotalPaid.toFixed(2)}, Remaining: ₱${newRemainingBalance.toFixed(2)}) via ${successPayload.paymentMethod} (Ref: ${paymentReference}).`
        );

        // Re-sync
        loadConsumerInfo(true);

        setSuccessReceipt(successPayload);
        setIsProcessingPayment(false);
        setPaymentStep(null);
        
        setStatusMsg({ 
          type: 'success', 
          msg: isFullSettlement 
            ? `Water bill settled in full! Official OR #: ${orNumber}` 
            : `Partial payment of ₱${amountToPay.toFixed(2)} recorded! Remaining: ₱${newRemainingBalance.toFixed(2)}` 
        });
        setTimeout(() => setStatusMsg(null), 6000);
      }
    }, 600);
  };

  // Profile Update Handler
  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consumerRecord) return;

    const newName = editName.trim() || consumerRecord.name;
    const newEmail = editEmail.trim() || consumerRecord.email;

    const allConsumers = mockDb.getConsumers();
    const updated = allConsumers.map(c => {
      if (c.accountNumber === consumerRecord.accountNumber) {
        return {
          ...c,
          name: newName,
          contactNumber: editContact.trim() || c.contactNumber,
          email: newEmail,
          address: editAddress.trim() || c.address,
          sitioZone: editSitioZone.trim() || c.sitioZone,
          householdInfo: editHouseholdInfo.trim() || c.householdInfo,
          businessName: editBusinessName.trim() || c.businessName,
          businessType: editBusinessType.trim() || c.businessType
        };
      }
      return c;
    });
    mockDb.saveConsumers(updated);

    // Synchronize matching user record
    const allUsers = mockDb.getUsers().map(u => 
      u.id === currentUser.id || u.linkedAccountNumber === consumerRecord.accountNumber
        ? { ...u, name: newName, email: newEmail }
        : u
    );
    mockDb.saveUsers(allUsers);

    // Synchronize all meter readings under this account
    const allReadings = mockDb.getReadings().map(r => 
      r.accountNumber === consumerRecord.accountNumber
        ? { ...r, consumerName: newName }
        : r
    );
    mockDb.saveReadings(allReadings);

    // Synchronize session user
    const updatedCurrentUser = { ...currentUser, name: newName, email: newEmail };
    mockDb.setCurrentUser(updatedCurrentUser);

    mockDb.addAuditLog(
      currentUser.id,
      newName,
      'consumer',
      'Update Profile Information',
      `Updated personal and contact details for consumer account #${consumerRecord.accountNumber}.`
    );

    setStatusMsg({ type: 'success', msg: 'Profile information updated successfully!' });
    toast.success('Profile Updated', 'Your personal and contact information has been updated.');
    loadConsumerInfo(true);
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // Password Change Handler
  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOld || !passwordNew) {
      toast.warning('Incomplete Form', 'Please enter both current and new passwords.');
      return;
    }

    if (passwordNew !== passwordConfirm) {
      setStatusMsg({ type: 'err', msg: 'New password and confirmation do not match!' });
      toast.error('Password Mismatch', 'New password and confirmation do not match.');
      return;
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'consumer',
      'Password Rotation',
      `Changed access password for consumer user "${currentUser.email}".`
    );

    setStatusMsg({ type: 'success', msg: 'Security password changed successfully!' });
    toast.success('Password Updated', 'Your portal security credentials have been updated.');
    setPasswordOld('');
    setPasswordNew('');
    setPasswordConfirm('');
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // Initial skeleton view while loading data
  if (isInitialLoading) {
    return <ConsumerPortalSkeleton />;
  }

  // Fallback if no consumer record found after loading
  if (!consumerRecord) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-8 space-y-4 text-white">
        <AlertCircle className="h-12 w-12 text-rose-500 animate-pulse" />
        <h2 className="text-base font-black uppercase tracking-wider">Account Linking Notice</h2>
        <p className="text-xs text-slate-400 text-center max-w-md">
          We could not find an existing water account linked to email <strong>{currentUser.email}</strong>.
          Please contact the Tagoloan Water District administration or sign up through the registration portal.
        </p>
        <button 
          onClick={onLogout} 
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
        >
          Return to Portal Login
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden font-sans" id="consumer-portal-container">
      
      {/* Mobile Backdrop */}
      {mobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-40 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR NAVIGATION - ALWAYS VISIBLE ON DESKTOP & SLIDE-OUT ON MOBILE */}
      <aside 
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 bg-slate-900 text-white flex flex-col border-r border-slate-800 transition-transform duration-300 ease-in-out shrink-0 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        id="consumer-sidebar-nav"
      >
        {/* District Brand Header */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl overflow-hidden bg-slate-950 border border-white/20 shadow-md p-0.5 shrink-0">
              <img 
                src="https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg"
                alt="Tagoloan Water District Logo"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
                }}
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
            <div>
              <h1 className="text-sm font-black text-white tracking-tight leading-tight">
                Tagoloan Water
              </h1>
              <p className="text-[10px] uppercase font-bold tracking-wider text-blue-400">
                Consumer Portal
              </p>
            </div>
          </div>
          <button 
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Consumer Quick Identity Card */}
        <div className="p-4 mx-4 mt-4 bg-slate-800/80 rounded-2xl border border-slate-700/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Connected Account</span>
            <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="h-1 w-1 rounded-full bg-emerald-400 animate-ping"></span>
              <span>{consumerRecord.status || 'Active'}</span>
            </span>
          </div>
          <div>
            <h4 className="text-xs font-black text-white truncate">{consumerRecord.name}</h4>
            <div className="flex items-center gap-1.5 mt-1 font-mono text-[10px]">
              <span className="text-blue-300 bg-blue-950/60 px-1.5 py-0.2 rounded border border-blue-800/50">
                Acc #{consumerRecord.accountNumber}
              </span>
              <span className="text-slate-300 bg-slate-700/60 px-1.5 py-0.2 rounded">
                Tag #{consumerRecord.meterNumber || 'PENDING'}
              </span>
            </div>
          </div>
        </div>

        {/* Visible Modules Navigation Section */}
        <div className="flex-1 px-4 py-5 overflow-y-auto space-y-6">
          <div className="space-y-1.5">
            <span className="px-3 text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              PORTAL MODULES
            </span>

            {/* Module 1: Dashboard */}
            <button
              onClick={() => {
                setActiveTab('dashboard');
                setMobileSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-dashboard"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'dashboard' ? 'bg-white/20' : 'bg-slate-800 text-blue-400 group-hover:text-blue-300'}`}>
                  <Activity className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">Dashboard</div>
                  <div className={`text-[10px] truncate ${activeTab === 'dashboard' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Overview & real-time stats
                  </div>
                </div>
              </div>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${activeTab === 'dashboard' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
            </button>

            {/* Module 2: My Bills */}
            <button
              onClick={() => {
                setActiveTab('bills');
                setMobileSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'bills'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-bills"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'bills' ? 'bg-white/20' : 'bg-slate-800 text-emerald-400 group-hover:text-emerald-300'}`}>
                  <CreditCard className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">My Bills</div>
                  <div className={`text-[10px] truncate ${activeTab === 'bills' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Billing ledger & pay online
                  </div>
                </div>
              </div>
              {unpaidBills.length > 0 ? (
                <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full shadow-xs">
                  {unpaidBills.length} unpaid
                </span>
              ) : (
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'bills' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
              )}
            </button>

            {/* Module 3: My Usage */}
            <button
              onClick={() => {
                setActiveTab('usage');
                setMobileSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'usage'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-usage"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'usage' ? 'bg-white/20' : 'bg-slate-800 text-sky-400 group-hover:text-sky-300'}`}>
                  <BarChart3 className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">My Usage</div>
                  <div className={`text-[10px] truncate ${activeTab === 'usage' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Meter reading history & trends
                  </div>
                </div>
              </div>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'usage' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
            </button>

            {/* Module 4: Notifications */}
            <button
              onClick={() => {
                setActiveTab('notifications');
                setMobileSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'notifications'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-notifications"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'notifications' ? 'bg-white/20' : 'bg-slate-800 text-amber-400 group-hover:text-amber-300'}`}>
                  <Bell className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">Notifications</div>
                  <div className={`text-[10px] truncate ${activeTab === 'notifications' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Receipts & district alerts
                  </div>
                </div>
              </div>
              {unreadNotifCount > 0 ? (
                <span className="px-1.5 py-0.5 bg-blue-500 text-white text-[10px] font-black rounded-full">
                  {unreadNotifCount}
                </span>
              ) : (
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'notifications' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
              )}
            </button>

            {/* Module 5: My Profile */}
            <button
              onClick={() => {
                setActiveTab('profile');
                setMobileSidebarOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer group ${
                activeTab === 'profile'
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
              id="sidebar-mod-profile"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`p-1.5 rounded-lg ${activeTab === 'profile' ? 'bg-white/20' : 'bg-slate-800 text-purple-400 group-hover:text-purple-300'}`}>
                  <User className="h-4 w-4" />
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight">My Profile</div>
                  <div className={`text-[10px] truncate ${activeTab === 'profile' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Contact details & security
                  </div>
                </div>
              </div>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${activeTab === 'profile' ? 'rotate-90 text-white' : 'text-slate-600 group-hover:text-slate-400'}`} />
            </button>
          </div>

          {/* District Assistance Support Box */}
          <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/50 space-y-2 text-xs">
            <div className="flex items-center space-x-2 text-blue-400 font-bold">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] uppercase tracking-wider">Water District Office</span>
            </div>
            <p className="text-[11px] text-slate-300">
              Hotline: <strong className="text-white">(088) 555-0145</strong>
            </p>
            <p className="text-[10px] text-slate-400">
              Mon - Fri: 8:00 AM - 5:00 PM
            </p>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800 space-y-3 shrink-0">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5 font-bold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              Live Sync 5s
            </span>
            <button 
              onClick={() => loadConsumerInfo()} 
              disabled={isSyncing}
              className="text-slate-400 hover:text-white transition flex items-center gap-1 cursor-pointer"
              title="Refresh Data Now"
            >
              <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin text-blue-400' : ''}`} />
              <span>{lastSyncTime}</span>
            </button>
          </div>

          <button
            onClick={onLogout}
            className="w-full py-2.5 px-3 bg-slate-800/80 hover:bg-rose-600/90 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 border border-slate-700/80 hover:border-rose-500 cursor-pointer"
            id="sidebar-logout-btn"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN VIEWPORT AREA */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto bg-slate-50">
        
        {/* Top Header Bar */}
        <header className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-slate-200 z-30 shadow-2xs px-4 sm:px-8 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3.5">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 cursor-pointer"
              aria-label="Open Sidebar Menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Consumer Portal
                </span>
                <span className="text-slate-300">/</span>
                <span className="text-xs font-black uppercase tracking-wider text-blue-600">
                  {activeTab === 'dashboard' && 'Dashboard Overview'}
                  {activeTab === 'bills' && 'My Water Bills'}
                  {activeTab === 'usage' && 'Consumption & Usage'}
                  {activeTab === 'notifications' && 'Notifications & Alerts'}
                  {activeTab === 'profile' && 'Consumer Profile'}
                </span>
              </div>
              <h2 className="text-base font-black text-slate-900 capitalize tracking-tight mt-0.5">
                {activeTab === 'dashboard' && 'Account & Telemetry Dashboard'}
                {activeTab === 'bills' && 'Billing Ledger & Online Settle'}
                {activeTab === 'usage' && 'Meter Telemetry & Historical Readings'}
                {activeTab === 'notifications' && 'Official Advisories & Receipts'}
                {activeTab === 'profile' && 'Personal Information & Security'}
              </h2>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center space-x-3">
            {outstandingSum > 0 && activeTab !== 'bills' && (
              <button
                onClick={() => {
                  setActiveTab('bills');
                  if (unpaidBills.length > 0) handleStartPayment(unpaidBills[0]);
                }}
                className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>Pay ₱{outstandingSum.toFixed(2)}</span>
              </button>
            )}

            {/* Notification Bell with Dropdown Popover */}
            <div className="relative">
              <button
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                className="relative p-2 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 transition cursor-pointer"
                title="Notifications & Advisories"
                id="header-notif-bell-btn"
              >
                <Bell className="h-4 w-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white ring-2 ring-white animate-pulse">
                    {unreadNotifCount}
                  </span>
                )}
              </button>

              {/* Quick Notification Dropdown Popover */}
              {showNotifDropdown && (
                <div 
                  className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-slide-down"
                  id="header-notif-dropdown"
                >
                  <div className="p-3.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Bell className="h-4 w-4 text-blue-600" />
                      <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                        Notifications
                      </span>
                      {unreadNotifCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 font-black text-[10px] rounded-full">
                          {unreadNotifCount} new
                        </span>
                      )}
                    </div>
                    {unreadNotifCount > 0 && (
                      <button
                        onClick={handleMarkAllNotifsRead}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.slice(0, 6).map((n) => {
                        const isBilling = n.type === 'billing' || n.type === 'balance';
                        const isPartialAlert = n.title.toLowerCase().includes('partial') || n.message.toLowerCase().includes('remaining');

                        return (
                          <div
                            key={n.id}
                            onClick={() => handleNotificationClick(n, 'dashboard')}
                            className={`p-3.5 hover:bg-slate-50 transition cursor-pointer flex items-start space-x-3 ${
                              !n.read ? 'bg-blue-50/40' : ''
                            }`}
                          >
                            <div className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                              isPartialAlert
                                ? 'bg-amber-100 text-amber-800'
                                : isBilling
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {isPartialAlert ? (
                                <AlertTriangle className="h-4 w-4" />
                              ) : isBilling ? (
                                <ReceiptText className="h-4 w-4" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                <h4 className="text-xs font-black text-slate-900 truncate">
                                  {n.title}
                                </h4>
                                {!n.read && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0"></span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                                {n.message}
                              </p>
                              <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-100/60">
                                <span className="text-[9px] font-mono text-slate-400">
                                  {new Date(n.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                                <span className="text-[10px] font-black text-blue-600 hover:text-blue-800 flex items-center space-x-0.5">
                                  <span>View on Dashboard</span>
                                  <ChevronRight className="h-3 w-3" />
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="p-2.5 bg-slate-50 border-t border-slate-100 text-center">
                    <button
                      onClick={() => {
                        setActiveTab('notifications');
                        setShowNotifDropdown(false);
                      }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    >
                      View All Notifications ({notifications.length})
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-slate-100 rounded-xl border border-slate-200/80">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span className="text-[11px] font-mono font-bold text-slate-700">
                {consumerRecord.accountNumber}
              </span>
            </div>

            <button
              onClick={onLogout}
              className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Body Content */}
        <main className="flex-1 p-4 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">

        {/* IMMEDIATE REAL-TIME PAYMENT CONFIRMATION BANNER / TOAST */}
        {paymentConfirmationToast && (
          <div className="bg-emerald-600 text-white rounded-2xl p-5 shadow-lg border border-emerald-500 flex items-start justify-between gap-4 animate-slide-down">
            <div className="flex items-start space-x-3.5">
              <div className="p-2 bg-white/20 rounded-xl text-white shrink-0 mt-0.5">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                  <span>Payment Settle Confirmed!</span>
                  <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">
                    Official Receipt #{paymentConfirmationToast.reference}
                  </span>
                </h4>
                <p className="text-xs text-emerald-100 mt-1 leading-relaxed">
                  Your water tariff payment of <strong>₱{paymentConfirmationToast.amount.toFixed(2)}</strong> for billing cycle <strong>{paymentConfirmationToast.period}</strong> has been cleared and stamped into the central district records on {paymentConfirmationToast.date}. Outstanding balance updated.
                </p>
              </div>
            </div>
            <button
              onClick={() => setPaymentConfirmationToast(null)}
              className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* STATUS / ERROR TOAST */}
        {statusMsg && (
          <div className={`p-4 rounded-2xl text-xs flex items-center space-x-3 shadow-xs ${
            statusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="font-semibold">{statusMsg.msg}</span>
          </div>
        )}

        {/* AUTOMATED OVERDUE BILL NOTIFICATION BANNER */}
        {consumerRecord && overdueBills.length > 0 && !isAccountPending && (
          <OverdueBillBanner
            overdueBills={overdueBills}
            consumerRecord={consumerRecord}
            onPayNow={(reading, mode) => handleOpenSimulatedPayment(reading, mode || 'full')}
            onViewBillDetails={(reading) => {
              setActiveTab('bills');
              setBillFilter('unpaid');
              setHighlightedReadingId(reading.id);
              setSpotlightReading(reading);
            }}
            calculateCostOf={calculateCostOf}
          />
        )}

        {/* ACCOUNT STATUS: SHOWS ACCOUNT SETUP PENDING MESSAGE UNTIL ADMIN ISSUES OFFICIAL IDENTIFIERS */}
        {isAccountPending ? (
          <div className="bg-amber-500/10 border-2 border-dashed border-amber-500/40 rounded-3xl p-6 sm:p-8 text-slate-800 space-y-4">
            <div className="flex items-start space-x-4">
              <div className="p-3 bg-amber-500 text-white rounded-2xl shadow-md shrink-0">
                <Clock className="h-7 w-7 animate-pulse" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 bg-amber-500 text-white font-black text-[10px] uppercase tracking-wider rounded-md">
                    Account Setup Pending
                  </span>
                  <span className="text-xs font-mono text-amber-900 font-bold">
                    Status: {consumerRecord.accountNumber ? `#${consumerRecord.accountNumber}` : 'Pending Admin Issuance'}
                  </span>
                </div>
                <h3 className="text-lg font-black text-slate-900">
                  Official Account & Meter Identifiers Pending Administrative Issuance
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                  Your registration application for water connection service has been received and verified. The Tagoloan Water District administration office is currently provisioning your official permanent <strong>Account Number</strong> and physical <strong>Meter Tag Number</strong>. Once issued, your telemetry readings, rate bracket schedules, and automated billing ledgers will activate automatically.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-amber-200/60 text-xs">
              <div className="bg-white/80 p-3 rounded-xl border border-amber-100">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Applicant Name</span>
                <span className="font-black text-slate-800">{consumerRecord.name}</span>
              </div>
              <div className="bg-white/80 p-3 rounded-xl border border-amber-100">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Designated Barangay</span>
                <span className="font-black text-slate-800">{consumerRecord.barangay || 'Poblacion East'}</span>
              </div>
              <div className="bg-white/80 p-3 rounded-xl border border-amber-100">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Classification</span>
                <span className="font-black text-slate-800">{consumerRecord.consumerType || 'Residential'}</span>
              </div>
            </div>
          </div>
        ) : (
          /* OFFICIAL IDENTIFIERS ACTIVE BANNER */
          <div className="bg-gradient-to-r from-blue-700 via-blue-650 to-sky-600 rounded-3xl p-6 sm:p-7 text-white shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 h-48 w-48 bg-white/5 rounded-full blur-2xl transform translate-x-1/4 -translate-y-1/4"></div>
            
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center relative">
              <div className="md:col-span-8 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-white/20 text-white border border-white/20 font-black text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-lg">
                    {consumerRecord.consumerType || 'Residential'} Line
                  </span>
                  <span className="bg-emerald-400/20 text-emerald-200 border border-emerald-400/30 font-bold text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-lg flex items-center space-x-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                    <span>Line Active</span>
                  </span>
                </div>
                
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight">{consumerRecord.name}</h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-100">
                  <span className="flex items-center space-x-1">
                    <MapPin className="h-3.5 w-3.5 text-sky-300 shrink-0" />
                    <span>{consumerRecord.address}</span>
                  </span>
                  <span className="flex items-center space-x-1 font-mono font-bold text-amber-200">
                    <Tag className="h-3.5 w-3.5 shrink-0" />
                    <span>Barangay: {consumerRecord.barangay || 'Poblacion'} ({consumerRecord.barangayId || 'BRG-01'})</span>
                  </span>
                </div>
              </div>

              {/* Official Account Number & Tag Number Identifiers Display */}
              <div className="md:col-span-4 bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/15 space-y-2.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-blue-200 font-medium">Account Number:</span>
                  <span className="font-mono font-black text-amber-300 text-sm bg-black/20 px-2 py-0.5 rounded border border-white/10">
                    {consumerRecord.accountNumber}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-blue-200 font-medium">Meter Tag Number:</span>
                  <span className="font-mono font-black text-white text-sm bg-black/20 px-2 py-0.5 rounded border border-white/10">
                    {consumerRecord.meterNumber || 'MT-7711'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-blue-200 font-medium">Meter Size:</span>
                  <span className="font-bold text-blue-100">{consumerRecord.meterSize || '1/2 inch'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 1: DASHBOARD                                          */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-fade-in" id="consumer-tab-dashboard">
            
            {/* SMART NOTIFICATION & DUE ACTION CENTER BANNER */}
            {outstandingSum > 0 ? (
              <div className="bg-gradient-to-r from-amber-500 via-rose-650 to-rose-700 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-5">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-white/20 text-white font-black text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-lg flex items-center space-x-1">
                      <AlertTriangle className="h-3 w-3 mr-1 text-amber-200" />
                      <span>Smart Billing Advisory</span>
                    </span>
                    {partialBills.length > 0 && (
                      <span className="bg-amber-300 text-amber-950 font-black text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-lg">
                        Partial Payment Active
                      </span>
                    )}
                    <span className="bg-rose-950/40 text-rose-100 font-bold text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-lg">
                      {unpaidBills.length} Statement(s) Due
                    </span>
                  </div>
                  <h3 className="text-xl font-black tracking-tight">
                    {partialBills.length > 0
                      ? `Remaining Balance of ₱${outstandingSum.toFixed(2)} Pending`
                      : `Water Bill Arrived — ₱${outstandingSum.toFixed(2)} Total Outstanding`}
                  </h3>
                  <p className="text-xs text-rose-100/90 leading-relaxed">
                    {partialBills.length > 0
                      ? `You have credited partial payments towards your water bills. A remaining unsettled balance of ₱${outstandingSum.toFixed(2)} is due on or before ${latestRead?.dueDate || 'the 20th of the month'}.`
                      : `Your water bill statement has arrived. Please settle the remaining balance of ₱${outstandingSum.toFixed(2)} to maintain uninterrupted water service.`}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0 w-full md:w-auto">
                  <button
                    onClick={() => {
                      setActiveTab('bills');
                      if (unpaidBills.length > 0) handleStartPayment(unpaidBills[0], 'full');
                    }}
                    className="px-6 py-3.5 bg-white hover:bg-slate-50 text-slate-900 font-black text-xs uppercase tracking-wider rounded-2xl shadow-lg hover:shadow-xl transition flex items-center justify-center space-x-2 cursor-pointer"
                    id="smart-banner-pay-btn"
                  >
                    <CreditCard className="h-4 w-4 text-blue-600" />
                    <span>Pay Remaining ₱{outstandingSum.toFixed(2)}</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('bills')}
                    className="px-4 py-3 bg-black/20 hover:bg-black/30 border border-white/20 text-white font-bold text-xs uppercase tracking-wider rounded-2xl transition flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <span>View Breakdown</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-3xl p-5 text-white shadow-md flex items-center justify-between gap-4">
                <div className="flex items-center space-x-3.5">
                  <div className="p-2.5 bg-white/20 rounded-2xl">
                    <CheckCircle2 className="h-6 w-6 text-emerald-200" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-200 block">Account Status</span>
                    <h4 className="text-base font-black">All Water Bills Settled in Full — ₱0.00 Balance</h4>
                    <p className="text-xs text-emerald-100">Your account is in good standing. Next reading cycle will reflect automatically.</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('bills')}
                  className="hidden sm:flex px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-xs font-bold transition items-center space-x-1 cursor-pointer"
                >
                  <span>View Receipts</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            
            {/* SPOTLIGHT: METER READING & BILL ISSUED NOTIFICATION FOCUS CARD */}
            {spotlightReading && (
              <div 
                className="bg-white border-2 border-blue-500 rounded-3xl p-6 shadow-xl relative overflow-hidden animate-slide-down ring-4 ring-blue-500/10"
                id="dashboard-reading-spotlight"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-5 border-b border-slate-100">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 bg-blue-600 text-white font-black text-[10px] uppercase tracking-wider rounded-lg flex items-center space-x-1 shadow-xs">
                        <Sparkles className="h-3 w-3 mr-1" />
                        <span>Issued Meter Reading & Bill</span>
                      </span>
                      <span className="px-2.5 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 font-bold text-[10px] uppercase tracking-wider rounded-lg">
                        Period: {spotlightReading.billingPeriod}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                        spotlightReading.paymentStatus === 'paid'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : spotlightReading.paymentStatus === 'partial'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-rose-100 text-rose-800 border border-rose-300'
                      }`}>
                        {spotlightReading.paymentStatus === 'paid' ? 'Paid in Full' : spotlightReading.paymentStatus === 'partial' ? 'Partial Balance' : 'Unpaid Statement'}
                      </span>
                    </div>

                    <h3 className="text-xl font-black text-slate-900 tracking-tight">
                      Official Meter Reading for {spotlightReading.billingPeriod}
                    </h3>
                    <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                      Your meter index was verified by our district field reader. Net consumption computed at <strong className="text-slate-900 font-mono">{spotlightReading.consumption} m³</strong> with a total calculated bill of <strong className="text-blue-700 font-mono">₱{calculateCostOf(spotlightReading.consumption, consumerRecord?.consumerType).toFixed(2)}</strong>.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 self-end lg:self-center">
                    <button
                      onClick={() => setSpotlightReading(null)}
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      title="Dismiss Spotlight"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* 4 Index & Bill Telemetry Metric Tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 my-5">
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3.5 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Previous Index
                    </span>
                    <span className="text-lg font-black font-mono text-slate-700 block">
                      {spotlightReading.previousReading} m³
                    </span>
                    <span className="text-[10px] text-slate-400">Prior baseline dial</span>
                  </div>

                  <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-3.5 space-y-1">
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">
                      Current Index
                    </span>
                    <span className="text-lg font-black font-mono text-blue-900 block">
                      {spotlightReading.currentReading} m³
                    </span>
                    <span className="text-[10px] text-blue-600 font-semibold">Latest dial recorded</span>
                  </div>

                  <div className="bg-sky-50 border border-sky-100 rounded-2xl p-3.5 space-y-1">
                    <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wider block">
                      Net Consumption
                    </span>
                    <span className="text-lg font-black font-mono text-sky-900 block">
                      {spotlightReading.consumption} m³
                    </span>
                    <span className="text-[10px] text-sky-600 font-semibold">Actual volume used</span>
                  </div>

                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3.5 space-y-1">
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
                      Calculated Bill
                    </span>
                    <span className="text-lg font-black font-mono text-emerald-900 block">
                      ₱{calculateCostOf(spotlightReading.consumption, consumerRecord?.consumerType).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-emerald-700 font-semibold">
                      {spotlightReading.paymentStatus === 'paid' ? 'Settled in full' : `Due ${spotlightReading.dueDate || '20th of Month'}`}
                    </span>
                  </div>
                </div>

                {/* Footer Strip with Reading Meta & Direct Action Buttons */}
                <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
                    <span>Reading Date: <strong className="text-slate-800">{spotlightReading.readingDate}</strong></span>
                    <span>•</span>
                    <span>Field Officer: <strong className="text-slate-800">{spotlightReading.meterReaderName || 'Field Tech'}</strong></span>
                    <span>•</span>
                    <span>Due Date: <strong className="text-rose-600">{spotlightReading.dueDate || '20th of Month'}</strong></span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    {spotlightReading.paymentStatus !== 'paid' ? (
                      <>
                        <button
                          onClick={() => {
                            setActiveTab('bills');
                            handleStartPayment(spotlightReading, 'full');
                          }}
                          className="flex-1 sm:flex-initial px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 cursor-pointer"
                        >
                          <CreditCard className="h-4 w-4" />
                          <span>Pay Bill (₱{calculateCostOf(spotlightReading.consumption, consumerRecord?.consumerType).toFixed(2)})</span>
                        </button>
                        <button
                          onClick={() => {
                            setActiveTab('bills');
                            setHighlightedReadingId(spotlightReading.id);
                          }}
                          className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center space-x-1 cursor-pointer"
                        >
                          <ReceiptText className="h-3.5 w-3.5" />
                          <span>View in My Bills</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setReceiptDetailModal(spotlightReading)}
                          className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 cursor-pointer"
                        >
                          <ReceiptText className="h-4 w-4" />
                          <span>View Official Receipt</span>
                        </button>
                        <button
                          onClick={() => {
                            setActiveTab('bills');
                            setBillFilter('paid');
                            setHighlightedReadingId(spotlightReading.id);
                          }}
                          className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center space-x-1 cursor-pointer"
                        >
                          <ReceiptText className="h-3.5 w-3.5" />
                          <span>View in My Bills</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {/* 4 CORE OVERVIEW METRIC CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              
              {/* Card 1: Current Month Consumption */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-xs space-y-3">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Current Consumption
                  </span>
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <Droplet className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-3xl font-black text-slate-900 font-mono">
                      {currentConsumptionVal}
                    </span>
                    <span className="text-xs font-bold text-slate-500 uppercase">m³ (cubic meters)</span>
                  </div>
                  <div className="flex items-center space-x-1 text-[11px] mt-1">
                    {previousMonthRead && consumptionDiff > 0 ? (
                      <span className="text-rose-600 font-bold flex items-center">
                        <TrendingUp className="h-3.5 w-3.5 mr-0.5" />
                        +{consumptionDiff} m³ ({consumptionPercentChange}%)
                      </span>
                    ) : previousMonthRead && consumptionDiff < 0 ? (
                      <span className="text-emerald-600 font-bold flex items-center">
                        <TrendingDown className="h-3.5 w-3.5 mr-0.5" />
                        {consumptionDiff} m³ ({consumptionPercentChange}%)
                      </span>
                    ) : previousMonthRead ? (
                      <span className="text-slate-500 font-medium">Constant vs last month</span>
                    ) : (
                      <span className="text-slate-500 font-medium">{latestRead ? 'Initial baseline reading' : 'No recorded cycles yet'}</span>
                    )}
                    {previousMonthRead && <span className="text-slate-400">vs prev</span>}
                  </div>
                </div>
              </div>

              {/* Card 2: Latest Meter Reading */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-xs space-y-3">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Latest Meter Reading
                  </span>
                  <div className="p-2 bg-sky-50 text-sky-600 rounded-xl">
                    <Activity className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-3xl font-black text-slate-900 font-mono">
                      {latestRead ? latestRead.currentReading : 0}
                    </span>
                    <span className="text-xs font-bold text-slate-500">m³ Index</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 font-medium">
                    {latestRead ? `Recorded: ${latestRead.readingDate}` : 'Awaiting reading cycle'}
                  </p>
                </div>
              </div>

              {/* Card 3: Current Bill Amount */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-xs space-y-3">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Current Bill Amount
                  </span>
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <Calculator className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline space-x-1">
                    <span className="text-3xl font-black text-indigo-700 font-mono">
                      ₱{currentBillAmount.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 font-medium">
                    Cycle: {latestRead ? latestRead.billingPeriod : 'No Billing Cycle Yet'}
                  </p>
                </div>
              </div>

              {/* Card 4: Outstanding Balance */}
              <div className={`border rounded-3xl p-5 shadow-xs space-y-3 ${
                outstandingSum > 0 
                  ? 'bg-rose-50/50 border-rose-200/80 text-slate-900' 
                  : 'bg-emerald-50/50 border-emerald-200/80 text-slate-900'
              }`}>
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Outstanding Balance
                  </span>
                  <div className={`p-2 rounded-xl ${
                    outstandingSum > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    <ReceiptText className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline space-x-1">
                    <span className={`text-3xl font-black font-mono ${
                      outstandingSum > 0 ? 'text-rose-700' : 'text-emerald-700'
                    }`}>
                      ₱{outstandingSum.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] text-slate-600 font-semibold">
                      {outstandingSum > 0 
                        ? `${unpaidBills.length} bill(s)${partialBills.length > 0 ? ` (${partialBills.length} partial)` : ''}`
                        : 'Account cleared'}
                    </span>
                    {outstandingSum > 0 && (
                      <button
                        onClick={() => {
                          setActiveTab('bills');
                          if (unpaidBills.length > 0) handleStartPayment(unpaidBills[0], 'full');
                        }}
                        className="text-[10px] font-black text-rose-700 hover:underline uppercase cursor-pointer"
                      >
                        Settle Now →
                      </button>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* TWO ANALYTICAL VISUAL CHARTS: CONSUMPTION CHART & BILLING CHART */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Monthly Consumption Chart */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                      Monthly Consumption Trend
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      Historical volume consumed in cubic meters (m³)
                    </p>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                    6-Cycle View
                  </span>
                </div>

                {chartReadings.length > 0 ? (
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 pt-8 h-64 flex items-end justify-around relative">
                    <div className="absolute left-4 top-3 text-[9px] font-mono text-slate-400">
                      Y-Axis: m³ Consumption
                    </div>
                    {chartReadings.map((r, idx) => {
                      const maxVal = Math.max(...chartReadings.map(c => c.consumption), 30);
                      const barHeight = Math.max(20, Math.min(180, (r.consumption / maxVal) * 170));
                      const isAbnormal = r.status === 'flagged_abnormal' || r.consumption > 40;

                      return (
                        <div key={idx} className="flex flex-col items-center space-y-2 w-14 group">
                          <span className="text-[10px] font-mono font-black text-slate-700 opacity-80 group-hover:opacity-100 transition">
                            {r.consumption} m³
                          </span>
                          <div 
                            className={`w-8 rounded-t-lg transition-all duration-500 ${
                              isAbnormal 
                                ? 'bg-rose-500 hover:bg-rose-600 shadow-sm' 
                                : 'bg-blue-600 hover:bg-blue-700 shadow-sm'
                            }`}
                            style={{ height: `${barHeight}px` }}
                            title={`${r.billingPeriod}: ${r.consumption} m³`}
                          ></div>
                          <span className="text-[9px] font-medium text-slate-500 truncate w-full text-center">
                            {r.billingPeriod.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-64 bg-slate-50 rounded-2xl flex items-center justify-center text-xs text-slate-400">
                    No consumption data recorded yet.
                  </div>
                )}
              </div>

              {/* Monthly Billing Chart */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                      Monthly Billing History
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      Calculated tariff costs in Philippine Pesos (₱)
                    </p>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200">
                    Tariff Tier
                  </span>
                </div>

                {chartReadings.length > 0 ? (
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 pt-8 h-64 flex items-end justify-around relative">
                    <div className="absolute left-4 top-3 text-[9px] font-mono text-slate-400">
                      Y-Axis: Billed Amount (₱)
                    </div>
                    {chartReadings.map((r, idx) => {
                      const cost = calculateCostOf(r.consumption, consumerRecord.consumerType);
                      const maxCost = Math.max(...chartReadings.map(c => calculateCostOf(c.consumption, consumerRecord.consumerType)), 500);
                      const barHeight = Math.max(20, Math.min(180, (cost / maxCost) * 170));
                      const isPaid = r.paymentStatus === 'paid';

                      return (
                        <div key={idx} className="flex flex-col items-center space-y-2 w-14 group">
                          <span className="text-[10px] font-mono font-black text-slate-700 opacity-80 group-hover:opacity-100 transition">
                            ₱{cost > 999 ? `${(cost/1000).toFixed(1)}k` : cost.toFixed(0)}
                          </span>
                          <div 
                            className={`w-8 rounded-t-lg transition-all duration-500 ${
                              isPaid 
                                ? 'bg-emerald-500 hover:bg-emerald-600 shadow-sm' 
                                : 'bg-amber-500 hover:bg-amber-600 shadow-sm'
                            }`}
                            style={{ height: `${barHeight}px` }}
                            title={`${r.billingPeriod}: ₱${cost.toFixed(2)} (${isPaid ? 'PAID' : 'UNPAID'})`}
                          ></div>
                          <span className="text-[9px] font-medium text-slate-500 truncate w-full text-center">
                            {r.billingPeriod.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-64 bg-slate-50 rounded-2xl flex items-center justify-center text-xs text-slate-400">
                    No billing history recorded yet.
                  </div>
                )}
              </div>

            </div>

            {/* RECENT BILLS LIST & RECENT READINGS LIST */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Recent Bills List (7 Cols) */}
              <div className="lg:col-span-7 bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <ReceiptText className="h-4 w-4 text-blue-600" />
                    <span>Recent Bills</span>
                  </h3>
                  <button 
                    onClick={() => setActiveTab('bills')}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center cursor-pointer"
                  >
                    <span>View All Bills</span>
                    <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {readings.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                      <ReceiptText className="h-8 w-8 mx-auto text-slate-300" />
                      <p className="font-semibold text-slate-600">No billing statements recorded yet.</p>
                      <p className="text-[11px] text-slate-400">Readings verified by the water district will appear here automatically.</p>
                    </div>
                  ) : (
                    readings.slice(0, 3).map((r) => {
                      const cost = calculateCostOf(r.consumption, consumerRecord.consumerType);
                      const isPaid = r.paymentStatus === 'paid';
                      const isPartial = r.paymentStatus === 'partial';
                      const paidAmt = r.paidAmount || 0;
                      const remainingDue = Math.max(0, cost - paidAmt);

                      const isHighlight = highlightedReadingId === r.id;

                      return (
                        <div 
                          key={r.id} 
                          className={`py-3.5 px-3 rounded-2xl transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                            isHighlight ? 'bg-sky-100/90 border-l-4 border-l-blue-700 ring-1 ring-blue-300 shadow-xs' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className={`text-xs font-black ${isHighlight ? 'text-blue-950 font-extrabold' : 'text-slate-950'}`}>
                                {r.billingPeriod} Statement
                              </span>
                              {isHighlight && (
                                <span className="px-2 py-0.5 bg-blue-700 text-white font-black text-[9px] uppercase tracking-wider rounded-md shadow-xs">
                                  Selected
                                </span>
                              )}
                              {/* COLOR CODED BILL STATUS BADGE */}
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                isPaid 
                                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' 
                                  : isPartial
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-rose-100 text-rose-900 border border-rose-300'
                              }`}>
                                {isPaid ? 'Paid in Full' : isPartial ? `Partial (₱${remainingDue.toFixed(2)} Due)` : 'Unpaid'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-700 font-medium">
                              Consumption: <strong className="text-slate-950 font-mono font-bold">{r.consumption} m³</strong> • Due: <span className="text-slate-900 font-semibold">{r.dueDate || '20th of Month'}</span>
                            </p>
                            {isPartial && (
                              <p className="text-[11px] text-amber-900 font-bold">
                                Credited: ₱{paidAmt.toFixed(2)} • Remaining: ₱{remainingDue.toFixed(2)}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center space-x-3 text-right shrink-0 w-full sm:w-auto justify-between sm:justify-end">
                            <div>
                              <span className="font-mono font-black text-slate-950 text-sm block">
                                {isPartial ? `₱${remainingDue.toFixed(2)}` : `₱${cost.toFixed(2)}`}
                              </span>
                              <span className="text-[10px] text-slate-600 font-mono font-medium block">
                                {isPaid 
                                  ? (r.paymentDate ? `Paid ${r.paymentDate}` : 'Settled')
                                  : isPartial 
                                  ? `Total Bill ₱${cost.toFixed(2)}` 
                                  : 'Amount Payable'}
                              </span>
                            </div>
                            {isPaid ? (
                              <button
                                onClick={() => setReceiptDetailModal(r)}
                                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-xs rounded-xl shadow-xs hover:shadow-md transition inline-flex items-center space-x-1.5 cursor-pointer border border-emerald-500"
                                id={`dashboard-receipt-btn-${r.id}`}
                                title="Click to view Official Electronic Payment Receipt"
                              >
                                <ReceiptText className="h-4 w-4" />
                                <span>Receipt</span>
                              </button>
                            ) : isPartial ? (
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => setReceiptDetailModal(r)}
                                  className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                                  title="View Partial Payment Receipt"
                                >
                                  <ReceiptText className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveTab('bills');
                                    handleStartPayment(r, 'full');
                                  }}
                                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs rounded-xl shadow-xs hover:shadow-md transition inline-flex items-center space-x-1.5 cursor-pointer"
                                  id={`dashboard-pay-partial-${r.id}`}
                                >
                                  <CreditCard className="h-4 w-4" />
                                  <span>Pay ₱{remainingDue.toFixed(2)}</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setActiveTab('bills');
                                  handleStartPayment(r, 'full');
                                }}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-xs hover:shadow-md transition inline-flex items-center space-x-1.5 cursor-pointer"
                                id={`dashboard-pay-btn-${r.id}`}
                              >
                                <CreditCard className="h-4 w-4" />
                                <span>Pay Bill</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Recent Readings List (5 Cols) */}
              <div className="lg:col-span-5 bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="h-4 w-4 text-sky-600" />
                    <span>Recent Readings</span>
                  </h3>
                  <button 
                    onClick={() => setActiveTab('usage')}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center cursor-pointer"
                  >
                    <span>Full Ledger</span>
                    <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {readings.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                      <Activity className="h-8 w-8 mx-auto text-slate-300" />
                      <p className="font-semibold text-slate-600">No physical readings logged yet.</p>
                      <p className="text-[11px] text-slate-400">Field meter recordings will appear here in chronological order.</p>
                    </div>
                  ) : (
                    readings.slice(0, 3).map((r) => (
                      <div key={r.id} className="py-3.5 space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-800">{r.readingDate}</span>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                            r.status === 'flagged_abnormal'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-sky-100 text-sky-800 border border-sky-300'
                          }`}>
                            {r.status === 'flagged_abnormal' ? 'High / Flagged' : 'Verified'}
                          </span>
                        </div>
                        <div className="flex justify-between items-baseline text-xs">
                          <span className="text-slate-500 font-mono text-[11px]">
                            {r.previousReading} m³ → {r.currentReading} m³
                          </span>
                          <span className="font-mono font-black text-blue-700 text-sm">
                            {r.consumption} m³
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 2: MY BILLS                                           */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'bills' && (
          <div className="space-y-6 animate-fade-in" id="consumer-tab-bills">
            
            {/* Header & Filter Controls - Eye-friendly Dark Slate Theme */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-5 text-white">
              <div>
                <div className="flex items-center space-x-2.5">
                  <span className="p-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl">
                    <ReceiptText className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-black text-white uppercase tracking-wider">
                    Complete Water Bill History
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-1.5 font-medium">
                  Audit all historical bills, due dates, outstanding dues, and official receipts.
                </p>
              </div>

              {/* Status Filter Tabs - Eye-friendly dark container with clear, comfortable pill states */}
              <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-950/90 rounded-2xl border border-slate-800 shadow-inner">
                <div className="hidden sm:flex items-center space-x-1.5 pl-2.5 pr-1 text-slate-400 text-[11px] font-black uppercase tracking-wider">
                  <ListFilter className="h-3.5 w-3.5 text-blue-400" />
                  <span>Filter:</span>
                </div>

                <button
                  onClick={() => setBillFilter('all')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center space-x-1.5 cursor-pointer ${
                    billFilter === 'all' 
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 border border-blue-500' 
                      : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80'
                  }`}
                  id="filter-bills-all"
                >
                  <span>All</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    billFilter === 'all' ? 'bg-black/30 text-white' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {readings.length}
                  </span>
                </button>

                <button
                  onClick={() => setBillFilter('unpaid')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center space-x-1.5 cursor-pointer ${
                    billFilter === 'unpaid' 
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 border border-rose-500' 
                      : 'bg-slate-900 text-rose-300 hover:text-rose-200 hover:bg-rose-950/40 border border-rose-900/60'
                  }`}
                  id="filter-bills-unpaid"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>Unpaid</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    billFilter === 'unpaid' ? 'bg-black/30 text-white' : 'bg-rose-950/80 text-rose-300'
                  }`}>
                    {unpaidBills.length}
                  </span>
                </button>

                <button
                  onClick={() => setBillFilter('partial')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center space-x-1.5 cursor-pointer ${
                    billFilter === 'partial' 
                      ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 border border-amber-500' 
                      : 'bg-slate-900 text-amber-300 hover:text-amber-200 hover:bg-amber-950/40 border border-amber-900/60'
                  }`}
                  id="filter-bills-partial"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Partial</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    billFilter === 'partial' ? 'bg-black/30 text-white' : 'bg-amber-950/80 text-amber-300'
                  }`}>
                    {partialBills.length}
                  </span>
                </button>

                <button
                  onClick={() => setBillFilter('paid')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center space-x-1.5 cursor-pointer ${
                    billFilter === 'paid' 
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 border border-emerald-500' 
                      : 'bg-slate-900 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-950/40 border border-emerald-900/60'
                  }`}
                  id="filter-bills-paid"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Paid</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    billFilter === 'paid' ? 'bg-black/30 text-white' : 'bg-emerald-950/80 text-emerald-300'
                  }`}>
                    {paidBills.length}
                  </span>
                </button>
              </div>
            </div>

            {/* Interactive Checkout Modal (if active) */}
            {activePaymentBill && (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl animate-fade-in text-white">
                <div className="flex justify-between items-center pb-4 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-blue-400" />
                      <span>Online Payment Terminal</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Settling {activePaymentBill.billingPeriod} Statement for Account #{activePaymentBill.accountNumber}
                    </p>
                  </div>
                  <button
                    onClick={() => setActivePaymentBill(null)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {isProcessingPayment && paymentStep ? (
                  /* Processing Loader */
                  <div className="py-12 text-center space-y-5">
                    <div className="relative h-16 w-16 mx-auto">
                      <div className="absolute inset-0 rounded-full border-4 border-slate-800 border-t-blue-500 animate-spin"></div>
                      <div className="absolute inset-3 rounded-full bg-blue-950/60 flex items-center justify-center">
                        <Activity className="h-4 w-4 text-blue-400 animate-pulse" />
                      </div>
                    </div>
                    <div className="max-w-sm mx-auto space-y-2">
                      <div className="flex justify-between text-xs font-bold text-slate-400 px-1">
                        <span>Authorizing Settlement</span>
                        <span>{paymentStep.percentage}%</span>
                      </div>
                      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 transition-all duration-500 ease-out"
                          style={{ width: `${paymentStep.percentage}%` }}
                        ></div>
                      </div>
                      <p className="text-xs font-bold text-slate-200 pt-1">{paymentStep.text}</p>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleConfirmPayment} className="space-y-6">
                    {/* Bill Payable Summary */}
                    {(() => {
                      const totalBill = calculateCostOf(activePaymentBill.consumption, consumerRecord.consumerType);
                      const credited = activePaymentBill.paidAmount || 0;
                      const maxPayable = Math.max(0, totalBill - credited);
                      const currentPaying = paymentMode === 'full' 
                        ? maxPayable 
                        : Math.min(maxPayable, Math.max(1, parseFloat(partialCustomAmount) || 0));
                      const remainingAfter = Math.max(0, maxPayable - currentPaying);

                      return (
                        <>
                          <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Billing Period</span>
                              <span className="font-extrabold text-white text-sm">{activePaymentBill.billingPeriod} Water Tariff</span>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                Gross Bill: <strong className="font-mono text-slate-200">₱{totalBill.toFixed(2)}</strong>
                                {credited > 0 && (
                                  <span> • Previously Paid: <strong className="font-mono text-emerald-400">₱{credited.toFixed(2)}</strong></span>
                                )}
                              </div>
                            </div>
                            <div className="text-left sm:text-right">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Net Remaining Due</span>
                              <span className="font-mono font-black text-rose-400 text-2xl">
                                ₱{maxPayable.toFixed(2)}
                              </span>
                            </div>
                          </div>

                          {/* Payment Mode Selector (Full vs Partial) */}
                          <div className="space-y-3">
                            <label className="block text-xs font-black text-slate-300 uppercase tracking-wider">
                              Choose Payment Option
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <button
                                type="button"
                                onClick={() => setPaymentMode('full')}
                                className={`p-4 border-2 rounded-2xl text-left transition cursor-pointer flex flex-col justify-between space-y-2 ${
                                  paymentMode === 'full'
                                    ? 'border-blue-500 bg-blue-950/60 shadow-md shadow-blue-950'
                                    : 'border-slate-800 bg-slate-950/80 hover:border-slate-700 hover:bg-slate-800/70 text-slate-300'
                                }`}
                              >
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-black text-white uppercase tracking-wider">
                                    Pay Full Amount
                                  </span>
                                  <CheckCircle2 className={`h-4 w-4 ${paymentMode === 'full' ? 'text-blue-400' : 'text-slate-600'}`} />
                                </div>
                                <div className="font-mono font-black text-blue-400 text-lg">
                                  ₱{maxPayable.toFixed(2)}
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium">Clears entire statement balance instantly</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentMode('partial');
                                  if (!partialCustomAmount || parseFloat(partialCustomAmount) <= 0) {
                                    setPartialCustomAmount((maxPayable / 2).toFixed(2));
                                  }
                                }}
                                className={`p-4 border-2 rounded-2xl text-left transition cursor-pointer flex flex-col justify-between space-y-2 ${
                                  paymentMode === 'partial'
                                    ? 'border-amber-500 bg-amber-950/60 shadow-md shadow-amber-950'
                                    : 'border-slate-800 bg-slate-950/80 hover:border-slate-700 hover:bg-slate-800/70 text-slate-300'
                                }`}
                              >
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-black text-white uppercase tracking-wider">
                                    Pay Partial / Staggered
                                  </span>
                                  <AlertTriangle className={`h-4 w-4 ${paymentMode === 'partial' ? 'text-amber-400' : 'text-slate-600'}`} />
                                </div>
                                <div className="font-mono font-black text-amber-400 text-lg">
                                  ₱{currentPaying.toFixed(2)}
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium">Tender partial amount & keep balance active</span>
                              </button>
                            </div>
                          </div>

                          {/* Partial Amount Input & Quick Chips */}
                          {paymentMode === 'partial' && (
                            <div className="bg-slate-950/90 border border-amber-900/60 rounded-2xl p-4 space-y-3 animate-fade-in">
                              <div className="flex justify-between items-center">
                                <label className="block text-[11px] font-black text-amber-400 uppercase tracking-wider">
                                  Enter Partial Amount to Pay (₱)
                                </label>
                                <span className="text-[10px] font-bold text-amber-300">
                                  Max: ₱{maxPayable.toFixed(2)}
                                </span>
                              </div>
                              <div className="relative">
                                <span className="absolute left-3.5 top-2.5 text-slate-400 font-mono font-bold text-base">₱</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="1"
                                  max={maxPayable}
                                  required
                                  value={partialCustomAmount}
                                  onChange={(e) => setPartialCustomAmount(e.target.value)}
                                  className="w-full bg-slate-900 border border-amber-700/80 pl-8 pr-3 py-2.5 text-base rounded-xl font-mono font-black text-white focus:border-amber-500"
                                  placeholder="0.00"
                                />
                              </div>

                              {/* Quick Selection Chips */}
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quick:</span>
                                <button
                                  type="button"
                                  onClick={() => setPartialCustomAmount((maxPayable * 0.25).toFixed(2))}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-800/60 rounded-lg text-xs font-bold font-mono cursor-pointer"
                                >
                                  25% (₱{(maxPayable * 0.25).toFixed(2)})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPartialCustomAmount((maxPayable * 0.50).toFixed(2))}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-800/60 rounded-lg text-xs font-bold font-mono cursor-pointer"
                                >
                                  50% (₱{(maxPayable * 0.50).toFixed(2)})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPartialCustomAmount((maxPayable * 0.75).toFixed(2))}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-800/60 rounded-lg text-xs font-bold font-mono cursor-pointer"
                                >
                                  75% (₱{(maxPayable * 0.75).toFixed(2)})
                                </button>
                              </div>

                              {/* Real-time Aftermath Calculation */}
                              <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs">
                                <span className="text-amber-300 font-bold">Remaining Balance After Payment:</span>
                                <span className="font-mono font-black text-rose-400">₱{remainingAfter.toFixed(2)}</span>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* Method Selector */}
                    <div>
                      <label className="block text-xs font-black text-slate-300 uppercase tracking-wider mb-2.5">
                        Select Payment Method
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('gcash')}
                          className={`p-3.5 border rounded-2xl flex flex-col items-center justify-center space-y-2 transition cursor-pointer ${
                            paymentMethod === 'gcash' 
                              ? 'border-blue-500 bg-blue-950/80 text-blue-300 shadow-xs' 
                              : 'border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <Smartphone className="h-5 w-5 text-blue-400" />
                          <span className="text-xs font-bold">GCash Mobile</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('maya')}
                          className={`p-3.5 border rounded-2xl flex flex-col items-center justify-center space-y-2 transition cursor-pointer ${
                            paymentMethod === 'maya' 
                              ? 'border-emerald-500 bg-emerald-950/80 text-emerald-300 shadow-xs' 
                              : 'border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <Smartphone className="h-5 w-5 text-emerald-400" />
                          <span className="text-xs font-bold">Maya Wallet</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('card')}
                          className={`p-3.5 border rounded-2xl flex flex-col items-center justify-center space-y-2 transition cursor-pointer ${
                            paymentMethod === 'card' 
                              ? 'border-indigo-500 bg-indigo-950/80 text-indigo-300 shadow-xs' 
                              : 'border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <CreditCard className="h-5 w-5 text-indigo-400" />
                          <span className="text-xs font-bold">Debit/Credit Card</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('bank')}
                          className={`p-3.5 border rounded-2xl flex flex-col items-center justify-center space-y-2 transition cursor-pointer ${
                            paymentMethod === 'bank' 
                              ? 'border-amber-500 bg-amber-950/80 text-amber-300 shadow-xs' 
                              : 'border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <Waves className="h-5 w-5 text-amber-400" />
                          <span className="text-xs font-bold">Landbank Link</span>
                        </button>
                      </div>
                    </div>

                    {/* Method Inputs */}
                    {(paymentMethod === 'gcash' || paymentMethod === 'maya') && (
                      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2">
                        <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                          Registered {paymentMethod === 'gcash' ? 'GCash' : 'Maya'} Mobile Number
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-2.5 text-slate-500 font-mono font-bold text-xs">+63</span>
                          <input
                            type="tel"
                            required
                            value={gcashPhone}
                            onChange={(e) => setGcashPhone(e.target.value)}
                            placeholder="917 123 4567"
                            className="w-full bg-slate-900 border border-slate-700 pl-12 pr-3 py-2.5 text-xs rounded-xl focus:border-blue-500 font-mono font-bold text-white"
                          />
                        </div>
                      </div>
                    )}

                    {paymentMethod === 'card' && (
                      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">Cardholder Name</label>
                          <input
                            type="text"
                            required
                            value={cardName}
                            onChange={(e) => setCardName(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 px-3 py-2 text-xs rounded-xl focus:border-blue-500 text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">Card Number</label>
                          <input
                            type="text"
                            required
                            value={cardNumber}
                            onChange={(e) => setCardNumber(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 px-3 py-2 text-xs rounded-xl focus:border-blue-500 font-mono text-white"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">Expiry Date</label>
                            <input
                              type="text"
                              required
                              value={cardExpiry}
                              onChange={(e) => setCardExpiry(e.target.value)}
                              placeholder="MM/YY"
                              className="w-full bg-slate-900 border border-slate-700 px-3 py-2 text-xs rounded-xl text-center font-mono text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">CVV</label>
                            <input
                              type="password"
                              required
                              value={cardCvv}
                              onChange={(e) => setCardCvv(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 px-3 py-2 text-xs rounded-xl text-center font-mono text-white"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {paymentMethod === 'bank' && (
                      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2">
                        <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                          Landbank Account / Partner ID
                        </label>
                        <input
                          type="text"
                          required
                          value={bankAccountNum}
                          onChange={(e) => setBankAccountNum(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 px-3 py-2.5 text-xs rounded-xl font-mono text-white"
                        />
                      </div>
                    )}

                    <div className="flex justify-end space-x-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setActivePaymentBill(null)}
                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer border border-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition cursor-pointer"
                      >
                        {(() => {
                          const total = calculateCostOf(activePaymentBill.consumption, consumerRecord.consumerType);
                          const rem = Math.max(0, total - (activePaymentBill.paidAmount || 0));
                          const paying = paymentMode === 'full' ? rem : Math.min(rem, parseFloat(partialCustomAmount) || 0);
                          return `Authorize Settlement of ₱${paying.toFixed(2)}`;
                        })()}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Complete Bills Table & Responsive Grid - Eye-Friendly Dark Navy Slate Theme */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl text-slate-100">
              {/* Desktop & Tablet Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-300 font-black uppercase text-[11px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3.5 whitespace-nowrap">Billing Period</th>
                      <th className="px-4 py-3.5 whitespace-nowrap">Index (m³)</th>
                      <th className="px-4 py-3.5 whitespace-nowrap">Consumption</th>
                      <th className="px-4 py-3.5 whitespace-nowrap">Gross Amount</th>
                      <th className="px-4 py-3.5 whitespace-nowrap">Paid / Credit</th>
                      <th className="px-4 py-3.5 whitespace-nowrap">Net Balance Due</th>
                      <th className="px-4 py-3.5 whitespace-nowrap">Due Date</th>
                      <th className="px-4 py-3.5 whitespace-nowrap">Status</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200 font-medium">
                    {readings
                      .filter(r => {
                        if (billFilter === 'unpaid') return r.paymentStatus !== 'paid';
                        if (billFilter === 'paid') return r.paymentStatus === 'paid';
                        if (billFilter === 'partial') return r.paymentStatus === 'partial';
                        return true;
                      })
                      .map((r) => {
                        const totalAmount = calculateCostOf(r.consumption, consumerRecord.consumerType);
                        const isPaid = r.paymentStatus === 'paid';
                        const isPartial = r.paymentStatus === 'partial';
                        const paidAmt = r.paidAmount || 0;
                        const remainingDue = Math.max(0, totalAmount - paidAmt);
                        const isHighlight = highlightedReadingId === r.id;

                        return (
                          <tr 
                            key={r.id} 
                            className={`transition-colors duration-150 ${
                              isHighlight 
                                ? 'bg-blue-950/80 border-l-4 border-l-blue-500 ring-1 ring-blue-500/40 text-white' 
                                : 'hover:bg-slate-800/60'
                            }`}
                          >
                            {/* Billing Period & ID */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <div className="flex items-center space-x-2">
                                <span className={`font-black text-xs ${isHighlight ? 'text-blue-300 font-extrabold' : 'text-white'}`}>
                                  {r.billingPeriod}
                                </span>
                                {isHighlight && (
                                  <span className="px-2 py-0.5 bg-blue-600 text-white font-black text-[9px] uppercase tracking-wider rounded shadow-xs">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-400 font-mono font-medium block">
                                Statement #{r.id}
                              </span>
                            </td>

                            {/* Meter Readings Index */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono text-slate-300 font-medium">
                              {r.previousReading} → <strong className="text-white font-bold">{r.currentReading}</strong>
                            </td>

                            {/* Consumption Volume */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono font-bold text-blue-300">
                              <span className="inline-block px-2 py-0.5 bg-blue-950/80 border border-blue-800/80 rounded-md">
                                {r.consumption} m³
                              </span>
                            </td>

                            {/* Gross Bill */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono font-black text-white text-sm">
                              ₱{totalAmount.toFixed(2)}
                            </td>

                            {/* Paid / Credited */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono font-bold text-emerald-300">
                              {paidAmt > 0 ? (
                                <span className="bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/80">
                                  ₱{paidAmt.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-slate-500">₱0.00</span>
                              )}
                            </td>

                            {/* Remaining Balance Due */}
                            <td className="px-4 py-3.5 whitespace-nowrap font-mono font-black text-sm">
                              {isPaid ? (
                                <span className="text-emerald-400 font-bold">₱0.00</span>
                              ) : isPartial ? (
                                <span className="text-amber-300 font-black bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/80">
                                  ₱{remainingDue.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-rose-300 font-black bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800/80">
                                  ₱{totalAmount.toFixed(2)}
                                </span>
                              )}
                            </td>

                            {/* Due Date */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-slate-300 font-semibold">
                              {r.dueDate || '20th of Month'}
                            </td>

                            {/* Payment Status Badge */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                isPaid 
                                  ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800' 
                                  : isPartial
                                  ? 'bg-amber-950/90 text-amber-300 border border-amber-800'
                                  : 'bg-rose-950/90 text-rose-300 border border-rose-800'
                              }`}>
                                {isPaid ? 'Paid in Full' : isPartial ? 'Partial Balance' : 'Unpaid'}
                              </span>
                            </td>

                            {/* Action Buttons */}
                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                              {isPaid ? (
                                <button
                                  onClick={() => setReceiptDetailModal(r)}
                                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer border border-emerald-500"
                                  id={`table-receipt-btn-${r.id}`}
                                  title="View Official Electronic Payment Receipt"
                                >
                                  <ReceiptText className="h-3.5 w-3.5" />
                                  <span>Receipt</span>
                                </button>
                              ) : isPartial ? (
                                <div className="inline-flex items-center space-x-1.5">
                                  <button
                                    onClick={() => setReceiptDetailModal(r)}
                                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer border border-slate-700"
                                    title="View Partial Receipt"
                                  >
                                    <ReceiptText className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleStartPayment(r, 'full')}
                                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-black text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer"
                                    id={`table-pay-partial-${r.id}`}
                                  >
                                    <CreditCard className="h-3.5 w-3.5" />
                                    <span>Pay ₱{remainingDue.toFixed(2)}</span>
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleStartPayment(r, 'full')}
                                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-black text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-1.5 cursor-pointer"
                                  id={`table-pay-btn-${r.id}`}
                                >
                                  <CreditCard className="h-3.5 w-3.5" />
                                  <span>Pay Bill</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View for Perfect Fitting on Small Screens */}
              <div className="block md:hidden divide-y divide-slate-800/80">
                {readings
                  .filter(r => {
                    if (billFilter === 'unpaid') return r.paymentStatus !== 'paid';
                    if (billFilter === 'paid') return r.paymentStatus === 'paid';
                    if (billFilter === 'partial') return r.paymentStatus === 'partial';
                    return true;
                  })
                  .map((r) => {
                    const totalAmount = calculateCostOf(r.consumption, consumerRecord.consumerType);
                    const isPaid = r.paymentStatus === 'paid';
                    const isPartial = r.paymentStatus === 'partial';
                    const paidAmt = r.paidAmount || 0;
                    const remainingDue = Math.max(0, totalAmount - paidAmt);
                    const isHighlight = highlightedReadingId === r.id;

                    return (
                      <div 
                        key={`mob-${r.id}`}
                        className={`p-4 space-y-3 transition-colors ${
                          isHighlight ? 'bg-blue-950/60 border-l-4 border-l-blue-500' : 'hover:bg-slate-850'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-black text-white text-sm">{r.billingPeriod}</span>
                              {isHighlight && (
                                <span className="px-1.5 py-0.2 bg-blue-600 text-white font-black text-[9px] uppercase rounded">
                                  Selected
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono font-medium">#{r.id}</span>
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            isPaid 
                              ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800' 
                              : isPartial
                              ? 'bg-amber-950/90 text-amber-300 border border-amber-800'
                              : 'bg-rose-950/90 text-rose-300 border border-rose-800'
                          }`}>
                            {isPaid ? 'Paid' : isPartial ? 'Partial' : 'Unpaid'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Consumption</span>
                            <span className="font-mono font-black text-blue-300">{r.consumption} m³</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Gross Bill</span>
                            <span className="font-mono font-black text-white">₱{totalAmount.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Due Date</span>
                            <span className="text-slate-300 font-semibold">{r.dueDate || '20th'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Balance Due</span>
                            <span className={`font-mono font-black ${isPaid ? 'text-emerald-400' : isPartial ? 'text-amber-300' : 'text-rose-300'}`}>
                              ₱{(isPaid ? 0 : isPartial ? remainingDue : totalAmount).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="flex justify-end pt-1">
                          {isPaid ? (
                            <button
                              onClick={() => setReceiptDetailModal(r)}
                              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                            >
                              <ReceiptText className="h-3.5 w-3.5" />
                              <span>View Receipt</span>
                            </button>
                          ) : isPartial ? (
                            <div className="flex items-center space-x-2 w-full">
                              <button
                                onClick={() => setReceiptDetailModal(r)}
                                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer border border-slate-700"
                              >
                                <ReceiptText className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleStartPayment(r, 'full')}
                                className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                                <span>Pay ₱{remainingDue.toFixed(2)}</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleStartPayment(r, 'full')}
                              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              <span>Pay Bill Now</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 3: MY USAGE                                           */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'usage' && (
          <div className="space-y-6 animate-fade-in" id="consumer-tab-usage">
            
            {/* Header & Usage Summary Statistics */}
            <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-black text-slate-900 uppercase tracking-wider">
                  Meter Reading History & Usage Analytics
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Complete timeline of physical meter inspections conducted by authorized Tagoloan Water District field readers.
                </p>
              </div>

              {/* Summary Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-150">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Volume Consumed</span>
                  <span className="text-2xl font-black font-mono text-blue-700 mt-1 block">
                    {readings.reduce((acc, r) => acc + r.consumption, 0)} m³
                  </span>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-150">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Average Monthly Usage</span>
                  <span className="text-2xl font-black font-mono text-slate-800 mt-1 block">
                    {readings.length > 0 
                      ? (readings.reduce((acc, r) => acc + r.consumption, 0) / readings.length).toFixed(1)
                      : 0} m³
                  </span>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-150">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Peak Month Consumption</span>
                  <span className="text-2xl font-black font-mono text-rose-600 mt-1 block">
                    {readings.length > 0 ? Math.max(...readings.map(r => r.consumption)) : 0} m³
                  </span>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-150">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Audited Reading Cycles</span>
                  <span className="text-2xl font-black font-mono text-emerald-700 mt-1 block">
                    {readings.length} Cycles
                  </span>
                </div>
              </div>
            </div>

            {/* Comprehensive Reading History Table */}
            <div className="bg-white border border-slate-200/80 rounded-3xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Reading Date</th>
                      <th className="px-6 py-4">Meter Serial / Tag</th>
                      <th className="px-6 py-4">Prev → Current Index</th>
                      <th className="px-6 py-4">Consumption (m³)</th>
                      <th className="px-6 py-4">Reading Status</th>
                      <th className="px-6 py-4">Log Method</th>
                      <th className="px-6 py-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                    {readings.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-6 py-4 font-bold text-slate-900">
                          {r.readingDate}
                          <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{r.billingPeriod}</span>
                        </td>
                        <td className="px-6 py-4 font-mono font-bold text-blue-700">
                          {r.meterNumber}
                        </td>
                        <td className="px-6 py-4 font-mono text-slate-700">
                          {r.previousReading} m³ → <strong className="text-slate-900">{r.currentReading} m³</strong>
                        </td>
                        <td className="px-6 py-4 font-mono font-black text-blue-800 text-sm">
                          {r.consumption} m³
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            r.status === 'flagged_abnormal'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : r.status === 'pending'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          }`}>
                            {r.status === 'flagged_abnormal' ? 'Flagged Abnormal' : r.status === 'pending' ? 'Pending Review' : 'Verified'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-600 font-mono text-[11px]">
                          TWD Field Unit
                        </td>
                        <td className="px-6 py-4 text-slate-500 italic max-w-xs truncate">
                          {r.notes || 'Normal residential baseline reading'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 4: NOTIFICATIONS                                      */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'notifications' && (
          <div className="space-y-6 animate-fade-in" id="consumer-tab-notifications">
            
            {/* Header & Filter */}
            <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-black text-slate-900 uppercase tracking-wider">
                  Notifications & District Advisories
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  All payment confirmations, billing alerts, and administrative district announcements.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200 shadow-2xs">
                <button
                  onClick={() => setNotifFilter('all')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                    notifFilter === 'all' 
                      ? 'bg-slate-900 text-white shadow-sm' 
                      : 'bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 border border-slate-200/80'
                  }`}
                  id="filter-notif-all"
                >
                  All ({notifications.length + announcements.length})
                </button>
                <button
                  onClick={() => setNotifFilter('billing')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                    notifFilter === 'billing' 
                      ? 'bg-blue-600 text-white shadow-sm' 
                      : 'bg-white text-blue-700 hover:text-blue-800 hover:bg-blue-50 border border-blue-200'
                  }`}
                  id="filter-notif-billing"
                >
                  Bills & Balances ({notifications.filter(n => n.type === 'billing' || n.type === 'balance').length})
                </button>
                <button
                  onClick={() => setNotifFilter('payment')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                    notifFilter === 'payment' 
                      ? 'bg-emerald-600 text-white shadow-sm' 
                      : 'bg-white text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border border-emerald-200'
                  }`}
                  id="filter-notif-payment"
                >
                  Payments ({notifications.filter(n => n.type === 'payment').length})
                </button>
                <button
                  onClick={() => setNotifFilter('announcement')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                    notifFilter === 'announcement' 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'bg-white text-indigo-700 hover:text-indigo-800 hover:bg-indigo-50 border border-indigo-200'
                  }`}
                  id="filter-notif-advisories"
                >
                  Advisories ({announcements.length})
                </button>
              </div>
            </div>

            {/* Notifications Grid */}
            <div className="grid grid-cols-1 gap-4">
              
              {/* Payment & Billing Notifications from mockDb */}
              {notifications
                .filter(n => {
                  if (notifFilter === 'all') return true;
                  if (notifFilter === 'billing') return n.type === 'billing' || n.type === 'balance';
                  if (notifFilter === 'payment') return n.type === 'payment';
                  return notifFilter === n.type;
                })
                .map((n) => {
                  const isBilling = n.type === 'billing' || n.type === 'balance';
                  const isPartialAlert = n.title.toLowerCase().includes('partial') || n.message.toLowerCase().includes('remaining');

                  return (
                    <div 
                      key={n.id} 
                      className={`bg-white border rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row items-start justify-between gap-4 transition ${
                        !n.read ? 'border-blue-300 bg-blue-50/20' : 'border-slate-200/80'
                      }`}
                    >
                      <div className="flex items-start space-x-3.5">
                        <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                          isPartialAlert
                            ? 'bg-amber-100 text-amber-800'
                            : isBilling
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {isPartialAlert ? (
                            <AlertTriangle className="h-5 w-5" />
                          ) : isBilling ? (
                            <ReceiptText className="h-5 w-5" />
                          ) : (
                            <CheckCircle2 className="h-5 w-5" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-0.2 font-black text-[9px] uppercase rounded ${
                              isPartialAlert
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : isBilling
                                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            }`}>
                              {isPartialAlert ? 'Remaining Balance' : isBilling ? 'Bill Arrival' : 'Payment Success'}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {new Date(n.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <h4 className="text-sm font-black text-slate-900">{n.title}</h4>
                          <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">{n.message}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 self-end sm:self-center shrink-0">
                        {/* View on Dashboard Button */}
                        <button
                          onClick={() => handleNotificationClick(n, 'dashboard')}
                          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl border border-blue-200 transition flex items-center space-x-1 cursor-pointer"
                          title="Display Reading & Consumption Spotlight on Dashboard"
                        >
                          <LayoutDashboard className="h-3.5 w-3.5" />
                          <span>View on Dashboard</span>
                        </button>

                        {/* View in Bills Button */}
                        <button
                          onClick={() => handleNotificationClick(n, 'bills')}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center space-x-1 cursor-pointer"
                          title="View Statement in My Bills"
                        >
                          <ReceiptText className="h-3.5 w-3.5" />
                          <span>View in Bills</span>
                        </button>

                        {/* Direct Pay Action if Unpaid */}
                        {isBilling && unpaidBills.length > 0 && (
                          <button
                            onClick={() => {
                              const targetBill = readings.find(r => r.id === n.readingId || r.billingPeriod === n.billingPeriod) || unpaidBills[0];
                              setActiveTab('bills');
                              handleStartPayment(targetBill, 'full');
                            }}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center space-x-1 cursor-pointer"
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            <span>Settle Now</span>
                          </button>
                        )}

                        {!n.read && (
                          <button
                            onClick={() => {
                              mockDb.markNotificationRead(n.id);
                              loadConsumerInfo(true);
                            }}
                            className="text-[10px] font-bold text-slate-500 hover:text-slate-800 hover:underline uppercase shrink-0 cursor-pointer px-1 py-1"
                          >
                            Mark Read
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

              {/* District Announcements */}
              {(notifFilter === 'all' || notifFilter === 'announcement') && announcements.map((ann) => (
                <div key={ann.id} className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex items-start justify-between gap-4">
                  <div className="flex items-start space-x-3.5">
                    <div className="p-2.5 bg-blue-50 text-blue-700 rounded-xl shrink-0 mt-0.5">
                      <Bell className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.2 bg-blue-100 text-blue-800 font-black text-[9px] uppercase rounded">
                          {ann.category}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{ann.date}</span>
                      </div>
                      <h4 className="text-sm font-black text-slate-900">{ann.title}</h4>
                      <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">{ann.content}</p>
                      <p className="text-[10px] font-bold text-slate-400 pt-1">Issued by: {ann.postedBy}</p>
                    </div>
                  </div>
                </div>
              ))}

            </div>

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODULE 5: MY PROFILE                                         */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'profile' && (
          <div className="space-y-8 animate-fade-in" id="consumer-tab-profile">
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Edit Personal Information & Contact Details (7 Cols) */}
              <div className="lg:col-span-7 bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
                <div>
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-wider">
                    Edit Personal Information & Contact Details
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Keep your registered mobile contact, email, and service address updated.
                  </p>
                </div>

                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                      Full Legal Name
                    </label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 font-bold"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                        Contact Mobile Number
                      </label>
                      <input
                        type="tel"
                        required
                        value={editContact}
                        onChange={(e) => setEditContact(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                        Registered Email
                      </label>
                      <input
                        type="email"
                        required
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                        Sitio / Zone / House #
                      </label>
                      <input
                        type="text"
                        value={editSitioZone}
                        onChange={(e) => setEditSitioZone(e.target.value)}
                        placeholder="e.g. Zone 2, Sitio Sto. Nino"
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2.5 px-3.5 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                        Full Service Address
                      </label>
                      <input
                        type="text"
                        required
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2.5 px-3.5 text-xs text-slate-900"
                      />
                    </div>
                  </div>

                  {consumerRecord.consumerType === 'Commercial' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                          Business Name
                        </label>
                        <input
                          type="text"
                          value={editBusinessName}
                          onChange={(e) => setEditBusinessName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2.5 px-3.5 text-xs text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                          Business Type
                        </label>
                        <input
                          type="text"
                          value={editBusinessType}
                          onChange={(e) => setEditBusinessType(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2.5 px-3.5 text-xs text-slate-900"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                        Household Information / Members
                      </label>
                      <input
                        type="text"
                        value={editHouseholdInfo}
                        onChange={(e) => setEditHouseholdInfo(e.target.value)}
                        placeholder="e.g. 4 family members"
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2.5 px-3.5 text-xs text-slate-900"
                      />
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-xs transition cursor-pointer"
                    >
                      Save Profile Changes
                    </button>
                  </div>

                </form>
              </div>

              {/* Right Column: Security Credentials & Official Parameters (5 Cols) */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Official Parameters Read-Only Card */}
                <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Official Connection Parameters
                  </h4>

                  <div className="divide-y divide-slate-100 text-xs">
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-500">Official Account Number:</span>
                      <span className="font-mono font-bold text-slate-900">{consumerRecord.accountNumber}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-500">Water Meter Tag Number:</span>
                      <span className="font-mono font-bold text-blue-700">{consumerRecord.meterNumber || 'MT-7711'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-500">Assigned Barangay:</span>
                      <span className="font-bold text-slate-800">{consumerRecord.barangay || 'Poblacion East'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-500">Classification:</span>
                      <span className="font-bold text-slate-800">{consumerRecord.consumerType || 'Residential'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-500">Meter Pipe Diameter:</span>
                      <span className="font-bold text-slate-800">{consumerRecord.meterSize || '1/2 inch'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-500">Connection Status:</span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-black text-[9px] uppercase rounded">
                        {consumerRecord.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Change Password Form */}
                <form onSubmit={handleUpdatePassword} className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-2">
                    Change Account Password
                  </h4>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Current Password
                      </label>
                      <input
                        type="password"
                        required
                        value={passwordOld}
                        onChange={(e) => setPasswordOld(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        New Password
                      </label>
                      <input
                        type="password"
                        required
                        value={passwordNew}
                        onChange={(e) => setPasswordNew(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Confirm New Password
                      </label>
                      <input
                        type="password"
                        required
                        value={passwordConfirm}
                        onChange={(e) => setPasswordConfirm(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 rounded-xl py-2 px-3 text-xs"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition cursor-pointer"
                  >
                    Update Password
                  </button>
                </form>

              </div>

            </div>

          </div>
        )}

      </main>

      {/* DIGITAL RECEIPT MODAL */}
      {receiptDetailModal && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in"
          onClick={() => setReceiptDetailModal(null)}
        >
          <div 
            className="bg-white border border-slate-100 rounded-3xl w-full max-w-sm p-6 sm:p-7 space-y-5 relative overflow-hidden shadow-2xl animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setReceiptDetailModal(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="text-center space-y-1.5 pt-2">
              <div className="h-12 w-12 bg-emerald-50 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center shadow-xs">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                Tagoloan Water District
              </p>
              <h3 className="text-base font-black text-slate-900 leading-tight">
                Official Electronic Payment Receipt
              </h3>
            </div>

            <div className="border-t border-b border-slate-200 border-dashed py-4 space-y-2.5 text-xs text-slate-700 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Consumer Name:</span>
                <span className="font-bold text-slate-900 font-sans">{consumerRecord.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Billing Cycle:</span>
                <span className="font-bold text-slate-900">{receiptDetailModal.billingPeriod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Account Number:</span>
                <span className="font-bold text-slate-900">{receiptDetailModal.accountNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Water Meter Tag:</span>
                <span className="font-bold text-blue-700">{receiptDetailModal.meterNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Method:</span>
                <span className="font-bold text-slate-800 uppercase">{receiptDetailModal.paymentMethod || 'Online Gateway'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Official Receipt #:</span>
                <span className="font-bold text-slate-900 uppercase">{receiptDetailModal.orNumber || receiptDetailModal.paymentReference || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Date Settled:</span>
                <span className="font-bold text-slate-800">{receiptDetailModal.paymentDate || 'N/A'}</span>
              </div>
              {(() => {
                const totalCost = calculateCostOf(receiptDetailModal.consumption, consumerRecord.consumerType);
                const isPart = receiptDetailModal.paymentStatus === 'partial';
                const paid = receiptDetailModal.paidAmount || totalCost;
                const rem = Math.max(0, totalCost - paid);

                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">Payment Status:</span>
                      <span className={`font-bold font-sans ${isPart ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {isPart ? 'Partial Payment Credited' : 'Paid in Full (Settled)'}
                      </span>
                    </div>
                    {isPart && (
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-sans">Gross Statement Total:</span>
                        <span className="font-bold text-slate-800">₱{totalCost.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="pt-2.5 border-t border-slate-200 border-dashed flex justify-between items-baseline">
                      <span className="text-sm font-bold text-slate-900 font-sans">{isPart ? 'Amount Credited:' : 'Total Amount Paid:'}</span>
                      <span className="text-xl font-black text-emerald-700 font-sans">
                        ₱{paid.toFixed(2)}
                      </span>
                    </div>
                    {isPart && (
                      <div className="flex justify-between items-baseline pt-1">
                        <span className="text-xs font-bold text-rose-700 font-sans">Remaining Balance Due:</span>
                        <span className="text-sm font-black text-rose-700 font-sans">
                          ₱{rem.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="text-center space-y-0.5">
              <p className="text-sm font-mono tracking-[4px] text-slate-300">|||||| |||| ||||||</p>
              <p className="text-[9px] text-slate-400 font-mono font-semibold">TWD-OR-{receiptDetailModal.id}</p>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => window.print()}
                className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Print</span>
              </button>
              <button 
                onClick={() => setReceiptDetailModal(null)}
                className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* GLOBAL SIMULATED PAYMENT GATEWAY MODAL */}
      {consumerRecord && simulatedModalReading && (
        <SimulatedPaymentModal
          isOpen={isSimulatedModalOpen}
          reading={simulatedModalReading}
          consumerRecord={consumerRecord}
          initialMode={simulatedModalMode}
          onClose={() => {
            setIsSimulatedModalOpen(false);
            setSimulatedModalReading(null);
          }}
          onPaymentSuccess={(receipt) => {
            setPaymentConfirmationToast({
              period: receipt.billingPeriod,
              amount: receipt.amountPaid,
              remaining: receipt.remainingBalance,
              isPartial: receipt.isPartial,
              reference: receipt.orNumber,
              date: receipt.paymentDate
            });
            loadConsumerInfo(true);
          }}
          calculateCostOf={calculateCostOf}
        />
      )}

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-6 border-t border-slate-800 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs space-y-1">
          <p className="font-semibold text-slate-300">Tagoloan Water District • Official Consumer Portal</p>
          <p className="text-slate-500 text-[11px]">
            Municipal Hall Compound, Poblacion, Tagoloan, Misamis Oriental • Hotline: (088) 555-0145
          </p>
        </div>
      </footer>

      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  MapPin, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  Filter, 
  RefreshCw, 
  Wifi, 
  WifiOff, 
  LogOut, 
  QrCode, 
  Activity, 
  UploadCloud, 
  User, 
  Droplet, 
  Navigation, 
  ChevronRight, 
  X, 
  Check, 
  Clock, 
  FileText, 
  ShieldCheck, 
  Smartphone,
  Eye,
  SlidersHorizontal,
  Flame,
  ArrowRight,
  Sparkles,
  Zap,
  Info,
  Download
} from 'lucide-react';
import { User as UserType, Consumer, MeterReading, Barangay, MeterReader } from '../types';
import { mockDb } from '../mockDb';
import { useToast } from '../context/ToastContext';
import { useLoading } from '../context/LoadingContext';

interface MobileMeterReaderPortalProps {
  currentUser: UserType;
  onLogout: () => void;
}

export default function MobileMeterReaderPortal({ currentUser, onLogout }: MobileMeterReaderPortalProps) {
  const toast = useToast();
  const { showLoading, hideLoading } = useLoading();

  // Navigation Tabs in Mobile App
  const [activeTab, setActiveTab] = useState<'routes' | 'history' | 'profile'>('routes');

  // Data States
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [readerProfile, setReaderProfile] = useState<MeterReader | null>(null);

  // Filter & Search States
  const [selectedRoute, setSelectedRoute] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'flagged'>('all');

  // Active Reading Form Sheet / Modal
  const [selectedConsumer, setSelectedConsumer] = useState<Consumer | null>(null);
  const [inputCurrentReading, setInputCurrentReading] = useState('');
  const [inputNotes, setInputNotes] = useState('');
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isSimulatingOcr, setIsSimulatingOcr] = useState(false);
  const [capturedGps, setCapturedGps] = useState<string>('8.5392° N, 124.7548° E (Tagoloan Center)');
  const [quickRemark, setQuickRemark] = useState<string>('Normal inspection');

  // Offline Sync State
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<MeterReading[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Live Server Connectivity State
  const [isServerConnected, setIsServerConnected] = useState<boolean>(true);
  const [serverPingMs, setServerPingMs] = useState<number>(18);
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);
  const [currentApprovalStatus, setCurrentApprovalStatus] = useState<'active' | 'pending_approval' | 'inactive'>(
    currentUser.status === 'pending_approval' ? 'pending_approval' : 'active'
  );

  // QR / RFID Scanner Modal
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [scannerInput, setScannerInput] = useState('');

  // Initial Data Load
  const loadReaderData = () => {
    const allConsumers = mockDb.getConsumers();
    const allReadings = mockDb.getReadings();
    const allBarangays = mockDb.getBarangays();
    const allReaders = mockDb.getReaders();
    const allUsers = mockDb.getUsers();

    setConsumers(allConsumers);
    setReadings(allReadings);
    setBarangays(allBarangays);

    // Refresh user & reader status
    const matchedUser = allUsers.find(u => u.id === currentUser.id || u.email?.toLowerCase() === currentUser.email?.toLowerCase());
    if (matchedUser && matchedUser.status) {
      setCurrentApprovalStatus(matchedUser.status === 'active' ? 'active' : 'pending_approval');
    }

    const currentReader = allReaders.find(
      r => r.id === currentUser.readerId || r.email?.toLowerCase() === currentUser.email?.toLowerCase() || r.name.toLowerCase() === currentUser.name.toLowerCase()
    );

    if (currentReader) {
      setReaderProfile(currentReader);
      if (currentReader.employmentStatus) {
        setCurrentApprovalStatus(currentReader.employmentStatus === 'active' ? 'active' : 'pending_approval');
      }
      if (currentReader.assignedRoutes && currentReader.assignedRoutes.length > 0 && selectedRoute === 'All') {
        setSelectedRoute(currentReader.assignedRoutes[0]);
      }
    }
  };

  // Ping Backend Server to verify live connection
  const checkServerConnection = async () => {
    const start = performance.now();
    try {
      const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
      const elapsed = Math.round(performance.now() - start);
      if (res.ok) {
        setIsServerConnected(true);
        setServerPingMs(elapsed > 0 ? elapsed : 12);
      } else {
        setIsServerConnected(false);
      }
    } catch {
      setIsServerConnected(false);
    }
  };

  // Check approval status from API and localStorage
  const handleCheckApprovalStatus = async (silent: boolean = false) => {
    setIsCheckingStatus(true);
    if (!silent) {
      showLoading('Checking Account Authorization...', 'Verifying registration status with Tagoloan Water District central registry');
    }

    try {
      // 1. Check local mockDb
      const allUsers = mockDb.getUsers();
      const matchedUser = allUsers.find(u => u.id === currentUser.id || u.email?.toLowerCase() === currentUser.email?.toLowerCase());
      const allReaders = mockDb.getReaders();
      const matchedReader = allReaders.find(r => r.id === currentUser.readerId || r.email?.toLowerCase() === currentUser.email?.toLowerCase() || r.name.toLowerCase() === currentUser.name.toLowerCase());

      if ((matchedUser && matchedUser.status === 'active') || (matchedReader && matchedReader.employmentStatus === 'active')) {
        setCurrentApprovalStatus('active');
        currentUser.status = 'active';
        mockDb.setCurrentUser({ ...currentUser, status: 'active' });
        if (!silent) {
          toast.success('Account Approved!', 'Your meter reader account is authorized. Full mobile access unlocked.');
          hideLoading();
        }
        setIsCheckingStatus(false);
        return;
      }

      // 2. Check REST API /api/readers/check-status/:id
      const queryId = currentUser.employeeId || currentUser.id;
      const res = await fetch(`/api/readers/check-status/${encodeURIComponent(queryId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'active' || data.employmentStatus === 'active') {
          setCurrentApprovalStatus('active');
          currentUser.status = 'active';
          mockDb.setCurrentUser({ ...currentUser, status: 'active' });
          if (!silent) {
            toast.success('Account Approved!', 'Administrator has authorized your field terminal.');
            hideLoading();
          }
          setIsCheckingStatus(false);
          return;
        }
      }

      if (!silent) {
        hideLoading();
        toast.info('Status: Pending Approval', 'Your application is in the administrator queue. Please check back shortly.');
      }
    } catch {
      if (!silent) {
        hideLoading();
        toast.info('Status: Pending Approval', 'Your application is awaiting administrator verification.');
      }
    } finally {
      setIsCheckingStatus(false);
    }
  };

  // Pull route data from live server
  const handlePullRouteFromServer = async () => {
    showLoading('Pulling Route Data...', `Downloading assigned accounts for ${selectedRoute} from District Server.`);
    try {
      const zoneParam = selectedRoute === 'All' ? '' : selectedRoute;
      const res = await fetch(`/api/sync/pull?zone=${encodeURIComponent(zoneParam)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.consumers && Array.isArray(data.consumers) && data.consumers.length > 0) {
          // Merge with local consumers
          const existing = mockDb.getConsumers();
          const mergedMap = new Map<string, Consumer>();
          existing.forEach(c => mergedMap.set(c.accountNumber, c));
          data.consumers.forEach((c: Consumer) => mergedMap.set(c.accountNumber, c));
          const updatedList = Array.from(mergedMap.values());
          mockDb.saveConsumers(updatedList);
          setConsumers(updatedList);
          toast.success('Route Synced', `Successfully refreshed ${data.consumers.length} accounts from Central Server.`);
        } else {
          toast.info('Route Data Current', 'Local consumer assignments match central server.');
        }
      } else {
        toast.info('Local Data Ready', 'Operating with cached offline route records.');
      }
    } catch {
      toast.info('Offline Cache Active', 'Using locally stored consumer route records.');
    } finally {
      hideLoading();
    }
  };

  useEffect(() => {
    loadReaderData();
    checkServerConnection();

    // Periodic heartbeat every 20 seconds
    const interval = setInterval(() => {
      checkServerConnection();
      if (currentApprovalStatus === 'pending_approval') {
        handleCheckApprovalStatus(true);
      }
    }, 15000);

    // WebSocket real-time event listener
    let ws: WebSocket | null = null;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}`);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'READER_APPROVED_ACTIVE' || payload.type === 'staff:status_updated') {
            const rData = payload.payload;
            if (
              rData.readerId === currentUser.id ||
              rData.readerId === currentUser.employeeId ||
              rData.username?.toLowerCase() === currentUser.email?.toLowerCase()
            ) {
              setCurrentApprovalStatus('active');
              currentUser.status = 'active';
              mockDb.setCurrentUser({ ...currentUser, status: 'active' });
              toast.success('Account Approved!', 'Your account has been authorized by the supervisor.');
            }
          }
        } catch {
          // ignore non-json messages
        }
      };
    } catch {
      // ws fallback
    }

    return () => {
      clearInterval(interval);
      if (ws) ws.close();
    };
  }, [currentUser, currentApprovalStatus]);

  // Handle GPS location acquisition
  const acquireGpsLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(4);
          const lng = pos.coords.longitude.toFixed(4);
          setCapturedGps(`${lat}° N, ${lng}° E`);
        },
        () => {
          // Fallback location around Tagoloan
          setCapturedGps('8.5392° N, 124.7548° E (Tagoloan)');
        }
      );
    }
  };

  // Open Reading Sheet for a Consumer
  const handleOpenReadingSheet = (consumer: Consumer) => {
    setSelectedConsumer(consumer);
    setInputCurrentReading('');
    setInputNotes('');
    setCapturedPhotoUrl(null);
    setIsCameraActive(false);
    setQuickRemark('Normal inspection');
    acquireGpsLocation();
  };

  // Close Reading Sheet
  const handleCloseReadingSheet = () => {
    setSelectedConsumer(null);
    setInputCurrentReading('');
    setInputNotes('');
    setCapturedPhotoUrl(null);
    setIsCameraActive(false);
  };

  // Simulate Camera Snap with OCR Dial Recognition
  const handleSnapPhoto = () => {
    setIsSimulatingOcr(true);
    // Representative dial inspection photo
    const samplePhotos = [
      'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=600&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1584467735815-f778f274e296?q=80&w=600&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1590496793929-36417d3117de?q=80&w=600&auto=format&fit=crop'
    ];
    const pickedPhoto = samplePhotos[Math.floor(Math.random() * samplePhotos.length)];
    
    setTimeout(() => {
      setCapturedPhotoUrl(pickedPhoto);
      setIsCameraActive(false);
      setIsSimulatingOcr(false);

      // Auto-suggest reading value based on previous reading + realistic delta
      if (selectedConsumer) {
        const prev = getPreviousReading(selectedConsumer.accountNumber);
        const autoDetectedVal = prev + Math.floor(Math.random() * 12) + 8;
        if (!inputCurrentReading) {
          setInputCurrentReading(String(autoDetectedVal));
          toast.info('OCR Dial Detected', `Smart dial recognition read ${autoDetectedVal} m³ from photo.`);
        }
      }
    }, 900);
  };

  // Get previous reading for a consumer
  const getPreviousReading = (accountNumber: string): number => {
    const conReads = readings.filter(r => r.accountNumber === accountNumber);
    if (conReads.length > 0) {
      const sorted = [...conReads].sort((a, b) => new Date(b.readingDate).getTime() - new Date(a.readingDate).getTime());
      return sorted[0].currentReading;
    }
    return 0;
  };

  // Get latest reading status for today/current month
  const getConsumerReadingStatus = (accountNumber: string): { status: 'pending' | 'completed' | 'flagged'; reading?: MeterReading } => {
    const conReads = readings.filter(r => r.accountNumber === accountNumber);
    if (conReads.length === 0) return { status: 'pending' };

    const sorted = [...conReads].sort((a, b) => new Date(b.readingDate).getTime() - new Date(a.readingDate).getTime());
    const latest = sorted[0];

    if (latest.status === 'flagged_abnormal') {
      return { status: 'flagged', reading: latest };
    }
    return { status: 'completed', reading: latest };
  };

  // Submit Field Reading
  const handleSubmitReading = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConsumer) return;

    const currentVal = parseInt(inputCurrentReading, 10);
    if (isNaN(currentVal) || currentVal < 0) {
      toast.error('Invalid Reading', 'Please enter a valid whole number for accumulated cubic meters (m³).');
      return;
    }

    const previousReading = getPreviousReading(selectedConsumer.accountNumber);

    // Compute consumption with automatic 5-digit / 6-digit dial rollover handling
    let resolvedConsumption = 0;
    let isRollover = false;
    if (currentVal >= previousReading) {
      resolvedConsumption = currentVal - previousReading;
    } else {
      isRollover = true;
      const maxVal = previousReading > 99999 ? 999999 : 99999;
      resolvedConsumption = (maxVal - previousReading) + currentVal;
    }

    const isAbnormal = resolvedConsumption >= 50;

    const newReading: MeterReading = {
      id: `R-${selectedConsumer.accountNumber}-${Date.now().toString().slice(-4)}`,
      meterNumber: selectedConsumer.meterNumber || 'MT-GEN',
      accountNumber: selectedConsumer.accountNumber,
      consumerName: selectedConsumer.name,
      route: selectedConsumer.barangay || selectedRoute || 'Poblacion',
      previousReading,
      currentReading: currentVal,
      consumption: resolvedConsumption,
      readingDate: new Date().toISOString().split('T')[0],
      status: isAbnormal ? 'flagged_abnormal' : 'pending',
      meterReaderName: currentUser.name,
      imageUrl: capturedPhotoUrl || 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=400&auto=format&fit=crop',
      meterImageUrl: capturedPhotoUrl || 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?q=80&w=400&auto=format&fit=crop',
      notes: `${quickRemark}. ${inputNotes.trim()}${isRollover ? ' (METER ROLLOVERS REGISTERED: TRANSITION COMPUTED)' : ''}`,
      billingPeriod: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      classification: selectedConsumer.consumerType || 'Residential',
      gpsLocation: capturedGps
    };

    if (isOfflineMode) {
      // Save in offline queue
      const updatedQueue = [newReading, ...offlineQueue];
      setOfflineQueue(updatedQueue);
      toast.info('Saved Offline', `Reading for #${selectedConsumer.accountNumber} saved locally in offline queue.`);
      handleCloseReadingSheet();
      return;
    }

    // Save directly to main database
    const allReads = mockDb.getReadings();
    const updatedReads = [newReading, ...allReads];
    mockDb.saveReadings(updatedReads);
    setReadings(updatedReads);

    // Sync to Backend Express REST API in background
    try {
      fetch('/api/readings/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber: newReading.accountNumber,
          consumerName: newReading.consumerName,
          meterNumber: newReading.meterNumber,
          currentReading: newReading.currentReading,
          previousReading: newReading.previousReading,
          readerId: currentUser.employeeId || currentUser.id,
          readerName: currentUser.name,
          route: newReading.route,
          billingPeriod: newReading.billingPeriod,
          photoUrl: newReading.imageUrl,
          coordinates: { latitude: 8.5392, longitude: 124.7548 },
          notes: newReading.notes
        })
      }).catch(() => {
        // Handled silently in offline mode
      });
    } catch {
      // Handled silently in offline mode
    }

    // Update reader statistics
    const allReaders = mockDb.getReaders();
    const readerIdx = allReaders.findIndex(r => r.name === currentUser.name || r.email === currentUser.email);
    if (readerIdx >= 0) {
      allReaders[readerIdx].completedReadings = (allReaders[readerIdx].completedReadings || 0) + 1;
      mockDb.saveReaders(allReaders);
      setReaderProfile(allReaders[readerIdx]);
    }

    mockDb.addAuditLog(
      currentUser.id,
      currentUser.name,
      'meter_reader',
      'Submit Meter Reading',
      `Field reading recorded for Account #${selectedConsumer.accountNumber} (${selectedConsumer.name}). Current: ${currentVal} m³, Prev: ${previousReading} m³, Consumption: ${resolvedConsumption} m³ [GPS: ${capturedGps}].`
    );

    if (isAbnormal) {
      toast.warning('High Consumption Flagged', `Account #${selectedConsumer.accountNumber} recorded ${resolvedConsumption} m³. Flagged for admin verification.`);
    } else {
      toast.success('Reading Recorded', `Account #${selectedConsumer.accountNumber} recorded ${resolvedConsumption} m³ successfully!`);
    }

    handleCloseReadingSheet();
  };

  // Sync Offline Queue
  const handleSyncOfflineReadings = () => {
    if (offlineQueue.length === 0) {
      toast.info('Nothing to Sync', 'Offline queue is currently empty.');
      return;
    }

    setIsSyncing(true);
    showLoading('Synchronizing Field Readings...', `Uploading ${offlineQueue.length} queued readings to Tagoloan Water District database.`);

    // Batch send to Express API
    try {
      fetch('/api/readings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readings: offlineQueue })
      }).catch(() => {});
    } catch {}

    setTimeout(() => {
      const allReads = mockDb.getReadings();
      const combined = [...offlineQueue, ...allReads];
      mockDb.saveReadings(combined);
      setReadings(combined);

      mockDb.addAuditLog(
        currentUser.id,
        currentUser.name,
        'meter_reader',
        'Batch Offline Sync',
        `Synchronized ${offlineQueue.length} offline field readings to central database.`
      );

      toast.success('Sync Complete', `Successfully uploaded ${offlineQueue.length} field readings to Central District Database!`);
      setOfflineQueue([]);
      setIsSyncing(false);
      hideLoading();
    }, 1200);
  };

  // Handle QR / RFID search
  const handleScanCode = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scannerInput.trim().toUpperCase();
    if (!code) return;

    const matched = consumers.find(
      c => c.accountNumber.toUpperCase() === code || 
           c.rfidTag?.toUpperCase() === code ||
           c.meterNumber.toUpperCase() === code
    );

    if (matched) {
      setIsQrScannerOpen(false);
      setScannerInput('');
      handleOpenReadingSheet(matched);
      toast.success('Consumer Tag Identified', `Loaded account #${matched.accountNumber} (${matched.name})`);
    } else {
      toast.error('Tag Not Found', `No consumer found matching tag/code "${code}".`);
    }
  };

  // Filtered Consumers based on selected route and search query
  const filteredConsumers = consumers.filter(c => {
    const matchesRoute = selectedRoute === 'All' || c.barangay === selectedRoute;
    const matchesSearch = 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.accountNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.meterNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.address && c.address.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesRoute || !matchesSearch) return false;

    const statusInfo = getConsumerReadingStatus(c.accountNumber);
    if (statusFilter === 'pending') return statusInfo.status === 'pending';
    if (statusFilter === 'completed') return statusInfo.status === 'completed';
    if (statusFilter === 'flagged') return statusInfo.status === 'flagged';

    return true;
  });

  // Calculate Metrics
  const totalAssignedInRoute = consumers.filter(c => selectedRoute === 'All' || c.barangay === selectedRoute).length;
  const completedInRoute = consumers.filter(c => (selectedRoute === 'All' || c.barangay === selectedRoute) && getConsumerReadingStatus(c.accountNumber).status !== 'pending').length;
  const flaggedInRoute = consumers.filter(c => (selectedRoute === 'All' || c.barangay === selectedRoute) && getConsumerReadingStatus(c.accountNumber).status === 'flagged').length;
  const progressPercent = totalAssignedInRoute > 0 ? Math.round((completedInRoute / totalAssignedInRoute) * 100) : 0;

  // Render Pending Approval Screen if account is awaiting verification
  if (currentApprovalStatus === 'pending_approval') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-lg mx-auto shadow-2xl relative border-x border-slate-800 selection:bg-blue-600 selection:text-white p-6 justify-between">
        
        {/* Header */}
        <div className="space-y-6 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20 text-white font-black">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-base font-black text-white tracking-tight uppercase">Tagoloan Water</h1>
                <span className="bg-amber-500/20 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-500/30">
                  VERIFICATION QUEUE
                </span>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-2xl border border-slate-800 transition"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          {/* Pending Status Banner */}
          <div className="bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-900 border border-amber-800/40 rounded-3xl p-5 shadow-xl relative overflow-hidden space-y-4">
            <div className="flex items-start space-x-3">
              <div className="h-10 w-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-amber-400">
                <Clock className="h-5 w-5 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-black text-amber-200">Awaiting Supervisor Approval</h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Your field meter reader registration has been queued in the Tagoloan Central Registry. An administrator must verify and activate your profile before field inspection capabilities are unlocked.
                </p>
              </div>
            </div>

            {/* Applicant Summary Card */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center text-slate-400">
                <span>Field Officer:</span>
                <span className="font-bold text-white">{currentUser.name}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Employee Badge ID:</span>
                <span className="font-bold text-sky-400">{currentUser.employeeId || 'ID #MR-PENDING'}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Official Email:</span>
                <span className="text-slate-300 truncate max-w-[180px]">{currentUser.email}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Assigned Route:</span>
                <span className="font-bold text-emerald-400">{currentUser.assignedBarangay || 'Poblacion'}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Registration Status:</span>
                <span className="text-amber-400 font-bold flex items-center space-x-1">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                  <span>Pending Admin Review</span>
                </span>
              </div>
            </div>

            {/* Live Status Checker Button */}
            <button
              onClick={() => handleCheckApprovalStatus(false)}
              disabled={isCheckingStatus}
              className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider rounded-2xl shadow-lg shadow-amber-500/20 transition flex items-center justify-center space-x-2"
            >
              <RefreshCw className={`h-4 w-4 ${isCheckingStatus ? 'animate-spin' : ''}`} />
              <span>{isCheckingStatus ? 'Verifying with Central Office...' : 'Check Approval Status Now'}</span>
            </button>
          </div>

          {/* Quick Notice */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex items-start space-x-3 text-xs text-slate-400">
            <Info className="h-4 w-4 text-sky-400 flex-shrink-0 mt-0.5" />
            <p>
              Once approved in the Admin Web Portal, this mobile terminal will automatically transition to the meter scanning interface.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-6 border-t border-slate-900 text-center text-slate-500 text-[11px] space-y-1">
          <p className="font-bold">Tagoloan Water District • Field Mobility v4.5</p>
          <p>Tagoloan Municipal Compound, Misamis Oriental</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-lg mx-auto shadow-2xl relative border-x border-slate-800 selection:bg-blue-600 selection:text-white pb-24">
      
      {/* 1. TOP MOBILE HEADER & STATUS BAR */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-blue-700 to-sky-500 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white font-black text-sm">
            <Droplet className="h-5 w-5 fill-current" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <h1 className="text-sm font-black text-white tracking-tight uppercase">Tagoloan Water</h1>
              <span className="bg-blue-500/20 text-blue-400 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-blue-500/30">
                FIELD APP
              </span>
            </div>
            <p className="text-[11px] font-bold text-slate-400 flex items-center space-x-1">
              <span>{currentUser.name}</span>
              <span className="text-slate-600">•</span>
              <span className="text-sky-400 font-mono">{currentUser.employeeId || 'ID #MR-FIELD'}</span>
            </p>
          </div>
        </div>

        {/* Sync & Connectivity Controls */}
        <div className="flex items-center space-x-2">
          {/* Live Ping & Mode Badge */}
          <div 
            className={`px-2 py-1 rounded-xl text-[10px] font-mono font-bold flex items-center space-x-1 border ${
              isOfflineMode 
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                : isServerConnected 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}
            title={isOfflineMode ? "Offline Mode" : `Live Connected (${serverPingMs}ms)`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isOfflineMode ? 'bg-amber-400' : isServerConnected ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'}`} />
            <span>{isOfflineMode ? 'Offline' : isServerConnected ? `${serverPingMs}ms` : 'No Sync'}</span>
          </div>

          <button
            onClick={() => {
              setIsOfflineMode(!isOfflineMode);
              toast.info(
                !isOfflineMode ? 'Offline Mode Activated' : 'Online Sync Mode Restored',
                !isOfflineMode ? 'Readings will be saved locally in offline queue.' : 'Direct cloud synchronization active.'
              );
            }}
            className={`p-2 rounded-xl text-xs font-bold transition flex items-center space-x-1 ${
              isOfflineMode 
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' 
                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            }`}
            title={isOfflineMode ? "Running in Offline Mode" : "Online Mode"}
          >
            {isOfflineMode ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
          </button>

          <button
            onClick={() => setIsQrScannerOpen(true)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 transition"
            title="Scan Meter RFID/Barcode"
          >
            <QrCode className="h-4 w-4 text-sky-400" />
          </button>

          <button
            onClick={onLogout}
            className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/20 transition"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* OFFLINE QUEUE FLOATING BANNER (if items in queue) */}
      {offlineQueue.length > 0 && (
        <div className="bg-gradient-to-r from-amber-900/40 to-amber-950/60 border-b border-amber-800/50 px-4 py-2.5 flex items-center justify-between animate-fade-in">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
            <p className="text-xs font-bold text-amber-200">
              {offlineQueue.length} Reading{offlineQueue.length > 1 ? 's' : ''} Stored Offline
            </p>
          </div>
          <button
            onClick={handleSyncOfflineReadings}
            disabled={isSyncing}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-lg transition flex items-center space-x-1.5 shadow-md"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span>Sync to Central</span>
          </button>
        </div>
      )}

      {/* 2. MAIN BODY CONTENT TABS */}
      <main className="p-4 space-y-4 flex-1">
        {activeTab === 'routes' && (
          <div className="space-y-4 animate-fade-in">
            
            {/* ROUTE PROGRESS CARD */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 border border-slate-800 rounded-3xl p-4 shadow-xl relative overflow-hidden">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <span className="text-[10px] font-black tracking-wider text-blue-400 uppercase">Assigned Route Inspection</span>
                  <div className="flex items-center space-x-2 mt-0.5">
                    <MapPin className="h-4 w-4 text-sky-400" />
                    <select
                      value={selectedRoute}
                      onChange={(e) => setSelectedRoute(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-xs font-bold text-white rounded-xl py-1 px-2.5 outline-none"
                    >
                      <option value="All">All Barangays ({consumers.length})</option>
                      {barangays.map(b => (
                        <option key={b.id} value={b.name}>
                          {b.name} ({consumers.filter(c => c.barangay === b.name).length})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handlePullRouteFromServer}
                      className="p-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-sky-400 rounded-xl border border-blue-500/30 transition"
                      title="Pull latest route records from Central Server"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-2xl font-black text-white font-mono">{progressPercent}%</span>
                  <p className="text-[10px] font-bold text-slate-400">{completedInRoute}/{totalAssignedInRoute} Done</p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-700/50">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-sky-400 h-full rounded-full transition-all duration-500 shadow-lg shadow-blue-500/50"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800/80 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">Pending</span>
                  <span className="text-xs font-mono font-black text-amber-400">{totalAssignedInRoute - completedInRoute}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">Completed</span>
                  <span className="text-xs font-mono font-black text-emerald-400">{completedInRoute}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">Flagged / Leak</span>
                  <span className="text-xs font-mono font-black text-rose-400">{flaggedInRoute}</span>
                </div>
              </div>
            </div>

            {/* SEARCH & STATUS FILTER */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="h-4 w-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search consumer, account #, or meter..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-2.5 pl-10 pr-4 text-xs text-white placeholder:text-slate-500 font-medium outline-none focus:border-blue-500"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Status Chips */}
              <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
                    statusFilter === 'all' 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  All ({filteredConsumers.length})
                </button>
                <button
                  onClick={() => setStatusFilter('pending')}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
                    statusFilter === 'pending' 
                      ? 'bg-amber-600 text-white shadow-md' 
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  Pending ({consumers.filter(c => (selectedRoute === 'All' || c.barangay === selectedRoute) && getConsumerReadingStatus(c.accountNumber).status === 'pending').length})
                </button>
                <button
                  onClick={() => setStatusFilter('completed')}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
                    statusFilter === 'completed' 
                      ? 'bg-emerald-600 text-white shadow-md' 
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  Completed ({completedInRoute})
                </button>
                <button
                  onClick={() => setStatusFilter('flagged')}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
                    statusFilter === 'flagged' 
                      ? 'bg-rose-600 text-white shadow-md' 
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  Flagged ({flaggedInRoute})
                </button>
              </div>
            </div>

            {/* CONSUMER ROUTE CARDS LIST */}
            <div className="space-y-2.5">
              {filteredConsumers.length === 0 ? (
                <div className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 text-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                  </div>
                  <h3 className="text-sm font-bold text-white">No consumers found</h3>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Try adjusting your search query or route filters to inspect other service zones.
                  </p>
                </div>
              ) : (
                filteredConsumers.map((c) => {
                  const prevReading = getPreviousReading(c.accountNumber);
                  const statusInfo = getConsumerReadingStatus(c.accountNumber);

                  return (
                    <div
                      key={c.accountNumber}
                      onClick={() => handleOpenReadingSheet(c)}
                      className="bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-2xl p-3.5 transition-all shadow-sm cursor-pointer active:scale-[0.99] flex flex-col space-y-2.5"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-0.5">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-black text-white">{c.name}</span>
                            <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-950/60 px-1.5 py-0.2 rounded border border-blue-800/40">
                              #{c.accountNumber}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 flex items-center space-x-1">
                            <MapPin className="h-3 w-3 text-slate-500" />
                            <span>{c.sitioZone || 'Sitio Central'}, {c.barangay || 'Poblacion'}</span>
                          </p>
                        </div>

                        {/* Status Badge */}
                        {statusInfo.status === 'pending' && (
                          <span className="bg-amber-500/10 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/20 flex items-center space-x-1">
                            <Clock className="h-3 w-3" />
                            <span>Pending</span>
                          </span>
                        )}
                        {statusInfo.status === 'completed' && (
                          <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center space-x-1">
                            <Check className="h-3 w-3" />
                            <span>Read</span>
                          </span>
                        )}
                        {statusInfo.status === 'flagged' && (
                          <span className="bg-rose-500/10 text-rose-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-500/20 flex items-center space-x-1">
                            <AlertTriangle className="h-3 w-3" />
                            <span>Flagged</span>
                          </span>
                        )}
                      </div>

                      {/* Footer Details */}
                      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/70 text-slate-400">
                        <div className="flex items-center space-x-3">
                          <span>Meter: <strong className="text-slate-200 font-mono">{c.meterNumber || 'MT-100'}</strong></span>
                          <span>Prev: <strong className="text-sky-300 font-mono">{prevReading} m³</strong></span>
                        </div>

                        <div className="flex items-center text-blue-400 font-bold space-x-0.5">
                          <span>{statusInfo.status === 'pending' ? 'Take Reading' : 'Update'}</span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 3. HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="space-y-4 animate-fade-in">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-sm font-black text-white uppercase tracking-tight">Today's Inspection History</h2>
              <p className="text-xs text-slate-400">Timeline of readings conducted during your active field shift.</p>
            </div>

            <div className="space-y-3">
              {readings.filter(r => r.meterReaderName === currentUser.name).length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center space-y-2">
                  <FileText className="h-8 w-8 text-slate-600 mx-auto" />
                  <p className="text-xs font-bold text-slate-300">No field readings recorded yet today</p>
                  <p className="text-[11px] text-slate-500">Pick any consumer from the Routes tab to start recording.</p>
                </div>
              ) : (
                readings
                  .filter(r => r.meterReaderName === currentUser.name)
                  .map(r => (
                    <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-white">{r.consumerName}</h4>
                          <p className="text-[10px] text-slate-400 font-mono">Account #{r.accountNumber} • {r.route}</p>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
                          {r.readingDate}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 bg-slate-950 p-2.5 rounded-xl text-center text-xs">
                        <div>
                          <span className="text-[9px] text-slate-500 block">Previous</span>
                          <span className="font-mono font-bold text-slate-300">{r.previousReading} m³</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 block">Current</span>
                          <span className="font-mono font-bold text-sky-400">{r.currentReading} m³</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 block">Consumption</span>
                          <span className="font-mono font-black text-emerald-400">{r.consumption} m³</span>
                        </div>
                      </div>

                      {r.notes && (
                        <p className="text-[11px] text-slate-400 italic bg-slate-850 p-2 rounded-lg border border-slate-800">
                          "{r.notes}"
                        </p>
                      )}
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {/* 4. PROFILE TAB */}
        {activeTab === 'profile' && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-center space-y-3">
              <div className="h-16 w-16 rounded-full bg-gradient-to-tr from-blue-600 to-sky-400 flex items-center justify-center mx-auto text-white font-black text-xl shadow-lg shadow-blue-500/20">
                {currentUser.name.charAt(0)}
              </div>
              <div>
                <h3 className="text-base font-black text-white">{currentUser.name}</h3>
                <p className="text-xs font-mono text-sky-400">{currentUser.employeeId || 'ID #MR-FIELD'}</p>
                <span className="inline-block mt-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-emerald-500/30 uppercase">
                  Active Authorized Field Reader
                </span>
              </div>
            </div>

            {/* Field Stats */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Field Performance</h4>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold block">Assigned Routes</span>
                  <span className="text-sm font-black text-white">{barangays.length} Barangays</span>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold block">Completed Reads</span>
                  <span className="text-sm font-black text-emerald-400">{readings.filter(r => r.meterReaderName === currentUser.name).length}</span>
                </div>
              </div>
            </div>

            {/* Official Credentials Notice */}
            <div className="bg-blue-950/30 border border-blue-800/40 rounded-2xl p-4 text-xs space-y-2 text-blue-200">
              <div className="flex items-center space-x-2 font-bold text-blue-300">
                <ShieldCheck className="h-4 w-4" />
                <span>Admin Verified Staff Account</span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-300">
                Your mobile meter reader credentials have been approved by the Tagoloan Water District Administrative Office. You have full access to offline route management, dial photo capture, GPS tagging, and billing synchronizations.
              </p>
            </div>

            <button
              onClick={onLogout}
              className="w-full py-3 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-2"
            >
              <LogOut className="h-4 w-4" />
              <span>Log Out of Field Session</span>
            </button>
          </div>
        )}
      </main>

      {/* 5. BOTTOM NAVIGATION BAR */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-6 py-2 flex items-center justify-around z-40">
        <button
          onClick={() => setActiveTab('routes')}
          className={`flex flex-col items-center space-y-1 text-[11px] font-bold transition ${
            activeTab === 'routes' ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Navigation className="h-5 w-5" />
          <span>Routes</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center space-y-1 text-[11px] font-bold transition ${
            activeTab === 'history' ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Activity className="h-5 w-5" />
          <span>History</span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center space-y-1 text-[11px] font-bold transition ${
            activeTab === 'profile' ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <User className="h-5 w-5" />
          <span>Staff ID</span>
        </button>
      </nav>

      {/* 6. FULL-ACCESS READING & DIAL INSPECTION MODAL */}
      {selectedConsumer && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col">
            
            {/* Modal Header */}
            <div className="sticky top-0 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 p-4 flex items-center justify-between z-10">
              <div className="space-y-0.5">
                <span className="text-[10px] font-black text-blue-400 uppercase tracking-wider">Field Meter Reading Entry</span>
                <h3 className="text-sm font-black text-white">{selectedConsumer.name}</h3>
                <p className="text-[11px] text-slate-400 font-mono">Account #{selectedConsumer.accountNumber} • Meter #{selectedConsumer.meterNumber || 'MT-100'}</p>
              </div>
              <button
                onClick={handleCloseReadingSheet}
                className="p-2 text-slate-400 hover:text-white rounded-full bg-slate-800 hover:bg-slate-700 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitReading} className="p-4 space-y-4">
              
              {/* Previous Reading Info */}
              <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex justify-between items-center text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">Previous Registered Index</span>
                  <span className="text-sm font-mono font-black text-slate-200">
                    {getPreviousReading(selectedConsumer.accountNumber)} m³
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold block">Classification</span>
                  <span className="text-xs font-bold text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/40">
                    {selectedConsumer.consumerType || 'Residential'}
                  </span>
                </div>
              </div>

              {/* LIVE CAMERA & DIAL OCR SECTION */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-300 uppercase">
                  Meter Dial Photo Proof
                </label>

                {capturedPhotoUrl ? (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-700 shadow-md">
                    <img 
                      src={capturedPhotoUrl} 
                      alt="Captured Meter Dial"
                      className="w-full h-44 object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end p-3 justify-between">
                      <span className="text-[10px] font-black text-emerald-400 bg-emerald-950/80 px-2 py-1 rounded-lg border border-emerald-500/30 flex items-center space-x-1">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Dial Photo Verified</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setCapturedPhotoUrl(null)}
                        className="px-2.5 py-1 bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg transition"
                      >
                        Retake
                      </button>
                    </div>
                  </div>
                ) : isCameraActive ? (
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-center space-y-3 relative overflow-hidden">
                    <div className="h-44 bg-slate-900 rounded-xl border border-dashed border-sky-500/50 flex flex-col items-center justify-center p-4 relative">
                      {/* Bounding box guide overlay */}
                      <div className="w-36 h-20 border-2 border-sky-400/80 rounded-lg flex items-center justify-center relative">
                        <span className="text-[10px] font-mono text-sky-400 bg-slate-950/80 px-1 py-0.5 rounded absolute -top-3">
                          ALIGN DIAL
                        </span>
                        <div className="w-full h-0.5 bg-sky-400/30 animate-pulse" />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2">Hold phone steady over meter index dial</p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={handleSnapPhoto}
                        disabled={isSimulatingOcr}
                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/30"
                      >
                        <Camera className="h-4 w-4" />
                        <span>{isSimulatingOcr ? 'Analyzing Dial...' : 'Snap & Auto-Read'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCameraActive(false)}
                        className="px-4 py-3 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsCameraActive(true)}
                    className="w-full py-3.5 bg-slate-800/80 hover:bg-slate-750 border border-dashed border-slate-700 hover:border-blue-500 rounded-2xl text-xs font-bold text-slate-300 transition flex items-center justify-center space-x-2"
                  >
                    <Camera className="h-4 w-4 text-sky-400" />
                    <span>Open Camera to Capture Dial & Read</span>
                  </button>
                )}
              </div>

              {/* CURRENT READING INPUT */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-300 uppercase">
                  Current Accumulated Index (Whole m³)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="e.g. 158"
                    value={inputCurrentReading}
                    onChange={(e) => setInputCurrentReading(e.target.value)}
                    required
                    className="w-full bg-slate-950 border-2 border-slate-700 focus:border-blue-500 rounded-2xl py-3 px-4 text-lg font-mono font-black text-white outline-none"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                    Cubic Meters (m³)
                  </span>
                </div>
              </div>

              {/* REAL-TIME COMPUTATION PREVIEW */}
              {inputCurrentReading && !isNaN(parseInt(inputCurrentReading, 10)) && (
                <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-bold">Computed Net Consumption:</span>
                    <span className="font-mono font-black text-base text-emerald-400">
                      {Math.max(0, parseInt(inputCurrentReading, 10) - getPreviousReading(selectedConsumer.accountNumber))} m³
                    </span>
                  </div>

                  {parseInt(inputCurrentReading, 10) - getPreviousReading(selectedConsumer.accountNumber) >= 50 && (
                    <div className="bg-rose-950/40 border border-rose-800/60 p-2.5 rounded-xl text-rose-300 text-[11px] font-bold flex items-center space-x-2">
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                      <span>High consumption detected ({parseInt(inputCurrentReading, 10) - getPreviousReading(selectedConsumer.accountNumber)} m³). Will be flagged for supervisor verification.</span>
                    </div>
                  )}
                </div>
              )}

              {/* GPS GEOLOCATION TAG STAMP */}
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-[11px]">
                <div className="flex items-center space-x-1.5 text-slate-400">
                  <Navigation className="h-3.5 w-3.5 text-sky-400" />
                  <span>GPS Coordinate:</span>
                  <span className="font-mono text-slate-200">{capturedGps}</span>
                </div>
                <button
                  type="button"
                  onClick={acquireGpsLocation}
                  className="text-[10px] text-sky-400 hover:text-sky-300 font-bold underline"
                >
                  Refresh GPS
                </button>
              </div>

              {/* FIELD REMARKS & NOTES */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-300 uppercase">
                  Field Remarks & Condition
                </label>
                
                {/* Quick Chips */}
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {['Normal inspection', 'Dial foggy', 'Gate locked', 'Leak observed', 'Meter obscured'].map((chip) => (
                    <button
                      type="button"
                      key={chip}
                      onClick={() => setQuickRemark(chip)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition ${
                        quickRemark === chip 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <textarea
                  placeholder="Optional detailed remarks regarding site condition..."
                  value={inputNotes}
                  onChange={(e) => setInputNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 placeholder:text-slate-500 font-medium outline-none focus:border-blue-500"
                />
              </div>

              {/* SUBMIT BUTTON */}
              <button
                type="submit"
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 text-white text-xs font-black rounded-2xl shadow-xl shadow-blue-600/30 transition flex items-center justify-center space-x-2"
              >
                <Check className="h-4 w-4" />
                <span>Submit & Complete Reading</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 7. QR / RFID CODE SCANNER MODAL */}
      {isQrScannerOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="h-16 w-16 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center mx-auto text-sky-400">
              <QrCode className="h-8 w-8" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-black text-white uppercase">Scan RFID / Meter Tag</h3>
              <p className="text-xs text-slate-400">Scan or type the consumer's official RFID tag or Account Number.</p>
            </div>

            <form onSubmit={handleScanCode} className="space-y-3">
              <input
                type="text"
                placeholder="e.g. RFID-1001 or 1001"
                value={scannerInput}
                onChange={(e) => setScannerInput(e.target.value)}
                autoFocus
                className="w-full bg-slate-950 border-2 border-slate-700 focus:border-blue-500 rounded-xl py-3 px-4 text-center font-mono font-black text-sm text-white outline-none"
              />

              <div className="flex items-center space-x-2">
                <button
                  type="submit"
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl shadow-lg transition"
                >
                  Locate Account
                </button>
                <button
                  type="button"
                  onClick={() => setIsQrScannerOpen(false)}
                  className="px-4 py-3 bg-slate-800 text-slate-400 hover:text-white text-xs font-bold rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

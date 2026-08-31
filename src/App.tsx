/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import LandingPage from './components/LandingPage';
import UnifiedLogin from './components/UnifiedLogin';
import RegistrationPage from './components/RegistrationPage';
import AdminPortal from './components/AdminPortal';
import ConsumerPortal from './components/ConsumerPortal';
import { mockDb } from './mockDb';
import { User } from './types';
import { LoadingProvider, useLoading } from './context/LoadingContext';
import { ToastProvider, useToast } from './context/ToastContext';

const pageMotionVariants = {
  initial: { opacity: 0, y: 10, scale: 0.996 },
  animate: { 
    opacity: 1, 
    y: 0, 
    scale: 1, 
    transition: { 
      duration: 0.28, 
      ease: [0.22, 1, 0.36, 1] 
    } 
  },
  exit: { 
    opacity: 0, 
    y: -8, 
    scale: 0.996, 
    transition: { 
      duration: 0.2, 
      ease: [0.22, 1, 0.36, 1] 
    } 
  },
};

function AppContent() {
  const [isAppInitializing, setIsAppInitializing] = useState(true);
  const [currentPage, setCurrentPage] = useState<'landing' | 'login' | 'admin' | 'consumer'>('landing');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const { showLoading, hideLoading } = useLoading();
  const toast = useToast();

  // Monitor session persistence & announcements
  useEffect(() => {
    // Initial fetch of session and data
    const initializeApp = async () => {
      try {
        const activeUser = mockDb.getCurrentUser();
        if (activeUser) {
          if (activeUser.email && activeUser.email.toLowerCase() === 'admin@tagoloanwater.gov.ph') {
            activeUser.name = 'Admin';
          }
          setCurrentUser(activeUser);
          if (activeUser.role === 'admin') {
            setCurrentPage('admin');
          } else {
            setCurrentPage('consumer');
          }
        } else {
          setCurrentPage('landing');
        }

        // Load master list of announcements
        setAnnouncements(mockDb.getAnnouncements());
      } catch (err) {
        console.error("Initialization error:", err);
      } finally {
        // Brief loading indicator to ensure data readiness across the system
        setTimeout(() => {
          setIsAppInitializing(false);
        }, 400);
      }
    };

    initializeApp();

    // Listen for database updates (e.g. admin issuing IDs or updating status)
    const handleDbSync = () => {
      const liveCurrent = mockDb.getCurrentUser();
      if (liveCurrent) {
        setCurrentUser(prev => {
          if (!prev) return liveCurrent;
          if (prev.id === liveCurrent.id && (prev.linkedAccountNumber !== liveCurrent.linkedAccountNumber || prev.status !== liveCurrent.status)) {
            return { ...prev, ...liveCurrent };
          }
          return prev;
        });
      }
    };

    window.addEventListener('twd_database_updated', handleDbSync);
    window.addEventListener('storage', handleDbSync);

    return () => {
      window.removeEventListener('twd_database_updated', handleDbSync);
      window.removeEventListener('storage', handleDbSync);
    };
  }, []);

  // Update states on login
  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    if (user.role === 'admin') {
      setCurrentPage('admin');
    } else {
      setCurrentPage('consumer');
    }
    // Refresh announcements
    setAnnouncements(mockDb.getAnnouncements());
    toast.success('Signed In Successfully', `Welcome back, ${user.name}!`);
  };

  // Logout routine with visual loading feedback
  const handleLogout = () => {
    showLoading('Signing out of session...', 'Safely terminating portal session and securing records');
    setTimeout(() => {
      if (currentUser) {
        mockDb.addAuditLog(
          currentUser.id,
          currentUser.name,
          currentUser.role,
          'User Logout',
          `Closed unified portal session for ${currentUser.name} voluntarily.`
        );
      }
      mockDb.setCurrentUser(null);
      setCurrentUser(null);
      setCurrentPage('landing');
      hideLoading();
      toast.info('Session Terminated', 'You have been safely signed out of Tagoloan Water District portal.');
    }, 700);
  };

  // Navigations
  const handleNavigate = (page: 'login' | 'register') => {
    if (page === 'register') {
      setIsRegisterOpen(true);
    } else {
      setCurrentPage('login');
    }
  };

  const handleBackToHome = () => {
    setCurrentPage('landing');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-605 selection:text-white relative overflow-x-hidden">
      {isAppInitializing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md animate-fade-in">
          <div className="flex flex-col items-center justify-center text-center p-8 max-w-sm mx-auto">
            <div className="relative mb-5 flex items-center justify-center">
              <div className="absolute -inset-4 rounded-full bg-blue-500/25 blur-xl animate-pulse"></div>
              <div className="absolute -inset-1.5 rounded-3xl bg-linear-to-r from-blue-600 via-cyan-400 to-indigo-600 opacity-80 blur-sm animate-spin-slow"></div>
              <div className="relative h-20 w-20 rounded-2xl bg-slate-900 border-2 border-white/30 shadow-2xl flex items-center justify-center backdrop-blur-md overflow-hidden p-0.5">
                <img 
                  src="https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg"
                  alt="Tagoloan Water District"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
                  }}
                  className="w-full h-full object-cover rounded-xl animate-pulse"
                />
              </div>
            </div>
            <h3 className="text-base font-black text-slate-100 tracking-tight mb-1 animate-pulse">
              Connecting to Tagoloan Water District
            </h3>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed font-medium">
              Initializing municipal portal environment and fetching active session data...
            </p>
            <div className="w-44 h-1.5 bg-slate-800 rounded-full mt-4 overflow-hidden border border-slate-700/60">
              <div className="h-full bg-linear-to-r from-blue-600 via-cyan-400 to-blue-600 rounded-full animate-indeterminate"></div>
            </div>
          </div>
        </div>
      ) : (
        <AnimatePresence mode="wait">
        {isRegisterOpen ? (
          <motion.div
            key="register"
            variants={pageMotionVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full min-h-screen"
          >
            <RegistrationPage 
              onBackToHome={() => setIsRegisterOpen(false)}
              onNavigateToLogin={() => {
                setIsRegisterOpen(false);
                setCurrentPage('login');
              }}
            />
          </motion.div>
        ) : currentPage === 'landing' ? (
          <motion.div
            key="landing"
            variants={pageMotionVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full min-h-screen"
          >
            <LandingPage 
              announcements={announcements} 
              onNavigate={handleNavigate} 
            />
          </motion.div>
        ) : currentPage === 'login' ? (
          <motion.div
            key="login"
            variants={pageMotionVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full min-h-screen"
          >
            <UnifiedLogin 
              onLoginSuccess={handleLoginSuccess}
              onBackToHome={handleBackToHome}
              onNavigateToRegister={() => setIsRegisterOpen(true)}
            />
          </motion.div>
        ) : currentPage === 'admin' && currentUser ? (
          <motion.div
            key={`admin-${currentUser.id}`}
            variants={pageMotionVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full min-h-screen"
          >
            <AdminPortal 
              currentUser={currentUser} 
              onLogout={handleLogout} 
            />
          </motion.div>
        ) : currentPage === 'consumer' && currentUser ? (
          <motion.div
            key={`consumer-${currentUser.id}`}
            variants={pageMotionVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full min-h-screen"
          >
            <ConsumerPortal 
              currentUser={currentUser} 
              onLogout={handleLogout} 
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <LoadingProvider>
        <AppContent />
      </LoadingProvider>
    </ToastProvider>
  );
}


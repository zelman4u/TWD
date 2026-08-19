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
  const [currentPage, setCurrentPage] = useState<'landing' | 'login' | 'admin' | 'consumer'>('landing');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const { showLoading, hideLoading } = useLoading();
  const toast = useToast();

  // Monitor session persistence & announcements
  useEffect(() => {
    // Check if user is logged in
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


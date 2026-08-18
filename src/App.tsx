/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import UnifiedLogin from './components/UnifiedLogin';
import RegistrationPage from './components/RegistrationPage';
import AdminPortal from './components/AdminPortal';
import ConsumerPortal from './components/ConsumerPortal';
import { mockDb } from './mockDb';
import { User } from './types';
import { LoadingProvider, useLoading } from './context/LoadingContext';

function AppContent() {
  const [currentPage, setCurrentPage] = useState<'landing' | 'login' | 'admin' | 'consumer'>('landing');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const { showLoading, hideLoading } = useLoading();

  // Monitor session persistence & announcements
  useEffect(() => {
    // Check if user is logged in
    const activeUser = mockDb.getCurrentUser();
    if (activeUser) {
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
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-605 selection:text-white">
      {currentPage === 'landing' && (
        <LandingPage 
          announcements={announcements} 
          onNavigate={handleNavigate} 
        />
      )}

      {currentPage === 'login' && (
        <UnifiedLogin 
          onLoginSuccess={handleLoginSuccess}
          onBackToHome={handleBackToHome}
          onNavigateToRegister={() => setIsRegisterOpen(true)}
        />
      )}

      {isRegisterOpen && (
        <RegistrationPage 
          onBackToHome={() => setIsRegisterOpen(false)}
          onNavigateToLogin={() => {
            setIsRegisterOpen(false);
            setCurrentPage('login');
          }}
        />
      )}

      {currentPage === 'admin' && currentUser && (
        <AdminPortal 
          currentUser={currentUser} 
          onLogout={handleLogout} 
        />
      )}

      {currentPage === 'consumer' && currentUser && (
        <ConsumerPortal 
          currentUser={currentUser} 
          onLogout={handleLogout} 
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <LoadingProvider>
      <AppContent />
    </LoadingProvider>
  );
}


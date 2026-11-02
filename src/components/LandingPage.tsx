/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Droplet, 
  MapPin, 
  Phone, 
  Mail, 
  Clock, 
  BookOpen, 
  FileText, 
  CheckCircle, 
  ChevronRight, 
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Calculator,
  Compass,
  Building,
  Calendar,
  Waves,
  Menu,
  X
} from 'lucide-react';
import { Announcement } from '../types';
import {
  calculateWaterTariff,
  calculateFranchiseTax,
  calculateLatePenalty,
  getEffectiveRatePerM3,
} from '../utils/tariffCalculator';
import { sanitizeAnnouncements } from '../utils/announcementSanitizer';
import { DistrictProfileSection } from './common/DistrictProfileSection';
import { useToast } from '../context/ToastContext';

interface LandingPageProps {
  announcements: Announcement[];
  onNavigate: (page: 'login' | 'register') => void;
}

export default function LandingPage({ announcements, onNavigate }: LandingPageProps) {
  const toast = useToast();
  // Mobile Navigation Menu State
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Frequently Asked Questions State
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  
  // Local Bill Calculator State
  const [calcType, setCalcType] = useState<'Residential' | 'Commercial'>('Residential');
  const [calcUsage, setCalcUsage] = useState<number>(15);
  const [calculatedBill, setCalculatedBill] = useState<{
    ratePerM3: number;
    basicCharge: number;
    franchiseTax: number;
    totalBeforeDue: number;
    latePenalty: number;
    amountAfterDue: number;
  } | null>(null);

  // Customer Service Contact Form State
  const [contactName, setContactName] = useState('');
  const [contactAccount, setContactAccount] = useState('');
  const [contactMsg, setContactMsg] = useState('');
  const [contactSent, setContactSent] = useState(false);

  const calculateWaterBill = (usage: number, type: 'Residential' | 'Commercial') => {
    const ratePerM3 = getEffectiveRatePerM3(type);
    const basicCharge = calculateWaterTariff(usage, type);
    const franchiseTax = calculateFranchiseTax(basicCharge);
    const totalBeforeDue = Math.round((basicCharge + franchiseTax) * 100) / 100;
    const latePenalty = calculateLatePenalty(basicCharge);
    const amountAfterDue = Math.round((totalBeforeDue + latePenalty) * 100) / 100;
    return {
      ratePerM3,
      basicCharge,
      franchiseTax,
      totalBeforeDue,
      latePenalty,
      amountAfterDue,
    };
  };

  const handleCalculate = (e: React.FormEvent) => {
    e.preventDefault();
    const result = calculateWaterBill(calcUsage, calcType);
    setCalculatedBill(result);
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName || !contactMsg) return;
    setContactSent(true);
    setTimeout(() => {
      setContactName('');
      setContactAccount('');
      setContactMsg('');
      setContactSent(false);
      toast.success(
        'Inquiry Submitted',
        'Thank you! Your message has been submitted to Tagoloan Water District Support. We will review your inquiry shortly.'
      );
    }, 1200);
  };

  const faqs = [
    {
      q: "How do I register my account online?",
      a: "Consumers can click the 'Register Account' button. You must provide your official account number and matching consumer name exactly as it appears on your physical paper bill. Once verified, you will set up password credentials for logging in."
    },
    {
      q: "When is the Tagoloan Water District meter reading period?",
      a: "Meter readings are gathered by authorized field personnel between the 1st and 5th day of each calendar month. The newly synchronised readings will reflect immediately in both your personal consumer account history and the district database."
    },
    {
      q: "What should I do if my water connection pressure drops or there is a leak?",
      a: "Please report water leaks, unusual pressure drops, or damaged mechanical water meters immediately using our customer inquiry portal or reach out to the TWD Engineering Maintenance Team on (088) 555-0145. Prompt reports help prevent unwarranted high consumption charges."
    },
    {
      q: "How are the water tariff calculations calculated?",
      a: "0 m³ consumption (initial baseline reading) costs ₱0.00. Official baseline rates per cubic meter are ₱10.00/m³ for Residential accounts and ₱25.00/m³ for Commercial accounts, plus a mandatory 2% Local Franchise Tax. Accounts paid after the monthly due date incur a 10% late payment penalty on the basic water charge."
    }
  ];

  return (
    <div className="bg-slate-950 min-h-screen text-slate-200 font-sans" id="twd-landing-page">
      {/* Official Contact & Office Hours Top Bar */}
      <div className="bg-slate-900 text-slate-300 text-xs py-1.5 px-3 sm:px-4 border-b border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-y-1.5 gap-x-4 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-4 sm:gap-x-5 gap-y-1">
            <div className="flex items-center space-x-1.5 whitespace-nowrap">
              <Clock className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span><strong className="text-slate-100">Hours:</strong> Mon-Fri: 8:00am – 5:00pm</span>
            </div>
            <div className="flex items-center space-x-1.5 whitespace-nowrap">
              <Phone className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span><strong className="text-slate-100">Call:</strong> <a href="tel:0888904946" className="hover:text-blue-300 transition font-medium">(088) 890 – 4946</a></span>
            </div>
            <div className="flex items-center space-x-1.5 whitespace-nowrap">
              <Mail className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span><strong className="text-slate-100">Email:</strong> <a href="mailto:tagoloan_waterdistrict@yahoo.com" className="hover:text-blue-300 transition font-medium">tagoloan_waterdistrict@yahoo.com</a></span>
            </div>
          </div>
          <div className="hidden md:flex items-center space-x-1.5 text-slate-400 whitespace-nowrap">
            <MapPin className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            <span><strong className="text-slate-100">Office:</strong> Arellano St, Poblacion, Tagoloan</span>
          </div>
        </div>
      </div>

      {/* Upper Announcement Marquee */}
      <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-950 text-slate-200 text-xs py-1.5 px-4 shadow-inner text-center font-medium overflow-hidden whitespace-nowrap border-b border-blue-800/40">
        <span className="inline-block animate-pulse duration-1000 mr-2 font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded text-[10px] uppercase">Urgent Notice:</span>
        Water Line Maintenance Scheduled on June 5, 2026. Please check the announcements section below for active service areas!
      </div>

      {/* Main Header / Navigation */}
      <header className="sticky top-0 bg-slate-950/95 backdrop-blur z-40 border-b border-slate-800 transition-all shadow-md">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-x-2">
          
          {/* Logo & District Branding */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 shrink-0">
            <div className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-xl overflow-hidden bg-slate-900 border border-blue-500/40 shadow-md shadow-blue-500/10 flex items-center justify-center p-0.5 shrink-0 group">
              <img 
                src="https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg"
                alt="Tagoloan Water District Logo"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
                }}
                className="w-full h-full object-cover rounded-lg group-hover:scale-105 transition duration-300"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg xl:text-xl font-black tracking-tight text-slate-100 truncate font-sans">
                Tagoloan Water District
              </h1>
              <p className="text-[9px] sm:text-[10px] uppercase tracking-wider font-bold text-blue-400 truncate">
                Province of Misamis Oriental
              </p>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center space-x-3 xl:space-x-5 2xl:space-x-6 text-xs xl:text-sm font-bold text-slate-300 whitespace-nowrap">
            <a href="#profile" className="hover:text-blue-400 transition py-1">About Us</a>
            <a href="#org-structure" className="hover:text-blue-400 transition py-1">Org Structure</a>
            <a href="#services" className="hover:text-blue-400 transition py-1">Services & Tariff</a>
            <a href="#announcements" className="hover:text-blue-400 transition py-1">Announcements</a>
            <a href="#calculator" className="hover:text-blue-400 transition py-1">Bill Calculator</a>
            <a href="#faq" className="hover:text-blue-400 transition py-1">FAQ</a>
            <a href="#contact" className="hover:text-blue-400 transition py-1">Contact Support</a>
          </nav>

          {/* Action Buttons & Mobile Menu Toggle */}
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
            <button 
              id="nav-login-btn"
              onClick={() => onNavigate('login')}
              className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-bold text-slate-200 hover:text-white bg-slate-900 hover:bg-slate-800 transition border border-slate-700 whitespace-nowrap cursor-pointer"
            >
              Sign In
            </button>
            <button 
              id="nav-register-btn"
              onClick={() => onNavigate('register')}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-600 shadow-md shadow-blue-500/20 text-white rounded-lg text-xs sm:text-sm font-bold hover:bg-blue-500 transition whitespace-nowrap cursor-pointer"
            >
              Register Portal
            </button>

            {/* Mobile Hamburger Toggle Button */}
            <button
              id="nav-mobile-toggle-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition border border-slate-700 cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile / Tablet Drawer Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-slate-900 border-b border-slate-800 px-4 py-4 space-y-3 shadow-xl transition-all">
            <div className="flex flex-col space-y-2 text-sm font-bold text-slate-300">
              <a 
                href="#profile" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-blue-400 transition flex items-center justify-between"
              >
                <span>About Us</span>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </a>
              <a 
                href="#org-structure" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-blue-400 transition flex items-center justify-between"
              >
                <span>Org Structure</span>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </a>
              <a 
                href="#services" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-blue-400 transition flex items-center justify-between"
              >
                <span>Services & Tariff</span>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </a>
              <a 
                href="#announcements" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-blue-400 transition flex items-center justify-between"
              >
                <span>Announcements</span>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </a>
              <a 
                href="#calculator" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-blue-400 transition flex items-center justify-between"
              >
                <span>Bill Calculator</span>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </a>
              <a 
                href="#faq" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-blue-400 transition flex items-center justify-between"
              >
                <span>FAQ</span>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </a>
              <a 
                href="#contact" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-blue-400 transition flex items-center justify-between"
              >
                <span>Contact Support</span>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </a>
            </div>

            <div className="pt-3 border-t border-slate-800 flex flex-col gap-2">
              <button 
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('login');
                }}
                className="w-full py-2.5 rounded-lg text-sm font-bold text-slate-200 bg-slate-800 hover:bg-slate-700 transition text-center cursor-pointer border border-slate-700"
              >
                Sign In to Portal
              </button>
              <button 
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('register');
                }}
                className="w-full py-2.5 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition shadow-md text-center cursor-pointer"
              >
                Register New Account
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 pt-16 pb-24 overflow-hidden border-b border-slate-850">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center space-x-2 bg-blue-950/70 border border-blue-800/60 text-blue-300 px-3.5 py-1.5 rounded-full text-xs font-bold shadow-xs">
                <Droplet className="h-3.5 w-3.5 fill-blue-400 text-blue-400" />
                <span>Clean & Sustained Commitment Since 2009</span>
              </div>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-100 tracking-tight leading-none">
                Empowering the Community of <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-sky-400">Tagoloan</span> with Abundant Water
              </h2>
              <p className="text-base sm:text-lg text-slate-300 max-w-2xl leading-relaxed">
                Welcome to the official digital platform of Tagoloan Water District (TWD). We are dedicated to providing sustainable, clean, and reliable water distribution services. Register your consumer utility account online to view billing cycles, examine meter records, and inspect water usage analytics instantly.
              </p>
              <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 pt-4">
                <button
                  id="hero-register-btn"
                  onClick={() => onNavigate('register')}
                  className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-950/60 transition flex items-center justify-center space-x-2 text-base cursor-pointer"
                >
                  <span>Register Your Account</span>
                  <ArrowRight className="h-5 w-5" />
                </button>
                <button
                  id="hero-login-btn"
                  onClick={() => onNavigate('login')}
                  className="px-8 py-4 bg-slate-900 border border-slate-700 text-slate-200 hover:text-blue-300 rounded-xl font-bold hover:bg-slate-800 transition flex items-center justify-center space-x-2 text-base cursor-pointer"
                >
                  <span>Access Unified Login</span>
                </button>
              </div>

              {/* Statistical Banner */}
              <div className="grid grid-cols-3 gap-6 pt-10 border-t border-slate-800 max-w-lg">
                <div>
                  <p className="text-2xl font-black text-slate-100">8,500+</p>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Connections</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-100">100%</p>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Safe Standards</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-100">24/7</p>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Line Maintenance</p>
                </div>
              </div>
            </div>

            {/* Visual Vector Mockup Container */}
            <div className="lg:col-span-5 relative">
              <div className="absolute inset-0 bg-blue-500/10 rounded-3xl blur-3xl transform -rotate-6"></div>
              <div className="relative bg-slate-900 border border-slate-800 shadow-2xl rounded-3xl p-6 sm:p-8 text-slate-100">
                {/* Simulated Consumer Interface Banner inside Hero */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="h-10 w-10 bg-blue-950/80 rounded-lg flex items-center justify-center text-blue-400 border border-blue-800/60">
                      <Droplet className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Featured Services</h4>
                      <h3 className="text-sm font-extrabold text-slate-100">TWD Consumer Portal</h3>
                    </div>
                  </div>
                  <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded text-[10px] font-bold">● SYSTEM STABLE</span>
                </div>

                <div className="space-y-4">
                  <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800">
                    <div className="flex justify-between items-center text-xs text-slate-400 mb-1">
                      <span>Recent Meter Reading (5-Digit Dial)</span>
                      <span className="font-semibold text-emerald-400">Verified</span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <p className="text-xl font-bold font-mono tabular-nums tracking-wider text-slate-100">00245</p>
                      <span className="text-xs font-bold text-slate-400">MTR: MT-7711</span>
                    </div>
                  </div>

                  <div className="p-4 bg-blue-950/40 rounded-xl border border-blue-900/60">
                    <div className="flex justify-between items-center text-xs text-slate-300 mb-1">
                      <span>Official Residential Baseline Estimate</span>
                      <span className="text-blue-400 font-bold hover:underline cursor-pointer flex items-center" onClick={() => {
                        const elem = document.getElementById('calculator');
                        if (elem) elem.scrollIntoView({ behavior: 'smooth' });
                      }}>
                        Calculate <ChevronRight className="h-3 w-3 inline" />
                      </span>
                    </div>
                    {(() => {
                      const heroSample = calculateWaterBill(15, 'Residential');
                      return (
                        <p className="text-2xl font-black font-mono tabular-nums text-blue-400">
                          ₱{heroSample.totalBeforeDue.toFixed(2)}{' '}
                          <span className="text-xs font-sans font-normal text-slate-400">
                            for 15 m³ @ ₱{heroSample.ratePerM3.toFixed(0)}/m³ (incl. 2% tax)
                          </span>
                        </p>
                      );
                    })()}
                  </div>

                  {/* Operational Quality Bulletins */}
                  <div className="text-xs text-slate-300 space-y-2.5 pt-2">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-emerald-400 stroke-[2.5]" />
                      <span className="font-semibold text-slate-200">Unified Role Authentication Enabled</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-emerald-400 stroke-[2.5]" />
                      <span className="font-semibold text-slate-200">Automated Route Synchronization</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-emerald-400 stroke-[2.5]" />
                      <span className="font-semibold text-slate-200">Comprehensive Water Saving Tips</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Official District Profile, Mission, Vision, Core Values & Org Structure */}
      <DistrictProfileSection id="profile" isDarkTheme={true} />

      {/* Services Information & Official Baseline Tariff Schedule */}
      <section id="services" className="py-20 bg-slate-900/50 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            <div className="lg:col-span-5 space-y-6">
              <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Official Price Baseline</h4>
              <h3 className="text-3xl font-extrabold text-slate-100 leading-tight">
                Official Water Tariff Schedule
              </h3>
              <p className="text-slate-300 leading-relaxed text-sm">
                Tagoloan Water District implements a clear, straightforward per-cubic-meter tariff schedule for all metered connections. Initial baseline readings (0 m³) incur ₱0.00 charge, with statutory Franchise Tax (2%) and Late Payment Penalty (10% after due date) applied uniformly.
              </p>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-sm space-y-3">
                <div className="flex items-start space-x-3 text-xs text-slate-300">
                  <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span><strong>Residential Rate:</strong> ₱10.00 per cubic meter (₱10/m³) • 0 m³ = ₱0.00.</span>
                </div>
                <div className="flex items-start space-x-3 text-xs text-slate-300">
                  <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span><strong>Commercial Rate:</strong> ₱25.00 per cubic meter (₱25/m³) • 0 m³ = ₱0.00.</span>
                </div>
                <div className="flex items-start space-x-3 text-xs text-slate-300">
                  <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span><strong>Franchise Tax &amp; Late Penalty:</strong> 2% Local Franchise Tax on basic water charge, and 10% penalty if settled after the monthly due date.</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 shadow-xl rounded-2xl p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-base font-extrabold text-slate-100">Official Price Baseline of Meter Readings</h4>
                <span className="text-xs font-mono text-slate-400">0 m³ Baseline = ₱0.00</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-slate-950 text-slate-400 text-xs font-bold uppercase border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3.5">Customer Type</th>
                      <th className="px-4 py-3.5">Rate per Cubic Meter</th>
                      <th className="px-4 py-3.5">Franchise Tax</th>
                      <th className="px-4 py-3.5">Late Penalty</th>
                      <th className="px-4 py-3.5 text-right">Sample (10 m³)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200 text-xs font-medium">
                    <tr>
                      <td className="px-4 py-4 font-bold text-slate-100">Residential</td>
                      <td className="px-4 py-4 font-mono tabular-nums font-black text-emerald-400 text-sm">₱10.00 / m³</td>
                      <td className="px-4 py-4 font-mono tabular-nums text-slate-200">2%</td>
                      <td className="px-4 py-4 font-mono tabular-nums text-amber-300">10% (after due)</td>
                      <td className="px-4 py-4 font-mono tabular-nums font-bold text-right text-slate-100">₱102.00</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-4 font-bold text-slate-100">Commercial</td>
                      <td className="px-4 py-4 font-mono tabular-nums font-black text-sky-400 text-sm">₱25.00 / m³</td>
                      <td className="px-4 py-4 font-mono tabular-nums text-slate-200">2%</td>
                      <td className="px-4 py-4 font-mono tabular-nums text-amber-300">10% (after due)</td>
                      <td className="px-4 py-4 font-mono tabular-nums font-bold text-right text-slate-100">₱255.00</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400">
                * Sample 10 m³ total includes basic water charge (Usage × Rate/m³) plus 2% Franchise Tax. Accounts paid after the due date incur an additional 10% penalty on the basic water charge.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Live Interactive Tariff Bill Calculator */}
      <section id="calculator" className="py-20 bg-slate-950 border-t border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="bg-slate-900 text-slate-100 rounded-3xl p-8 sm:p-12 relative overflow-hidden shadow-2xl border border-slate-800">
            <div className="absolute top-0 right-0 h-64 w-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="relative grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
              <div className="md:col-span-6 space-y-4">
                <div className="flex items-center space-x-2 text-blue-400 text-xs font-bold uppercase tracking-wider">
                  <Calculator className="h-4 w-4" />
                  <span>Real-Time Estimation Utility</span>
                </div>
                <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-100 font-sans">
                  Forecast Your Monthly Bill
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Enter your expected cubic meter (m³) water consumption below to compute your exact monthly bill using the official TWD baseline rates (Residential ₱10/m³ · Commercial ₱25/m³), 2% Franchise Tax, and 10% late payment penalty preview.
                </p>
              </div>

              <div className="md:col-span-6 bg-slate-950/80 backdrop-blur-md rounded-2xl p-6 border border-slate-800 space-y-4">
                <form onSubmit={handleCalculate} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-1.5">Customer Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        type="button"
                        onClick={() => {
                          setCalcType('Residential');
                          setCalculatedBill(calculateWaterBill(calcUsage, 'Residential'));
                        }}
                        className={`py-2 px-3 rounded-lg text-xs font-bold transition border cursor-pointer ${
                          calcType === 'Residential' 
                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm' 
                            : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        Residential (₱10/m³)
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setCalcType('Commercial');
                          setCalculatedBill(calculateWaterBill(calcUsage, 'Commercial'));
                        }}
                        className={`py-2 px-3 rounded-lg text-xs font-bold transition border cursor-pointer ${
                          calcType === 'Commercial' 
                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm' 
                            : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        Commercial (₱25/m³)
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-1.5">Consumption Reading (m³)</label>
                    <div className="relative">
                      <input 
                        type="number"
                        min="0"
                        max="5000"
                        value={calcUsage}
                        onChange={(e) => {
                          const nextVal = Math.max(0, Number(e.target.value) || 0);
                          setCalcUsage(nextVal);
                          if (calculatedBill !== null) {
                            setCalculatedBill(calculateWaterBill(nextVal, calcType));
                          }
                        }}
                        className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg py-2 pl-3 pr-12 text-sm text-slate-100 font-mono tabular-nums font-bold focus:outline-none"
                        required
                      />
                      <span className="absolute right-3 top-2 text-xs font-bold text-slate-400">m³</span>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs uppercase tracking-widest transition shadow-md cursor-pointer"
                  >
                    Calculate Official Bill
                  </button>
                </form>

                {calculatedBill !== null && (
                  <div className="pt-4 border-t border-slate-800 space-y-2 text-xs animate-fade-in">
                    <div className="flex justify-between text-slate-400">
                      <span>Basic Charge ({calcUsage} m³ × ₱{calculatedBill.ratePerM3.toFixed(2)}/m³):</span>
                      <span className="font-mono tabular-nums font-bold text-slate-100">₱{calculatedBill.basicCharge.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Franchise Tax (2%):</span>
                      <span className="font-mono tabular-nums font-bold text-slate-100">₱{calculatedBill.franchiseTax.toFixed(2)}</span>
                    </div>
                    <div className="pt-2 border-t border-slate-800 flex justify-between items-baseline">
                      <span className="font-bold text-slate-200">Total Amount Due:</span>
                      <span className="text-2xl font-black font-mono tabular-nums text-amber-400">₱{calculatedBill.totalBeforeDue.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-rose-400 pt-1">
                      <span>After Due Date (+10% Penalty: ₱{calculatedBill.latePenalty.toFixed(2)}):</span>
                      <span className="font-mono tabular-nums font-bold">₱{calculatedBill.amountAfterDue.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Announcements Section */}
      <section id="announcements" className="py-20 bg-slate-900/40 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12">
            <div>
              <h4 className="text-sm font-bold text-blue-400 uppercase tracking-widest">Public Safety Bulletin</h4>
              <h3 className="text-3xl font-extrabold text-slate-100 mt-1 tracking-tight">Active Announcements & Advisory Logs</h3>
            </div>
            <p className="text-slate-300 text-sm max-w-sm mt-3 md:mt-0 font-sans">
              Stay fully updated with real-time operational broadcasts, plumbing maintenance alerts, and quality tests posted directly by District engineering leads.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {sanitizeAnnouncements(announcements).map((ann, aIdx) => {
              const categoryColors = {
                disruption: 'bg-red-950/80 text-rose-300 border-rose-800/60 ring-red-500/10',
                maintenance: 'bg-amber-950/80 text-amber-300 border-amber-800/60 ring-amber-500/10',
                event: 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60 ring-indigo-500/10',
                info: 'bg-blue-950/80 text-blue-300 border-blue-800/60 ring-blue-500/10',
              };
              
              const categoryLabels = {
                disruption: 'Service Interruption',
                maintenance: 'Line Maintenance',
                event: 'District Event',
                info: 'Notice',
              };

              return (
                <div key={`landing-ann-${ann.id || ''}-${aIdx}`} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md hover:shadow-lg transition flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${categoryColors[ann.category] || categoryColors.info}`}>
                        {categoryLabels[ann.category] || categoryLabels.info}
                      </span>
                      <span className="text-xs font-mono text-slate-400 flex items-center">
                        <Calendar className="h-3 w-3 mr-1 text-slate-500" />
                        {ann.date}
                      </span>
                    </div>
                    <h4 className="text-lg font-extrabold text-slate-100 leading-snug">{ann.title}</h4>
                    <p className="text-slate-300 text-sm leading-relaxed">{ann.content}</p>
                  </div>
                  <div className="pt-4 border-t border-slate-800 mt-4 flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <span>Issued: {ann.postedBy}</span>
                    <span className="text-blue-400">Verified Advisory</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions (FAQ) Section */}
      <section id="faq" className="py-20 bg-slate-950 border-t border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center space-y-4 mb-16">
            <h4 className="text-xs font-bold uppercase tracking-widest text-blue-400">Assistance Matrix</h4>
            <h3 className="text-3xl font-extrabold text-slate-100 tracking-tight">Frequently Asked Questions</h3>
            <p className="text-slate-300 text-sm max-w-lg mx-auto leading-relaxed">
              Find quick solutions to procedural aspects, registry guidelines, and tariff schedules for Tagoloan Water connection systems.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden transition">
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-6 py-4 flex items-center justify-between text-left focus:outline-none cursor-pointer"
                    id={`faq-toggle-${idx}`}
                  >
                    <span className="font-extrabold text-slate-100 text-sm flex items-center">
                      <HelpCircle className="h-4 w-4 mr-2.5 text-blue-400 shrink-0" />
                      {faq.q}
                    </span>
                    <span className="text-blue-400 text-xs font-bold shrink-0 ml-2">
                      {isOpen ? 'Collapse' : 'Expand'}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-xs text-slate-300 leading-relaxed border-t border-slate-800/80 pt-3">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contact Details, Office Location & Customer Service Request */}
      <section id="contact" className="py-20 bg-slate-900/40 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            
            {/* Contact cards */}
            <div className="lg:col-span-5 space-y-6">
              <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Connect With Us</h4>
              <h3 className="text-3xl font-extrabold text-slate-100 tracking-tight">Main Office Location</h3>
              <p className="text-slate-300 text-sm max-w-sm leading-relaxed">
                Whether you wish to dispute billing metrics, apply for active connection expansion, or report leaks, TWD support desks are ready.
              </p>

              <div className="space-y-4 pt-2">
                <div className="flex items-center space-x-4 bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
                  <div className="h-10 w-10 bg-blue-950/80 rounded-lg flex items-center justify-center text-blue-400 shrink-0 border border-blue-800/50">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Visit Our Office</h4>
                    <p className="text-xs font-bold text-slate-200">Arellano St, Poblacion, Tagoloan, Misamis Oriental</p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
                  <div className="h-10 w-10 bg-emerald-950/80 rounded-lg flex items-center justify-center text-emerald-400 shrink-0 border border-emerald-800/50">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Call Us</h4>
                    <p className="text-xs font-bold text-slate-200">
                      <a href="tel:0888904946" className="hover:text-blue-300 transition">(088) 890 – 4946</a>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
                  <div className="h-10 w-10 bg-amber-950/80 rounded-lg flex items-center justify-center text-amber-400 shrink-0 border border-amber-800/50">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email Us</h4>
                    <p className="text-xs font-bold text-slate-200">
                      <a href="mailto:tagoloan_waterdistrict@yahoo.com" className="hover:text-blue-300 transition">tagoloan_waterdistrict@yahoo.com</a>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xs">
                  <div className="h-10 w-10 bg-sky-950/80 rounded-lg flex items-center justify-center text-sky-400 shrink-0 border border-sky-800/50">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Opening Hours</h4>
                    <p className="text-xs font-bold text-slate-200">Mon-Fri: 8:00am – 5:00pm</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Inquiry Form */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 shadow-xl rounded-3xl p-6 sm:p-8 space-y-6">
              <h4 className="text-base font-extrabold text-slate-100 border-b border-slate-800 pb-3">Submit Customer Service Request</h4>
              
              <form onSubmit={handleContactSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-300 uppercase tracking-wider mb-1">Your Full Name</label>
                    <input 
                      type="text"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 px-3 text-xs text-slate-200 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                      placeholder="e.g. Maria Clara Santos"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-300 uppercase tracking-wider mb-1">Account Number (Optional)</label>
                    <input 
                      type="text"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 px-3 text-xs text-slate-200 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                      placeholder="e.g. 1001-A"
                      value={contactAccount}
                      onChange={(e) => setContactAccount(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-300 uppercase tracking-wider mb-1">Detailed Inquiry Request Message</label>
                  <textarea 
                    rows={4}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 px-3 text-xs text-slate-200 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                    placeholder="Describe your maintenance inquiry, meter leakage or bill dispute parameters so TWD can review them..."
                    value={contactMsg}
                    onChange={(e) => setContactMsg(e.target.value)}
                    required
                  ></textarea>
                </div>

                <button 
                  type="submit"
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition shadow-md cursor-pointer"
                >
                  Send Inquiry Form
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Public Footer */}
      <footer className="bg-slate-950 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <div className="flex items-center justify-center space-x-3 text-slate-100">
            <div className="h-10 w-10 rounded-xl overflow-hidden bg-slate-900 border border-slate-700 shadow-md p-0.5">
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
            <span className="text-lg font-black tracking-tight text-slate-100">Tagoloan Water District</span>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-rose-400" />
              Arellano St, Poblacion, Tagoloan, Misamis Oriental
            </span>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-blue-400" />
              Mon-Fri: 8:00am – 5:00pm
            </span>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-emerald-400" />
              <a href="tel:0888904946" className="hover:text-blue-300 transition">(088) 890 – 4946</a>
            </span>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-amber-400" />
              <a href="mailto:tagoloan_waterdistrict@yahoo.com" className="hover:text-blue-300 transition">tagoloan_waterdistrict@yahoo.com</a>
            </span>
          </div>

          <p className="text-xs max-w-xl mx-auto leading-relaxed text-slate-400">
            Tagoloan Water District is committed to preserving environmental integrity while delivering continuous municipal services conforming to standard water quality guidelines.
          </p>
          <div className="text-[10px] text-slate-500">
            &copy; 2026 Tagoloan Water District. All Rights Reserved. Province of Misamis Oriental.
          </div>
        </div>
      </footer>
    </div>
  );
}

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
import { calculateWaterTariff } from '../utils/tariffCalculator';
import { DistrictProfileSection } from './common/DistrictProfileSection';

interface LandingPageProps {
  announcements: Announcement[];
  onNavigate: (page: 'login' | 'register') => void;
}

export default function LandingPage({ announcements, onNavigate }: LandingPageProps) {
  // Mobile Navigation Menu State
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Frequently Asked Questions State
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  
  // Local Bill Calculator State
  const [calcType, setCalcType] = useState<'Residential' | 'Commercial'>('Residential');
  const [calcUsage, setCalcUsage] = useState<number>(15);
  const [calculatedBill, setCalculatedBill] = useState<number | null>(null);

  // Customer Service Contact Form State
  const [contactName, setContactName] = useState('');
  const [contactAccount, setContactAccount] = useState('');
  const [contactMsg, setContactMsg] = useState('');
  const [contactSent, setContactSent] = useState(false);

  const calculateWaterBill = (usage: number, type: 'Residential' | 'Commercial') => {
    return calculateWaterTariff(usage, type);
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
      alert("Thank you! Your message has been submitted to Tagoloan Water District Support. We will review your inquiry shortly.");
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
      a: "0 m³ consumption (initial baseline reading) costs ₱0.00. The first 10 m³ has a fixed price of ₱10.00. For consumption exceeding 10 m³, ₱2.00 is added for every 10 m³ overlap: 11–20 m³ is ₱12.00/m³, 21–30 m³ is ₱14.00/m³, 31–40 m³ is ₱16.00/m³, and so forth."
    }
  ];

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans" id="twd-landing-page">
      {/* Official Contact & Office Hours Top Bar */}
      <div className="bg-slate-900 text-slate-300 text-xs py-1.5 px-3 sm:px-4 border-b border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-y-1.5 gap-x-4 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-4 sm:gap-x-5 gap-y-1">
            <div className="flex items-center space-x-1.5 whitespace-nowrap">
              <Clock className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span><strong className="text-white">Hours:</strong> Mon-Fri: 8:00am – 5:00pm</span>
            </div>
            <div className="flex items-center space-x-1.5 whitespace-nowrap">
              <Phone className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span><strong className="text-white">Call:</strong> <a href="tel:0888904946" className="hover:text-white transition font-medium">(088) 890 – 4946</a></span>
            </div>
            <div className="flex items-center space-x-1.5 whitespace-nowrap">
              <Mail className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span><strong className="text-white">Email:</strong> <a href="mailto:tagoloan_waterdistrict@yahoo.com" className="hover:text-white transition font-medium">tagoloan_waterdistrict@yahoo.com</a></span>
            </div>
          </div>
          <div className="hidden md:flex items-center space-x-1.5 text-slate-400 whitespace-nowrap">
            <MapPin className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            <span><strong className="text-white">Office:</strong> Arellano St, Poblacion, Tagoloan</span>
          </div>
        </div>
      </div>

      {/* Upper Announcement Marquee */}
      <div className="bg-gradient-to-r from-blue-700 to-sky-600 text-white text-xs py-1 px-4 shadow-inner text-center font-medium overflow-hidden whitespace-nowrap">
        <span className="inline-block animate-pulse duration-1000 mr-2 font-bold bg-amber-500 text-slate-900 px-1.5 py-0.5 rounded text-[10px] uppercase">Urgent Notice:</span>
        Water Line Maintenance Scheduled on June 5, 2026. Please check the announcements section below for active service areas!
      </div>

      {/* Main Header / Navigation */}
      <header className="sticky top-0 bg-white/95 backdrop-blur z-40 border-b border-slate-100 transition-all shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-x-2">
          
          {/* Logo & District Branding */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 shrink-0">
            <div className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-xl overflow-hidden bg-slate-900 border border-blue-500/30 shadow-md shadow-blue-500/10 flex items-center justify-center p-0.5 shrink-0 group">
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
              <h1 className="text-base sm:text-lg xl:text-xl font-black tracking-tight text-slate-900 truncate font-sans">
                Tagoloan Water District
              </h1>
              <p className="text-[9px] sm:text-[10px] uppercase tracking-wider font-bold text-blue-600 truncate">
                Province of Misamis Oriental
              </p>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center space-x-3 xl:space-x-5 2xl:space-x-6 text-xs xl:text-sm font-bold text-slate-600 whitespace-nowrap">
            <a href="#profile" className="hover:text-blue-600 transition py-1">About Us</a>
            <a href="#org-structure" className="hover:text-blue-600 transition py-1">Org Structure</a>
            <a href="#services" className="hover:text-blue-600 transition py-1">Services & Tariff</a>
            <a href="#announcements" className="hover:text-blue-600 transition py-1">Announcements</a>
            <a href="#calculator" className="hover:text-blue-600 transition py-1">Bill Calculator</a>
            <a href="#faq" className="hover:text-blue-600 transition py-1">FAQ</a>
            <a href="#contact" className="hover:text-blue-600 transition py-1">Contact Support</a>
          </nav>

          {/* Action Buttons & Mobile Menu Toggle */}
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
            <button 
              id="nav-login-btn"
              onClick={() => onNavigate('login')}
              className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-bold text-slate-700 hover:text-blue-600 hover:bg-slate-100 transition border border-slate-200 whitespace-nowrap"
            >
              Sign In
            </button>
            <button 
              id="nav-register-btn"
              onClick={() => onNavigate('register')}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-600 shadow-md shadow-blue-500/20 text-white rounded-lg text-xs sm:text-sm font-bold hover:bg-blue-700 transition whitespace-nowrap"
            >
              Register Portal
            </button>

            {/* Mobile Hamburger Toggle Button */}
            <button
              id="nav-mobile-toggle-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition border border-slate-200"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile / Tablet Drawer Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-4 space-y-3 shadow-xl transition-all">
            <div className="flex flex-col space-y-2 text-sm font-bold text-slate-700">
              <a 
                href="#profile" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition flex items-center justify-between"
              >
                <span>About Us</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </a>
              <a 
                href="#org-structure" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition flex items-center justify-between"
              >
                <span>Org Structure</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </a>
              <a 
                href="#services" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition flex items-center justify-between"
              >
                <span>Services & Tariff</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </a>
              <a 
                href="#announcements" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition flex items-center justify-between"
              >
                <span>Announcements</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </a>
              <a 
                href="#calculator" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition flex items-center justify-between"
              >
                <span>Bill Calculator</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </a>
              <a 
                href="#faq" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition flex items-center justify-between"
              >
                <span>FAQ</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </a>
              <a 
                href="#contact" 
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition flex items-center justify-between"
              >
                <span>Contact Support</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </a>
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
              <button 
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('login');
                }}
                className="w-full py-2.5 rounded-lg text-sm font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 transition text-center"
              >
                Sign In to Portal
              </button>
              <button 
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('register');
                }}
                className="w-full py-2.5 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition shadow-md text-center"
              >
                Register New Account
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-blue-50/50 via-white to-slate-50 pt-16 pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center space-x-2 bg-blue-50 border border-blue-100 text-blue-700 px-3.5 py-1.5 rounded-full text-xs font-bold shadow-xs">
                <Droplet className="h-3.5 w-3.5 fill-blue-500 text-blue-600" />
                <span>Clean & Sustained Commitment Since 2009</span>
              </div>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 tracking-tight leading-none">
                Empowering the Community of <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-sky-500">Tagoloan</span> with Abundant Water
              </h2>
              <p className="text-lg text-slate-600 max-w-2xl leading-relaxed">
                Welcome to the official digital platform of Tagoloan Water District (TWD). We are dedicated to providing sustainable, clean, and reliable water distribution services. Register your consumer utility account online to view billing cycles, examine meter records, and inspect water usage analytics instantly.
              </p>
              <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 pt-4">
                <button
                  id="hero-register-btn"
                  onClick={() => onNavigate('register')}
                  className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-200 hover:shadow-xl hover:shadow-blue-300 transition flex items-center justify-center space-x-2 text-base"
                >
                  <span>Register Your Account</span>
                  <ArrowRight className="h-5 w-5" />
                </button>
                <button
                  id="hero-login-btn"
                  onClick={() => onNavigate('login')}
                  className="px-8 py-4 bg-white border border-slate-200 text-slate-700 hover:text-blue-600 rounded-xl font-bold hover:bg-slate-50 transition flex items-center justify-center space-x-2 text-base"
                >
                  <span>Access Unified Login</span>
                </button>
              </div>

              {/* Statistical Banner */}
              <div className="grid grid-cols-3 gap-6 pt-10 border-t border-slate-100 max-w-lg">
                <div>
                  <p className="text-2xl font-black text-slate-900">8,500+</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Active Connections</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-900">100%</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Safe Standards</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-900">24/7</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Line Maintenance</p>
                </div>
              </div>
            </div>

            {/* Visual Vector Mockup Container */}
            <div className="lg:col-span-5 relative">
              <div className="absolute inset-0 bg-blue-500/10 rounded-3xl blur-3xl transform -rotate-6"></div>
              <div className="relative bg-white border border-slate-100 shadow-2xl rounded-3xl p-6 sm:p-8">
                {/* Simulated Consumer Interface Banner inside Hero */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                      <Droplet className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Featured Services</h4>
                      <h3 className="text-sm font-extrabold text-slate-800">TWD Consumer Portal</h3>
                    </div>
                  </div>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded text-[10px] font-bold">● SYSTEM STABLE</span>
                </div>

                <div className="space-y-4">
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="flex justify-between items-center text-xs text-slate-500 mb-1">
                      <span>Recent Meter Reading</span>
                      <span className="font-semibold text-slate-700">Verified</span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <p className="text-xl font-bold font-mono text-slate-900">244.5 m³</p>
                      <span className="text-xs font-bold text-slate-500">MTR: MT-7711</span>
                    </div>
                  </div>

                  <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-50">
                    <div className="flex justify-between items-center text-xs text-slate-600 mb-1">
                      <span>June 2026 Estimated Tariff</span>
                      <span className="text-blue-600 font-bold hover:underline cursor-pointer flex items-center" onClick={() => {
                        const elem = document.getElementById('calculator');
                        if (elem) elem.scrollIntoView({ behavior: 'smooth' });
                      }}>
                        Calculate <ChevronRight className="h-3 w-3 inline" />
                      </span>
                    </div>
                    <p className="text-2xl font-black text-blue-700">₱280.00 <span className="text-xs font-normal text-slate-500">for 15 m³</span></p>
                  </div>

                  {/* Operational Quality Bulletins */}
                  <div className="text-xs text-slate-500 space-y-2.5 pt-2">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-emerald-500 stroke-[2.5]" />
                      <span className="font-semibold text-slate-700">Unified Role Authentication Enabled</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-emerald-500 stroke-[2.5]" />
                      <span className="font-semibold text-slate-700">Automated Route Synchronization</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-emerald-500 stroke-[2.5]" />
                      <span className="font-semibold text-slate-700">Comprehensive Water Saving Tips</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Official District Profile, Mission, Vision, Core Values & Org Structure */}
      <DistrictProfileSection id="profile" />

      {/* Services Information & Live Tariff Table */}
      <section id="services" className="py-20 bg-slate-50 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            <div className="lg:col-span-5 space-y-6">
              <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest">Pricing Structure</h4>
              <h3 className="text-3xl font-extrabold text-slate-900 leading-tight">
                Transparent Tariff Schedules
              </h3>
              <p className="text-slate-600 leading-relaxed text-sm">
                Tagoloan Water District utilizes a fair progressive water tariff schedule. Initial base readings (0 m³) incur ₱0.00 charge. The first 10 cubic meters are billed at a fixed foundational rate, with tiered increments applied for each 10 m³ overlap block.
              </p>

              <div className="bg-white border border-slate-150 p-5 rounded-2xl shadow-sm space-y-3">
                <div className="flex items-start space-x-3 text-xs text-slate-600">
                  <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span><strong>Baseline Reading:</strong> 0 m³ net consumption = ₱0.00 assessed billing.</span>
                </div>
                <div className="flex items-start space-x-3 text-xs text-slate-600">
                  <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span><strong>First 10 m³:</strong> Fixed foundational price of ₱10.00 for residential (₱20.00 commercial).</span>
                </div>
                <div className="flex items-start space-x-3 text-xs text-slate-600">
                  <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span><strong>Progressive Overlap:</strong> +₱2.00 rate increase per 10 m³ consumption bracket.</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-100 shadow-xl rounded-3xl p-6 sm:p-8 space-y-6">
              <h4 className="text-base font-extrabold text-slate-900">Current Tariff Rates Table</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 text-xs font-bold uppercase border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3">Classification</th>
                      <th className="px-4 py-3">0 m³ (Base)</th>
                      <th className="px-4 py-3">1-10 m³ (Fixed)</th>
                      <th className="px-4 py-3">11-20 m³</th>
                      <th className="px-4 py-3">21-30 m³</th>
                      <th className="px-4 py-3">31-40 m³</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 text-xs font-medium">
                    <tr>
                      <td className="px-4 py-4 font-bold text-slate-900">Residential</td>
                      <td className="px-4 py-4 text-emerald-600 font-bold">₱0.00</td>
                      <td className="px-4 py-4">₱10.00 fixed</td>
                      <td className="px-4 py-4">₱12.00 / m³</td>
                      <td className="px-4 py-4">₱14.00 / m³</td>
                      <td className="px-4 py-4">₱16.00 / m³</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-4 font-bold text-slate-900">Commercial</td>
                      <td className="px-4 py-4 text-emerald-600 font-bold">₱0.00</td>
                      <td className="px-4 py-4">₱20.00 fixed</td>
                      <td className="px-4 py-4">₱24.00 / m³</td>
                      <td className="px-4 py-4">₱28.00 / m³</td>
                      <td className="px-4 py-4">₱32.00 / m³</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500 italic">
                * Beyond 40 m³, rate continues to increase by +₱2.00 (or +₱4.00 for commercial) for every additional 10 m³ block.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Live Interactive Tariff Bill Calculator */}
      <section id="calculator" className="py-20 bg-white border-t border-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="bg-slate-900 text-white rounded-3xl p-8 sm:p-12 relative overflow-hidden shadow-2xl">
            <div className="absolute top-0 right-0 h-64 w-64 bg-blue-600/20 rounded-full blur-3xl"></div>
            
            <div className="relative grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
              <div className="md:col-span-7 space-y-4">
                <div className="inline-flex items-center space-x-2 bg-blue-500/20 text-blue-300 border border-blue-500/30 px-3 py-1 rounded-full text-xs font-semibold">
                  <Calculator className="h-3.5 w-3.5" />
                  <span>Real-time Estimation Utility</span>
                </div>
                <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-white font-sans">
                  Forecast Your Monthly Bill
                </h3>
                <p className="text-slate-350 text-sm leading-relaxed">
                  Enter your expected cubic meter (m³) water consumption index below to review how TWD's tiered pricing gets computed. No account required!
                </p>
              </div>

              <div className="md:col-span-5 bg-white/5 backdrop-blur-md rounded-2xl p-6 border border-white/10 space-y-4">
                <form onSubmit={handleCalculate} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-1.5">Connection Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        type="button"
                        onClick={() => setCalcType('Residential')}
                        className={`py-2 rounded-lg text-xs font-bold transition border ${
                          calcType === 'Residential' 
                            ? 'bg-blue-600 text-white border-blue-500' 
                            : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Residential
                      </button>
                      <button 
                        type="button"
                        onClick={() => setCalcType('Commercial')}
                        className={`py-2 rounded-lg text-xs font-bold transition border ${
                          calcType === 'Commercial' 
                            ? 'bg-blue-600 text-white border-blue-500' 
                            : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Commercial
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-1.5">Consumption Index (m³)</label>
                    <div className="relative">
                      <input 
                        type="number"
                        min="0"
                        max="500"
                        value={calcUsage}
                        onChange={(e) => setCalcUsage(Number(e.target.value))}
                        className="w-full bg-white/10 border border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg py-2 pl-3 pr-12 text-sm text-white font-mono font-bold focus:outline-none"
                        required
                      />
                      <span className="absolute right-3 top-2 text-xs font-bold text-slate-400">m³</span>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs uppercase tracking-widest transition"
                  >
                    Calculate Estimation
                  </button>
                </form>

                {calculatedBill !== null && (
                  <div className="pt-4 border-t border-white/10 text-center animate-fade-in">
                    <p className="text-xs text-slate-300">Estimated Monthly Water Bill</p>
                    <p className="text-3xl font-black text-amber-400 mt-1">₱{calculatedBill.toFixed(2)}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Computed with progressive 10 m³ block overlap tariff rates.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Announcements Section */}
      <section id="announcements" className="py-20 bg-slate-50 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12">
            <div>
              <h4 className="text-sm font-bold text-blue-600 uppercase tracking-widest">Public Safety Bulletin</h4>
              <h3 className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">Active Announcements & Advisory Logs</h3>
            </div>
            <p className="text-slate-600 text-sm max-w-sm mt-3 md:mt-0 font-sans">
              Stay fully updated with real-time operational broadcasts, plumbing maintenance alerts, and quality tests posted directly by District engineering leads.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {announcements.map((ann, aIdx) => {
              const categoryColors = {
                disruption: 'bg-red-50 text-red-700 border-red-100 ring-red-500/10',
                maintenance: 'bg-amber-50 text-amber-700 border-amber-100 ring-amber-500/10',
                event: 'bg-indigo-50 text-indigo-700 border-indigo-100 ring-indigo-500/10',
                info: 'bg-blue-50 text-blue-700 border-blue-100 ring-blue-500/10',
              };
              
              const categoryLabels = {
                disruption: 'Service Interruption',
                maintenance: 'Line Maintenance',
                event: 'District Event',
                info: 'Notice',
              };

              return (
                <div key={`landing-ann-${ann.id || ''}-${aIdx}`} className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${categoryColors[ann.category]}`}>
                        {categoryLabels[ann.category]}
                      </span>
                      <span className="text-xs font-mono text-slate-400 flex items-center">
                        <Calendar className="h-3 w-3 mr-1" />
                        {ann.date}
                      </span>
                    </div>
                    <h4 className="text-lg font-extrabold text-slate-900 leading-snug">{ann.title}</h4>
                    <p className="text-slate-600 text-sm leading-relaxed">{ann.content}</p>
                  </div>
                  <div className="pt-4 border-t border-slate-50 mt-4 flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <span>Issued: {ann.postedBy}</span>
                    <span className="text-blue-600">Verified Advisory</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions (FAQ) Section */}
      <section id="faq" className="py-20 bg-white border-t border-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center space-y-4 mb-16">
            <h4 className="text-xs font-bold uppercase tracking-widest text-blue-600">Assistance Matrix</h4>
            <h3 className="text-3xl font-extrabold text-slate-950 tracking-tight">Frequently Asked Questions</h3>
            <p className="text-slate-600 text-sm max-w-lg mx-auto leading-relaxed">
              Find quick solutions to procedural aspects, registry guidelines, and tariff schedules for Tagoloan Water connection systems.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={idx} className="bg-slate-50 border border-slate-100 rounded-xl overflow-hidden transition">
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-6 py-4 flex items-center justify-between text-left focus:outline-none"
                    id={`faq-toggle-${idx}`}
                  >
                    <span className="font-extrabold text-slate-800 text-sm flex items-center">
                      <HelpCircle className="h-4 w-4 mr-2.5 text-blue-500 shrink-0" />
                      {faq.q}
                    </span>
                    <span className="text-blue-600 text-xs font-bold shrink-0 ml-2">
                      {isOpen ? 'Collapse' : 'Expand'}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-xs text-slate-600 leading-relaxed border-t border-slate-100/50 pt-3">
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
      <section id="contact" className="py-20 bg-slate-50 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            
            {/* Contact cards */}
            <div className="lg:col-span-5 space-y-6">
              <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest">Connect With Us</h4>
              <h3 className="text-3xl font-extrabold text-slate-950 tracking-tight">Main Office Location</h3>
              <p className="text-slate-600 text-sm max-w-sm leading-relaxed">
                Whether you wish to dispute billing metrics, apply for active connection expansion, or report leaks, TWD support desks are ready.
              </p>

              <div className="space-y-4 pt-2">
                <div className="flex items-center space-x-4 bg-white p-4 rounded-xl border border-slate-100 shadow-xs">
                  <div className="h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 shrink-0">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Visit Our Office</h4>
                    <p className="text-xs font-bold text-slate-900">Arellano St, Poblacion, Tagoloan, Misamis Oriental</p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-white p-4 rounded-xl border border-slate-100 shadow-xs">
                  <div className="h-10 w-10 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 shrink-0">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Call Us</h4>
                    <p className="text-xs font-bold text-slate-900">
                      <a href="tel:0888904946" className="hover:text-blue-600 transition">(088) 890 – 4946</a>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-white p-4 rounded-xl border border-slate-100 shadow-xs">
                  <div className="h-10 w-10 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600 shrink-0">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email Us</h4>
                    <p className="text-xs font-bold text-slate-900">
                      <a href="mailto:tagoloan_waterdistrict@yahoo.com" className="hover:text-blue-600 transition">tagoloan_waterdistrict@yahoo.com</a>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-white p-4 rounded-xl border border-slate-100 shadow-xs">
                  <div className="h-10 w-10 bg-sky-50 rounded-lg flex items-center justify-center text-sky-600 shrink-0">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Opening Hours</h4>
                    <p className="text-xs font-bold text-slate-900">Mon-Fri: 8:00am – 5:00pm</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Inquiry Form */}
            <div className="lg:col-span-7 bg-white border border-slate-100 shadow-xl rounded-3xl p-6 sm:p-8 space-y-6">
              <h4 className="text-base font-extrabold text-slate-900 border-b border-slate-50 pb-3">Submit Customer Service Request</h4>
              
              <form onSubmit={handleContactSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-1">Your Full Name</label>
                    <input 
                      type="text"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      placeholder="e.g. Maria Clara Santos"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-1">Account Number (Optional)</label>
                    <input 
                      type="text"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      placeholder="e.g. 1001-A"
                      value={contactAccount}
                      onChange={(e) => setContactAccount(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-1">Detailed Inquiry Request Message</label>
                  <textarea 
                    rows={4}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                    placeholder="Describe your maintenance inquiry, meter leakage or bill dispute parameters so TWD can review them..."
                    value={contactMsg}
                    onChange={(e) => setContactMsg(e.target.value)}
                    required
                  ></textarea>
                </div>

                <button 
                  type="submit"
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition"
                >
                  Send Inquiry Form
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Public Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <div className="flex items-center justify-center space-x-3 text-white">
            <div className="h-10 w-10 rounded-xl overflow-hidden bg-slate-800 border border-white/20 shadow-md p-0.5">
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
            <span className="text-lg font-black tracking-tight text-white">Tagoloan Water District</span>
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
              <a href="tel:0888904946" className="hover:text-white transition">(088) 890 – 4946</a>
            </span>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-amber-400" />
              <a href="mailto:tagoloan_waterdistrict@yahoo.com" className="hover:text-white transition">tagoloan_waterdistrict@yahoo.com</a>
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

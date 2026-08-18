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
  Waves
} from 'lucide-react';
import { Announcement } from '../types';

interface LandingPageProps {
  announcements: Announcement[];
  onNavigate: (page: 'login' | 'register') => void;
}

export default function LandingPage({ announcements, onNavigate }: LandingPageProps) {
  // Frequently Asked Questions State
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  
  // Local Bill Calculator State
  const [calcType, setCalcType] = useState<'residential' | 'commercial'>('residential');
  const [calcUsage, setCalcUsage] = useState<number>(15);
  const [calculatedBill, setCalculatedBill] = useState<number | null>(null);

  // Customer Service Contact Form State
  const [contactName, setContactName] = useState('');
  const [contactAccount, setContactAccount] = useState('');
  const [contactMsg, setContactMsg] = useState('');
  const [contactSent, setContactSent] = useState(false);

  const calculateWaterBill = (usage: number, type: 'residential' | 'commercial') => {
    let bill = 0;
    if (type === 'residential') {
      const minCharge = 180.00; // first 10m3
      if (usage <= 10) {
        bill = minCharge;
      } else {
        let remaining = usage - 10;
        bill += minCharge;
        
        // 11-20 m³
        const tier1 = Math.min(remaining, 10);
        bill += tier1 * 20.00;
        remaining -= tier1;
        
        if (remaining > 0) {
          // 21-30 m³
          const tier2 = Math.min(remaining, 10);
          bill += tier2 * 24.00;
          remaining -= tier2;
        }
        
        if (remaining > 0) {
          // 31+ m³
          bill += remaining * 30.00;
        }
      }
    } else {
      const minCharge = 360.00; // first 10m3
      if (usage <= 10) {
        bill = minCharge;
      } else {
        let remaining = usage - 10;
        bill += minCharge;
        
        // 11-20 m³
        const tier1 = Math.min(remaining, 10);
        bill += tier1 * 40.00;
        remaining -= tier1;
        
        if (remaining > 0) {
          // 21-30 m³
          const tier2 = Math.min(remaining, 10);
          bill += tier2 * 48.00;
          remaining -= tier2;
        }
        
        if (remaining > 0) {
          // 31+ m³
          bill += remaining * 60.00;
        }
      }
    }
    return bill;
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
      a: "First-time users can click the 'Register Account' button. You must provide your official 5-digit account number (e.g., '2001-X') and matching client name exactly as it appears on your physical paper bill. Once verified, you will set up password credentials for logging in."
    },
    {
      q: "When is the Tagoloan Water District meter reading period?",
      a: "Meter readings are typically gathered by authorized field personnel between the 1st and 5th day of each calendar month. The newly synchronised readings will reflect immediately in both your personal consumer account history and the district database."
    },
    {
      q: "What should I do if my water connection pressure drops or there is a leak?",
      a: "Please report water leaks, unusual pressure drops, or damaged mechanical water meters immediately using our customer inquiry portal or reach out to the TWD Engineering Maintenance Team on (088) 555-0145. Prompt reports help prevent unwarranted high consumption charges."
    },
    {
      q: "How are the water tariff calculations calculated?",
      a: "Tagoloan Water District utilizes a progressive bracket tariff. Residential accounts start with a basic flat charge of ₱180.00 for the first 10 cubic meters. Additional cubic meters are billed at cascading rates: ₱20/m³ (11-20m³), ₱24/m³ (21-30m³), and ₱30/m³ for usage exceeding 30m³. This progressive structure rewards water conservation."
    }
  ];

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans" id="twd-landing-page">
      {/* Upper Announcement Marquee */}
      <div className="bg-gradient-to-r from-blue-700 to-sky-600 text-white text-xs py-2 px-4 shadow-inner text-center font-medium overflow-hidden whitespace-nowrap">
        <span className="inline-block animate-pulse duration-1000 mr-2 font-bold bg-amber-500 text-slate-900 px-1.5 py-0.5 rounded text-[10px] uppercase">Urgent Notice:</span>
        Water Line Maintenance Scheduled on June 5, 2026. Please check the announcements section below for active service areas!
      </div>

      {/* Main Header / Navigation */}
      <header className="sticky top-0 bg-white/95 backdrop-blur z-40 border-b border-slate-100 transition-all shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="relative h-13 w-13 rounded-2xl overflow-hidden bg-slate-900 border-2 border-blue-500/30 shadow-md shadow-blue-500/20 flex items-center justify-center p-0.5 group">
              <img 
                src="https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg"
                alt="Tagoloan Water District Logo"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';
                }}
                className="w-full h-full object-cover rounded-xl group-hover:scale-105 transition duration-300"
              />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900 font-sans">Tagoloan Water District</h1>
              <p className="text-[10px] uppercase tracking-widest font-black text-blue-600">Province of Misamis Oriental</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-slate-600">
            <a href="#profile" className="hover:text-blue-600 transition">About Us</a>
            <a href="#services" className="hover:text-blue-600 transition">Services & Tariff</a>
            <a href="#announcements" className="hover:text-blue-600 transition">Announcements</a>
            <a href="#calculator" className="hover:text-blue-600 transition">Bill Calculator</a>
            <a href="#faq" className="hover:text-blue-600 transition">FAQ</a>
            <a href="#contact" className="hover:text-blue-600 transition">Contact Support</a>
          </nav>
          <div className="flex items-center space-x-3">
            <button 
              id="nav-login-btn"
              onClick={() => onNavigate('login')}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-700 hover:text-blue-600 hover:bg-slate-50 transition border border-slate-200"
            >
              Sign In
            </button>
            <button 
              id="nav-register-btn"
              onClick={() => onNavigate('register')}
              className="px-5 py-2.5 bg-blue-600 shadow-md shadow-blue-150 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
            >
              Register Portal
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-blue-50/50 via-white to-slate-50 pt-16 pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center space-x-2 bg-blue-50 border border-blue-100 text-blue-700 px-3.5 py-1.5 rounded-full text-xs font-semibold">
                <Droplet className="h-3.5 w-3.5 fill-blue-500" />
                <span>Clean & Sustained Committment Since 1990</span>
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

      {/* Profile Section (Vision & Mission) */}
      <section id="profile" className="py-20 border-t border-slate-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-4 max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-blue-600">Organization Profile</h2>
            <h3 className="text-3xl sm:text-4xl font-extrabold text-slate-950 tracking-tight">
              Tagoloan Water District Objectives & Mandates
            </h3>
            <p className="text-slate-600 leading-relaxed">
              Established with the commitment to uplift household sanitation and environmental reliability, Tagoloan Water District strives to keep our local water pure, continuous, and responsive to growing community parameters.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* Vision card */}
            <div className="relative bg-slate-50 border border-slate-100 rounded-2xl p-8 hover:shadow-lg transition">
              <div className="absolute top-0 right-0 h-24 w-24 bg-blue-500/5 rounded-full blur-xl"></div>
              <div className="h-12 w-12 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center mb-6">
                <Compass className="h-6 w-6 stroke-[2]" />
              </div>
              <h4 className="text-xl font-bold text-slate-900 mb-3">Our Vision</h4>
              <p className="text-slate-600 leading-relaxed text-sm">
                To be a premier and highly viable water supply utility in Misamis Oriental, renowned for delivering premium quality, accessible water resources 24/7, supported by modern water treatment technologies and exceptional community-centered assistance. We envision a district where water resource conservation ensures abundant reserves for generations to come.
              </p>
            </div>

            {/* Mission card */}
            <div className="relative bg-slate-50 border border-slate-100 rounded-2xl p-8 hover:shadow-lg transition">
              <div className="absolute top-0 right-0 h-24 w-24 bg-blue-500/5 rounded-full blur-xl"></div>
              <div className="h-12 w-12 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center mb-6">
                <Building className="h-6 w-6 stroke-[2]" />
              </div>
              <h4 className="text-xl font-bold text-slate-900 mb-3">Our Mission</h4>
              <p className="text-slate-600 leading-relaxed text-sm font-sans">
                To construct, expand, operate, maintain, and secure a potable water-works mechanism system that systematically fulfills the residential, institutional, commercial, and agricultural development expectations in Tagoloan. We are committed to maintaining affordable progressive tariffs, safeguarding natural rivers, and empowering users with seamless transparency.
              </p>
            </div>
          </div>
        </div>
      </section>

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
                Tagoloan Water District utilizes a graded water tariff layout approved by the Local Water Utilities Administration (LWUA). This setup ensures small households enjoy low foundational rates while large commercial entities contribute proportionally to the support infrastructure.
              </p>

              <div className="bg-white border border-slate-150 p-5 rounded-2xl shadow-sm space-y-3">
                <div className="flex items-start space-x-3 text-xs text-slate-600">
                  <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span><strong>Minimum Charge</strong> is calculated on water consumption values zero up to ten (10) cubic meters.</span>
                </div>
                <div className="flex items-start space-x-3 text-xs text-slate-600">
                  <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span><strong>Service connection requests</strong> are processed at TWD administrative desk within 3-5 office business days.</span>
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
                      <th className="px-4 py-3">10 m³ Min</th>
                      <th className="px-4 py-3">11-20 m³</th>
                      <th className="px-4 py-3">21-30 m³</th>
                      <th className="px-4 py-3">31+ m³</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 text-xs font-medium">
                    <tr>
                      <td className="px-4 py-4 font-bold text-slate-900">Residential</td>
                      <td className="px-4 py-4">₱180.00</td>
                      <td className="px-4 py-4">₱20.00 / m³</td>
                      <td className="px-4 py-4">₱24.00 / m³</td>
                      <td className="px-4 py-4">₱30.00 / m³</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-4 font-bold text-slate-900">Commercial</td>
                      <td className="px-4 py-4">₱360.00</td>
                      <td className="px-4 py-4">₱40.00 / m³</td>
                      <td className="px-4 py-4">₱48.00 / m³</td>
                      <td className="px-4 py-4">₱60.00 / m³</td>
                    </tr>
                  </tbody>
                </table>
              </div>
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
                        onClick={() => setCalcType('residential')}
                        className={`py-2 rounded-lg text-xs font-bold transition border ${
                          calcType === 'residential' 
                            ? 'bg-blue-600 text-white border-blue-500' 
                            : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Residential
                      </button>
                      <button 
                        type="button"
                        onClick={() => setCalcType('commercial')}
                        className={`py-2 rounded-lg text-xs font-bold transition border ${
                          calcType === 'commercial' 
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
                    <p className="text-[10px] text-slate-400 mt-1">Includes basic structural 10 m³ minimum meter lease.</p>
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
            {announcements.map((ann) => {
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
                <div key={ann.id} className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between">
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
                <div className="flex items-center space-x-4 bg-white p-4 rounded-xl border border-slate-100">
                  <div className="h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Office Address</h4>
                    <p className="text-xs font-bold text-slate-800">Poblacion, Tagoloan, Misamis Oriental, PH</p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-white p-4 rounded-xl border border-slate-100">
                  <div className="h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hotline Contact Numbers</h4>
                    <p className="text-xs font-bold text-slate-800">(088) 555-0145 / 0917-882-1234</p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-white p-4 rounded-xl border border-slate-100">
                  <div className="h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email Inquiry Support</h4>
                    <p className="text-xs font-bold text-slate-800">support@tagoloanwater.gov.ph</p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 bg-white p-4 rounded-xl border border-slate-100">
                  <div className="h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">District Working Hours</h4>
                    <p className="text-xs font-bold text-slate-800">Monday - Friday: 8:00 AM - 5:00 PM</p>
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
          <p className="text-xs max-w-xl mx-auto leading-relaxed">
            Tagoloan Water District is committed to preserving environmental integrity while delivering continuous municipal services. All billing and logging statistics synchronised for testing purposes across these local portals.
          </p>
          <div className="text-[10px] text-slate-500">
            &copy; 2026 Tagoloan Water District. All Rights Reserved. Created and managed internally by TWD IT Div.
          </div>
        </div>
      </footer>
    </div>
  );
}

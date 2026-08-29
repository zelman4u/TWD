import React, { useState } from 'react';
import { 
  Building2, 
  Compass, 
  Target, 
  Award, 
  Droplets, 
  MapPin, 
  Calendar, 
  ShieldCheck, 
  Users, 
  Network, 
  Layers, 
  Wrench, 
  FileSpreadsheet, 
  Sparkles,
  CheckCircle2,
  HelpCircle,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Clock,
  Phone,
  Mail
} from 'lucide-react';

interface DistrictProfileSectionProps {
  id?: string;
  isDarkTheme?: boolean;
}

export const DistrictProfileSection: React.FC<DistrictProfileSectionProps> = ({ 
  id = "profile",
  isDarkTheme = false 
}) => {
  const [isOrgTreeExpanded, setIsOrgTreeExpanded] = useState(true);

  return (
    <section 
      id={id} 
      className={`py-20 transition-colors ${
        isDarkTheme ? 'bg-slate-950 text-slate-100 border-t border-slate-900' : 'bg-white text-slate-900 border-t border-slate-100'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        
        {/* Section Header */}
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest bg-blue-500/10 text-blue-700 border border-blue-500/20">
            <Building2 className="h-4 w-4" />
            <span>Official Institutional Profile & Mandate</span>
          </div>
          <h2 className={`text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-950'}`}>
            Tagoloan Water District
          </h2>
          <p className={`text-sm sm:text-base font-semibold leading-relaxed ${isDarkTheme ? 'text-slate-200' : 'text-slate-700'}`}>
            Province of Misamis Oriental • Government Owned and Controlled Corporation (GOCC)
          </p>
        </div>

        {/* 1. Legal Background & Institutional Profile Banner */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 text-white rounded-3xl p-6 sm:p-10 shadow-2xl border border-slate-800 relative overflow-hidden">
          {/* Ambient light glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div className="relative space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="flex items-center space-x-4">
                <div className="h-14 w-14 rounded-2xl bg-blue-600/20 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0 shadow-inner">
                  <Award className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-black text-white uppercase tracking-wider">
                    Tagoloan Water District (TWD)
                  </h3>
                  <p className="text-xs text-blue-300 font-medium flex items-center gap-1.5 mt-0.5">
                    <MapPin className="h-3.5 w-3.5 text-rose-400" />
                    <span>Arellano St, Poblacion, Tagoloan, Misamis Oriental, Philippines</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-3 py-1.5 bg-blue-950/80 border border-blue-500/30 text-blue-300 font-bold rounded-xl font-mono">
                  GOCC • PD 198
                </span>
                <span className="px-3 py-1.5 bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 font-bold rounded-xl font-mono">
                  CCC No. 634
                </span>
                <span className="px-3 py-1.5 bg-sky-950/80 border border-sky-500/30 text-sky-300 font-bold rounded-xl font-mono">
                  Category “D” LWD
                </span>
              </div>
            </div>

            {/* Quick Contact & Office Hours Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1 pb-1">
              <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 flex items-center space-x-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Opening Hours</span>
                  <span className="text-xs font-black text-white truncate block">Mon-Fri: 8:00am – 5:00pm</span>
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 flex items-center space-x-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                  <Phone className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Call Us</span>
                  <a href="tel:0888904946" className="text-xs font-black text-emerald-300 hover:underline truncate block">
                    (088) 890 – 4946
                  </a>
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 flex items-center space-x-3">
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Email Us</span>
                  <a href="mailto:tagoloan_waterdistrict@yahoo.com" className="text-xs font-black text-amber-300 hover:underline truncate block">
                    tagoloan_waterdistrict@yahoo.com
                  </a>
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 flex items-center space-x-3">
                <div className="h-8 w-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0">
                  <MapPin className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Visit Our Office</span>
                  <span className="text-xs font-black text-white truncate block">Arellano St, Poblacion</span>
                </div>
              </div>
            </div>

            {/* Narrative Legal Profile */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center text-slate-100 text-sm sm:text-base leading-relaxed">
              <div className="lg:col-span-8 space-y-4 font-normal">
                <p>
                  <strong className="text-white font-bold text-base sm:text-lg">Tagoloan Water District (TWD)</strong> is a <span className="text-sky-300 font-bold bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-800/60">Government Owned and Controlled Corporation (GOCC)</span> duly organized and existing under <strong className="text-blue-300 font-bold">Presidential Decree (PD) No. 198</strong>, as amended, with office address at <strong className="text-amber-300 font-bold">Arellano St, Poblacion, Tagoloan, Misamis Oriental</strong>.
                </p>
                <p>
                  It was formed on <strong className="text-white font-bold">February 23, 2009</strong> by virtue of <span className="text-sky-200 font-semibold">Sangguniang Bayan / Sangguniang Panglungsod Resolution No. 5, series of 2009</span>. It was granted a <span className="text-emerald-300 font-bold">Conditional Certificate of Conformance No. 634 on March 10, 2009</span> by the <strong className="text-white font-bold">Local Water Utilities Administration (LWUA)</strong> and was categorized as a Small Water District.
                </p>
                <p>
                  Subsequently, TWD was categorized as a <span className="text-emerald-300 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-700/60">Category “D” Water District</span> in compliance to <strong className="text-white font-bold">DBM Circular No. 2011-10 on LWD-MaCRO</strong> (Macro-Organization of Local Water Districts).
                </p>
              </div>

              {/* Water Sources & Service Coverage Highlight Card */}
              <div className="lg:col-span-4 bg-slate-950 border-2 border-slate-700 rounded-2xl p-5 space-y-4 shadow-lg">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-300 border-b border-slate-700 pb-2.5 flex items-center gap-2">
                  <Droplets className="h-4 w-4 text-sky-400" />
                  <span>Coverage & Water Sources</span>
                </h4>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-slate-300 font-medium">Service Coverage:</span>
                    <span className="font-bold text-white bg-blue-600 px-3 py-1 rounded-lg shadow-xs">
                      7 Local Barangays
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-slate-300 font-medium">Spring Water Source:</span>
                    <span className="font-black text-emerald-400 font-mono text-sm">1 Active Spring</span>
                  </div>

                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-slate-300 font-medium">Deep Well Extraction:</span>
                    <span className="font-black text-sky-400 font-mono text-sm">3 Engineered Wells</span>
                  </div>

                  <div className="pt-2.5 border-t border-slate-800 text-xs text-slate-300 font-medium flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Conforms to Philippine National Drinking Standards</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Mission & Vision Dual Card Grid - High Contrast & High Legibility */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* VISION CARD */}
          <div className="bg-white border-2 border-blue-600 rounded-3xl p-8 sm:p-10 shadow-lg relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl pointer-events-none"></div>
            
            <div>
              <div className="flex items-center space-x-4 mb-6">
                <div className="h-14 w-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-600/30 shrink-0">
                  <Compass className="h-7 w-7 stroke-[2.5]" />
                </div>
                <div>
                  <span className="text-xs font-black tracking-widest uppercase text-blue-700 block">Direction & Aspiration</span>
                  <h3 className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight">Our Vision</h3>
                </div>
              </div>

              <div className="relative bg-blue-50/70 border-l-4 border-blue-600 p-5 sm:p-6 rounded-r-2xl shadow-inner mb-6">
                <p className="text-slate-950 text-base sm:text-lg lg:text-xl font-bold leading-relaxed tracking-normal">
                  “To become a premier local water district providing sufficient and potable water that conforms to the standards of quality, and be the beacon of public service in terms of efficient and effective performance.”
                </p>
              </div>
            </div>

            <div className="pt-4 border-t-2 border-slate-100 flex flex-wrap gap-2 text-xs sm:text-sm font-black text-blue-900">
              <span className="px-3 py-1.5 bg-blue-100/90 text-blue-950 rounded-xl border border-blue-200">Premier Local Water District</span>
              <span className="px-3 py-1.5 bg-blue-100/90 text-blue-950 rounded-xl border border-blue-200">Potable Quality Standards</span>
              <span className="px-3 py-1.5 bg-blue-100/90 text-blue-950 rounded-xl border border-blue-200">Beacon of Public Service</span>
            </div>
          </div>

          {/* MISSION CARD */}
          <div className="bg-white border-2 border-emerald-600 rounded-3xl p-8 sm:p-10 shadow-lg relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
            
            <div>
              <div className="flex items-center space-x-4 mb-6">
                <div className="h-14 w-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 shrink-0">
                  <Target className="h-7 w-7 stroke-[2.5]" />
                </div>
                <div>
                  <span className="text-xs font-black tracking-widest uppercase text-emerald-700 block">Commitment & Mandate</span>
                  <h3 className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight">Our Mission</h3>
                </div>
              </div>

              <div className="relative bg-emerald-50/70 border-l-4 border-emerald-600 p-5 sm:p-6 rounded-r-2xl shadow-inner mb-6">
                <p className="text-slate-950 text-base sm:text-lg lg:text-xl font-bold leading-relaxed tracking-normal">
                  “To supply adequate and safe water and to keep apace with industrial and social progress while recognizing the need to preserve the natural environment to sustain development.”
                </p>
              </div>
            </div>

            <div className="pt-4 border-t-2 border-slate-100 flex flex-wrap gap-2 text-xs sm:text-sm font-black text-emerald-900">
              <span className="px-3 py-1.5 bg-emerald-100/90 text-emerald-950 rounded-xl border border-emerald-200">Adequate & Safe Water</span>
              <span className="px-3 py-1.5 bg-emerald-100/90 text-emerald-950 rounded-xl border border-emerald-200">Industrial & Social Progress</span>
              <span className="px-3 py-1.5 bg-emerald-100/90 text-emerald-950 rounded-xl border border-emerald-200">Environmental Preservation</span>
            </div>
          </div>

        </div>

        {/* 3. Core Values: The "T - W - D" Pillars */}
        <div className={`border-2 rounded-3xl p-6 sm:p-10 space-y-8 shadow-md transition-colors ${
          isDarkTheme ? 'bg-slate-900/90 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-950'
        }`}>
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest bg-blue-600 text-white shadow-sm">
              <Award className="h-4 w-4" />
              <span>Core Corporate Values</span>
            </div>
            <h3 className={`text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight ${
              isDarkTheme ? 'text-white' : 'text-slate-950'
            }`}>
              The Living Pillars of T – W – D
            </h3>
            <p className={`text-sm sm:text-base font-semibold leading-relaxed ${
              isDarkTheme ? 'text-slate-200' : 'text-slate-700'
            }`}>
              Guiding our personnel and management in delivering dependable, honest, and prompt public service to the residents of Tagoloan.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* T Pillar */}
            <div className={`border-2 rounded-2xl p-6 sm:p-7 shadow-lg transition duration-200 hover:-translate-y-1 flex flex-col justify-between ${
              isDarkTheme 
                ? 'bg-slate-950 border-blue-500/80 shadow-blue-950/40 text-white' 
                : 'bg-white border-blue-600 shadow-blue-100 text-slate-950'
            }`}>
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <span className="h-14 w-14 rounded-2xl bg-blue-600 text-white font-black text-3xl flex items-center justify-center shadow-lg shadow-blue-600/30 shrink-0">
                    T
                  </span>
                  <div>
                    <span className="text-xs font-black text-blue-600 uppercase tracking-widest block">Performance Standard</span>
                    <h4 className={`text-lg sm:text-xl font-black uppercase tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-950'}`}>
                      Trustworthy & Efficient
                    </h4>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border-l-4 border-blue-600 shadow-inner ${
                  isDarkTheme ? 'bg-slate-900/90 border-slate-800' : 'bg-blue-50/80 border-blue-200'
                }`}>
                  <p className={`text-base sm:text-lg font-bold leading-relaxed ${
                    isDarkTheme ? 'text-slate-100' : 'text-slate-950'
                  }`}>
                    <span className="text-blue-600 font-extrabold underline decoration-blue-400">To commitment</span> to efficient and trustworthy performance in carrying out our role as water provider.
                  </p>
                </div>
              </div>

              <div className={`mt-6 pt-4 border-t-2 flex items-center justify-between text-xs font-black ${
                isDarkTheme ? 'border-slate-800 text-blue-400' : 'border-slate-100 text-blue-800'
              }`}>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <span>Operational Excellence</span>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 uppercase tracking-wider text-[10px]">
                  Pillar 01
                </span>
              </div>
            </div>

            {/* W Pillar */}
            <div className={`border-2 rounded-2xl p-6 sm:p-7 shadow-lg transition duration-200 hover:-translate-y-1 flex flex-col justify-between ${
              isDarkTheme 
                ? 'bg-slate-950 border-sky-500/80 shadow-sky-950/40 text-white' 
                : 'bg-white border-sky-600 shadow-sky-100 text-slate-950'
            }`}>
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <span className="h-14 w-14 rounded-2xl bg-sky-600 text-white font-black text-3xl flex items-center justify-center shadow-lg shadow-sky-600/30 shrink-0">
                    W
                  </span>
                  <div>
                    <span className="text-xs font-black text-sky-600 uppercase tracking-widest block">Consumer Centered</span>
                    <h4 className={`text-lg sm:text-xl font-black uppercase tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-950'}`}>
                      Willingly Serving
                    </h4>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border-l-4 border-sky-600 shadow-inner ${
                  isDarkTheme ? 'bg-slate-900/90 border-slate-800' : 'bg-sky-50/80 border-sky-200'
                }`}>
                  <p className={`text-base sm:text-lg font-bold leading-relaxed ${
                    isDarkTheme ? 'text-slate-100' : 'text-slate-950'
                  }`}>
                    <span className="text-sky-600 font-extrabold underline decoration-sky-400">Willingly cater</span> to the needs and concerns of the consumers by providing appropriate assistance, addressing such without delay and doing so in accordance to the service standards that we live by.
                  </p>
                </div>
              </div>

              <div className={`mt-6 pt-4 border-t-2 flex items-center justify-between text-xs font-black ${
                isDarkTheme ? 'border-slate-800 text-sky-400' : 'border-slate-100 text-sky-800'
              }`}>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-sky-600" />
                  <span>Prompt Response</span>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-sky-500/10 border border-sky-500/20 uppercase tracking-wider text-[10px]">
                  Pillar 02
                </span>
              </div>
            </div>

            {/* D Pillar */}
            <div className={`border-2 rounded-2xl p-6 sm:p-7 shadow-lg transition duration-200 hover:-translate-y-1 flex flex-col justify-between ${
              isDarkTheme 
                ? 'bg-slate-950 border-indigo-500/80 shadow-indigo-950/40 text-white' 
                : 'bg-white border-indigo-600 shadow-indigo-100 text-slate-950'
            }`}>
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <span className="h-14 w-14 rounded-2xl bg-indigo-600 text-white font-black text-3xl flex items-center justify-center shadow-lg shadow-indigo-600/30 shrink-0">
                    D
                  </span>
                  <div>
                    <span className="text-xs font-black text-indigo-600 uppercase tracking-widest block">Civil Servant Ethics</span>
                    <h4 className={`text-lg sm:text-xl font-black uppercase tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-950'}`}>
                      Dedicated Service
                    </h4>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border-l-4 border-indigo-600 shadow-inner ${
                  isDarkTheme ? 'bg-slate-900/90 border-slate-800' : 'bg-indigo-50/80 border-indigo-200'
                }`}>
                  <p className={`text-base sm:text-lg font-bold leading-relaxed ${
                    isDarkTheme ? 'text-slate-100' : 'text-slate-950'
                  }`}>
                    <span className="text-indigo-600 font-extrabold underline decoration-indigo-400">Dedicate ourselves</span> to true public service in the proper implementation of policies and guidelines, while conducting ourselves in a manner consistent with that expected of civil servant.
                  </p>
                </div>
              </div>

              <div className={`mt-6 pt-4 border-t-2 flex items-center justify-between text-xs font-black ${
                isDarkTheme ? 'border-slate-800 text-indigo-400' : 'border-slate-100 text-indigo-800'
              }`}>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  <span>Integrity & Public Service</span>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 uppercase tracking-wider text-[10px]">
                  Pillar 03
                </span>
              </div>
            </div>

          </div>
        </div>

        {/* 4. Tagoloan Water District Organizational Structure & Staffing Pattern */}
        <div className="space-y-8" id="org-structure">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <div className="inline-flex items-center space-x-2 text-xs font-black uppercase tracking-widest text-blue-600">
                <Network className="h-4 w-4" />
                <span>Tagoloan Water District • Misamis Oriental</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-1">
                Organizational Structure & Staffing Pattern
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Category “D” LWD-MaCRO Staffing Framework approved under Civil Service Commission and DBM standards.
              </p>
            </div>

            <button
              onClick={() => setIsOrgTreeExpanded(!isOrgTreeExpanded)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center space-x-1.5 self-start sm:self-auto cursor-pointer"
            >
              <span>{isOrgTreeExpanded ? 'Collapse Flowchart' : 'Expand Flowchart'}</span>
              {isOrgTreeExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {/* Graphical Hierarchy Tree View */}
          {isOrgTreeExpanded && (
            <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-10 border border-slate-800 shadow-xl space-y-8 overflow-x-auto">
              
              {/* Level 1: Board of Directors */}
              <div className="flex flex-col items-center">
                <div className="bg-gradient-to-r from-blue-700 via-indigo-600 to-blue-700 text-white px-8 py-4 rounded-2xl shadow-xl border-2 border-blue-400/40 text-center max-w-md w-full">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-200 block">Policy & Governance</span>
                  <h4 className="text-base sm:text-lg font-black tracking-wide uppercase">BOARD OF DIRECTORS</h4>
                  <p className="text-[11px] text-blue-100 font-medium">Policy Formulation & Legislative Water District Authority</p>
                </div>
                
                {/* Connecting Line */}
                <div className="h-8 w-0.5 bg-blue-500/50"></div>
                <div className="h-2 w-2 rounded-full bg-blue-400"></div>
                <div className="h-8 w-0.5 bg-blue-500/50"></div>

                {/* Level 2: General Manager D */}
                <div className="bg-gradient-to-r from-slate-800 via-blue-900 to-slate-800 text-white px-8 py-4 rounded-2xl shadow-xl border-2 border-sky-400/50 text-center max-w-md w-full">
                  <span className="text-[10px] font-black uppercase tracking-widest text-sky-300 block">Executive Leadership</span>
                  <h4 className="text-base sm:text-lg font-black tracking-wide uppercase">GENERAL MANAGER D</h4>
                  <p className="text-[11px] text-slate-300 font-medium">Head of Procuring Entity & Executive Operational Lead</p>
                </div>

                {/* Connecting Trunk to 3 Sections */}
                <div className="h-10 w-0.5 bg-blue-500/50"></div>
                <div className="hidden lg:block w-3/4 h-0.5 bg-blue-500/50 relative">
                  <div className="absolute left-0 top-0 h-4 w-0.5 bg-blue-500/50"></div>
                  <div className="absolute left-1/2 -translate-x-1/2 top-0 h-4 w-0.5 bg-blue-500/50"></div>
                  <div className="absolute right-0 top-0 h-4 w-0.5 bg-blue-500/50"></div>
                </div>
              </div>

              {/* Level 3: 3 Sections Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
                
                {/* 1. Administrative & Commercial Services */}
                <div className="bg-slate-950 border-2 border-indigo-500/40 rounded-2xl p-5 space-y-4 shadow-lg flex flex-col justify-between">
                  <div>
                    <div className="bg-indigo-950/80 border border-indigo-500/50 text-indigo-300 p-3 rounded-xl text-center mb-4">
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400 block">Division Section 1</span>
                      <h5 className="text-xs font-black uppercase tracking-wide text-white">
                        ADMINISTRATIVE AND COMMERCIAL SERVICES SECTION
                      </h5>
                    </div>

                    <div className="space-y-2">
                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-indigo-400 block uppercase">1 Position</span>
                        <p className="text-xs font-extrabold text-white">ADMINISTRATIVE / GENERAL SERVICE OFFICER A</p>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-indigo-400 block uppercase">1 Position</span>
                        <p className="text-xs font-extrabold text-white">UTILITIES / CUSTOMER SERVICE ASSISTANT D</p>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-indigo-400 block uppercase">1 Position</span>
                        <p className="text-xs font-extrabold text-white">UTILITIES / CUSTOMER SERVICE ASSISTANT E</p>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-indigo-400 block uppercase">2 Positions</span>
                        <p className="text-xs font-extrabold text-white">UTILITY WORKER B</p>
                        <p className="text-xs font-extrabold text-white">UTILITY WORKER B</p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-[10px] font-mono text-indigo-300 text-center">
                    Total: 5 Staff Personnel
                  </div>
                </div>

                {/* 2. Operation / Technical Section */}
                <div className="bg-slate-950 border-2 border-cyan-500/40 rounded-2xl p-5 space-y-4 shadow-lg flex flex-col justify-between">
                  <div>
                    <div className="bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 p-3 rounded-xl text-center mb-4">
                      <span className="text-[9px] font-black uppercase tracking-widest text-cyan-400 block">Division Section 2</span>
                      <h5 className="text-xs font-black uppercase tracking-wide text-white">
                        OPERATION / TECHNICAL SECTION
                      </h5>
                    </div>

                    <div className="space-y-2">
                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-cyan-400 block uppercase">1 Position</span>
                        <p className="text-xs font-extrabold text-white">ENGINEER B</p>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl space-y-1">
                        <span className="text-[10px] font-bold text-cyan-400 block uppercase">3 Positions</span>
                        <p className="text-xs font-extrabold text-white">WATER RESOURCES FACILITIES OPERATOR C</p>
                        <p className="text-xs font-extrabold text-white">WATER RESOURCES FACILITIES OPERATOR C</p>
                        <p className="text-xs font-extrabold text-white">WATER RESOURCES FACILITIES OPERATOR C</p>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-cyan-400 block uppercase">1 Position</span>
                        <p className="text-xs font-extrabold text-white">WATER RESOURCES FACILITIES TENDER B</p>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-cyan-400 block uppercase">1 Position</span>
                        <p className="text-xs font-extrabold text-white">WATER RESOURCES FACILITIES TENDER C</p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-[10px] font-mono text-cyan-300 text-center">
                    Total: 6 Staff Personnel
                  </div>
                </div>

                {/* 3. Finance Section */}
                <div className="bg-slate-950 border-2 border-emerald-500/40 rounded-2xl p-5 space-y-4 shadow-lg flex flex-col justify-between">
                  <div>
                    <div className="bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 p-3 rounded-xl text-center mb-4">
                      <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400 block">Division Section 3</span>
                      <h5 className="text-xs font-black uppercase tracking-wide text-white">
                        FINANCE SECTION
                      </h5>
                    </div>

                    <div className="space-y-2">
                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-emerald-400 block uppercase">1 Position</span>
                        <p className="text-xs font-extrabold text-white">SR. ACCOUNTING PROCESSOR A</p>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[10px] font-bold text-emerald-400 block uppercase">1 Position</span>
                        <p className="text-xs font-extrabold text-white">CASHIER C</p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-[10px] font-mono text-emerald-300 text-center">
                    Total: 2 Staff Personnel
                  </div>
                </div>

              </div>

            </div>
          )}
        </div>

      </div>
    </section>
  );
};
export default DistrictProfileSection;

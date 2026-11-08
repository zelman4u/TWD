/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Tagoloan Water District - Baymax AI Assistant Widget
 * 
 * Consumer Portal: Baymax 1.0 (Your AI Consumer Companion.)
 * Admin Portal:    Baymax 2.0 (Your Admin Companion)
 * 
 * Features:
 * - Multi-turn conversation thread with persistent history
 * - Powered by Google Gemini 3.8 Flash
 * - Full multilingual fluency: English, Tagalog (Filipino), and Bisaya (Cebuano)
 * - Language selector & dynamic suggestions
 * - Markdown rendering, copy-to-clipboard, auto-scroll, minimize/expand
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Send,
  X,
  Minimize2,
  Maximize2,
  RotateCcw,
  Copy,
  Check,
  Globe,
  Sparkles,
  Heart,
  ShieldCheck,
  Droplets,
  HelpCircle,
  Volume2,
  VolumeX,
  ChevronDown
} from 'lucide-react';
import {
  ChatPortalType,
  ChatLanguage,
  ChatMessage,
  getStoredChatHistory,
  saveChatHistory,
  clearStoredChatHistory,
  sendBaymaxChatMessage
} from '../../services/aiChatService';

interface BaymaxChatWidgetProps {
  mode: ChatPortalType;
  consumer?: any;
  bills?: any[];
  adminUser?: any;
  stats?: any;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const BaymaxChatWidget: React.FC<BaymaxChatWidgetProps> = ({
  mode,
  consumer,
  bills,
  adminUser,
  stats,
  defaultOpen = false,
  isOpen: externalIsOpen,
  onOpenChange,
}) => {
  const isConsumer = mode === 'consumer';
  const botName = isConsumer ? 'Baymax 1.0' : 'Baymax 2.0';
  const botSubtitle = isConsumer ? 'Your AI Consumer Companion.' : 'Your Admin Companion';

  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);
  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;

  const setIsOpen = (nextOpen: boolean) => {
    setInternalIsOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const [isExpanded, setIsExpanded] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);
  const [showGreetingBubble, setShowGreetingBubble] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [language, setLanguage] = useState<ChatLanguage>('auto');
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Play subtle sound on response
  const playChime = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isConsumer ? 587.33 : 440, audioCtx.currentTime); // D5 or A4
      osc.frequency.exponentialRampToValueAtTime(isConsumer ? 880 : 659.25, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch {}
  };

  // Initial welcome message per portal & language
  const getInitialGreeting = (): string => {
    if (isConsumer) {
      const consumerName = consumer?.name || 'Valued Consumer';
      return `Hello, **${consumerName}**! I am **Baymax 1.0**, your AI Consumer Companion for Tagoloan Water District. 

Nakasabot ug makatubag ko sa **Bisaya, Tagalog, ug English**. On a scale of 1 to 10, how may I assist you with your water bill, meter reading, or service inquiry today?`;
    } else {
      const officer = adminUser?.name || 'Administrator';
      return `Greetings, **${officer}**! I am **Baymax 2.0**, your Admin Companion for Tagoloan Water District.

I provide operational assistance in **English, Tagalog, and Bisaya** for billing calculation, arrears carrying, delinquent account scanning, and meter reader telemetry. What operation shall we review?`;
    }
  };

  // Load chat history or set initial greeting
  useEffect(() => {
    const stored = getStoredChatHistory(mode);
    if (stored && stored.length > 0) {
      setMessages(stored);
      setHasGreeted(true);
    } else {
      const initial: ChatMessage = {
        id: `msg_init_${Date.now()}`,
        role: 'model',
        text: getInitialGreeting(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        language: 'en'
      };
      setMessages([initial]);
      saveChatHistory(mode, [initial]);
      setHasGreeted(true);
    }
  }, [mode]);

  // Auto-scroll to bottom on messages change
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, isOpen]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setShowGreetingBubble(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Auto-dismiss greeting bubble after 10s
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowGreetingBubble(false);
    }, 12000);
    return () => clearTimeout(timer);
  }, []);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isTyping) return;

    setInputMessage('');

    const userMsg: ChatMessage = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    saveChatHistory(mode, newHistory);
    setIsTyping(true);

    // Build context
    const contextData: Record<string, any> = {};
    if (isConsumer && consumer) {
      contextData.name = consumer.name;
      contextData.accountNumber = consumer.accountNumber;
      contextData.address = consumer.address;
      contextData.barangay = consumer.barangay;
      contextData.meterNumber = consumer.meterNumber;
      contextData.status = consumer.status;
      contextData.outstandingBalance = consumer.outstandingBalance || 0;
      contextData.unpaidCount = Array.isArray(bills)
        ? bills.filter((b) => b.paymentStatus !== 'paid').length
        : 0;
    } else if (!isConsumer) {
      contextData.adminName = adminUser?.name || 'Administrator';
      contextData.role = adminUser?.role || 'System Admin';
      contextData.stats = stats;
    }

    try {
      const response = await sendBaymaxChatMessage(mode, newHistory, language, contextData);
      
      const botMsg: ChatMessage = {
        id: `msg_model_${Date.now()}`,
        role: 'model',
        text: response.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: response.model,
      };

      const updatedHistory = [...newHistory, botMsg];
      setMessages(updatedHistory);
      saveChatHistory(mode, updatedHistory);
      playChime();
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `msg_err_${Date.now()}`,
        role: 'model',
        text: `Nangayo ko og pasaylo / Paumanhin / My apologies, but I had trouble reaching the district servers. Please check your network or try again in a moment.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleClearHistory = () => {
    if (window.confirm('Reset this conversation with Baymax?')) {
      clearStoredChatHistory(mode);
      const initial: ChatMessage = {
        id: `msg_init_${Date.now()}`,
        role: 'model',
        text: getInitialGreeting(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages([initial]);
      saveChatHistory(mode, [initial]);
    }
  };

  const handleCopyMessage = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Quick suggestions based on mode and language
  const getSuggestions = () => {
    if (isConsumer) {
      if (language === 'ceb') {
        return [
          'Pila akong bayranan karon?',
          'Unsa ang 50% partial payment rule?',
          'Unsaon pag-report ug tulo sa tubig?',
          'Kanus-a maputol akong linya kung dili mabayran?',
        ];
      }
      if (language === 'tl') {
        return [
          'Magkano ang aking kasalukuyang bill?',
          'Paano magbayad ng 50% partial payment?',
          'Paano mag-report ng tagas ng tubig?',
          'Ano ang patakaran sa disconnection?',
        ];
      }
      return [
        'How much is my current water bill?',
        'What is the 50% partial payment rule?',
        'How do I report a water leak or low pressure?',
        'How to schedule water meter installation?',
      ];
    } else {
      if (language === 'ceb') {
        return [
          'Unsaon pag-scan sa mga 3 ka bulan nga overdue?',
          'I-summarize ang collection ug billing status',
          'Unsaon pag-adjust sa water tariff rates?',
          'Ipakita ang route assignments sa mga meter reader',
        ];
      }
      if (language === 'tl') {
        return [
          'Paano i-scan ang mga 3-buwang overdue na account?',
          'Ipaliwanag ang arrears carryover calculation',
          'Paano mag-validate ng bagong installation request?',
          'Suriin ang delinquency rate ng mga barangay',
        ];
      }
      return [
        'Scan 3-month overdue accounts for cutting notices',
        'How does Arrears carryover work?',
        'Field meter readers route & sync status',
        'Generate compliance guidelines for COA & LWUA',
      ];
    }
  };

  // Helper to render simple markdown formatting
  const renderFormattedText = (raw: string) => {
    const lines = raw.split('\n');
    return lines.map((line, idx) => {
      // Bold tags
      let parsed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Inline code
      parsed = parsed.replace(/`(.*?)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[11px]">$1</code>');

      // Bullet lists
      if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
        return (
          <div key={idx} className="flex items-start space-x-2 my-1 pl-2">
            <span className="text-sky-400 mt-1 shrink-0">•</span>
            <span dangerouslySetInnerHTML={{ __html: parsed.replace(/^[-•]\s*/, '') }} />
          </div>
        );
      }
      // Numbered lists
      if (/^\d+\.\s/.test(line.trim())) {
        return (
          <div key={idx} className="flex items-start space-x-2 my-1 pl-2">
            <span className="text-sky-400 font-mono text-xs mt-0.5 shrink-0">{line.trim().match(/^\d+\./)?.[0]}</span>
            <span dangerouslySetInnerHTML={{ __html: parsed.replace(/^\d+\.\s*/, '') }} />
          </div>
        );
      }
      // Empty line spacer
      if (!line.trim()) {
        return <div key={idx} className="h-2" />;
      }
      return <p key={idx} className="leading-relaxed" dangerouslySetInnerHTML={{ __html: parsed }} />;
    });
  };

  return (
    <>
      {/* ============================================================ */}
      {/* FLOATING LAUNCHER BUTTON & GREETING TOAST                    */}
      {/* ============================================================ */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end space-y-3 pointer-events-auto">
        
        {/* Floating Greeting Toast */}
        {!isOpen && showGreetingBubble && (
          <div
            onClick={() => setIsOpen(true)}
            className="group relative max-w-xs bg-slate-900 border border-slate-700/80 rounded-2xl p-3.5 shadow-2xl cursor-pointer hover:border-sky-500/80 transition-all duration-300 transform hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-2"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowGreetingBubble(false);
              }}
              className="absolute -top-1.5 -right-1.5 p-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-full border border-slate-600 transition"
              aria-label="Dismiss greeting"
            >
              <X className="h-3 w-3" />
            </button>
            <div className="flex items-start space-x-2.5">
              <div className={`p-2 rounded-xl shrink-0 ${isConsumer ? 'bg-sky-500/20 text-sky-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {isConsumer ? <Heart className="h-4 w-4 animate-pulse" /> : <ShieldCheck className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs font-black text-white">{botName}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/60">
                    Online
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 line-clamp-2 mt-0.5 leading-snug">
                  {isConsumer
                    ? 'Kumusta! Unsaon nako pagtabang sa imong water bill karon? (English · Tagalog · Bisaya)'
                    : 'Baymax 2.0 ready. Operational & billing support in English, Tagalog & Bisaya.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Floating Round Launcher Button */}
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label={`Open ${botName}`}
            className={`group relative flex items-center space-x-2.5 px-4 py-3 rounded-full shadow-2xl transition-all duration-300 cursor-pointer transform hover:scale-105 active:scale-95 ${
              isConsumer
                ? 'bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 text-white hover:shadow-sky-500/30 hover:ring-4 hover:ring-sky-500/20'
                : 'bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-2 border-emerald-500/60 text-white hover:shadow-emerald-500/30 hover:ring-4 hover:ring-emerald-500/20'
            }`}
          >
            {/* Robot Avatar Icon with pulse */}
            <div className="relative flex items-center justify-center">
              <div className={`p-2 rounded-full ${isConsumer ? 'bg-white/20' : 'bg-emerald-500/20 text-emerald-400'}`}>
                <Bot className="h-5 w-5" />
              </div>
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>

            {/* Label */}
            <div className="text-left hidden sm:block">
              <div className="text-xs font-black tracking-tight flex items-center gap-1.5">
                <span>{botName}</span>
                <Sparkles className="h-3 w-3 text-amber-300 animate-spin-slow" />
              </div>
              <div className="text-[10px] text-slate-200/90 font-medium leading-none mt-0.5">
                {botSubtitle}
              </div>
            </div>
          </button>
        )}
      </div>

      {/* ============================================================ */}
      {/* EXPANDABLE CHAT MODAL / DRAWER                               */}
      {/* ============================================================ */}
      {isOpen && (
        <div
          className={`fixed z-50 transition-all duration-300 flex flex-col shadow-2xl overflow-hidden ${
            isExpanded
              ? 'inset-3 sm:inset-6 md:inset-10 rounded-2xl bg-slate-950 border border-slate-800'
              : 'bottom-4 right-4 sm:bottom-6 sm:right-6 w-[calc(100vw-2rem)] sm:w-[460px] max-h-[88vh] h-[640px] rounded-2xl bg-slate-950 border border-slate-800'
          }`}
        >
          {/* Header */}
          <div
            className={`px-4 sm:px-5 py-3.5 flex items-center justify-between border-b shrink-0 ${
              isConsumer
                ? 'bg-gradient-to-r from-slate-900 via-sky-950/60 to-slate-900 border-sky-900/50'
                : 'bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-emerald-900/50'
            }`}
          >
            {/* Bot Identity */}
            <div className="flex items-center space-x-3 min-w-0">
              <div
                className={`p-2.5 rounded-xl border shrink-0 ${
                  isConsumer
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                    : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                }`}
              >
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-black text-white truncate tracking-tight">{botName}</h3>
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Gemini 3.8 Flash
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">{botSubtitle}</p>
              </div>
            </div>

            {/* Window Controls */}
            <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0 ml-2">
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                title={soundEnabled ? 'Mute sound' : 'Enable sound'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
              >
                {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={handleClearHistory}
                title="Reset conversation"
                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800/80 transition cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? 'Minimize' : 'Expand full screen'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer hidden sm:block"
              >
                {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Close chat"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-red-500/20 hover:text-red-400 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Subheader: Language Selector Bar */}
          <div className="px-4 py-2 bg-slate-900/80 border-b border-slate-800/80 flex items-center justify-between gap-2 shrink-0 text-xs">
            <div className="flex items-center space-x-1.5 text-slate-400 font-medium">
              <Globe className="h-3.5 w-3.5 text-sky-400" />
              <span className="hidden sm:inline">Language:</span>
            </div>
            <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setLanguage('auto')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  language === 'auto'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                Auto Detect
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  language === 'en'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLanguage('tl')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  language === 'tl'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                Tagalog
              </button>
              <button
                type="button"
                onClick={() => setLanguage('ceb')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  language === 'ceb'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                Bisaya
              </button>
            </div>
          </div>

          {/* Scrollable Message Thread */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-slate-200 text-xs sm:text-sm">
            
            {/* Multilingual Welcome Banner */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 flex items-start space-x-2.5">
              <Sparkles className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-300">
                  {isConsumer ? 'Nakasabot ko sa Bisaya, Tagalog, ug English.' : 'Multi-Turn Operational Intelligence'}
                </p>
                <p className="mt-0.5 text-slate-400">
                  {isConsumer
                    ? 'Pangutana bahin sa imong bill, 50% partial payment rule, o pag-report ug tulo sa tubig.'
                    : 'Inquire on arrears forward calculation, 3-month overdue cutting notices, or field sync.'}
                </p>
              </div>
            </div>

            {/* Conversation Messages */}
            {messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <div
                  key={m.id}
                  className={`flex items-start space-x-2.5 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
                >
                  {/* Avatar */}
                  <div
                    className={`h-7 w-7 rounded-xl flex items-center justify-center shrink-0 text-xs font-black shadow-sm ${
                      isUser
                        ? 'bg-blue-600 text-white'
                        : isConsumer
                        ? 'bg-sky-600/20 text-sky-400 border border-sky-500/40'
                        : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40'
                    }`}
                  >
                    {isUser ? 'You' : <Bot className="h-4 w-4" />}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-md relative group ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-tr-none'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
                    }`}
                  >
                    <div className="space-y-1">{renderFormattedText(m.text)}</div>

                    {/* Metadata & Actions */}
                    <div
                      className={`flex items-center justify-between gap-3 text-[10px] mt-2 pt-1.5 border-t ${
                        isUser ? 'border-white/20 text-blue-200' : 'border-slate-800 text-slate-500'
                      }`}
                    >
                      <span>{m.timestamp}</span>

                      {!isUser && (
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(m.text, m.id)}
                          className="opacity-60 hover:opacity-100 flex items-center gap-1 transition cursor-pointer text-slate-400 hover:text-slate-200"
                        >
                          {copiedId === m.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Live Typing / Thinking Indicator */}
            {isTyping && (
              <div className="flex items-start space-x-2.5">
                <div
                  className={`h-7 w-7 rounded-xl flex items-center justify-center shrink-0 border ${
                    isConsumer
                      ? 'bg-sky-600/20 text-sky-400 border-sky-500/40'
                      : 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40'
                  }`}
                >
                  <Bot className="h-4 w-4" />
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none px-4 py-3 text-xs text-slate-400 shadow-md flex items-center space-x-2">
                  <span className="font-semibold text-slate-300">{botName} is thinking</span>
                  <div className="flex items-center space-x-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce"></span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Prompt Suggestion Chips */}
          <div className="px-4 py-2 bg-slate-900/40 border-t border-slate-800/80 flex items-center space-x-1.5 overflow-x-auto no-scrollbar shrink-0">
            {getSuggestions().map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(s)}
                disabled={isTyping}
                className="whitespace-nowrap px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/80 text-[11px] font-medium transition cursor-pointer disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Footer Input Area */}
          <div className="p-3.5 bg-slate-950 border-t border-slate-800 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-end space-x-2"
            >
              <div className="flex-1 bg-slate-900 border border-slate-800 focus-within:border-sky-500 rounded-xl px-3 py-2 transition-all">
                <textarea
                  ref={inputRef}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  rows={1}
                  placeholder={
                    isConsumer
                      ? 'Pangutana bahin sa bill, tulo, o serbisyo (Bisaya / Tagalog / English)...'
                      : 'Ask operational query, arrears calculation, or cutting notices...'
                  }
                  className="w-full bg-transparent text-slate-100 text-xs sm:text-sm placeholder-slate-500 focus:outline-none resize-none max-h-28"
                />
              </div>

              <button
                type="submit"
                disabled={!inputMessage.trim() || isTyping}
                className={`p-2.5 rounded-xl text-white font-bold transition shadow-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
                  isConsumer
                    ? 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700'
                    : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700'
                }`}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>

            <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 px-1">
              <span>Press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">Enter</kbd> to send</span>
              <span>Tagoloan Water District • Google Gemini AI</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

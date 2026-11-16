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
  ChevronDown,
  GripVertical,
  GripHorizontal,
  Move,
  LocateFixed
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
  const [confirmingReset, setConfirmingReset] = useState(false);

  // -------------------------------------------------------------
  // Draggable / Grabbable Position State & Storage
  // -------------------------------------------------------------
  const LAUNCHER_POS_KEY = 'twd_baymax_launcher_pos_v2';
  const MODAL_POS_KEY = 'twd_baymax_modal_pos_v2';

  const getDefaultLauncherPos = () => {
    if (typeof window === 'undefined') return { x: 20, y: 20 };
    const width = window.innerWidth;
    const height = window.innerHeight;
    const btnWidth = width < 640 ? 64 : 220;
    return {
      x: Math.max(16, width - btnWidth - 24),
      y: Math.max(16, height - 76),
    };
  };

  const getDefaultModalPos = () => {
    if (typeof window === 'undefined') return { x: 20, y: 20 };
    const width = window.innerWidth;
    const height = window.innerHeight;
    const modalWidth = Math.min(460, width - 32);
    const modalHeight = Math.min(640, height * 0.88);
    return {
      x: Math.max(16, width - modalWidth - 24),
      y: Math.max(16, height - modalHeight - 24),
    };
  };

  const [launcherPos, setLauncherPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(LAUNCHER_POS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          if (typeof window !== 'undefined') {
            const btnWidth = window.innerWidth < 640 ? 64 : 220;
            return {
              x: Math.min(Math.max(12, parsed.x), Math.max(12, window.innerWidth - btnWidth - 12)),
              y: Math.min(Math.max(12, parsed.y), Math.max(12, window.innerHeight - 76)),
            };
          }
          return parsed;
        }
      }
    } catch {}
    return getDefaultLauncherPos();
  });

  const [modalPos, setModalPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(MODAL_POS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          if (typeof window !== 'undefined') {
            const modalWidth = Math.min(460, window.innerWidth - 32);
            return {
              x: Math.min(Math.max(12, parsed.x), Math.max(12, window.innerWidth - modalWidth - 12)),
              y: Math.min(Math.max(12, parsed.y), Math.max(12, window.innerHeight - 100)),
            };
          }
          return parsed;
        }
      }
    } catch {}
    return getDefaultModalPos();
  });

  const [isDraggingLauncher, setIsDraggingLauncher] = useState(false);
  const [isDraggingModal, setIsDraggingModal] = useState(false);

  const launcherDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const hasDraggedLauncherRef = useRef(false);
  const ignoreLauncherClickUntilRef = useRef(0);

  const modalDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const hasDraggedModalRef = useRef(false);

  // Keep positions clamped inside viewport on screen resize
  useEffect(() => {
    const handleResize = () => {
      setLauncherPos((prev) => {
        const btnWidth = window.innerWidth < 640 ? 64 : 220;
        return {
          x: Math.min(Math.max(12, prev.x), Math.max(12, window.innerWidth - btnWidth - 12)),
          y: Math.min(Math.max(12, prev.y), Math.max(12, window.innerHeight - 76)),
        };
      });
      setModalPos((prev) => {
        const modalWidth = Math.min(460, window.innerWidth - 32);
        return {
          x: Math.min(Math.max(12, prev.x), Math.max(12, window.innerWidth - modalWidth - 12)),
          y: Math.min(Math.max(12, prev.y), Math.max(12, window.innerHeight - 100)),
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Launcher Drag Handlers
  const handleLauncherPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-drag="true"]')) return;

    launcherDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: launcherPos.x,
      origY: launcherPos.y,
    };
    hasDraggedLauncherRef.current = false;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleLauncherPointerMove = (e: React.PointerEvent) => {
    if (!launcherDragRef.current) return;
    const dx = e.clientX - launcherDragRef.current.startX;
    const dy = e.clientY - launcherDragRef.current.startY;

    if (!hasDraggedLauncherRef.current && Math.hypot(dx, dy) > 4) {
      hasDraggedLauncherRef.current = true;
      setIsDraggingLauncher(true);
    }

    if (hasDraggedLauncherRef.current) {
      const btnWidth = window.innerWidth < 640 ? 64 : 220;
      const nextX = Math.min(Math.max(10, launcherDragRef.current.origX + dx), Math.max(10, window.innerWidth - btnWidth - 10));
      const nextY = Math.min(Math.max(10, launcherDragRef.current.origY + dy), Math.max(10, window.innerHeight - 70));
      setLauncherPos({ x: nextX, y: nextY });
    }
  };

  const handleLauncherPointerUp = (e: React.PointerEvent) => {
    if (!launcherDragRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    if (hasDraggedLauncherRef.current) {
      ignoreLauncherClickUntilRef.current = Date.now() + 250;
      try {
        localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(launcherPos));
      } catch {}
    }

    launcherDragRef.current = null;
    setIsDraggingLauncher(false);
  };

  const handleLauncherClick = (e: React.MouseEvent) => {
    if (hasDraggedLauncherRef.current || Date.now() < ignoreLauncherClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setIsOpen(true);
  };

  const resetLauncherPosition = () => {
    const def = getDefaultLauncherPos();
    setLauncherPos(def);
    try {
      localStorage.removeItem(LAUNCHER_POS_KEY);
    } catch {}
  };

  // Modal Drag Handlers
  const handleModalPointerDown = (e: React.PointerEvent) => {
    if (isExpanded) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, textarea, a, select, [data-no-drag="true"]')) return;

    modalDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: modalPos.x,
      origY: modalPos.y,
    };
    hasDraggedModalRef.current = false;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleModalPointerMove = (e: React.PointerEvent) => {
    if (!modalDragRef.current || isExpanded) return;
    const dx = e.clientX - modalDragRef.current.startX;
    const dy = e.clientY - modalDragRef.current.startY;

    if (!hasDraggedModalRef.current && Math.hypot(dx, dy) > 4) {
      hasDraggedModalRef.current = true;
      setIsDraggingModal(true);
    }

    if (hasDraggedModalRef.current) {
      const modalWidth = Math.min(460, window.innerWidth - 32);
      const nextX = Math.min(Math.max(10, modalDragRef.current.origX + dx), Math.max(10, window.innerWidth - modalWidth - 10));
      const nextY = Math.min(Math.max(10, modalDragRef.current.origY + dy), Math.max(10, window.innerHeight - 90));
      setModalPos({ x: nextX, y: nextY });
    }
  };

  const handleModalPointerUp = (e: React.PointerEvent) => {
    if (!modalDragRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    if (hasDraggedModalRef.current) {
      try {
        localStorage.setItem(MODAL_POS_KEY, JSON.stringify(modalPos));
      } catch {}
    }

    modalDragRef.current = null;
    setIsDraggingModal(false);
  };

  const resetModalPosition = () => {
    const def = getDefaultModalPos();
    setModalPos(def);
    try {
      localStorage.removeItem(MODAL_POS_KEY);
    } catch {}
  };

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
    clearStoredChatHistory(mode);
    const initial: ChatMessage = {
      id: `msg_init_${Date.now()}`,
      role: 'model',
      text: getInitialGreeting(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages([initial]);
    saveChatHistory(mode, [initial]);
    setConfirmingReset(false);
  };

  const handleCopyMessage = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Quick suggestions based on mode, language, and conversation state
  const getSuggestions = () => {
    const lastBotMsg = messages[messages.length - 1]?.text || '';
    const hasAskedSatisfaction = lastBotMsg.includes('satisfied') || lastBotMsg.includes('care');

    if (isConsumer) {
      if (language === 'ceb') {
        const list = [
          'Pila akong bayranan karon?',
          'Kinsa ka, Baymax?',
          'Unsaon pagdaginot sa tubig?',
          'Unsa ang 50% partial payment rule?',
          'Asa dapit inyong opisina ug hotline?',
          'Joke bi, Baymax! 😄',
        ];
        if (hasAskedSatisfaction) {
          list.unshift('Satisfied na ko sa imong pag-atiman! ❤️');
        }
        return list;
      }
      if (language === 'tl') {
        const list = [
          'Magkano ang aking bill ngayon?',
          'Sino ka, Baymax?',
          'Tips sa pagtipid ng tubig',
          'Paano ang 50% partial payment?',
          'Saan po ang inyong opisina at hotline?',
          'Mag-joke ka naman! 😄',
        ];
        if (hasAskedSatisfaction) {
          list.unshift('Satisfied na po ako sa inyong pag-aalaga! ❤️');
        }
        return list;
      }
      const list = [
        'How much is my current water bill?',
        'Who are you, Baymax?',
        '5 tips to save water',
        'Explain the 50% partial payment rule',
        'Where is TWD office located?',
        'Tell me a water joke! 😄',
      ];
      if (hasAskedSatisfaction) {
        list.unshift('I am satisfied with my care! ❤️');
      }
      return list;
    } else {
      if (language === 'ceb') {
        return [
          'Unsaon pag-scan sa mga 3 ka bulan nga overdue?',
          'I-summarize ang collection ug billing status',
          'Unsaon pag-adjust sa water tariff rates?',
          'Ipakita ang route assignments sa mga meter reader',
          'Unsay status sa mga water meters karon?',
        ];
      }
      if (language === 'tl') {
        return [
          'Paano i-scan ang mga 3-buwang overdue na account?',
          'Ipaliwanag ang arrears carryover calculation',
          'Paano mag-validate ng bagong installation request?',
          'Suriin ang delinquency rate ng mga barangay',
          'Ipakita ang telemetry ng mga meter reader',
        ];
      }
      return [
        'Scan 3-month overdue accounts for cutting notices',
        'How does Arrears carryover calculation work?',
        'Field meter readers route & sync status',
        'Generate compliance guidelines for COA & LWUA',
        'Show active consumer & meter statistics',
      ];
    }
  };

  // Helper to render crisp readable message markdown
  const renderFormattedText = (raw: string, isUserMsg = false) => {
    const lines = raw.split('\n');
    return lines.map((line, idx) => {
      let parsed = line.replace(
        /\*\*(.*?)\*\*/g,
        isUserMsg
          ? '<strong class="font-semibold text-white">$1</strong>'
          : '<strong class="font-semibold text-white">$1</strong>'
      );
      parsed = parsed.replace(
        /`(.*?)`/g,
        '<code class="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-xs">$1</code>'
      );

      // Bullet lists
      if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
        return (
          <div key={idx} className="flex items-start gap-2 my-0.5 pl-1">
            <span className={isUserMsg ? 'text-blue-200 mt-0.5 shrink-0' : 'text-sky-400 mt-0.5 shrink-0'}>•</span>
            <span className="leading-[1.55] break-words" dangerouslySetInnerHTML={{ __html: parsed.replace(/^[-•]\s*/, '') }} />
          </div>
        );
      }
      // Numbered lists
      if (/^\d+\.\s/.test(line.trim())) {
        return (
          <div key={idx} className="flex items-start gap-2 my-0.5 pl-1">
            <span className={`${isUserMsg ? 'text-blue-200' : 'text-sky-400'} font-mono tabular-nums text-[11px] mt-0.5 shrink-0 font-semibold`}>
              {line.trim().match(/^\d+\./)?.[0]}
            </span>
            <span className="leading-[1.55] break-words" dangerouslySetInnerHTML={{ __html: parsed.replace(/^\d+\.\s*/, '') }} />
          </div>
        );
      }
      // Empty line spacer
      if (!line.trim()) {
        return <div key={idx} className="h-1.5" />;
      }
      return <p key={idx} className="leading-[1.55] break-words" dangerouslySetInnerHTML={{ __html: parsed }} />;
    });
  };

  return (
    <>
      {/* ============================================================ */}
      {/* FLOATING DRAGGABLE LAUNCHER BUTTON & COMPACT GREETING TOAST  */}
      {/* ============================================================ */}
      {!isOpen && (
        <div
          style={{
            position: 'fixed',
            left: `${launcherPos.x}px`,
            top: `${launcherPos.y}px`,
            zIndex: 9999,
          }}
          className="pointer-events-none select-none flex flex-col items-end"
        >
          {/* Compact Greeting Toast */}
          {showGreetingBubble && (
            <div
              data-no-drag="true"
              onClick={() => setIsOpen(true)}
              style={{
                position: 'absolute',
                [launcherPos.y > 220 ? 'bottom' : 'top']: 'calc(100% + 10px)',
                [launcherPos.x > (typeof window !== 'undefined' ? window.innerWidth / 2 : 400) ? 'right' : 'left']: 0,
              }}
              className="pointer-events-auto group w-72 sm:w-80 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-700/90 rounded-2xl p-3.5 shadow-2xl cursor-pointer hover:border-sky-500/70 transition duration-200"
            >
              <button
                type="button"
                data-no-drag="true"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowGreetingBubble(false);
                }}
                className="absolute top-2 right-2 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
                aria-label="Dismiss greeting"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-start gap-2.5 pr-5">
                <div className={`p-1.5 rounded-xl shrink-0 border mt-0.5 ${
                  isConsumer
                    ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                }`}>
                  {isConsumer ? <Heart className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-bold text-white">{botName}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className={isConsumer ? 'font-medium text-sky-400' : 'font-medium text-emerald-400'}>
                      Assistant Ready
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {isConsumer
                      ? 'Ask about your water bill, 50% partial payment, or reporting a leak (EN / TL / Bisaya).'
                      : 'Operational, arrears & billing guidance ready in EN, TL, and Bisaya.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Draggable Launcher Button */}
          <div
            onPointerDown={handleLauncherPointerDown}
            onPointerMove={handleLauncherPointerMove}
            onPointerUp={handleLauncherPointerUp}
            onPointerCancel={handleLauncherPointerUp}
            onClick={handleLauncherClick}
            onDoubleClick={resetLauncherPosition}
            title="Grab and drag anywhere to avoid blocking buttons behind • Click to open • Double-click to snap back"
            className={`pointer-events-auto touch-none group relative flex items-center space-x-2 px-3 sm:px-3.5 py-2 sm:py-2.5 rounded-full shadow-2xl transition-[box-shadow,transform,ring] duration-150 select-none ${
              isDraggingLauncher
                ? 'cursor-grabbing scale-105 ring-4 ring-sky-400/70 shadow-sky-500/50 opacity-95'
                : 'cursor-grab hover:scale-105 active:scale-95'
            } ${
              isConsumer
                ? 'bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 text-white hover:shadow-sky-500/30 hover:ring-4 hover:ring-sky-500/20'
                : 'bg-slate-900 border border-emerald-500/50 text-white hover:border-emerald-400 hover:shadow-emerald-500/20'
            }`}
          >
            <div
              className="p-0.5 text-white/60 group-hover:text-white transition flex items-center justify-center shrink-0"
              title="Drag to reposition"
            >
              <GripVertical className="h-4 w-4" />
            </div>

            <div className="relative flex items-center justify-center shrink-0">
              <div className={`p-1.5 rounded-full ${isConsumer ? 'bg-white/15' : 'bg-emerald-500/20 text-emerald-400'}`}>
                <Bot className="h-4 w-4" />
              </div>
            </div>

            <div className="text-left hidden sm:block pr-1">
              <div className="text-xs font-bold tracking-tight leading-none">{botName}</div>
              <div className="text-[11px] text-slate-200/85 font-medium leading-none mt-1">
                {botSubtitle}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* EXPANDABLE CHAT MODAL / DRAWER                               */}
      {/* ============================================================ */}
      {isOpen && (
        <div
          style={
            isExpanded
              ? undefined
              : {
                  position: 'fixed',
                  left: `${modalPos.x}px`,
                  top: `${modalPos.y}px`,
                  zIndex: 9999,
                }
          }
          className={`z-50 transition-[box-shadow,border-color] duration-150 flex flex-col shadow-2xl overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl ${
            isExpanded
              ? 'fixed inset-3 sm:inset-6 md:inset-10'
              : 'w-[calc(100vw-1.5rem)] sm:w-[410px] min-h-[380px] h-[min(560px,80vh)] max-h-[84vh]'
          }`}
        >
          {/* Compact Header - Grabbable / Draggable when not expanded */}
          <div
            onPointerDown={handleModalPointerDown}
            onPointerMove={handleModalPointerMove}
            onPointerUp={handleModalPointerUp}
            onPointerCancel={handleModalPointerUp}
            onDoubleClick={resetModalPosition}
            title={isExpanded ? undefined : 'Drag header to move chat window • Double-click to snap back'}
            className={`px-4 py-3 flex items-center justify-between border-b border-slate-800 bg-slate-950 shrink-0 select-none touch-none ${
              !isExpanded ? (isDraggingModal ? 'cursor-grabbing' : 'cursor-grab') : ''
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {!isExpanded && (
                <div className="text-slate-500 hover:text-slate-300 transition shrink-0" title="Drag to reposition">
                  <GripVertical className="h-4 w-4" />
                </div>
              )}
              <div
                className={`p-1.5 rounded-xl border shrink-0 ${
                  isConsumer
                    ? 'bg-sky-500/15 border-sky-500/30 text-sky-400'
                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                }`}
              >
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-white truncate tracking-tight leading-snug">{botName}</h3>
                  <span className="text-slate-600 text-xs" aria-hidden="true">·</span>
                  <span className={`text-[11px] font-semibold truncate ${isConsumer ? 'text-sky-400' : 'text-emerald-400'}`}>
                    {isConsumer ? 'Consumer Help' : 'Admin Companion'}
                  </span>
                </div>
              </div>
            </div>

            <div
              className="flex items-center gap-0.5 shrink-0 ml-2"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {!isExpanded && (
                <button
                  type="button"
                  data-no-drag="true"
                  onClick={resetModalPosition}
                  title="Snap chat window back to corner"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition cursor-pointer"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                type="button"
                data-no-drag="true"
                onClick={() => setSoundEnabled(!soundEnabled)}
                title={soundEnabled ? 'Mute sound' : 'Enable sound'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                data-no-drag="true"
                onClick={() => setConfirmingReset((prev) => !prev)}
                title="Reset conversation"
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  confirmingReset
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
                }`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                data-no-drag="true"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? 'Restore size' : 'Expand'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer hidden sm:block"
              >
                {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                data-no-drag="true"
                onClick={() => setIsOpen(false)}
                title="Close chat"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Inline Reset Confirmation Bar */}
          {confirmingReset && (
            <div className="px-4 py-2 bg-amber-950/60 border-b border-amber-500/30 flex items-center justify-between gap-2 text-xs shrink-0">
              <span className="text-amber-200 font-medium">Start a fresh conversation?</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer whitespace-nowrap"
                >
                  Keep Chat
                </button>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold cursor-pointer whitespace-nowrap"
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {/* Slim Language Selector Sub-bar */}
          <div className="px-4 py-1.5 bg-slate-950/50 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 text-xs">
            <div className="flex items-center gap-1.5 text-slate-400 font-medium">
              <Globe className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span className="text-[11px]">Reply Language</span>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {([
                { id: 'auto', label: 'Auto' },
                { id: 'en', label: 'English' },
                { id: 'tl', label: 'Tagalog' },
                { id: 'ceb', label: 'Bisaya' },
              ] as const).map((langOpt) => (
                <button
                  key={langOpt.id}
                  type="button"
                  onClick={() => setLanguage(langOpt.id)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                    language === langOpt.id
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  {langOpt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Message Thread */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 bg-slate-900 text-slate-100">
            {/* Compact helper tip shown only before user starts conversing */}
            {messages.length <= 1 && (
              <div className="rounded-xl bg-slate-950/75 border border-slate-800 px-3 py-2 flex items-center gap-2 text-xs text-slate-300">
                <Sparkles className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="leading-snug">
                  {isConsumer
                    ? 'Understands English, Tagalog, and Bisaya — ask about bills, 50% partial payment, or leaks.'
                    : 'Operational guidance ready for arrears, disconnection scanning, and reader telemetry.'}
                </span>
              </div>
            )}

            {/* Conversation Messages */}
            {messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-0.5 ${isUser ? 'items-end' : 'items-start'}`}
                >
                  {/* Aligned Speaker · Timestamp · Inline Copy Row */}
                  <div
                    className={`flex items-center gap-1.5 text-[11px] leading-tight text-slate-400 px-1 ${
                      isUser ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <span className={`font-medium ${isUser ? 'text-slate-300' : isConsumer ? 'text-sky-300' : 'text-emerald-300'}`}>
                      {isUser ? 'You' : botName}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      {m.timestamp}
                    </span>
                    {!isUser && (
                      <>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(m.text, m.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-white transition cursor-pointer"
                          title="Copy response"
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
                      </>
                    )}
                  </div>

                  {/* Compact Content-Proportioned Message Bubble */}
                  <div
                    className={`w-fit max-w-[84%] sm:max-w-[min(78%,60ch)] rounded-2xl px-3 py-2 text-[13.5px] leading-[1.55] break-words ${
                      isUser
                        ? 'rounded-tr-sm bg-blue-600 text-white border border-blue-500/70'
                        : 'rounded-tl-sm bg-slate-950 border border-slate-800 text-slate-100'
                    }`}
                  >
                    <div className="space-y-1.5">{renderFormattedText(m.text, isUser)}</div>
                  </div>
                </div>
              );
            })}

            {/* Live Typing / Thinking Indicator */}
            {isTyping && (
              <div className="flex flex-col items-start">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 px-0.5">
                    <span className={`font-semibold ${isConsumer ? 'text-sky-300' : 'text-emerald-300'}`}>
                      {botName}
                    </span>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2 text-xs text-slate-200 flex items-center gap-2">
                    <span>Thinking</span>
                    <div className="flex items-center space-x-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce"></span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompt Suggestions */}
          <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
            {getSuggestions().map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(s)}
                disabled={isTyping}
                className="whitespace-nowrap shrink-0 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-[11px] font-medium transition cursor-pointer disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Compact Footer Input Composer */}
          <div className="px-4 py-3 bg-slate-950 border-t border-slate-800 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-end gap-2"
            >
              <div className="flex-1 bg-slate-900 border border-slate-700 focus-within:border-sky-500 rounded-xl px-3 py-2 transition">
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
                      ? 'Ask about your bill, leak report, or water service...'
                      : 'Ask operational query, arrears calculation, or notices...'
                  }
                  className="w-full bg-transparent text-slate-100 text-[13.5px] leading-snug placeholder-slate-500 focus:outline-none resize-none max-h-24"
                />
              </div>

              <button
                type="submit"
                disabled={!inputMessage.trim() || isTyping}
                className={`px-3 py-2 rounded-xl text-white font-semibold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5 text-xs whitespace-nowrap ${
                  isConsumer
                    ? 'bg-blue-600 hover:bg-blue-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
                aria-label="Send message"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send</span>
              </button>
            </form>

            <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5">
              <span>Enter to send · Shift+Enter for new line</span>
              <span>Tagoloan Water District</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

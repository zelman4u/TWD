/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Tagoloan Water District - Real-Time WebSocket Synchronization Layer
 * Features exponential backoff, continuous reconnection, heartbeat watchdog,
 * offline recovery, message queuing, and rich telemetry logging.
 */

export type SocketState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: number | string;
}

// Global state trackers
let activeSocket: WebSocket | null = null;
let currentSocketState: SocketState = 'disconnected';
let reconnectTimer: any = null;
let heartbeatIntervalTimer: any = null;
let heartbeatWatchdogTimer: any = null;
let reconnectAttempts = 0;
let isManuallyClosed = false;
let lastHeartbeatPongTime = Date.now();

// Outbound message queue when socket is connecting/reconnecting
const outboundQueue: WebSocketMessage[] = [];
const MAX_QUEUE_SIZE = 30;

// Subscriptions
const messageListeners = new Set<(data: WebSocketMessage) => void>();
const stateListeners = new Set<(state: SocketState) => void>();

// Instant Cross-Tab BroadcastChannel Bus (works in 0ms even on Vercel/serverless without WebSockets)
const CLIENT_INSTANCE_ID = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let broadcastBus: BroadcastChannel | null = null;

function ensureBroadcastBus() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastBus) {
    try {
      broadcastBus = new BroadcastChannel('twd_realtime_bus_v1');
      broadcastBus.onmessage = (event) => {
        const data = event?.data;
        if (!data || !data.type || data.__senderTab === CLIENT_INSTANCE_ID) return;
        messageListeners.forEach((cb) => {
          try {
            cb(data);
          } catch (err) {
            console.warn('[Realtime Bus] Subscriber error:', err);
          }
        });
      };
    } catch {
      broadcastBus = null;
    }
  }
  return broadcastBus;
}

export function getSocketState(): SocketState {
  return currentSocketState;
}

export function subscribeSocketState(callback: (state: SocketState) => void): () => void {
  stateListeners.add(callback);
  callback(currentSocketState);
  return () => stateListeners.delete(callback);
}

function updateState(newState: SocketState) {
  if (currentSocketState !== newState) {
    currentSocketState = newState;
    stateListeners.forEach(cb => {
      try { cb(newState); } catch {}
    });
  }
}

/**
 * Derives the optimal WebSocket URL for the current environment
 */
export function getRealtimeSocketUrl(): string {
  if (typeof window === 'undefined') return '';

  const host = window.location.host;
  if (!host) return '';

  const hostname = window.location.hostname || '';

  // In purely static client-only deployments without a custom Node.js backend
  if (
    hostname.includes('vercel.app') ||
    hostname.includes('vercel.dev') ||
    hostname.includes('netlify.app') ||
    hostname.includes('pages.dev')
  ) {
    return '';
  }

  // Cloud Run and local environments support the dedicated /ws route
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${host}/ws`;
}

/**
 * Flushes queued messages upon successful connection
 */
function flushOutboundQueue() {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
  while (outboundQueue.length > 0) {
    const msg = outboundQueue.shift();
    if (msg) {
      try {
        activeSocket.send(JSON.stringify(msg));
        console.info(`[WebSocket Client] Flushed queued message: ${msg.type}`);
      } catch (err) {
        console.warn(`[WebSocket Client] Failed to flush message ${msg.type}:`, err);
        break;
      }
    }
  }
}

/**
 * Sends a real-time event to the server and all connected clients (plus instant BroadcastChannel across tabs).
 * Queues the message if the connection is currently reconnecting.
 */
export function sendRealtimeMessage(type: string, payload?: any): boolean {
  const msg: WebSocketMessage & { __senderTab?: string } = {
    type,
    payload,
    timestamp: Date.now(),
    __senderTab: CLIENT_INSTANCE_ID,
  };

  // 1. Always deliver instantly across open browser tabs/windows via BroadcastChannel (0ms latency)
  let deliveredLocally = false;
  try {
    const bus = ensureBroadcastBus();
    if (bus) {
      bus.postMessage(msg);
      deliveredLocally = true;
    }
  } catch {}

  if (!getRealtimeSocketUrl()) {
    return deliveredLocally;
  }

  const wsMsg: WebSocketMessage = {
    type,
    payload,
    timestamp: msg.timestamp,
  };

  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    try {
      activeSocket.send(JSON.stringify(wsMsg));
      return true;
    } catch (err) {
      console.warn(`[WebSocket Client] Failed to send ${type}:`, err);
    }
  }

  // Queue message for delivery once reconnected
  if (outboundQueue.length < MAX_QUEUE_SIZE) {
    outboundQueue.push(wsMsg);
  }
  return deliveredLocally;
}

/**
 * Connects or reconnects the WebSocket client with exponential backoff & jitter
 */
function connect() {
  if (isManuallyClosed) return;

  const url = getRealtimeSocketUrl();
  if (!url) {
    updateState('disconnected');
    return;
  }

  if (activeSocket && (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  updateState(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

  try {
    const ws = new WebSocket(url);
    activeSocket = ws;

    ws.onopen = () => {
      reconnectAttempts = 0;
      lastHeartbeatPongTime = Date.now();
      updateState('connected');
      flushOutboundQueue();
      startHeartbeat(ws);
    };

    ws.onmessage = (event) => {
      lastHeartbeatPongTime = Date.now();
      try {
        const data = JSON.parse(event.data);

        // Handle internal heartbeats
        if (data.type === 'pong' || data.type === 'system:heartbeat') {
          return;
        }

        // Notify subscribers
        messageListeners.forEach(cb => {
          try { cb(data); } catch {
            // Ignore subscriber errors
          }
        });
      } catch {
        // Non-JSON frame ignored
      }
    };

    ws.onerror = () => {
      // Quiet handler during reconnection / sleep cycles to avoid log noise
    };

    ws.onclose = () => {
      stopHeartbeat();
      activeSocket = null;

      if (!isManuallyClosed) {
        updateState('reconnecting');
        scheduleReconnect();
      } else {
        updateState('disconnected');
      }
    };
  } catch {
    scheduleReconnect();
  }
}

/**
 * Schedules a reconnection attempt with exponential backoff and jitter (capped at 60s on proxied/serverless hosts)
 */
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (isManuallyClosed) return;

  reconnectAttempts++;
  const maxDelay = reconnectAttempts > 4 ? 60000 : 15000;
  const backoff = Math.min(1500 * Math.pow(1.8, Math.min(reconnectAttempts, 8)) + Math.random() * 500, maxDelay);

  reconnectTimer = setTimeout(() => {
    connect();
  }, backoff);
}

/**
 * Heartbeat & Watchdog:
 * Pings the server every 20 seconds. If no data or pong is received in 45 seconds,
 * forces reconnect to prevent half-open TCP states.
 */
function startHeartbeat(ws: WebSocket) {
  stopHeartbeat();

  // Send ping every 20s
  heartbeatIntervalTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch {
        // Handled in watchdog
      }
    }
  }, 20000);

  // Watchdog checks every 10s for silence exceeding 45s
  heartbeatWatchdogTimer = setInterval(() => {
    const elapsed = Date.now() - lastHeartbeatPongTime;
    if (elapsed > 45000) {
      try {
        ws.close(4000, 'Heartbeat timeout');
      } catch {}
    }
  }, 10000);
}

function stopHeartbeat() {
  if (heartbeatIntervalTimer) clearInterval(heartbeatIntervalTimer);
  if (heartbeatWatchdogTimer) clearInterval(heartbeatWatchdogTimer);
  heartbeatIntervalTimer = null;
  heartbeatWatchdogTimer = null;
}

// Online/Offline & Visibility Handlers for instant recovery (only when WebSocket endpoint is enabled)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!getRealtimeSocketUrl()) return;
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectAttempts = 0;
      connect();
    }
  });

  window.addEventListener('offline', () => {
    if (!getRealtimeSocketUrl()) return;
    updateState('disconnected');
  });

  document.addEventListener('visibilitychange', () => {
    if (!getRealtimeSocketUrl()) return;
    if (document.visibilityState === 'visible') {
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        connect();
      }
    }
  });
}

/**
 * Initializes or binds to the global resilient WebSocket stream
 */
export function initRealtimeSocket(onMessage: (data: WebSocketMessage) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  isManuallyClosed = false;
  ensureBroadcastBus();
  messageListeners.add(onMessage);

  // If not currently connected or connecting, start connection
  if (!activeSocket || activeSocket.readyState === WebSocket.CLOSED) {
    connect();
  }

  return () => {
    messageListeners.delete(onMessage);
    // If no more listeners remain, keep connection open in background for seamless app navigation
  };
}

/**
 * Force reconnect manually
 */
export function forceReconnectSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (activeSocket) {
    try { activeSocket.close(1000, 'User manual reconnect'); } catch {}
  }
  reconnectAttempts = 0;
  isManuallyClosed = false;
  connect();
}

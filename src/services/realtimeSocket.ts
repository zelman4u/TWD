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
 * Sends a real-time event to the server and all connected clients.
 * Queues the message if the connection is currently reconnecting.
 */
export function sendRealtimeMessage(type: string, payload?: any): boolean {
  const msg: WebSocketMessage = {
    type,
    payload,
    timestamp: Date.now()
  };

  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    try {
      activeSocket.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.warn(`[WebSocket Client] Failed to send ${type}:`, err);
    }
  }

  // Queue message for delivery once reconnected
  if (outboundQueue.length < MAX_QUEUE_SIZE) {
    outboundQueue.push(msg);
    console.info(`[WebSocket Client] Queued outbound message "${type}" (waiting for reconnect).`);
  }
  return false;
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
  console.info(`[WebSocket Client] Connecting to ${url}... (attempt #${reconnectAttempts + 1})`);

  try {
    const ws = new WebSocket(url);
    activeSocket = ws;

    ws.onopen = () => {
      console.info('%c[WebSocket Client] Connection established successfully with Tagoloan District Broker.', 'color: #059669; font-weight: bold;');
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
          try { cb(data); } catch (err) {
            console.warn('[WebSocket Client] Subscriber threw error:', err);
          }
        });
      } catch {
        // Non-JSON frame ignored
      }
    };

    ws.onerror = () => {
      // Quiet handler during reconnection / sleep cycles to avoid log noise
    };

    ws.onclose = (event: CloseEvent) => {
      stopHeartbeat();
      activeSocket = null;

      const readableReason = getCloseReason(event.code);
      console.info(
        `[WebSocket Client] Closed (Code ${event.code}: ${readableReason}${event.reason ? ` - ${event.reason}` : ''}).`
      );

      if (!isManuallyClosed) {
        updateState('reconnecting');
        scheduleReconnect();
      } else {
        updateState('disconnected');
      }
    };
  } catch (err: any) {
    console.warn('[WebSocket Client] Construction error:', err?.message || err);
    scheduleReconnect();
  }
}

/**
 * Schedules a reconnection attempt with exponential backoff and jitter
 */
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (isManuallyClosed) return;

  reconnectAttempts++;
  // Exponential backoff capped at 15s with 500ms random jitter
  const backoff = Math.min(1000 * Math.pow(1.5, Math.min(reconnectAttempts, 8)) + Math.random() * 500, 15000);
  console.info(`[WebSocket Client] Scheduling reconnect in ${(backoff / 1000).toFixed(1)}s (attempt #${reconnectAttempts})...`);

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
      console.warn(`[WebSocket Client] No heartbeat received for ${(elapsed / 1000).toFixed(0)}s (half-open socket detected). Reconnecting...`);
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

function getCloseReason(code: number): string {
  switch (code) {
    case 1000: return 'Normal Closure';
    case 1001: return 'Going Away';
    case 1002: return 'Protocol Error';
    case 1003: return 'Unsupported Data';
    case 1005: return 'No Status Received';
    case 1006: return 'Abnormal Closure (Network Drop / Proxy Timeout)';
    case 1007: return 'Invalid Payload Data';
    case 1008: return 'Policy Violation';
    case 1009: return 'Message Too Big';
    case 1011: return 'Internal Server Error';
    case 1012: return 'Service Restart';
    case 1013: return 'Try Again Later';
    default: return 'Connection Closed';
  }
}

// Online/Offline & Visibility Handlers for instant recovery
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.info('[WebSocket Client] Internet connectivity restored. Initiating immediate reconnect.');
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectAttempts = 0;
      connect();
    }
  });

  window.addEventListener('offline', () => {
    console.warn('[WebSocket Client] Internet connection offline. Awaiting network restoration.');
    updateState('disconnected');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        console.info('[WebSocket Client] Browser tab active. Refreshing WebSocket connection.');
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

// Real-time synchronization manager for Central Admin & Field Mobile Terminals

export function getRealtimeSocketUrl(): string {
  if (typeof window === 'undefined') return '';

  const host = window.location.host || '';
  const hostname = window.location.hostname || '';

  // In cloud previews, Vercel, Netlify, or serverless hosts where direct WebSockets
  // are rejected by the ingress reverse proxy (causing 404/403 handshake errors),
  // return empty string to prevent browser console errors and rely on reliable HTTP sync.
  if (
    hostname.includes('vercel.app') ||
    hostname.includes('vercel.dev') ||
    hostname.includes('netlify.app') ||
    hostname.includes('pages.dev') ||
    hostname.includes('run.app') ||
    hostname.includes('googleusercontent.com')
  ) {
    return '';
  }

  // Local development fallback
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${host}`;
}

export function initRealtimeSocket(onMessage: (data: any) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const url = getRealtimeSocketUrl();
  // If in an environment with no persistent raw WebSocket ingress, cleanly return no-op.
  // Real-time updates operate seamlessly via active REST polling and Firestore listeners.
  if (!url) {
    return () => {};
  }

  let ws: WebSocket | null = null;
  let reconnectTimer: any = null;
  let reconnectAttempts = 0;
  let isDestroyed = false;

  const connect = () => {
    if (isDestroyed) return;
    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          onMessage(parsed);
        } catch {
          // ignore non-JSON
        }
      };

      ws.onerror = () => {
        if (ws) {
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
      };

      ws.onclose = () => {
        if (isDestroyed) return;
        if (reconnectAttempts < 2) {
          reconnectAttempts++;
          reconnectTimer = setTimeout(connect, 6000);
        }
      };
    } catch {
      // Clean fallback
    }
  };

  connect();

  return () => {
    isDestroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  };
}

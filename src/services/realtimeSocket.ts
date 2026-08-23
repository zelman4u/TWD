// Real-time WebSocket connection manager for Central Admin & Field Mobile Terminals

export function getRealtimeSocketUrl(): string {
  if (typeof window === 'undefined') return '';

  const hostname = window.location.hostname || '';
  // When running on Vercel, Netlify, Cloudflare Pages, GitHub Pages or custom frontend CDN:
  // Route WebSocket connections directly to the persistent Cloud Run WebSocket Broker
  if (
    hostname.includes('vercel.app') ||
    hostname.includes('vercel.dev') ||
    hostname.includes('netlify.app') ||
    hostname.includes('pages.dev') ||
    hostname.includes('web.app') ||
    hostname.includes('firebaseapp.com')
  ) {
    return 'wss://ais-pre-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app';
  }

  // Local development / Direct Cloud Run container hosting:
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export function initRealtimeSocket(onMessage: (data: any) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  let ws: WebSocket | null = null;
  let reconnectTimer: any = null;
  let reconnectAttempts = 0;
  let isDestroyed = false;

  const connect = () => {
    if (isDestroyed) return;
    try {
      const url = getRealtimeSocketUrl();
      if (!url) return;

      ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          onMessage(parsed);
        } catch {
          // ignore non-JSON messages
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
        if (reconnectAttempts < 3) {
          reconnectAttempts++;
          reconnectTimer = setTimeout(connect, Math.min(10000, 3000 * reconnectAttempts));
        }
      };
    } catch {
      // Standby fallback
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

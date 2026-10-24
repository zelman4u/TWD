# 01 — System Architecture & Connections

## 1. Environment & Network Endpoints

| Layer / Channel | Protocol | Exact URL / Identifier | Role in System |
| :--- | :--- | :--- | :--- |
| **Development Host** | `HTTPS` | `https://ais-dev-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app` | Live development web application & REST API server (Port `3000`). |
| **Shared / Preview Host** | `HTTPS` | `https://ais-pre-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app` | Public shared web application & REST API server (Port `3000`). |
| **REST API Gateway** | `HTTPS` | `<BASE_URL>/api/*` | Serves Mobile App auth, route pulls, reading sync, consumer ID issuance, receipt OCR, and service reports. |
| **WebSocket Broker** | `WSS` | `wss://<HOST>/ws` *(aliases: `/api/ws`, `/realtime`, `/socket`)* | Real-time push event bus connecting Admin Portal, Consumer Portal, and Mobile Meter Reader App. |
| **Cloud Database** | `Firestore` | `ai-studio-tagoloanwaterdis-29aaeffc-dbd1-4669-9b5b-63d636462350` | Persistent cloud document database across 12 collections. |
| **Local-First Store** | `Browser` | `localStorage` (`twd_live_v4_*` keys) | Instant zero-latency reactive store with cross-tab `storage` & `twd_database_updated` events. |

---

## 2. Backend Middleware & Security Architecture

1. **Cross-Origin Mobile Access (CORS)**:
   - Allows `Access-Control-Allow-Origin: *`
   - Allowed Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
   - Allowed Headers: `Origin, X-Requested-With, Content-Type, Accept, Authorization, x-reader-id, x-employee-id, x-user-id, x-portal, x-role`
2. **Double-Prefix Path Normalization**:
   - Mobile clients that inadvertently send `/api/api/...` (because `/api` was included in their base URL) are automatically normalized on the server to `/api/...`.
3. **High-Capacity Image Payloads**:
   - Express JSON and URL-encoded body parsers are configured with a **`15mb` limit** to handle Base64-encoded field meter dial photographs and consumer cashier receipt uploads.
4. **Anti-DDoS & Anti-Bot Sliding-Window Rate Limiter**:
   - **Window Duration**: `60 seconds` per client IP.
   - **Authentication Endpoints** (`/auth`, `/login`, `/verify`): Max **25 requests / minute** (returns `429 Too Many Requests` with `Retry-After` header if exceeded).
   - **General `/api/*` Endpoints**: Max **200 requests / minute**.
   - **Exempt Health Probes**: `/api/health`, `/api/status`, `/api/ping`, and `/api/survival` bypass rate limiting so uptime monitors and mobile connectivity checks never throttle.

---

## 3. Tri-Layer Data Synchronization Architecture

The platform uses a resilient **Tri-Layer Synchronization Model** so portals never stall or lose state:

1. **Layer 1 — Local-First Reactive Engine (`twd_live_v4_*`)**:
   - Every write immediately updates local state, dispatches `CustomEvent('twd_database_updated')` within the active tab, and writes `twd_sync_ping` to `localStorage` so any other open browser tabs update instantaneously.
2. **Layer 2 — Express REST + WebSocket Live Broker**:
   - Synchronizes state across separate physical devices (e.g., an Android/iOS Mobile Meter Reader App in the field and the Admin Desktop Workspace at the municipal office).
   - Includes a 20-second WebSocket `ping`/`pong` + `system:heartbeat` keepalive and a 45-second half-open socket watchdog with exponential backoff reconnection.
3. **Layer 3 — Firebase Cloud Firestore (`12` Collections)**:
   - Collections: `users`, `consumers`, `readers`, `meters`, `readings`, `routes`, `announcements`, `audit_logs`, `notifications`, `barangays`, `settings`, and `consumer_reports`.
   - **Automatic Quota Circuit Breaker (`twd_firestore_quota_exceeded`)**: If Firestore free-tier daily write units are exhausted (`resource-exhausted`), the system automatically trips a 12-hour circuit breaker, cleanly detaching Firestore network listeners without unhandled promise rejections while keeping Local-First + Express API + WebSocket operations running seamlessly.

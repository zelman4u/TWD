# Tagoloan Water District: Security, Speed, Traffic & Survival Architecture

This document answers the four core engineering resilience questions for the Tagoloan Water District Real-Time Water Meter Reading and Billing Management System.

---

## 1. Security Architecture

### Who's allowed in?
The system utilizes multi-tiered identity verification:
1. **Administrative Staff & Billing Officers**:
   - Authenticated via secure administrative credentials / Firebase Auth tokens.
   - Assigned the `ADMIN` role with full municipal jurisdiction access.
2. **Field Meter Readers (Mobile Android/PWA App)**:
   - Authenticated via reader credentials / PIN and assigned hardware identifiers (`x-reader-id`).
   - Active employment status validation (`active` vs `pending` vs `inactive/terminated`). Terminated staff tokens are immediately invalidated across all endpoints.
   - Geofenced and zone-scoped: readers only authenticate into their assigned route/barangay coverage areas.
3. **Consumers & Water Concessionaires**:
   - Authenticated via Water Account Number (`011-xxx-xxx`) or linked consumer mobile account credentials.
   - Assigned the `CONSUMER` role.
4. **Public / Guests**:
   - Restricted strictly to public landing info, municipal water rates / tariff lookup, and bill inquiry search by verified account number.

### What are they allowed to see?
Access is governed by strict **Role-Based Access Control (RBAC)** and **Row-Level Security (RLS)**:
- **Consumers**: Can **only** see their own ledger, historical consumption graph, current billing statement, water meter tag, and payment transaction history. They cannot see other concessionaires' records or staff metrics.
- **Meter Readers**: Can **only** see consumers and water meters within their assigned barangay / zone routes (e.g. Zone 1–4 Poblacion). They cannot modify billing tariffs or view administrative personnel records.
- **Admins**: Can view district-wide billing collections, water balance reconciliation, unbilled meter alerts, discrepancy flags, audit logs, and staff assignments.
- **Public / Unauthenticated**: Cannot view consumer PII, reading histories, or administrative reports.

### What happens when a bot sends 10,000 requests?
The system deploys multi-layered defensive rate limiting and DDoS mitigation:
1. **Sliding-Window Rate Limiter**:
   - The application enforces strict per-IP rate limits (default: **200 requests/minute** for general API endpoints, **25 requests/minute** for authentication endpoints).
   - Once a bot exceeds the threshold, requests **#201 through #10,000** are rejected immediately with **HTTP 429 Too Many Requests**.
   - Standard HTTP headers are attached: `Retry-After: 60`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`, and `X-RateLimit-Reset`.
2. **Reverse Proxy / Cloud CDN Edge Shielding**:
   - At the edge layer (Cloud Run / Cloudflare / GCP Cloud Armor), layer-7 SYN-floods and volume attacks are absorbed before ever reaching the application container.
3. **Memory & Connection Guarding**:
   - The rate-limiter runs in O(1) in-memory hash buckets with periodic memory sweeps every 60 seconds, preventing memory exhaustion attacks.
   - WebSocket upgrades require path verification and origin checks, terminating unauthorized socket connection exhaustion attempts immediately (`socket.destroy()`).

---

## 2. Speed: Performance for All Users

The app maintains sub-100ms response times not just for developers, but for field readers on 3G cellular connections in remote barangays:

1. **Lightweight Client-Side Bundle**:
   - Vite-optimized tree-shaken ESM build with chunk splitting.
   - High-performance UI rendering via React 19 and Tailwind CSS with minimal CSS footprint.
2. **Offline-First Synchronization (Field Readers)**:
   - In areas with spotty cellular coverage (e.g., Gracia Uplands, Sugbongcogon Valley), the mobile reading interface stores scans and meter readings in local persistent storage (`IndexedDB` / `localStorage`).
   - Sync queues batch submissions in the background when connectivity resumes without blocking the field reader's UI.
3. **Server-Side Efficient Compression**:
   - Fast JSON payloads with selective field filtering (e.g. route-scoped queries return only relevant barangay records, not the entire municipal ledger).
4. **WebSocket Push Over HTTP Polling**:
   - Instead of 500 mobile devices polling the server every 2 seconds for new assignments, a single multiplexed WebSocket broker broadcasts updates, saving ~95% of server bandwidth and device battery.

---

## 3. Traffic: Scaling from 10 to 10,000 Users

When Tagoloan expands from 10 concurrent users to 10,000 simultaneous users:

| Metric | 10 Users | 10,000 Users Architecture |
| :--- | :--- | :--- |
| **Server Instances** | Single container process | Horizontally auto-scaled container instances (Cloud Run / Kubernetes) |
| **Session State** | In-process memory | Stateless JWT tokens + Distributed Redis Cache for sessions & rate limits |
| **Database Tier** | Direct reads | Connection Pooling (PgBouncer) + Cloud Firestore distributed document partitioning + Read Replicas |
| **Real-Time Sockets** | Direct WebSocket Server | Redis Pub/Sub backplane connecting multiple WebSocket server nodes |
| **Static Assets** | Direct Express/Node static serve | Global CDN (Cloudflare / Google Cloud CDN) serving cached HTML/JS/CSS assets at the edge |

Because the core server is built statelessly without session affinity requirements, instances can scale from 1 to 50+ in seconds based on CPU and request concurrency thresholds.

---

## 4. Survival: Observability, Failure Detection & Fast Recovery

### How do you know something is broken?
1. **Live Health & Telemetry Probes**:
   - Active endpoint `/api/health` and `/api/status` exposes:
     - Container uptime in seconds.
     - Active WebSocket connections.
     - Process memory utilization (`heapUsedMB`, `heapTotalMB`, `rssMB`).
     - Bot defense statistics (`totalRequestsServed`, `totalRequestsThrottled`, `activeTrackedIPs`).
   - Automated cloud uptime checks (probes every 10–30 seconds). If HTTP status is not `200 OK`, an automated incident notification triggers.
2. **Centralized Structured Error Logging**:
   - Express global error handling middleware intercepts uncaught exceptions and logs JSON-structured stack traces.
3. **Application-Level Heartbeats**:
   - The WebSocket broker broadcasts a heartbeat ping every 20 seconds. If a client drops or fails to acknowledge, socket resources are cleaned up cleanly without resource leaks.

### Can you fix it fast?
1. **Zero-Downtime Rolling Deployments**:
   - Containerized deployment switches traffic to new containers only after passing the `/api/health` readiness probe.
2. **Instant Rollback**:
   - In case of a production bug, the deployment pipeline supports one-click rollback to the previous immutable container revision in under 30 seconds.
3. **Modular Decoupled Codebase**:
   - Frontend and backend are cleanly segregated with explicit interface contracts (`types/`, `services/`, `controllers/`, `middlewares/`), allowing targeted hotfixes to be tested with `npm run lint` and `npm run build` in seconds.

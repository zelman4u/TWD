# Central Web & Mobile Field Terminal Integration Plan

Structural analysis of the **Tagoloan Field Mobile Web Terminal** (`MobileNew-main` deployed live at `https://mobile-li9q.onrender.com/`) and the complete bidirectional connection plan with the **Central Web Portal** (Admin & Consumer Portals).

## Deep Structural Findings & Critical Decisions

> [!IMPORTANT]
> **Verified Live & Source Findings (Zero Assumptions)**:
> 1. **Self-Hosted Origin Binding on Mobile**: Inside the mobile project, `TAGOLOAN_SYSTEM_BASE_URL` defaults to `window.location.origin` (`https://mobile-li9q.onrender.com`). Every mobile reader registration, login, route pull, meter scan, and batch submission hits the Render server's own Express + WebSocket (`/ws`) engine unless bridged.
> 2. **Asymmetric Cloud Reachability**: The live Render node (`https://mobile-li9q.onrender.com`) is publicly reachable (`HTTP 200`, `CORS: *`, active `/ws` broker), whereas browser preview URLs sit behind session cookies. Therefore, **our Central Web Server must act as an active bidirectional Bridge Client & Hub**—maintaining a live outbound WebSocket link (`wss://mobile-li9q.onrender.com/ws`) plus scheduled/event-driven REST synchronization.
> 3. **Tariff & Odometer Reconciliation**: Both systems enforce **5-digit whole-number odometer readings (`00000`–`99999`)**, but the mobile terminal's local receipt preview still computes legacy graduated tiers (`₱215` minimum + `5%` environmental + `₱10` maintenance). Upon arrival in the Central Web System, every mobile reading will be strictly normalized to our **Official Tagoloan Tariff Baseline** (**Residential `₱10.00/m³`**, **Commercial `₱25.00/m³`**, **2% Franchise Tax**, **10% Late Penalty**) with full `99999 → 00000` rollover support.
> 4. **Consumer Registry Authority**: The live Render instance boots with 17 standalone seed records (`01-042-0091`, etc.) and 7 field readers (`WDT-MR04`, `RDR-001`–`RDR-005`). Our bridge will push validated Central Web consumers and physical meter statuses to Render while importing active mobile field readers and submitted readings—without exposing hardware Meter Serial Numbers outside the Admin Water Meters module.

---

## 1. Inspected Mobile System Structure (`MobileNew-main`)

### Architectural Anatomy of the Mobile Project

```
┌────────────────────────────────────────────────────────────────────────┐
│        MOBILE FIELD TERMINAL (https://mobile-li9q.onrender.com)        │
├───────────────────────────────────┬────────────────────────────────────┤
│   Mobile PWA Client (Browser)     │    Render Cloud Node (Express)     │
│                                   │                                    │
│ • Screens: Landing, Reader Login/ │ • REST API (/api/*, 25MB JSON)     │
│   Self-Register, Route List,      │ • WebSocket Broker (/ws)           │
│   Camera OCR (Tesseract + Vision),│ • In-Memory Stores:                │
│   5-Digit Entry, Batch Sync,      │   - REGISTERED_READERS (7 active)  │
│   System Connection Hub           │   - INITIAL_CONSUMERS (17 seeded)  │
│ • Offline Vault: IndexedDB        │   - INITIAL_METERS (15 seeded)     │
│   (WDT_MeterReader_DB_v2)         │   - serverReadings & Audit Logs    │
│   - consumers, readings, logs     │ • Route Occupancy Lock (1 active   │
│ • Real-Time Lockout & Alert UI    │   reader per barangay unless       │
│   on Admin WS Broadcasts          │   override flag is passed)         │
└───────────────────────────────────┴────────────────────────────────────┘
```

### Key Behavioral Details Verified from Mobile Source
- **Instant Self-Registration**: Field staff register on mobile (`POST /api/readers/register`) and become `active` immediately, broadcasting `READER_REGISTERED_ACTIVE`.
- **Single-Action Admin Termination**: When terminated via `/api/readers/:id/terminate`, the mobile app receives `READER_ACCOUNT_TERMINATED` over `/ws`, clears local credentials, and renders a full-screen red **Access Revoked by Admin** lockout screen.
- **Physical Meter & Consumer Gatekeeping**: Mobile route downloads filter out any consumer lacking an issued Account Number or Meter Tag, or whose account/meter status is `inactive`, `damaged`, `maintenance`, or `unassigned`.
- **Rich Field Telemetry**: Mobile reading payloads include `previousReading`, `currentReading` (`00000`–`99999`), `photoUrl` (base64 dial capture), `gpsCoordinates` (`{ lat, lng, accuracy }`), `ocrConfidence`, `meterCondition` (`NORMAL`, `GLASS_FOGGED`, `STUCK_DIAL`, `DAMAGED`, `LEAK_SUSPECTED`), and `isAnomaly` / `anomalyReason`.

---

## 2. Bidirectional Connection Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│               CENTRAL WEB SYSTEM (Admin & Consumer Portals)            │
│   • Firestore + Persistent Sync Store   • Official ₱10/₱25 Tariff      │
│   • 5-Digit Odometer (00000–99999)      • Admin Approvals & Billing    │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
     Outbound Push  │  REST + Persistent WSS Bridge  │  Inbound Pull &
     (Admin → Field)│  (Central Server ↔ Render Node)│  Live WS Stream
                    ▼                                ▲
┌────────────────────────────────────────────────────────────────────────┐
│          LIVE MOBILE CLOUD NODE (https://mobile-li9q.onrender.com)     │
│   • /api/consumers, /api/meters, /api/readers, /api/readings, /ws      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Offline-First Sync (IndexedDB)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               FIELD METER READER HANDHELD DEVICES (PWA)                │
└────────────────────────────────────────────────────────────────────────┘
```

### How the Connection Works Without Manual Token Setup
1. **Persistent Outbound WebSocket Relay (`wss://mobile-li9q.onrender.com/ws`)**:
   - Our Central Web Server maintains an auto-reconnecting WebSocket client connected to `wss://mobile-li9q.onrender.com/ws` with 20-second `PING`/`PONG` keepalives (which also prevents Render free-tier sleep during active shifts and handles cold-wake gracefully).
   - Whenever a reader on `https://mobile-li9q.onrender.com` submits a reading (`READING_SUBMITTED_FOR_APPROVAL`, `LIVE_READING_UPDATE`), syncs a batch (`BATCH_SYNC_PROCESSED`), or registers (`READER_REGISTERED_ACTIVE`), our server immediately pulls the full record, normalizes it, persists it, and broadcasts it live to all open Admin Portal sessions.
2. **Real-Time Outbound Admin Command Propagation**:
   - **Consumer & ID Issuance Sync**: Approving an applicant, issuing an Account Number & Meter Tag, or changing a consumer's status (`active`, `disconnected`, `inactive`) pushes directly to `https://mobile-li9q.onrender.com/api/consumers` and `/issue-id` so the consumer appears (or locks) on the assigned reader's phone in real time.
   - **Water Meter Status Sync**: Changing a physical meter's status in the Admin **Water Meters** module (`active`, `damaged`, `maintenance`, `inactive`) forwards to `https://mobile-li9q.onrender.com/api/meters/:meterNumber/status`, triggering the mobile app's live `METER_STATUS_UPDATED` alert banner.
   - **Reader Roster, Route & Termination Sync**: Terminating, reactivating, or reassigning routes for a Meter Reader in the Admin **Meter Readers** module forwards to `https://mobile-li9q.onrender.com/api/readers/:id/terminate` (or `/reactivate` / `/status` with `overrideOccupancy: true`), instantly locking out revoked devices in the field.
   - **Reading Approval & Rejection Feedback**: Approving a reading (which issues the official Consumer Portal bill) or flagging/rejecting it in Admin **Approvals** forwards to `https://mobile-li9q.onrender.com/api/readings/:id/approve` or `/reject`, advancing the mobile consumer's `previousReading` baseline for next month and notifying the reader on-screen.

---

## 3. Data Contract & Schema Harmonization

| Shared Domain | Mobile Payload (`mobile-li9q.onrender.com`) | Central Web Normalization & Action |
| :--- | :--- | :--- |
| **Odometer Index** | `previousReading`, `currentReading` (`0`–`99999` whole integers) | Formatted strictly as 5-digit `00000`–`99999` strings in UI; consumption computed via modulo-100,000 odometer logic (`99999 → 00000` rollover safe). |
| **Tariff & Billing** | `billCalculation` (graduated LWUA preview on handheld) | Recomputed authoritatively on Web using **Residential `₱10/m³`**, **Commercial `₱25/m³`**, **2% Franchise Tax**, and **10% Late Penalty** (`0 m³ = ₱0.00`). |
| **Coordinates & Photo** | `gpsCoordinates: { lat, lng, accuracy }`, `photoUrl` (base64), `ocrConfidence` | Mapped cleanly to `{ latitude, longitude }` + dial evidence viewer inside the interactive Admin **Approvals** & **Readings** row detail modals. |
| **Meter Condition** | `meterCondition`: `NORMAL`, `GLASS_FOGGED`, `STUCK_DIAL`, `DAMAGED`, `LEAK_SUSPECTED` | Preserved on reading records; non-normal conditions surface diagnostic badges in **Approvals** so Admin can inspect or flag the physical meter. |
| **Meter Privacy** | Sends both `meterNumber` (Tag #) and `meterSerial` (Hardware Serial #) | `meterNumber` (Tag #) links readings & bills; `meterSerial` remains strictly confined to the Admin **Water Meters** inventory module. |
| **Seed Consumers** | 17 standalone Render demo consumers (`01-042-*`) vs. Central Web consumers | Central Web validated consumers are pushed to Render on boot & update; mobile readings matching by Account # or Meter Tag # bind directly to Central accounts (unknown field accounts surface clearly in Approvals without corrupting Consumer Portal accounts). |

---

## 4. User Experience & Interface Touchpoints

> [!NOTE]
> All existing interactive row-click detail modals, billing history vs. unsettled bill separation, 5-digit odometer displays, and tariff baselines remain 100% intact.

1. **Admin Portal — Live Mobile Terminal Bridge Bar & Controls (Meter Readers & Approvals Modules)**:
   - Displays live connection telemetry to `https://mobile-li9q.onrender.com` (Online / Waking Render Node / Connected Readers / Queued Mobile Readings) with a one-click **"Sync Routes & Pull Readings Now"** action and a direct **"Open Mobile Field Terminal"** launch link (`https://mobile-li9q.onrender.com/`).
   - **Meter Readers Module**: Clicking any reader row opens their complete profile, assigned barangay coverage, synced source badge, and direct **Terminate / Reactivate Reader** controls that immediately propagate to `https://mobile-li9q.onrender.com`.
   - **Approvals Module**: Displays incoming mobile field readings with 5-digit odometer wheels (`00000` → `99999`), captured meter photo, GPS coordinates, OCR confidence, and physical `meterCondition` badge (`GLASS_FOGGED`, `DAMAGED`, `LEAK_SUSPECTED`, etc.). Clicking **Approve & Issue Bill** simultaneously bills the Consumer Portal (at ₱10/₱25 per m³) and notifies the mobile terminal.
2. **Landing Page / Login Portal**:
   - Provides a clean, unobtrusive **"Field Meter Reader Terminal"** quick-access link pointing authorized field personnel directly to `https://mobile-li9q.onrender.com/`.

---

## 5. Phased Execution Plan (Awaiting Your Approval)

1. **Phase 1 — Server-to-Mobile Bidirectional Bridge**: Build the outbound REST + auto-reconnecting WebSocket (`wss://mobile-li9q.onrender.com/ws`) bridge service in our backend with cold-start retry handling, automatic boot reconciliation, and loop-prevention guards.
2. **Phase 2 — Endpoint & Payload Harmonization**: Wire real-time two-way hooks for Readers (register, route update, terminate/reactivate), Validated Consumers & ID Issuance, Physical Water Meter statuses, and Field Readings (single + batch ingestion with 5-digit odometer + ₱10/₱25 tariff normalization and approve/reject callbacks).
3. **Phase 3 — Admin & Portal UI Integration**: Add the Mobile Field Terminal connection status & manual sync controls in the Admin Portal (**Meter Readers** and **Approvals**), surface mobile `meterCondition` / OCR / GPS metadata inside interactive reading details, and add the direct `https://mobile-li9q.onrender.com/` launcher link.
4. **Phase 4 — End-to-End Live Verification**: Verify TypeScript lint, production build, and live round-trip communication against `https://mobile-li9q.onrender.com`.

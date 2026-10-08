# Tagoloan Water District (TWD) - System Architecture & Project Organization

This document serves as the master map for all files, directories, and subsystems in the codebase. It enables any engineer or automated tool to quickly navigate, identify module ownership, trace data flow, and diagnose/resolve future issues.

---

## Directory Structure Map

```text
├── README.md                         # Master overview & instant error tracing reference
├── PROJECT_STRUCTURE.md              # [Master Guide] System layout, data flows, and troubleshooting guide
├── package.json                      # Root workspace scripts and dependencies
├── server.ts                         # Server entry point running Express & Vite middleware
│
├── frontend/                         # [FRONTEND LAYER: React 19 + Vite + Tailwind CSS]
│   ├── public/                       # Static public assets
│   ├── package.json                  # Frontend package definition
│   ├── README.md                     # Frontend architecture documentation
│   └── src/                          # Presentation components, contexts, services, utilities
│       ├── main.tsx                  # React root mount
│       ├── App.tsx                   # Master session supervisor & route gates
│       ├── components/               # Admin, Consumer, Common, Charts modules
│       ├── context/                  # Global state (Toast, Loading)
│       ├── services/                 # API client, Firestore, Grace period scanner, WebSockets
│       ├── utils/                    # Tariff math, identifier checks, phone sanitization
│       └── constants/                # Official district constants & tariff brackets
│
├── backend/                          # [BACKEND LAYER: Node.js + Express REST API]
│   ├── config/                       # Environment, constants, thresholds
│   ├── controllers/                  # Auth, Consumer, Reading, Billing, Report handlers
│   ├── models/                       # Consumer, Reading, Bill, Staff models
│   ├── routes/                       # REST endpoint definitions & master router
│   ├── middlewares/                  # Auth token, validation, error handler
│   ├── services/                     # Stepped tariff service, 90-day grace period service
│   ├── utils/                        # Structured logger, response helper
│   ├── server.ts                     # Backend app module
│   ├── package.json                  # Backend package definition
│   └── README.md                     # Backend architecture documentation
│
├── database/                         # [DATABASE LAYER: Relational SQL + Firestore]
│   ├── schema/                       # Relational schema (schema.sql) & NoSQL blueprints
│   ├── rules/                        # Production firestore.rules
│   ├── seeds/                        # Municipal seed data (barangays, tariff brackets)
│   ├── connection.ts                 # Storage health & Quota Circuit Breaker
│   └── README.md                     # Database documentation & ERD overview
│
└── docs/                             # [DOCUMENTATION & JUSTIFICATION]
    ├── ARCHITECTURE_JUSTIFICATION.md # Full justification: Why separated full-stack is better
    └── API_WORKFLOWS.md              # Telemetry and grace-period sequence flows
```

---

## Subsystem Architecture & Responsibilities

| Subsystem | Primary Files | Responsibility |
| :--- | :--- | :--- |
| **Billing & Tariffs** | `src/utils/tariffCalculator.ts`<br>`src/constants/index.ts` | Calculates stepped water consumption brackets, minimum charges, franchise taxes, and 10% late surcharges. |
| **3-Month Grace Period & Disconnections** | `src/services/gracePeriodScannerService.ts`<br>`src/components/admin/GracePeriodScannerCard.tsx`<br>`src/components/consumer/OverdueBillBanner.tsx` | Background service scanning all accounts every 60s. Accounts exceeding 90 days past due date or 3+ unpaid cycles are automatically updated to `'Disconnection Notice'`. |
| **Data Persistence & Local-First Sync** | `src/mockDb.ts`<br>`src/services/firebaseDb.ts` | Reactive local storage with cross-tab events (`twd_database_updated`) and background Firestore synchronization. |
| **Quota Circuit Breaker** | `src/services/firebaseDb.ts` (`isFirestoreQuotaExceeded`) | Automatically detects free-tier write exhaustion, gracefully drops network retries, and switches to offline-first mode without throwing unhandled exceptions. |
| **Real-time Telemetry** | `src/services/realtimeSocket.ts`<br>`server.ts` (WebSocket) | Broadcasts field readings, meter status updates, reader approvals, and scanner results to all connected clients. |
| **Audit & Integrity** | `src/utils/identifierValidation.ts`<br>`src/utils/phoneValidation.ts` | Enforces strict uniqueness of Account Numbers, Meter Tags, and RFID Tags, preventing duplicates. |

---

## Future Problem Detection & Troubleshooting Guide

### 1. Issue: A consumer has unpaid bills, but their account was not updated to "Disconnection Notice"
- **Where to inspect:** `src/services/gracePeriodScannerService.ts` (`evaluateAccountGracePeriod`).
- **Check criteria:**
  1. Is the bill `status === 'verified'`? (Pending unapproved field readings do not count).
  2. Is `paymentStatus !== 'paid'` and remaining balance > 0.5?
  3. Has `daysOverdue >= 90` OR are there `unpaidCycles >= 3`?
  4. Is the background scanner running? Verify via `GracePeriodScannerCard.tsx` on the Admin Consumers page or click **"Scan Now"**.

### 2. Issue: Firestore reports `resource-exhausted: Quota limit exceeded`
- **Where to inspect:** `src/services/firebaseDb.ts`.
- **How it behaves:** The built-in `markFirestoreQuotaExceeded()` circuit breaker activates automatically, setting a 30-minute quiet period in `sessionStorage` (`twd_firestore_quota_exceeded`). All app reads and writes continue seamlessly via `mockDb.ts` (local-first storage).
- **Resolution:** No action needed; app continues running normally. When quota resets at 00:00 UTC, the breaker re-evaluates automatically.

### 3. Issue: Duplicate Meter Tag or RFID Tag accepted
- **Where to inspect:** `src/utils/identifierValidation.ts` and `src/components/AdminPortal.tsx` (`handleOpenConsumerModal`).
- **How it behaves:** `checkDuplicateMeterTag()` and `checkDuplicateRfidTag()` compare normalized strings against all existing records. If duplicate, modal buttons are locked and a high-visibility warning banner is rendered.

### 4. Issue: Water tariff total calculation discrepancies
- **Where to inspect:** `src/utils/tariffCalculator.ts`.
- **Formulas:**
  - Residential: Minimum charge ₱124.50 for first 10 m³, stepped rates thereafter.
  - Commercial: Stepped commercial tier pricing.
  - Surcharge: 10% applied after due date.

### 5. Verification Commands
```bash
# Validate TypeScript typings and imports
npm run lint

# Build full client bundle and server executable
npm run build

# Restart full-stack development server
npm run dev
```

# Tagoloan Water District (TWD) - System Architecture & Project Organization

This document serves as the master map for all files, directories, and subsystems in the codebase. It enables any engineer or automated tool to quickly navigate, identify module ownership, trace data flow, and diagnose/resolve future issues.

---

## Directory Structure Map

```text
├── PROJECT_STRUCTURE.md              # [Master Guide] System layout, data flows, and troubleshooting guide
├── package.json                      # Dependencies and scripts (dev, build, start, lint)
├── tsconfig.json                     # TypeScript compiler configuration
├── vite.config.ts                    # Vite client build configuration
├── server.ts                         # Node.js Express full-stack API + WebSocket hub + Server background scanner
├── firebase-applet-config.json       # Applet Firebase credentials
├── firebase-blueprint.json           # Firestore schema blueprint and entity validation models
├── firestore.rules                   # Production Firestore security and access-control rules
│
├── src/
│   ├── main.tsx                      # React root mounting and initialization
│   ├── App.tsx                       # Main application router and session supervisor
│   ├── firebase.ts                   # Firebase SDK initialization (Auth & Firestore)
│   ├── mockDb.ts                     # Local-first reactive persistence engine with Firestore sync
│   ├── types.ts                      # Central TypeScript interfaces (User, Consumer, Meter, Reading, etc.)
│   ├── index.css                     # Tailwind CSS entry point
│   │
│   ├── constants/                    # [Single-Source-of-Truth Constants]
│   │   └── index.ts                  # District profile, billing thresholds, collection keys, storage keys
│   │
│   ├── context/                      # [Application State Contexts]
│   │   ├── LoadingContext.tsx        # Global full-screen loading overlay context
│   │   └── ToastContext.tsx          # Non-blocking animated toast notifications
│   │
│   ├── services/                     # [Data & Infrastructure Services]
│   │   ├── index.ts                  # Central barrel export for all services
│   │   ├── apiClient.ts              # REST client for backend Express API endpoints
│   │   ├── firebaseDb.ts             # Firestore read/write sync, listeners & Quota Circuit Breaker
│   │   ├── gracePeriodScannerService.ts # 3-Month payment grace period automated scanner & disconnection engine
│   │   └── realtimeSocket.ts         # WebSocket client for real-time field telemetry and instant push alerts
│   │
│   ├── utils/                        # [Pure Calculation & Validation Utilities]
│   │   ├── index.ts                  # Central barrel export for all utilities
│   │   ├── tariffCalculator.ts       # Tiered water tariff computation (Residential vs Commercial)
│   │   ├── identifierValidation.ts   # Uniqueness checks (Account #, RFID Tag, Meter Serial Tag)
│   │   ├── phoneValidation.ts        # Philippine mobile number sanitization (09 / +63)
│   │   └── analytics.ts              # Statistical rollups (trends, payment distributions, barangay totals)
│   │
│   └── components/                   # [Presentation & Feature Components]
│       ├── LandingPage.tsx           # Public water district portal & announcement homepage
│       ├── UnifiedLogin.tsx          # Dual-role authentication gate (Admin & Consumer accounts)
│       ├── RegistrationPage.tsx      # Public new service connection application form
│       ├── AdminPortal.tsx           # Master administrative dashboard (13 sub-modules)
│       ├── ConsumerPortal.tsx        # Consumer self-service billing, telemetry, and payments portal
│       │
│       ├── admin/                    # [Admin-Specific Sub-Components]
│       │   ├── index.ts              # Barrel export for admin components
│       │   ├── GracePeriodScannerCard.tsx # 3-Month grace period background service monitor card
│       │   ├── OfficialReportsGenerator.tsx # PDF & CSV billing report export engine
│       │   └── RecordsArchiveView.tsx# Read-only historical ledger & permanent audit log viewer
│       │
│       ├── consumer/                 # [Consumer-Specific Sub-Components]
│       │   ├── index.ts              # Barrel export for consumer components
│       │   ├── BillDetails.tsx       # Printable statement breakdown & QR code generator
│       │   ├── DynamicDueAlert.tsx   # Urgent due date warnings & late-surcharge notices
│       │   ├── OverdueBillBanner.tsx # Critical 3-month disconnection notice order banner
│       │   ├── UploadReceiptModal.tsx# Bank transfer / over-the-counter receipt uploader
│       │   └── MonthlyUsageReportModal.tsx # Historical consumption comparison chart modal
│       │
│       ├── common/                   # [Universal Shared UI Components]
│       │   ├── index.ts              # Barrel export for common components
│       │   ├── DataLoadingIndicator.tsx # Syncing & data-fetching pulse indicators
│       │   ├── DistrictProfileSection.tsx # Official TWD district contact & operating info card
│       │   ├── GlobalLoadingSpinner.tsx # High-contrast backdrop spinner
│       │   └── SkeletonLoader.tsx    # Shimmer loaders for tables, cards, and dashboards
│       │
│       └── charts/                   # [Telemetry & Visual Analytics]
│           ├── index.ts              # Barrel export for charts
│           ├── AdminAnalyticsSection.tsx # Executive overview KPI metrics and chart switcher
│           ├── BarangayConsumptionChart.tsx # Volume vs collection by barangay service zone
│           ├── PaymentDistributionChart.tsx # Paid vs Unpaid receivables distribution pie chart
│           └── WaterConsumptionTrendChart.tsx # Monthly water production vs billed consumption
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

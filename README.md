# Tagoloan Water District (TWD) - Full-Stack Water Utility System

A production-grade, real-time water utility management platform designed specifically for the municipal operations of the **Tagoloan Water District** in Misamis Oriental, Philippines.

---

## High-Level Architecture Overview

The system is organized into distinct, decoupled architectural layers:

```text
├── frontend/             # Client Layer (React 19 + Vite + Tailwind CSS)
│   ├── public/           # Static web assets
│   ├── src/              # Presentation, components, state, services, utils
│   └── package.json      # Frontend package configuration
│
├── backend/              # Server Layer (Node.js + Express REST API + WebSockets)
│   ├── config/           # Environment, thresholds, and district configuration
│   ├── controllers/      # API endpoint handlers (Auth, Consumers, Readings, Billing, Reports)
│   ├── models/           # Data models and interfaces
│   ├── routes/           # REST API routes
│   ├── middlewares/      # Security, JWT auth, validation, and error logging
│   ├── services/         # Business logic (stepped tariffs, 3-month grace period engine)
│   ├── utils/            # Shared server utilities
│   ├── server.ts         # Backend service entry point
│   └── package.json      # Backend package configuration
│
├── database/             # Storage Layer (Relational SQL + Cloud Firestore)
│   ├── schema/           # SQL relational schemas and Firestore blueprints
│   ├── rules/            # Firestore security rules
│   ├── seeds/            # Initial municipal seed data and tariff tables
│   ├── connection.ts     # Connection manager & Quota Circuit Breaker
│   └── README.md         # Database documentation
│
├── docs/                 # Documentation & Architecture Justification
│   ├── ARCHITECTURE_JUSTIFICATION.md
│   └── API_WORKFLOWS.md
│
├── PROJECT_STRUCTURE.md  # Master diagnostic map and error tracing guide
└── server.ts             # Development & production server runner
```

---

## Instant Error Tracing Reference

When diagnosing system issues, the folder structure isolates responsibilities for instant tracing:

| Error or Problem Domain | Primary Folder & File | What Gets Investigated |
| :--- | :--- | :--- |
| **Tariff calculation discrepancy** | `backend/services/tariffService.ts`<br>`frontend/src/utils/tariffCalculator.ts` | Tiered cubic meter rates, minimum charges (₱124.50), franchise tax, late surcharges. |
| **Disconnection cutting notice not triggering** | `backend/services/gracePeriodService.ts`<br>`frontend/src/services/gracePeriodScannerService.ts` | 90-day grace period threshold, unpaid cycle count (3+), overdue balance. |
| **Field reading or GPS telemetry issue** | `backend/controllers/readingController.ts`<br>`frontend/src/services/realtimeSocket.ts` | Mobile submission parameters, coordinates, photo uploads. |
| **Duplicate meter serial tag or RFID** | `frontend/src/utils/identifierValidation.ts` | Uniqueness validation before database insertion. |
| **Database quota exhaustion** | `database/connection.ts`<br>`frontend/src/services/firebaseDb.ts` | Circuit-breaker failover to local reactive storage. |
| **UI layout or modal styling** | `frontend/src/components/` | React presentation components. |

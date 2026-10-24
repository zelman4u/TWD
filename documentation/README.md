# Tagoloan Water District (TWD) — Official System Documentation Folder

This folder contains the complete, verified technical and operational documentation for the **Tagoloan Water District (TWD) Smart Water Utility Platform** and its **Mobile Meter Reader App** integration.

## Contents

1. **[01 — System Architecture & Connections](./01-SYSTEM-ARCHITECTURE-AND-CONNECTIONS.md)**
   - Live Development & Shared/Preview Base URLs
   - Express REST API Gateway (`/api/*`), CORS, Double-Prefix Normalization, and Payload Limits
   - WebSocket Real-Time Broker (`wss://<HOST>/ws`) & Heartbeat Protocol
   - Cloud Firestore Collections (`12` collections) & Local-First Storage (`twd_live_v4_*`) with 12-Hour Quota Circuit Breaker
   - Anti-DDoS & Anti-Bot Rate Limiting Rules

2. **[02 — End-to-End Operational Process (8-Stage Workflow)](./02-END-TO-END-OPERATIONAL-PROCESS.md)**
   - Stage 1: Consumer Self-Registration (`Residential` individual household vs. `Commercial` private business)
   - Stage 2: Admin Account Validation & Unique Hardware ID Issuance (`Account #`, `Meter Serial #`, `Smart RFID Tag`)
   - Stage 3: Field Meter Reader Enrollment & Direct Activation
   - Stage 4: Mobile Route Sync & Validated Consumer Filtering
   - Stage 5: Field Distribution Meter Reading Capture (Single Push & Offline Batch Sync — **no** manual intake meter module)
   - Stage 6: Admin Reading Verification, Stepped Tariff Computation, 2% Franchise Tax, & Official SOA Issuance
   - Stage 7: Walk-In Cashier Counter (Auto FIFO / Manual Split, 50% Delinquent Partial Rule) & Gemini Vision Receipt OCR
   - Stage 8: Automated 60-Second Grace Period / 3-Month Disconnection Scanner & Customer Service Ticketing

3. **[03 — Web Portal Modules & Functionalities](./03-WEB-PORTAL-MODULES-AND-FUNCTIONALITIES.md)**
   - Public & Authentication Screens (`Landing Page`, `Unified Login`, `Registration`)
   - All **13 Administrator Workspace Modules** (including sub-modules for Archive Records, Approvals, Meter Readers, Dynamic Residential/Commercial Tariff Rate Manager, Barangays, and Customer Service)
   - All **6 Consumer Portal Modules** (including Pending Issuance Gate, Smart Receipt Upload, Monthly Usage Benchmarks, and Live Service Reports)

4. **[04 — Mobile Meter Reader App Integration Guide](./04-MOBILE-METER-READER-INTEGRATION.md)**
   - Zero-mistake mobile connection checklist, headers, and `twd_jwt_*` Bearer tokens
   - Exact REST endpoints, route aliases, request bodies, status codes (`200`, `201`, `400`, `401`, `403`, `404`, `409`), and JSON responses
   - Strict `isValidatedConsumerForReader` filtering rules & NFC/RFID hardware tag auto-matching
   - Complete Real-Time WebSocket Event Matrix for Mobile, Admin, and Consumer synchronization

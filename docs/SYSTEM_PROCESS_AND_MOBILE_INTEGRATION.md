# Tagoloan Water District (TWD) — Complete System Process, Module Reference & Mobile App Integration Guide

This document is the authoritative, end-to-end technical and operational specification for the **Tagoloan Water District (TWD) Smart Water Utility Platform**. Every URL, REST endpoint, HTTP header, WebSocket channel, Firestore collection, validation rule, tariff formula, and mobile synchronization step documented below matches the live production codebase (`server.ts`, `src/components/*`, `src/services/*`, `src/mockDb.ts`, and `src/utils/*`).

---

## 1. System Topology & Where Everything Connects

### 1.1 Environment & Base Connection URLs
| Environment / Channel | Protocol | Base URL / Path | Purpose |
| :--- | :--- | :--- | :--- |
| **Development Server** | `HTTPS` | `https://ais-dev-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app` | Live dev web app & REST API host (Port `3000`) |
| **Shared / Preview Server** | `HTTPS` | `https://ais-pre-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app` | Public preview web app & REST API host (Port `3000`) |
| **REST API Gateway** | `HTTPS` | `<BASE_URL>/api/*` | Mobile App sync, Auth, OCR, Reports, Consumers, Readings |
| **WebSocket Broker** | `WSS` | `wss://<HOST>/ws` *(aliases: `/api/ws`, `/realtime`, `/socket`)* | Real-time push events across Admin, Consumer, & Mobile App |
| **Cloud Database** | `Firestore` | Database ID: `ai-studio-tagoloanwaterdis-29aaeffc-dbd1-4669-9b5b-63d636462350` | Cloud persistence (`users`, `consumers`, `readers`, `meters`, `readings`, `routes`, `announcements`, `audit_logs`, `notifications`, `barangays`, `settings`, `consumer_reports`) |
| **Local-First Store** | `Browser` | `localStorage` (`twd_live_v4_*` keys + `twd_database_updated` event) | Instant zero-latency UI state + automatic 12-hour Firestore Quota Circuit Breaker (`twd_firestore_quota_exceeded`) |

### 1.2 Global API Middleware & Security Rules (`server.ts`)
- **CORS Policy**: Open cross-origin headers (`Access-Control-Allow-Origin: *`, methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`, headers `Origin, X-Requested-With, Content-Type, Accept, Authorization, x-reader-id, x-employee-id, x-user-id, x-portal, x-role`) so native Android/iOS/Flutter/React Native mobile apps connect directly without CORS blocks.
- **Double-Prefix Normalization**: Any mobile request accidentally sent to `/api/api/...` is automatically rewritten to `/api/...`.
- **Body Payload Limit**: `15mb` JSON & URL-encoded body limit to support Base64 meter dial photos and physical cashier receipt scans.
- **Anti-DDoS & Anti-Bot Rate Limiter**:
  - **Authentication Routes** (`/auth`, `/login`, `/verify`): Maximum **25 requests / 60 seconds** per IP (`429 Too Many Requests` with `Retry-After` header).
  - **General `/api/*` Routes**: Maximum **200 requests / 60 seconds** per IP.
  - **Exempt Health Probes**: `/api/health`, `/api/status`, `/api/ping`, `/api/survival` are never rate-limited.

---

## 2. The Exact Right End-to-End Operational Process (8-Stage Lifecycle)

> **Important Architectural Rule**: There is **NO** manual "Record Intake Meter Readings" module in the Admin Portal. All meter readings originate strictly from **Field Meter Readers using the Mobile App** inspecting individual consumer distribution meters in the field, followed by **Administrator Verification** before any bill is generated.

### Stage 1: Consumer Self-Registration (Pending Approval)
1. **Where**: Web `RegistrationPage` (`POST /api/consumers/register` + `mockDb` + Firestore `consumers` & `users`).
2. **Classification Selection**:
   - **Residential**: Regular community household water consumption managed by a single/individual account holder (not company- or group-based; collects Household Size / Info).
   - **Commercial**: Private commercial/industrial accounts with higher-volume, most expensive tiered water consumption rates (collects Business Name & Business Type).
3. **Strict Validation**:
   - Philippine mobile number normalized (`+639...` or `9...` -> `09XXXXXXXXX`) and strictly checked for **11 digits starting with `09`**.
   - Duplicate mobile numbers and duplicate emails are rejected (`409 Conflict`).
4. **Initial State**:
   - Saved with `status: "pending_approval"`, `accountNumber: ""` (unassigned), `meterNumber: ""`, `rfidTag: ""`.
   - WebSocket broadcasts `CONSUMER_REGISTERED` and `consumer:registered` to the Admin Portal.
   - **Mobile Isolation**: While in `pending_approval` without issued IDs, this consumer is **strictly invisible** to Mobile Meter Readers (`isValidatedConsumerForReader` returns `false`).

### Stage 2: Admin Account Validation & Official Hardware ID Issuance
1. **Where**: Admin Portal -> **Consumers** module -> Pending Account -> **Issue IDs** modal (`POST /api/consumers` or `POST /api/consumers/:identifier/issue-id`).
2. **Action**: Administrator verifies the applicant and issues three globally unique identifiers:
   - **Official Account Number** (e.g., `BRG-01-4821` or `011-102-056`)
   - **Physical Water Meter Serial Number** (e.g., `MT-49201` or `150307143`)
   - **Smart NFC / RFID Meter Tag** (e.g., `RFID-49201`)
3. **Uniqueness Enforcement**: Duplicate Account Numbers, Meter Serials, RFID Tags, or Phone Numbers are blocked (`409 Conflict`).
4. **Activation & Routing**:
   - Consumer `status` transitions to `"active"`.
   - Linked `WaterMeter` hardware entry is registered/activated in `meters` and Barangay active meter count increments.
   - Server broadcasts `CONSUMER_UPDATED` and `CONSUMER_ACTIVATED_FOR_READER`.
   - Consumer Portal unlocks full telemetry/billing tabs, and the account **immediately becomes available to Mobile Meter Readers** assigned to that consumer's Barangay/Zone.
   - *Note*: If an Admin later updates an already-issued Account Number, the physical Meter Serial and Smart RFID Tag remain permanently preserved as hardware identifiers while historical readings, meters, notifications, and login credentials cascade to the new Account Number.

### Stage 3: Field Meter Reader Enrollment & Route Assignment
1. **Where**: Mobile Meter Reader App Registration screen (`POST /api/auth/register`) + Admin Portal -> **Meter Readers** module.
2. **Direct Activation Rule**: Field Meter Readers who register on the Mobile App are set directly to `employmentStatus: "active"` (no pending approval gate) with their selected `assignedRoutes` (1 or multiple Tagoloan Barangays/Zones; defaults to `["Poblacion"]` if none specified) and receive a bearer token (`twd_jwt_<timestamp>_<readerId>`).
3. **Real-Time Admin Visibility**: Server broadcasts `READER_REGISTERED_ACTIVE` and `staff:registered`; the officer appears immediately in Admin Portal -> **Meter Readers** (`Officers` & `Routes` sub-tabs), where Admin can reassign routes, toggle `active`/`inactive`, or permanently terminate the officer.

### Stage 4: Mobile App Route Sync & Consumer Pull
1. **Where**: Mobile App calls `GET /api/barangays` for the 9 official Tagoloan Barangays (`BRG-01` Poblacion through `BRG-09` Sugbongcogon) and pulls its assigned route list via `GET /api/consumers` (or `/api/sync/pull` or `/api/readers/:id/consumers`).
2. **Strict Route & Validation Filtering**:
   - The server identifies the reader via `Authorization: Bearer twd_jwt_..._<readerId>`, `x-reader-id` header, or `?readerId=` query parameter.
   - Only consumers that are **officially validated** (`status` not pending, valid `accountNumber` AND valid `meterNumber`) **AND** located within the reader's `assignedRoutes` (matched by Barangay name, Barangay ID, Sitio/Zone, or Address) are returned, complete with `meterNumber`, `rfidTag`, and `previousReading`.

### Stage 5: Field Meter Reading Capture & Mobile Sync (Online or Offline Batch)
1. **Where**: Mobile App in the field -> `POST /api/readings` (single live push) or `POST /api/readings/batch` (offline queue flush when internet returns).
2. **Field Capture**:
   - Officer scans the physical meter's **NFC/RFID Tag** (`rfidTag`) or **Meter Serial** (`meterNumber`).
   - Mobile App auto-matches the local/synced consumer record and displays `previousReading`.
   - Officer inputs `currentReading`, captures **Meter Dial Photo** (`photoUrl`), and logs **GPS Coordinates** (`latitude`, `longitude`).
   - Consumption is computed as `Math.max(0, currentReading - previousReading)` in cubic meters ($\text{m}^3$).
3. **Submission Queueing (Ghost-Bill Prevention)**:
   - Submitted readings enter `status: "pending_approval"` on the server (`status: "pending"` or `"flagged_abnormal"` if $\ge 50\text{ m}^3$ in Admin Portal).
   - **Crucial Rule**: Unapproved readings **never** generate consumer bills or affect consumer balances until an Administrator approves them.
   - Server broadcasts `READING_SUBMITTED_FOR_APPROVAL` & `reading:submitted` (or `READINGS_BATCH_SYNCED`).

### Stage 6: Admin Verification, Tariff Calculation & Official Bill Issuance
1. **Where**: Admin Portal -> **Approvals** module (`Pending` queue grouped by Field Reader, with photographic dial proof, GPS coordinates, inline reading value correction, or rejection) -> calls `POST /api/readings/:id/approve`.
2. **Official Tariff Computation (`src/utils/tariffCalculator.ts`)**:
   - **Residential (`RES`) Default Tiers** *(Single/individual household community rate)*:
     - `1 – 10 m³`: Fixed **₱75.00** minimum charge
     - `11 – 20 m³`: **+₱8.25** per $\text{m}^3$
     - `21 – 30 m³`: **+₱9.75** per $\text{m}^3$
     - `31 – 40 m³`: **+₱11.50** per $\text{m}^3$
     - `41+ m³`: **+₱13.50** per $\text{m}^3$
   - **Commercial (`COMM`) Default Tiers** *(Private business high-consumption rate)*:
     - `1 – 10 m³`: Fixed **₱150.00** minimum charge
     - `11 – 20 m³`: **+₱16.50** per $\text{m}^3$
     - `21 – 30 m³`: **+₱20.00** per $\text{m}^3$
     - `31 – 40 m³`: **+₱24.00** per $\text{m}^3$
     - `41 – 50 m³`: **+₱28.00** per $\text{m}^3$
     - `51+ m³`: **+₱23.50** per $\text{m}^3$
   - **Local Franchise Tax (2%)**: $\text{round}\left(\frac{\text{Bill Amt} \times 0.02}{0.98}, 2\right)$
   - **Total Amount Due**: $\text{Bill Amt} + \text{Franchise Tax} + \text{Arrears}$
   - **Amount After Due Date (15 days after reading)**: $\text{Total Amount Due} + (10\% \times \text{Bill Amt})$
3. **State Update on Approval**:
   - Reading status becomes `"verified"` (`"approved"` on server), `paymentStatus: "unpaid"`.
   - Server updates consumer's `previousReading = currentReading` so next month's Mobile App sync starts from the new index.
   - Official Statement of Account (SOA) & notification are published to **Consumer Portal**, broadcasting `READING_APPROVED_BILL_ISSUED` and `bill:issued`.

### Stage 7: Bill Settlement (Walk-In Cashier Counter, Online Portal, or Smart Receipt OCR)
1. **Walk-In Cashier Counter**: Admin Portal -> **Process Payment** (`payments` tab). Supports Full or Partial payment, **Auto FIFO** (oldest unpaid bills settled first) or **Manual Per-Bill Allocation**, and generates a printable Official Receipt (`OR`).
2. **50% Minimum Partial Payment Rule**: Accounts under delinquency / Disconnection Notice require at least **50% of total unpaid balance** when making a partial settlement.
3. **Consumer Portal Receipt Upload & Gemini Vision OCR**:
   - Consumer uploads a photo of a physical cashier receipt via `UploadReceiptModal` -> `POST /api/receipts/smart-scan`.
   - Server uses **`gemini-2.5-flash`** (`@google/genai`) with structured JSON schema (plus deterministic heuristic fallback if `GEMINI_API_KEY` is absent) to verify authenticity, extract OR Number, Amount Paid, Payment Date, and Account Number, and cross-validate against the consumer's bill.

### Stage 8: Automated 3-Month Grace Period Scanner & Customer Service Desk
1. **Grace Period & Disconnection Scanner**:
   - Runs every **60 seconds** on both `server.ts` (`GET/POST /api/services/scan-grace-period`) and `gracePeriodScannerService.ts`.
   - Any active account with verified unpaid bills **$\ge 90$ days overdue** (past the 15-day due date) OR **$\ge 3$ unpaid billing cycles** is automatically flagged as **`"Disconnection Notice"`** and notified. Once settled below threshold, it automatically restores to **`"active"`**.
2. **Customer Service Ticketing**:
   - Consumers file leak, low-pressure, meter, or billing concerns (`POST /api/reports`), generating tracking ticket `TWD-CR-YYYY-XXXX` and broadcasting `CONSUMER_REPORT_CREATED`.
   - Admins reply and update ticket statuses (`pending` -> `in_progress` -> `resolved` / `closed`) in **Announcements & Customer Service**, broadcasting `ADMIN_REPLIED_TO_REPORT` and `REPORT_STATUS_CHANGED` live to the Consumer Portal.

---

## 3. Complete Web Portal Modules & Functionalities

### 3.1 Public & Authentication Modules
1. **Landing Page (`LandingPage.tsx`)**: Municipal water district overview, live public advisories/bulletins feed, service coverage across Tagoloan's 9 Barangays, and entry points to Login or Apply for Connection.
2. **Unified Login (`UnifiedLogin.tsx`)**: Single sign-in gateway for **Administrators/Staff** and **Consumers** (supports Email or Account Number + Password, session persistence, and terminated-account blocking).
3. **Consumer Self-Registration (`RegistrationPage.tsx`)**: Multi-field application form with Residential (individual household) vs. Commercial (private business) classification, Barangay & Sitio/Zone selector, 11-digit PH phone normalization/deduplication, and instant backend/Firestore sync.

### 3.2 Administrator Workspace (`AdminPortal.tsx` — All 13 Sidebar Modules)
1. **Dashboard (`dashboard`)**:
   - Executive KPI cards (Total Consumers, Active Technicians, Verified vs. Pending/Abnormal Readings, Revenue & Collection metrics).
   - **Analytics Suite (`AdminAnalyticsSection.tsx`)**: Barangay Distribution Consumption Chart, Water Consumption Trend Chart, Payment Status Breakdown Donut, and Reader Productivity Chart.
   - **Grace Period Scanner Card (`GracePeriodScannerCard.tsx`)**: Live 60s background scanner telemetry + manual "Scan Now" trigger for 3-month / 90-day delinquency enforcement.
2. **Records (`records` — Municipal Archive & Official Reports)**:
   - Unified searchable archive with 9 sub-ledgers: `Official Reports Generator` (printable PDF/CSV municipal summaries), `Consumers`, `Meters`, `Readings`, `Bills`, `Payments`, `Staff`, `Barangays`, and immutable `Audit Logs`.
   - Supports Residential vs. Commercial classification filtering and CSV export.
3. **Consumers (`consumers`)**:
   - Master registry with Pending Approval applications pinned automatically to the top.
   - Multi-filter search (Status, Classification: Residential/Commercial, Barangay, Balance/Name sort).
   - **3-Tab Consumer Management Modal**: `View` ledger, `Edit` profile/status, and `Issue IDs` (issues/updates Account #, Meter Serial #, and Smart RFID Tag with strict duplicate prevention), plus **Permanent Account Termination & Purge**.
4. **Approvals (`approvals`)**:
   - Dedicated verification queue for incoming Mobile Meter Reader submissions (`Pending` queue grouped by Field Officer + `Approval History` ledger).
   - Inspect meter dial photo (`photoUrl`) and GPS coordinates, inline-correct misread cubic meter values, approve single reading, **Batch Approve** an entire officer's route submission, or reject/flag abnormal readings ($\ge 50\text{ m}^3$).
5. **Bills (`bills`)**:
   - Master invoicing ledger displaying verified Statements of Account (SOA), itemized stepped-tier breakdowns, 2% Franchise Tax, 10% overdue penalties, printable official billing notices (`BillDetails.tsx`), and sandboxed bill cancellation with audit reason.
6. **Process Payment (`payments`)**:
   - Walk-in Cashier Counter supporting account lookup, Full vs. Partial payment (enforcing the 50% minimum partial threshold on delinquent accounts), **Auto FIFO** vs. **Manual Bill Selection & Split Allocation**, and printable Official Receipt generation.
7. **Meter Readings (`readings`)**:
   - Historical distribution meter reading log across all barangays with status filtering (`verified`, `pending`, `flagged_abnormal`), dial photo viewer, GPS inspection, and CSV export. *(Strictly field distribution meter readings—no manual intake meter module.)*
8. **Water Meters (`meters`)**:
   - Mechanical hardware inventory (`MT-...` serials, meter brand, installation date, status: `active`, `inactive`, `damaged`, `maintenance`, and linked consumer Account Number).
9. **Meter Readers (`readers`)**:
   - Two sub-tabs:
     - **Field Officers (`officers`)**: Live roster synced with Mobile App registrations, credential/password visibility toggle, route badges, `Active`/`Inactive` status toggle, profile editor, and **Permanent Termination** (blacklists officer across Mobile API & Web).
     - **Route Assignments (`routes`)**: Assigns/reassigns field officers to Barangay reading routes and tracks route completion progress.
10. **Staff (`staff`)**:
    - Two sub-tabs:
      - **Staff & Permissions (`users`)**: Administrative/cashier staff directory and role management.
      - **Tariff Rate Manager (`tariff` — `TariffRateManager.tsx`)**: Dynamic rate configuration under PD 198 / LWUA guidelines. Explicitly separates **Residential** (regular community water use, single/individual account holder) vs. **Commercial** (private commercial accounts with the highest water consumption rates), allowing independent or joint tier adjustments, flat/percentage simulation, optional recalculation of existing unpaid bills, targeted consumer notifications, and automatic public advisory posting.
11. **Barangays (`barangays`)**:
    - Manages Tagoloan's 9 official municipal Barangays (`Poblacion`, `Natumolan`, `Baluarte`, `Sta. Ana`, `Sta. Cruz`, `Mohon`, `Gracia`, `Casinglot`, `Sugbongcogon`), reading schedules, zone supervisors, active meter counts, and drill-down consumer lists per barangay.
12. **Announcements & Customer Service (`announcements`)**:
    - Two sub-tabs:
      - **Public Bulletin (`bulletin`)**: Create, edit, and publish district-wide advisories (`info`, `warning`, `urgent`, `maintenance`, `tariff`).
      - **Customer Service Desk (`customer_service` — `ConsumerReportsManager.tsx`)**: Manage consumer-submitted leak/pressure/billing tickets, assign field maintenance crews, send live replies, and update ticket statuses.
13. **Profile (`profile`)**:
    - District institutional profile (`DistrictProfileSection.tsx`) and Administrator credential/password & notification settings.

### 3.3 Consumer Portal (`ConsumerPortal.tsx` — All 6 Sidebar Modules)
- *Pending State Gate*: Newly registered consumers awaiting Admin ID issuance see an "Account Verification & Meter Issuance in Progress" status screen while retaining access to **Profile** and **Notifications**. Once Admin issues IDs, all 6 modules unlock automatically in real time:
1. **Dashboard (`dashboard`)**: Current cubic meter consumption, active balance, `DynamicDueAlert`, `OverdueBillBanner` (for delinquent/disconnection accounts), active tariff schedule modal, and latest district advisories.
2. **My Bills (`bills`)**: Filterable ledger (`all`, `unpaid`, `paid`, `partial`), printable official Statement of Account (`BillDetails`), digital Official Receipt viewer, interactive live WebSocket payment (`payment:start`), and **Upload Official Cashier Receipt (`UploadReceiptModal`)** powered by Gemini Vision OCR.
3. **My Usage (`usage`)**: Historical monthly consumption chart, cubic meter trend analytics, and printable `MonthlyUsageReportModal` with household conservation benchmarks.
4. **Reports & Inquiries (`reports` — `ConsumerReportsSection.tsx`)**: Submit categorized service tickets (`leak`, `low_pressure`, `no_water`, `meter_issue`, `billing`, `water_quality`, `other`) with urgency level and optional photo, plus real-time chat thread with TWD Administration.
5. **Notifications (`notifications`)**: Real-time inbox filtered by `billing`, `payment`, `account_issue`, and `announcement`, with unread badges and one-click bill spotlighting.
6. **My Profile (`profile`)**: Registered service details (Account #, Meter Serial #, Smart RFID Tag, Classification, Barangay/Zone), contact/household/business updater (with 11-digit phone uniqueness validation), and password change.

---

## 4. Mobile Meter Reader App Integration Specification (Zero-Mistake Reference)

The external **Mobile Meter Reader App** connects directly to the Express + WebSocket backend (`server.ts`) over HTTPS and WSS. Below is the exact contract.

### 4.1 Mobile App Connection Checklist
- **REST Base URL**: `https://ais-dev-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app` *(or Shared `ais-pre-...` URL in production)*
- **WebSocket URL**: `wss://ais-dev-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app/ws`
- **Recommended Headers on Authenticated Requests**:
  ```http
  Content-Type: application/json
  Authorization: Bearer <token_from_login_or_register>
  x-reader-id: <reader.id>
  ```
- **Health Check Before Sync**:
  - `GET /api/health` *(aliases: `/api/status`, `/api/ping`, `/api/survival`)* -> Returns `200 OK` `{ "status": "ok", "service": "Tagoloan Water District Sync Gateway", ... }`.

---

### 4.2 Step A — Fetch Official Barangays / Routes (For Registration & Route Picker)
- **Endpoint**: `GET /api/barangays` *(aliases: `GET /api/routes`, `GET /api/areas`)*
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "count": 9,
    "barangays": [
      { "id": "BRG-01", "name": "Poblacion", "code": "PB-01", "schedule": "1st - 5th of Month" },
      { "id": "BRG-02", "name": "Natumolan", "code": "NT-02", "schedule": "6th - 10th of Month" },
      { "id": "BRG-03", "name": "Baluarte", "code": "BL-03", "schedule": "11th - 15th of Month" },
      { "id": "BRG-04", "name": "Sta. Ana", "code": "SA-04", "schedule": "16th - 20th of Month" },
      { "id": "BRG-05", "name": "Sta. Cruz", "code": "SC-05", "schedule": "21st - 25th of Month" },
      { "id": "BRG-06", "name": "Mohon", "code": "MH-06", "schedule": "26th - End of Month" },
      { "id": "BRG-07", "name": "Gracia", "code": "GR-07", "schedule": "1st - 5th of Month" },
      { "id": "BRG-08", "name": "Casinglot", "code": "CS-08", "schedule": "6th - 10th of Month" },
      { "id": "BRG-09", "name": "Sugbongcogon", "code": "SG-09", "schedule": "11th - 15th of Month" }
    ],
    "data": [ ... ]
  }
  ```

---

### 4.3 Step B — Meter Reader Registration (Immediate Active Enrollment)
- **Endpoint**: `POST /api/auth/register`
- **Supported Aliases**: `POST /api/readers/register`, `POST /api/readers`, `POST /api/auth/register-reader`, `POST /api/staff/register`, `POST /api/staff`
- **Request Body**:
  ```json
  {
    "fullName": "Juan Dela Cruz",
    "username": "juan_reader",
    "email": "juan@tagoloanwater.gov.ph",
    "contactNumber": "09171234567",
    "password": "ReaderPass123!",
    "assignedRoutes": ["Poblacion", "Natumolan"]
  }
  ```
  *(Note: `name` or `fullName` is accepted; `assignedRoutes` accepts an array, comma-separated string, or `barangays`/`routes`/`zone`. Defaults to `["Poblacion"]` if omitted.)*
- **Behavior**:
  - Creates reader with `employmentStatus: "active"` immediately (no admin approval bottleneck).
  - Clears any prior termination lock if re-enrolling a previously removed officer.
  - Broadcasts `READER_REGISTERED_ACTIVE` and `staff:registered` to the Admin Web Portal.
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "status": "active",
    "employmentStatus": "active",
    "token": "twd_jwt_1761268000000_WDT-2026-482",
    "message": "Registration complete! Your field meter reader account is now active.",
    "reader": {
      "id": "WDT-2026-482",
      "employeeId": "WDT-2026-482",
      "name": "Juan Dela Cruz",
      "username": "juan_reader",
      "email": "juan@tagoloanwater.gov.ph",
      "contactNumber": "09171234567",
      "assignedRoutes": ["Poblacion", "Natumolan"],
      "zone": "Poblacion, Natumolan",
      "employmentStatus": "active"
    },
    "user": { ... }
  }
  ```

---

### 4.4 Step C — Meter Reader Login & Account Status Check
- **Login Endpoint**: `POST /api/auth/login` *(aliases: `POST /api/readers/login`, `POST /api/login`, `POST /api/auth/token`)*
- **Request Body**:
  ```json
  {
    "username": "juan_reader",
    "password": "ReaderPass123!"
  }
  ```
  *(Accepts `username`, `email`, or `identifier` matching `username`, `email`, `id`, `employeeId`, or `name`.)*
- **Exact Status Responses**:
  - **`200 OK` (Active)**: Returns `{ success: true, status: "active", token: "twd_jwt_<ts>_<reader.id>", reader, user }`.
  - **`401 Unauthorized`**: Invalid username or password (`errorCode: "AUTH_INVALID_CREDENTIALS"`).
  - **`403 Forbidden` (`status: "inactive"`)**: Admin toggled officer to Inactive (`"Your field account is currently set to Inactive by the Administrator."`).
  - **`403 Forbidden` (`status: "terminated"`)**: Admin permanently deleted/terminated officer (`"Your field officer account has been permanently terminated and erased by the Administrator."`).
- **Session Status Poll Endpoint**:
  - `GET /api/readers/check-status/:id` *(aliases: `/api/auth/check-status/:id`, `/api/readers/:id/status`, `/api/staff/check-status/:id`, `/api/readers/:id`)*
  - Returns `200 OK` (`employmentStatus: "active" | "inactive"`) or `404` (`status: "terminated", terminated: true`) if erased by Admin—allowing the mobile app to auto-logout terminated devices immediately.

---

### 4.5 Step D — Pull Assigned & Validated Consumers for Field Route (Online & Offline Cache)
- **Primary Endpoints**:
  1. `GET /api/consumers` *(aliases: `GET /api/sync/pull`, `GET /api/sync/consumers`)*
  2. `GET /api/readers/:id/consumers` *(aliases: `GET /api/staff/:id/consumers`, `GET /api/consumers/by-reader/:readerId`, `GET /api/consumers/assigned/:readerId`)*
- **How the Server Identifies the Mobile Reader's Assigned Barangays**:
  Pass **any one** of the following:
  1. Header `Authorization: Bearer twd_jwt_<timestamp>_<readerId>` *(automatically parsed by `server.ts`)*
  2. Header `x-reader-id: <readerId>` *(or `x-employee-id` / `x-user-id`)*
  3. Query parameter `?readerId=<readerId>` *(or `?username=<username>`)*
  4. Explicit route override `?barangays=Poblacion,Natumolan` *(or `?zones=` / `?routes=`)*
- **Optional Query Filters**:
  - `?tag=<SCANNED_RFID_OR_METER_TAG>` *(or `?meterNumber=` / `?rfidTag=`)*: Exact hardware tag lookup for instant NFC/QR/camera matching.
  - `?search=<query>`: Searches across Account #, Name, Meter #, RFID Tag, Barangay, and Sitio/Zone.
- **CRITICAL FILTERING RULE (`isValidatedConsumerForReader`)**:
  - Mobile readers **ONLY** receive consumers where:
    1. `status` is **NOT** `"pending"` and **NOT** `"pending_approval"`
    2. `accountNumber` is non-empty and does **NOT** start with `"PENDING"` / `"UNASSIGNED"`
    3. `meterNumber` is non-empty and does **NOT** start with `"PENDING"` / `"UNASSIGNED"`
    4. Consumer's `barangay`, `barangayId`, `sitioZone`, or `address` matches at least one route in the reader's `assignedRoutes`.
  - *(Note: Only Admin requests carrying header `x-role: admin` / `x-portal: admin` or query `?includePending=true` / `?view=admin` receive unvalidated pending applications.)*
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "count": 3,
    "readerId": "WDT-2026-482",
    "assignedRoutes": ["Poblacion"],
    "consumers": [
      {
        "accountNumber": "011-102-056",
        "name": "FIGUEROA, GINA O.",
        "address": "SIHAYON-LEFT (ZONE-11A)",
        "barangay": "Poblacion",
        "sitioZone": "ZONE-11A",
        "meterNumber": "150307143",
        "rfidTag": "RFID-150307143",
        "previousReading": 182,
        "lastReadingDate": "2024-10-15",
        "consumerType": "Residential",
        "status": "active",
        "contactNumber": "+63 917 123 4567"
      }
    ],
    "data": [ ... ]
  }
  ```

---

### 4.6 Step E — Submit Field Meter Readings (Live Single Push & Offline Batch Sync)

#### Option 1: Single Live Reading Push
- **Endpoint**: `POST /api/readings` *(aliases: `POST /api/sync/push`, `POST /api/readings/submit`, `POST /api/readings/upload`)*
- **Request Body**:
  ```json
  {
    "accountNumber": "011-102-056",
    "consumerName": "FIGUEROA, GINA O.",
    "meterNumber": "150307143",
    "billingPeriod": "October 2026",
    "readingDate": "2026-10-24",
    "previousReading": 182,
    "currentReading": 199,
    "readerId": "WDT-2026-482",
    "readerName": "Juan Dela Cruz",
    "route": "Poblacion",
    "photoUrl": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "coordinates": {
      "latitude": 8.5372,
      "longitude": 124.7523
    },
    "notes": "Clear meter dial; normal pressure"
  }
  ```
  - **Tag Auto-Match**: Even if `accountNumber` is omitted during an offline NFC/RFID scan, passing `meterNumber` (matching either `consumer.meterNumber` or `consumer.rfidTag`) automatically resolves the consumer's `accountNumber`, `consumerName`, `previousReading`, and `barangay` on the server!
  - **Validation**: `currentReading` is required (`400 Bad Request` if missing) and either `accountNumber` or `meterNumber` must be provided.
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Reading submitted successfully and routed to Admin Verification Queue.",
    "submissionId": "READ-48291",
    "consumption": 17,
    "status": "pending_approval"
  }
  ```

#### Option 2: Offline Queue Batch Upload (When Connectivity Restores)
- **Endpoint**: `POST /api/readings/batch` *(aliases: `POST /api/sync/batch`, `POST /api/readings/bulk`)*
- **Request Body**: Either a raw JSON array `[ {...}, {...} ]` OR `{ "readings": [ {...}, {...} ] }`.
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Successfully processed and synced 12 field readings.",
    "count": 12,
    "syncedIds": ["READ-10293", "READ-10294", "..."]
  }
  ```

---

### 4.7 Step F — Real-Time WebSocket Protocol (`wss://<HOST>/ws`)

Both the Web Portals and the Mobile App can connect to `wss://<HOST>/ws` for zero-latency event streaming.

- **Keepalive / Heartbeat**:
  - Server sends `{"type":"system:connected", ...}` immediately upon upgrade and `{"type":"system:heartbeat","timestamp":...}` + WebSocket Ping frames every **20 seconds**.
  - Clients send `{"type":"ping","timestamp":...}` every 20 seconds; server replies `{"type":"pong","timestamp":...}`.
- **Complete WebSocket Event Matrix**:

| Event `type` | Emitted By | Consumed By | Trigger & Purpose |
| :--- | :--- | :--- | :--- |
| `CONSUMER_REGISTERED` / `consumer:registered` | Server | Admin Portal | New consumer self-registered (`pending_approval`). |
| `CONSUMER_UPDATED` | Server | Admin, Consumer, Mobile | Consumer profile or official IDs updated. |
| `CONSUMER_ACTIVATED_FOR_READER` | Server | Mobile App, Admin | Admin issued Account #, Meter #, & RFID Tag; mobile app refreshes route list. |
| `CONSUMER_DELETED` | Server | Admin, Mobile | Consumer purged from registry; mobile app removes from cached route. |
| `READER_REGISTERED_ACTIVE` / `staff:registered` | Server | Admin Portal | Field officer registered via Mobile App and set `active`. |
| `staff:status_updated` | Server / Admin | Mobile App, Admin | Admin toggled reader `active`/`inactive` or updated assigned routes. |
| `READER_TERMINATED` / `staff:terminated` | Server | Mobile App, Admin | Admin permanently erased reader; mobile app immediately revokes session. |
| `READING_SUBMITTED_FOR_APPROVAL` / `reading:submitted` | Server | Admin Portal | Single field reading pushed from Mobile App to Admin Approvals queue. |
| `READINGS_BATCH_SYNCED` | Server | Admin Portal | Offline batch of readings uploaded from Mobile App. |
| `READING_APPROVED_BILL_ISSUED` / `bill:issued` | Server | Consumer Portal, Mobile | Admin verified reading; bill issued to consumer & `previousReading` updated. |
| `tariff:updated` | Admin Portal | Admin, Consumer | Residential and/or Commercial water tariff rates updated. |
| `payment:start` -> `payment:step` -> `payment:done` / `payment:broadcast` | Consumer / Server | Consumer, Admin | Interactive live payment settlement flow and cross-portal ledger update. |
| `service:grace_period_scan_complete` | Server | Admin, Consumer | 60-second automated 3-month delinquency/disconnection scan updated accounts. |
| `CONSUMER_REPORT_CREATED` / `consumer:report:created` | Server | Admin Portal | Consumer filed a new leak/billing/service concern ticket. |
| `ADMIN_REPLIED_TO_REPORT` / `CONSUMER_REPLIED_TO_REPORT` / `REPORT_STATUS_CHANGED` | Server | Consumer, Admin | Live customer service ticket reply or status change (`in_progress`, `resolved`, `closed`). |

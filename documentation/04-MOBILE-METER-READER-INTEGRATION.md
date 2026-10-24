# 04 — Mobile Meter Reader App Integration Guide (Zero-Mistake Reference)

This specification defines the exact network contract between the external **Mobile Meter Reader App** and the Tagoloan Water District backend server.

---

## 1. Connection URLs & Required Headers

- **Development Base URL**: `https://ais-dev-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app`
- **Shared / Preview Base URL**: `https://ais-pre-ui6fsepfskrowqsfycbac7-946013608969.asia-southeast1.run.app`
- **WebSocket Endpoint**: `wss://<HOST>/ws` *(aliases: `/api/ws`, `/realtime`, `/socket`)*

### Standard HTTP Headers (Include on Authenticated Calls)
```http
Content-Type: application/json
Authorization: Bearer twd_jwt_<timestamp>_<readerId>
x-reader-id: <readerId>
```

---

## 2. Step-by-Step Mobile API Endpoints

### 2.1 Connectivity / Health Check
- **Method & Path**: `GET /api/health`
- **Aliases**: `GET /api/status`, `GET /api/ping`, `GET /api/survival`
- **Rate Limit**: Exempt (unlimited).
- **Response (`200 OK`)**:
  ```json
  {
    "status": "ok",
    "service": "Tagoloan Water District Sync Gateway"
  }
  ```

---

### 2.2 Fetch Official Tagoloan Barangays / Routes
Use this endpoint on the Mobile App's Registration and Route Filter screens.
- **Method & Path**: `GET /api/barangays`
- **Aliases**: `GET /api/routes`, `GET /api/areas`
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

### 2.3 Meter Reader Registration (Direct Active Enrollment)
- **Method & Path**: `POST /api/auth/register`
- **Aliases**: `POST /api/readers/register`, `POST /api/readers`, `POST /api/auth/register-reader`, `POST /api/staff/register`, `POST /api/staff`
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
  - Accepts `fullName` or `name`.
  - Accepts `assignedRoutes` (array or comma-separated string), `barangays`, `routes`, or `zone` (defaults to `["Poblacion"]` if omitted).
- **Exact Server Behavior**:
  - Enrolls officer immediately as `employmentStatus: "active"` (no pending approval delay).
  - Clears any prior termination lock if re-registering an officer.
  - Broadcasts `READER_REGISTERED_ACTIVE` and `staff:registered` via WebSocket so the officer appears live in **Admin $\rightarrow$ Meter Readers**.
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "status": "active",
    "employmentStatus": "active",
    "token": "twd_jwt_1761268000000_WDT-2026-482",
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

### 2.4 Meter Reader Login & Session Verification
- **Login Endpoint**: `POST /api/auth/login`
- **Aliases**: `POST /api/readers/login`, `POST /api/login`, `POST /api/auth/token`
- **Request Body**:
  ```json
  {
    "username": "juan_reader",
    "password": "ReaderPass123!"
  }
  ```
  *(Matches `username`, `email`, `identifier`, `id`, `employeeId`, or `name`.)*
- **Status Codes**:
  - `200 OK`: `{ "success": true, "status": "active", "token": "twd_jwt_...", "reader": {...}, "user": {...} }`
  - `401 Unauthorized`: Invalid username or password (`errorCode: "AUTH_INVALID_CREDENTIALS"`).
  - `403 Forbidden` (`status: "inactive"`): Account deactivated by Administrator.
  - `403 Forbidden` (`status: "terminated"`): Account permanently deleted/terminated by Administrator.
- **Live Status Check Endpoint**:
  - `GET /api/readers/check-status/:id` *(aliases: `/api/auth/check-status/:id`, `/api/readers/:id/status`, `/api/staff/check-status/:id`, `/api/readers/:id`)*
  - Returns `200 OK` (`employmentStatus: "active" | "inactive"`) or `404 Not Found` (`{ "status": "terminated", "terminated": true }`). If `terminated: true` or `403/404` is returned, the Mobile App must wipe its local token and return to the Login screen.

---

### 2.5 Pull Assigned & Validated Consumers for Field Route
- **Primary Endpoints**:
  1. `GET /api/consumers` *(aliases: `GET /api/sync/pull`, `GET /api/sync/consumers`)*
  2. `GET /api/readers/:id/consumers` *(aliases: `GET /api/staff/:id/consumers`, `GET /api/consumers/by-reader/:readerId`, `GET /api/consumers/assigned/:readerId`)*
- **Reader Identification (any one works)**:
  1. `Authorization: Bearer twd_jwt_<timestamp>_<readerId>`
  2. Header `x-reader-id: <readerId>` *(or `x-employee-id` / `x-user-id`)*
  3. Query `?readerId=<readerId>` *(or `?username=<username>`)*
  4. Explicit barangay filter `?barangays=Poblacion,Natumolan`
- **Hardware Tag Scan & Search Parameters**:
  - `?tag=<SCANNED_RFID_OR_METER_SERIAL>` *(aliases: `?meterNumber=`, `?rfidTag=`)* — exact case-insensitive match against `consumer.meterNumber` or `consumer.rfidTag`.
  - `?search=<keyword>` — partial search across Account #, Name, Meter #, RFID Tag, Barangay, and Sitio/Zone.
- **Strict Validation Gate (Zero-Mistake Rule)**:
  - The server **strictly excludes** any consumer where `status` is `"pending"` or `"pending_approval"`, OR where `accountNumber` or `meterNumber` is empty / starts with `"PENDING"` or `"UNASSIGNED"`.
  - Only consumers that have had official IDs issued by the Admin **AND** belong to the reader's `assignedRoutes` (matched by `barangay`, `barangayId`, `sitioZone`, or `address`) are returned.
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "count": 2,
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

### 2.6 Submit Field Meter Readings (Single Live Push & Offline Queue Batch)

#### A. Single Live Reading Push
- **Method & Path**: `POST /api/readings`
- **Aliases**: `POST /api/sync/push`, `POST /api/readings/submit`, `POST /api/readings/upload`
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
    "notes": "Clear meter dial; normal line pressure"
  }
  ```
  - **Automatic Hardware Tag Resolution**: If the Mobile App scans an NFC/RFID tag or meter barcode and sends `meterNumber` (even without `accountNumber`), the server automatically matches `consumer.meterNumber` or `consumer.rfidTag` and populates `accountNumber`, `consumerName`, `previousReading`, and `route`.
  - **Required Fields**: `currentReading` AND (`accountNumber` OR `meterNumber`). Missing these returns `400 Bad Request`.
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

#### B. Offline Queue Batch Sync
When field officers inspect meters in dead-spot areas without mobile data, queue readings locally on the device and push them in bulk once connectivity returns:
- **Method & Path**: `POST /api/readings/batch`
- **Aliases**: `POST /api/sync/batch`, `POST /api/readings/bulk`
- **Request Body**: `[ { ...reading1 }, { ...reading2 } ]` OR `{ "readings": [ { ...reading1 }, { ...reading2 } ] }`
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Successfully processed and synced 12 field readings.",
    "count": 12,
    "syncedIds": ["READ-10293", "READ-10294"]
  }
  ```

---

## 3. WebSocket Real-Time Event Matrix (`wss://<HOST>/ws`)

- **Heartbeat**: Send `{"type":"ping","timestamp":1761268000000}` every `20s`. Server replies `{"type":"pong",...}` and broadcasts `{"type":"system:heartbeat",...}` every `20s`.

| Event `type` | Direction | Exact Action to Take |
| :--- | :--- | :--- |
| `CONSUMER_ACTIVATED_FOR_READER` | Server $\rightarrow$ Mobile & Admin | Admin issued Account #, Meter #, & RFID Tag. Mobile App refreshes assigned consumer route list. |
| `CONSUMER_UPDATED` | Server $\rightarrow$ Mobile, Admin, Consumer | Consumer details or Account # updated; re-sync local consumer cache. |
| `CONSUMER_DELETED` | Server $\rightarrow$ Mobile & Admin | Consumer deleted; purge record from Mobile App offline cache. |
| `READER_REGISTERED_ACTIVE` / `staff:registered` | Server $\rightarrow$ Admin | New Mobile Meter Reader enrolled; Admin Portal refreshes Meter Readers roster. |
| `staff:status_updated` | Server/Admin $\rightarrow$ Mobile & Admin | Officer toggled `active`/`inactive` or routes changed; Mobile App re-checks status & routes. |
| `READER_TERMINATED` / `staff:terminated` | Server $\rightarrow$ Mobile & Admin | Officer permanently erased by Admin; Mobile App clears token and forces immediate logout. |
| `READING_SUBMITTED_FOR_APPROVAL` / `reading:submitted` | Server $\rightarrow$ Admin | Mobile reading pushed; Admin Approvals queue shows toast & loads new pending item. |
| `READINGS_BATCH_SYNCED` | Server $\rightarrow$ Admin | Offline batch uploaded from Mobile App; Admin Approvals queue refreshes. |
| `READING_APPROVED_BILL_ISSUED` / `bill:issued` | Server $\rightarrow$ Consumer & Mobile | Admin verified reading; bill published to Consumer Portal & `previousReading` updated on server. |
| `tariff:updated` | Admin $\rightarrow$ Admin & Consumer | Residential or Commercial tariff schedule updated. |
| `service:grace_period_scan_complete` | Server $\rightarrow$ Admin & Consumer | 60s automated 3-month disconnection scan updated delinquent accounts. |
| `CONSUMER_REPORT_CREATED` / `ADMIN_REPLIED_TO_REPORT` / `REPORT_STATUS_CHANGED` | Server $\leftrightarrow$ Admin & Consumer | Live customer service ticket creation, replies, and status transitions. |

# 02 — End-to-End Operational Process (8-Stage Workflow)

> **Foundational Rule**: There is **NO** manual "Record Intake Meter Readings" module in the system. All water consumption readings come strictly from **Field Meter Readers using the Mobile App** inspecting individual consumer distribution meters, and **no consumer bill is ever generated** until an Administrator verifies and approves the reading.

---

## Stage 1: Consumer Self-Registration (`pending_approval`)
1. **Entry Point**: Public Registration screen (`POST /api/consumers/register`).
2. **Account Classification**:
   - **Residential**: Regular community water consumption handled by a single/individual account person (not company- or group-based; records Household Size/Info).
   - **Commercial**: Private commercial/business accounts with higher-volume, most expensive tiered water consumption rates (records Business Name & Business Type).
3. **Validation Rules**:
   - Philippine mobile numbers are normalized (`+639...` or `9...` $\rightarrow$ `09XXXXXXXXX`) and strictly validated to be **11 digits starting with `09`**.
   - Duplicate mobile numbers and duplicate email addresses across the district are blocked (`409 Conflict`).
4. **System Result**:
   - Saved with `status: "pending_approval"` and blank Account Number, Meter Serial, and RFID Tag.
   - Server broadcasts `CONSUMER_REGISTERED` / `consumer:registered` to the Admin Workspace.
   - **Mobile Isolation**: Pending consumers are **strictly excluded** from all Mobile Meter Reader route pulls until validated by an Administrator.

---

## Stage 2: Admin Account Validation & Official Hardware ID Issuance
1. **Entry Point**: **Admin Workspace $\rightarrow$ Consumers** (pending applications automatically pin to the top of the table) $\rightarrow$ **Issue IDs** modal (`POST /api/consumers` / `POST /api/consumers/:identifier/issue-id`).
2. **Issued Identifiers**:
   - **Official Account Number** (e.g., `BRG-01-4821` or `011-102-056`)
   - **Physical Water Meter Serial Number** (e.g., `MT-49201` or `150307143`)
   - **Smart NFC / RFID Meter Tag** (e.g., `RFID-49201`)
3. **Strict Uniqueness Checks**: Duplicate Account Numbers, Meter Serials, RFID Tags, or Phone Numbers are blocked (`409 Conflict`).
4. **System Result**:
   - Consumer `status` becomes `"active"`, linked mechanical meter is registered in **Water Meters**, and Barangay active meter count increments.
   - Server broadcasts `CONSUMER_UPDATED` and `CONSUMER_ACTIVATED_FOR_READER`.
   - Consumer Portal unlocks all billing/usage features, and the consumer **immediately appears in the Mobile Meter Reader App** for officers assigned to that Barangay/Zone.
   - *Account Number Re-Issuance Rule*: If an Admin updates an already-issued consumer's Account Number later, the physical **Meter Serial** and **Smart RFID Tag** remain permanently preserved as hardware identifiers while all readings, bills, meters, notifications, and login accounts cascade to the new Account Number.

---

## Stage 3: Field Meter Reader Enrollment & Route Assignment
1. **Entry Point**: Mobile Meter Reader App Registration (`POST /api/auth/register`) + **Admin Workspace $\rightarrow$ Meter Readers**.
2. **Immediate Activation**: Field officers registering on the Mobile App are set directly to `employmentStatus: "active"` (no pending admin approval gate), assigned their chosen Tagoloan Barangays (`assignedRoutes`, defaulting to `["Poblacion"]` if unspecified), and issued bearer token `twd_jwt_<timestamp>_<readerId>`.
3. **Admin Governance**: Server broadcasts `READER_REGISTERED_ACTIVE` & `staff:registered` to Admin. Administrators can reassign Barangay routes, toggle an officer `Active`/`Inactive`, or **Permanently Terminate** an officer (which blacklists their ID/username/email and revokes mobile login/sync access).

---

## Stage 4: Mobile Route Sync & Validated Consumer Pull
1. **Barangay Sync**: Mobile App fetches the 9 official Tagoloan Barangays via `GET /api/barangays` (`Poblacion`, `Natumolan`, `Baluarte`, `Sta. Ana`, `Sta. Cruz`, `Mohon`, `Gracia`, `Casinglot`, `Sugbongcogon`).
2. **Route Consumer Pull**: Mobile App calls `GET /api/consumers` (or `/api/sync/pull` or `/api/readers/:id/consumers`) with its Bearer token or `x-reader-id` header.
3. **Strict Filtering**: Server returns **only validated consumers** (`status` not pending, valid issued `accountNumber` AND `meterNumber`) whose `barangay`, `barangayId`, `sitioZone`, or `address` matches the officer's `assignedRoutes`, including `previousReading` and `rfidTag` for offline caching.

---

## Stage 5: Field Meter Reading Capture & Sync (Online or Offline Batch)
1. **Field Inspection**: Officer scans the physical meter's **NFC/RFID Tag** or **Meter Serial** on the Mobile App to auto-match the consumer, enters `currentReading`, snaps a **Meter Dial Photo**, and captures **GPS Coordinates**.
2. **Consumption Formula**: $\text{Consumption (m}^3\text{)} = \max(0, \text{currentReading} - \text{previousReading})$.
3. **Live or Batch Sync**:
   - Online single submission: `POST /api/readings` (alias `/api/sync/push`).
   - Offline queue flush when signal returns: `POST /api/readings/batch` (alias `/api/sync/batch`).
4. **Ghost-Bill Prevention**: Readings are stored as `pending_approval` (flagged `flagged_abnormal` in Admin if usage $\ge 50\text{ m}^3$) and broadcast `READING_SUBMITTED_FOR_APPROVAL` / `READINGS_BATCH_SYNCED`. **Unapproved readings never create consumer bills or alter payable balances.**

---

## Stage 6: Admin Verification, Tariff Calculation & Bill Issuance
1. **Entry Point**: **Admin Workspace $\rightarrow$ Approvals** (`Pending` queue grouped by Field Officer).
2. **Review Actions**: Supervisor inspects the dial photo, GPS coordinates, and $\text{m}^3$ delta; can inline-correct misread digits, reject, approve individually, or **Batch Approve** an officer's entire route (`POST /api/readings/:id/approve`).
3. **Official Stepped Water Tariff Calculation** *(configurable in Staff $\rightarrow$ Tariff Rate Manager)*:
   - **Residential (`RES`) Default Schedule** *(Regular community household rate — single/individual account)*:
     - `1 – 10 m³`: **₱75.00** fixed minimum charge
     - `11 – 20 m³`: **+₱8.25 / m³**
     - `21 – 30 m³`: **+₱9.75 / m³**
     - `31 – 40 m³`: **+₱11.50 / m³**
     - `41+ m³`: **+₱13.50 / m³**
   - **Commercial (`COMM`) Default Schedule** *(Private business high-consumption rate)*:
     - `1 – 10 m³`: **₱150.00** fixed minimum charge
     - `11 – 20 m³`: **+₱16.50 / m³**
     - `21 – 30 m³`: **+₱20.00 / m³**
     - `31 – 40 m³`: **+₱24.00 / m³**
     - `41 – 50 m³`: **+₱28.00 / m³**
     - `51+ m³`: **+₱23.50 / m³**
   - **2% Local Franchise Tax**: $\text{round}\left(\frac{\text{Bill Amt} \times 0.02}{0.98}, 2\right)$
   - **Total Amount Due**: $\text{Bill Amt} + \text{Franchise Tax} + \text{Arrears}$
   - **Amount After Due Date (15 days after reading)**: $\text{Total Amount Due} + (10\% \times \text{Bill Amt})$
4. **Post-Approval Sync**: Reading becomes `verified`, server updates `consumer.previousReading = currentReading` for next month's Mobile App pull, publishes the Statement of Account (SOA) to the Consumer Portal, and broadcasts `READING_APPROVED_BILL_ISSUED` / `bill:issued`.

---

## Stage 7: Bill Settlement & Smart Receipt OCR
1. **Walk-In Cashier Counter (`Admin -> Process Payment`)**: Supports Full or Partial cash payments with **Auto FIFO** (oldest unpaid bills settled first) or **Manual Per-Bill Split Allocation**, generating printable Official Receipts (`OR`).
2. **50% Delinquency Partial Rule**: Accounts in delinquency / Disconnection Notice status must pay **at least 50% of total unpaid balance** when making a partial payment.
3. **Consumer Portal Payment & AI Receipt Verification**:
   - Consumers can pay directly online (live WebSocket `payment:start` $\rightarrow$ `payment:done`) OR upload a photo of a physical cashier receipt (`POST /api/receipts/smart-scan`).
   - Backend runs **Gemini Vision (`gemini-2.5-flash`)** with structured JSON extraction (plus deterministic heuristic fallback) to verify receipt authenticity, OR Number, Amount Paid, Date, and Account Number.

---

## Stage 8: Automated 3-Month Disconnection Scanner & Service Desk
1. **60-Second Grace Period Scanner** (`GET/POST /api/services/scan-grace-period`):
   - Evaluates all verified unpaid bills every 60 seconds.
   - Any active account with unpaid bills **$\ge 90$ days overdue** (past its 15-day due date) OR **$\ge 3$ unpaid billing cycles** is automatically flagged as **`Disconnection Notice`** and sent an urgent cutting-order alert. Settling the balance automatically restores the account to **`active`**.
2. **Customer Service & Leak Ticketing** (`/api/reports`):
   - Consumers submit leak, pressure, water quality, meter, or billing concerns (`TWD-CR-YYYY-XXXX`), broadcasting `CONSUMER_REPORT_CREATED`.
   - Admins assign crews, reply (`ADMIN_REPLIED_TO_REPORT`), and update statuses (`pending` $\rightarrow$ `in_progress` $\rightarrow$ `resolved` / `closed`).

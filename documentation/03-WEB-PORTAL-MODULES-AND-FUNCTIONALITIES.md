# 03 — Web Portal Modules & Functionalities

## 1. Public & Authentication Modules

| Screen / Module | Key Functionalities |
| :--- | :--- |
| **Landing Page** | Municipal water utility overview, 9-Barangay service coverage summary, live public advisories/bulletins feed, and navigation to Sign In or Register. |
| **Unified Login** | Single sign-in gateway for **Administrators/Staff** and **Consumers**. Supports Email or Account Number + Password, session persistence, and terminated-account blocking. |
| **Consumer Registration** | Self-service connection application with **Residential** (single/individual household) vs. **Commercial** (private business) classification, Barangay & Sitio/Zone selector, strict 11-digit PH mobile number normalization/deduplication (`09XXXXXXXXX`), and live Admin sync. |

---

## 2. Administrator Workspace (All 13 Sidebar Modules)

### 1. Dashboard (`dashboard`)
- Executive KPI summary cards (Total Consumers, Registered Web Users, Active Field Technicians, Verified vs. Pending/Flagged Readings, Open Concerns).
- **Analytics Suite**:
  - *Barangay Water Consumption Chart* (verified distribution meter usage per Barangay).
  - *Water Consumption Trend Chart* (monthly cubic meter distribution trends).
  - *Payment Status Breakdown Donut* (`Paid`, `Unpaid`, `Partial`, `Overdue`).
  - *Field Reader Productivity Chart*.
- **Grace Period Scanner Card**: Live status of the 60-second background 3-month / 90-day delinquency scanner with a manual **"Scan Now"** button.

### 2. Records (`records` — Municipal Archive & Official Reports)
- Unified municipal archive containing **9 specialized sub-tabs**:
  1. `Official Reports` (printable municipal summary reports & financial/consumption statements)
  2. `Consumers`
  3. `Meters`
  4. `Readings`
  5. `Bills`
  6. `Payments`
  7. `Staff`
  8. `Barangays`
  9. `Audit Logs` (immutable chronological trail of all admin, staff, and consumer actions)
- Supports search, **Residential vs. Commercial** classification filtering, and one-click CSV export.

### 3. Consumers (`consumers`)
- Master service registry where **Pending Approval** applications automatically pin to the top.
- Filter by Status (`active`, `pending_approval`, `Disconnection Notice`, `inactive`, `blocked`, `archived`), Classification (`Residential`, `Commercial`), Barangay, and Sort Order.
- **3-Tab Consumer Management Modal**:
  - `View`: Full account ledger, meter binding, and balance summary.
  - `Edit`: Modify personal/business info, 11-digit phone (with duplicate protection), classification, and account status.
  - `Issue IDs`: Assign or update **Account Number**, **Meter Serial Number**, and **Smart RFID Tag** with strict district-wide duplicate prevention (`409` check).
- **Permanent Account Termination**: Full erasure across local store, backend API, water meter bindings, and Cloud Firestore.

### 4. Approvals (`approvals`)
- Dedicated verification hub for Mobile Meter Reader submissions (`Pending` queue grouped by Field Officer + `Approval History` sub-tab).
- View photographic meter dial proof and GPS coordinates.
- Inline-edit/correct misread cubic meter values before approving, reject invalid submissions with notes, approve individual readings, or **Batch Approve** all readings submitted by a field officer.

### 5. Bills (`bills`)
- Master billing ledger of all verified Statements of Account (SOA).
- Displays previous/present readings, $\text{m}^3$ usage, Residential/Commercial stepped tiers, 2% Franchise Tax, arrears, and 10% post-due-date surcharge.
- Printable official TWD Billing Notice modal and audited bill cancellation workflow.

### 6. Process Payment (`payments`)
- Walk-in Cashier Counter for Over-the-Counter (`Cash`) collections.
- Supports **Full** or **Partial** settlement (enforcing the **50% minimum partial payment rule** for delinquent/disconnection accounts).
- Supports **Auto FIFO Allocation** (oldest unpaid bills settled first) and **Manual Per-Bill Allocation** (custom split across selected bills), generating a printable Official Receipt (`OR`).

### 7. Meter Readings (`readings`)
- Complete historical log of consumer distribution meter readings across all routes.
- Filter by `verified`, `pending`, or `flagged_abnormal` ($\ge 50\text{ m}^3$ high-consumption anomaly), inspect dial photos and GPS tags, and export to CSV. *(Strictly field distribution meter readings—no manual intake meter module.)*

### 8. Water Meters (`meters`)
- Physical water meter hardware inventory (`MT-...` serials, brand, size, installation date, status: `active`, `damaged`, `maintenance`, `unassigned`, and linked consumer Account Number).

### 9. Meter Readers (`readers`)
- **Field Officers (`officers`) Sub-Tab**: Live roster synced with Mobile App registrations, employee IDs, assigned route badges, credential visibility toggle, `Active`/`Inactive` status switch, profile editor, and **Permanent Termination** (blacklists officer across Mobile API & Web).
- **Route Assignments (`routes`) Sub-Tab**: Assigns field officers to Barangay reading routes and monitors route completion status.

### 10. Staff (`staff`)
- **Staff Directory (`users`) Sub-Tab**: Manages administrative and cashier accounts, departments, and roles.
- **Tariff Rate Manager (`tariff`) Sub-Tab**: Dynamic water pricing console under PD 198 / LWUA guidelines:
  - Explicitly separates **Residential** (regular community water use, single/individual account person) vs. **Commercial** (private commercial accounts with the highest water consumption rates).
  - Supports updating **Residential Only**, **Commercial Only**, or **Both Classifications**, percentage/flat rate simulation, Franchise Tax & Late Penalty configuration, optional recalculation of existing unpaid bills, targeted consumer notifications, and automatic public advisory posting.

### 11. Barangays (`barangays`)
- Manages Tagoloan's 9 official municipal Barangays (`Poblacion`, `Natumolan`, `Baluarte`, `Sta. Ana`, `Sta. Cruz`, `Mohon`, `Gracia`, `Casinglot`, `Sugbongcogon`), reading schedules, supervisors, active meter counts, and interactive per-barangay consumer drill-downs.

### 12. Announcements & Customer Service (`announcements`)
- **Public Bulletin (`bulletin`) Sub-Tab**: Publish, edit, and delete public water advisories (`info`, `warning`, `urgent`, `maintenance`, `tariff`).
- **Customer Service Desk (`customer_service`) Sub-Tab**: Manage consumer leak, low-pressure, meter, and billing tickets (`TWD-CR-*`), assign maintenance teams, post live replies, and update ticket statuses.

### 13. Profile (`profile`)
- Official Tagoloan Water District institutional profile and Administrator account/password security settings.

---

## 3. Consumer Portal (All 6 Sidebar Modules)

> **Pending Issuance Gate**: Newly registered consumers whose IDs have not yet been issued by Admin see a dedicated *"Account Verification & Meter Issuance in Progress"* status view while retaining access to **Notifications** and **My Profile**. As soon as Admin issues their Account #, Meter #, and RFID Tag, all 6 modules unlock live without requiring re-login.

1. **Dashboard (`dashboard`)**: Active balance, latest cubic meter consumption, `DynamicDueAlert`, `OverdueBillBanner` (for 3-month disconnection warning), active Residential/Commercial tariff schedule viewer, and district bulletins.
2. **My Bills (`bills`)**: Filterable bill ledger (`all`, `unpaid`, `paid`, `partial`), printable official Statement of Account, digital Official Receipt viewer, interactive live WebSocket payment, and **Upload Official Cashier Receipt** powered by Gemini Vision OCR.
3. **My Usage (`usage`)**: Historical monthly $\text{m}^3$ bar/line analytics and printable **Monthly Usage & Household Benchmark Report**.
4. **Reports & Inquiries (`reports`)**: Submit categorized service concerns (`leak`, `low_pressure`, `no_water`, `meter_issue`, `billing`, `water_quality`, `other`) with urgency level and photo attachment, plus live two-way reply thread with TWD Admin.
5. **Notifications (`notifications`)**: Real-time alert center filtered by `billing`, `payment`, `account_issue`, and `announcement`, with one-click bill spotlighting.
6. **My Profile (`profile`)**: Displays official Account Number, Meter Serial Number, Smart RFID Tag, Classification, and Barangay/Zone; allows updating contact phone (with 11-digit uniqueness check), household/business details, and password.

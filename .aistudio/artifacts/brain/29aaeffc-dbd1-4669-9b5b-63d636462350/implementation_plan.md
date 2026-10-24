# Consumer Route Sync & Admin ID Issuance Validation

Implementation blueprint detailing how consumers are validated after Administrator ID issuance and synchronized strictly to assigned meter reader routes and locations.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Architectural Rules**:
> - **ID Issuance Gate**: Consumers are **strictly withheld from mobile sync** until an Administrator has officially approved the account and issued both an **Account Number** (e.g. `011-102-056`) and a **Meter Serial Number** (e.g. `150307143`). Pending applicants without issued IDs are hidden from mobile meter reader route lists.
> - **Location & Route Strictness**: Mobile readers receive **only** validated consumers whose Barangay and Sitio/Zone match the reader's explicitly assigned coverage routes (e.g., Reader assigned to "Poblacion" only receives Poblacion consumers).
> - **Administrative Exemption**: The central Admin Portal retains full visibility of pending applicants with one-click ID issuance controls. Once the Admin clicks "Issue Account Number & Meter ID", the consumer instantly becomes active and syncs to the assigned reader.

---

## 1. Overview & Core Concept

- **What It Does**: Enforces a strict validation gate between consumer enrollment and field reading operations. When consumers apply, they exist only in the central registry as unassigned/pending. Once the Administrator issues their official Account Number and Meter Serial ID, the system validates the record and routes it into the specific mobile reader terminal assigned to that geographic zone.
- **Target Audience**: Admin Billing Supervisors (issuing credentials and assignments) and Field Meter Readers (receiving clean, validated route rosters without unmetered applicant clutter).
- **Key Value**: Prevents field readers from wasting time attempting to read unmetered or unissued accounts, eliminates reading errors on uninstalled tags, and ensures each reader's route list contains only actionable, metered households.

---

## 2. User Experience & Visual Design

### Key User Flows

```
┌────────────────────────┐      ┌─────────────────────────┐      ┌──────────────────────────┐
│  Consumer Registration │ ───> │  Admin ID Issuance Hub  │ ───> │ Mobile Reader Route Sync │
│ (Pending Admin Review) │      │ (Issue Acct # & Meter #)│      │  (Validated & Filtered)  │
└────────────────────────┘      └─────────────────────────┘      └──────────────────────────┘
```

1. **Step 1: Intake & Quarantine**:
   - A new consumer registers online or at the municipal office.
   - The record is flagged with `status: "pending_approval"`, empty `accountNumber`, and empty `meterNumber`.
   - **Mobile Verification**: The mobile reader route sync (`GET /api/consumers`) completely ignores this record. It is neither listed nor searchable on field devices.

2. **Step 2: Admin Issuance & Activation**:
   - In the Admin Portal's **Consumer Management** module, the supervisor reviews the application and clicks **"Issue Account Number & Meter Tag"**.
   - Admin assigns:
     - Account Number: `011-204-088`
     - Meter Serial Number: `MTR-99412`
     - Barangay & Zone: `Poblacion - Zone 2`
   - The system sets status to `active` and fires a real-time `CONSUMER_ACTIVATED_FOR_READER` WebSocket broadcast.

3. **Step 3: Route-Specific Mobile Sync**:
   - The meter reader assigned to `Poblacion` pulls their route list (`GET /api/consumers?readerId=RDR-001` or with `Authorization: Bearer <token>`).
   - The newly issued consumer now appears automatically in their route list, complete with meter serial tag, last reading date, and GPS coordinates.
   - Readers assigned to other barangays (e.g. `Natumolan`, `Baluarte`) do not receive this consumer.

---

## 3. Key Product Decisions & Trade-Offs

| Decision | Chosen Approach | Rationale & Trade-Off |
| :--- | :--- | :--- |
| **Mobile Sync Gate** | Filter out records where `!accountNumber`, `accountNumber.startsWith("PENDING")`, `!meterNumber`, or `status === "pending_approval"`. | Guarantees that mobile readers only ever encounter physical meters that have been officially installed, tagged, and registered. |
| **Geographic Partitioning** | Multi-tier area matching (`assignedRoutes` -> `barangay` -> `sitioZone`). | Prevents route collisions. Readers only download records for their designated sector, reducing mobile memory footprint and sync bandwidth. |
| **Admin Portal Visibility** | Dedicated `includePending=true` parameter for Administrative views. | Ensures administrators can see and manage pending applicants while protecting field readers from incomplete data. |

---

## 4. Technical Architecture & Data Strategy

### System Sync Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Admin Portal Console                 │
│      • Reviews Pending Applicants                      │
│      • Issues Account # and Meter Serial ID            │
│      • Sets Route / Barangay Assignment                │
└───────────────────────────┬────────────────────────────┘
                            │ POST /api/consumers/issue-id
                            ▼
┌────────────────────────────────────────────────────────┐
│       Tagoloan Water District Express Service          │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │             Validation & Gatekeeper              │  │
│  │   • Has Valid Account #?    (Yes -> Proceed)     │  │
│  │   • Has Valid Meter Serial? (Yes -> Proceed)     │  │
│  │   • Status Active?          (Yes -> Proceed)     │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           │                            │
│  ┌────────────────────────┴─────────────────────────┐  │
│  │             Route Area Matcher                   │  │
│  │   • Reader Assigned Areas: ["Poblacion", "Zone 1"]│  │
│  │   • Match Consumer Barangay & Sitio/Zone         │  │
│  └────────────────────────┬─────────────────────────┘  │
└───────────────────────────┼────────────────────────────┘
                            │ HTTPS Sync (Bearer Token)
                            ▼
┌────────────────────────────────────────────────────────┐
│              Mobile Meter Reader Terminal              │
│       • Strictly Validated Route Catalog               │
│       • Scannable Barcode / NFC Meter Serial           │
│       • No Pending / Unmetered Clutter                 │
└────────────────────────────────────────────────────────┘
```

### Proposed Endpoint Validation Logic (`server.ts`)

```typescript
// Filter condition for mobile reader consumer sync:
const isValidatedForFieldReading = (c: MobileConsumerSync): boolean => {
  const hasValidAccount = Boolean(
    c.accountNumber && 
    c.accountNumber.trim() !== "" && 
    !c.accountNumber.toUpperCase().startsWith("PENDING")
  );
  const hasValidMeter = Boolean(
    c.meterNumber && 
    c.meterNumber.trim() !== "" && 
    !c.meterNumber.toUpperCase().startsWith("PENDING")
  );
  const isActionableStatus = c.status !== "pending_approval" && c.status !== "pending";
  return hasValidAccount && hasValidMeter && isActionableStatus;
};
```

---

## 5. Execution Steps
1. **Refine `server.ts` Sync Endpoints**:
   - Update `GET /api/consumers`, `GET /api/sync/pull`, and `GET /api/readers/:id/consumers` to enforce `isValidatedForFieldReading` for all reader requests.
   - Ensure `includePending=true` or Admin requests preserve access to unissued records.
2. **Strict Route Zone Filter**:
   - Enforce reader assignment matching against `c.barangay` and `c.sitioZone`.
3. **Verify Build & Compilation**:
   - Run `compile_applet` and verify with sample reader API requests.

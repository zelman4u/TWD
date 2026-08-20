import express from "express";

const app = express();

// Express JSON and URL-encoded body parsing with high limit
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Enable CORS for Mobile App and External API clients
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

interface MobileReader {
  id: string;
  username: string;
  name: string;
  pin?: string;
  role: string;
  zone: string;
  contactNumber: string;
  employmentStatus: "active" | "pending" | "inactive";
  registeredAt: string;
  approvedAt?: string;
  assignedRoutes: string[];
}

let registeredStaff: MobileReader[] = [
  {
    id: "MR-101",
    username: "reader.poblacion@tagoloanwater.gov.ph",
    name: "Ramon Valderrama",
    pin: "1234",
    role: "Senior Meter Officer",
    zone: "Poblacion",
    contactNumber: "0917-555-0191",
    employmentStatus: "active",
    registeredAt: "2026-08-01T08:00:00.000Z",
    assignedRoutes: ["Poblacion", "Natumolan"]
  }
];

export interface MobileConsumerRecord {
  id?: string;
  accountNumber: string;
  name: string;
  address: string;
  barangay: string;
  barangayId?: string;
  sitioZone: string;
  meterNumber: string;
  previousReading: number;
  lastReadingDate: string;
  meterSize: string;
  consumerType: "Residential" | "Commercial";
  status: "active" | "inactive" | "maintenance" | "disconnected" | "pending_approval" | "pending";
  contactNumber?: string;
  email?: string;
  rfidTag?: string;
  registrationDate?: string;
  linkedUserId?: string;
  householdInfo?: string;
  businessName?: string;
  businessType?: string;
  isRegistered?: boolean;
}

// Initial Tagoloan Water District Municipal Consumer Registry
let syncedConsumers: MobileConsumerRecord[] = [];

interface MobileReadingSubmission {
  id: string;
  accountNumber: string;
  consumerName: string;
  meterNumber: string;
  billingPeriod: string;
  readingDate: string;
  previousReading: number;
  currentReading: number;
  consumption: number;
  readerId: string;
  readerName: string;
  route: string;
  status: "pending_approval" | "approved" | "rejected";
  photoUrl?: string;
  coordinates?: { latitude: number; longitude: number };
  notes?: string;
  submittedAt: string;
}

let pendingMobileReadings: MobileReadingSubmission[] = [];

// ==========================================
// 1. PRIMARY CONSUMER ENDPOINTS (MOBILE SYNC)
// ==========================================

// GET /api/consumers - Supports query filters & returns clean JSON
app.get("/api/consumers", (req, res) => {
  try {
    const { zone, barangay, search, status } = req.query;
    let list = [...syncedConsumers];

    if (barangay && typeof barangay === "string" && barangay.trim() !== "" && barangay !== "All") {
      const bFilter = barangay.trim().toLowerCase();
      list = list.filter(c => c.barangay.toLowerCase() === bFilter);
    } else if (zone && typeof zone === "string" && zone.trim() !== "" && zone !== "All") {
      const zFilter = zone.replace(/^Zone\s*\d+\s*-\s*/i, "").trim().toLowerCase();
      list = list.filter(c => c.barangay.toLowerCase().includes(zFilter) || c.address.toLowerCase().includes(zFilter));
    }

    if (search && typeof search === "string" && search.trim() !== "") {
      const q = search.trim().toLowerCase();
      list = list.filter(c => 
        c.name.toLowerCase().includes(q) || 
        c.accountNumber.toLowerCase().includes(q) || 
        c.meterNumber.toLowerCase().includes(q)
      );
    }

    if (status && typeof status === "string" && status.trim() !== "") {
      list = list.filter(c => c.status === status);
    }

    // Return format compatible with both direct arrays and wrapped payload models
    res.json({
      success: true,
      count: list.length,
      consumers: list,
      data: list
    });
  } catch (err: unknown) {
    console.error("[API Error] /api/consumers:", err);
    res.status(200).json({
      success: true,
      count: syncedConsumers.length,
      consumers: syncedConsumers,
      data: syncedConsumers
    });
  }
});

// GET /api/consumers/:accountNumber
app.get("/api/consumers/:accountNumber", (req, res) => {
  try {
    const { accountNumber } = req.params;
    const consumer = syncedConsumers.find(
      c => c.accountNumber === accountNumber || c.meterNumber === accountNumber
    );

    if (!consumer) {
      return res.status(404).json({
        success: false,
        message: `Consumer account ${accountNumber} not found.`
      });
    }

    res.json({
      success: true,
      consumer,
      data: consumer
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to retrieve consumer record." });
  }
});

// POST /api/consumers/register - Self-Registration endpoint for Consumers from any device
app.post("/api/consumers/register", (req, res) => {
  try {
    const {
      name,
      fullName,
      email,
      contactNumber,
      address,
      barangay,
      barangayId,
      sitioZone,
      consumerType,
      meterSize,
      householdInfo,
      businessName,
      businessType,
      linkedUserId
    } = req.body;

    const consumerName = (name || fullName || "").trim();
    if (!consumerName) {
      return res.status(400).json({
        success: false,
        message: "Consumer full name is required for registration."
      });
    }

    const cleanEmail = (email || "").trim().toLowerCase();
    const userId = linkedUserId || `user-${Date.now()}`;

    // Check if consumer already registered by email
    const existingIdx = syncedConsumers.findIndex(
      c => (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) ||
           (c.linkedUserId && c.linkedUserId === userId)
    );

    const record: MobileConsumerRecord = {
      accountNumber: "", // Empty until issued by Administrator
      name: consumerName,
      address: address || `${sitioZone || "Zone 1"}, ${barangay || "Poblacion"}, Tagoloan, Misamis Oriental`,
      barangay: barangay || "Poblacion",
      barangayId: barangayId || "BRG-01",
      sitioZone: sitioZone || "Zone 1",
      meterNumber: "", // Empty until issued by Administrator
      previousReading: 0,
      lastReadingDate: new Date().toISOString().split("T")[0],
      meterSize: meterSize || "1/2 inch",
      consumerType: consumerType === "Commercial" ? "Commercial" : "Residential",
      status: "pending_approval",
      contactNumber: contactNumber || "",
      email: cleanEmail,
      rfidTag: "",
      registrationDate: new Date().toISOString().split("T")[0],
      linkedUserId: userId,
      householdInfo: householdInfo || undefined,
      businessName: businessName || undefined,
      businessType: businessType || undefined,
      isRegistered: true
    };

    if (existingIdx >= 0) {
      syncedConsumers[existingIdx] = { ...syncedConsumers[existingIdx], ...record };
    } else {
      syncedConsumers.unshift(record); // Add to beginning so Admin sees it immediately
    }

    res.status(201).json({
      success: true,
      message: "Registration application received. Waiting for admin approval.",
      consumer: record
    });
  } catch (err) {
    console.error("[API Error] POST /api/consumers/register:", err);
    res.status(500).json({ success: false, message: "Failed to submit registration application." });
  }
});

// POST /api/consumers - Add or Sync Consumer Record
app.post("/api/consumers", (req, res) => {
  try {
    const {
      accountNumber,
      name,
      address,
      barangay,
      barangayId,
      sitioZone,
      meterNumber,
      previousReading,
      lastReadingDate,
      meterSize,
      consumerType,
      status,
      contactNumber,
      email,
      rfidTag,
      registrationDate,
      linkedUserId,
      householdInfo,
      businessName,
      businessType,
      isRegistered
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required."
      });
    }

    const cleanAcc = (accountNumber || "").trim();
    const cleanEmail = (email || "").trim().toLowerCase();

    const record: MobileConsumerRecord = {
      accountNumber: cleanAcc,
      name: String(name).trim(),
      address: address || "Tagoloan, Misamis Oriental",
      barangay: barangay || "Poblacion",
      barangayId: barangayId,
      sitioZone: sitioZone || "Zone 1",
      meterNumber: meterNumber || (cleanAcc ? `MT-${cleanAcc}` : ""),
      previousReading: Number(previousReading) || 0,
      lastReadingDate: lastReadingDate || new Date().toISOString().split("T")[0],
      meterSize: meterSize || "1/2 inch",
      consumerType: consumerType === "Commercial" ? "Commercial" : "Residential",
      status: status || (cleanAcc ? "active" : "pending_approval"),
      contactNumber: contactNumber || "",
      email: cleanEmail,
      rfidTag: rfidTag || "",
      registrationDate: registrationDate || new Date().toISOString().split("T")[0],
      linkedUserId: linkedUserId,
      householdInfo: householdInfo,
      businessName: businessName,
      businessType: businessType,
      isRegistered: isRegistered !== undefined ? isRegistered : true
    };

    // Find existing by AccountNumber OR Email OR linkedUserId
    const idx = syncedConsumers.findIndex(c => 
      (cleanAcc && c.accountNumber === cleanAcc) ||
      (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) ||
      (linkedUserId && c.linkedUserId === linkedUserId)
    );

    if (idx >= 0) {
      syncedConsumers[idx] = { ...syncedConsumers[idx], ...record };
    } else {
      syncedConsumers.unshift(record);
    }

    res.status(201).json({
      success: true,
      message: "Consumer saved successfully.",
      consumer: record
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to save consumer." });
  }
});

// PATCH /api/consumers/:identifier - Update / Issue IDs for Consumer
app.patch("/api/consumers/:identifier", (req, res) => {
  try {
    const { identifier } = req.params;
    const updates = req.body;

    const idx = syncedConsumers.findIndex(c => 
      c.accountNumber === identifier || 
      (c.email && c.email.toLowerCase() === identifier.toLowerCase()) ||
      c.linkedUserId === identifier
    );

    if (idx < 0) {
      return res.status(404).json({
        success: false,
        message: `Consumer ${identifier} not found in registry.`
      });
    }

    syncedConsumers[idx] = {
      ...syncedConsumers[idx],
      ...updates
    };

    res.json({
      success: true,
      message: `Consumer ${identifier} updated successfully.`,
      consumer: syncedConsumers[idx]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update consumer." });
  }
});

// DELETE /api/consumers/:identifier
app.delete("/api/consumers/:identifier", (req, res) => {
  try {
    const { identifier } = req.params;
    const initialLen = syncedConsumers.length;
    syncedConsumers = syncedConsumers.filter(c => 
      c.accountNumber !== identifier && 
      (!c.email || c.email.toLowerCase() !== identifier.toLowerCase()) &&
      c.linkedUserId !== identifier
    );

    res.json({
      success: true,
      message: `Consumer ${identifier} removed.`,
      removed: syncedConsumers.length < initialLen
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete consumer." });
  }
});

// ==========================================
// 2. METER READER AUTH & REGISTRATION
// ==========================================

// POST /api/readers/register or /api/auth/register
app.post(["/api/auth/register", "/api/readers/register"], (req, res) => {
  try {
    const { id, username, name, pin, role, zone, contactNumber, registeredAt } = req.body;

    if (!name || !username) {
      return res.status(400).json({
        success: false,
        message: "Reader name and username are required for registration."
      });
    }

    const readerId = id || `WDT-MR${Math.floor(10 + Math.random() * 90)}`;
    const cleanZone = zone ? zone.replace(/^Zone\s*\d+\s*-\s*/i, "").trim() : "Poblacion";

    const newReader: MobileReader = {
      id: readerId,
      username: username.trim(),
      name: name.trim(),
      pin: pin || "1234",
      role: role || "Meter Reader I",
      zone: cleanZone,
      contactNumber: contactNumber || "",
      employmentStatus: "pending",
      registeredAt: registeredAt || new Date().toISOString(),
      assignedRoutes: [cleanZone]
    };

    const existingIdx = registeredStaff.findIndex(s => s.username === newReader.username || s.id === newReader.id);
    if (existingIdx >= 0) {
      registeredStaff[existingIdx] = { ...registeredStaff[existingIdx], ...newReader };
    } else {
      registeredStaff.push(newReader);
    }

    res.status(201).json({
      success: true,
      message: "Registration received successfully. Account is pending Admin approval.",
      reader: {
        id: newReader.id,
        username: newReader.username,
        name: newReader.name,
        role: newReader.role,
        zone: newReader.zone,
        employmentStatus: newReader.employmentStatus,
        assignedRoutes: newReader.assignedRoutes
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Registration error." });
  }
});

// GET /api/staff or /api/readers
app.get(["/api/staff", "/api/readers"], (req, res) => {
  res.json({
    success: true,
    count: registeredStaff.length,
    staff: registeredStaff,
    readers: registeredStaff
  });
});

// GET /api/readers/check-status/:id
app.get("/api/readers/check-status/:id", (req, res) => {
  const { id } = req.params;
  const reader = registeredStaff.find(s => s.id === id || s.username?.toLowerCase() === id?.toLowerCase());
  if (!reader) {
    return res.status(404).json({ success: false, message: "Meter reader not found." });
  }

  res.json({
    success: true,
    readerId: reader.id,
    username: reader.username,
    name: reader.name,
    status: reader.employmentStatus,
    employmentStatus: reader.employmentStatus,
    assignedRoutes: reader.assignedRoutes,
    approvedAt: reader.approvedAt
  });
});

// PATCH/POST /api/staff/:id/status or /api/readers/:id/approve
app.all(["/api/staff/:id/status", "/api/staff/:id", "/api/readers/:id/approve"], (req, res) => {
  if (req.method !== "PATCH" && req.method !== "POST" && req.method !== "PUT") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const { id } = req.params;
  const { status, assignedRoutes } = req.body;

  const reader = registeredStaff.find(s => s.id === id || s.username === id);
  if (!reader) {
    return res.status(404).json({ success: false, message: "Meter reader not found." });
  }

  const targetStatus = status || "active";
  reader.employmentStatus = targetStatus;
  if (targetStatus === "active") {
    reader.approvedAt = new Date().toISOString();
  }

  if (assignedRoutes && Array.isArray(assignedRoutes)) {
    reader.assignedRoutes = assignedRoutes;
  }

  res.json({
    success: true,
    message: `Meter reader ${reader.name} status updated to ${reader.employmentStatus}.`,
    reader
  });
});

// ==========================================
// 3. ROUTE & SYNC DATA PULL
// ==========================================

// GET /api/sync/pull
app.get("/api/sync/pull", (req, res) => {
  try {
    const { zone } = req.query;
    let consumers = [...syncedConsumers];

    if (zone && typeof zone === "string" && zone.trim() !== "" && zone !== "All") {
      const cleanZone = zone.replace(/^Zone\s*\d+\s*-\s*/i, "").trim().toLowerCase();
      consumers = consumers.filter(c => c.barangay.toLowerCase().includes(cleanZone) || c.address.toLowerCase().includes(cleanZone));
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      zone: zone || "all",
      count: consumers.length,
      consumers
    });
  } catch (err) {
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      zone: "all",
      count: syncedConsumers.length,
      consumers: syncedConsumers
    });
  }
});

// ==========================================
// 4. FIELD READING SUBMISSION & BATCH SYNC
// ==========================================

// POST /api/readings/submit or /api/sync/push
app.post(["/api/sync/push", "/api/readings/submit"], (req, res) => {
  try {
    const {
      accountNumber,
      meterNumber,
      currentReading,
      previousReading,
      readerId,
      readerName,
      route,
      billingPeriod,
      photoUrl,
      coordinates,
      notes
    } = req.body;

    if (!accountNumber || currentReading === undefined) {
      return res.status(400).json({
        success: false,
        message: "Account number and current reading are mandatory."
      });
    }

    const matchedConsumer = syncedConsumers.find(
      c => c.accountNumber === accountNumber || c.meterNumber === meterNumber
    );

    const prev = previousReading !== undefined ? Number(previousReading) : (matchedConsumer ? matchedConsumer.previousReading : 0);
    const curr = Number(currentReading);
    const consumption = Math.max(0, curr - prev);

    const submission: MobileReadingSubmission = {
      id: `READ-${Math.floor(10000 + Math.random() * 90000)}`,
      accountNumber: matchedConsumer ? matchedConsumer.accountNumber : accountNumber,
      consumerName: matchedConsumer ? matchedConsumer.name : (req.body.consumerName || "Consumer Account"),
      meterNumber: meterNumber || (matchedConsumer ? matchedConsumer.meterNumber : "MT-TAG"),
      billingPeriod: billingPeriod || "August 2026",
      readingDate: new Date().toISOString().split("T")[0],
      previousReading: prev,
      currentReading: curr,
      consumption,
      readerId: readerId || "WDT-FIELD",
      readerName: readerName || "Field Meter Officer",
      route: route || (matchedConsumer ? matchedConsumer.barangay : "Poblacion"),
      status: "pending_approval",
      photoUrl: photoUrl || "",
      coordinates: coordinates || { latitude: 8.5372, longitude: 124.7523 },
      notes: notes || "Scanned and submitted via Tagoloan Mobile Field App",
      submittedAt: new Date().toISOString()
    };

    pendingMobileReadings.unshift(submission);

    res.status(201).json({
      success: true,
      message: "Reading submitted successfully and routed to Admin Verification Queue.",
      submissionId: submission.id,
      consumption: submission.consumption,
      status: "pending_approval"
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to submit reading." });
  }
});

// POST /api/readings/batch
app.post("/api/readings/batch", (req, res) => {
  try {
    const readingsList = Array.isArray(req.body) ? req.body : (req.body.readings || []);

    if (!readingsList || readingsList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No readings payload provided in batch upload."
      });
    }

    const processed: MobileReadingSubmission[] = [];

    for (const item of readingsList) {
      const prev = item.previousReading !== undefined ? Number(item.previousReading) : 0;
      const curr = Number(item.currentReading || 0);
      const consumption = Math.max(0, curr - prev);

      const submission: MobileReadingSubmission = {
        id: item.id || `READ-${Math.floor(10000 + Math.random() * 90000)}`,
        accountNumber: item.accountNumber || "UNKNOWN",
        consumerName: item.consumerName || "Consumer",
        meterNumber: item.meterNumber || "MT-TAG",
        billingPeriod: item.billingPeriod || "August 2026",
        readingDate: item.readingDate || new Date().toISOString().split("T")[0],
        previousReading: prev,
        currentReading: curr,
        consumption,
        readerId: item.readerId || "WDT-FIELD",
        readerName: item.readerName || "Field Meter Officer",
        route: item.route || item.barangay || "Poblacion",
        status: "pending_approval",
        photoUrl: item.photoUrl || item.dialPhotoUrl || "",
        coordinates: item.coordinates || { latitude: 8.5372, longitude: 124.7523 },
        notes: item.notes || "Batch synced from Mobile Offline Queue",
        submittedAt: new Date().toISOString()
      };

      pendingMobileReadings.unshift(submission);
      processed.push(submission);
    }

    res.status(201).json({
      success: true,
      message: `Successfully processed and synced ${processed.length} field readings.`,
      count: processed.length,
      syncedIds: processed.map(p => p.id)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Batch sync error." });
  }
});

// GET /api/readings/pending
app.get("/api/readings/pending", (req, res) => {
  res.json({
    success: true,
    count: pendingMobileReadings.length,
    readings: pendingMobileReadings
  });
});

// GET /api/barangays
app.get("/api/barangays", (req, res) => {
  const barangays = [
    { id: "BRG-01", name: "Poblacion", code: "PB-01", ratePerM3: 24.50 },
    { id: "BRG-02", name: "Natumolan", code: "NT-02", ratePerM3: 24.50 },
    { id: "BRG-03", name: "Baluarte", code: "BL-03", ratePerM3: 24.50 },
    { id: "BRG-04", name: "Sta. Ana", code: "SA-04", ratePerM3: 24.50 },
    { id: "BRG-05", name: "Sta. Cruz", code: "SC-05", ratePerM3: 24.50 },
    { id: "BRG-06", name: "Mohon", code: "MH-06", ratePerM3: 24.50 },
    { id: "BRG-07", name: "Gracia", code: "GR-07", ratePerM3: 24.50 },
    { id: "BRG-08", name: "Casinglot", code: "CS-08", ratePerM3: 24.50 },
    { id: "BRG-09", name: "Sugbongcogon", code: "SG-09", ratePerM3: 24.50 }
  ];
  res.json({ success: true, count: barangays.length, barangays, data: barangays });
});

// Health check
app.get(["/api/health", "/api/status"], (req, res) => {
  res.json({
    status: "ok",
    connected: true,
    service: "Tagoloan Water District Live Gateway",
    timestamp: new Date().toISOString(),
    consumersCount: syncedConsumers.length,
    staffCount: registeredStaff.length
  });
});

export default app;

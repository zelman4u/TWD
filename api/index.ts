import express from "express";

const app = express();

// Express JSON and URL-encoded body parsing
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

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

let registeredStaff: MobileReader[] = [];

interface MobileConsumerSync {
  accountNumber: string;
  name: string;
  address: string;
  barangay: string;
  sitioZone: string;
  meterNumber: string;
  previousReading: number;
  lastReadingDate: string;
  meterSize: string;
  consumerType: string;
  status: "active" | "disconnected" | "maintenance";
}

let syncedConsumers: MobileConsumerSync[] = [];

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

// 1. Mobile Meter Reader Registration
app.post(["/api/auth/register", "/api/readers/register"], (req, res) => {
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
});

// 2. Fetch All Staff / Meter Readers
app.get(["/api/staff", "/api/readers"], (req, res) => {
  res.json({
    success: true,
    count: registeredStaff.length,
    staff: registeredStaff,
    readers: registeredStaff
  });
});

// 2.1 Check Single Reader Status
app.get("/api/readers/check-status/:id", (req, res) => {
  const { id } = req.params;
  const reader = registeredStaff.find(s => s.id === id || s.username === id);
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

// 3. Admin Approves / Activates Meter Reader
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

// 4. Mobile Sync Pull
app.get("/api/sync/pull", (req, res) => {
  const { zone } = req.query;
  let consumers = [...syncedConsumers];

  if (zone && typeof zone === "string" && zone.trim() !== "") {
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
});

// 5. Mobile Reading Push
app.post(["/api/sync/push", "/api/readings/submit"], (req, res) => {
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
});

// 5.1 Batch Sync Readings
app.post("/api/readings/batch", (req, res) => {
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
});

// 6. Admin Approval Queue Listing
app.get("/api/readings/pending", (req, res) => {
  res.json({
    success: true,
    count: pendingMobileReadings.length,
    readings: pendingMobileReadings
  });
});

// 7. Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;

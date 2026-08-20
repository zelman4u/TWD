/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createHttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";

const app = express();
const httpServer = createHttpServer(app);
const PORT = 3000;

// Set up WebSocket server
const wss = new WebSocketServer({ server: httpServer });

// Express JSON and URL-encoded body parsing for Mobile App API
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

// In-Memory Mobile Staff & Sync Store
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

// Consumers registry for mobile offline/online tag auto-matching
interface MobileConsumerSync {
  accountNumber: string;
  name: string;
  address: string;
  barangay: string;
  barangayId?: string;
  sitioZone: string;
  meterNumber: string; // The Tag Number scanned by the mobile camera / NFC
  previousReading: number;
  lastReadingDate: string;
  meterSize: string;
  consumerType: string;
  status: "active" | "disconnected" | "maintenance" | "pending_approval" | "pending" | "inactive";
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

let syncedConsumers: MobileConsumerSync[] = [
  {
    accountNumber: "1001-A",
    name: "Juan Dela Cruz",
    address: "Zone 2, Riverside Drive, Poblacion",
    barangay: "Poblacion",
    sitioZone: "Zone 2",
    meterNumber: "MT-1001-TAG",
    previousReading: 142.5,
    lastReadingDate: "2026-07-28",
    meterSize: "1/2 inch",
    consumerType: "Residential",
    status: "active",
    contactNumber: "0917-123-4567",
    email: "juan.delacruz@gmail.com",
    rfidTag: "RFID-1001"
  },
  {
    accountNumber: "1002-B",
    name: "Maria Santos",
    address: "Zone 4, Market Road, Poblacion",
    barangay: "Poblacion",
    sitioZone: "Zone 4",
    meterNumber: "MT-1002-TAG",
    previousReading: 218.0,
    lastReadingDate: "2026-07-29",
    meterSize: "1/2 inch",
    consumerType: "Residential",
    status: "active",
    contactNumber: "0920-987-6543",
    email: "maria.santos@yahoo.com",
    rfidTag: "RFID-1002"
  },
  {
    accountNumber: "1003-C",
    name: "Antonio Luna",
    address: "Purok 1, Highway, Natumolan",
    barangay: "Natumolan",
    sitioZone: "Purok 1",
    meterNumber: "MT-1003-TAG",
    previousReading: 305.2,
    lastReadingDate: "2026-07-30",
    meterSize: "3/4 inch",
    consumerType: "Commercial",
    status: "active",
    contactNumber: "0939-345-6789",
    email: "antonio.luna@bakery.ph",
    rfidTag: "RFID-1003"
  },
  {
    accountNumber: "1004-D",
    name: "Elena Rodriguez",
    address: "Zone 1, Coastal Road, Baluarte",
    barangay: "Baluarte",
    sitioZone: "Zone 1",
    meterNumber: "MT-1004-TAG",
    previousReading: 89.0,
    lastReadingDate: "2026-07-27",
    meterSize: "1/2 inch",
    consumerType: "Residential",
    status: "active",
    contactNumber: "0918-654-3210",
    email: "elena.rodriguez@gmail.com",
    rfidTag: "RFID-1004"
  },
  {
    accountNumber: "1005-E",
    name: "Ricardo Dalisay",
    address: "Purok 3, Agricultural Area, Sta. Ana",
    barangay: "Sta. Ana",
    sitioZone: "Purok 3",
    meterNumber: "MT-1005-TAG",
    previousReading: 412.8,
    lastReadingDate: "2026-07-31",
    meterSize: "1/2 inch",
    consumerType: "Residential",
    status: "active",
    contactNumber: "0945-789-0123",
    email: "ricardo.dalisay@gmail.com",
    rfidTag: "RFID-1005"
  },
  {
    accountNumber: "1006-F",
    name: "Tagoloan Commercial Plaza",
    address: "National Highway Corner, Sta. Cruz",
    barangay: "Sta. Cruz",
    sitioZone: "Zone 1",
    meterNumber: "MT-1006-TAG",
    previousReading: 1250.0,
    lastReadingDate: "2026-07-31",
    meterSize: "2 inch",
    consumerType: "Commercial",
    status: "active",
    contactNumber: "088-567-8901",
    email: "admin@tagoloanplaza.com",
    rfidTag: "RFID-1006"
  }
];

// In-Memory Pending Meter Reading Submissions from Mobile
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

// Keep pool of connected sockets
const clients = new Set<WebSocket>();

function broadcast(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ==========================================
// REST API ENDPOINTS FOR MOBILE APP & WEB
// ==========================================

// 1. Mobile Meter Reader Registration (POST /api/auth/register or /api/readers/register)
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
    employmentStatus: "pending", // Starts as pending until Admin approves
    registeredAt: registeredAt || new Date().toISOString(),
    assignedRoutes: [cleanZone]
  };

  // Check if reader already exists
  const existingIdx = registeredStaff.findIndex(s => s.username === newReader.username || s.id === newReader.id);
  if (existingIdx >= 0) {
    registeredStaff[existingIdx] = { ...registeredStaff[existingIdx], ...newReader };
  } else {
    registeredStaff.push(newReader);
  }

  // Broadcast new registration event to Admin Web Portal via WebSocket
  broadcast("READER_REGISTERED_PENDING", {
    reader: newReader,
    message: `New Meter Reader ${newReader.name} (${newReader.id}) registered from mobile terminal and is awaiting approval.`
  });
  broadcast("staff:registered", {
    reader: newReader,
    message: `New Meter Reader ${newReader.name} (${newReader.id}) registered from mobile app and is awaiting approval.`
  });

  console.log(`[Mobile API] Meter Reader Registered: ${newReader.name} (${newReader.id}) - Status: Pending Approval`);

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

// 2. Fetch All Staff / Meter Readers (GET /api/staff or /api/readers)
app.get(["/api/staff", "/api/readers"], (req, res) => {
  res.json({
    success: true,
    count: registeredStaff.length,
    staff: registeredStaff,
    readers: registeredStaff
  });
});

// 2.1 Check Single Reader Status (GET /api/readers/check-status/:id)
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

// 3. Admin Approves / Activates Meter Reader (PATCH /api/staff/:id, /api/staff/:id/status, or POST /api/readers/:id/approve)
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

  // Broadcast approval to mobile terminal via WebSocket
  broadcast("READER_APPROVED_ACTIVE", {
    readerId: reader.id,
    username: reader.username,
    status: reader.employmentStatus,
    assignedRoutes: reader.assignedRoutes,
    message: `Reader ${reader.name} has been approved and activated.`
  });
  broadcast("staff:status_updated", {
    readerId: reader.id,
    status: reader.employmentStatus,
    assignedRoutes: reader.assignedRoutes,
    message: `Reader ${reader.name} is now ${reader.employmentStatus.toUpperCase()}`
  });

  res.json({
    success: true,
    message: `Meter reader ${reader.name} status updated to ${reader.employmentStatus}.`,
    reader
  });
});

// 3.1 Consumer Registry Endpoint for Mobile App & Web (GET /api/consumers, POST /api/consumers)
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

    res.json({
      success: true,
      count: list.length,
      consumers: list,
      data: list
    });
  } catch (err) {
    console.error("[API Error] GET /api/consumers:", err);
    res.status(200).json({
      success: true,
      count: syncedConsumers.length,
      consumers: syncedConsumers,
      data: syncedConsumers
    });
  }
});

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

    const record: MobileConsumerSync = {
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
      syncedConsumers.unshift(record); // Add to top so Admin sees it immediately
    }

    // Broadcast live event to all connected Admin dashboards
    broadcast("CONSUMER_REGISTERED", {
      consumer: record,
      message: `New Consumer Registration: ${record.name} in Barangay ${record.barangay} is awaiting administrative review.`
    });
    broadcast("consumer:registered", {
      consumer: record,
      message: `New Consumer Registration: ${record.name} in Barangay ${record.barangay} is awaiting administrative review.`
    });

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

    const record: MobileConsumerSync = {
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

    // Broadcast update to Admin and Consumer dashboards
    broadcast("CONSUMER_UPDATED", {
      consumer: record,
      message: `Consumer record for ${record.name} (${record.accountNumber || 'Pending'}) updated.`
    });

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

    broadcast("CONSUMER_UPDATED", {
      consumer: syncedConsumers[idx],
      message: `Consumer ${identifier} details updated.`
    });

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

    broadcast("CONSUMER_DELETED", {
      identifier,
      message: `Consumer ${identifier} removed from registry.`
    });

    res.json({
      success: true,
      message: `Consumer ${identifier} removed.`,
      removed: syncedConsumers.length < initialLen
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete consumer." });
  }
});

// 4. Mobile Sync Pull: Download Consumers & Meter Tags for Offline Recognition (GET /api/sync/pull)
app.get("/api/sync/pull", (req, res) => {
  const { zone, readerId } = req.query;

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
    consumers: consumers.map(c => ({
      accountNumber: c.accountNumber,
      name: c.name,
      address: c.address,
      barangay: c.barangay,
      sitioZone: c.sitioZone,
      meterNumber: c.meterNumber, // Tag Number for scanning & auto-matching
      meterSerial: c.meterNumber,
      previousReading: c.previousReading,
      lastReadingDate: c.lastReadingDate,
      meterSize: c.meterSize,
      consumerType: c.consumerType,
      status: c.status
    }))
  });
});

// 5. Mobile Reading Push: Submit Scanned Meter Reading to Approval Queue (POST /api/sync/push or POST /api/readings/submit)
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

  // Find matching consumer
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

  // Broadcast new reading to Admin Approval Queue on Web via WebSocket
  broadcast("READING_SUBMITTED_FOR_APPROVAL", {
    reading: submission,
    message: `New reading submitted for Account #${submission.accountNumber} (${submission.consumption} m³). Awaiting supervisor review.`
  });
  broadcast("reading:submitted", {
    reading: submission,
    message: `New reading submitted for Account #${submission.accountNumber} (${submission.consumption} m³). Awaiting Admin verification.`
  });

  console.log(`[Mobile API] Reading Submitted for ${submission.accountNumber} - ${submission.consumption} m³ by ${submission.readerName}`);

  res.status(201).json({
    success: true,
    message: "Reading submitted successfully and routed to Admin Verification Queue.",
    submissionId: submission.id,
    consumption: submission.consumption,
    status: "pending_approval"
  });
});

// 5.1 Batch Sync Readings: Upload Queued Offline Readings (POST /api/readings/batch)
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

  // Broadcast batch submission event to Admin
  broadcast("READINGS_BATCH_SYNCED", {
    count: processed.length,
    message: `${processed.length} offline field readings batch synced by field staff.`
  });

  res.status(201).json({
    success: true,
    message: `Successfully processed and synced ${processed.length} field readings.`,
    count: processed.length,
    syncedIds: processed.map(p => p.id)
  });
});

// 6. Admin Approval Queue Listing (GET /api/readings/pending)
app.get("/api/readings/pending", (req, res) => {
  res.json({
    success: true,
    count: pendingMobileReadings.length,
    readings: pendingMobileReadings
  });
});

// 7. Admin Approves Reading -> Issues Bill to Consumer (POST /api/readings/:id/approve)
app.post("/api/readings/:id/approve", (req, res) => {
  const { id } = req.params;
  const item = pendingMobileReadings.find(r => r.id === id);

  if (!item) {
    return res.status(404).json({ success: false, message: "Reading submission not found." });
  }

  item.status = "approved";

  // Update consumer previous reading
  const targetConsumer = syncedConsumers.find(c => c.accountNumber === item.accountNumber);
  if (targetConsumer) {
    targetConsumer.previousReading = item.currentReading;
    targetConsumer.lastReadingDate = item.readingDate;
  }

  // Broadcast bill issuance to Consumer Portal
  broadcast("READING_APPROVED_BILL_ISSUED", {
    accountNumber: item.accountNumber,
    billingPeriod: item.billingPeriod,
    consumption: item.consumption,
    message: `Official bill for ${item.billingPeriod} has been approved and published to Consumer Portal.`
  });
  broadcast("bill:issued", {
    accountNumber: item.accountNumber,
    billingPeriod: item.billingPeriod,
    consumption: item.consumption,
    message: `Official bill for ${item.billingPeriod} has been approved and published to Consumer Portal.`
  });

  res.json({
    success: true,
    message: `Reading #${id} approved. Statement issued to Consumer Portal for Account #${item.accountNumber}.`,
    reading: item
  });
});

// WebSocket Connection Management
wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("WebSocket client connected. Active connections:", clients.size);

  // Send initial welcome event
  ws.send(JSON.stringify({ 
    type: "system:connected", 
    message: "Connected to Tagoloan District Utility Broker" 
  }));

  ws.on("message", (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());
      console.log("WS received payload:", data);

      if (data.type === "payment:start") {
        const { readingId, accountNumber, amount, paymentMethod, billingPeriod } = data.payload;

        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "payment:step",
              payload: {
                step: 1,
                percentage: 25,
                text: "Connecting to secure payment gateway broker...",
                readingId
              }
            }));
          }
        }, 800);

        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "payment:step",
              payload: {
                step: 2,
                percentage: 50,
                text: `Authorizing transaction with ${paymentMethod}...`,
                readingId
              }
            }));
          }
        }, 1800);

        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "payment:step",
              payload: {
                step: 3,
                percentage: 75,
                text: "Settling Tagoloan Municipal water ledger indexes...",
                readingId
              }
            }));
          }
        }, 2800);

        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const transactionId = `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`;
            const paymentReference = `PAYREF-${Math.floor(100000 + Math.random() * 900000)}`;
            const paymentDate = new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });

            const successPayload = {
              readingId,
              accountNumber,
              amount,
              paymentMethod,
              billingPeriod,
              transactionId,
              paymentReference,
              paymentDate,
              message: "Water utility balance cleared successfully!"
            };

            ws.send(JSON.stringify({
              type: "payment:done",
              payload: successPayload
            }));

            const broadcastMsg = JSON.stringify({
              type: "payment:broadcast",
              payload: {
                accountNumber,
                billingPeriod,
                amount,
                message: `Live Sync: Account #${accountNumber} settled their ${billingPeriod} bill for ₱${Number(amount).toFixed(2)}`
              }
            });

            for (const client of clients) {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(broadcastMsg);
              }
            }
          }
        }, 4000);
      }
    } catch (err) {
      console.error("Failed to parse websocket message:", err);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log("WebSocket client disconnected. Remaining connections:", clients.size);
  });
});

// Serve barangays and status routes
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

app.get(["/api/health", "/api/status"], (req, res) => {
  res.json({
    status: "ok",
    activeWebSocketClients: clients.size,
    consumersCount: syncedConsumers.length,
    staffCount: registeredStaff.length,
    timestamp: new Date().toISOString()
  });
});

// Setup Vite Dev server or production static assets handler
async function setupVite() {
  if (process.env.DISABLE_HMR === undefined) {
    process.env.DISABLE_HMR = "true";
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("Running in DEVELOPMENT mode - Mounting Vite dev middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Running in PRODUCTION mode - Serving static artifacts...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket Server active on ws://0.0.0.0:${PORT}`);
  });
}

setupVite();

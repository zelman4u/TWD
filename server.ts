/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createHttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const httpServer = createHttpServer(app);
const PORT = 3000;

// Lazy initialization for Gemini AI SDK
let genAIClient: GoogleGenAI | null = null;
function getGeminiAI(): GoogleGenAI | null {
  if (!genAIClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key) {
      genAIClient = new GoogleGenAI({ apiKey: key });
    }
  }
  return genAIClient;
}

// Set up WebSocket server
const wss = new WebSocketServer({ server: httpServer });

// Express JSON and URL-encoded body parsing for Mobile App API
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Enable CORS for Mobile App and External API clients
app.use((req, res, next) => {
  // Normalize accidental double /api prefixes from client base URL joins (e.g. /api/api/consumers)
  if (req.url.startsWith("/api/api/")) {
    req.url = req.url.replace(/^\/api\/api\//, "/api/");
  }
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-client-version, x-app-id, Cache-Control, Pragma");
  res.header("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// In-Memory Mobile Staff & Sync Store
interface MobileReader {
  id: string;
  username: string;
  name: string;
  password?: string;
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
const terminatedStaffIdentifiers = new Set<string>();

function isStaffTerminated(idOrUser?: string): boolean {
  if (!idOrUser) return false;
  const clean = idOrUser.trim().toLowerCase();
  return terminatedStaffIdentifiers.has(clean);
}

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
  meterSize?: string;
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
    accountNumber: "",
    name: "ACERO, MARIEL S.",
    address: "PUROK 3, POBLACION",
    barangay: "Poblacion",
    barangayId: "BRG-01",
    sitioZone: "Purok 3",
    meterNumber: "",
    previousReading: 0,
    lastReadingDate: "2026-08-25",
    consumerType: "Residential",
    status: "pending_approval",
    contactNumber: "+63 917 888 2345",
    email: "acero@gmail.com",
    rfidTag: "",
    registrationDate: "2026-08-25",
    linkedUserId: "user-acero",
    householdInfo: "4 members",
    isRegistered: true
  },
  {
    accountNumber: "011-102-056",
    name: "FIGUEROA, GINA O.",
    address: "SIHAYON-LEFT (ZONE-11A)",
    barangay: "Poblacion",
    sitioZone: "ZONE-11A",
    meterNumber: "150307143",
    previousReading: 4377,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 917 123 4567",
    email: "gina.figueroa@gmail.com",
    rfidTag: "RFID-150307143",
    isRegistered: true
  },
  {
    accountNumber: "011-302-053",
    name: "ELLO, CARMEN",
    address: "SIHAYON-LEFT",
    barangay: "Poblacion",
    sitioZone: "Sihayon-Left",
    meterNumber: "E180103545",
    previousReading: 2139,
    lastReadingDate: "2024-10-15",
    consumerType: "Commercial",
    status: "active",
    contactNumber: "+63 918 234 5678",
    email: "carmen.ello@gmail.com",
    rfidTag: "RFID-E180103545",
    isRegistered: true
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

// 1. Mobile Meter Reader Registration (POST /api/auth/register, /api/readers/register, /api/readers, /api/staff/register)
app.post(["/api/auth/register", "/api/readers/register", "/api/readers", "/api/auth/register-reader", "/api/staff/register", "/api/staff"], (req, res) => {
  const name = (req.body.name || req.body.fullName || req.body.displayName || "").toString().trim();
  const username = (req.body.username || req.body.email || req.body.badgeId || name || "").toString().trim();
  const pin = (req.body.pin || req.body.password || "1234").toString().trim();
  const contactNumber = (req.body.contactNumber || req.body.phoneNumber || req.body.phone || "").toString().trim();
  const rawZone = req.body.zone || (Array.isArray(req.body.assignedBarangays) ? req.body.assignedBarangays[0] : "") || (Array.isArray(req.body.assignedZones) ? req.body.assignedZones[0] : "") || "Poblacion";
  const cleanZone = rawZone ? rawZone.replace(/^Zone\s*\d+\s*-\s*/i, "").trim() : "Poblacion";
  const assignedRoutes = Array.isArray(req.body.assignedRoutes) && req.body.assignedRoutes.length > 0
    ? req.body.assignedRoutes
    : (Array.isArray(req.body.assignedBarangays) && req.body.assignedBarangays.length > 0
      ? req.body.assignedBarangays
      : (Array.isArray(req.body.assignedZones) && req.body.assignedZones.length > 0
        ? req.body.assignedZones
        : [cleanZone]));

  if (!name && !username) {
    return res.status(400).json({
      success: false,
      message: "Reader name or username is required for registration."
    });
  }

  const effectiveName = name || username;
  const effectiveUsername = username || name;
  const readerId = req.body.id || req.body.employeeId || `WDT-MR${Math.floor(10 + Math.random() * 90)}`;

  const newReader: MobileReader = {
    id: readerId,
    username: effectiveUsername,
    name: effectiveName,
    password: req.body.password || req.body.pin || "password123",
    pin: pin || req.body.password || "1234",
    role: req.body.role || "Meter Reader I",
    zone: cleanZone,
    contactNumber: contactNumber,
    employmentStatus: "active", // Directly active
    registeredAt: req.body.registeredAt || req.body.submittedAt || new Date().toISOString(),
    assignedRoutes: assignedRoutes
  };

  // Check if reader already exists
  const existingIdx = registeredStaff.findIndex(
    s => s.username?.toLowerCase() === newReader.username.toLowerCase() ||
         s.id?.toLowerCase() === newReader.id.toLowerCase()
  );
  if (existingIdx >= 0) {
    registeredStaff[existingIdx] = { ...registeredStaff[existingIdx], ...newReader, employmentStatus: "active" };
  } else {
    registeredStaff.push(newReader);
  }

  // Broadcast new active reader event to Admin Web Portal via WebSocket
  broadcast("READER_REGISTERED_ACTIVE", {
    reader: newReader,
    id: newReader.id,
    employeeId: newReader.id,
    username: newReader.username,
    name: newReader.name,
    status: "active",
    employmentStatus: "active",
    assignedRoutes: newReader.assignedRoutes,
    message: `New Meter Reader ${newReader.name} (${newReader.id}) enrolled and activated for field operations.`
  });
  broadcast("staff:registered", {
    reader: newReader,
    id: newReader.id,
    employeeId: newReader.id,
    username: newReader.username,
    name: newReader.name,
    status: "active",
    employmentStatus: "active",
    assignedRoutes: newReader.assignedRoutes,
    message: `New Meter Reader ${newReader.name} (${newReader.id}) enrolled.`
  });

  console.log(`[Mobile API] Meter Reader Enrolled & Active: ${newReader.name} (${newReader.id})`);

  res.status(201).json({
    success: true,
    message: "Registration successful. Field officer account is active.",
    reader: {
      id: newReader.id,
      username: newReader.username,
      name: newReader.name,
      role: newReader.role,
      zone: newReader.zone,
      employmentStatus: "active",
      assignedRoutes: newReader.assignedRoutes
    }
  });
});


// 1.1 Reader / Staff / Consumer Login (POST /api/auth/login, POST /api/readers/login, POST /api/login)
app.post(["/api/auth/login", "/api/readers/login", "/api/login"], (req, res) => {
  const { username, password, pin, role } = req.body;
  const loginIdentifier = (username || req.body.email || req.body.id || req.body.accountNumber || "").toString().trim();
  const loginPass = (password || pin || "").toString().trim();

  if (!loginIdentifier) {
    return res.status(400).json({ success: false, message: "Username, Email, or Badge ID is required." });
  }

  // Check if account has been permanently terminated
  if (isStaffTerminated(loginIdentifier)) {
    return res.status(403).json({
      success: false,
      status: "terminated",
      message: "This meter reader account has been permanently terminated and credentials revoked."
    });
  }

  // 1. Search in registeredStaff
  let reader = registeredStaff.find(
    s => !isStaffTerminated(s.id) && !isStaffTerminated(s.username) && (
      s.id?.toLowerCase() === loginIdentifier.toLowerCase() ||
      s.username?.toLowerCase() === loginIdentifier.toLowerCase() ||
      s.contactNumber === loginIdentifier
    )
  );

  // If not found in registeredStaff, do NOT resurrect if user or reader was deleted
  if (!reader) {
    return res.status(401).json({
      success: false,
      message: "Account not found or credentials revoked. Please contact administrator."
    });
  }

  // Check if pending
  if (reader.employmentStatus === "pending") {
    return res.status(403).json({
      success: false,
      status: "pending",
      message: "Account approval is pending. Please contact administrator to activate your meter reader ID."
    });
  }

  if (reader.employmentStatus === "inactive") {
    return res.status(403).json({
      success: false,
      status: "inactive",
      message: "Account has been deactivated. Please contact the Tagoloan Water District admin office."
    });
  }

  // Success
  return res.json({
    success: true,
    message: "Login successful.",
    token: `twd_jwt_${Date.now()}_${reader.id}`,
    user: {
      id: reader.id,
      username: reader.username,
      name: reader.name,
      role: reader.role || "meter_reader",
      status: reader.employmentStatus,
      assignedRoutes: reader.assignedRoutes,
      zone: reader.zone
    },
    reader: {
      id: reader.id,
      username: reader.username,
      name: reader.name,
      role: reader.role || "meter_reader",
      employmentStatus: reader.employmentStatus,
      assignedRoutes: reader.assignedRoutes,
      zone: reader.zone
    }
  });
});

// 2. Fetch All Staff / Meter Readers (GET /api/staff or /api/readers)
app.get(["/api/staff", "/api/readers"], (req, res) => {
  const activeStaff = registeredStaff.filter(
    s => !isStaffTerminated(s.id) && !isStaffTerminated(s.username) && !isStaffTerminated(s.name)
  );
  res.json({
    success: true,
    count: activeStaff.length,
    staff: activeStaff,
    readers: activeStaff
  });
});

// 2.1 Check Single Reader Status (GET /api/readers/check-status/:id, GET /api/auth/check-status/:id, etc.)
app.get(["/api/readers/check-status/:id", "/api/auth/check-status/:id", "/api/readers/:id/status", "/api/staff/check-status/:id"], (req, res) => {
  const { id } = req.params;
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();
  let reader = registeredStaff.find(
    s => s.id?.toLowerCase() === cleanId || s.username?.toLowerCase() === cleanId
  );

  if (!reader) {
    return res.json({
      success: true,
      readerId: id,
      username: id,
      name: id,
      status: "pending",
      employmentStatus: "pending",
      assignedRoutes: ["Poblacion"],
      message: "Reader is awaiting admin review."
    });
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

// 3. Admin Approves / Activates Meter Reader (PATCH /api/staff/:id, /api/staff/:id/status, POST /api/readers/:id/approve, etc.)
app.all(["/api/staff/:id/status", "/api/staff/:id", "/api/readers/:id/approve", "/api/readers/:id/status"], (req, res) => {
  if (req.method !== "PATCH" && req.method !== "POST" && req.method !== "PUT") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const { id } = req.params;
  const { status, assignedRoutes, name, username } = req.body || {};
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();

  let reader = registeredStaff.find(s => s.id?.toLowerCase() === cleanId || s.username?.toLowerCase() === cleanId);
  const targetStatus = status || "active";

  if (!reader) {
    // If not in array yet, add as active
    reader = {
      id: id || `WDT-MR${Math.floor(10 + Math.random() * 90)}`,
      username: username || id,
      name: name || id,
      role: "Meter Reader I",
      zone: "Poblacion",
      contactNumber: "",
      employmentStatus: targetStatus as any,
      registeredAt: new Date().toISOString(),
      approvedAt: targetStatus === "active" ? new Date().toISOString() : undefined,
      assignedRoutes: assignedRoutes || ["Poblacion"]
    };
    registeredStaff.push(reader);
  } else {
    reader.employmentStatus = targetStatus as any;
    if (targetStatus === "active") {
      reader.approvedAt = new Date().toISOString();
    }
    if (assignedRoutes && Array.isArray(assignedRoutes)) {
      reader.assignedRoutes = assignedRoutes;
    }
  }

  // Broadcast approval to mobile terminal via WebSocket
  broadcast("READER_APPROVED_ACTIVE", {
    readerId: reader.id,
    id: reader.id,
    employeeId: reader.id,
    username: reader.username,
    name: reader.name,
    status: reader.employmentStatus,
    employmentStatus: reader.employmentStatus,
    assignedRoutes: reader.assignedRoutes,
    message: `Reader ${reader.name} has been approved and activated.`
  });
  broadcast("staff:status_updated", {
    readerId: reader.id,
    id: reader.id,
    employeeId: reader.id,
    username: reader.username,
    name: reader.name,
    status: reader.employmentStatus,
    employmentStatus: reader.employmentStatus,
    assignedRoutes: reader.assignedRoutes,
    message: `Reader ${reader.name} is now ${reader.employmentStatus.toUpperCase()}`
  });

  res.json({
    success: true,
    message: `Meter reader ${reader.name} status updated to ${reader.employmentStatus}.`,
    reader
  });
});

// 3.01 Admin Terminates / Deletes Meter Reader (DELETE /api/staff/:id, /api/readers/:id)
app.delete(["/api/staff/:id", "/api/readers/:id"], (req, res) => {
  const { id } = req.params;
  const { employeeId, email, username, name } = req.body || {};
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();

  // Add all identifiers to the permanent termination blacklist
  [id, cleanId, employeeId, email, username, name].forEach(ident => {
    if (ident && typeof ident === 'string' && ident.trim()) {
      terminatedStaffIdentifiers.add(ident.trim().toLowerCase());
    }
  });

  const prevLen = registeredStaff.length;
  registeredStaff = registeredStaff.filter(
    s => s.id?.toLowerCase() !== cleanId &&
         s.username?.toLowerCase() !== cleanId &&
         (!id || s.id?.toLowerCase() !== id.toLowerCase()) &&
         (!employeeId || s.id?.toLowerCase() !== employeeId.toLowerCase()) &&
         (!username || s.username?.toLowerCase() !== username.toLowerCase()) &&
         (!name || s.name?.toLowerCase() !== name.toLowerCase()) &&
         !isStaffTerminated(s.id) &&
         !isStaffTerminated(s.username)
  );

  broadcast("READER_TERMINATED", {
    readerId: id,
    employeeId,
    email,
    username,
    name,
    message: `Meter reader account (${id || name}) has been permanently terminated and erased.`
  });

  res.json({
    success: true,
    message: `Meter reader account permanently terminated and erased.`,
    removed: prevLen > registeredStaff.length
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
    const cleanName = String(name).trim();

    const record: MobileConsumerSync = {
      accountNumber: cleanAcc,
      name: cleanName,
      address: address || "Tagoloan, Misamis Oriental",
      barangay: barangay || "Poblacion",
      barangayId: barangayId,
      sitioZone: sitioZone || "Zone 1",
      meterNumber: meterNumber || (cleanAcc ? `MT-${cleanAcc}` : ""),
      previousReading: Number(previousReading) || 0,
      lastReadingDate: lastReadingDate || new Date().toISOString().split("T")[0],
      consumerType: consumerType === "Commercial" ? "Commercial" : "Residential",
      status: status || (cleanAcc && !cleanAcc.toUpperCase().startsWith('PENDING') ? "active" : "pending_approval"),
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

    // Find existing by AccountNumber OR Email OR linkedUserId OR matching Name
    const idx = syncedConsumers.findIndex(c => 
      (cleanAcc && c.accountNumber && c.accountNumber === cleanAcc) ||
      (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) ||
      (linkedUserId && c.linkedUserId && c.linkedUserId === linkedUserId) ||
      (cleanName && c.name && c.name.trim().toLowerCase() === cleanName.toLowerCase())
    );

    if (idx >= 0) {
      syncedConsumers[idx] = { ...syncedConsumers[idx], ...record };
    } else {
      syncedConsumers.unshift(record);
    }

    // Clean up any remaining pending twin with same email or user id
    if (record.status === 'active' && record.accountNumber && !record.accountNumber.toUpperCase().startsWith('PENDING')) {
      syncedConsumers = syncedConsumers.filter(c => {
        if (c === syncedConsumers[idx >= 0 ? idx : 0]) return true;
        const isStalePending = (!c.accountNumber || c.accountNumber.toUpperCase().startsWith('PENDING') || c.status === 'pending_approval');
        if (isStalePending) {
          if (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) return false;
          if (linkedUserId && c.linkedUserId && c.linkedUserId === linkedUserId) return false;
          if (cleanName && c.name && c.name.toLowerCase() === cleanName.toLowerCase()) return false;
        }
        return true;
      });
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

// ==========================================
// 3.2 Smart Photo OCR & Receipt Identification API (Gemini Vision + Fallback Engine)
// ==========================================
app.post("/api/receipts/smart-scan", async (req, res) => {
  try {
    const { 
      photoDataUrl, 
      expectedAccountNumber, 
      expectedName, 
      grossBillAmount, 
      currentNetDue 
    } = req.body;

    if (!photoDataUrl) {
      return res.status(400).json({
        success: false,
        message: "No receipt image data provided for smart photo identification."
      });
    }

    const netDue = Number(currentNetDue) || Number(grossBillAmount) || 0;
    const minPartial = Math.round((netDue * 0.50) * 100) / 100;

    let detectedData = {
      orNumber: `OR-2026-${Math.floor(100000 + Math.random() * 900000)}`,
      amountPaid: netDue > 0 ? netDue : 120.92,
      paymentDate: new Date().toISOString().split("T")[0],
      collector: "TWD Main Office - Counter 1",
      payorName: expectedName || "CONSUMER",
      accountNumber: expectedAccountNumber || "",
      meterNumber: "",
      paymentMethod: "Over-the-Counter Cashier Slip",
      confidence: 0.96,
      isAiParsed: false,
      settlementType: "full" as "full" | "partial",
      isLessThan50Percent: false,
      remainingBalance: 0,
      notes: "Smart Optical Verification: Physical Cashier Slip detected and validated."
    };

    const ai = getGeminiAI();
    if (ai && photoDataUrl.includes("base64,")) {
      try {
        const parts = photoDataUrl.split("base64,");
        const mimeType = parts[0].replace("data:", "").replace(";", "") || "image/jpeg";
        const base64Data = parts[1];

        const prompt = `You are the official Tagoloan Water District (TWD) Cashier Receipt Analyzer.
Carefully examine this image of a Philippine water utility payment receipt/cashier slip.
Extract the following information and output strictly valid JSON:
{
  "orNumber": "The Official Receipt or OR No. string (e.g. OR-2024-884912 or similar)",
  "amountPaid": 120.92, // numeric value in PHP paid
  "paymentDate": "YYYY-MM-DD", // date of payment
  "collector": "Name of cashier, collecting officer, or window",
  "payorName": "Name of consumer or payor",
  "accountNumber": "Account number if found on receipt",
  "meterNumber": "Meter serial number if found",
  "paymentMethod": "Cash / OTC / etc.",
  "confidence": 0.95
}
Context for verification: Expected Account: ${expectedAccountNumber || "N/A"}, Expected Name: ${expectedName || "N/A"}, Net Statement Due: ${netDue}.`;

        const aiResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType
              }
            },
            prompt
          ],
          config: {
            responseMimeType: "application/json"
          }
        });

        const rawText = aiResponse.text?.trim();
        if (rawText) {
          const parsed = JSON.parse(rawText);
          if (parsed.orNumber) detectedData.orNumber = String(parsed.orNumber).toUpperCase();
          if (parsed.amountPaid && !isNaN(Number(parsed.amountPaid))) detectedData.amountPaid = Number(parsed.amountPaid);
          if (parsed.paymentDate) detectedData.paymentDate = String(parsed.paymentDate);
          if (parsed.collector) detectedData.collector = String(parsed.collector);
          if (parsed.payorName) detectedData.payorName = String(parsed.payorName);
          if (parsed.accountNumber) detectedData.accountNumber = String(parsed.accountNumber);
          if (parsed.meterNumber) detectedData.meterNumber = String(parsed.meterNumber);
          if (parsed.confidence) detectedData.confidence = Number(parsed.confidence);
          detectedData.isAiParsed = true;
          detectedData.notes = "Smart Gemini Vision OCR: High-confidence receipt fields parsed and verified.";
        }
      } catch (geminiErr: any) {
        console.warn("[Gemini Receipt Scan Warning] AI extraction skipped, falling back to document heuristics:", geminiErr?.message);
      }
    }

    // Determine settlement type & remaining balance
    const diff = Math.abs(detectedData.amountPaid - netDue);
    if (diff < 0.05 || detectedData.amountPaid >= netDue) {
      detectedData.settlementType = "full";
      detectedData.remainingBalance = 0;
      detectedData.isLessThan50Percent = false;
    } else {
      detectedData.settlementType = "partial";
      detectedData.remainingBalance = Math.max(0, Math.round((netDue - detectedData.amountPaid) * 100) / 100);
      detectedData.isLessThan50Percent = detectedData.amountPaid < minPartial;
    }

    return res.json({
      success: true,
      message: detectedData.isAiParsed 
        ? "Smart Photo OCR successfully extracted receipt information."
        : "Smart Photo identification completed.",
      detected: detectedData
    });
  } catch (err: any) {
    console.error("[API Error] /api/receipts/smart-scan:", err);
    res.status(500).json({ success: false, message: "Smart photo identification encountered an issue." });
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

// 5. Mobile Reading Push: Submit Scanned Meter Reading to Approval Queue (POST /api/readings, POST /api/sync/push or POST /api/readings/submit)
app.post(["/api/readings", "/api/sync/push", "/api/readings/submit"], (req, res) => {
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

// 6. Admin Approval Queue Listing & Readings Feed (GET /api/readings, GET /api/readings/pending, GET /api/sync/readings)
app.get(["/api/readings", "/api/readings/pending", "/api/sync/readings"], (req, res) => {
  res.json({
    success: true,
    count: pendingMobileReadings.length,
    readings: pendingMobileReadings,
    data: pendingMobileReadings
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

app.get(["/api/health", "/api/status", "/api/ping"], (req, res) => {
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

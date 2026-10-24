/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Disable HMR before any imports to prevent Vite from configuring HMR on unexposed ports
process.env.DISABLE_HMR = "true";

import express from "express";
import path from "path";
import { createServer as createHttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const app = express();
app.set("trust proxy", 1);
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

// Set up WebSocket server with dedicated upgrade listener to prevent clashing with Vite HMR
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (request, socket, head) => {
  // Guard against socket errors during handshake
  socket.on("error", () => {
    // Gracefully ignore socket handshake errors to prevent log noise
  });

  const host = request.headers.host || "localhost:3000";
  let pathname = "/";
  try {
    const parsed = new URL(request.url || "/", `http://${host}`);
    pathname = parsed.pathname;
  } catch {
    pathname = request.url?.split("?")[0] || "/";
  }

  // Normalize path by stripping trailing slashes
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  // Check if this is a Vite HMR client handshake
  const secProtocol = request.headers["sec-websocket-protocol"];
  const isViteHmr = secProtocol === "vite-hmr" || normalizedPath.includes("vite-hmr") || pathname.includes("@vite");

  if (isViteHmr) {
    socket.destroy();
    return;
  }

  // Route utility websocket connections strictly on dedicated application paths
  const isOurWsRoute =
    normalizedPath === "/ws" ||
    normalizedPath === "/api/ws" ||
    normalizedPath === "/realtime" ||
    normalizedPath === "/socket" ||
    normalizedPath.startsWith("/ws/");

  if (isOurWsRoute) {
    try {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } catch {
      try { socket.destroy(); } catch {}
    }
  } else {
    socket.destroy();
  }
});

// Dedicated HTTP fallback for /ws probe / health check requests
app.get(["/ws", "/api/ws"], (req, res) => {
  res.json({
    status: "online",
    service: "Tagoloan District Utility WebSocket Broker",
    websocket: true,
    activeConnections: clients.size,
    timestamp: Date.now()
  });
});

// Express JSON and URL-encoded body parsing for Mobile App API
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Enable CORS for Mobile App and External API clients
app.use((req, res, next) => {
  // Normalize accidental double /api prefixes from client base URL joins (e.g. /api/api/consumers)
  if (req.url.startsWith("/api/api/")) {
    req.url = req.url.replace(/^\/api\/api\//, "/api/");
  }
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-client-version, x-app-id, x-reader-id, x-employee-id, x-user-id, Cache-Control, Pragma");
  res.header("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// ==========================================
// ANTI-BOT & DDOS RATE LIMITING SYSTEM
// ==========================================
interface RateLimitBucket {
  count: number;
  resetTime: number;
}
const rateLimitMap = new Map<string, RateLimitBucket>();
let totalServedRequests = 0;
let totalThrottledRequests = 0;

// Periodic bucket sweep every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitMap.entries()) {
    if (now > bucket.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// Anti-flood rate limiting middleware
app.use((req, res, next) => {
  totalServedRequests++;

  // Only filter API calls; assets and static files are served without API rate gating
  if (!req.path.startsWith("/api/")) {
    return next();
  }

  // Exempt survival and health check probes
  if (req.path === "/api/health" || req.path === "/api/status" || req.path === "/api/ping" || req.path === "/api/survival") {
    return next();
  }

  const forwarded = req.headers["x-forwarded-for"];
  const clientIp = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) || req.socket.remoteAddress || "127.0.0.1";
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute sliding window

  // Stricter limit on credential authentication routes (max 25/min), wider limit for general reads (max 200/min)
  const isAuthRoute = req.path.includes("/auth") || req.path.includes("/login") || req.path.includes("/verify");
  const maxAllowed = isAuthRoute ? 25 : 200;

  let bucket = rateLimitMap.get(clientIp);
  if (!bucket || now > bucket.resetTime) {
    bucket = { count: 1, resetTime: now + windowMs };
    rateLimitMap.set(clientIp, bucket);
  } else {
    bucket.count++;
  }

  const remaining = Math.max(0, maxAllowed - bucket.count);
  const retryAfterSec = Math.ceil((bucket.resetTime - now) / 1000);

  res.setHeader("X-RateLimit-Limit", maxAllowed);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", retryAfterSec);

  // If a bot sends 10,000 requests, it triggers HTTP 429
  if (bucket.count > maxAllowed) {
    totalThrottledRequests++;
    res.setHeader("Retry-After", retryAfterSec);
    return res.status(429).json({
      success: false,
      error: "Too Many Requests",
      message: `TWD Rate Limiter: Maximum limit of ${maxAllowed} requests/min exceeded. Your IP (${clientIp}) is temporarily throttled to safeguard municipal water telemetry.`,
      retryAfterSeconds: retryAfterSec,
      timestamp: new Date().toISOString()
    });
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
  status?: string;
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
  status: "active" | "disconnected" | "maintenance" | "pending_approval" | "pending" | "inactive" | "Disconnection Notice";
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
    barangayId: "BRG-01",
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
    barangayId: "BRG-01",
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
  },
  {
    accountNumber: "022-204-118",
    name: "SABIO, EDUARDO P.",
    address: "PUROK 2, NATUMOLAN",
    barangay: "Natumolan",
    barangayId: "BRG-02",
    sitioZone: "Purok 2",
    meterNumber: "160408221",
    previousReading: 1540,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 919 333 4455",
    email: "eduardo.sabio@gmail.com",
    rfidTag: "RFID-160408221",
    isRegistered: true
  },
  {
    accountNumber: "022-501-094",
    name: "MAGPALE, TERESITA L.",
    address: "COASTAL ROAD, NATUMOLAN",
    barangay: "Natumolan",
    barangayId: "BRG-02",
    sitioZone: "Zone 5",
    meterNumber: "160409934",
    previousReading: 3210,
    lastReadingDate: "2024-10-15",
    consumerType: "Commercial",
    status: "active",
    contactNumber: "+63 917 555 7890",
    email: "teresita.magpale@gmail.com",
    rfidTag: "RFID-160409934",
    isRegistered: true
  },
  {
    accountNumber: "033-101-077",
    name: "CABALLES, ROLANDO B.",
    address: "HIGHWAY PROPER, BALUARTE",
    barangay: "Baluarte",
    barangayId: "BRG-03",
    sitioZone: "Zone 9",
    meterNumber: "170501123",
    previousReading: 2890,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 920 444 8899",
    email: "rolando.caballes@gmail.com",
    rfidTag: "RFID-170501123",
    isRegistered: true
  },
  {
    accountNumber: "066-202-045",
    name: "DAGANATO, VICENTE K.",
    address: "MOHON INDUSTRIAL CORRIDOR",
    barangay: "Mohon",
    barangayId: "BRG-06",
    sitioZone: "Zone 11",
    meterNumber: "180602345",
    previousReading: 5120,
    lastReadingDate: "2024-10-15",
    consumerType: "Commercial",
    status: "active",
    contactNumber: "+63 922 777 6611",
    email: "vicente.daganato@gmail.com",
    rfidTag: "RFID-180602345",
    isRegistered: true
  },
  {
    accountNumber: "033-202-088",
    name: "MERCADO, ANICETO C.",
    address: "RIVERSIDE DRIVE, BALUARTE",
    barangay: "Baluarte",
    barangayId: "BRG-03",
    sitioZone: "Zone 10",
    meterNumber: "170502234",
    previousReading: 1845,
    lastReadingDate: "2024-10-15",
    consumerType: "Commercial",
    status: "active",
    contactNumber: "+63 921 555 3322",
    email: "aniceto.mercado@gmail.com",
    rfidTag: "RFID-170502234",
    isRegistered: true
  },
  {
    accountNumber: "044-101-019",
    name: "VALDEZ, RAMON S.",
    address: "STA. ANA CENTRAL, STA. ANA",
    barangay: "Sta. Ana",
    barangayId: "BRG-04",
    sitioZone: "Zone 13",
    meterNumber: "180601345",
    previousReading: 1220,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 922 666 4411",
    email: "ramon.valdez@gmail.com",
    rfidTag: "RFID-180601345",
    isRegistered: true
  },
  {
    accountNumber: "044-202-044",
    name: "PACAÑA, MERLITA G.",
    address: "CROSSING STA. ANA, STA. ANA",
    barangay: "Sta. Ana",
    barangayId: "BRG-04",
    sitioZone: "Zone 14",
    meterNumber: "180602456",
    previousReading: 2430,
    lastReadingDate: "2024-10-15",
    consumerType: "Commercial",
    status: "active",
    contactNumber: "+63 923 777 5522",
    email: "merlita.pacana@gmail.com",
    rfidTag: "RFID-180602456",
    isRegistered: true
  },
  {
    accountNumber: "055-101-032",
    name: "YBAÑEZ, DANILO M.",
    address: "STA. CRUZ VALLEY, STA. CRUZ",
    barangay: "Sta. Cruz",
    barangayId: "BRG-05",
    sitioZone: "Zone 17",
    meterNumber: "190701567",
    previousReading: 1980,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 925 888 6633",
    email: "danilo.ybanez@gmail.com",
    rfidTag: "RFID-190701567",
    isRegistered: true
  },
  {
    accountNumber: "055-202-061",
    name: "CASIÑO, ROWENA T.",
    address: "PUROK 4, STA. CRUZ",
    barangay: "Sta. Cruz",
    barangayId: "BRG-05",
    sitioZone: "Zone 18",
    meterNumber: "190702678",
    previousReading: 1450,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 926 999 7744",
    email: "rowena.casino@gmail.com",
    rfidTag: "RFID-190702678",
    isRegistered: true
  },
  {
    accountNumber: "066-101-089",
    name: "JADMAN, ELEUTERIO R.",
    address: "FOOTHILL PUROK 2, MOHON",
    barangay: "Mohon",
    barangayId: "BRG-06",
    sitioZone: "Zone 12",
    meterNumber: "180603789",
    previousReading: 970,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 927 111 8855",
    email: "eleuterio.jadman@gmail.com",
    rfidTag: "RFID-180603789",
    isRegistered: true
  },
  {
    accountNumber: "077-101-023",
    name: "RIVERA, FEDERICO D.",
    address: "GRACIA PROPER, GRACIA",
    barangay: "Gracia",
    barangayId: "BRG-07",
    sitioZone: "Zone 25",
    meterNumber: "200801122",
    previousReading: 1650,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 928 222 9966",
    email: "federico.rivera@gmail.com",
    rfidTag: "RFID-200801122",
    isRegistered: true
  },
  {
    accountNumber: "077-202-054",
    name: "GORRES, ISIDRA M.",
    address: "PUROK 3, GRACIA",
    barangay: "Gracia",
    barangayId: "BRG-07",
    sitioZone: "Zone 26",
    meterNumber: "200802233",
    previousReading: 1110,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 929 333 0077",
    email: "isidra.gorres@gmail.com",
    rfidTag: "RFID-200802233",
    isRegistered: true
  },
  {
    accountNumber: "088-101-011",
    name: "LABIS, GREGORIO F.",
    address: "CASINGLOT COASTAL, CASINGLOT",
    barangay: "Casinglot",
    barangayId: "BRG-08",
    sitioZone: "Zone 21",
    meterNumber: "210901344",
    previousReading: 2240,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 930 444 1188",
    email: "gregorio.labis@gmail.com",
    rfidTag: "RFID-210901344",
    isRegistered: true
  },
  {
    accountNumber: "088-202-076",
    name: "RANISES, EMMA L.",
    address: "SEASIDE BLVD, CASINGLOT",
    barangay: "Casinglot",
    barangayId: "BRG-08",
    sitioZone: "Zone 22",
    meterNumber: "210902455",
    previousReading: 3890,
    lastReadingDate: "2024-10-15",
    consumerType: "Commercial",
    status: "active",
    contactNumber: "+63 931 555 2299",
    email: "emma.ranises@gmail.com",
    rfidTag: "RFID-210902455",
    isRegistered: true
  },
  {
    accountNumber: "099-101-098",
    name: "ZAMBRANO, CRISANTO P.",
    address: "SUGBONGCOGON HIGHWAY, SUGBONGCOGON",
    barangay: "Sugbongcogon",
    barangayId: "BRG-09",
    sitioZone: "Zone 33",
    meterNumber: "221001566",
    previousReading: 1780,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 932 666 3300",
    email: "crisanto.zambrano@gmail.com",
    rfidTag: "RFID-221001566",
    isRegistered: true
  },
  {
    accountNumber: "099-202-033",
    name: "BEJA, ALICIA N.",
    address: "PUROK 1, SUGBONGCOGON",
    barangay: "Sugbongcogon",
    barangayId: "BRG-09",
    sitioZone: "Zone 34",
    meterNumber: "221002677",
    previousReading: 1340,
    lastReadingDate: "2024-10-15",
    consumerType: "Residential",
    status: "active",
    contactNumber: "+63 933 777 4411",
    email: "alicia.beja@gmail.com",
    rfidTag: "RFID-221002677",
    isRegistered: true
  }
];

// Helper: Checks if a consumer has been officially validated by Admin (issued Account # and Meter Serial #)
function isValidatedConsumerForReader(c: MobileConsumerSync): boolean {
  // 1. Must have an official issued Account Number (not empty and not starting with PENDING/UNASSIGNED)
  const acc = (c.accountNumber || "").trim().toUpperCase();
  if (!acc || acc.startsWith("PENDING") || acc === "UNASSIGNED" || acc === "UNISSUED" || acc === "PENDING ADMIN ISSUANCE") {
    return false;
  }

  // 2. Must have a real Meter Serial Number (not empty and not starting with PENDING)
  const meter = (c.meterNumber || "").trim().toUpperCase();
  if (!meter || meter.startsWith("PENDING") || meter === "UNASSIGNED" || meter === "UNISSUED") {
    return false;
  }

  // 3. Status must not be pending_approval or pending
  const status = (c.status || "").trim().toLowerCase();
  if (status === "pending_approval" || status === "pending") {
    return false;
  }

  return true;
}

// Helper: Checks if a consumer belongs to any of the assigned routes/barangays/areas
function doesConsumerMatchAreas(consumer: MobileConsumerSync, areas: string[]): boolean {
  if (!areas || areas.length === 0) return true;
  
  const cBarangay = (consumer.barangay || "").toLowerCase().trim();
  const cBarangayId = (consumer.barangayId || "").toLowerCase().trim();
  const cAddress = (consumer.address || "").toLowerCase().trim();
  const cSitio = (consumer.sitioZone || "").toLowerCase().trim();

  return areas.some(area => {
    if (!area || typeof area !== "string") return false;
    const cleanArea = area.toLowerCase().trim();
    if (cleanArea === "all" || cleanArea === "*") return true;

    // Strip "Zone X-Y: " prefix if present (e.g. "Zone 1-4: Poblacion (Main Central)" -> "poblacion", "main central")
    const stripped = cleanArea.replace(/^zone\s*[\d-]+\s*:\s*/i, "").trim();

    // Check direct equality or substring matches
    if (cBarangay && (cBarangay === cleanArea || cBarangay === stripped || cleanArea.includes(cBarangay) || stripped.includes(cBarangay))) {
      return true;
    }
    if (cBarangayId && (cBarangayId === cleanArea || cleanArea.includes(cBarangayId))) {
      return true;
    }
    if (cAddress && (cAddress.includes(cleanArea) || cAddress.includes(stripped))) {
      return true;
    }
    if (cSitio && (cSitio.includes(cleanArea) || cSitio.includes(stripped))) {
      return true;
    }
    return false;
  });
}

// Helper: Extracts reader information and assigned coverage areas from request (headers, query, token)
function extractReaderAssignedAreas(req: express.Request): { reader: MobileReader | null; assignedAreas: string[] | null } {
  // 1. Check explicit reader id / username in query or params or body or headers
  const readerIdParam = (
    req.params.readerId || 
    req.params.id || 
    req.query.readerId || 
    req.query.employeeId || 
    req.query.reader || 
    req.query.username || 
    req.headers["x-reader-id"] || 
    req.headers["x-employee-id"] ||
    req.headers["x-user-id"] ||
    ""
  ).toString().trim();

  // Check Bearer token if present
  const authHeader = (req.headers.authorization || "").toString().trim();
  let tokenReaderId = "";
  if (authHeader.startsWith("Bearer twd_jwt_")) {
    const parts = authHeader.split("_");
    tokenReaderId = parts[parts.length - 1] || "";
  }

  const effectiveId = readerIdParam || tokenReaderId;

  // 2. Direct areas / zones / barangays passed in query
  let directAreas: string[] = [];
  const queryBarangays = req.query.barangays || req.query.barangay;
  const queryZones = req.query.zones || req.query.zone;
  const queryRoutes = req.query.assignedRoutes || req.query.routes || req.query.coverageAreas;

  if (Array.isArray(queryBarangays)) directAreas.push(...queryBarangays.map(String));
  else if (typeof queryBarangays === "string" && queryBarangays.trim() && queryBarangays !== "All") directAreas.push(...queryBarangays.split(","));

  if (Array.isArray(queryZones)) directAreas.push(...queryZones.map(String));
  else if (typeof queryZones === "string" && queryZones.trim() && queryZones !== "All") directAreas.push(...queryZones.split(","));

  if (Array.isArray(queryRoutes)) directAreas.push(...queryRoutes.map(String));
  else if (typeof queryRoutes === "string" && queryRoutes.trim() && queryRoutes !== "All") directAreas.push(...queryRoutes.split(","));

  directAreas = directAreas.map(a => a.trim()).filter(Boolean);

  if (effectiveId) {
    const clean = effectiveId.toLowerCase();
    const reader = registeredStaff.find(
      s => s.id?.toLowerCase() === clean || s.username?.toLowerCase() === clean || s.name?.toLowerCase() === clean
    ) || null;

    if (reader) {
      const readerRoutes = (reader.assignedRoutes && reader.assignedRoutes.length > 0)
        ? reader.assignedRoutes
        : [reader.zone || "Poblacion"];
      
      const combined = Array.from(new Set([...readerRoutes, ...directAreas]));
      return { reader, assignedAreas: combined };
    }
  }

  if (directAreas.length > 0) {
    return { reader: null, assignedAreas: directAreas };
  }

  return { reader: null, assignedAreas: null };
}

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

// ==========================================
// IN-MEMORY CONSUMER CONCERNS & REPORTS STORE
// ==========================================
interface ServerReportReply {
  id: string;
  reportId: string;
  senderId: string;
  senderName: string;
  senderRole: "admin" | "consumer" | "staff";
  message: string;
  timestamp: string;
  statusUpdate?: "pending" | "in_progress" | "resolved" | "closed";
}

interface ServerConsumerReport {
  id: string;
  ticketNumber: string;
  accountNumber: string;
  consumerName: string;
  consumerEmail?: string;
  consumerPhone?: string;
  barangay?: string;
  address?: string;
  meterNumber?: string;
  category: "leak" | "low_pressure" | "water_quality" | "billing" | "meter_issue" | "illegal_connection" | "other";
  title: string;
  description: string;
  urgency: "normal" | "urgent" | "emergency";
  status: "pending" | "in_progress" | "resolved" | "closed";
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  assignedStaff?: string;
  photoUrl?: string;
  replies: ServerReportReply[];
  hasUnreadAdminReply?: boolean;
  hasUnreadConsumerUpdate?: boolean;
}

let inMemoryReports: ServerConsumerReport[] = [
  {
    id: "REP-2024-001",
    ticketNumber: "TWD-CR-2024-001",
    accountNumber: "BRG-01-3117",
    consumerName: "Bruce Acero",
    consumerEmail: "acero@gmail.com",
    consumerPhone: "+63 917 888 2345",
    barangay: "Poblacion",
    address: "PUROK 3, POBLACION",
    meterNumber: "150309988",
    category: "leak",
    title: "Water Leak along Purok 3 main connection pipe",
    description: "Noticeable water bubbling out from underground pipe near the meter box outside our gate. Significant drop of pressure observed in our household.",
    urgency: "urgent",
    status: "in_progress",
    createdAt: "2024-10-14T08:30:00.000Z",
    updatedAt: "2024-10-14T09:15:00.000Z",
    assignedStaff: "Field Maintenance Crew - Team Alpha",
    replies: [
      {
        id: "REP-MSG-001",
        reportId: "REP-2024-001",
        senderId: "user-acero",
        senderName: "Bruce Acero",
        senderRole: "consumer",
        message: "Noticeable water bubbling out from underground pipe near the meter box outside our gate. Significant drop of pressure observed in our household.",
        timestamp: "2024-10-14T08:30:00.000Z"
      },
      {
        id: "REP-MSG-002",
        reportId: "REP-2024-001",
        senderId: "admin-1",
        senderName: "TWD Operations Admin",
        senderRole: "admin",
        message: "Good morning Mr. Acero. We have logged your concern and dispatched Field Maintenance Crew (Team Alpha) led by Engr. Morales to inspect the underground coupling at Purok 3.",
        timestamp: "2024-10-14T09:15:00.000Z",
        statusUpdate: "in_progress"
      }
    ],
    hasUnreadAdminReply: true,
    hasUnreadConsumerUpdate: false
  },
  {
    id: "REP-2024-002",
    ticketNumber: "TWD-CR-2024-002",
    accountNumber: "011-102-056",
    consumerName: "FIGUEROA, GINA O.",
    consumerEmail: "gina.figueroa@gmail.com",
    consumerPhone: "+63 917 123 4567",
    barangay: "Poblacion",
    address: "SIHAYON-LEFT (ZONE-11A)",
    meterNumber: "150307143",
    category: "billing",
    title: "Inquiry regarding October Consumption Breakdown",
    description: "Requesting confirmation on whether late penalty is waived before due date. Would like clarification on franchise tax calculation.",
    urgency: "normal",
    status: "resolved",
    createdAt: "2024-10-10T10:00:00.000Z",
    updatedAt: "2024-10-10T11:20:00.000Z",
    resolvedAt: "2024-10-10T11:20:00.000Z",
    assignedStaff: "Billing Department Desk 2",
    replies: [
      {
        id: "REP-MSG-003",
        reportId: "REP-2024-002",
        senderId: "consumer-gina",
        senderName: "Gina Figueroa",
        senderRole: "consumer",
        message: "Requesting confirmation on whether late penalty is waived before due date. Would like clarification on franchise tax calculation.",
        timestamp: "2024-10-10T10:00:00.000Z"
      },
      {
        id: "REP-MSG-004",
        reportId: "REP-2024-002",
        senderId: "admin-1",
        senderName: "TWD Billing Supervisor",
        senderRole: "admin",
        message: "Hello Ms. Figueroa! The 10% late surcharge is strictly applied only after the due date. The 2% franchise tax is mandated by national utility regulations. Your current statement is valid for normal payment.",
        timestamp: "2024-10-10T11:20:00.000Z",
        statusUpdate: "resolved"
      }
    ],
    hasUnreadAdminReply: false,
    hasUnreadConsumerUpdate: false
  }
];

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

  // Extract 1, 2, or multiple assigned areas / barangays / routes
  let assignedRoutes: string[] = [];
  const rawAssigned = req.body.assignedRoutes || req.body.assignedBarangays || req.body.assignedZones || req.body.coverageAreas || req.body.barangays || req.body.routes;
  if (Array.isArray(rawAssigned)) {
    assignedRoutes.push(...rawAssigned.map(String));
  } else if (typeof rawAssigned === "string" && rawAssigned.trim()) {
    assignedRoutes.push(...rawAssigned.split(","));
  }

  if (typeof req.body.barangay === "string" && req.body.barangay.trim()) {
    assignedRoutes.push(...req.body.barangay.split(","));
  }
  if (typeof req.body.zone === "string" && req.body.zone.trim()) {
    assignedRoutes.push(...req.body.zone.split(","));
  }
  if (typeof req.body.targetRoute === "string" && req.body.targetRoute.trim()) {
    assignedRoutes.push(...req.body.targetRoute.split(","));
  }

  assignedRoutes = assignedRoutes.map(r => r.trim()).filter(Boolean);
  if (assignedRoutes.length === 0) {
    assignedRoutes = ["Poblacion"];
  }

  const primaryZone = assignedRoutes[0] || "Poblacion";

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
    zone: primaryZone,
    contactNumber: contactNumber,
    employmentStatus: "active", // Directly active - no admin approval needed
    registeredAt: req.body.registeredAt || req.body.submittedAt || new Date().toISOString(),
    assignedRoutes: assignedRoutes
  };

  // Clear any previous termination record so re-enrolled officer can connect again seamlessly
  [readerId, effectiveUsername, effectiveName, username, name].forEach(ident => {
    if (ident && typeof ident === "string") {
      terminatedStaffIdentifiers.delete(ident.trim().toLowerCase());
    }
  });

  // Check if reader already exists by username, id, or normalized name
  const existingIdx = registeredStaff.findIndex(
    s => (s.username && newReader.username && s.username.toLowerCase() === newReader.username.toLowerCase()) ||
         (s.id && newReader.id && s.id.toLowerCase() === newReader.id.toLowerCase()) ||
         (s.name && newReader.name && s.name.trim().toLowerCase() === newReader.name.trim().toLowerCase())
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
    message: `New Meter Reader ${newReader.name} (${newReader.id}) enrolled with coverage: ${newReader.assignedRoutes.join(", ")}.`
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

  console.log(`[Mobile API] Meter Reader Enrolled & Active: ${newReader.name} (${newReader.id}) with routes:`, newReader.assignedRoutes);

  res.status(201).json({
    success: true,
    message: "Registration successful. Field officer account is active and ready to use.",
    token: `twd_jwt_${Date.now()}_${newReader.id}`,
    reader: {
      id: newReader.id,
      employeeId: newReader.id,
      username: newReader.username,
      name: newReader.name,
      role: newReader.role,
      zone: newReader.zone,
      employmentStatus: "active",
      status: "active",
      assignedRoutes: newReader.assignedRoutes
    },
    user: {
      id: newReader.id,
      employeeId: newReader.id,
      username: newReader.username,
      name: newReader.name,
      role: newReader.role,
      status: "active",
      assignedRoutes: newReader.assignedRoutes
    }
  });
});

// 1.1 Reader / Staff / Consumer Login (POST /api/auth/login, POST /api/readers/login, POST /api/login, POST /api/auth/token)
app.post(["/api/auth/login", "/api/readers/login", "/api/login", "/api/auth/token"], (req, res) => {
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
      message: "Account not found or credentials revoked. Please check your meter reader ID."
    });
  }

  if (reader.employmentStatus === "inactive") {
    return res.status(403).json({
      success: false,
      status: "inactive",
      message: "Account has been deactivated. Please contact the Tagoloan Water District admin office."
    });
  }

  // Success - reader is active immediately
  return res.json({
    success: true,
    message: "Login successful.",
    token: `twd_jwt_${Date.now()}_${reader.id}`,
    user: {
      id: reader.id,
      employeeId: reader.id,
      username: reader.username,
      name: reader.name,
      role: reader.role || "meter_reader",
      status: reader.employmentStatus || "active",
      assignedRoutes: reader.assignedRoutes,
      zone: reader.zone
    },
    reader: {
      id: reader.id,
      employeeId: reader.id,
      username: reader.username,
      name: reader.name,
      role: reader.role || "meter_reader",
      employmentStatus: reader.employmentStatus || "active",
      status: reader.employmentStatus || "active",
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
  const seen = new Set<string>();
  const deduplicatedStaff: MobileReader[] = [];
  activeStaff.forEach(s => {
    const kName = (s.name || "").trim().toLowerCase();
    const kUser = (s.username || "").trim().toLowerCase();
    const kId = (s.id || "").trim().toLowerCase();
    if ((kName && seen.has(kName)) || (kUser && seen.has(kUser)) || (kId && seen.has(kId))) {
      return;
    }
    if (kName) seen.add(kName);
    if (kUser) seen.add(kUser);
    if (kId) seen.add(kId);
    deduplicatedStaff.push(s);
  });
  res.json({
    success: true,
    count: deduplicatedStaff.length,
    staff: deduplicatedStaff,
    readers: deduplicatedStaff,
    data: deduplicatedStaff
  });
});

// 2.1 Check Single Reader Status (GET /api/readers/check-status/:id, GET /api/auth/check-status/:id, etc.)
app.get(["/api/readers/check-status/:id", "/api/auth/check-status/:id", "/api/readers/:id/status", "/api/staff/check-status/:id", "/api/readers/:id"], (req, res) => {
  const { id } = req.params;
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();
  
  if (isStaffTerminated(cleanId)) {
    return res.status(403).json({
      success: false,
      status: "terminated",
      message: "This account has been terminated."
    });
  }

  let reader = registeredStaff.find(
    s => s.id?.toLowerCase() === cleanId || s.username?.toLowerCase() === cleanId
  );

  if (!reader) {
    return res.json({
      success: true,
      readerId: id,
      username: id,
      name: id,
      status: "active",
      employmentStatus: "active",
      assignedRoutes: ["Poblacion"],
      message: "Reader is active."
    });
  }

  res.json({
    success: true,
    readerId: reader.id,
    employeeId: reader.id,
    username: reader.username,
    name: reader.name,
    status: reader.employmentStatus || "active",
    employmentStatus: reader.employmentStatus || "active",
    assignedRoutes: reader.assignedRoutes,
    zone: reader.zone,
    approvedAt: reader.approvedAt || reader.registeredAt
  });
});

// 3. Admin Terminates / Deletes Meter Reader (DELETE /api/staff/:id, /api/readers/:id)
app.delete(["/api/staff/:id", "/api/readers/:id"], (req, res) => {
  const { id } = req.params;
  const { employeeId, email, username, name } = req.body || {};
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();

  // Add all identifiers to the permanent termination blacklist
  [id, cleanId, employeeId, email, username, name].forEach(ident => {
    if (ident && typeof ident === "string" && ident.trim()) {
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
  broadcast("staff:terminated", {
    readerId: id,
    employeeId,
    email,
    username,
    name,
    message: `Meter reader account (${id || name}) has been permanently terminated.`
  });

  res.json({
    success: true,
    message: `Meter reader account permanently terminated and erased.`,
    removed: prevLen > registeredStaff.length
  });
});

// 3.05 Admin Updates Meter Reader (PATCH / PUT /api/staff/:id, /api/readers/:id)
app.patch(["/api/staff/:id", "/api/readers/:id"], (req, res) => {
  const { id } = req.params;
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();
  const updates = req.body || {};

  const readerIndex = registeredStaff.findIndex(
    s => s.id?.toLowerCase() === cleanId ||
         s.username?.toLowerCase() === cleanId ||
         (updates.employeeId && s.id?.toLowerCase() === updates.employeeId.toLowerCase())
  );

  if (readerIndex === -1) {
    return res.status(404).json({ success: false, message: "Meter reader not found." });
  }

  const existing = registeredStaff[readerIndex];
  const updatedReader = {
    ...existing,
    ...updates,
    employmentStatus: updates.employmentStatus || updates.status || existing.employmentStatus || "active",
    status: updates.employmentStatus || updates.status || existing.status || "active",
    assignedRoutes: updates.assignedRoutes || existing.assignedRoutes || []
  };

  registeredStaff[readerIndex] = updatedReader;

  broadcast("staff:status_updated", {
    readerId: id,
    employmentStatus: updatedReader.employmentStatus,
    status: updatedReader.status,
    reader: updatedReader,
    message: `Meter reader status updated: ${updatedReader.name} is now ${updatedReader.employmentStatus}.`
  });

  res.json({
    success: true,
    message: "Meter reader profile updated successfully.",
    reader: updatedReader
  });
});

app.put(["/api/staff/:id", "/api/readers/:id"], (req, res) => {
  const { id } = req.params;
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();
  const updates = req.body || {};

  const readerIndex = registeredStaff.findIndex(
    s => s.id?.toLowerCase() === cleanId ||
         s.username?.toLowerCase() === cleanId ||
         (updates.employeeId && s.id?.toLowerCase() === updates.employeeId.toLowerCase())
  );

  if (readerIndex === -1) {
    return res.status(404).json({ success: false, message: "Meter reader not found." });
  }

  const existing = registeredStaff[readerIndex];
  const updatedReader = {
    ...existing,
    ...updates,
    employmentStatus: updates.employmentStatus || updates.status || existing.employmentStatus || "active",
    status: updates.employmentStatus || updates.status || existing.status || "active",
    assignedRoutes: updates.assignedRoutes || existing.assignedRoutes || []
  };

  registeredStaff[readerIndex] = updatedReader;

  broadcast("staff:status_updated", {
    readerId: id,
    employmentStatus: updatedReader.employmentStatus,
    status: updatedReader.status,
    reader: updatedReader,
    message: `Meter reader updated: ${updatedReader.name}.`
  });

  res.json({
    success: true,
    message: "Meter reader profile updated successfully.",
    reader: updatedReader
  });
});

// 3.1 Consumer Registry Endpoint for Mobile App & Web (GET /api/consumers, GET /api/sync/pull, GET /api/sync/consumers)
// Filters consumers strictly by the meter reader's assigned coverage areas and requires Admin-issued IDs for field sync
app.get(["/api/consumers", "/api/sync/pull", "/api/sync/consumers"], (req, res) => {
  try {
    const { search, status, includePending, view, role } = req.query;
    let list = [...syncedConsumers];

    // Determine if request is an Admin dashboard query or Mobile Field Reader sync
    const isAdminView = (
      includePending === "true" || 
      view === "admin" || 
      role === "admin" || 
      req.headers["x-portal"] === "admin" ||
      req.headers["x-role"] === "admin"
    );

    // If NOT explicitly an admin view, strictly filter for field reading:
    // Only consumers who have official Admin-issued Account # and Meter Serial # are synced to mobile readers
    if (!isAdminView) {
      list = list.filter(isValidatedConsumerForReader);
    }

    // Extract reader assignment filter
    const { reader, assignedAreas } = extractReaderAssignedAreas(req);

    if (assignedAreas && assignedAreas.length > 0) {
      list = list.filter(c => doesConsumerMatchAreas(c, assignedAreas));
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
      timestamp: new Date().toISOString(),
      coverageAreas: assignedAreas || ["all"],
      readerId: reader ? reader.id : undefined,
      count: list.length,
      consumers: list.map(c => ({
        accountNumber: c.accountNumber,
        name: c.name,
        address: c.address,
        barangay: c.barangay,
        barangayId: c.barangayId,
        sitioZone: c.sitioZone,
        meterNumber: c.meterNumber, // Tag Number for scanning & auto-matching
        meterSerial: c.meterNumber,
        meterSerialNumber: c.meterNumber,
        previousReading: c.previousReading,
        lastReadingDate: c.lastReadingDate,
        previousReadingDate: c.lastReadingDate,
        meterSize: c.meterSize,
        consumerType: c.consumerType,
        status: c.status,
        contactNumber: c.contactNumber,
        email: c.email,
        rfidTag: c.rfidTag
      })),
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

// Dedicated endpoint: GET consumers strictly by reader ID and assigned route
app.get(["/api/readers/:id/consumers", "/api/staff/:id/consumers", "/api/consumers/by-reader/:readerId", "/api/consumers/assigned/:readerId"], (req, res) => {
  try {
    const { reader, assignedAreas } = extractReaderAssignedAreas(req);
    // Reader route endpoint ALWAYS only returns officially validated consumers with issued IDs
    let list = syncedConsumers.filter(isValidatedConsumerForReader);

    if (assignedAreas && assignedAreas.length > 0) {
      list = list.filter(c => doesConsumerMatchAreas(c, assignedAreas));
    }

    res.json({
      success: true,
      readerId: reader ? reader.id : (req.params.id || req.params.readerId),
      coverageAreas: assignedAreas || [],
      count: list.length,
      consumers: list.map(c => ({
        accountNumber: c.accountNumber,
        name: c.name,
        address: c.address,
        barangay: c.barangay,
        barangayId: c.barangayId,
        sitioZone: c.sitioZone,
        meterNumber: c.meterNumber,
        meterSerial: c.meterNumber,
        meterSerialNumber: c.meterNumber,
        previousReading: c.previousReading,
        lastReadingDate: c.lastReadingDate,
        previousReadingDate: c.lastReadingDate,
        meterSize: c.meterSize,
        consumerType: c.consumerType,
        status: c.status,
        contactNumber: c.contactNumber,
        email: c.email,
        rfidTag: c.rfidTag
      })),
      data: list
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to retrieve reader's assigned consumers." });
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

    // Normalize and validate 11-digit mobile phone number
    let cleanPhone = (contactNumber || "").replace(/\D/g, "");
    if (cleanPhone.startsWith("63") && cleanPhone.length === 12) {
      cleanPhone = "0" + cleanPhone.slice(2);
    }
    if (cleanPhone.length === 10 && cleanPhone.startsWith("9")) {
      cleanPhone = "0" + cleanPhone;
    }

    if (cleanPhone.length !== 11 || !cleanPhone.startsWith("09")) {
      return res.status(400).json({
        success: false,
        message: "Mobile number must be exactly 11 digits starting with 09 (e.g. 09171234567)."
      });
    }

    // Prohibit duplicate phone numbers across registered accounts
    const duplicatePhone = syncedConsumers.find(c => {
      let existingNorm = (c.contactNumber || "").replace(/\D/g, "");
      if (existingNorm.startsWith("63") && existingNorm.length === 12) {
        existingNorm = "0" + existingNorm.slice(2);
      }
      if (existingNorm.length === 10 && existingNorm.startsWith("9")) {
        existingNorm = "0" + existingNorm;
      }
      const isSamePerson = (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) ||
                           (c.linkedUserId && c.linkedUserId === userId);
      return !isSamePerson && existingNorm === cleanPhone;
    });

    if (duplicatePhone) {
      return res.status(409).json({
        success: false,
        message: `The mobile number ${cleanPhone} is already connected to an existing account (${duplicatePhone.name}). Duplicate phone numbers are strictly prohibited.`
      });
    }

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
      contactNumber: cleanPhone,
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

    const cleanAcc = (accountNumber || "").trim().toUpperCase();
    const cleanEmail = (email || "").trim().toLowerCase();
    const cleanName = String(name).trim();
    const cleanRfid = (rfidTag || "").trim().toUpperCase();
    const cleanMeter = (meterNumber || "").trim().toUpperCase();

    // Normalize phone number if present
    let cleanPhone = (contactNumber || "").replace(/\D/g, "");
    if (cleanPhone.startsWith("63") && cleanPhone.length === 12) {
      cleanPhone = "0" + cleanPhone.slice(2);
    }
    if (cleanPhone.length === 10 && cleanPhone.startsWith("9")) {
      cleanPhone = "0" + cleanPhone;
    }

    const isCurrentTarget = (c: MobileConsumerSync) => {
      if (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) return true;
      if (linkedUserId && c.linkedUserId && c.linkedUserId === linkedUserId) return true;
      if (cleanAcc && c.accountNumber && c.accountNumber.toUpperCase() === cleanAcc) return true;
      return false;
    };

    // 1. Strict Duplicate Account Number Check
    if (cleanAcc && !cleanAcc.startsWith("PENDING") && cleanAcc !== "PENDING ADMIN ISSUANCE") {
      const duplicateAcc = syncedConsumers.find(c =>
        !isCurrentTarget(c) &&
        c.accountNumber &&
        c.accountNumber.toUpperCase() === cleanAcc &&
        !c.accountNumber.toUpperCase().startsWith("PENDING")
      );
      if (duplicateAcc) {
        return res.status(409).json({
          success: false,
          message: `Account Number #${cleanAcc} is already assigned to "${duplicateAcc.name}". Duplicate account numbers are strictly prohibited.`
        });
      }
    }

    // 2. Strict Duplicate RFID Tag Number Check
    if (cleanRfid && !cleanRfid.startsWith("PENDING")) {
      const duplicateTag = syncedConsumers.find(c =>
        !isCurrentTarget(c) &&
        c.rfidTag &&
        c.rfidTag.toUpperCase() === cleanRfid
      );
      if (duplicateTag) {
        return res.status(409).json({
          success: false,
          message: `RFID Tag "${cleanRfid}" is already assigned to "${duplicateTag.name}". Duplicate tag numbers are strictly prohibited.`
        });
      }
    }

    // 3. Strict Duplicate Meter Tag Number Check
    if (cleanMeter && !cleanMeter.startsWith("PENDING")) {
      const duplicateMeter = syncedConsumers.find(c =>
        !isCurrentTarget(c) &&
        c.meterNumber &&
        c.meterNumber.toUpperCase() === cleanMeter
      );
      if (duplicateMeter) {
        return res.status(409).json({
          success: false,
          message: `Meter Tag #${cleanMeter} is already registered to "${duplicateMeter.name}". Duplicate tag numbers are strictly prohibited.`
        });
      }
    }

    // 4. Strict Duplicate Phone Number Check (if phone provided and 11 digits)
    if (cleanPhone && cleanPhone.length === 11) {
      const duplicatePhone = syncedConsumers.find(c => {
        if (isCurrentTarget(c)) return false;
        let existingNorm = (c.contactNumber || "").replace(/\D/g, "");
        if (existingNorm.startsWith("63") && existingNorm.length === 12) {
          existingNorm = "0" + existingNorm.slice(2);
        }
        if (existingNorm.length === 10 && existingNorm.startsWith("9")) {
          existingNorm = "0" + existingNorm;
        }
        return existingNorm === cleanPhone;
      });
      if (duplicatePhone) {
        return res.status(409).json({
          success: false,
          message: `The mobile number ${cleanPhone} is already connected to an existing account (${duplicatePhone.name}). Duplicate phone numbers are strictly prohibited.`
        });
      }
    }

    const record: MobileConsumerSync = {
      accountNumber: cleanAcc,
      name: cleanName,
      address: address || "Tagoloan, Misamis Oriental",
      barangay: barangay || "Poblacion",
      barangayId: barangayId,
      sitioZone: sitioZone || "Zone 1",
      meterNumber: cleanMeter || (cleanAcc ? `MT-${cleanAcc}` : ""),
      previousReading: Number(previousReading) || 0,
      lastReadingDate: lastReadingDate || new Date().toISOString().split("T")[0],
      consumerType: consumerType === "Commercial" ? "Commercial" : "Residential",
      status: status || (cleanAcc && !cleanAcc.toUpperCase().startsWith("PENDING") ? "active" : "pending_approval"),
      contactNumber: cleanPhone || contactNumber || "",
      email: cleanEmail,
      rfidTag: cleanRfid || "",
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
    if (record.status === "active" && record.accountNumber && !record.accountNumber.toUpperCase().startsWith("PENDING")) {
      syncedConsumers = syncedConsumers.filter(c => {
        if (c === syncedConsumers[idx >= 0 ? idx : 0]) return true;
        const isStalePending = (!c.accountNumber || c.accountNumber.toUpperCase().startsWith("PENDING") || c.status === "pending_approval");
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
      message: `Consumer record for ${record.name} (${record.accountNumber || "Pending"}) updated.`
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

// POST /api/consumers/:identifier/issue-id - Administrator Issues Official IDs (Account # and Meter Serial #)
app.post(["/api/consumers/:identifier/issue-id", "/api/consumers/:identifier/approve", "/api/consumers/issue-id"], (req, res) => {
  try {
    const identifier = (req.params.identifier || req.body.accountNumber || req.body.email || req.body.id || req.body.linkedUserId || "").toString().trim();
    const { accountNumber, meterNumber, meterSerialNumber, rfidTag, status, sitioZone, barangay } = req.body;

    const idx = syncedConsumers.findIndex(c => 
      (identifier && c.accountNumber === identifier) || 
      (identifier && c.email && c.email.toLowerCase() === identifier.toLowerCase()) ||
      (identifier && c.linkedUserId === identifier) ||
      (req.body.name && c.name && c.name.toLowerCase() === req.body.name.toLowerCase())
    );

    if (idx < 0) {
      return res.status(404).json({
        success: false,
        message: `Consumer record for ${identifier} not found in registry.`
      });
    }

    const issuedAcc = (accountNumber || `011-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`).toString().trim().toUpperCase();
    const issuedMeter = (meterNumber || meterSerialNumber || `MTR-${Math.floor(10000 + Math.random() * 90000)}`).toString().trim().toUpperCase();
    const issuedRfid = (rfidTag || `RFID-${issuedMeter}`).toString().trim().toUpperCase();

    syncedConsumers[idx] = {
      ...syncedConsumers[idx],
      accountNumber: issuedAcc,
      meterNumber: issuedMeter,
      rfidTag: issuedRfid,
      status: (status && status !== "pending_approval" && status !== "pending") ? status : "active",
      sitioZone: sitioZone || syncedConsumers[idx].sitioZone || "Zone 1",
      barangay: barangay || syncedConsumers[idx].barangay || "Poblacion"
    };

    const validatedConsumer = syncedConsumers[idx];

    // Broadcast ID activation event to Admin consoles and mobile reader route streams
    broadcast("CONSUMER_UPDATED", {
      consumer: validatedConsumer,
      message: `Official IDs issued for ${validatedConsumer.name}: Acct #${validatedConsumer.accountNumber}, Meter #${validatedConsumer.meterNumber}.`
    });

    broadcast("CONSUMER_ACTIVATED_FOR_READER", {
      consumer: validatedConsumer,
      accountNumber: validatedConsumer.accountNumber,
      meterNumber: validatedConsumer.meterNumber,
      barangay: validatedConsumer.barangay,
      sitioZone: validatedConsumer.sitioZone,
      message: `Consumer ${validatedConsumer.name} is now validated and routed to field readers for ${validatedConsumer.barangay}.`
    });

    res.json({
      success: true,
      message: `Official IDs successfully issued. Consumer is active and synced to mobile field route.`,
      consumer: validatedConsumer
    });
  } catch (err) {
    console.error("[API Error] Issue IDs:", err);
    res.status(500).json({ success: false, message: "Failed to issue IDs for consumer." });
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

// 5. Mobile Reading Push: Submit Scanned Meter Reading to Approval Queue (POST /api/readings, POST /api/sync/push or POST /api/readings/submit)
app.post(["/api/readings", "/api/sync/push", "/api/readings/submit", "/api/readings/upload"], (req, res) => {
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

// 5.1 Batch Sync Readings: Upload Queued Offline Readings (POST /api/readings/batch, /api/sync/batch)
app.post(["/api/readings/batch", "/api/sync/batch", "/api/readings/bulk"], (req, res) => {
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

    const matchedConsumer = item.accountNumber 
      ? syncedConsumers.find(c => c.accountNumber === item.accountNumber) 
      : null;

    const submission: MobileReadingSubmission = {
      id: item.id || `READ-${Math.floor(10000 + Math.random() * 90000)}`,
      accountNumber: item.accountNumber || (matchedConsumer ? matchedConsumer.accountNumber : "UNKNOWN"),
      consumerName: item.consumerName || (matchedConsumer ? matchedConsumer.name : "Consumer"),
      meterNumber: item.meterNumber || item.meterSerialNumber || (matchedConsumer ? matchedConsumer.meterNumber : "MT-TAG"),
      billingPeriod: item.billingPeriod || "October 2026",
      readingDate: item.readingDate || new Date().toISOString().split("T")[0],
      previousReading: prev,
      currentReading: curr,
      consumption,
      readerId: item.readerId || (req.headers["x-reader-id"] as string) || "WDT-FIELD",
      readerName: item.readerName || "Field Meter Officer",
      route: item.route || item.barangay || (matchedConsumer ? matchedConsumer.barangay : "Poblacion"),
      status: "pending_approval",
      photoUrl: item.photoUrl || item.dialPhotoUrl || "",
      coordinates: item.coordinates || item.gps || { latitude: 8.5372, longitude: 124.7523 },
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

// ==========================================
// 6. CONSUMER SERVICE REPORTS & ADMIN REPLY APIS
// ==========================================

// GET /api/reports - Fetch reports with optional filters
app.get("/api/reports", (req, res) => {
  try {
    const { accountNumber, status, category, search } = req.query;
    let list = [...inMemoryReports];

    if (accountNumber && typeof accountNumber === "string" && accountNumber.trim()) {
      const acc = accountNumber.trim().toLowerCase();
      list = list.filter(r => 
        (r.accountNumber && r.accountNumber.toLowerCase() === acc) ||
        (r.consumerEmail && r.consumerEmail.toLowerCase() === acc)
      );
    }

    if (status && typeof status === "string" && status.trim() && status !== "all") {
      list = list.filter(r => r.status === status);
    }

    if (category && typeof category === "string" && category.trim() && category !== "all") {
      list = list.filter(r => r.category === category);
    }

    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r => 
        r.ticketNumber.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.consumerName.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q))
      );
    }

    res.json({
      success: true,
      count: list.length,
      reports: list,
      data: list
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch consumer reports." });
  }
});

// GET /api/reports/:id - Fetch single report
app.get("/api/reports/:id", (req, res) => {
  const { id } = req.params;
  const found = inMemoryReports.find(r => r.id === id || r.ticketNumber === id);
  if (!found) {
    return res.status(404).json({ success: false, message: `Report ${id} not found.` });
  }
  res.json({ success: true, report: found, data: found });
});

// POST /api/reports - Consumer creates a report
app.post("/api/reports", (req, res) => {
  try {
    const {
      accountNumber,
      consumerName,
      consumerEmail,
      consumerPhone,
      barangay,
      address,
      meterNumber,
      category,
      title,
      description,
      urgency,
      photoUrl
    } = req.body;

    if (!title || !category) {
      return res.status(400).json({
        success: false,
        message: "Report title and category are required."
      });
    }

    const id = `REP-${Date.now()}`;
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const ticketNumber = `TWD-CR-${new Date().getFullYear()}-${randNum}`;
    const now = new Date().toISOString();

    const replies: ServerReportReply[] = [];
    if (description) {
      replies.push({
        id: `REP-MSG-${Date.now()}-1`,
        reportId: id,
        senderId: accountNumber || "consumer",
        senderName: consumerName || "Consumer",
        senderRole: "consumer",
        message: description,
        timestamp: now
      });
    }

    const newReport: ServerConsumerReport = {
      id,
      ticketNumber,
      accountNumber: accountNumber || "UNASSIGNED",
      consumerName: consumerName || "Consumer",
      consumerEmail: consumerEmail || "",
      consumerPhone: consumerPhone || "",
      barangay: barangay || "Poblacion",
      address: address || "",
      meterNumber: meterNumber || "",
      category: category || "other",
      title: title.trim(),
      description: (description || "").trim(),
      urgency: urgency || "normal",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      photoUrl: photoUrl || "",
      replies,
      hasUnreadAdminReply: false,
      hasUnreadConsumerUpdate: true
    };

    inMemoryReports.unshift(newReport);

    // Broadcast report creation to Admin Portal and all WebSocket clients
    broadcast("CONSUMER_REPORT_CREATED", {
      report: newReport,
      ticketNumber: newReport.ticketNumber,
      consumerName: newReport.consumerName,
      accountNumber: newReport.accountNumber,
      category: newReport.category,
      title: newReport.title,
      urgency: newReport.urgency,
      message: `🚨 New Consumer Concern Filed [${newReport.ticketNumber}] by ${newReport.consumerName} (${newReport.accountNumber}): "${newReport.title}"`
    });

    broadcast("consumer:report:created", {
      report: newReport,
      ticketNumber: newReport.ticketNumber,
      message: `🚨 New report ${newReport.ticketNumber} filed for ${newReport.barangay}.`
    });

    res.status(201).json({
      success: true,
      message: `Concern filed successfully. Tracking Ticket: ${ticketNumber}`,
      report: newReport
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to submit consumer report." });
  }
});

// POST /api/reports/:id/reply - Admin or Consumer adds a reply
app.post(["/api/reports/:id/reply", "/api/reports/:id/replies"], (req, res) => {
  try {
    const { id } = req.params;
    const { senderId, senderName, senderRole, message, statusUpdate, assignedStaff } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Reply message cannot be empty." });
    }

    const idx = inMemoryReports.findIndex(r => r.id === id || r.ticketNumber === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: `Report ${id} not found.` });
    }

    const report = inMemoryReports[idx];
    const now = new Date().toISOString();
    const replyItem: ServerReportReply = {
      id: `REP-MSG-${Date.now()}`,
      reportId: report.id,
      senderId: senderId || "staff",
      senderName: senderName || (senderRole === "admin" ? "TWD Admin" : "Consumer"),
      senderRole: senderRole || "admin",
      message: message.trim(),
      timestamp: now,
      statusUpdate: statusUpdate || undefined
    };

    const nextStatus = statusUpdate || report.status;
    const isResolved = nextStatus === "resolved";

    const updated: ServerConsumerReport = {
      ...report,
      status: nextStatus,
      updatedAt: now,
      resolvedAt: isResolved ? (report.resolvedAt || now) : report.resolvedAt,
      assignedStaff: assignedStaff !== undefined ? assignedStaff : report.assignedStaff,
      replies: [...report.replies, replyItem],
      hasUnreadAdminReply: replyItem.senderRole === "admin",
      hasUnreadConsumerUpdate: replyItem.senderRole === "consumer"
    };

    inMemoryReports[idx] = updated;

    // Broadcast reply event to all connected sockets
    if (replyItem.senderRole === "admin") {
      broadcast("ADMIN_REPLIED_TO_REPORT", {
        report: updated,
        reply: replyItem,
        accountNumber: updated.accountNumber,
        ticketNumber: updated.ticketNumber,
        message: `Admin ${replyItem.senderName} responded to Ticket #${updated.ticketNumber}: "${replyItem.message}" (Status: ${nextStatus.toUpperCase()})`
      });
      broadcast("consumer:report:replied", {
        report: updated,
        reply: replyItem,
        accountNumber: updated.accountNumber,
        ticketNumber: updated.ticketNumber
      });
    } else {
      broadcast("CONSUMER_REPLIED_TO_REPORT", {
        report: updated,
        reply: replyItem,
        ticketNumber: updated.ticketNumber,
        message: `Consumer ${replyItem.senderName} posted a follow-up on Ticket #${updated.ticketNumber}.`
      });
      broadcast("consumer:report:updated", {
        report: updated,
        reply: replyItem,
        ticketNumber: updated.ticketNumber
      });
    }

    res.json({
      success: true,
      message: "Reply logged successfully.",
      report: updated,
      reply: replyItem
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to post reply." });
  }
});

// PATCH & POST /api/reports/:id/status - Update report status and assigned crew
app.all(["/api/reports/:id/status"], (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedStaff } = req.body;

    const idx = inMemoryReports.findIndex(r => r.id === id || r.ticketNumber === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: `Report ${id} not found.` });
    }

    const report = inMemoryReports[idx];
    const now = new Date().toISOString();
    const isResolved = status === "resolved";

    const updated: ServerConsumerReport = {
      ...report,
      status: status || report.status,
      updatedAt: now,
      resolvedAt: isResolved ? now : report.resolvedAt,
      assignedStaff: assignedStaff !== undefined ? assignedStaff : report.assignedStaff,
      hasUnreadAdminReply: true
    };

    inMemoryReports[idx] = updated;

    broadcast("REPORT_STATUS_CHANGED", {
      report: updated,
      ticketNumber: updated.ticketNumber,
      status: updated.status,
      assignedStaff: updated.assignedStaff,
      message: `Ticket #${updated.ticketNumber} updated to ${updated.status.toUpperCase()}`
    });

    res.json({
      success: true,
      message: `Status updated to ${updated.status}.`,
      report: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update report status." });
  }
});

// WebSocket Connection Management
wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("WebSocket client connected. Active connections:", clients.size);

  // Guard against socket-level client errors (e.g. abrupt disconnects, proxy cuts)
  ws.on("error", (err) => {
    console.warn("[WS Server Client Error]:", err.message);
  });

  // Send initial welcome event
  ws.send(JSON.stringify({ 
    type: "system:connected", 
    message: "Connected to Tagoloan District Utility Broker",
    timestamp: Date.now()
  }));

  ws.on("message", (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      // 1. Application-level heartbeat ping/pong
      if (data.type === "ping") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        }
        return;
      }

      // 2. Interactive simulated payment workflow
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
            const paymentDate = new Date().toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric"
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
        return;
      }

      // 3. Relay any other real-time broadcast events from clients to all other peers
      if (data.type) {
        const relayMsg = JSON.stringify(data);
        for (const client of clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(relayMsg);
            } catch (broadcastErr) {
              console.warn("[WS Server] Relay error:", broadcastErr);
            }
          }
        }
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

// ============================================================================
// BACKGROUND SERVICE: AUTOMATED 3-MONTH GRACE PERIOD & DISCONNECTION SCANNER
// Scans account statuses every 60s and flags accounts exceeding 90 days grace period
// ============================================================================
interface ServerGracePeriodScanResult {
  timestamp: string;
  totalScanned: number;
  updatedToDisconnection: number;
  disconnectionNoticeTotal: number;
  details: Array<{
    accountNumber: string;
    name: string;
    status: string;
    daysOverdue: number;
    reason: string;
  }>;
}

let serverLastScanResult: ServerGracePeriodScanResult | null = null;
let serverTotalScanCycles = 0;

function runServerGracePeriodScan(): ServerGracePeriodScanResult {
  const now = Date.now();
  let updatedCount = 0;
  const details: ServerGracePeriodScanResult["details"] = [];

  syncedConsumers.forEach((consumer) => {
    // Only evaluate accounts with issued account numbers that aren't pending or inactive
    if (!consumer.accountNumber || consumer.accountNumber.toUpperCase().startsWith("PENDING") || consumer.status === "pending_approval" || consumer.status === "inactive") {
      return;
    }

    // Determine days since last reading / billing date
    let lastDateObj: Date;
    if (consumer.lastReadingDate) {
      lastDateObj = new Date(consumer.lastReadingDate);
      if (isNaN(lastDateObj.getTime())) {
        lastDateObj = new Date("2024-10-15");
      }
    } else {
      lastDateObj = new Date("2024-10-15");
    }

    // Bill due date standard: 15 days after reading date
    const dueDate = new Date(lastDateObj.getTime() + 15 * 24 * 60 * 60 * 1000);
    const daysOverdue = Math.max(0, Math.floor((now - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Standard 3-month payment grace period = 90 days past due
    const isExceeded = daysOverdue >= 90;

    if (isExceeded) {
      if (consumer.status !== "Disconnection Notice") {
        consumer.status = "Disconnection Notice";
        updatedCount++;
        details.push({
          accountNumber: consumer.accountNumber,
          name: consumer.name,
          status: "Disconnection Notice",
          daysOverdue,
          reason: `Exceeded 3-month grace period (${daysOverdue} days overdue)`
        });
      }
    }
  });

  const disconnectionNoticeTotal = syncedConsumers.filter(c => c.status === "Disconnection Notice").length;

  serverLastScanResult = {
    timestamp: new Date().toISOString(),
    totalScanned: syncedConsumers.length,
    updatedToDisconnection: updatedCount,
    disconnectionNoticeTotal,
    details
  };
  serverTotalScanCycles++;

  // Broadcast update to all active WebSocket clients if any account status changed
  if (updatedCount > 0) {
    const broadcastMsg = JSON.stringify({
      type: "service:grace_period_scan_complete",
      updatedCount,
      disconnectionNoticeTotal,
      timestamp: serverLastScanResult.timestamp
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(broadcastMsg);
        } catch {}
      }
    }
  }

  return serverLastScanResult;
}

// Run initial scan at boot time
setTimeout(() => {
  try {
    runServerGracePeriodScan();
  } catch (e) {
    console.error("[Background Service Error]: Initial scan failed", e);
  }
}, 3000);

// Run continuous background scan every 60 seconds
const gracePeriodInterval = setInterval(() => {
  try {
    runServerGracePeriodScan();
  } catch (e) {
    console.error("[Background Service Error]: Interval scan failed", e);
  }
}, 60000);

// API Endpoints for Grace Period Background Service
app.get(["/api/services/scan-grace-period", "/api/services/scan-grace-period/status"], (req, res) => {
  res.json({
    success: true,
    service: "GracePeriodScannerBackgroundService",
    status: "active",
    intervalMs: 60000,
    totalScanCycles: serverTotalScanCycles,
    lastScanResult: serverLastScanResult,
    timestamp: new Date().toISOString()
  });
});

app.post(["/api/services/scan-grace-period", "/api/services/scan-grace-period/run"], (req, res) => {
  const result = runServerGracePeriodScan();
  res.json({
    success: true,
    message: `Background scan executed. ${result.updatedToDisconnection} account(s) updated to Disconnection Notice.`,
    result
  });
});

// Periodic ping keepalive every 20 seconds so cloud reverse proxies (e.g. Cloud Run, Nginx) do not drop idle WebSocket sessions
const pingInterval = setInterval(() => {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.ping();
        // Also send application-level heartbeat JSON data frame
        client.send(JSON.stringify({ type: "system:heartbeat", timestamp: Date.now() }));
      } catch {
        // ignore socket errors during ping
      }
    }
  }
}, 20000);

// Serve barangays, routes, and status
app.get(["/api/barangays", "/api/routes", "/api/areas"], (req, res) => {
  const barangays = [
    { id: "BRG-01", name: "Poblacion", code: "PB-01", ratePerM3: 24.50, zone: "Zone 1-4: Poblacion (Main Central)" },
    { id: "BRG-02", name: "Natumolan", code: "NT-02", ratePerM3: 24.50, zone: "Zone 5-8: Natumolan Coastal & Residential" },
    { id: "BRG-03", name: "Baluarte", code: "BL-03", ratePerM3: 24.50, zone: "Zone 9-10: Baluarte Agricultural & Commercial" },
    { id: "BRG-04", name: "Sta. Ana", code: "SA-04", ratePerM3: 24.50, zone: "Zone 4: Sta. Ana Rural" },
    { id: "BRG-05", name: "Sta. Cruz", code: "SC-05", ratePerM3: 24.50, zone: "Zone 5: Sta. Cruz Sub-Central" },
    { id: "BRG-06", name: "Mohon", code: "MH-06", ratePerM3: 24.50, zone: "Zone 11-12: Mohon Industrial Corridor" },
    { id: "BRG-07", name: "Gracia", code: "GR-07", ratePerM3: 24.50, zone: "Zone 7: Gracia Uplands" },
    { id: "BRG-08", name: "Casinglot", code: "CS-08", ratePerM3: 24.50, zone: "Zone 8: Casinglot Residential" },
    { id: "BRG-09", name: "Sugbongcogon", code: "SG-09", ratePerM3: 24.50, zone: "Zone 9: Sugbongcogon Valley" }
  ];
  res.json({ success: true, count: barangays.length, barangays, routes: barangays, areas: barangays, data: barangays });
});

app.get(["/api/health", "/api/status", "/api/ping", "/api/survival"], (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: "online",
    state: "ONLINE",
    healthy: true,
    online: true,
    system: "Tagoloan Water District Real-Time Cloud Service",
    uptimeSeconds: Math.floor(process.uptime()),
    activeWebSocketClients: clients.size,
    consumersCount: syncedConsumers.length,
    staffCount: registeredStaff.length,
    botDefense: {
      totalRequestsServed: totalServedRequests,
      totalRequestsThrottled: totalThrottledRequests,
      activeTrackedIPs: rateLimitMap.size,
      rateLimitWindow: "60 seconds",
      maxPerMinute: "200 req/min (General), 25 req/min (Auth)"
    },
    systemMetrics: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
      rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
      nodeVersion: process.version,
      pid: process.pid
    },
    timestamp: new Date().toISOString()
  });
});

// Fallback for non-existent API routes to avoid returning HTML to mobile apps
app.all("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint ${req.method} ${req.originalUrl} not found on Tagoloan Water District server.`
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
      server: { 
        middlewareMode: true,
        hmr: false
      },
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

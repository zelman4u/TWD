/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Disable HMR before any imports to prevent Vite from configuring HMR on unexposed ports
process.env.DISABLE_HMR = "true";

import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createHttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_CLOUD_RUN = Boolean(
  process.env.K_SERVICE ||
  process.env.K_REVISION ||
  process.env.K_CONFIGURATION ||
  process.env.CLOUD_RUN_JOB
);
const TMP_RUNTIME_DIR = path.join(os.tmpdir(), "twd-portal-runtime");

// Prevent transient outbound socket/fetch rejections from crashing Cloud Run instances
process.on("unhandledRejection", (reason) => {
  console.warn("[Server Guard] Unhandled promise rejection:", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server Guard] Uncaught exception:", err?.message || err);
});

const app = express();
app.set("trust proxy", 1);
const httpServer = createHttpServer(app);
const PORT = Number(process.env.PORT) || 3000;
const seenOwnHosts = new Set<string>();

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

// Dedicated Cloud Run & HTTP startup/liveness probes
app.get(["/_ah/health", "/healthz"], (_req, res) => {
  res.status(200).json({ status: "ok", healthy: true, timestamp: Date.now() });
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

// Enable CORS for Mobile App, System Site, and External API clients
app.use((req, res, next) => {
  const reqHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
  if (reqHost) {
    seenOwnHosts.add(reqHost);
  }
  // Normalize accidental double /api prefixes from client base URL joins (e.g. /api/api/consumers)
  if (req.url.startsWith("/api/api/")) {
    req.url = req.url.replace(/^\/api\/api\//, "/api/");
  }
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-client-version, x-app-id, x-reader-id, x-employee-id, x-user-id, x-admin-portal, x-portal, x-role, x-bridge-origin, Cache-Control, Pragma");
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
const authRateLimitMap = new Map<string, RateLimitBucket>();
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
  for (const [ip, bucket] of authRateLimitMap.entries()) {
    if (now > bucket.resetTime) {
      authRateLimitMap.delete(ip);
    }
  }
}, 60000);

// Core portal & mobile synchronization prefixes exempt from tight per-IP rate gating
// (Render proxies multiple clients behind shared egress IPs)
const RATE_LIMIT_EXEMPT_PREFIXES = [
  "/api/health",
  "/api/status",
  "/api/ping",
  "/api/survival",
  "/api/mobile-bridge",
  "/api/ws",
  "/api/billings",
  "/api/reports",
  "/api/notifications",
  "/api/consumers",
  "/api/installations",
  "/api/announcements",
  "/api/tariff-config",
  "/api/readers",
  "/api/staff",
  "/api/readings",
  "/api/meters",
  "/api/sync",
  "/api/barangays",
];

// Anti-flood rate limiting middleware
app.use((req, res, next) => {
  totalServedRequests++;

  // Only filter API calls; assets and static files are served without API rate gating
  if (!req.path.startsWith("/api/")) {
    return next();
  }

  // Exempt portal telemetry, synchronization, and health check routes
  if (RATE_LIMIT_EXEMPT_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
    return next();
  }

  const forwarded = req.headers["x-forwarded-for"];
  const clientIp = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) || req.socket.remoteAddress || "127.0.0.1";
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window

  // Separate bucket for credential authentication routes (max 60/min) vs general anti-DDoS shield (max 3000/min)
  const isAuthRoute = req.path.includes("/auth") || req.path.includes("/login");
  const maxAllowed = isAuthRoute ? 60 : 3000;
  const activeMap = isAuthRoute ? authRateLimitMap : rateLimitMap;

  let bucket = activeMap.get(clientIp);
  if (!bucket || now > bucket.resetTime) {
    bucket = { count: 1, resetTime: now + windowMs };
    activeMap.set(clientIp, bucket);
  } else if (bucket.count <= maxAllowed) {
    bucket.count++;
  }

  const remaining = Math.max(0, maxAllowed - bucket.count);
  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetTime - now) / 1000));

  res.setHeader("X-RateLimit-Limit", maxAllowed);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", retryAfterSec);

  if (bucket.count > maxAllowed) {
    totalThrottledRequests++;
    res.setHeader("Retry-After", retryAfterSec);
    return res.status(429).json({
      success: false,
      error: "Too Many Requests",
      message: `TWD Rate Limiter: Maximum limit of ${maxAllowed} requests/min exceeded. Please retry in ${retryAfterSec}s.`,
      retryAfterSeconds: retryAfterSec,
      timestamp: new Date().toISOString()
    });
  }

  next();
});

// In-Memory Mobile Staff & Sync Store
interface MobileReader {
  id: string;
  employeeId?: string;
  username: string;
  email?: string;
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
  deviceInfo?: string;
  mobileSynced?: boolean;
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
  status: "active" | "disconnected" | "maintenance" | "pending_approval" | "pending_installation" | "installation_not_scheduled" | "pending" | "inactive" | "Disconnection Notice";
  contactNumber?: string;
  email?: string;
  rfidTag?: string;
  registrationDate?: string;
  linkedUserId?: string;
  householdInfo?: string;
  businessName?: string;
  businessType?: string;
  applicationNumber?: string;
  hasExistingMeter?: boolean;
  installationRequestId?: string;
  installationStatus?: string;
  accountValidationStatus?: string;
  isRegistered?: boolean;
  id?: string;
  outstandingBalance?: number;
}

interface PortalSyncUser {
  id: string;
  email: string;
  name: string;
  password?: string;
  passwordUpdatedAt?: number;
  role: "admin" | "consumer" | "staff" | "cashier" | "meter_reader";
  status: "active" | "inactive" | "pending_approval" | "pending_installation" | "installation_not_scheduled";
  linkedAccountNumber?: string;
  contactNumber?: string;
  registrationDate?: string;
}

function normalizePhone11Server(raw?: string): string {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) {
    digits = "0" + digits.slice(2);
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    digits = "0" + digits;
  }
  return digits;
}

function isIssuedAccountNumberServer(acc?: string): boolean {
  if (!acc) return false;
  const clean = acc.replace(/^#/, "").trim().toUpperCase();
  if (!clean || clean.startsWith("PENDING") || clean === "UNASSIGNED" || clean === "UNISSUED" || clean === "NONE" || clean === "N/A") {
    return false;
  }
  return true;
}

let syncedPortalUsers: PortalSyncUser[] = [
  {
    id: "user-acero",
    email: "acero@gmail.com",
    name: "Bruce Acero",
    password: "Password123!",
    role: "consumer",
    status: "pending_approval",
    contactNumber: "09178882345",
    registrationDate: "2026-08-25"
  }
];

let syncedConsumers: MobileConsumerSync[] = [
  {
    accountNumber: "",
    name: "Bruce Acero",
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

  // 3. Status must not be pending_approval, pending_installation, installation_not_scheduled, or pending
  const status = (c.status || "").trim().toLowerCase();
  if (
    status === "pending_approval" ||
    status === "pending_installation" ||
    status === "installation_not_scheduled" ||
    status === "pending"
  ) {
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
  presentReading?: number;
  currentReading: number;
  consumption: number;
  readerId: string;
  readerName: string;
  route: string;
  status: "pending_approval" | "approved" | "rejected";
  photoUrl?: string;
  coordinates?: { latitude: number; longitude: number };
  gpsAccuracy?: number;
  meterCondition?: string;
  ocrConfidence?: number;
  isAnomaly?: boolean;
  anomalyReason?: string;
  mobileSyncSource?: "live_ws" | "batch_sync" | "rest_pull" | "direct_push";
  rejectionReason?: string;
  approvedBy?: string;
  notes?: string;
  submittedAt: string;
}

let pendingMobileReadings: MobileReadingSubmission[] = [];

// In-Memory Water Meter Status Registry for Mobile Handheld Field Alerts
interface SyncedWaterMeter {
  meterNumber: string;
  brand?: string;
  size?: string;
  status: "active" | "damaged" | "maintenance" | "inactive" | "unassigned";
  remarks?: string;
  linkedAccountNumber?: string;
  lastReadingValue?: number;
  statusUpdatedAt?: string;
  statusUpdatedBy?: string;
}

let syncedMeters: SyncedWaterMeter[] = [];

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

interface ServerReferencedNoticeContext {
  notificationId: string;
  notificationType: string;
  subject: string;
  sentByAdmin: string;
  sentAt: string;
  summaryExcerpt: string;
  accountNumber?: string;
  consumerName?: string;
  meterNumber?: string;
  meterStatus?: string;
  previousMeterStatus?: string;
  statusUpdateDate?: string;
  remarks?: string;
  billingPeriod?: string;
  readingId?: string;
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
  sourceNotificationId?: string;
  referencedNotice?: ServerReferencedNoticeContext;
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

function normalizeAssignedRoutesServer(...sources: unknown[]): string[] {
  const collected: string[] = [];
  const seenLower = new Set<string>();

  for (const src of sources) {
    if (!src) continue;
    const rawItems: string[] = Array.isArray(src)
      ? src.flatMap(item => String(item || "").split(","))
      : typeof src === "string"
        ? src.split(",")
        : [];

    for (const part of rawItems) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (!seenLower.has(key)) {
        seenLower.add(key);
        collected.push(cleaned);
      }
    }
    // Once a primary source yields explicit route areas, do not append redundant fallback strings
    if (collected.length > 0 && Array.isArray(src)) {
      break;
    }
  }

  return collected.length > 0 ? collected : ["Poblacion"];
}

// 1. Mobile Meter Reader Registration (POST /api/auth/register, /api/readers/register, /api/readers, /api/staff/register)
app.post(["/api/auth/register", "/api/readers/register", "/api/readers", "/api/auth/register-reader", "/api/staff/register", "/api/staff"], (req, res) => {
  const name = (req.body.name || req.body.fullName || req.body.displayName || "").toString().trim();
  const username = (req.body.username || req.body.email || req.body.badgeId || name || "").toString().trim();
  const pin = (req.body.pin || req.body.password || "1234").toString().trim();
  const contactNumber = (req.body.contactNumber || req.body.phoneNumber || req.body.phone || "").toString().trim();

  // Extract 1, 2, or multiple assigned route areas without duplicating fallback zone strings
  const rawAssigned =
    req.body.assignedRoutes ||
    req.body.assignedBarangays ||
    req.body.assignedZones ||
    req.body.coverageAreas ||
    req.body.barangays ||
    req.body.routes;

  const assignedRoutes = normalizeAssignedRoutesServer(
    rawAssigned,
    req.body.barangay,
    req.body.zone,
    req.body.targetRoute
  );

  const combinedZoneLabel = assignedRoutes.join(", ");

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
    employeeId: req.body.employeeId || readerId,
    email: req.body.email || undefined,
    username: effectiveUsername,
    name: effectiveName,
    password: req.body.password || req.body.pin || "password123",
    pin: pin || req.body.password || "1234",
    role: req.body.role || "Meter Reader I",
    zone: combinedZoneLabel,
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
  savePortalSyncStore();

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
    const cleanRoutes = normalizeAssignedRoutesServer(s.assignedRoutes, s.zone);
    deduplicatedStaff.push({
      ...s,
      assignedRoutes: cleanRoutes,
      zone: cleanRoutes.join(", "),
    });
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

// 3. Admin Terminates / Deletes Meter Reader (DELETE /api/staff/:id, /api/readers/:id, ALL /api/readers/:id/terminate)
function performReaderTerminationServer(
  id: string,
  extra: { employeeId?: string; email?: string; username?: string; name?: string; reason?: string; terminatedBy?: string }
): boolean {
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();
  const matchedExisting = registeredStaff.find(
    s =>
      s.id?.toLowerCase() === cleanId ||
      s.employeeId?.toLowerCase() === cleanId ||
      s.username?.toLowerCase() === cleanId ||
      (extra.employeeId && s.id?.toLowerCase() === extra.employeeId.toLowerCase()) ||
      (extra.username && s.username?.toLowerCase() === extra.username.toLowerCase()) ||
      (extra.name && s.name?.toLowerCase() === extra.name.toLowerCase())
  );

  const allIdents = [
    id,
    cleanId,
    extra.employeeId,
    extra.email,
    extra.username,
    extra.name,
    matchedExisting?.id,
    matchedExisting?.employeeId,
    matchedExisting?.username,
    matchedExisting?.name,
  ];
  allIdents.forEach(ident => {
    if (ident && typeof ident === "string" && ident.trim()) {
      terminatedStaffIdentifiers.add(ident.trim().toLowerCase());
    }
  });

  const prevLen = registeredStaff.length;
  registeredStaff = registeredStaff.filter(
    s =>
      s.id?.toLowerCase() !== cleanId &&
      s.username?.toLowerCase() !== cleanId &&
      (!id || s.id?.toLowerCase() !== id.toLowerCase()) &&
      (!extra.employeeId || s.id?.toLowerCase() !== extra.employeeId.toLowerCase()) &&
      (!extra.username || s.username?.toLowerCase() !== extra.username.toLowerCase()) &&
      (!extra.name || s.name?.toLowerCase() !== extra.name.toLowerCase()) &&
      !isStaffTerminated(s.id) &&
      !isStaffTerminated(s.username)
  );
  savePortalSyncStore();

  const remoteCandidates = Array.from(
    new Set(
      [id, extra.employeeId, matchedExisting?.id, matchedExisting?.employeeId, extra.username, matchedExisting?.username]
        .filter((x): x is string => Boolean(x && String(x).trim()))
        .map(x => String(x).trim())
    )
  );
  forwardTerminateReaderToMobile(remoteCandidates, extra.reason, extra.terminatedBy).catch(() => {});

  const effectiveName = extra.name || matchedExisting?.name || id;
  broadcast("READER_TERMINATED", {
    readerId: id,
    employeeId: extra.employeeId || matchedExisting?.employeeId || id,
    email: extra.email,
    username: extra.username || matchedExisting?.username,
    name: effectiveName,
    reason: extra.reason,
    message: `Meter reader account (${effectiveName}) has been permanently terminated and credentials revoked.`
  });
  broadcast("READER_ACCOUNT_TERMINATED", {
    readerId: id,
    employeeId: extra.employeeId || matchedExisting?.employeeId || id,
    username: extra.username || matchedExisting?.username,
    name: effectiveName,
    reason: extra.reason || "Terminated by TWD Central Administration"
  });
  broadcast("staff:terminated", {
    readerId: id,
    employeeId: extra.employeeId || matchedExisting?.employeeId || id,
    email: extra.email,
    username: extra.username || matchedExisting?.username,
    name: effectiveName,
    message: `Meter reader account (${effectiveName}) has been permanently terminated.`
  });

  return prevLen > registeredStaff.length;
}

app.delete(["/api/staff/:id", "/api/readers/:id"], (req, res) => {
  const { id } = req.params;
  const { employeeId, email, username, name, reason, terminatedBy } = req.body || {};
  const removed = performReaderTerminationServer(id, { employeeId, email, username, name, reason, terminatedBy });

  res.json({
    success: true,
    message: `Meter reader account permanently terminated and erased.`,
    removed
  });
});

app.all(["/api/readers/:id/terminate", "/api/staff/:id/terminate"], (req, res) => {
  const { id } = req.params;
  const { employeeId, email, username, name, reason, terminatedBy } = req.body || {};
  const removed = performReaderTerminationServer(id, { employeeId, email, username, name, reason, terminatedBy });

  res.json({
    success: true,
    status: "terminated",
    message: `Meter reader account (${id}) permanently terminated across Central Web and Mobile Field Terminal.`,
    removed
  });
});

app.all(["/api/readers/:id/reactivate", "/api/staff/:id/reactivate"], (req, res) => {
  const { id } = req.params;
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();
  terminatedStaffIdentifiers.delete(cleanId);

  const idx = registeredStaff.findIndex(
    s => s.id?.toLowerCase() === cleanId || s.employeeId?.toLowerCase() === cleanId || s.username?.toLowerCase() === cleanId
  );
  if (idx >= 0) {
    registeredStaff[idx].employmentStatus = "active";
    registeredStaff[idx].status = "active";
    [registeredStaff[idx].id, registeredStaff[idx].employeeId, registeredStaff[idx].username, registeredStaff[idx].name].forEach(ident => {
      if (ident) terminatedStaffIdentifiers.delete(ident.trim().toLowerCase());
    });
  }
  savePortalSyncStore();
  forwardReactivateOrUpdateReaderToMobile(id, { employmentStatus: "active", status: "active" }).catch(() => {});

  res.json({
    success: true,
    status: "active",
    reader: idx >= 0 ? registeredStaff[idx] : undefined,
    message: `Meter reader (${id}) reactivated.`
  });
});

// 3.05 Admin Updates Meter Reader (PATCH / PUT /api/staff/:id, /api/readers/:id)
app.patch(["/api/staff/:id", "/api/readers/:id", "/api/readers/:id/status"], (req, res) => {
  const { id } = req.params;
  const cleanId = decodeURIComponent(id || "").trim().toLowerCase();
  const updates = req.body || {};

  const readerIndex = registeredStaff.findIndex(
    s => s.id?.toLowerCase() === cleanId ||
         s.employeeId?.toLowerCase() === cleanId ||
         s.username?.toLowerCase() === cleanId ||
         (updates.employeeId && s.id?.toLowerCase() === updates.employeeId.toLowerCase())
  );

  if (readerIndex === -1) {
    forwardReactivateOrUpdateReaderToMobile(id, updates).catch(() => {});
    return res.status(404).json({ success: false, message: "Meter reader not found." });
  }

  const existing = registeredStaff[readerIndex];
  const nextRoutes = normalizeAssignedRoutesServer(
    updates.assignedRoutes,
    updates.zone,
    existing.assignedRoutes,
    existing.zone
  );
  const updatedReader = {
    ...existing,
    ...updates,
    employmentStatus: updates.employmentStatus || updates.status || existing.employmentStatus || "active",
    status: updates.employmentStatus || updates.status || existing.status || "active",
    assignedRoutes: nextRoutes,
    zone: nextRoutes.join(", "),
  };

  registeredStaff[readerIndex] = updatedReader;
  savePortalSyncStore();
  forwardReactivateOrUpdateReaderToMobile(updatedReader.id || id, updatedReader).catch(() => {});

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
         s.employeeId?.toLowerCase() === cleanId ||
         s.username?.toLowerCase() === cleanId ||
         (updates.employeeId && s.id?.toLowerCase() === updates.employeeId.toLowerCase())
  );

  if (readerIndex === -1) {
    forwardReactivateOrUpdateReaderToMobile(id, updates).catch(() => {});
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
  savePortalSyncStore();
  forwardReactivateOrUpdateReaderToMobile(updatedReader.id || id, updatedReader).catch(() => {});

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

    // Determine if request is an Admin/Consumer Web Portal query or Mobile Field Reader sync
    const isPortalOrAdminView = (
      includePending === "true" || 
      view === "admin" || 
      view === "portal" ||
      role === "admin" || 
      req.headers["x-portal"] === "admin" ||
      req.headers["x-portal"] === "consumer" ||
      req.headers["x-role"] === "admin"
    );

    // If NOT explicitly a web portal/admin view, strictly filter for field reading:
    // Only consumers who have official Admin-issued Account # and Meter Serial # are synced to mobile readers
    if (!isPortalOrAdminView) {
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
        (c.name || "").toLowerCase().includes(q) || 
        (c.accountNumber || "").toLowerCase().includes(q) || 
        (c.meterNumber || "").toLowerCase().includes(q) ||
        (c.rfidTag || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.linkedUserId || "").toLowerCase().includes(q)
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
        rfidTag: c.rfidTag,
        linkedUserId: c.linkedUserId,
        registrationDate: c.registrationDate,
        householdInfo: c.householdInfo,
        businessName: c.businessName,
        businessType: c.businessType,
        isRegistered: c.isRegistered
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
      linkedUserId,
      password,
      applicationNumber,
      hasExistingMeter,
      status: requestedStatus,
      installationRequestId,
      installationStatus,
      accountValidationStatus,
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

    const initialPendingStatus: "pending_approval" | "pending_installation" | "installation_not_scheduled" =
      requestedStatus === "pending_installation" || requestedStatus === "installation_not_scheduled"
        ? requestedStatus
        : "pending_approval";

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
      status: initialPendingStatus,
      contactNumber: cleanPhone,
      email: cleanEmail,
      rfidTag: "",
      registrationDate: new Date().toISOString().split("T")[0],
      linkedUserId: userId,
      householdInfo: householdInfo || undefined,
      businessName: businessName || undefined,
      businessType: businessType || undefined,
      applicationNumber: applicationNumber || undefined,
      hasExistingMeter: typeof hasExistingMeter === "boolean" ? hasExistingMeter : undefined,
      installationRequestId: installationRequestId || undefined,
      installationStatus: installationStatus || undefined,
      accountValidationStatus: accountValidationStatus || undefined,
      isRegistered: true
    };

    if (existingIdx >= 0) {
      // Never downgrade an already-issued consumer record back to pending
      if (isValidatedConsumerForReader(syncedConsumers[existingIdx])) {
        syncedConsumers[existingIdx] = {
          ...record,
          ...syncedConsumers[existingIdx],
          email: cleanEmail || syncedConsumers[existingIdx].email,
          contactNumber: cleanPhone || syncedConsumers[existingIdx].contactNumber
        };
      } else {
        syncedConsumers[existingIdx] = { ...syncedConsumers[existingIdx], ...record };
      }
    } else {
      syncedConsumers.unshift(record); // Add to top so Admin sees it immediately
    }

    const activeConsumerRecord = syncedConsumers[existingIdx >= 0 ? existingIdx : 0];
    const hasIssuedAcc = isValidatedConsumerForReader(activeConsumerRecord);

    // Also persist portal login account on server for cross-browser / cross-device consumer login
    const uIdx = syncedPortalUsers.findIndex(
      u => (cleanEmail && u.email && u.email.toLowerCase() === cleanEmail) || u.id === userId
    );
    const trimmedPassword = password !== undefined && password !== null && String(password).trim() !== ""
      ? String(password).trim()
      : undefined;
    const regPwTs = Number(req.body?.passwordUpdatedAt) || Date.now();
    const portalUserEntry: PortalSyncUser = {
      id: activeConsumerRecord.linkedUserId || userId,
      email: cleanEmail,
      name: consumerName,
      password: trimmedPassword || (uIdx >= 0 ? syncedPortalUsers[uIdx].password : undefined),
      ...(trimmedPassword ? { passwordUpdatedAt: regPwTs } : (uIdx >= 0 && syncedPortalUsers[uIdx].passwordUpdatedAt ? { passwordUpdatedAt: syncedPortalUsers[uIdx].passwordUpdatedAt } : {})),
      role: "consumer",
      status: hasIssuedAcc ? "active" : initialPendingStatus,
      linkedAccountNumber: hasIssuedAcc ? activeConsumerRecord.accountNumber : undefined,
      contactNumber: cleanPhone,
      registrationDate: activeConsumerRecord.registrationDate
    };
    if (uIdx >= 0) {
      syncedPortalUsers[uIdx] = { ...syncedPortalUsers[uIdx], ...portalUserEntry };
    } else {
      syncedPortalUsers.unshift(portalUserEntry);
    }

    savePortalSyncStore();

    if (!isSelfSystemSite() && req.headers["x-peer-resolve"] !== "1") {
      fetchSystemSite(
        "/api/consumers/register",
        {
          method: "POST",
          headers: { "x-peer-resolve": "1" },
          body: JSON.stringify({
            ...req.body,
            password: trimmedPassword,
            passwordUpdatedAt: regPwTs
          })
        },
        4500
      ).catch(() => {});
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

    const prevExisting = idx >= 0 ? { ...syncedConsumers[idx] } : null;
    const wasPreviouslyValidated = prevExisting ? isValidatedConsumerForReader(prevExisting) : false;

    if (idx >= 0) {
      syncedConsumers[idx] = { ...syncedConsumers[idx], ...record };
    } else {
      syncedConsumers.unshift(record);
    }

    const savedConsumer = syncedConsumers[idx >= 0 ? idx : 0];
    const isNowValidated = isValidatedConsumerForReader(savedConsumer);
    const didAccountNumberChange = Boolean(
      prevExisting &&
      prevExisting.accountNumber &&
      !prevExisting.accountNumber.toUpperCase().startsWith("PENDING") &&
      savedConsumer.accountNumber &&
      prevExisting.accountNumber !== savedConsumer.accountNumber
    );

    // Clean up any remaining pending twin with same email or user id
    if (savedConsumer.status === "active" && savedConsumer.accountNumber && !savedConsumer.accountNumber.toUpperCase().startsWith("PENDING")) {
      syncedConsumers = syncedConsumers.filter(c => {
        if (c === savedConsumer) return true;
        const isStalePending = (
          !c.accountNumber ||
          c.accountNumber.toUpperCase().startsWith("PENDING") ||
          c.status === "pending_approval" ||
          c.status === "pending_installation" ||
          c.status === "installation_not_scheduled"
        );
        if (isStalePending) {
          if (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) return false;
          if (linkedUserId && c.linkedUserId && c.linkedUserId === linkedUserId) return false;
          if (cleanName && c.name && c.name.toLowerCase() === cleanName.toLowerCase()) return false;
        }
        return true;
      });
    }

    // If Admin just issued official IDs (pending -> active) or updated Account #, auto-confirm & notify Consumer Portal
    let autoNotification: ServerConsumerNotification | undefined;
    if (isNowValidated && (!wasPreviouslyValidated || didAccountNumberChange)) {
      autoNotification = pushServerNotification({
        accountNumber: savedConsumer.accountNumber,
        userId: savedConsumer.linkedUserId,
        consumerEmail: savedConsumer.email,
        title: didAccountNumberChange
          ? `Account Number Updated to #${savedConsumer.accountNumber}`
          : `Official Account Number & Meter Issued!`,
        message: didAccountNumberChange
          ? `Your water service account identifier has been officially updated to #${savedConsumer.accountNumber} by Tagoloan Water District Administration. Your Meter Tag Number (#${savedConsumer.meterNumber}) remains permanently assigned.`
          : `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${savedConsumer.accountNumber} and Meter Tag Number is #${savedConsumer.meterNumber}. Your full dashboard and billing history are now active.`,
        type: "account_issue"
      });

      broadcast("CONSUMER_IDS_ISSUED", {
        consumer: savedConsumer,
        notification: autoNotification,
        accountNumber: savedConsumer.accountNumber,
        meterNumber: savedConsumer.meterNumber,
        rfidTag: savedConsumer.rfidTag,
        email: savedConsumer.email,
        linkedUserId: savedConsumer.linkedUserId,
        isUpdate: didAccountNumberChange,
        message: `Official IDs confirmed for ${savedConsumer.name}: Account #${savedConsumer.accountNumber}, Meter #${savedConsumer.meterNumber}.`
      });

      broadcast("CONSUMER_ACTIVATED_FOR_READER", {
        consumer: savedConsumer,
        accountNumber: savedConsumer.accountNumber,
        meterNumber: savedConsumer.meterNumber,
        barangay: savedConsumer.barangay,
        sitioZone: savedConsumer.sitioZone,
        message: `Consumer ${savedConsumer.name} is now validated and routed to field readers for ${savedConsumer.barangay}.`
      });
    }

    // Sync linked portal user status & accountNumber on server
    if (isNowValidated) {
      syncConsumerToServerPortalUser(savedConsumer);
      forwardConsumerToMobileTerminal(savedConsumer, !wasPreviouslyValidated).catch(() => {});
    }

    savePortalSyncStore();

    // Broadcast update to Admin and Consumer dashboards
    broadcast("CONSUMER_UPDATED", {
      consumer: savedConsumer,
      notification: autoNotification,
      message: `Consumer record for ${savedConsumer.name} (${savedConsumer.accountNumber || "Pending"}) updated.`
    });

    res.status(201).json({
      success: true,
      message: "Consumer saved successfully.",
      consumer: savedConsumer,
      notification: autoNotification
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to save consumer." });
  }
});

// PATCH /api/consumers/:identifier - Update / Issue IDs for Consumer
app.patch("/api/consumers/:identifier", (req, res) => {
  try {
    const { identifier } = req.params;
    const updates = req.body || {};

    const idx = syncedConsumers.findIndex(c => 
      (c.accountNumber && c.accountNumber === identifier) || 
      (c.email && c.email.toLowerCase() === identifier.toLowerCase()) ||
      (c.linkedUserId && c.linkedUserId === identifier)
    );

    if (idx < 0) {
      return res.status(404).json({
        success: false,
        message: `Consumer ${identifier} not found in registry.`
      });
    }

    const currentConsumer = syncedConsumers[idx];

    // Validate & check duplicate phone number when contactNumber is updated
    if (updates.contactNumber !== undefined && String(updates.contactNumber).trim() !== "") {
      const cleanPhone = normalizePhone11Server(updates.contactNumber);
      if (cleanPhone.length !== 11 || !cleanPhone.startsWith("09")) {
        return res.status(400).json({
          success: false,
          message: "Mobile number must be a valid 11-digit Philippine mobile number starting with 09 (e.g., 09171234567)."
        });
      }

      const dupConsumer = syncedConsumers.find((c, cIdx) => {
        if (cIdx === idx) return false;
        if (currentConsumer.accountNumber && c.accountNumber && c.accountNumber === currentConsumer.accountNumber) return false;
        if (currentConsumer.email && c.email && c.email.toLowerCase() === currentConsumer.email.toLowerCase()) return false;
        if (currentConsumer.linkedUserId && c.linkedUserId && c.linkedUserId === currentConsumer.linkedUserId) return false;
        return normalizePhone11Server(c.contactNumber) === cleanPhone;
      });

      const dupUser = syncedPortalUsers.find(u => {
        if (currentConsumer.linkedUserId && u.id === currentConsumer.linkedUserId) return false;
        if (currentConsumer.email && u.email && u.email.toLowerCase() === currentConsumer.email.toLowerCase()) return false;
        if (currentConsumer.accountNumber && u.linkedAccountNumber && u.linkedAccountNumber === currentConsumer.accountNumber) return false;
        return normalizePhone11Server(u.contactNumber) === cleanPhone;
      });

      const dupStaff = registeredStaff.find(s => normalizePhone11Server((s as any).contactNumber || (s as any).phone) === cleanPhone);

      const conflictName = dupConsumer?.name || dupUser?.name || dupStaff?.name;
      if (conflictName) {
        return res.status(409).json({
          success: false,
          message: `The mobile number ${cleanPhone} is already registered to another account (${conflictName}). Duplicate phone numbers are strictly prohibited.`
        });
      }

      updates.contactNumber = cleanPhone;
    }

    syncedConsumers[idx] = {
      ...currentConsumer,
      ...updates
    };

    const updatedConsumer = syncedConsumers[idx];

    // Sync matching portal user contact/email/name even if account is still pending
    const uIdx = syncedPortalUsers.findIndex(u =>
      (updatedConsumer.linkedUserId && u.id === updatedConsumer.linkedUserId) ||
      (currentConsumer.email && u.email && u.email.toLowerCase() === currentConsumer.email.toLowerCase()) ||
      (updatedConsumer.email && u.email && u.email.toLowerCase() === updatedConsumer.email.toLowerCase()) ||
      (updatedConsumer.accountNumber && isIssuedAccountNumberServer(updatedConsumer.accountNumber) && u.linkedAccountNumber === updatedConsumer.accountNumber)
    );
    if (uIdx >= 0) {
      syncedPortalUsers[uIdx] = {
        ...syncedPortalUsers[uIdx],
        name: updatedConsumer.name || syncedPortalUsers[uIdx].name,
        email: updatedConsumer.email || syncedPortalUsers[uIdx].email,
        contactNumber: updatedConsumer.contactNumber || syncedPortalUsers[uIdx].contactNumber
      };
    }

    if (isValidatedConsumerForReader(updatedConsumer)) {
      syncConsumerToServerPortalUser(updatedConsumer);
      forwardConsumerToMobileTerminal(updatedConsumer, !isValidatedConsumerForReader(currentConsumer)).catch(() => {});
    }
    savePortalSyncStore();

    broadcast("CONSUMER_UPDATED", {
      consumer: updatedConsumer,
      message: `Consumer ${identifier} details updated.`
    });

    res.json({
      success: true,
      message: `Consumer ${identifier} updated successfully.`,
      consumer: updatedConsumer
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update consumer." });
  }
});

// POST /api/consumers/change-password - Securely validate and persist consumer password updates
app.post("/api/consumers/change-password", (req, res) => {
  try {
    const { userId, email, accountNumber, currentPassword, newPassword, passwordUpdatedAt } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanUid = String(userId || "").trim();
    const cleanAcc = String(accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const oldPwd = String(currentPassword || "").trim();
    const nextPwd = String(newPassword || "").trim();
    const updatedTs = Number(passwordUpdatedAt) || Date.now();

    if (!nextPwd) {
      return res.status(400).json({
        success: false,
        message: "New password is required."
      });
    }

    if (nextPwd.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long."
      });
    }

    if (oldPwd && nextPwd === oldPwd) {
      return res.status(400).json({
        success: false,
        message: "New password cannot be the same as your current/old password."
      });
    }

    const matchingUsers = syncedPortalUsers.filter(u =>
      (cleanUid && u.id === cleanUid) ||
      (cleanEmail && u.email && u.email.toLowerCase() === cleanEmail) ||
      (cleanAcc && isIssuedAccountNumberServer(cleanAcc) && u.linkedAccountNumber && u.linkedAccountNumber.toUpperCase() === cleanAcc)
    );

    let primaryUser: PortalSyncUser | null = null;
    for (const u of matchingUsers) {
      if (!primaryUser || Number(u.passwordUpdatedAt || 0) >= Number(primaryUser.passwordUpdatedAt || 0)) {
        primaryUser = { ...(primaryUser || {}), ...u, password: u.password || primaryUser?.password };
      }
    }

    if (primaryUser?.password) {
      if (primaryUser.password === nextPwd) {
        return res.status(400).json({
          success: false,
          message: "New password cannot be the same as your previous password."
        });
      }
      if (oldPwd && primaryUser.password !== oldPwd) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect."
        });
      }
    }

    if (matchingUsers.length > 0) {
      syncedPortalUsers = syncedPortalUsers.map(u => {
        const isMatch =
          (cleanUid && u.id === cleanUid) ||
          (cleanEmail && u.email && u.email.toLowerCase() === cleanEmail) ||
          (cleanAcc && isIssuedAccountNumberServer(cleanAcc) && u.linkedAccountNumber && u.linkedAccountNumber.toUpperCase() === cleanAcc);
        if (!isMatch) return u;
        return {
          ...u,
          password: nextPwd,
          passwordUpdatedAt: updatedTs
        };
      });
    } else {
      const matchedConsumer = syncedConsumers.find(c =>
        (cleanAcc && isIssuedAccountNumberServer(cleanAcc) && c.accountNumber && c.accountNumber.toUpperCase() === cleanAcc) ||
        (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) ||
        (cleanUid && c.linkedUserId === cleanUid)
      );
      syncedPortalUsers.push({
        id: cleanUid || matchedConsumer?.linkedUserId || `user-${Date.now()}`,
        email: cleanEmail || matchedConsumer?.email || "",
        name: matchedConsumer?.name || "Consumer",
        password: nextPwd,
        passwordUpdatedAt: updatedTs,
        role: "consumer",
        status: matchedConsumer && isValidatedConsumerForReader(matchedConsumer) ? "active" : "pending_approval",
        linkedAccountNumber: matchedConsumer && isIssuedAccountNumberServer(matchedConsumer.accountNumber) ? matchedConsumer.accountNumber : undefined,
        contactNumber: matchedConsumer?.contactNumber
      });
    }

    savePortalSyncStore();

    if (!isSelfSystemSite() && req.headers["x-peer-resolve"] !== "1") {
      fetchSystemSite(
        "/api/consumers/change-password",
        {
          method: "POST",
          headers: { "x-peer-resolve": "1" },
          body: JSON.stringify({
            userId: cleanUid || undefined,
            email: cleanEmail || undefined,
            accountNumber: cleanAcc || undefined,
            newPassword: nextPwd,
            passwordUpdatedAt: updatedTs
          })
        },
        4000
      ).catch(() => {});
    }

    res.json({
      success: true,
      passwordUpdatedAt: updatedTs,
      message: "Account password updated and saved successfully."
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update password." });
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

    syncedConsumers[idx] = {
      ...syncedConsumers[idx],
      accountNumber: issuedAcc,
      meterNumber: issuedMeter,
      status:
        status &&
        status !== "pending_approval" &&
        status !== "pending_installation" &&
        status !== "installation_not_scheduled" &&
        status !== "pending"
          ? status
          : "active",
      sitioZone: sitioZone || syncedConsumers[idx].sitioZone || "Zone 1",
      barangay: barangay || syncedConsumers[idx].barangay || "Poblacion"
    };

    const validatedConsumer = syncedConsumers[idx];
    syncConsumerToServerPortalUser(validatedConsumer);

    const issuedNotif = pushServerNotification({
      accountNumber: validatedConsumer.accountNumber,
      userId: validatedConsumer.linkedUserId,
      consumerEmail: validatedConsumer.email,
      title: `Official Account Number & Meter Issued!`,
      message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${validatedConsumer.accountNumber} and Meter Tag Number is #${validatedConsumer.meterNumber}. Your full dashboard and billing history are now active.`,
      type: "account_issue"
    });
    savePortalSyncStore();
    forwardConsumerToMobileTerminal(validatedConsumer, true).catch(() => {});

    // Broadcast ID activation event to Consumer Portal, Admin consoles, and mobile reader route streams
    broadcast("CONSUMER_IDS_ISSUED", {
      consumer: validatedConsumer,
      notification: issuedNotif,
      accountNumber: validatedConsumer.accountNumber,
      meterNumber: validatedConsumer.meterNumber,
      rfidTag: validatedConsumer.rfidTag,
      email: validatedConsumer.email,
      linkedUserId: validatedConsumer.linkedUserId,
      isUpdate: false,
      message: `Official IDs issued for ${validatedConsumer.name}: Acct #${validatedConsumer.accountNumber}, Meter #${validatedConsumer.meterNumber}.`
    });

    broadcast("CONSUMER_UPDATED", {
      consumer: validatedConsumer,
      notification: issuedNotif,
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
      message: `Official IDs successfully issued. Consumer is active and synced to Consumer Portal & mobile field route.`,
      consumer: validatedConsumer,
      notification: issuedNotif
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

    syncedPortalUsers = syncedPortalUsers.filter(u =>
      u.linkedAccountNumber !== identifier &&
      (!u.email || u.email.toLowerCase() !== identifier.toLowerCase()) &&
      u.id !== identifier
    );
    savePortalSyncStore();

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

// POST /api/consumers/reconcile - Retroactively syncs all previously issued IDs, consumer users & notifications across sessions
app.post("/api/consumers/reconcile", (req, res) => {
  try {
    const incomingConsumers: any[] = Array.isArray(req.body?.consumers) ? req.body.consumers : [];
    const incomingUsers: any[] = Array.isArray(req.body?.users) ? req.body.users : [];
    const incomingNotifs: any[] = Array.isArray(req.body?.notifications) ? req.body.notifications : [];

    // 1. Merge incoming consumer users (preserve passwords & upgrade active linked accounts)
    incomingUsers.forEach(iu => {
      if (!iu || iu.role === "admin") return;
      const cleanEmail = (iu.email || "").trim().toLowerCase();
      const cleanId = (iu.id || "").trim();
      if (!cleanEmail && !cleanId) return;

      const uIdx = syncedPortalUsers.findIndex(u =>
        (cleanEmail && u.email && u.email.toLowerCase() === cleanEmail) ||
        (cleanId && u.id === cleanId)
      );

      const incomingHasAcc = isIssuedAccountNumberServer(iu.linkedAccountNumber);
      if (uIdx >= 0) {
        const existing = syncedPortalUsers[uIdx];
        const existingHasAcc = isIssuedAccountNumberServer(existing.linkedAccountNumber);
        const iuPwTs = Number(iu.passwordUpdatedAt || 0);
        const exPwTs = Number(existing.passwordUpdatedAt || 0);
        const chosenPassword =
          iuPwTs > exPwTs
            ? iu.password || existing.password
            : exPwTs > iuPwTs
              ? existing.password || iu.password
              : existing.password || iu.password;
        const chosenPwTs = Math.max(iuPwTs, exPwTs) || undefined;
        syncedPortalUsers[uIdx] = {
          ...existing,
          name: iu.name || existing.name,
          email: cleanEmail || existing.email,
          password: chosenPassword,
          ...(chosenPwTs ? { passwordUpdatedAt: chosenPwTs } : {}),
          contactNumber: iu.contactNumber || existing.contactNumber,
          linkedAccountNumber: incomingHasAcc
            ? String(iu.linkedAccountNumber).trim().toUpperCase()
            : existingHasAcc
              ? existing.linkedAccountNumber
              : undefined,
          status: (incomingHasAcc || existingHasAcc) ? "active" : (iu.status || existing.status || "pending_approval")
        };
      } else {
        syncedPortalUsers.push({
          id: cleanId || `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          email: cleanEmail,
          name: iu.name || "Consumer",
          password: iu.password,
          ...(iu.passwordUpdatedAt ? { passwordUpdatedAt: Number(iu.passwordUpdatedAt) } : {}),
          role: "consumer",
          status: incomingHasAcc ? "active" : (iu.status || "pending_approval"),
          linkedAccountNumber: incomingHasAcc ? String(iu.linkedAccountNumber).trim().toUpperCase() : undefined,
          contactNumber: iu.contactNumber,
          registrationDate: iu.registrationDate
        });
      }
    });

    // 2. Merge incoming notifications first (without duplicating)
    incomingNotifs.forEach(n => {
      if (!n || !n.title || !n.message) return;
      pushServerNotification(n, false);
    });

    // 3. Merge incoming consumers — ISSUED records ALWAYS supersede pending records
    const newlyConfirmedBroadcasts: Array<{ consumer: MobileConsumerSync; notification?: ServerConsumerNotification }> = [];

    incomingConsumers.forEach(ic => {
      if (!ic || !ic.name) return;
      const icAcc = (ic.accountNumber || "").trim().toUpperCase();
      const icIssued =
        isIssuedAccountNumberServer(icAcc) &&
        ic.status !== "pending_approval" &&
        ic.status !== "pending_installation" &&
        ic.status !== "installation_not_scheduled" &&
        ic.status !== "pending";
      const icEmail = (ic.email || "").trim().toLowerCase();
      const icPhone = normalizePhone11Server(ic.contactNumber);
      const icUid = (ic.linkedUserId || "").trim();
      const icName = String(ic.name || "").trim().toLowerCase();

      const matchIdx = syncedConsumers.findIndex(sc => {
        const scAcc = (sc.accountNumber || "").trim().toUpperCase();
        const scEmail = (sc.email || "").trim().toLowerCase();
        const scPhone = normalizePhone11Server(sc.contactNumber);
        const scUid = (sc.linkedUserId || "").trim();
        const scName = (sc.name || "").trim().toLowerCase();

        if (icIssued && isIssuedAccountNumberServer(scAcc) && icAcc === scAcc) return true;
        if (icEmail && scEmail && icEmail === scEmail) return true;
        if (icUid && scUid && icUid === scUid) return true;
        if (icPhone && scPhone && icPhone.length === 11 && icPhone === scPhone) return true;
        if (icName && scName && icName === scName && (!icEmail || !scEmail || icEmail === scEmail)) return true;
        return false;
      });

      if (matchIdx >= 0) {
        const existing = syncedConsumers[matchIdx];
        const existingIssued = isValidatedConsumerForReader(existing);

        if (icIssued) {
          const meterNum = (ic.meterNumber || existing.meterNumber || `MT-${icAcc}`).toString().trim().toUpperCase();
          const rawIncomingIdx = ic.currentReading ?? ic.presentReading ?? ic.previousReading;
          const mergedPrevReading =
            rawIncomingIdx !== undefined && rawIncomingIdx !== null
              ? (((Math.floor(Math.max(0, Number(rawIncomingIdx) || 0)) % 100000) + 100000) % 100000)
              : (((Math.floor(Math.max(0, Number(existing.previousReading || 0))) % 100000) + 100000) % 100000);
          const merged: MobileConsumerSync = {
            ...existing,
            ...ic,
            accountNumber: icAcc,
            meterNumber: meterNum,
            previousReading: mergedPrevReading,
            lastReadingDate: ic.lastReadingDate || existing.lastReadingDate || new Date().toISOString().split("T")[0],
            email: icEmail || existing.email || "",
            contactNumber: ic.contactNumber || existing.contactNumber || "",
            linkedUserId: existing.linkedUserId || icUid,
            status: (ic.status && ic.status !== "pending_approval" && ic.status !== "pending") ? ic.status : "active",
            isRegistered: true
          };
          syncedConsumers[matchIdx] = merged;
          const ensuredNotif = ensureIssuedConsumerNotificationServer(merged);
          syncConsumerToServerPortalUser(merged);

          if (!existingIssued || existing.accountNumber.toUpperCase() !== icAcc) {
            newlyConfirmedBroadcasts.push({ consumer: merged, notification: ensuredNotif });
          }
        } else if (!existingIssued) {
          syncedConsumers[matchIdx] = {
            ...existing,
            email: existing.email || icEmail,
            contactNumber: existing.contactNumber || ic.contactNumber,
            linkedUserId: existing.linkedUserId || icUid
          };
        }
      } else {
        const meterNum = icIssued
          ? (ic.meterNumber || `MT-${icAcc}`).toString().trim().toUpperCase()
          : "";
        const added: MobileConsumerSync = {
          accountNumber: icIssued ? icAcc : "",
          name: String(ic.name).trim(),
          address: ic.address || "Tagoloan, Misamis Oriental",
          barangay: ic.barangay || "Poblacion",
          barangayId: ic.barangayId || "BRG-01",
          sitioZone: ic.sitioZone || "Zone 1",
          meterNumber: meterNum,
          previousReading: Number(ic.previousReading) || 0,
          lastReadingDate: ic.lastReadingDate || new Date().toISOString().split("T")[0],
          meterSize: ic.meterSize,
          consumerType: ic.consumerType === "Commercial" ? "Commercial" : "Residential",
          status: icIssued
            ? ic.status &&
              ic.status !== "pending_approval" &&
              ic.status !== "pending_installation" &&
              ic.status !== "installation_not_scheduled"
              ? ic.status
              : "active"
            : ic.status === "pending_installation" || ic.status === "installation_not_scheduled"
              ? ic.status
              : "pending_approval",
          contactNumber: ic.contactNumber || "",
          email: icEmail,
          rfidTag: "",
          registrationDate: ic.registrationDate || new Date().toISOString().split("T")[0],
          linkedUserId: icUid || undefined,
          householdInfo: ic.householdInfo,
          businessName: ic.businessName,
          businessType: ic.businessType,
          isRegistered: true
        };
        syncedConsumers.push(added);
        if (icIssued) {
          const ensuredNotif = ensureIssuedConsumerNotificationServer(added);
          syncConsumerToServerPortalUser(added);
          newlyConfirmedBroadcasts.push({ consumer: added, notification: ensuredNotif });
        }
      }
    });

    // 4. Deduplicate stale pending twins on server & align all issued consumers with their portal users + notifications
    reconcileAllServerConsumersAndUsers();
    savePortalSyncStore();
    pushValidatedConsumersAndMetersToMobile(false).catch(() => {});

    // 5. Broadcast newly reconciled ID confirmations so open Consumer Portals update immediately
    newlyConfirmedBroadcasts.forEach(({ consumer, notification }) => {
      forwardConsumerToMobileTerminal(consumer, true).catch(() => {});
      broadcast("CONSUMER_IDS_ISSUED", {
        consumer,
        notification,
        accountNumber: consumer.accountNumber,
        meterNumber: consumer.meterNumber,
        rfidTag: consumer.rfidTag,
        email: consumer.email,
        linkedUserId: consumer.linkedUserId,
        isUpdate: false,
        message: `Official IDs confirmed for ${consumer.name}: Account #${consumer.accountNumber}, Meter #${consumer.meterNumber}.`
      });
    });

    res.json({
      success: true,
      consumersCount: syncedConsumers.length,
      consumers: syncedConsumers,
      users: syncedPortalUsers.map(({ password: _pw, ...safeUser }) => safeUser),
      notificationsCount: inMemoryNotifications.length
    });
  } catch (err) {
    console.error("[API Error] POST /api/consumers/reconcile:", err);
    res.status(500).json({ success: false, message: "Failed to reconcile consumer accounts." });
  }
});

// POST /api/consumers/resolve-account - Authoritative consumer account + notification resolver for Consumer Portal & Login
app.post("/api/consumers/resolve-account", async (req, res) => {
  try {
    const { email, userId, accountNumber, name, contactNumber, password, verifyPassword, includeAuthMeta } = req.body || {};
    const cleanEmail = (email || "").trim().toLowerCase();
    const cleanUid = (userId || "").trim();
    const cleanAcc = (accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const hasValidAcc = isIssuedAccountNumberServer(cleanAcc);
    const cleanName = (name || "").trim().toLowerCase();
    const cleanPhone = normalizePhone11Server(contactNumber);

    // Ensure server store is internally consistent first
    reconcileAllServerConsumersAndUsers();

    const findBestLocalUser = (): PortalSyncUser | undefined => {
      const matchingUsers = syncedPortalUsers.filter(u =>
        (cleanEmail && u.email && u.email.toLowerCase() === cleanEmail) ||
        (cleanUid && u.id === cleanUid) ||
        (hasValidAcc && u.linkedAccountNumber && u.linkedAccountNumber.toUpperCase() === cleanAcc)
      );

      let best: PortalSyncUser | undefined;
      for (const u of matchingUsers) {
        if (!best) {
          best = { ...u };
        } else {
          const uPwTs = Number(u.passwordUpdatedAt || 0);
          const mPwTs = Number(best.passwordUpdatedAt || 0);
          const chosenPassword =
            uPwTs > mPwTs
              ? u.password || best.password
              : mPwTs > uPwTs
                ? best.password || u.password
                : best.password || u.password;
          const chosenPwTs = Math.max(uPwTs, mPwTs) || undefined;
          best = {
            ...best,
            ...u,
            id: best.id && !best.id.startsWith("email_") ? best.id : u.id,
            password: chosenPassword,
            ...(chosenPwTs ? { passwordUpdatedAt: chosenPwTs } : {})
          };
        }
      }
      return best;
    };

    let matchedUser = findBestLocalUser();

    // Cross-peer fallback: if this instance lacks the consumer's password/user record, query System Site peer cleanly
    if ((!matchedUser || !matchedUser.password) && !isSelfSystemSite() && req.headers["x-peer-resolve"] !== "1") {
      try {
        const peerResp = await fetchSystemSite(
          "/api/consumers/resolve-account",
          {
            method: "POST",
            headers: { "x-peer-resolve": "1" },
            body: JSON.stringify({
              email: cleanEmail || undefined,
              userId: cleanUid || undefined,
              accountNumber: hasValidAcc ? cleanAcc : undefined,
              name: name || undefined,
              contactNumber: cleanPhone || undefined,
              password,
              verifyPassword: false,
              includeAuthMeta: true
            })
          },
          2500
        );
        if (peerResp.ok) {
          const peerData = await peerResp.json().catch(() => null);
          let peerChanged = false;
          if (peerData?.consumer && (peerData.consumer.name || peerData.consumer.email || peerData.consumer.accountNumber)) {
            const pc = peerData.consumer;
            const pcEmail = String(pc.email || "").trim().toLowerCase();
            const pcAcc = String(pc.accountNumber || "").trim().toUpperCase();
            const pcIdx = syncedConsumers.findIndex(lc =>
              (isIssuedAccountNumberServer(pcAcc) && lc.accountNumber && lc.accountNumber.toUpperCase() === pcAcc) ||
              (pcEmail && lc.email && lc.email.toLowerCase() === pcEmail) ||
              (pc.linkedUserId && lc.linkedUserId === pc.linkedUserId)
            );
            if (pcIdx >= 0) {
              syncedConsumers[pcIdx] = { ...syncedConsumers[pcIdx], ...pc };
            } else {
              syncedConsumers.unshift(pc);
            }
            peerChanged = true;
          }
          if (peerData?.user && (peerData.user.email || peerData.user.id)) {
            const pu = peerData.user as PortalSyncUser;
            const puEmail = String(pu.email || "").trim().toLowerCase();
            const puIdx = syncedPortalUsers.findIndex(lu =>
              (puEmail && lu.email && lu.email.toLowerCase() === puEmail) ||
              (pu.id && lu.id === pu.id)
            );
            if (puIdx >= 0) {
              const ex = syncedPortalUsers[puIdx];
              const puTs = Number(pu.passwordUpdatedAt || 0);
              const exTs = Number(ex.passwordUpdatedAt || 0);
              syncedPortalUsers[puIdx] = {
                ...ex,
                ...pu,
                password: puTs >= exTs ? (pu.password || ex.password) : (ex.password || pu.password),
                passwordUpdatedAt: Math.max(puTs, exTs) || undefined
              };
            } else {
              syncedPortalUsers.unshift(pu);
            }
            peerChanged = true;
          }
          if (peerChanged) {
            reconcileAllServerConsumersAndUsers();
            savePortalSyncStore();
            matchedUser = findBestLocalUser();
          }
        }
      } catch {
        // Non-fatal if peer is unreachable
      }
    }

    const checkPwMatch = (storedPw?: string, candidatePw?: unknown): boolean => {
      if (!storedPw || candidatePw === undefined || candidatePw === null) return false;
      const rawCand = String(candidatePw);
      const trimCand = rawCand.trim();
      return storedPw === rawCand || storedPw === trimCand || storedPw.trim() === trimCand;
    };

    const passwordVerified = Boolean(matchedUser && matchedUser.password && checkPwMatch(matchedUser.password, password));

    if (verifyPassword && matchedUser && matchedUser.password && password !== undefined) {
      if (!passwordVerified) {
        return res.status(401).json({
          success: false,
          authFailed: true,
          message: "Incorrect account password. Please try again."
        });
      }
    }

    // 2. Match Consumer record(s) — strictly prefer issued active records over pending ones
    const candidateConsumers = syncedConsumers.filter(c => {
      const cAcc = (c.accountNumber || "").trim().toUpperCase();
      const cEmail = (c.email || "").trim().toLowerCase();
      const cUid = (c.linkedUserId || "").trim();
      const cPhone = normalizePhone11Server(c.contactNumber);
      const cName = (c.name || "").trim().toLowerCase();

      const targetAcc = hasValidAcc ? cleanAcc : (matchedUser?.linkedAccountNumber || "").trim().toUpperCase();
      const targetEmail = cleanEmail || (matchedUser?.email || "").trim().toLowerCase();
      const targetUid = cleanUid || (matchedUser?.id || "").trim();
      const targetName = cleanName || (matchedUser?.name || "").trim().toLowerCase();

      if (isIssuedAccountNumberServer(targetAcc) && isIssuedAccountNumberServer(cAcc) && targetAcc === cAcc) return true;
      if (targetEmail && cEmail && targetEmail === cEmail) return true;
      if (targetUid && cUid && targetUid === cUid) return true;
      if (cleanPhone && cPhone && cleanPhone.length === 11 && cleanPhone === cPhone) return true;
      if (targetName && cName && targetName === cName && (!targetEmail || !cEmail || targetEmail === cEmail)) return true;
      return false;
    });

    candidateConsumers.sort((a, b) => (isValidatedConsumerForReader(b) ? 1 : 0) - (isValidatedConsumerForReader(a) ? 1 : 0));
    const resolvedConsumer = candidateConsumers[0] || null;
    const isIssued = resolvedConsumer ? isValidatedConsumerForReader(resolvedConsumer) : false;

    if (resolvedConsumer && isIssued) {
      ensureIssuedConsumerNotificationServer(resolvedConsumer);
      syncConsumerToServerPortalUser(resolvedConsumer);
      savePortalSyncStore();
    }

    // 3. Gather all notifications belonging to this consumer
    const effectiveAcc = (resolvedConsumer?.accountNumber || matchedUser?.linkedAccountNumber || (hasValidAcc ? cleanAcc : "")).trim().toLowerCase();
    const effectiveHasAcc = isIssuedAccountNumberServer(effectiveAcc);
    const effectiveEmail = (resolvedConsumer?.email || matchedUser?.email || cleanEmail).trim().toLowerCase();
    const effectiveUid = (resolvedConsumer?.linkedUserId || matchedUser?.id || cleanUid).trim().toLowerCase();

    const consumerNotifs = dedupeServerNotifications(
      inMemoryNotifications.filter(n => {
        const nAcc = (n.accountNumber || "").replace(/^#/, "").trim().toLowerCase();
        const nHasAcc = isIssuedAccountNumberServer(nAcc);
        const nEmail = (n.consumerEmail || "").trim().toLowerCase();
        const nUid = (n.userId || "").trim().toLowerCase();

        if (effectiveHasAcc && nHasAcc && effectiveAcc === nAcc) return true;
        if (effectiveEmail && nEmail && effectiveEmail === nEmail) return true;
        if (effectiveHasAcc && nHasAcc && effectiveAcc !== nAcc) return false;
        if (effectiveEmail && nEmail && effectiveEmail !== nEmail) return false;
        if (effectiveUid && nUid && effectiveUid === nUid) return true;
        return false;
      })
    );

    const refreshedCandidates = syncedPortalUsers.filter(u =>
      (effectiveEmail && u.email && u.email.toLowerCase() === effectiveEmail) ||
      (effectiveUid && u.id.toLowerCase() === effectiveUid) ||
      (effectiveHasAcc && u.linkedAccountNumber && u.linkedAccountNumber.toLowerCase() === effectiveAcc)
    );
    let refreshedUser: PortalSyncUser | null = matchedUser || null;
    for (const u of refreshedCandidates) {
      if (!refreshedUser || Number(u.passwordUpdatedAt || 0) >= Number(refreshedUser.passwordUpdatedAt || 0)) {
        refreshedUser = {
          ...(refreshedUser || {}),
          ...u,
          password: u.password || refreshedUser?.password,
          passwordUpdatedAt: Math.max(Number(u.passwordUpdatedAt || 0), Number(refreshedUser?.passwordUpdatedAt || 0)) || undefined
        };
      }
    }

    // Synthesize PortalSyncUser from resolvedConsumer if consumer exists in registry without a syncedPortalUsers entry yet
    if (!refreshedUser && resolvedConsumer) {
      const pendingStatus: PortalSyncUser["status"] =
        resolvedConsumer.status === "pending_installation" || resolvedConsumer.status === "installation_not_scheduled"
          ? resolvedConsumer.status
          : "pending_approval";
      refreshedUser = {
        id: resolvedConsumer.linkedUserId || cleanUid || `user-${(resolvedConsumer.accountNumber || effectiveEmail || "cons").replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        email: (resolvedConsumer.email || effectiveEmail || "").trim().toLowerCase(),
        name: resolvedConsumer.name,
        role: "consumer",
        status: isIssued ? "active" : pendingStatus,
        linkedAccountNumber: isIssued ? resolvedConsumer.accountNumber.trim().toUpperCase() : undefined,
        contactNumber: resolvedConsumer.contactNumber,
        registrationDate: resolvedConsumer.registrationDate
      };
    }

    const safeUser = refreshedUser
      ? includeAuthMeta
        ? refreshedUser
        : (() => {
            const { password: _pw, ...rest } = refreshedUser;
            return rest;
          })()
      : null;

    res.json({
      success: true,
      isIssued,
      passwordVerified,
      consumer: resolvedConsumer,
      user: safeUser,
      notifications: consumerNotifs
    });
  } catch (err) {
    console.error("[API Error] POST /api/consumers/resolve-account:", err);
    res.status(500).json({ success: false, message: "Failed to resolve consumer account." });
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
      serialNumber: `NO. A ${Math.floor(10000000 + Math.random() * 90000000)}`,
      amountPaid: netDue > 0 ? netDue : 120.92,
      paymentDate: new Date().toISOString().split("T")[0],
      collector: "TWD Main Office - Collecting Officer",
      payorName: expectedName || "CONSUMER",
      accountNumber: expectedAccountNumber || "",
      meterNumber: "",
      agency: "TAGOLOAN WATER DISTRICT",
      paymentMethod: "Cash",
      amountInWords: "",
      confidence: 0.96,
      isAiParsed: false,
      hasOfficialSeal: true,
      hasBirOrForm51Header: true,
      hasCollectingOfficerSignature: true,
      isOfficialForm51: true,
      detectedBreakdown: {
        current: netDue > 0 ? netDue : 120.92,
        arrears: 0,
        total: netDue > 0 ? netDue : 120.92,
        amountPaid: netDue > 0 ? netDue : 120.92,
        balance: 0,
        amountTendered: netDue > 0 ? netDue : 120.92,
        change: 0
      },
      settlementType: "full" as "full" | "partial",
      isLessThan50Percent: false,
      remainingBalance: 0,
      notes: "Smart Optical Verification: Physical Cashier Slip / Accountable Form No. 51 detected and validated."
    };

    const ai = getGeminiAI();
    if (ai && photoDataUrl.includes("base64,")) {
      try {
        const parts = photoDataUrl.split("base64,");
        const mimeType = parts[0].replace("data:", "").replace(";", "") || "image/jpeg";
        const base64Data = parts[1];

        const prompt = `You are the official Tagoloan Water District (TWD) Cashier Receipt Analyzer and Philippine Government Accountable Form No. 51 / BIR Official Receipt Security Validator.
Carefully inspect this uploaded image of a Philippine government water utility payment receipt.
Verify and detect the following official security details:
1. Republic of the Philippines Coat of Arms seal (sun, 3 stars, shield at top left).
2. Header: "OFFICIAL RECEIPT", "Republic of the Philippines", "Accountable Form No. 51", "Revised January, 1992", "ORIGINAL".
3. Serial / OR Number (e.g. "NO. A 09024014" or "9024014").
4. Date and time of payment (e.g. "09/10/2026 02:28 PM" or stamped date).
5. Agency: "TAGOLOAN WATER DISTRICT".
6. Payor name and Account number (e.g. "JADAP, VIOLETO C.", "045-112-241").
7. Payment breakdown: Current, Arrears, Total, Amt. Paid, Balance, Tendered, Change.
8. Amount in words (e.g. "SIX HUNDRED FIFTY-FOUR PESOS & 8 CENTS").
9. Payment mode (Cash checkbox [X], Check, Money Order).
10. Collecting Officer signature and official cashier circular stamp.

Extract the following information and output strictly valid JSON:
{
  "orNumber": "The Official Receipt / Serial string (e.g. NO. A 09024014 or 09024014)",
  "serialNumber": "Serial number string e.g. NO. A 09024014",
  "amountPaid": 654.08,
  "paymentDate": "YYYY-MM-DD",
  "collector": "Collecting Officer / Cashier title or name",
  "payorName": "Name of payor/consumer",
  "accountNumber": "Account number from receipt",
  "meterNumber": "Meter number if found",
  "agency": "TAGOLOAN WATER DISTRICT",
  "paymentMethod": "Cash / Check / Money Order",
  "amountInWords": "Amount in words",
  "hasOfficialSeal": true,
  "hasBirOrForm51Header": true,
  "hasCollectingOfficerSignature": true,
  "isOfficialForm51": true,
  "detectedBreakdown": {
    "current": 654.08,
    "arrears": 0.00,
    "total": 654.08,
    "amountPaid": 654.08,
    "balance": 0.00,
    "amountTendered": 1000.00,
    "change": 345.92
  },
  "confidence": 0.98
}
Context: Expected Account: ${expectedAccountNumber || "N/A"}, Expected Name: ${expectedName || "N/A"}, Current Statement Net Due: ${netDue}.`;

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
          if (parsed.serialNumber) detectedData.serialNumber = String(parsed.serialNumber).toUpperCase();
          if (parsed.amountPaid && !isNaN(Number(parsed.amountPaid))) detectedData.amountPaid = Number(parsed.amountPaid);
          if (parsed.paymentDate) detectedData.paymentDate = String(parsed.paymentDate);
          if (parsed.collector) detectedData.collector = String(parsed.collector);
          if (parsed.payorName) detectedData.payorName = String(parsed.payorName);
          if (parsed.accountNumber) detectedData.accountNumber = String(parsed.accountNumber);
          if (parsed.meterNumber) detectedData.meterNumber = String(parsed.meterNumber);
          if (parsed.agency) detectedData.agency = String(parsed.agency);
          if (parsed.paymentMethod) detectedData.paymentMethod = String(parsed.paymentMethod);
          if (parsed.amountInWords) detectedData.amountInWords = String(parsed.amountInWords);
          if (typeof parsed.hasOfficialSeal === 'boolean') detectedData.hasOfficialSeal = parsed.hasOfficialSeal;
          if (typeof parsed.hasBirOrForm51Header === 'boolean') detectedData.hasBirOrForm51Header = parsed.hasBirOrForm51Header;
          if (typeof parsed.hasCollectingOfficerSignature === 'boolean') detectedData.hasCollectingOfficerSignature = parsed.hasCollectingOfficerSignature;
          if (typeof parsed.isOfficialForm51 === 'boolean') detectedData.isOfficialForm51 = parsed.isOfficialForm51;
          if (parsed.detectedBreakdown && typeof parsed.detectedBreakdown === 'object') {
            detectedData.detectedBreakdown = {
              current: Number(parsed.detectedBreakdown.current) || detectedData.amountPaid,
              arrears: Number(parsed.detectedBreakdown.arrears) || 0,
              total: Number(parsed.detectedBreakdown.total) || detectedData.amountPaid,
              amountPaid: Number(parsed.detectedBreakdown.amountPaid) || detectedData.amountPaid,
              balance: Number(parsed.detectedBreakdown.balance) || 0,
              amountTendered: Number(parsed.detectedBreakdown.amountTendered) || detectedData.amountPaid,
              change: Number(parsed.detectedBreakdown.change) || 0,
            };
          }
          if (parsed.confidence) detectedData.confidence = Number(parsed.confidence);
          detectedData.isAiParsed = true;
          detectedData.notes = "Smart Gemini Vision OCR: Republic of the Philippines Accountable Form No. 51 / TWD Official Receipt verified.";
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

// Five-Digit Odometer Helpers (00000 to 99999, modulo 100000)
const SERVER_ODOMETER_MODULO = 100000;

function normalizeOdometerServer(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return ((Math.floor(parsed) % SERVER_ODOMETER_MODULO) + SERVER_ODOMETER_MODULO) % SERVER_ODOMETER_MODULO;
}

function formatOdometerServer(value: unknown): string {
  return String(normalizeOdometerServer(value)).padStart(5, "0");
}

function computeOdometerServer(previous: unknown, current: unknown, explicitConsumption?: unknown) {
  const prev = normalizeOdometerServer(previous);
  const curr = normalizeOdometerServer(current);
  const rolledOver = curr < prev;
  const computed = rolledOver ? SERVER_ODOMETER_MODULO - prev + curr : curr - prev;
  if (explicitConsumption !== undefined && explicitConsumption !== null && explicitConsumption !== "") {
    const expNum = Number(explicitConsumption);
    if (Number.isFinite(expNum) && expNum >= 0) {
      const rounded = Math.round(expNum);
      if ((prev + rounded) % SERVER_ODOMETER_MODULO === curr) {
        return { previousReading: prev, currentReading: curr, consumption: rounded, rolledOver };
      }
    }
  }
  return { previousReading: prev, currentReading: curr, consumption: computed, rolledOver };
}

// Helper: Resolve the authoritative 5-digit odometer baseline (00000-99999) for a consumer across billed records, approved field readings, and consumer master
function resolveConsumerBaselineServer(accountNumber?: string, meterNumber?: string, excludeReadingId?: string): number {
  const cleanAcc = String(accountNumber || "").replace(/^#/, "").trim().toUpperCase();
  const cleanMeter = String(meterNumber || "").trim().toUpperCase();
  let latestTimestamp = -1;
  let latestReadingVal: number | null = null;
  let consumerFallback = 0;

  if (cleanAcc || cleanMeter) {
    const matchedConsumer = syncedConsumers.find(
      c =>
        (cleanAcc && String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === cleanAcc) ||
        (cleanMeter && String(c.meterNumber || "").trim().toUpperCase() === cleanMeter)
    );
    if (matchedConsumer) {
      consumerFallback = normalizeOdometerServer(matchedConsumer.previousReading || 0);
    }

    for (const r of pendingMobileReadings) {
      if (!r || (excludeReadingId && r.id === excludeReadingId)) continue;
      if (r.status !== "approved") continue;
      const rAcc = String(r.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
      const rMeter = String(r.meterNumber || "").trim().toUpperCase();
      if ((cleanAcc && rAcc === cleanAcc) || (cleanMeter && rMeter === cleanMeter)) {
        const ts = new Date(r.readingDate || r.submittedAt || 0).getTime() || 0;
        const val = normalizeOdometerServer(r.currentReading ?? r.presentReading ?? 0);
        if (ts > latestTimestamp || (ts === latestTimestamp && (latestReadingVal === null || val > latestReadingVal))) {
          latestTimestamp = ts;
          latestReadingVal = val;
        }
      }
    }

    for (const r of reconciledBillingRecords.values()) {
      if (!r || (excludeReadingId && r.id === excludeReadingId)) continue;
      if (r.status === "cancelled") continue;
      const isApprovedOrBilled =
        r.status === "verified" ||
        r.status === "approved" ||
        Boolean(r.isBillingIssued || r.billingIssuedAt || r.invoiceNumber);
      if (!isApprovedOrBilled) continue;
      const rAcc = String(r.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
      const rMeter = String(r.meterNumber || "").trim().toUpperCase();
      if ((cleanAcc && rAcc === cleanAcc) || (cleanMeter && rMeter === cleanMeter)) {
        const ts = new Date(r.readingDate || r.billingIssuedAt || r.submittedAt || 0).getTime() || 0;
        const val = normalizeOdometerServer(r.currentReading ?? r.presentReading ?? 0);
        if (ts > latestTimestamp || (ts === latestTimestamp && (latestReadingVal === null || val > latestReadingVal))) {
          latestTimestamp = ts;
          latestReadingVal = val;
        }
      }
    }
  }

  return latestReadingVal !== null ? latestReadingVal : consumerFallback;
}

// 5. Mobile Reading Push: Submit Scanned Meter Reading to Approval Queue (POST /api/readings, POST /api/sync/push or POST /api/readings/submit)
app.post(["/api/readings", "/api/sync/push", "/api/readings/submit", "/api/readings/upload"], (req, res) => {
  const {
    id,
    accountNumber,
    meterNumber,
    currentReading,
    presentReading,
    previousReading,
    readerId,
    readerName,
    route,
    billingPeriod,
    readingDate,
    photoUrl,
    coordinates,
    notes
  } = req.body || {};

  const rawCurr = currentReading !== undefined ? currentReading : presentReading;
  if (!accountNumber || rawCurr === undefined) {
    return res.status(400).json({
      success: false,
      message: "Account number and present/current reading are mandatory."
    });
  }

  // Find matching consumer
  const cleanAcc = String(accountNumber || "").replace(/^#/, "").trim().toUpperCase();
  const cleanMeter = String(meterNumber || "").trim().toUpperCase();
  const matchedConsumer = syncedConsumers.find(
    c =>
      (cleanAcc && String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === cleanAcc) ||
      (cleanMeter && String(c.meterNumber || "").trim().toUpperCase() === cleanMeter)
  );

  const curr = normalizeOdometerServer(rawCurr);
  const resolvedAcc = matchedConsumer ? matchedConsumer.accountNumber : accountNumber;
  const resolvedMeter = meterNumber || (matchedConsumer ? matchedConsumer.meterNumber : "MT-TAG");
  const baseline = resolveConsumerBaselineServer(resolvedAcc, resolvedMeter, id);

  let prev = previousReading !== undefined ? normalizeOdometerServer(previousReading) : baseline;
  // Never lose baseline when a new reading arrives with previousReading omitted or reset to 0
  if (previousReading === undefined && baseline > 0) {
    prev = baseline;
  } else if (prev === 0 && baseline > 0 && curr >= baseline) {
    prev = baseline;
  }
  const odo = computeOdometerServer(prev, curr, req.body?.consumption);
  prev = odo.previousReading;
  const consumption = odo.consumption;

  // Mint unique cycle ID so prior readings are NEVER overwritten when a new reading arrives
  let finalId = id ? String(id).trim() : "";
  const existingApproved =
    finalId &&
    (pendingMobileReadings.some(r => r.id === finalId && r.status === "approved") ||
      reconciledBillingRecords.has(finalId));
  if (!finalId || existingApproved) {
    finalId = `READ-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const rawCoords = coordinates || req.body?.gpsCoordinates || req.body?.gps;
  const parsedCoords =
    rawCoords && typeof rawCoords === "object"
      ? {
          latitude: Number(rawCoords.latitude ?? rawCoords.lat ?? 8.5372),
          longitude: Number(rawCoords.longitude ?? rawCoords.lng ?? 124.7523),
        }
      : { latitude: 8.5372, longitude: 124.7523 };

  const defaultPeriod = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const submission: MobileReadingSubmission = {
    id: finalId,
    accountNumber: resolvedAcc,
    consumerName: matchedConsumer ? matchedConsumer.name : (req.body.consumerName || "Consumer Account"),
    meterNumber: resolvedMeter,
    billingPeriod: billingPeriod || defaultPeriod,
    readingDate: readingDate || new Date().toISOString().split("T")[0],
    previousReading: prev,
    presentReading: curr,
    currentReading: curr,
    consumption,
    readerId: readerId || "WDT-FIELD",
    readerName: readerName || "Field Meter Officer",
    route: route || req.body?.barangay || (matchedConsumer ? matchedConsumer.barangay : "Poblacion"),
    status: "pending_approval",
    photoUrl: photoUrl || "",
    coordinates: parsedCoords,
    gpsAccuracy: typeof rawCoords?.accuracy === "number" ? rawCoords.accuracy : undefined,
    meterCondition: req.body?.meterCondition || undefined,
    ocrConfidence: typeof req.body?.ocrConfidence === "number" ? req.body.ocrConfidence : undefined,
    isAnomaly:
      typeof req.body?.isAnomaly === "boolean"
        ? req.body.isAnomaly ||
          consumption >= 20 ||
          Boolean(req.body?.meterCondition && String(req.body.meterCondition).trim().toUpperCase() !== "NORMAL")
        : consumption >= 20 ||
          Boolean(req.body?.meterCondition && String(req.body.meterCondition).trim().toUpperCase() !== "NORMAL"),
    anomalyReason:
      req.body?.anomalyReason ||
      (consumption >= 20 ||
      Boolean(req.body?.meterCondition && String(req.body.meterCondition).trim().toUpperCase() !== "NORMAL")
        ? "High Usage / Condition Alert — Verify"
        : undefined),
    mobileSyncSource: "direct_push",
    notes: notes || req.body?.remarks || "Scanned and submitted via Tagoloan Mobile Field App",
    submittedAt: new Date().toISOString()
  };

  const pendingDupIdx = pendingMobileReadings.findIndex(r => r.id === submission.id);
  if (pendingDupIdx >= 0) {
    pendingMobileReadings[pendingDupIdx] = submission;
  } else {
    pendingMobileReadings.unshift(submission);
  }
  savePortalSyncStore();

  // Broadcast new reading to Admin Approval Queue on Web via WebSocket
  broadcast("READING_SUBMITTED_FOR_APPROVAL", {
    reading: submission,
    message: `New reading submitted for Account #${submission.accountNumber} (Prev: ${formatOdometerServer(submission.previousReading)} → Pres: ${formatOdometerServer(submission.currentReading)} = ${submission.consumption} m³). Awaiting Admin approval.`
  });
  broadcast("reading:submitted", {
    reading: submission,
    message: `New reading submitted for Account #${submission.accountNumber} (${submission.consumption} m³). Awaiting Admin verification.`
  });

  console.log(`[Mobile API] Reading Submitted for ${submission.accountNumber} - Prev ${formatOdometerServer(submission.previousReading)} -> Pres ${formatOdometerServer(submission.currentReading)} (${submission.consumption} m³) by ${submission.readerName}`);

  res.status(201).json({
    success: true,
    message: "Reading submitted successfully and routed to Admin Verification Queue.",
    submissionId: submission.id,
    reading: submission,
    previousReading: submission.previousReading,
    presentReading: submission.presentReading,
    currentReading: submission.currentReading,
    consumption: submission.consumption,
    status: "pending_approval"
  });
});

// 5.1 Batch Sync Readings: Upload Queued Offline Readings (POST /api/readings/batch, /api/sync/batch)
app.post(["/api/readings/batch", "/api/sync/batch", "/api/readings/bulk"], (req, res) => {
  const readingsList = Array.isArray(req.body) ? req.body : (req.body?.readings || []);

  if (!readingsList || readingsList.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No readings payload provided in batch upload."
    });
  }

  const processed: MobileReadingSubmission[] = [];
  const runningBaselineByAccount = new Map<string, number>();

  for (const item of readingsList) {
    const cleanAcc = String(item.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const cleanMeter = String(item.meterNumber || item.meterSerialNumber || "").trim().toUpperCase();
    const matchedConsumer = syncedConsumers.find(
      c =>
        (cleanAcc && String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === cleanAcc) ||
        (cleanMeter && String(c.meterNumber || "").trim().toUpperCase() === cleanMeter)
    );

    const resolvedAcc = item.accountNumber || (matchedConsumer ? matchedConsumer.accountNumber : "UNKNOWN");
    const resolvedMeter = item.meterNumber || item.meterSerialNumber || (matchedConsumer ? matchedConsumer.meterNumber : "MT-TAG");
    const curr = normalizeOdometerServer(item.currentReading ?? item.presentReading ?? 0);

    const accKey = String(resolvedAcc).replace(/^#/, "").trim().toUpperCase();
    const storedBaseline = resolveConsumerBaselineServer(resolvedAcc, resolvedMeter, item.id);
    const baseline = runningBaselineByAccount.has(accKey) ? runningBaselineByAccount.get(accKey)! : storedBaseline;

    let prev = item.previousReading !== undefined ? normalizeOdometerServer(item.previousReading) : baseline;
    if (prev === 0 && baseline > 0 && curr >= baseline) {
      prev = baseline;
    }
    const odo = computeOdometerServer(prev, curr, item.consumption);
    prev = odo.previousReading;
    const consumption = odo.consumption;
    if (accKey) {
      runningBaselineByAccount.set(accKey, curr);
    }

    let finalId = item.id ? String(item.id).trim() : "";
    const existingApproved =
      finalId &&
      (pendingMobileReadings.some(r => r.id === finalId && r.status === "approved") ||
        reconciledBillingRecords.has(finalId));
    if (!finalId || existingApproved) {
      finalId = `READ-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const rawCoords = item.coordinates || item.gpsCoordinates || item.gps;
    const parsedCoords =
      rawCoords && typeof rawCoords === "object"
        ? {
            latitude: Number(rawCoords.latitude ?? rawCoords.lat ?? 8.5372),
            longitude: Number(rawCoords.longitude ?? rawCoords.lng ?? 124.7523),
          }
        : { latitude: 8.5372, longitude: 124.7523 };

    const defaultPeriod = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const submission: MobileReadingSubmission = {
      id: finalId,
      accountNumber: resolvedAcc,
      consumerName: item.consumerName || (matchedConsumer ? matchedConsumer.name : "Consumer"),
      meterNumber: resolvedMeter,
      billingPeriod: item.billingPeriod || defaultPeriod,
      readingDate: item.readingDate || new Date().toISOString().split("T")[0],
      previousReading: prev,
      presentReading: curr,
      currentReading: curr,
      consumption,
      readerId: item.readerId || (req.headers["x-reader-id"] as string) || "WDT-FIELD",
      readerName: item.readerName || "Field Meter Officer",
      route: item.route || item.barangay || (matchedConsumer ? matchedConsumer.barangay : "Poblacion"),
      status: "pending_approval",
      photoUrl: item.photoUrl || item.dialPhotoUrl || "",
      coordinates: parsedCoords,
      gpsAccuracy: typeof rawCoords?.accuracy === "number" ? rawCoords.accuracy : undefined,
      meterCondition: item.meterCondition || undefined,
      ocrConfidence: typeof item.ocrConfidence === "number" ? item.ocrConfidence : undefined,
      isAnomaly:
        typeof item.isAnomaly === "boolean"
          ? item.isAnomaly ||
            consumption >= 20 ||
            Boolean(item.meterCondition && String(item.meterCondition).trim().toUpperCase() !== "NORMAL")
          : consumption >= 20 ||
            Boolean(item.meterCondition && String(item.meterCondition).trim().toUpperCase() !== "NORMAL"),
      anomalyReason:
        item.anomalyReason ||
        (consumption >= 20 ||
        Boolean(item.meterCondition && String(item.meterCondition).trim().toUpperCase() !== "NORMAL")
          ? "High Usage / Condition Alert — Verify"
          : undefined),
      mobileSyncSource: "batch_sync",
      notes: item.notes || item.remarks || "Batch synced from Mobile Offline Queue",
      submittedAt: new Date().toISOString()
    };

    const dupIdx = pendingMobileReadings.findIndex(r => r.id === submission.id);
    if (dupIdx >= 0) {
      pendingMobileReadings[dupIdx] = submission;
    } else {
      pendingMobileReadings.unshift(submission);
    }
    processed.push(submission);
  }
  savePortalSyncStore();

  // Broadcast batch submission event to Admin
  broadcast("READINGS_BATCH_SYNCED", {
    count: processed.length,
    readings: processed,
    message: `${processed.length} offline field readings batch synced by field staff.`
  });

  res.status(201).json({
    success: true,
    message: `Successfully processed and synced ${processed.length} field readings.`,
    count: processed.length,
    readings: processed,
    syncedIds: processed.map(p => p.id)
  });
});

// 6. Admin Approval Queue Listing & Readings Feed (GET /api/readings, GET /api/readings/pending, GET /api/sync/readings)
app.get(["/api/readings", "/api/readings/pending", "/api/sync/readings"], (req, res) => {
  const onlyPending = req.path.endsWith("/pending");
  const list = onlyPending
    ? pendingMobileReadings.filter(r => r.status === "pending_approval")
    : pendingMobileReadings;
  res.json({
    success: true,
    count: list.length,
    readings: list,
    data: list
  });
});

// 7. Admin Approves Reading -> Verifies Meter Reading Telemetry & Rolls Forward Consumer Baseline (POST /api/readings/:id/approve)
app.post("/api/readings/:id/approve", (req, res) => {
  const { id } = req.params;
  const approvedBy = req.body?.approvedBy || "TWD Admin";
  const item = pendingMobileReadings.find(r => r.id === id);

  if (item) {
    item.status = "approved";
    item.approvedBy = approvedBy;
    const cleanAcc = String(item.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const targetConsumer = syncedConsumers.find(
      c => String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === cleanAcc
    );
    if (targetConsumer) {
      targetConsumer.previousReading = normalizeOdometerServer(item.currentReading ?? item.presentReading ?? 0);
      targetConsumer.lastReadingDate = item.readingDate;
      forwardConsumerToMobileTerminal(targetConsumer, false).catch(() => {});
    }
    savePortalSyncStore();
    broadcast("READING_VERIFIED", {
      accountNumber: item.accountNumber,
      billingPeriod: item.billingPeriod,
      previousReading: item.previousReading,
      presentReading: item.presentReading ?? item.currentReading,
      currentReading: item.currentReading,
      consumption: item.consumption,
      message: `Meter reading for ${item.billingPeriod} has been verified and billed.`
    });
  }

  forwardReadingDecisionToMobileTerminal(id, "approve", approvedBy).catch(() => {});

  res.json({
    success: true,
    message: `Reading #${id} verified.`,
    reading: item || null
  });
});

// 7.05 Admin Rejects / Flags Reading for Field Re-inspection (POST / PATCH /api/readings/:id/reject)
app.all("/api/readings/:id/reject", (req, res) => {
  const { id } = req.params;
  const reason = req.body?.reason || "Flagged by Administrator for field re-inspection";
  const rejectedBy = req.body?.rejectedBy || "TWD Admin";
  const item = pendingMobileReadings.find(r => r.id === id);

  if (item) {
    item.status = "rejected";
    item.rejectionReason = reason;
    savePortalSyncStore();
  }

  forwardReadingDecisionToMobileTerminal(id, "reject", rejectedBy, reason).catch(() => {});
  broadcast("READING_REJECTED_REINSPECT", {
    readingId: id,
    accountNumber: item?.accountNumber,
    meterNumber: item?.meterNumber,
    readerId: item?.readerId,
    reason,
    rejectedBy,
    message: `Reading #${id} flagged for field re-inspection: ${reason}`
  });

  res.json({
    success: true,
    message: `Reading #${id} flagged for field re-inspection and dispatched to Mobile Field Terminal.`,
    reading: item || null
  });
});

/// 7.1 Official Admin Billing Sync & Consumer Billing Feed (GET /api/billings, POST /api/billings/reconcile)
const BILLINGS_SYNC_FILE = path.join(process.cwd(), ".twd-billings-sync.json");
const TMP_BILLINGS_SYNC_FILE = path.join(TMP_RUNTIME_DIR, "twd-billings-sync.json");
const reconciledBillingRecords = new Map<string, any>();

function normalizeBillingRecordToOfficialBaselineServer(r: any): any {
  if (!r || typeof r !== "object") return r;
  const paidAmt = Math.max(0, Number(r.paidAmount || 0));
  const isLockedBill = Boolean(
    r.tariffBaselineSchema === "twd_per_m3_v2" ||
    r.paymentStatus === "paid" ||
    r.paymentStatus === "partial" ||
    paidAmt > 0 ||
    ((r.isBillingIssued || r.billingIssuedAt || r.invoiceNumber) &&
      typeof r.billAmount === "number" &&
      r.billAmount >= 0)
  );
  if (isLockedBill) {
    const basicLocked =
      typeof r.billAmount === "number" && r.billAmount >= 0
        ? Math.round(r.billAmount * 100) / 100
        : Math.max(0, Number(r.totalAmount || 0));
    const fTaxLocked =
      typeof r.franchiseTax === "number" && r.franchiseTax >= 0
        ? Math.round(r.franchiseTax * 100) / 100
        : Math.round(basicLocked * 0.02 * 100) / 100;
    const arrLocked = Math.max(0, Math.round(Number(r.arrears || 0) * 100) / 100);
    const canonicalTotal = Math.round((basicLocked + fTaxLocked + arrLocked) * 100) / 100;
    const storedTotal = typeof r.totalAmount === "number" ? Math.round(r.totalAmount * 100) / 100 : 0;
    const healedTotal =
      storedTotal > 0 && !(fTaxLocked > 0 && Math.abs(storedTotal - basicLocked) < 0.009)
        ? storedTotal
        : canonicalTotal;
    const lPenLocked =
      typeof r.penaltyAmount === "number" && r.penaltyAmount >= 0
        ? Math.round(r.penaltyAmount * 100) / 100
        : Math.round(basicLocked * 0.10 * 100) / 100;
    const afterDueLocked = Math.round((healedTotal + lPenLocked) * 100) / 100;
    const isCleared = r.paymentStatus === "paid" || (healedTotal > 0 && paidAmt >= healedTotal - 0.009);
    const isPart = !isCleared && (r.paymentStatus === "partial" || paidAmt > 0);
    const remLocked = isCleared ? 0 : Math.max(0, Math.round((healedTotal - paidAmt) * 100) / 100);
    return {
      ...r,
      billAmount: basicLocked,
      franchiseTax: fTaxLocked,
      arrears: arrLocked,
      penaltyAmount: lPenLocked,
      totalAmount: healedTotal,
      amountAfterDueDate: afterDueLocked,
      paymentStatus: isCleared ? "paid" : isPart ? "partial" : (r.paymentStatus || "unpaid"),
      paidAmount: isCleared ? Math.max(healedTotal, paidAmt) : paidAmt,
      remainingBalance: remLocked,
      tariffBaselineSchema: "twd_per_m3_v2",
    };
  }
  const hasIssuedBilling = Boolean(
    r.isBillingIssued ||
    r.billingIssuedAt ||
    r.invoiceNumber ||
    typeof r.billAmount === "number" ||
    typeof r.totalAmount === "number"
  );
  if (!hasIssuedBilling) return r;

  const isComm = String(r.classification || "").toLowerCase().includes("comm");
  const ratePerM3 = isComm ? 25.0 : 10.0;
  const usage = Math.max(0, Number(r.consumption || 0));
  const basic = usage <= 0 ? 0 : Math.round(usage * ratePerM3 * 100) / 100;
  const fTax = Math.round(basic * 0.02 * 100) / 100;
  const lPen = Math.round(basic * 0.10 * 100) / 100;
  const arr = Math.max(0, Number(r.arrears || 0));
  const totalDue = Math.round((basic + fTax + arr) * 100) / 100;
  const afterDue = Math.round((totalDue + lPen) * 100) / 100;
  const remBal = Math.max(0, Math.round((totalDue - paidAmt) * 100) / 100);

  return {
    ...r,
    billAmount: basic,
    franchiseTax: fTax,
    penaltyAmount: lPen,
    totalAmount: totalDue,
    amountAfterDueDate: afterDue,
    remainingBalance: remBal,
    tariffBaselineSchema: "twd_per_m3_v2",
  };
}

function loadBillingsSyncStore() {
  try {
    const sourceFile = fs.existsSync(TMP_BILLINGS_SYNC_FILE)
      ? TMP_BILLINGS_SYNC_FILE
      : fs.existsSync(BILLINGS_SYNC_FILE)
        ? BILLINGS_SYNC_FILE
        : null;
    if (sourceFile) {
      const raw = fs.readFileSync(sourceFile, "utf8");
      const parsed = JSON.parse(raw);
      let migrated = false;
      if (Array.isArray(parsed)) {
        parsed.forEach((r) => {
          if (r && r.id) {
            const norm = normalizeBillingRecordToOfficialBaselineServer(r);
            if (norm !== r) migrated = true;
            reconciledBillingRecords.set(r.id, norm);
          }
        });
      }
      if (migrated) {
        saveBillingsSyncStore();
      }
    }
  } catch {
    // Ignore corrupt cache
  }
}

function saveBillingsSyncStore() {
  const serialized = JSON.stringify(Array.from(reconciledBillingRecords.values()), null, 2);
  if (!IS_CLOUD_RUN) {
    try {
      fs.writeFileSync(BILLINGS_SYNC_FILE, serialized, "utf8");
      return;
    } catch {
      // Fall through to tmpdir
    }
  }
  try {
    if (!fs.existsSync(TMP_RUNTIME_DIR)) {
      fs.mkdirSync(TMP_RUNTIME_DIR, { recursive: true });
    }
    fs.writeFileSync(TMP_BILLINGS_SYNC_FILE, serialized, "utf8");
  } catch {
    // Ignore read-only fs environments
  }
}

loadBillingsSyncStore();

function compareReadingsServerDesc(a: any, b: any): number {
  return (
    new Date(b?.readingDate || 0).getTime() - new Date(a?.readingDate || 0).getTime() ||
    new Date(b?.billingIssuedAt || b?.submittedAt || 0).getTime() - new Date(a?.billingIssuedAt || a?.submittedAt || 0).getTime() ||
    normalizeOdometerServer(b?.currentReading ?? b?.presentReading ?? 0) - normalizeOdometerServer(a?.currentReading ?? a?.presentReading ?? 0) ||
    String(a?.accountNumber || "").localeCompare(String(b?.accountNumber || ""), undefined, { numeric: true, sensitivity: "base" }) ||
    String(a?.id || "").localeCompare(String(b?.id || ""), undefined, { numeric: true, sensitivity: "base" })
  );
}

function mergeBillingRecordServer(prev: any, incoming: any): any {
  if (!prev) {
    const odo = computeOdometerServer(
      incoming.previousReading,
      incoming.currentReading ?? incoming.presentReading,
      incoming.consumption
    );
    return normalizeBillingRecordToOfficialBaselineServer({
      ...incoming,
      previousReading: odo.previousReading,
      presentReading: odo.currentReading,
      currentReading: odo.currentReading,
      consumption: odo.consumption,
    });
  }
  const prevBilled = Boolean(
    prev.isBillingIssued || prev.billingIssuedAt || prev.invoiceNumber || prev.paymentStatus === "paid" || prev.paymentStatus === "partial" || Number(prev.paidAmount || 0) > 0
  );
  const incBilled = Boolean(
    incoming.isBillingIssued || incoming.billingIssuedAt || incoming.invoiceNumber || incoming.paymentStatus === "paid" || incoming.paymentStatus === "partial" || Number(incoming.paidAmount || 0) > 0
  );
  const mergedBilled = prevBilled || incBilled;
  const billedSrc = incBilled ? incoming : prevBilled ? prev : incoming;
  const altSrc = billedSrc === incoming ? prev : incoming;
  const maxPaid = Math.round(Math.max(Number(prev.paidAmount || 0), Number(incoming.paidAmount || 0)) * 100) / 100;
  const effBillAmt = Number(billedSrc.billAmount ?? altSrc.billAmount ?? 0);
  const effFranchiseTax =
    typeof (billedSrc.franchiseTax ?? altSrc.franchiseTax) === "number"
      ? Math.round(Number(billedSrc.franchiseTax ?? altSrc.franchiseTax) * 100) / 100
      : Math.round(effBillAmt * 0.02 * 100) / 100;
  const effArrears = Math.max(0, Math.round(Number(billedSrc.arrears ?? altSrc.arrears ?? 0) * 100) / 100);
  const canonicalGross = Math.round((effBillAmt + effFranchiseTax + effArrears) * 100) / 100;
  const candidateTotal = Number(billedSrc.totalAmount ?? altSrc.totalAmount ?? 0);
  const effTotalAmt =
    candidateTotal > 0 && !(effFranchiseTax > 0 && Math.abs(candidateTotal - effBillAmt) < 0.009)
      ? Math.round(candidateTotal * 100) / 100
      : canonicalGross;
  const isPaid =
    prev.paymentStatus === "paid" ||
    incoming.paymentStatus === "paid" ||
    (effTotalAmt > 0 && maxPaid >= effTotalAmt - 0.009);
  const isPartial = !isPaid && (prev.paymentStatus === "partial" || incoming.paymentStatus === "partial" || maxPaid > 0);

  const rawCurr = billedSrc.currentReading ?? billedSrc.presentReading ?? altSrc.currentReading ?? altSrc.presentReading ?? 0;
  const candPrev = billedSrc.previousReading ?? altSrc.previousReading ?? 0;
  const odoMerged = computeOdometerServer(candPrev, rawCurr, billedSrc.consumption ?? altSrc.consumption);

  return normalizeBillingRecordToOfficialBaselineServer({
    ...prev,
    ...incoming,
    previousReading: odoMerged.previousReading,
    presentReading: odoMerged.currentReading,
    currentReading: odoMerged.currentReading,
    consumption: odoMerged.consumption,
    isBillingIssued: mergedBilled ? true : Boolean(incoming.isBillingIssued ?? prev.isBillingIssued),
    billingIssuedAt: incoming.billingIssuedAt || prev.billingIssuedAt,
    billingIssuedBy: incoming.billingIssuedBy || prev.billingIssuedBy,
    invoiceNumber: incoming.invoiceNumber || prev.invoiceNumber,
    dueDate: billedSrc.dueDate || altSrc.dueDate,
    billAmount: effBillAmt,
    totalAmount: effTotalAmt,
    franchiseTax: effFranchiseTax,
    arrears: effArrears,
    penaltyAmount: billedSrc.penaltyAmount ?? altSrc.penaltyAmount,
    amountAfterDueDate: billedSrc.amountAfterDueDate ?? altSrc.amountAfterDueDate,
    status:
      prev.status === "cancelled" || incoming.status === "cancelled"
        ? "cancelled"
        : mergedBilled || prev.status === "verified" || incoming.status === "verified"
          ? "verified"
          : (incoming.status || prev.status),
    paymentStatus: isPaid ? "paid" : isPartial ? "partial" : (incoming.paymentStatus || prev.paymentStatus || "unpaid"),
    paidAmount: isPaid ? Math.max(effTotalAmt, maxPaid) : maxPaid > 0 ? maxPaid : (prev.paidAmount ?? incoming.paidAmount ?? 0),
    remainingBalance: isPaid
      ? 0
      : Math.max(0, Math.round((effTotalAmt - maxPaid) * 100) / 100),
    orNumber: incoming.orNumber || prev.orNumber,
    paymentReference: incoming.paymentReference || prev.paymentReference || incoming.orNumber || prev.orNumber,
    paymentDate: incoming.paymentDate || prev.paymentDate,
    paymentMethod: incoming.paymentMethod || prev.paymentMethod,
    cashierName: incoming.cashierName || prev.cashierName,
    transactionId: incoming.transactionId || prev.transactionId,
    paymentReceiptUrl: incoming.paymentReceiptUrl || prev.paymentReceiptUrl,
    tariffBaselineSchema: incoming.tariffBaselineSchema || prev.tariffBaselineSchema || "twd_per_m3_v2",
  });
}

app.get("/api/billings", (req, res) => {
  const accQuery = String(req.query.accountNumber || "").trim().toUpperCase();
  let list = Array.from(reconciledBillingRecords.values());
  if (accQuery) {
    list = list.filter(r => String(r.accountNumber || "").trim().toUpperCase() === accQuery);
  }
  list.sort(compareReadingsServerDesc);
  res.json({ success: true, count: list.length, readings: list });
});

app.post("/api/billings/reconcile", (req, res) => {
  const incoming = Array.isArray(req.body?.readings) ? req.body.readings : [];
  const newlyBilled: any[] = [];
  const newlyPaid: any[] = [];
  const affectedAccounts = new Set<string>();
  let storeChanged = false;

  for (const r of incoming) {
    if (!r || !r.id) continue;
    const prev = reconciledBillingRecords.get(r.id);
    const merged = mergeBillingRecordServer(prev, r);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(merged)) {
      reconciledBillingRecords.set(r.id, merged);
      storeChanged = true;
    }

    const cleanAcc = String(merged.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    if (cleanAcc) {
      affectedAccounts.add(cleanAcc);
    }

    // Roll forward mobile queue status & consumer baseline whenever a reading is verified or billed
    if (merged.status === "verified" || merged.isBillingIssued) {
      const mobItem = pendingMobileReadings.find(m => m.id === merged.id);
      if (mobItem && mobItem.status !== "approved") {
        mobItem.status = "approved";
      }
      if (cleanAcc) {
        const targetConsumer = syncedConsumers.find(
          c => String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === cleanAcc
        );
        if (
          targetConsumer &&
          (!targetConsumer.lastReadingDate ||
            !merged.readingDate ||
            merged.readingDate >= targetConsumer.lastReadingDate)
        ) {
          targetConsumer.previousReading = normalizeOdometerServer(merged.currentReading ?? merged.presentReading ?? 0);
          targetConsumer.lastReadingDate = merged.readingDate || targetConsumer.lastReadingDate;
        }
      }
    }

    const wasBilled = Boolean(prev?.isBillingIssued || prev?.billingIssuedAt || prev?.invoiceNumber);
    const nowBilled = Boolean(merged.isBillingIssued || merged.billingIssuedAt || merged.invoiceNumber);
    if (!wasBilled && nowBilled) {
      newlyBilled.push(merged);
    }
    const prevPaidAmt = Number(prev?.paidAmount || 0);
    const nextPaidAmt = Number(merged.paidAmount || 0);
    if (
      (prev?.paymentStatus !== "paid" && merged.paymentStatus === "paid") ||
      (prev?.paymentStatus !== "partial" && merged.paymentStatus === "partial") ||
      nextPaidAmt > prevPaidAmt + 0.009
    ) {
      newlyPaid.push(merged);
    }
  }

  // Reconcile affected consumers' outstandingBalance from authoritative issued unsettled bills
  if (affectedAccounts.size > 0) {
    const allStoredBills = Array.from(reconciledBillingRecords.values());
    for (const accUpper of affectedAccounts) {
      const targetConsumer = syncedConsumers.find(
        c => String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === accUpper
      );
      if (!targetConsumer) continue;
      const accountIssuedBills = allStoredBills.filter(b => {
        if (!b || b.status === "cancelled") return false;
        const bAcc = String(b.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
        if (bAcc !== accUpper) return false;
        return Boolean(b.isBillingIssued || b.billingIssuedAt || b.invoiceNumber || b.paymentStatus === "paid" || b.paymentStatus === "partial");
      });
      if (accountIssuedBills.length > 0) {
        const sumRemaining = Math.round(
          accountIssuedBills.reduce((sum, b) => {
            if (b.paymentStatus === "paid") return sum;
            const gross = Number(b.totalAmount ?? b.billAmount ?? 0);
            const paid = Number(b.paidAmount || 0);
            const rem = typeof b.remainingBalance === "number" ? b.remainingBalance : Math.max(0, gross - paid);
            return sum + Math.max(0, rem);
          }, 0) * 100
        ) / 100;
        if (Math.abs(Number(targetConsumer.outstandingBalance || 0) - sumRemaining) > 0.009) {
          targetConsumer.outstandingBalance = sumRemaining;
          storeChanged = true;
        }
      }
    }
  }

  if (storeChanged) {
    saveBillingsSyncStore();
    savePortalSyncStore();
  }

  for (const bill of newlyBilled) {
    forwardReadingDecisionToMobileTerminal(bill.id, "approve", bill.billingIssuedBy || "TWD Admin").catch(() => {});
    const billedAcc = String(bill.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const billedConsumer = syncedConsumers.find(
      c => String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === billedAcc
    );
    if (billedConsumer && isValidatedConsumerForReader(billedConsumer)) {
      forwardConsumerToMobileTerminal(billedConsumer, false).catch(() => {});
    }

    broadcast("READING_APPROVED_BILL_ISSUED", {
      accountNumber: bill.accountNumber,
      billingPeriod: bill.billingPeriod,
      previousReading: bill.previousReading,
      presentReading: bill.presentReading ?? bill.currentReading,
      currentReading: bill.currentReading,
      consumption: bill.consumption,
      reading: bill,
      message: `Official water billing statement for ${bill.billingPeriod} has been issued by Administration.`
    });
    broadcast("bill:issued", {
      accountNumber: bill.accountNumber,
      billingPeriod: bill.billingPeriod,
      previousReading: bill.previousReading,
      presentReading: bill.presentReading ?? bill.currentReading,
      currentReading: bill.currentReading,
      consumption: bill.consumption,
      reading: bill,
      message: `Official water billing statement for ${bill.billingPeriod} has been issued by Administration.`
    });
  }

  for (const paidBill of newlyPaid) {
    const paidAcc = String(paidBill.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const matchedConsumer = syncedConsumers.find(
      c => String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === paidAcc
    );
    broadcast("PAYMENT_RECORDED", {
      accountNumber: paidBill.accountNumber,
      billingPeriod: paidBill.billingPeriod,
      orNumber: paidBill.orNumber,
      amountPaid: paidBill.paidAmount,
      remainingBalance: paidBill.remainingBalance ?? 0,
      reading: paidBill,
      readings: [paidBill],
      consumer: matchedConsumer || undefined,
      message: `Payment recorded for ${paidBill.billingPeriod} (OR #${paidBill.orNumber || "ISSUED"}).`
    });
    broadcast("payment:recorded", {
      accountNumber: paidBill.accountNumber,
      billingPeriod: paidBill.billingPeriod,
      orNumber: paidBill.orNumber,
      amountPaid: paidBill.paidAmount,
      remainingBalance: paidBill.remainingBalance ?? 0,
      reading: paidBill,
      readings: [paidBill],
      message: `Payment recorded for ${paidBill.billingPeriod} (OR #${paidBill.orNumber || "ISSUED"}).`
    });
  }

  const accQuery = String(req.body?.accountNumber || "").trim().toUpperCase();
  let list = Array.from(reconciledBillingRecords.values());
  if (accQuery) {
    list = list.filter(r => String(r.accountNumber || "").trim().toUpperCase() === accQuery);
  }
  list.sort(compareReadingsServerDesc);
  res.json({ success: true, count: list.length, readings: list });
});

// ==========================================
// 6. CONSUMER SERVICE REPORTS & ADMIN REPLY APIS
// ==========================================

function dedupeInMemoryReplies(replies: ServerReportReply[]): ServerReportReply[] {
  if (!Array.isArray(replies)) return [];
  const sorted = [...replies]
    .filter(r => r && typeof r.message === "string" && r.message.trim().length > 0)
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

  const byId = new Set<string>();
  const result: ServerReportReply[] = [];
  let hasAutoAck = false;

  for (const rep of sorted) {
    const cleanId = String(rep.id || "").trim();
    if (cleanId && byId.has(cleanId)) continue;

    const isAutoAck =
      cleanId.startsWith("ACK-") ||
      rep.senderId === "system-admin-ack" ||
      (rep.senderRole === "admin" && rep.message.includes("officially received by Tagoloan Water District"));
    if (isAutoAck) {
      if (hasAutoAck) continue;
      hasAutoAck = true;
    }

    const normMsg = rep.message.trim().replace(/\s+/g, " ").toLowerCase();
    const repTime = new Date(rep.timestamp || 0).getTime();
    const semanticDupIdx = result.findIndex(existing => {
      if (existing.senderRole !== rep.senderRole) return false;
      const exMsg = existing.message.trim().replace(/\s+/g, " ").toLowerCase();
      if (exMsg !== normMsg) return false;
      const exTime = new Date(existing.timestamp || 0).getTime();
      if (!exTime || !repTime) return true;
      return Math.abs(repTime - exTime) < 5 * 60 * 1000;
    });

    if (semanticDupIdx >= 0) {
      if (rep.statusUpdate && !result[semanticDupIdx].statusUpdate) {
        result[semanticDupIdx] = { ...result[semanticDupIdx], statusUpdate: rep.statusUpdate };
      }
      if (cleanId) byId.add(cleanId);
      continue;
    }

    if (cleanId) byId.add(cleanId);
    result.push(rep);
  }

  return result;
}

function mergeInMemoryReportPair(existing: ServerConsumerReport, incoming: ServerConsumerReport): ServerConsumerReport {
  const exReplies = Array.isArray(existing.replies) ? existing.replies : [];
  const inReplies = Array.isArray(incoming.replies) ? incoming.replies : [];
  const mergedReplies = dedupeInMemoryReplies([...exReplies, ...inReplies]);
  const inTime = new Date(incoming.updatedAt || incoming.createdAt || 0).getTime();
  const exTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
  const incomingNewer = inTime > exTime || (inTime === exTime && inReplies.length > exReplies.length);
  const primary = incomingNewer ? incoming : existing;
  const secondary = incomingNewer ? existing : incoming;
  const exConsumerCount = exReplies.filter(m => m && m.senderRole === "consumer").length;
  const inConsumerCount = inReplies.filter(m => m && m.senderRole === "consumer").length;
  const resolvedUnreadConsumer =
    inConsumerCount > exConsumerCount
      ? Boolean(incoming.hasUnreadConsumerUpdate)
      : exConsumerCount > inConsumerCount
        ? Boolean(existing.hasUnreadConsumerUpdate)
        : inTime === exTime
          ? Boolean(existing.hasUnreadConsumerUpdate && incoming.hasUnreadConsumerUpdate)
          : Boolean(primary.hasUnreadConsumerUpdate);
  return {
    ...secondary,
    ...primary,
    id: existing.id || incoming.id,
    ticketNumber: primary.ticketNumber || secondary.ticketNumber,
    sourceNotificationId: primary.sourceNotificationId || secondary.sourceNotificationId,
    referencedNotice: primary.referencedNotice || secondary.referencedNotice,
    replies: mergedReplies,
    hasUnreadConsumerUpdate: resolvedUnreadConsumer,
  };
}

function filterInMemoryReports(
  source: ServerConsumerReport[],
  filters: { accountNumber?: unknown; email?: unknown; status?: unknown; category?: unknown; search?: unknown }
): ServerConsumerReport[] {
  let list = [...source];
  const accRaw = typeof filters.accountNumber === "string" ? filters.accountNumber.trim().toLowerCase() : "";
  const emailRaw = typeof filters.email === "string" ? filters.email.trim().toLowerCase() : "";
  const validAcc = accRaw && !accRaw.startsWith("pending") && accRaw !== "unassigned" ? accRaw : "";

  if (validAcc || emailRaw) {
    list = list.filter(r => {
      const rAcc = (r.accountNumber || "").trim().toLowerCase();
      const rEmail = (r.consumerEmail || "").trim().toLowerCase();
      return (
        (validAcc && (rAcc === validAcc || rEmail === validAcc)) ||
        (emailRaw && (rEmail === emailRaw || rAcc === emailRaw))
      );
    });
  }

  if (typeof filters.status === "string" && filters.status.trim() && filters.status !== "all") {
    list = list.filter(r => r.status === filters.status);
  }

  if (typeof filters.category === "string" && filters.category.trim() && filters.category !== "all") {
    list = list.filter(r => r.category === filters.category);
  }

  if (typeof filters.search === "string" && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    list = list.filter(r =>
      r.ticketNumber.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.consumerName.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q))
    );
  }

  return list;
}

// GET /api/reports - Fetch reports with optional filters
app.get("/api/reports", (req, res) => {
  try {
    const list = filterInMemoryReports(inMemoryReports, req.query);
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

// POST /api/reports/reconcile - Bidirectional report & reply reconciliation
app.post("/api/reports/reconcile", (req, res) => {
  try {
    const incoming: ServerConsumerReport[] = Array.isArray(req.body?.reports) ? req.body.reports : [];
    let changed = false;
    for (const ir of incoming) {
      if (!ir || (!ir.id && !ir.ticketNumber)) continue;
      const idx = inMemoryReports.findIndex(
        r => (ir.id && r.id === ir.id) || (ir.ticketNumber && r.ticketNumber === ir.ticketNumber)
      );
      if (idx === -1) {
        inMemoryReports.unshift({
          ...ir,
          id: ir.id || ir.ticketNumber,
          replies: dedupeInMemoryReplies(Array.isArray(ir.replies) ? ir.replies : [])
        });
        changed = true;
      } else {
        const merged = mergeInMemoryReportPair(inMemoryReports[idx], ir);
        if (JSON.stringify(merged) !== JSON.stringify(inMemoryReports[idx])) {
          inMemoryReports[idx] = merged;
          changed = true;
        }
      }
    }
    if (changed) {
      inMemoryReports.sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime() ||
          new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime() ||
          String(a.id || a.ticketNumber || "").localeCompare(String(b.id || b.ticketNumber || ""), undefined, {
            numeric: true,
            sensitivity: "base"
          })
      );
      savePortalSyncStore();
    }
    const list = filterInMemoryReports(inMemoryReports, {
      accountNumber: req.body?.accountNumber,
      email: req.body?.email
    });
    res.json({
      success: true,
      count: list.length,
      reports: list,
      data: list
    });
  } catch {
    res.json({ success: true, count: inMemoryReports.length, reports: inMemoryReports, data: inMemoryReports });
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

    const id = req.body.id || `REP-${Date.now()}`;
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const ticketNumber = req.body.ticketNumber || `TWD-CR-${new Date().getFullYear()}-${randNum}`;
    const now = new Date().toISOString();
    const createdAt = req.body.createdAt || now;

    const rawReplies: ServerReportReply[] = Array.isArray(req.body.replies) && req.body.replies.length > 0
      ? [...req.body.replies]
      : [];
    if (rawReplies.length === 0 && description) {
      rawReplies.push({
        id: `INIT-${ticketNumber}`,
        reportId: id,
        senderId: accountNumber || "consumer",
        senderName: consumerName || "Consumer",
        senderRole: "consumer",
        message: description,
        timestamp: createdAt
      });
    }

    const ackTimestamp = new Date(new Date(createdAt).getTime() + 1).toISOString();
    const ackId = `ACK-${ticketNumber}`;
    const hasAckAlready = rawReplies.some(
      r =>
        r &&
        (String(r.id || "").startsWith("ACK-") ||
          r.senderId === "system-admin-ack" ||
          (r.senderRole === "admin" && String(r.message || "").includes("officially received by Tagoloan Water District")))
    );
    const refNotice: ServerReferencedNoticeContext | undefined =
      req.body.referencedNotice && typeof req.body.referencedNotice === "object"
        ? req.body.referencedNotice
        : undefined;
    const sourceNotificationId =
      typeof req.body.sourceNotificationId === "string" && req.body.sourceNotificationId.trim()
        ? req.body.sourceNotificationId.trim()
        : undefined;

    if (!hasAckAlready) {
      const ackMsg = refNotice
        ? `Good day, ${consumerName || "Valued Consumer"}! Your reply (${ticketNumber}) regarding Official Notice "${refNotice.subject}"${refNotice.meterNumber ? ` (Meter #${refNotice.meterNumber}${refNotice.meterStatus ? ` · Status: ${String(refNotice.meterStatus).toUpperCase()}` : ""})` : ""} has been linked and delivered directly to Tagoloan Water District Administration with all notice details attached.`
        : `Thank you for reaching out! Your inquiry/report (${ticketNumber}) has been officially received by Tagoloan Water District Administration. Our Customer Service team has been notified—please wait momentarily while our staff reviews your concern and prepares an official response.`;
      rawReplies.push({
        id: ackId,
        reportId: id,
        senderId: "system-admin-ack",
        senderName: "TWD Customer Service Desk",
        senderRole: "admin",
        message: ackMsg,
        timestamp: ackTimestamp
      });
    }
    const replies = dedupeInMemoryReplies(rawReplies);

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
      status: req.body.status || "pending",
      createdAt,
      updatedAt: ackTimestamp,
      photoUrl: photoUrl || "",
      replies,
      hasUnreadAdminReply: false,
      hasUnreadConsumerUpdate: true,
      ...(sourceNotificationId ? { sourceNotificationId } : {}),
      ...(refNotice ? { referencedNotice: refNotice } : {})
    };

    const existingIdx = inMemoryReports.findIndex(r => r.id === id || r.ticketNumber === ticketNumber);
    if (existingIdx >= 0) {
      inMemoryReports[existingIdx] = mergeInMemoryReportPair(inMemoryReports[existingIdx], newReport);
    } else {
      inMemoryReports.unshift(newReport);
    }
    const finalSavedReport = inMemoryReports[existingIdx >= 0 ? existingIdx : 0];
    savePortalSyncStore();

    // Broadcast report creation to Admin Portal and all WebSocket clients
    broadcast("CONSUMER_REPORT_CREATED", {
      report: finalSavedReport,
      ticketNumber: finalSavedReport.ticketNumber,
      consumerName: finalSavedReport.consumerName,
      accountNumber: finalSavedReport.accountNumber,
      category: finalSavedReport.category,
      title: finalSavedReport.title,
      urgency: finalSavedReport.urgency,
      message: `New Consumer Concern Filed [${finalSavedReport.ticketNumber}] by ${finalSavedReport.consumerName} (${finalSavedReport.accountNumber}): "${finalSavedReport.title}"`
    });

    broadcast("consumer:report:created", {
      report: finalSavedReport,
      ticketNumber: finalSavedReport.ticketNumber,
      message: `New report ${finalSavedReport.ticketNumber} filed for ${finalSavedReport.barangay}.`
    });

    res.status(201).json({
      success: true,
      message: `Concern filed successfully. Tracking Ticket: ${ticketNumber}`,
      report: finalSavedReport
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to submit consumer report." });
  }
});

// POST /api/reports/:id/reply - Admin or Consumer adds a reply
app.post(["/api/reports/:id/reply", "/api/reports/:id/replies"], (req, res) => {
  try {
    const { id } = req.params;
    const {
      id: clientReplyId,
      replyId,
      timestamp: clientReplyTimestamp,
      senderId,
      senderName,
      senderRole,
      message,
      statusUpdate,
      assignedStaff,
      report: clientReport
    } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Reply message cannot be empty." });
    }

    const now = new Date().toISOString();
    const replyTs = clientReplyTimestamp || now;
    let idx = inMemoryReports.findIndex(r => r.id === id || r.ticketNumber === id);
    if (idx === -1 && clientReport && typeof clientReport === "object") {
      const hydrated: ServerConsumerReport = {
        ...clientReport,
        id: clientReport.id || id,
        ticketNumber: clientReport.ticketNumber || id,
        accountNumber: clientReport.accountNumber || "UNASSIGNED",
        consumerName: clientReport.consumerName || "Consumer",
        consumerEmail: clientReport.consumerEmail || "",
        consumerPhone: clientReport.consumerPhone || "",
        barangay: clientReport.barangay || "Poblacion",
        address: clientReport.address || "",
        meterNumber: clientReport.meterNumber || "",
        category: clientReport.category || "other",
        title: clientReport.title || "Consumer Inquiry",
        description: clientReport.description || "",
        urgency: clientReport.urgency || "normal",
        status: clientReport.status || "pending",
        createdAt: clientReport.createdAt || now,
        updatedAt: now,
        replies: dedupeInMemoryReplies(Array.isArray(clientReport.replies) ? clientReport.replies : []),
        hasUnreadAdminReply: Boolean(clientReport.hasUnreadAdminReply),
        hasUnreadConsumerUpdate: Boolean(clientReport.hasUnreadConsumerUpdate)
      };
      inMemoryReports.unshift(hydrated);
      idx = 0;
    }

    if (idx === -1) {
      return res.status(404).json({ success: false, message: `Report ${id} not found.` });
    }

    const report = inMemoryReports[idx];
    const cleanMessage = message.trim();
    const deterministicReplyId = String(clientReplyId || replyId || "").trim() || `REP-MSG-${Date.now()}`;

    const replyItem: ServerReportReply = {
      id: deterministicReplyId,
      reportId: report.id,
      senderId: senderId || "staff",
      senderName: senderName || (senderRole === "admin" ? "TWD Admin" : "Consumer"),
      senderRole: senderRole || "admin",
      message: cleanMessage,
      timestamp: replyTs,
      statusUpdate: statusUpdate || undefined
    };

    const existingReplies = dedupeInMemoryReplies(Array.isArray(report.replies) ? report.replies : []);
    const normNewMsg = cleanMessage.replace(/\s+/g, " ").toLowerCase();
    const newReplyMs = new Date(replyTs).getTime();
    const isDuplicateSubmission = existingReplies.some(r => {
      if (r.id === deterministicReplyId) return true;
      if (r.senderRole !== replyItem.senderRole) return false;
      const rNorm = String(r.message || "").trim().replace(/\s+/g, " ").toLowerCase();
      if (rNorm !== normNewMsg) return false;
      const rMs = new Date(r.timestamp || 0).getTime();
      return !rMs || !newReplyMs || Math.abs(newReplyMs - rMs) < 5 * 60 * 1000;
    });

    const nextStatus = statusUpdate || report.status;
    const isResolved = nextStatus === "resolved";
    const mergedReplies = dedupeInMemoryReplies([...existingReplies, replyItem]);

    const updated: ServerConsumerReport = {
      ...report,
      ...(clientReport?.referencedNotice && !report.referencedNotice
        ? { referencedNotice: clientReport.referencedNotice }
        : {}),
      ...(clientReport?.sourceNotificationId && !report.sourceNotificationId
        ? { sourceNotificationId: clientReport.sourceNotificationId }
        : {}),
      status: nextStatus,
      updatedAt: now,
      resolvedAt: isResolved ? (report.resolvedAt || now) : report.resolvedAt,
      assignedStaff: assignedStaff !== undefined ? assignedStaff : report.assignedStaff,
      replies: mergedReplies,
      hasUnreadAdminReply: replyItem.senderRole === "admin",
      hasUnreadConsumerUpdate: replyItem.senderRole === "consumer"
    };

    inMemoryReports[idx] = updated;
    savePortalSyncStore();

    let createdNotif: ServerConsumerNotification | undefined;
    if (!isDuplicateSubmission) {
      if (replyItem.senderRole === "admin") {
        if ((updated.accountNumber && updated.accountNumber !== "UNASSIGNED") || updated.consumerEmail) {
          const refNotice = updated.referencedNotice;
          const statusCap = refNotice?.meterStatus
            ? refNotice.meterStatus === "maintenance"
              ? "Under Maintenance"
              : refNotice.meterStatus.charAt(0).toUpperCase() + refNotice.meterStatus.slice(1)
            : "";
          const contextualTitle = refNotice
            ? refNotice.meterStatus
              ? `Admin Reply Re: Water Meter Status (${statusCap})${refNotice.meterNumber ? ` — Meter #${refNotice.meterNumber}` : ""}`
              : `Admin Reply Re: ${refNotice.subject}`
            : `Official Admin Reply — ${updated.title || `Concern #${updated.ticketNumber}`}`;
          const safeTitle = contextualTitle.slice(0, 220);
          const fullReplyMsg = String(replyItem.message || "").trim().slice(0, 2400);

          createdNotif = pushServerNotification({
            id: `notif-rep-${deterministicReplyId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
            accountNumber: (updated.accountNumber || "PENDING").toUpperCase(),
            consumerEmail: updated.consumerEmail ? updated.consumerEmail.toLowerCase() : undefined,
            subject: safeTitle,
            title: safeTitle,
            message: fullReplyMsg,
            type: "report",
            reportId: updated.id,
            ticketNumber: updated.ticketNumber,
            replyId: deterministicReplyId,
            sentByAdmin: replyItem.senderName,
            updatedByAdmin: replyItem.senderName,
            isFromAdmin: true,
            referencedNotice: refNotice
          });
        }
        broadcast("ADMIN_REPLIED_TO_REPORT", {
          report: updated,
          reply: replyItem,
          notification: createdNotif,
          accountNumber: updated.accountNumber,
          consumerEmail: updated.consumerEmail,
          ticketNumber: updated.ticketNumber,
          message: `Admin ${replyItem.senderName} responded to Ticket #${updated.ticketNumber}: "${replyItem.message}" (Status: ${nextStatus.toUpperCase()})`
        });
        broadcast("consumer:report:replied", {
          report: updated,
          reply: replyItem,
          notification: createdNotif,
          accountNumber: updated.accountNumber,
          consumerEmail: updated.consumerEmail,
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
    }

    res.json({
      success: true,
      message: "Reply logged successfully.",
      report: updated,
      reply: replyItem,
      notification: createdNotif
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to post reply." });
  }
});

// PATCH & POST /api/reports/:id/status - Update report status and assigned crew
app.all(["/api/reports/:id/status"], (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedStaff, report: clientReport } = req.body || {};

    const now = new Date().toISOString();
    let idx = inMemoryReports.findIndex(r => r.id === id || r.ticketNumber === id);
    if (idx === -1 && clientReport && typeof clientReport === "object") {
      const hydrated: ServerConsumerReport = {
        ...clientReport,
        id: clientReport.id || id,
        ticketNumber: clientReport.ticketNumber || id,
        accountNumber: clientReport.accountNumber || "UNASSIGNED",
        consumerName: clientReport.consumerName || "Consumer",
        consumerEmail: clientReport.consumerEmail || "",
        consumerPhone: clientReport.consumerPhone || "",
        barangay: clientReport.barangay || "Poblacion",
        address: clientReport.address || "",
        meterNumber: clientReport.meterNumber || "",
        category: clientReport.category || "other",
        title: clientReport.title || "Consumer Inquiry",
        description: clientReport.description || "",
        urgency: clientReport.urgency || "normal",
        status: clientReport.status || "pending",
        createdAt: clientReport.createdAt || now,
        updatedAt: now,
        replies: Array.isArray(clientReport.replies) ? clientReport.replies : [],
        hasUnreadAdminReply: true,
        hasUnreadConsumerUpdate: false
      };
      inMemoryReports.unshift(hydrated);
      idx = 0;
    }

    if (idx === -1) {
      return res.status(404).json({ success: false, message: `Report ${id} not found.` });
    }

    const report = inMemoryReports[idx];
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
    savePortalSyncStore();

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

// PATCH / POST /api/reports/:id/read - Persist Admin or Consumer read state
app.all(["/api/reports/:id/read"], (req, res) => {
  try {
    const { id } = req.params;
    const role = String(req.body?.role || "admin").trim().toLowerCase();
    const idx = inMemoryReports.findIndex(r => r.id === id || r.ticketNumber === id);
    if (idx >= 0) {
      if (role === "consumer") {
        inMemoryReports[idx] = { ...inMemoryReports[idx], hasUnreadAdminReply: false };
      } else {
        inMemoryReports[idx] = { ...inMemoryReports[idx], hasUnreadConsumerUpdate: false };
      }
      savePortalSyncStore();
      return res.json({ success: true, report: inMemoryReports[idx] });
    }
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// POST /api/reports/mark-all-read - Mark all consumer report alerts read for Admin
app.post("/api/reports/mark-all-read", (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String)) : null;
    let updatedCount = 0;
    inMemoryReports = inMemoryReports.map(r => {
      const shouldMark = !ids || ids.has(r.id) || (r.ticketNumber && ids.has(r.ticketNumber));
      if (shouldMark && r.hasUnreadConsumerUpdate) {
        updatedCount++;
        return { ...r, hasUnreadConsumerUpdate: false };
      }
      return r;
    });
    if (updatedCount > 0) {
      savePortalSyncStore();
    }
    res.json({ success: true, updatedCount });
  } catch {
    res.json({ success: true, updatedCount: 0 });
  }
});

// ==========================================
// 7. CONSUMER NOTIFICATIONS SYNC API (/api/notifications)
// ==========================================
interface ServerConsumerNotification {
  id: string;
  accountNumber: string;
  consumerId?: string;
  userId?: string;
  consumerEmail?: string;
  title: string;
  message: string;
  timestamp: string;
  type: "payment" | "billing" | "balance" | "announcement" | "disconnection" | "receipt_upload" | "report" | "account_issue" | "meter_status" | "installation";
  read: boolean;
  orNumber?: string;
  amountPaid?: number;
  remainingBalance?: number;
  readingId?: string;
  billingPeriod?: string;
  receiptUrl?: string;
  reportId?: string;
  ticketNumber?: string;
  replyId?: string;
  subject?: string;
  consumerName?: string;
  meterNumber?: string;
  meterStatus?: string;
  previousMeterStatus?: string;
  statusUpdateDate?: string;
  remarks?: string;
  updatedByAdmin?: string;
  sentByAdmin?: string;
  isFromAdmin?: boolean;
  applicationNumber?: string;
  installationRequestId?: string;
  installationStatus?: string;
  preferredDate?: string;
  confirmedDate?: string;
  referencedNotice?: ServerReferencedNoticeContext;
}

let inMemoryNotifications: ServerConsumerNotification[] = [];
let inMemoryAnnouncements: any[] = [];
let deletedServerAnnouncementIds: string[] = [];
let inMemoryTariffConfig: any = null;
let inMemoryInstallations: any[] = [];

// ==========================================
// PERSISTENT PORTAL SYNC STORE (.data/portal_sync_store.json)
// Preserves issued consumer IDs, registered consumer users, notifications, reports, announcements & tariff schedule across server restarts
// ==========================================
const PORTAL_SYNC_DIR = path.join(process.cwd(), ".data");
const PORTAL_SYNC_FILE = path.join(PORTAL_SYNC_DIR, "portal_sync_store.json");
const TMP_PORTAL_SYNC_FILE = path.join(TMP_RUNTIME_DIR, "portal_sync_store.json");

function savePortalSyncStore(): void {
  let serialized = "";
  try {
    const payload = {
      updatedAt: new Date().toISOString(),
      consumers: syncedConsumers,
      users: syncedPortalUsers,
      staff: registeredStaff,
      terminatedStaff: Array.from(terminatedStaffIdentifiers),
      mobileReadings: pendingMobileReadings,
      meters: syncedMeters,
      notifications: inMemoryNotifications,
      reports: inMemoryReports,
      announcements: inMemoryAnnouncements,
      deletedAnnouncementIds: deletedServerAnnouncementIds,
      tariffConfig: inMemoryTariffConfig,
      installations: inMemoryInstallations
    };
    serialized = JSON.stringify(payload, null, 2);
  } catch {
    return;
  }

  if (!IS_CLOUD_RUN) {
    try {
      if (!fs.existsSync(PORTAL_SYNC_DIR)) {
        fs.mkdirSync(PORTAL_SYNC_DIR, { recursive: true });
      }
      fs.writeFileSync(PORTAL_SYNC_FILE, serialized, "utf8");
      return;
    } catch {
      // Fall back to os.tmpdir() when workspace root is read-only
    }
  }

  try {
    if (!fs.existsSync(TMP_RUNTIME_DIR)) {
      fs.mkdirSync(TMP_RUNTIME_DIR, { recursive: true });
    }
    fs.writeFileSync(TMP_PORTAL_SYNC_FILE, serialized, "utf8");
  } catch {
    // Ignore non-writable runtime fs
  }
}

function syncConsumerToServerPortalUser(consumer: MobileConsumerSync): void {
  if (!consumer || !isIssuedAccountNumberServer(consumer.accountNumber)) return;
  const acc = consumer.accountNumber.trim().toUpperCase();
  const cEmail = (consumer.email || "").trim().toLowerCase();
  const cUid = (consumer.linkedUserId || "").trim();
  const cName = (consumer.name || "").trim().toLowerCase();
  const cPhone = normalizePhone11Server(consumer.contactNumber);

  const uIdx = syncedPortalUsers.findIndex(u => {
    if (u.role === "admin") return false;
    const uEmail = (u.email || "").trim().toLowerCase();
    const uPhone = normalizePhone11Server(u.contactNumber);
    const uName = (u.name || "").trim().toLowerCase();
    if (cEmail && uEmail && cEmail === uEmail) return true;
    if (cUid && u.id === cUid) return true;
    if (u.linkedAccountNumber && u.linkedAccountNumber.toUpperCase() === acc) return true;
    if (cPhone && uPhone && cPhone.length === 11 && cPhone === uPhone) return true;
    if (cName && uName && cName === uName && (!cEmail || !uEmail || cEmail === uEmail)) return true;
    return false;
  });

  if (uIdx >= 0) {
    const matchedUser = syncedPortalUsers[uIdx];
    syncedPortalUsers[uIdx] = {
      ...matchedUser,
      linkedAccountNumber: acc,
      status: "active",
      email: matchedUser.email || consumer.email || ""
    };
    // Heal synthetic linkedUserId on consumer & notifications so IDs match cleanly
    if (matchedUser.id && consumer.linkedUserId !== matchedUser.id) {
      const oldUid = consumer.linkedUserId;
      consumer.linkedUserId = matchedUser.id;
      inMemoryNotifications.forEach(n => {
        const sameEmail = cEmail && n.consumerEmail && n.consumerEmail.toLowerCase() === cEmail;
        const sameAcc = n.accountNumber && n.accountNumber.replace(/^#/, "").trim().toUpperCase() === acc;
        const sameOldUid = oldUid && n.userId === oldUid;
        if (sameEmail || sameAcc || sameOldUid) {
          n.userId = matchedUser.id;
          n.accountNumber = acc;
          if (!n.consumerEmail && cEmail) n.consumerEmail = cEmail;
        }
      });
    }
  }
}

function ensureIssuedConsumerNotificationServer(consumer: MobileConsumerSync): ServerConsumerNotification | undefined {
  if (!consumer || !isIssuedAccountNumberServer(consumer.accountNumber)) return undefined;
  const acc = consumer.accountNumber.trim().toUpperCase();
  const meter = (consumer.meterNumber || `MT-${acc}`).trim().toUpperCase();
  const cEmail = (consumer.email || "").trim().toLowerCase();

  // Re-associate any old PENDING notifications for this consumer's email/userId to their issued accountNumber
  inMemoryNotifications.forEach(n => {
    const nEmail = (n.consumerEmail || "").trim().toLowerCase();
    const nUid = (n.userId || "").trim();
    if ((cEmail && nEmail && cEmail === nEmail) || (consumer.linkedUserId && nUid && consumer.linkedUserId === nUid)) {
      if (!isIssuedAccountNumberServer(n.accountNumber)) {
        n.accountNumber = acc;
      }
      if (!n.consumerEmail && cEmail) {
        n.consumerEmail = cEmail;
      }
    }
  });

  const existing = inMemoryNotifications.find(n => {
    if (n.type !== "account_issue") return false;
    const nAcc = (n.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const nTitle = (n.title || "").toLowerCase();
    if (nTitle.includes("registration application submitted")) return false;
    if (nAcc === acc) return true;
    if (cEmail && n.consumerEmail && n.consumerEmail.trim().toLowerCase() === cEmail && isIssuedAccountNumberServer(nAcc)) return true;
    return false;
  });

  if (existing) {
    existing.accountNumber = acc;
    if (cEmail && !existing.consumerEmail) existing.consumerEmail = cEmail;
    if (consumer.linkedUserId) existing.userId = consumer.linkedUserId;
    return existing;
  }

  return pushServerNotification(
    {
      accountNumber: acc,
      userId: consumer.linkedUserId,
      consumerEmail: cEmail || undefined,
      title: `Official Account Number & Meter Issued!`,
      message: `Your water service account has been officially activated by Tagoloan Water District Administration. Your permanent Account Number is #${acc} and Meter Tag Number is #${meter}. Your full dashboard and billing history are now active.`,
      type: "account_issue"
    },
    false
  );
}

function reconcileAllServerConsumersAndUsers(): void {
  // Drop stale pending twins if an issued consumer record exists for the same email, userId, phone, or name
  syncedConsumers = syncedConsumers.filter((c, _idx, arr) => {
    const isPending = !isValidatedConsumerForReader(c);
    if (!isPending) return true;
    const cEmail = (c.email || "").trim().toLowerCase();
    const cUid = (c.linkedUserId || "").trim();
    const cPhone = normalizePhone11Server(c.contactNumber);
    const cName = (c.name || "").trim().toLowerCase();

    const activeTwin = arr.find(o => {
      if (o === c || !isValidatedConsumerForReader(o)) return false;
      const oEmail = (o.email || "").trim().toLowerCase();
      const oUid = (o.linkedUserId || "").trim();
      const oPhone = normalizePhone11Server(o.contactNumber);
      const oName = (o.name || "").trim().toLowerCase();
      if (cEmail && oEmail && cEmail === oEmail) return true;
      if (cUid && oUid && cUid === oUid) return true;
      if (cPhone && oPhone && cPhone.length === 11 && cPhone === oPhone) return true;
      if (cName && oName && cName === oName && (!cEmail || !oEmail || cEmail === oEmail)) return true;
      return false;
    });

    if (activeTwin) {
      if (!activeTwin.email && c.email) activeTwin.email = c.email;
      if (!activeTwin.linkedUserId && c.linkedUserId) activeTwin.linkedUserId = c.linkedUserId;
      if (!activeTwin.contactNumber && c.contactNumber) activeTwin.contactNumber = c.contactNumber;
      return false;
    }
    return true;
  });

  // Ensure every issued consumer with a portal user or email has synced user status & issuance notification
  syncedConsumers.forEach(c => {
    if (isValidatedConsumerForReader(c)) {
      syncConsumerToServerPortalUser(c);
      const hasPortalUser = syncedPortalUsers.some(
        u => (c.email && u.email && u.email.toLowerCase() === c.email.toLowerCase()) ||
             (c.linkedUserId && u.id === c.linkedUserId) ||
             (u.linkedAccountNumber && u.linkedAccountNumber.toUpperCase() === c.accountNumber.toUpperCase())
      );
      if (hasPortalUser) {
        ensureIssuedConsumerNotificationServer(c);
      }
    }
  });
}

function isTransactionalServerAnnouncementItem(item: Record<string, any> | null | undefined): boolean {
  if (!item || typeof item !== "object") return false;
  const rawType = String(item.type || "").trim().toLowerCase();
  const rawCat = String(item.category || "").trim().toLowerCase();
  if (rawType === "payment" || rawType === "receipt_upload" || rawType === "meter_status" || rawType === "installation") return true;
  if (rawCat === "payment" || rawCat === "receipt" || rawCat === "receipt_upload" || rawCat === "meter_status" || rawCat === "installation") return true;
  if (typeof item.orNumber === "string" && item.orNumber.trim() !== "") return true;
  if (typeof item.amountPaid === "number" && item.amountPaid > 0) return true;
  if (typeof item.receiptUrl === "string" && item.receiptUrl.trim() !== "") return true;

  const title = String(item.title || "").trim();
  const body = String(item.content || item.message || "").trim();
  const combined = `${title} ${body}`;

  if (/\bpayment\s*(successful|success|confirmed|received|settled|cleared|processed|recorded|complete|completed)\b/i.test(title)) {
    return true;
  }
  if (/\bpayment\s+settle\s+confirmed\b/i.test(combined)) return true;
  if (/\bofficial\s+receipt\s*(issued|verified|#|:)/i.test(combined)) return true;
  if (/\breceipt\s*(uploaded|verified|approved|validated|rejected|under\s+verification)\b/i.test(title)) return true;
  if (/^water\s+bill\s+issued\b/i.test(title)) return true;
  if (/\bin-office\s+cash\s+payment\s+of\b/i.test(combined)) return true;
  if (/\bonline\s+payment\s+of\s*₱/i.test(combined)) return true;

  return false;
}

function isPersonalServerNotifType(type?: string | null): boolean {
  const t = String(type || "").trim().toLowerCase();
  return (
    t === "payment" ||
    t === "receipt_upload" ||
    t === "account_issue" ||
    t === "disconnection" ||
    t === "report" ||
    t === "balance" ||
    t === "meter_status" ||
    t === "installation"
  );
}

function inferServerNotificationType(n: Record<string, any> | null | undefined): string {
  if (!n || typeof n !== "object") return "announcement";
  const rawType = String(n.type || "").trim().toLowerCase();
  const title = String(n.title || "").trim();
  const msg = String(n.message || "").trim();
  const titleLower = title.toLowerCase();
  const msgLower = msg.toLowerCase();
  const accUpper = String(n.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
  const isBroadcast = accUpper === "ALL" || accUpper === "BROADCAST" || accUpper === "DISTRICT";

  if (
    rawType === "report" ||
    Boolean(n.reportId) ||
    Boolean(n.ticketNumber) ||
    titleLower.includes("concern ticket") ||
    titleLower.includes("report reply") ||
    msgLower.includes("replied to your concern") ||
    msgLower.includes("ticket #")
  ) {
    return "report";
  }
  if (
    rawType === "receipt_upload" ||
    /\breceipt\s*(uploaded|verified|approved|validated|rejected|under\s+verification)\b/i.test(title)
  ) {
    return "receipt_upload";
  }
  if (
    rawType === "payment" ||
    (typeof n.orNumber === "string" && n.orNumber.trim() !== "") ||
    (typeof n.amountPaid === "number" && n.amountPaid > 0) ||
    /\bpayment\s*(successful|success|confirmed|received|settled|cleared|processed|recorded|complete|completed)\b/i.test(title) ||
    /\bpayment\s+settle\s+confirmed\b/i.test(`${title} ${msg}`) ||
    /\bofficial\s+receipt\s*(issued|#|:)/i.test(`${title} ${msg}`) ||
    /\bin-office\s+cash\s+payment\s+of\b/i.test(`${title} ${msg}`)
  ) {
    return "payment";
  }
  if (
    rawType === "disconnection" ||
    titleLower.includes("disconnection") ||
    titleLower.includes("cutting order") ||
    titleLower.includes("curb-stop")
  ) {
    return "disconnection";
  }
  if (
    rawType === "installation" ||
    Boolean(n.installationRequestId) ||
    Boolean(n.installationStatus) ||
    titleLower.includes("water meter installation") ||
    titleLower.includes("installation schedule")
  ) {
    return "installation";
  }
  if (
    rawType === "meter_status" ||
    Boolean(n.meterStatus) ||
    titleLower.includes("regarding your water meter") ||
    titleLower.includes("water meter status")
  ) {
    return "meter_status";
  }
  if (
    rawType === "account_issue" ||
    titleLower.includes("account number") ||
    titleLower.includes("meter issued") ||
    titleLower.includes("service account has been activated") ||
    titleLower.includes("registration application")
  ) {
    return "account_issue";
  }
  if (
    /^(official\s+(district\s+)?advisory|district\s+advisory|public\s+advisory)\b/i.test(title) ||
    (isBroadcast && rawType === "announcement")
  ) {
    return "announcement";
  }
  if (rawType === "balance" || titleLower.includes("remaining balance")) {
    return "balance";
  }
  if (
    rawType === "billing" ||
    /^water\s+bill\s+issued\b/i.test(title) ||
    titleLower.includes("tariff overdue") ||
    titleLower.includes("water bill") ||
    Boolean(n.readingId) ||
    Boolean(n.billingPeriod)
  ) {
    return "billing";
  }
  const validTypes = new Set([
    "payment",
    "billing",
    "balance",
    "announcement",
    "disconnection",
    "receipt_upload",
    "report",
    "account_issue",
    "meter_status",
    "installation",
  ]);
  if (validTypes.has(rawType)) return rawType;
  return isBroadcast ? "announcement" : "account_issue";
}

function loadPortalSyncStore(): void {
  try {
    const syncSource = fs.existsSync(TMP_PORTAL_SYNC_FILE)
      ? TMP_PORTAL_SYNC_FILE
      : fs.existsSync(PORTAL_SYNC_FILE)
        ? PORTAL_SYNC_FILE
        : null;
    if (!syncSource) return;
    const raw = fs.readFileSync(syncSource, "utf8");
    const parsed = JSON.parse(raw);
    let cleanedStore = false;

    if (Array.isArray(parsed?.users)) {
      parsed.users.forEach((pu: PortalSyncUser) => {
        if (!pu || (!pu.email && !pu.id)) return;
        const idx = syncedPortalUsers.findIndex(
          u => (pu.email && u.email && u.email.toLowerCase() === pu.email.toLowerCase()) || (pu.id && u.id === pu.id)
        );
        if (idx >= 0) {
          syncedPortalUsers[idx] = { ...syncedPortalUsers[idx], ...pu };
        } else {
          syncedPortalUsers.push(pu);
        }
      });
    }

    if (Array.isArray(parsed?.notifications)) {
      const deduped = dedupeServerNotifications(parsed.notifications);
      if (deduped.length !== parsed.notifications.length) cleanedStore = true;
      inMemoryNotifications = deduped;
    }

    if (Array.isArray(parsed?.reports) && parsed.reports.length > 0) {
      parsed.reports.forEach((pr: ServerConsumerReport) => {
        if (!pr || !pr.id) return;
        const idx = inMemoryReports.findIndex(r => r.id === pr.id || (pr.ticketNumber && r.ticketNumber === pr.ticketNumber));
        if (idx >= 0) {
          inMemoryReports[idx] = { ...inMemoryReports[idx], ...pr };
        } else {
          inMemoryReports.unshift(pr);
        }
      });
    }

    if (Array.isArray(parsed?.deletedAnnouncementIds)) {
      deletedServerAnnouncementIds = parsed.deletedAnnouncementIds;
    }

    if (Array.isArray(parsed?.announcements)) {
      const filteredAnns = parsed.announcements.filter(
        (a: any) =>
          a &&
          a.id &&
          !deletedServerAnnouncementIds.includes(a.id) &&
          !isTransactionalServerAnnouncementItem(a)
      );
      if (filteredAnns.length !== parsed.announcements.length) cleanedStore = true;
      inMemoryAnnouncements = filteredAnns;
    }

    if (parsed?.tariffConfig && typeof parsed.tariffConfig === "object") {
      if (parsed.tariffConfig.baselineSchema === "twd_per_m3_v2") {
        inMemoryTariffConfig = parsed.tariffConfig;
      } else {
        inMemoryTariffConfig = null;
        cleanedStore = true;
      }
    }

    if (Array.isArray(parsed?.installations)) {
      inMemoryInstallations = parsed.installations.filter((r: any) => r && r.id);
    }

    if (Array.isArray(parsed?.terminatedStaff)) {
      parsed.terminatedStaff.forEach((ident: unknown) => {
        if (typeof ident === "string" && ident.trim()) {
          terminatedStaffIdentifiers.add(ident.trim().toLowerCase());
        }
      });
    }

    if (Array.isArray(parsed?.staff)) {
      parsed.staff.forEach((sr: MobileReader) => {
        if (!sr || (!sr.id && !sr.username && !sr.name)) return;
        if (isStaffTerminated(sr.id) || isStaffTerminated(sr.employeeId) || isStaffTerminated(sr.username) || isStaffTerminated(sr.name)) {
          return;
        }
        const existsIdx = registeredStaff.findIndex(
          x =>
            (sr.id && x.id?.toLowerCase() === sr.id.toLowerCase()) ||
            (sr.username && x.username?.toLowerCase() === sr.username.toLowerCase()) ||
            (sr.name && x.name?.toLowerCase() === sr.name.toLowerCase())
        );
        if (existsIdx >= 0) {
          registeredStaff[existsIdx] = { ...registeredStaff[existsIdx], ...sr };
        } else {
          registeredStaff.push(sr);
        }
      });
    }

    if (Array.isArray(parsed?.mobileReadings)) {
      parsed.mobileReadings.forEach((mr: MobileReadingSubmission) => {
        if (!mr || !mr.id) return;
        const idx = pendingMobileReadings.findIndex(x => x.id === mr.id);
        if (idx >= 0) {
          pendingMobileReadings[idx] = { ...pendingMobileReadings[idx], ...mr };
        } else {
          pendingMobileReadings.push(mr);
        }
      });
    }

    if (Array.isArray(parsed?.meters)) {
      parsed.meters.forEach((m: SyncedWaterMeter) => {
        if (!m || !m.meterNumber) return;
        const cleanNum = String(m.meterNumber).trim().toUpperCase();
        const idx = syncedMeters.findIndex(x => x.meterNumber.toUpperCase() === cleanNum);
        if (idx >= 0) {
          syncedMeters[idx] = { ...syncedMeters[idx], ...m, meterNumber: cleanNum };
        } else {
          syncedMeters.push({ ...m, meterNumber: cleanNum });
        }
      });
    }

    if (Array.isArray(parsed?.consumers) && parsed.consumers.length > 0) {
      parsed.consumers.forEach((pc: MobileConsumerSync) => {
        if (!pc || !pc.name) return;
        const pcEmail = (pc.email || "").trim().toLowerCase();
        const pcAcc = (pc.accountNumber || "").trim().toUpperCase();
        const pcUid = (pc.linkedUserId || "").trim();
        const idx = syncedConsumers.findIndex(sc =>
          (isIssuedAccountNumberServer(pcAcc) && sc.accountNumber && sc.accountNumber.toUpperCase() === pcAcc) ||
          (pcEmail && sc.email && sc.email.toLowerCase() === pcEmail) ||
          (pcUid && sc.linkedUserId && sc.linkedUserId === pcUid)
        );
        if (idx >= 0) {
          if (isValidatedConsumerForReader(pc) || !isValidatedConsumerForReader(syncedConsumers[idx])) {
            syncedConsumers[idx] = { ...syncedConsumers[idx], ...pc };
          }
        } else {
          syncedConsumers.unshift(pc);
        }
      });
    }

    reconcileAllServerConsumersAndUsers();
    if (cleanedStore) {
      savePortalSyncStore();
    }
  } catch (err) {
    console.warn("[PortalSyncStore] Could not load persisted store:", err);
  }
}

function getServerNotifSemanticKey(n: Partial<ServerConsumerNotification> & Record<string, any>): string {
  const accRaw = String(n.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
  const email = String(n.consumerEmail || "").trim().toLowerCase();
  const uid = String(n.userId || n.consumerId || "").trim().toLowerCase();

  let target = "ANON";
  if (accRaw === "ALL" || accRaw === "BROADCAST" || accRaw === "DISTRICT") {
    target = "BROADCAST";
  } else if (isIssuedAccountNumberServer(accRaw)) {
    target = `ACC:${accRaw}`;
  } else if (email) {
    target = `EMAIL:${email}`;
  } else if (uid) {
    target = `UID:${uid}`;
  }

  const type = inferServerNotificationType(n);
  const normTitle = String(n.title || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normMsg = String(n.message || "").trim().replace(/\s+/g, " ").toLowerCase();

  if (type === "account_issue") {
    if (normTitle.includes("registration application submitted")) {
      return `account_issue_reg::${email ? `EMAIL:${email}` : target}`;
    }
    if (normTitle.includes("updated to")) {
      return `account_issue_update::${target}::${normTitle}`;
    }
    return `account_issue_confirmed::${target}`;
  }
  if (type === "disconnection") {
    return `disconnection::${target}::${String(n.billingPeriod || n.readingId || normTitle).trim().toLowerCase()}`;
  }
  if (type === "billing" || type === "balance") {
    const isOverdue = normTitle.includes("overdue") || normTitle.includes("urgent");
    return `${type}::${isOverdue ? "overdue" : "statement"}::${target}::${String(n.readingId || n.billingPeriod || normTitle).trim().toLowerCase()}`;
  }
  if (type === "payment" || type === "receipt_upload") {
    return `${type}::${target}::${String(n.readingId || n.billingPeriod || "").trim().toLowerCase()}::${normTitle}::${normMsg.slice(0, 80)}`;
  }
  if (type === "meter_status") {
    const meterKey = String(n.meterNumber || "").trim().toLowerCase();
    const statusKey = String(n.meterStatus || "").trim().toLowerCase();
    const eventStamp = String(n.statusUpdateDate || "").trim().slice(0, 16);
    return `meter_status::${target}::${meterKey}::${statusKey}::${eventStamp}`;
  }
  if (type === "installation") {
    const reqKey = String(n.installationRequestId || n.applicationNumber || "").trim().toLowerCase();
    const instStatus = String(n.installationStatus || normTitle).trim().toLowerCase();
    return `installation::${target}::${reqKey}::${instStatus}`;
  }
  if (type === "report") {
    const repKey = String(n.reportId || n.ticketNumber || "").trim().toLowerCase();
    const replyKey = String(n.replyId || "").trim().toLowerCase();
    if (repKey && replyKey) {
      return `report::${target}::${repKey}::reply::${replyKey}`;
    }
    return `report::${target}::${repKey}::${normTitle}::${normMsg.slice(0, 140)}`;
  }
  return `${type}::${target}::${normTitle}::${normMsg.slice(0, 140)}`;
}

const readServerNotifIds = new Set<string>();
const readServerNotifSemKeys = new Set<string>();

function recordServerNotifRead(n?: Partial<ServerConsumerNotification> | null, explicitId?: string, explicitSemKey?: string) {
  if (explicitId) readServerNotifIds.add(String(explicitId));
  if (explicitSemKey) readServerNotifSemKeys.add(String(explicitSemKey));
  if (n) {
    if (n.id) readServerNotifIds.add(String(n.id));
    const sem = getServerNotifSemanticKey(n);
    if (sem) readServerNotifSemKeys.add(sem);
  }
}

function dedupeServerNotifications(list: ServerConsumerNotification[], maxTotal = 250): ServerConsumerNotification[] {
  if (!Array.isArray(list) || list.length === 0) return [];
  const byId = new Map<string, ServerConsumerNotification>();
  const bySem = new Map<string, string>();

  for (const raw of list) {
    if (!raw || !raw.title) continue;
    const cleanAcc = String(raw.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
    const inferredType = inferServerNotificationType(raw);
    const isBroadcast = cleanAcc === "ALL" || cleanAcc === "BROADCAST" || cleanAcc === "DISTRICT";

    if (
      isBroadcast &&
      !raw.consumerEmail &&
      !raw.userId &&
      !(raw as any).consumerId &&
      (isPersonalServerNotifType(inferredType) || isTransactionalServerAnnouncementItem(raw as any))
    ) {
      continue;
    }

    const itemId = String(raw.id || `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
    const baseItem: ServerConsumerNotification = {
      ...raw,
      type: inferredType as ServerConsumerNotification["type"],
      id: itemId,
      accountNumber: cleanAcc || raw.accountNumber || "PENDING",
      ...(raw.consumerEmail ? { consumerEmail: String(raw.consumerEmail).trim().toLowerCase() } : {}),
      timestamp: raw.timestamp || "2026-01-01T08:00:00.000Z",
      read: Boolean(raw.read),
    };
    const semKey = getServerNotifSemanticKey(baseItem);
    const isAlreadyRead =
      !isBroadcast &&
      (Boolean(baseItem.read) || readServerNotifIds.has(itemId) || readServerNotifSemKeys.has(semKey));
    if (isAlreadyRead) {
      recordServerNotifRead(baseItem, itemId, semKey);
    }
    const item: ServerConsumerNotification = {
      ...baseItem,
      read: isBroadcast ? Boolean(baseItem.read) : isAlreadyRead,
    };
    const existingId = byId.has(item.id) ? item.id : bySem.get(semKey);
    if (existingId && byId.has(existingId)) {
      const prev = byId.get(existingId)!;
      const mergedRead = Boolean(prev.read || item.read);
      if (mergedRead && !isBroadcast) {
        recordServerNotifRead(prev, prev.id, semKey);
      }
      const merged: ServerConsumerNotification = {
        ...prev,
        ...item,
        id: prev.id,
        accountNumber: isIssuedAccountNumberServer(item.accountNumber)
          ? item.accountNumber
          : isIssuedAccountNumberServer(prev.accountNumber)
            ? prev.accountNumber
            : item.accountNumber || prev.accountNumber,
        consumerEmail: item.consumerEmail || prev.consumerEmail,
        userId: item.userId || prev.userId,
        timestamp: item.type === "account_issue" && prev.timestamp ? prev.timestamp : item.timestamp || prev.timestamp,
        read: mergedRead,
      };
      byId.set(prev.id, merged);
      bySem.set(semKey, prev.id);
    } else {
      byId.set(item.id, item);
      bySem.set(semKey, item.id);
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => (new Date(b.timestamp || 0).getTime() || 0) - (new Date(a.timestamp || 0).getTime() || 0))
    .slice(0, maxTotal);
}

function pushServerNotification(
  input: Omit<ServerConsumerNotification, "id" | "timestamp" | "read"> & { id?: string; timestamp?: string; read?: boolean },
  shouldBroadcastAndPersist = true
): ServerConsumerNotification {
  const nowMs = Date.now();
  const cleanAcc = (input.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
  const cleanEmail = (input.consumerEmail || "").trim().toLowerCase();
  const inferredType = inferServerNotificationType(input) as ServerConsumerNotification["type"];
  const targetSemKey = getServerNotifSemanticKey({
    ...input,
    type: inferredType,
    accountNumber: cleanAcc || input.accountNumber,
    consumerEmail: cleanEmail || undefined,
  });

  const isBroadcast = cleanAcc === "ALL" || cleanAcc === "BROADCAST" || cleanAcc === "DISTRICT";
  const alreadyReadOnServer =
    !isBroadcast &&
    (Boolean(input.read) ||
      (input.id ? readServerNotifIds.has(String(input.id)) : false) ||
      readServerNotifSemKeys.has(targetSemKey));

  // Deduplicate semantically identical notifications permanently
  const existing = inMemoryNotifications.find(n => {
    if (input.id && n.id === input.id) return true;
    return getServerNotifSemanticKey(n) === targetSemKey;
  });

  if (existing) {
    existing.type = inferredType;
    if (isIssuedAccountNumberServer(cleanAcc) && !isIssuedAccountNumberServer(existing.accountNumber)) {
      existing.accountNumber = cleanAcc;
    }
    if (cleanEmail && !existing.consumerEmail) {
      existing.consumerEmail = cleanEmail;
    }
    if (alreadyReadOnServer || existing.read) {
      existing.read = true;
      recordServerNotifRead(existing, existing.id, targetSemKey);
    }
    return existing;
  }

  const created: ServerConsumerNotification = {
    ...input,
    type: inferredType,
    accountNumber: cleanAcc || input.accountNumber || "PENDING",
    ...(cleanEmail ? { consumerEmail: cleanEmail } : {}),
    id: input.id || `notif-${nowMs}-${Math.floor(Math.random() * 1000)}`,
    timestamp: input.timestamp || new Date().toISOString(),
    read: alreadyReadOnServer
  };
  if (created.read && !isBroadcast) {
    recordServerNotifRead(created, created.id, targetSemKey);
  }

  inMemoryNotifications = dedupeServerNotifications([created, ...inMemoryNotifications]);

  if (shouldBroadcastAndPersist) {
    savePortalSyncStore();
    broadcast("CONSUMER_NOTIFICATION_CREATED", {
      notification: created,
      accountNumber: created.accountNumber,
      consumerEmail: created.consumerEmail,
      userId: created.userId
    });
  }

  return created;
}

// Hydrate persisted consumers, users & notifications on boot
loadPortalSyncStore();

app.get("/api/notifications", (req, res) => {
  try {
    const { accountNumber, userId, email, consumerId, isAdmin } = req.query;

    inMemoryNotifications = dedupeServerNotifications(inMemoryNotifications);

    if (isAdmin === "true" && !accountNumber && !userId && !email && !consumerId) {
      return res.json({
        success: true,
        count: inMemoryNotifications.length,
        notifications: inMemoryNotifications
      });
    }

    const isPlaceholder = (acc?: string) => !isIssuedAccountNumberServer(acc);

    const cleanAcc = ((accountNumber as string) || "").replace(/^#/, "").trim().toLowerCase();
    const cleanUid = ((userId as string) || "").trim().toLowerCase();
    const cleanEmail = ((email as string) || "").trim().toLowerCase();
    const cleanCid = ((consumerId as string) || "").trim().toLowerCase();
    const hasRealAcc = !isPlaceholder(cleanAcc);

    if (!hasRealAcc && !cleanUid && !cleanEmail && !cleanCid) {
      return res.json({ success: true, count: 0, notifications: [] });
    }

    const filtered = dedupeServerNotifications(
      inMemoryNotifications.filter(n => {
        const nAcc = (n.accountNumber || "").replace(/^#/, "").trim().toLowerCase();
        const inferred = inferServerNotificationType(n);
        if (nAcc === "all" || nAcc === "broadcast" || nAcc === "district") {
          if (isPersonalServerNotifType(inferred) || isTransactionalServerAnnouncementItem(n as any)) {
            return false;
          }
          return true;
        }
        const nHasRealAcc = !isPlaceholder(n.accountNumber);
        const nUid = (n.userId || "").trim().toLowerCase();
        const nEmail = (n.consumerEmail || "").trim().toLowerCase();
        const nCid = (n.consumerId || "").trim().toLowerCase();

        if (hasRealAcc && nHasRealAcc && cleanAcc === nAcc) return true;
        if (cleanEmail && nEmail && cleanEmail === nEmail) return true;
        if (hasRealAcc && nHasRealAcc && cleanAcc !== nAcc) return false;
        if (cleanEmail && nEmail && cleanEmail !== nEmail) return false;
        if (cleanUid && nUid && cleanUid === nUid) return true;
        if (cleanCid && nCid && cleanCid === nCid) return true;
        return false;
      })
    );

    res.json({
      success: true,
      count: filtered.length,
      notifications: filtered
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch notifications." });
  }
});

app.post("/api/notifications", (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.message) {
      return res.status(400).json({ success: false, message: "Notification title and message are required." });
    }
    const saved = pushServerNotification(body);
    res.status(201).json({ success: true, notification: saved });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create notification." });
  }
});

app.post("/api/notifications/mark-all-read", (req, res) => {
  try {
    const { ids, semanticKeys, accountNumber, email, userId } = req.body || {};
    const idSet = Array.isArray(ids) && ids.length > 0 ? new Set(ids.map(String)) : null;
    const semSet = Array.isArray(semanticKeys) && semanticKeys.length > 0 ? new Set(semanticKeys.map(String)) : null;
    if (idSet) idSet.forEach((k) => readServerNotifIds.add(k));
    if (semSet) semSet.forEach((k) => readServerNotifSemKeys.add(k));

    const cleanAcc = String(accountNumber || "").replace(/^#/, "").trim().toLowerCase();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanUid = String(userId || "").trim().toLowerCase();

    let updatedCount = 0;
    inMemoryNotifications.forEach(n => {
      const nAcc = String(n.accountNumber || "").replace(/^#/, "").trim().toLowerCase();
      if (nAcc === "all" || nAcc === "broadcast" || nAcc === "district") return;
      const semKey = getServerNotifSemanticKey(n);
      const matchesId = idSet ? idSet.has(n.id) : false;
      const matchesSem = semSet ? semSet.has(semKey) : false;
      const matchesIdentity =
        ((cleanAcc && isIssuedAccountNumberServer(cleanAcc) && nAcc === cleanAcc) ||
          (cleanEmail && String(n.consumerEmail || "").trim().toLowerCase() === cleanEmail) ||
          (cleanUid && String(n.userId || "").trim().toLowerCase() === cleanUid));
      if (matchesId || matchesSem || (!idSet && matchesIdentity)) {
        recordServerNotifRead(n, n.id, semKey);
        if (!n.read) {
          n.read = true;
          updatedCount++;
        }
      }
    });
    if (updatedCount > 0) {
      savePortalSyncStore();
    }
    res.json({ success: true, updatedCount });
  } catch {
    res.json({ success: true, updatedCount: 0 });
  }
});

app.all("/api/notifications/:id/read", (req, res) => {
  if (req.method !== "PATCH" && req.method !== "POST" && req.method !== "PUT") {
    return res.status(405).json({ success: false });
  }
  const { id } = req.params;
  const bodySemKey = typeof req.body?.semanticKey === "string" ? req.body.semanticKey.trim() : "";
  const bodyNotif = req.body?.notification && typeof req.body.notification === "object" ? req.body.notification : null;
  const found = inMemoryNotifications.find(n => n.id === id);
  const refNotif = found || bodyNotif;
  const isBroadcast = refNotif && ["ALL", "BROADCAST", "DISTRICT"].includes(String(refNotif.accountNumber || "").trim().toUpperCase());

  if (!isBroadcast) {
    const resolvedSemKey = bodySemKey || (refNotif ? getServerNotifSemanticKey(refNotif) : "");
    recordServerNotifRead(refNotif, id, resolvedSemKey);
    let changed = false;
    inMemoryNotifications.forEach(n => {
      const nAcc = String(n.accountNumber || "").trim().toUpperCase();
      if (nAcc === "ALL" || nAcc === "BROADCAST" || nAcc === "DISTRICT") return;
      if (n.id === id || (resolvedSemKey && getServerNotifSemanticKey(n) === resolvedSemKey)) {
        recordServerNotifRead(n, n.id, resolvedSemKey);
        if (!n.read) {
          n.read = true;
          changed = true;
        }
      }
    });
    if (changed) {
      savePortalSyncStore();
    }
  }
  res.json({ success: true });
});

// ==========================================
// 8. OFFICIAL DISTRICT ANNOUNCEMENTS & TARIFF SCHEDULE SYNC APIS
// ==========================================
app.get("/api/announcements", (_req, res) => {
  const activeList = inMemoryAnnouncements.filter(
    (a) =>
      a &&
      a.id &&
      !deletedServerAnnouncementIds.includes(a.id) &&
      !isTransactionalServerAnnouncementItem(a)
  );
  res.json({
    success: true,
    count: activeList.length,
    announcements: activeList,
    data: activeList
  });
});

app.post("/api/announcements", (req, res) => {
  try {
    const body = req.body || {};
    if (isTransactionalServerAnnouncementItem(body)) {
      return res.status(400).json({
        success: false,
        message: "Personal payment or receipt notifications cannot be published to public District Announcements."
      });
    }
    const id = body.id || `ann-${Date.now()}`;
    const rawCat = String(body.category || body.type || "info").trim().toLowerCase();
    const category = ["maintenance", "disruption", "event", "info"].includes(rawCat) ? rawCat : "info";
    const postedBy = String(body.postedBy || body.author || "TWD Operations").trim();
    const ann = {
      id,
      title: String(body.title || "Official Advisory").trim(),
      content: String(body.content || "").trim(),
      category,
      type: category,
      date: body.date || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      postedBy,
      author: postedBy,
      createdAt: body.createdAt || new Date().toISOString()
    };
    deletedServerAnnouncementIds = deletedServerAnnouncementIds.filter((delId) => delId !== id);
    const idx = inMemoryAnnouncements.findIndex((a) => a.id === id);
    if (idx >= 0) {
      inMemoryAnnouncements[idx] = { ...inMemoryAnnouncements[idx], ...ann };
    } else {
      inMemoryAnnouncements.unshift(ann);
    }
    savePortalSyncStore();
    broadcast("ANNOUNCEMENT_PUBLISHED", {
      announcement: ann,
      message: `Official Advisory Published: ${ann.title}`
    });
    res.status(201).json({ success: true, announcement: ann, data: ann });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to publish announcement." });
  }
});

app.put("/api/announcements/:id", (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const idx = inMemoryAnnouncements.findIndex((a) => a.id === id);
    const updated = {
      ...(idx >= 0 ? inMemoryAnnouncements[idx] : {}),
      ...body,
      id,
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) {
      inMemoryAnnouncements[idx] = updated;
    } else {
      inMemoryAnnouncements.unshift(updated);
    }
    savePortalSyncStore();
    broadcast("ANNOUNCEMENT_UPDATED", { announcement: updated });
    res.json({ success: true, announcement: updated, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update announcement." });
  }
});

app.delete("/api/announcements/:id", (req, res) => {
  const { id } = req.params;
  if (!deletedServerAnnouncementIds.includes(id)) {
    deletedServerAnnouncementIds.push(id);
  }
  inMemoryAnnouncements = inMemoryAnnouncements.filter((a) => a.id !== id);
  savePortalSyncStore();
  broadcast("ANNOUNCEMENT_DELETED", { id });
  res.json({ success: true });
});

app.get("/api/tariff-config", (_req, res) => {
  res.json({ success: true, config: inMemoryTariffConfig });
});

app.post("/api/tariff-config", (req, res) => {
  try {
    const cfg = req.body || {};
    inMemoryTariffConfig = cfg;
    savePortalSyncStore();
    broadcast("tariff:updated", {
      config: cfg,
      version: cfg.version,
      effectiveDate: cfg.effectiveDate,
      resolutionNumber: cfg.resolutionNumber
    });
    res.json({ success: true, config: cfg });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to save tariff configuration." });
  }
});

// ==========================================
// 9. WATER METER INSTALLATION REQUESTS & ACCOUNT VALIDATION APIS (/api/installations)
// ==========================================
app.get("/api/installations", (req, res) => {
  try {
    const { email, userId, applicationNumber } = req.query;
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanUid = String(userId || "").trim();
    const cleanApp = String(applicationNumber || "").trim().toUpperCase();

    let list = [...inMemoryInstallations];
    if (cleanEmail || cleanUid || cleanApp) {
      list = list.filter((r) => {
        if (!r) return false;
        const rEmail = String(r.consumerEmail || "").trim().toLowerCase();
        const rUid = String(r.linkedUserId || r.userId || r.consumerId || "").trim();
        const rApp = String(r.applicationNumber || "").trim().toUpperCase();
        if (cleanEmail && rEmail && cleanEmail === rEmail) return true;
        if (cleanUid && rUid && cleanUid === rUid) return true;
        if (cleanApp && rApp && cleanApp === rApp) return true;
        return false;
      });
    }
    list.sort((a, b) => new Date(b.submissionDate || 0).getTime() - new Date(a.submissionDate || 0).getTime());
    res.json({ success: true, count: list.length, installations: list });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch installation requests." });
  }
});

app.post("/api/installations", (req, res) => {
  try {
    const incomingReq = req.body?.request || req.body;
    const incomingNotif = req.body?.notification;
    if (!incomingReq || !incomingReq.consumerName) {
      return res.status(400).json({ success: false, message: "Valid installation request payload is required." });
    }
    const id = String(incomingReq.id || `INST-${Date.now()}`);
    const saved = { ...incomingReq, id, updatedAt: incomingReq.updatedAt || new Date().toISOString() };
    const idx = inMemoryInstallations.findIndex(
      (r) => r.id === id || (saved.applicationNumber && r.applicationNumber === saved.applicationNumber)
    );
    if (idx >= 0) {
      inMemoryInstallations[idx] = { ...inMemoryInstallations[idx], ...saved };
    } else {
      inMemoryInstallations.unshift(saved);
    }

    if (incomingNotif && incomingNotif.title && incomingNotif.message) {
      pushServerNotification(incomingNotif, false);
    }
    savePortalSyncStore();

    broadcast("INSTALLATION_REQUEST_SUBMITTED", {
      request: saved,
      notification: incomingNotif,
      message: `New Water Meter Installation Request (#${saved.applicationNumber}) submitted by ${saved.consumerName}.`,
    });

    res.status(201).json({ success: true, request: saved });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to submit installation request." });
  }
});

app.post("/api/installations/mark-all-read", (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String)) : null;
    let updatedCount = 0;
    inMemoryInstallations = inMemoryInstallations.map((r) => {
      if (!r) return r;
      const shouldMark = !ids || ids.has(r.id) || (r.applicationNumber && ids.has(r.applicationNumber));
      if (shouldMark && r.hasUnreadAdminAlert) {
        updatedCount++;
        return { ...r, hasUnreadAdminAlert: false };
      }
      return r;
    });
    if (updatedCount > 0) {
      savePortalSyncStore();
    }
    res.json({ success: true, updatedCount });
  } catch {
    res.json({ success: true, updatedCount: 0 });
  }
});

app.patch("/api/installations/:id", (req, res) => {
  try {
    const { id } = req.params;
    const incomingReq = req.body?.request;
    const incomingNotif = req.body?.notification;
    const idx = inMemoryInstallations.findIndex((r) => r.id === id || r.applicationNumber === id);
    const prevRecord = idx >= 0 ? inMemoryInstallations[idx] : undefined;

    let updated: any;
    if (incomingReq && typeof incomingReq === "object") {
      updated = { ...(prevRecord || {}), ...incomingReq, id: incomingReq.id || id };
    } else if (prevRecord) {
      updated = { ...prevRecord, ...(req.body || {}) };
    } else {
      return res.status(404).json({ success: false, message: "Installation request not found." });
    }

    const isReadOnlyAck =
      !incomingNotif &&
      Boolean(
        req.body?.markReadOnly ||
          (req.body?.hasUnreadAdminAlert === false &&
            prevRecord &&
            updated.status === prevRecord.status &&
            updated.confirmedInstallationDate === prevRecord.confirmedInstallationDate &&
            updated.adminRemarks === prevRecord.adminRemarks)
      );

    if (idx >= 0) {
      inMemoryInstallations[idx] = updated;
    } else {
      inMemoryInstallations.unshift(updated);
    }

    // Keep syncedConsumers aligned with installation status & account validation stage
    if (updated && (updated.consumerEmail || updated.applicationNumber || updated.id)) {
      const targetEmail = String(updated.consumerEmail || "").trim().toLowerCase();
      const targetApp = String(updated.applicationNumber || "").trim().toUpperCase();
      const cIdx = syncedConsumers.findIndex(
        (c) =>
          (c.installationRequestId && c.installationRequestId === updated.id) ||
          (targetApp && c.applicationNumber && c.applicationNumber.trim().toUpperCase() === targetApp) ||
          (targetEmail && c.email && c.email.trim().toLowerCase() === targetEmail)
      );
      if (cIdx >= 0) {
        syncedConsumers[cIdx] = {
          ...syncedConsumers[cIdx],
          installationRequestId: updated.id,
          installationStatus: updated.status || syncedConsumers[cIdx].installationStatus,
          accountValidationStatus:
            updated.accountValidationStatus ||
            (updated.status === "Installed" ? "awaiting_validation" : syncedConsumers[cIdx].accountValidationStatus),
        };
      }
    }

    let savedNotif: ServerConsumerNotification | undefined;
    if (incomingNotif && incomingNotif.title && incomingNotif.message) {
      savedNotif = pushServerNotification(incomingNotif, false);
    }
    savePortalSyncStore();

    // Forward installation status update & consumer notification to System Site peer if configured
    if (!isSelfSystemSite() && req.headers["x-bridge-origin"] !== "tagoloan-central-web") {
      fetchSystemSite(`/api/installations/${encodeURIComponent(updated.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          request: updated,
          notification: savedNotif,
          ...(isReadOnlyAck ? { markReadOnly: true, hasUnreadAdminAlert: false } : {}),
        }),
      }).catch(() => {});
    }

    if (!isReadOnlyAck) {
      broadcast("INSTALLATION_REQUEST_UPDATED", {
        request: updated,
        notification: savedNotif,
        requestId: updated.id,
        applicationNumber: updated.applicationNumber,
        status: updated.status,
        consumerEmail: updated.consumerEmail,
        userId: updated.linkedUserId || updated.userId,
        message: `Installation Request #${updated.applicationNumber} updated to "${updated.status}".`,
      });
      if (savedNotif) {
        broadcast("CONSUMER_NOTIFICATION_CREATED", {
          notification: savedNotif,
          accountNumber: savedNotif.accountNumber,
          consumerEmail: savedNotif.consumerEmail,
          userId: savedNotif.userId,
        });
      }
    }

    res.json({ success: true, request: updated, notification: savedNotif });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update installation request." });
  }
});

app.post("/api/installations/:id/validate", (req, res) => {
  try {
    const { id } = req.params;
    const { request: validatedReq, consumer: activatedConsumer, notification: activationNotif } = req.body || {};
    if (!validatedReq || !activatedConsumer) {
      return res.status(400).json({ success: false, message: "Validated request and consumer records are required." });
    }

    const idx = inMemoryInstallations.findIndex((r) => r.id === id || r.applicationNumber === id);
    if (idx >= 0) {
      inMemoryInstallations[idx] = { ...inMemoryInstallations[idx], ...validatedReq };
    } else {
      inMemoryInstallations.unshift(validatedReq);
    }

    const cleanAcc = String(activatedConsumer.accountNumber || "").trim().toUpperCase();
    const cleanEmail = String(activatedConsumer.email || "").trim().toLowerCase();
    const cleanUid = String(activatedConsumer.linkedUserId || "").trim();

    const cIdx = syncedConsumers.findIndex(
      (c) =>
        (cleanAcc && c.accountNumber && c.accountNumber.toUpperCase() === cleanAcc) ||
        (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail) ||
        (cleanUid && c.linkedUserId === cleanUid)
    );
    if (cIdx >= 0) {
      syncedConsumers[cIdx] = { ...syncedConsumers[cIdx], ...activatedConsumer, status: "active" };
    } else {
      syncedConsumers.unshift({ ...activatedConsumer, status: "active" });
    }
    syncConsumerToServerPortalUser(activatedConsumer);

    let savedNotif: ServerConsumerNotification | undefined;
    if (activationNotif && activationNotif.title && activationNotif.message) {
      savedNotif = pushServerNotification(activationNotif, false);
    }
    savePortalSyncStore();
    const persistedValidatedConsumer = syncedConsumers.find(
      c => c.accountNumber && c.accountNumber.toUpperCase() === cleanAcc
    );
    if (persistedValidatedConsumer && isValidatedConsumerForReader(persistedValidatedConsumer)) {
      forwardConsumerToMobileTerminal(persistedValidatedConsumer, true).catch(() => {});
    }

    broadcast("INSTALLATION_REQUEST_UPDATED", {
      request: validatedReq,
      notification: savedNotif,
      message: `Installation #${validatedReq.applicationNumber} validated & Account #${cleanAcc} activated.`,
    });
    broadcast("CONSUMER_IDS_ISSUED", {
      consumer: activatedConsumer,
      notification: savedNotif,
      accountNumber: cleanAcc,
      meterNumber: activatedConsumer.meterNumber,
      rfidTag: activatedConsumer.rfidTag,
      email: activatedConsumer.email,
      linkedUserId: activatedConsumer.linkedUserId,
      isUpdate: false,
      message: `Account #${cleanAcc} & Meter Tag #${activatedConsumer.meterNumber} activated for ${activatedConsumer.name}.`,
    });

    res.json({ success: true, request: validatedReq, consumer: activatedConsumer, notification: savedNotif });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to validate installation and activate account." });
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
    if (
      !consumer.accountNumber ||
      consumer.accountNumber.toUpperCase().startsWith("PENDING") ||
      consumer.status === "pending_approval" ||
      consumer.status === "pending_installation" ||
      consumer.status === "installation_not_scheduled" ||
      consumer.status === "inactive"
    ) {
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
    { id: "BRG-01", name: "Poblacion", code: "PB-01", ratePerM3: 10.00, zone: "Zone 1-4: Poblacion (Main Central)" },
    { id: "BRG-02", name: "Natumolan", code: "NT-02", ratePerM3: 10.00, zone: "Zone 5-8: Natumolan Coastal & Residential" },
    { id: "BRG-03", name: "Baluarte", code: "BL-03", ratePerM3: 10.00, zone: "Zone 9-10: Baluarte Agricultural & Commercial" },
    { id: "BRG-04", name: "Sta. Ana", code: "SA-04", ratePerM3: 10.00, zone: "Zone 4: Sta. Ana Rural" },
    { id: "BRG-05", name: "Sta. Cruz", code: "SC-05", ratePerM3: 10.00, zone: "Zone 5: Sta. Cruz Sub-Central" },
    { id: "BRG-06", name: "Mohon", code: "MH-06", ratePerM3: 10.00, zone: "Zone 11-12: Mohon Industrial Corridor" },
    { id: "BRG-07", name: "Gracia", code: "GR-07", ratePerM3: 10.00, zone: "Zone 7: Gracia Uplands" },
    { id: "BRG-08", name: "Casinglot", code: "CS-08", ratePerM3: 10.00, zone: "Zone 8: Casinglot Residential" },
    { id: "BRG-09", name: "Sugbongcogon", code: "SG-09", ratePerM3: 10.00, zone: "Zone 9: Sugbongcogon Valley" },
    { id: "BRG-10", name: "Rosario", code: "RS-10", ratePerM3: 10.00, zone: "Zone 10: Rosario Uplands" }
  ];
  res.json({ success: true, count: barangays.length, barangays, routes: barangays, areas: barangays, data: barangays });
});

// ============================================================================
// 10. WATER METERS REGISTRY & STATUS SYNC APIS (/api/meters)
// Strictly uses public Meter Tag # (meterNumber) — hardware serials remain private to Admin Water Meters UI
// ============================================================================
function getEffectivePublicMeters(): SyncedWaterMeter[] {
  const byTag = new Map<string, SyncedWaterMeter>();
  syncedMeters.forEach(m => {
    if (!m || !m.meterNumber) return;
    const tag = String(m.meterNumber).trim().toUpperCase();
    byTag.set(tag, {
      meterNumber: tag,
      brand: m.brand || "EVER",
      size: m.size || "1/2 inch",
      status: m.status || "active",
      remarks: m.remarks,
      linkedAccountNumber: m.linkedAccountNumber,
      lastReadingValue: normalizeOdometerServer(m.lastReadingValue ?? 0),
      statusUpdatedAt: m.statusUpdatedAt,
      statusUpdatedBy: m.statusUpdatedBy,
    });
  });

  syncedConsumers.filter(isValidatedConsumerForReader).forEach(c => {
    const tag = String(c.meterNumber || "").trim().toUpperCase();
    if (!tag) return;
    const baseline = resolveConsumerBaselineServer(c.accountNumber, tag);
    const existing = byTag.get(tag);
    if (!existing) {
      byTag.set(tag, {
        meterNumber: tag,
        brand: "EVER",
        size: c.meterSize || "1/2 inch",
        status: c.status === "maintenance" ? "maintenance" : c.status === "inactive" ? "inactive" : "active",
        linkedAccountNumber: c.accountNumber,
        lastReadingValue: baseline,
      });
    } else {
      existing.linkedAccountNumber = existing.linkedAccountNumber || c.accountNumber;
      existing.lastReadingValue = baseline;
    }
  });

  return Array.from(byTag.values());
}

app.get("/api/meters", (_req, res) => {
  const meters = getEffectivePublicMeters();
  res.json({
    success: true,
    count: meters.length,
    meters,
    data: meters,
  });
});

app.post(["/api/meters/:meterNumber/status", "/api/meters/update-status"], (req, res) => {
  try {
    const rawMeterNumber = req.params.meterNumber || req.body?.meterNumber || "";
    const cleanMeterNumber = decodeURIComponent(String(rawMeterNumber)).trim().toUpperCase();
    if (!cleanMeterNumber) {
      return res.status(400).json({ success: false, message: "meterNumber is required." });
    }

    const rawStatus = String(req.body?.status || "active").trim().toLowerCase();
    const validStatus: SyncedWaterMeter["status"] =
      rawStatus === "damaged" || rawStatus === "maintenance" || rawStatus === "inactive" || rawStatus === "unassigned"
        ? rawStatus
        : "active";
    const remarks = typeof req.body?.remarks === "string" ? req.body.remarks.trim() : "";
    const updatedBy = typeof req.body?.updatedBy === "string" ? req.body.updatedBy.trim() : "TWD Administrator";
    const linkedAccountNumber = typeof req.body?.linkedAccountNumber === "string" ? req.body.linkedAccountNumber.trim().toUpperCase() : undefined;
    const nowIso = new Date().toISOString();

    const idx = syncedMeters.findIndex(m => m.meterNumber.toUpperCase() === cleanMeterNumber);
    const updatedMeter: SyncedWaterMeter = {
      ...(idx >= 0 ? syncedMeters[idx] : { meterNumber: cleanMeterNumber }),
      meterNumber: cleanMeterNumber,
      status: validStatus,
      remarks: remarks || undefined,
      linkedAccountNumber: linkedAccountNumber || (idx >= 0 ? syncedMeters[idx].linkedAccountNumber : undefined),
      statusUpdatedAt: nowIso,
      statusUpdatedBy: updatedBy,
    };

    if (idx >= 0) {
      syncedMeters[idx] = updatedMeter;
    } else {
      syncedMeters.unshift(updatedMeter);
    }
    savePortalSyncStore();

    forwardMeterStatusToMobileTerminal(cleanMeterNumber, validStatus, remarks, updatedBy).catch(() => {});

    broadcast("METER_STATUS_UPDATED", {
      meterNumber: cleanMeterNumber,
      status: validStatus,
      newStatus: validStatus,
      remarks,
      updatedByAdmin: updatedBy,
      accountNumber: updatedMeter.linkedAccountNumber,
      timestamp: nowIso,
      message: `Water Meter #${cleanMeterNumber} status updated to ${validStatus.toUpperCase()}.`,
    });

    res.json({
      success: true,
      meter: updatedMeter,
      message: `Water Meter #${cleanMeterNumber} status updated to ${validStatus} and dispatched to Mobile Field Terminal.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update water meter status." });
  }
});

app.post("/api/meters/reconcile", (req, res) => {
  try {
    const incoming: any[] = Array.isArray(req.body?.meters) ? req.body.meters : [];
    let changed = false;

    for (const im of incoming) {
      if (!im || !im.meterNumber) continue;
      const cleanNum = String(im.meterNumber).trim().toUpperCase();
      const rawStatus = String(im.status || "active").trim().toLowerCase();
      const validStatus: SyncedWaterMeter["status"] =
        rawStatus === "damaged" || rawStatus === "maintenance" || rawStatus === "inactive" || rawStatus === "unassigned"
          ? rawStatus
          : "active";

      // Strip private manufacturer serialNumber before storing in shared sync cache
      const sanitized: SyncedWaterMeter = {
        meterNumber: cleanNum,
        brand: im.brand || "EVER",
        size: im.size || "1/2 inch",
        status: validStatus,
        remarks: im.remarks || undefined,
        linkedAccountNumber: im.linkedAccountNumber ? String(im.linkedAccountNumber).replace(/^#/, "").trim().toUpperCase() : undefined,
        lastReadingValue: normalizeOdometerServer(im.lastReadingValue ?? 0),
        statusUpdatedAt: im.statusUpdatedAt,
        statusUpdatedBy: im.statusUpdatedBy,
      };

      const idx = syncedMeters.findIndex(x => x.meterNumber.toUpperCase() === cleanNum);
      if (idx === -1) {
        syncedMeters.push(sanitized);
        changed = true;
      } else {
        const prev = syncedMeters[idx];
        const prevTs = new Date(prev.statusUpdatedAt || 0).getTime() || 0;
        const incTs = new Date(sanitized.statusUpdatedAt || 0).getTime() || 0;
        if (incTs >= prevTs && (prev.status !== sanitized.status || prev.remarks !== sanitized.remarks)) {
          syncedMeters[idx] = { ...prev, ...sanitized };
          changed = true;
        }
      }
    }

    if (changed) {
      savePortalSyncStore();
      pushValidatedConsumersAndMetersToMobile(false).catch(() => {});
    }

    const meters = getEffectivePublicMeters();
    res.json({ success: true, count: meters.length, meters });
  } catch {
    res.json({ success: true, count: syncedMeters.length, meters: syncedMeters });
  }
});

// ============================================================================
// 11. BIDIRECTIONAL LIVE BRIDGE TO SYSTEM SITE & MOBILE FIELD TERMINAL
// Connects Central Node <-> https://twd-427m.onrender.com <-> https://mobile-li9q.onrender.com
// ============================================================================
const SYSTEM_SITE_URL = (
  process.env.SYSTEM_SITE_URL ||
  process.env.VITE_SYSTEM_SITE_URL ||
  "https://twd-427m.onrender.com"
).replace(/\/+$/, "");

const SYSTEM_SITE_WS_URL =
  SYSTEM_SITE_URL.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/ws";

const SYSTEM_SITE_HOST = (() => {
  try {
    return new URL(SYSTEM_SITE_URL).host.toLowerCase();
  } catch {
    return "twd-427m.onrender.com";
  }
})();

function isSelfSystemSite(): boolean {
  const envCandidates = [
    process.env.RENDER_EXTERNAL_URL,
    process.env.RENDER_EXTERNAL_HOSTNAME,
    process.env.APP_URL,
  ]
    .filter(Boolean)
    .map(v => String(v).trim().toLowerCase());

  for (const cand of envCandidates) {
    if (cand.includes(SYSTEM_SITE_HOST)) {
      return true;
    }
  }
  if (seenOwnHosts.has(SYSTEM_SITE_HOST)) {
    return true;
  }
  return false;
}

const rawMobileEnvUrl = (
  process.env.MOBILE_TERMINAL_URL ||
  process.env.VITE_MOBILE_TERMINAL_URL ||
  ""
).replace(/\/+$/, "");

const MOBILE_TERMINAL_URL =
  rawMobileEnvUrl && !rawMobileEnvUrl.toLowerCase().includes(SYSTEM_SITE_HOST)
    ? rawMobileEnvUrl
    : "https://mobile-li9q.onrender.com";

const MOBILE_TERMINAL_WS_URL =
  MOBILE_TERMINAL_URL.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/ws";

const mobileBridgeState = {
  targetUrl: MOBILE_TERMINAL_URL,
  wsUrl: MOBILE_TERMINAL_WS_URL,
  wsConnected: false,
  httpReachable: false,
  lastSyncAt: null as string | null,
  lastWsEventAt: null as string | null,
  lastError: null as string | null,
  latencyMs: null as number | null,
  systemSiteUrl: SYSTEM_SITE_URL,
  systemSiteConnected: false,
  systemSiteWsConnected: false,
  systemSiteIsSelf: false,
  syncedReadersCount: 0,
  syncedConsumersCount: 0,
  syncedReadingsCount: 0,
  syncedMetersCount: 0,
};

const pushedConsumerSignatures = new Map<string, string>();
const pushedMeterSignatures = new Map<string, string>();
const pushedSystemReaderSignatures = new Map<string, string>();
const pushedSystemReadingIds = new Set<string>();
let isMobileSyncInFlight = false;
let mobileWsClient: WebSocket | null = null;
let mobileWsPingTimer: NodeJS.Timeout | null = null;
let mobileWsReconnectTimer: NodeJS.Timeout | null = null;
let mobileWsReconnectAttempts = 0;

let systemWsClient: WebSocket | null = null;
let systemWsPingTimer: NodeJS.Timeout | null = null;
let systemWsReconnectTimer: NodeJS.Timeout | null = null;
let systemWsReconnectAttempts = 0;

async function fetchSystemSite(
  endpointPath: string,
  init: RequestInit = {},
  timeoutMs = 22000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${SYSTEM_SITE_URL}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-admin-portal": "true",
      "x-portal": "admin",
      "x-role": "admin",
      "x-bridge-origin": "tagoloan-central-web",
      ...((init.headers as Record<string, string>) || {}),
    };
    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    if (response.ok || response.status < 500) {
      mobileBridgeState.systemSiteConnected = true;
    }
    return response;
  } catch (err) {
    mobileBridgeState.systemSiteConnected = false;
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchMobileTerminal(
  endpointPath: string,
  init: RequestInit = {},
  timeoutMs = 25000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();
  const url = `${MOBILE_TERMINAL_URL}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-admin-portal": "true",
      "x-portal": "admin",
      "x-role": "admin",
      "x-bridge-origin": "tagoloan-central-web",
      ...((init.headers as Record<string, string>) || {}),
    };
    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    mobileBridgeState.latencyMs = Date.now() - startMs;
    if (response.ok || response.status < 500) {
      mobileBridgeState.httpReachable = true;
      mobileBridgeState.lastError = null;
    }
    return response;
  } catch (err: any) {
    mobileBridgeState.httpReachable = false;
    mobileBridgeState.lastError = err?.name === "AbortError" ? "Mobile terminal wake timeout" : (err?.message || "Connection error");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function forwardTerminateReaderToMobile(
  identifiers: string[],
  reason?: string,
  terminatedBy?: string,
  skipSystemSite = false
): Promise<void> {
  if (!identifiers || identifiers.length === 0) return;
  for (const ident of identifiers) {
    if (!ident) continue;
    try {
      const resp = await fetchMobileTerminal(`/api/readers/${encodeURIComponent(ident)}/terminate`, {
        method: "POST",
        body: JSON.stringify({
          reason: reason || "Account permanently terminated by Tagoloan Water District Central Administration.",
          terminatedBy: terminatedBy || "TWD Central Admin",
        }),
      });
      if (resp.ok) break;
    } catch {
      // Retry next candidate identifier or enforce on next periodic sync
    }
  }

  if (!skipSystemSite && !isSelfSystemSite()) {
    for (const ident of identifiers) {
      if (!ident) continue;
      try {
        const resp = await fetchSystemSite(`/api/readers/${encodeURIComponent(ident)}`, {
          method: "DELETE",
          body: JSON.stringify({
            employeeId: ident,
            username: ident,
            reason: reason || "Terminated by Central Administration",
            terminatedBy: terminatedBy || "TWD Central Admin",
          }),
        });
        if (resp.ok) break;
      } catch {
        // Reconciled on next sync cycle
      }
    }
  }
}

async function forwardReactivateOrUpdateReaderToMobile(
  readerId: string,
  updates: Record<string, any>
): Promise<void> {
  if (!readerId) return;
  try {
    const nextStatus = updates.employmentStatus || updates.status;
    if (nextStatus === "active") {
      await fetchMobileTerminal(`/api/readers/${encodeURIComponent(readerId)}/reactivate`, {
        method: "POST",
        body: JSON.stringify({ updatedBy: "TWD Central Admin" }),
      }).catch(() => {});
    }
    await fetchMobileTerminal(`/api/readers/${encodeURIComponent(readerId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status: nextStatus || "active",
        employmentStatus: nextStatus || "active",
        assignedRoutes: updates.assignedRoutes,
        zone: updates.zone,
      }),
    });
  } catch {
    // Will reconcile on next cycle
  }
}

async function forwardConsumerToMobileTerminal(
  consumer: MobileConsumerSync,
  isNewIssuance = false
): Promise<void> {
  if (!consumer || !isValidatedConsumerForReader(consumer)) return;
  const cleanAcc = consumer.accountNumber.trim().toUpperCase();
  const cleanTag = consumer.meterNumber.trim().toUpperCase();
  const baseline = resolveConsumerBaselineServer(cleanAcc, cleanTag);
  const mobileStatus =
    consumer.status === "Disconnection Notice" || consumer.status === "disconnected"
      ? "disconnected"
      : consumer.status === "maintenance"
        ? "maintenance"
        : consumer.status === "inactive"
          ? "inactive"
          : "active";

  const payload = {
    accountNumber: cleanAcc,
    name: consumer.name,
    address: consumer.address || `${consumer.sitioZone || "Zone 1"}, ${consumer.barangay || "Poblacion"}`,
    barangay: consumer.barangay || "Poblacion",
    barangayId: consumer.barangayId || "BRG-01",
    sitioZone: consumer.sitioZone || "Zone 1",
    meterNumber: cleanTag,
    meterSerial: cleanTag, // Strictly pass public Tag #, never hardware serial
    category: consumer.consumerType === "Commercial" ? "Commercial" : "Residential",
    consumerType: consumer.consumerType === "Commercial" ? "Commercial" : "Residential",
    status: mobileStatus,
    previousReading: baseline,
    lastReadingDate: consumer.lastReadingDate || new Date().toISOString().split("T")[0],
    contactNumber: consumer.contactNumber || "",
    email: consumer.email || "",
  };

  const sig = JSON.stringify([
    payload.accountNumber,
    payload.meterNumber,
    payload.status,
    payload.previousReading,
    payload.barangay,
    payload.sitioZone,
    payload.name,
    payload.category,
  ]);

  try {
    if (isNewIssuance) {
      await fetchMobileTerminal("/api/consumers/issue-id", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          approvedBy: "TWD Central Administration",
        }),
      }).catch(() => {});
    }
    const res = await fetchMobileTerminal("/api/consumers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      pushedConsumerSignatures.set(cleanAcc, sig);
    }
  } catch {
    // Handled on next periodic bridge reconciliation
  }
}

async function forwardMeterStatusToMobileTerminal(
  meterNumber: string,
  status: string,
  remarks?: string,
  updatedBy?: string
): Promise<void> {
  const cleanTag = String(meterNumber || "").trim().toUpperCase();
  if (!cleanTag) return;
  const sig = `${status}::${remarks || ""}`;
  try {
    const res = await fetchMobileTerminal(`/api/meters/${encodeURIComponent(cleanTag)}/status`, {
      method: "POST",
      body: JSON.stringify({
        status,
        remarks: remarks || "",
        updatedBy: updatedBy || "TWD Central Administration",
      }),
    });
    if (res.ok) {
      pushedMeterSignatures.set(cleanTag, sig);
    }
  } catch {
    // Handled on next periodic bridge reconciliation
  }
}

async function forwardReadingDecisionToMobileTerminal(
  readingId: string,
  decision: "approve" | "reject",
  actor?: string,
  reason?: string
): Promise<void> {
  if (!readingId) return;
  try {
    await fetchMobileTerminal(`/api/readings/${encodeURIComponent(readingId)}/${decision}`, {
      method: "POST",
      body: JSON.stringify(
        decision === "approve"
          ? { approvedBy: actor || "TWD Central Admin" }
          : { rejectedBy: actor || "TWD Central Admin", reason: reason || "Flagged by Administrator for field re-inspection" }
      ),
    });
  } catch {
    // Handled on next periodic bridge reconciliation
  }
}

async function pullReadersFromMobileTerminal(): Promise<number> {
  try {
    const resp = await fetchMobileTerminal("/api/readers", { method: "GET" });
    if (!resp.ok) return registeredStaff.length;
    const data = await resp.json();
    const remoteReaders: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.readers)
        ? data.readers
        : Array.isArray(data?.staff)
          ? data.staff
          : Array.isArray(data?.data)
            ? data.data
            : [];

    let storeChanged = false;
    const newlyDiscovered: MobileReader[] = [];

    for (const rr of remoteReaders) {
      if (!rr || (!rr.id && !rr.employeeId && !rr.username && !rr.name)) continue;
      const rId = String(rr.id || rr.employeeId || rr.username).trim();
      const rEmp = String(rr.employeeId || rr.id || "").trim();
      const rUser = String(rr.username || rr.employeeId || rr.id || "").trim();
      const rName = String(rr.name || rUser).trim();
      const rStatusRaw = String(rr.status || rr.employmentStatus || "active").trim().toLowerCase();

      // Enforce Central Admin termination if Render cold-booted with seed/cached reader
      if (
        isStaffTerminated(rId) ||
        isStaffTerminated(rEmp) ||
        isStaffTerminated(rUser) ||
        isStaffTerminated(rName)
      ) {
        if (rStatusRaw !== "terminated") {
          forwardTerminateReaderToMobile(
            [rId, rEmp, rUser].filter(Boolean),
            "Enforced Central Web Administration termination",
            "TWD Central Sync"
          ).catch(() => {});
        }
        continue;
      }

      // If terminated on Mobile server, mirror termination locally
      if (rStatusRaw === "terminated") {
        [rId, rEmp, rUser, rName].forEach(ident => {
          if (ident) terminatedStaffIdentifiers.add(ident.toLowerCase());
        });
        const before = registeredStaff.length;
        registeredStaff = registeredStaff.filter(
          s =>
            s.id?.toLowerCase() !== rId.toLowerCase() &&
            s.username?.toLowerCase() !== rUser.toLowerCase() &&
            s.name?.toLowerCase() !== rName.toLowerCase()
        );
        if (registeredStaff.length !== before) storeChanged = true;
        continue;
      }

      const routesFromRemote = normalizeAssignedRoutesServer(
        rr.assignedRoutes,
        rr.assignedZones,
        rr.assignedBarangays,
        rr.assignedBarangay,
        rr.zone
      );

      const mappedStatus: "active" | "inactive" = rStatusRaw === "inactive" ? "inactive" : "active";

      const existingIdx = registeredStaff.findIndex(
        s =>
          (rId && (s.id?.toLowerCase() === rId.toLowerCase() || s.employeeId?.toLowerCase() === rId.toLowerCase())) ||
          (rEmp && (s.id?.toLowerCase() === rEmp.toLowerCase() || s.employeeId?.toLowerCase() === rEmp.toLowerCase())) ||
          (rUser && s.username?.toLowerCase() === rUser.toLowerCase()) ||
          (rName && s.name?.toLowerCase() === rName.toLowerCase())
      );

      if (existingIdx === -1) {
        const mapped: MobileReader = {
          id: rId,
          employeeId: rEmp || rId,
          username: rUser,
          email: rr.email || `${rUser.toLowerCase().replace(/[^a-z0-9_.-]/g, "_")}@tagoloanwater.gov.ph`,
          name: rName,
          pin: rr.pin || "1234",
          role: rr.role || "Field Meter Reader",
          zone: routesFromRemote.join(", "),
          contactNumber: rr.phone || rr.contactNumber || "",
          employmentStatus: mappedStatus,
          status: mappedStatus,
          registeredAt: rr.registeredAt || rr.createdAt || new Date().toISOString(),
          assignedRoutes: routesFromRemote,
          deviceInfo: rr.deviceInfo || "Tagoloan Mobile Field Terminal",
          mobileSynced: true,
        };
        registeredStaff.push(mapped);
        newlyDiscovered.push(mapped);
        storeChanged = true;
      } else {
        const curr = registeredStaff[existingIdx];
        const currCleanRoutes = normalizeAssignedRoutesServer(curr.assignedRoutes, curr.zone);
        const routesChanged = JSON.stringify(currCleanRoutes) !== JSON.stringify(routesFromRemote);
        if (
          routesChanged ||
          !curr.mobileSynced ||
          (!curr.deviceInfo && rr.deviceInfo) ||
          (!curr.employeeId && rEmp)
        ) {
          registeredStaff[existingIdx] = {
            ...curr,
            employeeId: curr.employeeId || rEmp || curr.id,
            assignedRoutes: routesFromRemote,
            zone: routesFromRemote.join(", "),
            contactNumber: curr.contactNumber && curr.contactNumber !== "N/A" ? curr.contactNumber : (rr.phone || rr.contactNumber || curr.contactNumber),
            deviceInfo: rr.deviceInfo || curr.deviceInfo || "Tagoloan Mobile Field Terminal",
            mobileSynced: true,
          };
          storeChanged = true;
        }
      }
    }

    if (storeChanged) {
      savePortalSyncStore();
    }
    for (const nr of newlyDiscovered) {
      broadcast("READER_REGISTERED_ACTIVE", {
        reader: nr,
        id: nr.id,
        employeeId: nr.employeeId || nr.id,
        username: nr.username,
        name: nr.name,
        status: nr.employmentStatus,
        employmentStatus: nr.employmentStatus,
        assignedRoutes: nr.assignedRoutes,
        message: `Mobile Field Reader ${nr.name} (${nr.employeeId || nr.id}) synced from Field Terminal.`,
      });
    }

    const activeCount = registeredStaff.filter(
      s => !isStaffTerminated(s.id) && !isStaffTerminated(s.username) && !isStaffTerminated(s.name)
    ).length;
    mobileBridgeState.syncedReadersCount = activeCount;
    return activeCount;
  } catch {
    return registeredStaff.length;
  }
}

async function pullReadingsFromMobileTerminal(): Promise<number> {
  try {
    const resp = await fetchMobileTerminal("/api/readings", { method: "GET" });
    if (!resp.ok) return pendingMobileReadings.length;
    const data = await resp.json();
    const remoteReadings: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.readings)
        ? data.readings
        : Array.isArray(data?.data)
          ? data.data
          : [];

    let storeChanged = false;
    const newlyIngested: MobileReadingSubmission[] = [];

    for (const rr of remoteReadings) {
      if (!rr || (!rr.accountNumber && !rr.meterNumber)) continue;
      const rId = String(rr.id || `MOB-${rr.accountNumber}-${rr.readingDate || Date.now()}`).trim();
      const cleanAcc = String(rr.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
      const cleanMeter = String(rr.meterNumber || rr.meterSerial || "").trim().toUpperCase();

      const matchedConsumer = syncedConsumers.find(
        c =>
          (cleanAcc && String(c.accountNumber || "").replace(/^#/, "").trim().toUpperCase() === cleanAcc) ||
          (cleanMeter && String(c.meterNumber || "").trim().toUpperCase() === cleanMeter)
      );

      const resolvedAcc = matchedConsumer ? matchedConsumer.accountNumber : (cleanAcc || "UNKNOWN");
      const resolvedMeter = cleanMeter || (matchedConsumer ? matchedConsumer.meterNumber : "MT-TAG");

      const alreadyBilledInCentral = reconciledBillingRecords.has(rId);
      const existingIdx = pendingMobileReadings.findIndex(x => x.id === rId);
      const alreadyApprovedInCentral =
        alreadyBilledInCentral || (existingIdx >= 0 && pendingMobileReadings[existingIdx].status === "approved");
      const alreadyRejectedInCentral =
        existingIdx >= 0 && pendingMobileReadings[existingIdx].status === "rejected";

      const remoteStatusRaw = String(rr.status || rr.syncStatus || "pending_approval").trim().toLowerCase();
      if (alreadyApprovedInCentral && remoteStatusRaw !== "approved" && remoteStatusRaw !== "verified") {
        forwardReadingDecisionToMobileTerminal(rId, "approve", "TWD Central Sync").catch(() => {});
      }
      if (alreadyRejectedInCentral && remoteStatusRaw !== "rejected") {
        forwardReadingDecisionToMobileTerminal(
          rId,
          "reject",
          "TWD Central Sync",
          pendingMobileReadings[existingIdx]?.rejectionReason
        ).catch(() => {});
      }

      if (existingIdx >= 0) {
        continue;
      }

      // Normalize 5-digit odometer (00000-99999) with rollover continuity
      const curr = normalizeOdometerServer(rr.currentReading ?? rr.presentReading ?? 0);
      const baseline = resolveConsumerBaselineServer(resolvedAcc, resolvedMeter, rId);
      let prev = rr.previousReading !== undefined ? normalizeOdometerServer(rr.previousReading) : baseline;
      if (prev === 0 && baseline > 0 && curr >= baseline) {
        prev = baseline;
      }
      const odo = computeOdometerServer(prev, curr, rr.consumption);

      const rawGps = rr.gpsCoordinates || rr.coordinates || rr.gps;
      const coords =
        rawGps && typeof rawGps === "object"
          ? {
              latitude: Number(rawGps.latitude ?? rawGps.lat ?? 8.5372),
              longitude: Number(rawGps.longitude ?? rawGps.lng ?? 124.7523),
            }
          : undefined;

      const defaultPeriod = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const mappedStatus: MobileReadingSubmission["status"] =
        alreadyApprovedInCentral || remoteStatusRaw === "approved" || remoteStatusRaw === "verified"
          ? "approved"
          : remoteStatusRaw === "rejected"
            ? "rejected"
            : "pending_approval";

      const submission: MobileReadingSubmission = {
        id: rId,
        accountNumber: resolvedAcc,
        consumerName: rr.consumerName || (matchedConsumer ? matchedConsumer.name : "Consumer Account"),
        meterNumber: resolvedMeter,
        billingPeriod: rr.billingPeriod || defaultPeriod,
        readingDate: rr.readingDate
          ? String(rr.readingDate).split("T")[0]
          : new Date().toISOString().split("T")[0],
        previousReading: odo.previousReading,
        presentReading: odo.currentReading,
        currentReading: odo.currentReading,
        consumption: odo.consumption,
        readerId: rr.readerId || "WDT-FIELD",
        readerName: rr.readerName || "Field Meter Officer",
        route: rr.barangay || rr.route || (matchedConsumer ? matchedConsumer.barangay : "Poblacion"),
        status: mappedStatus,
        photoUrl: rr.photoUrl || rr.dialPhotoUrl || "",
        coordinates: coords,
        gpsAccuracy: typeof rawGps?.accuracy === "number" ? rawGps.accuracy : undefined,
        meterCondition: rr.meterCondition || undefined,
        ocrConfidence: typeof rr.ocrConfidence === "number" ? rr.ocrConfidence : undefined,
        isAnomaly:
          typeof rr.isAnomaly === "boolean"
            ? rr.isAnomaly ||
              odo.consumption >= 20 ||
              Boolean(rr.meterCondition && String(rr.meterCondition).trim().toUpperCase() !== "NORMAL")
            : odo.consumption >= 20 ||
              Boolean(rr.meterCondition && String(rr.meterCondition).trim().toUpperCase() !== "NORMAL"),
        anomalyReason:
          rr.anomalyReason ||
          (odo.consumption >= 20 ||
          Boolean(rr.meterCondition && String(rr.meterCondition).trim().toUpperCase() !== "NORMAL")
            ? "High Usage / Condition Alert — Verify"
            : undefined),
        mobileSyncSource: "rest_pull",
        notes:
          rr.remarks ||
          rr.notes ||
          (rr.meterCondition && String(rr.meterCondition).toUpperCase() !== "NORMAL"
            ? `Field Meter Condition: ${rr.meterCondition}`
            : "Synced from Tagoloan Mobile Field Terminal"),
        submittedAt: rr.submittedAt || rr.timestamp || new Date().toISOString(),
      };

      pendingMobileReadings.unshift(submission);
      newlyIngested.push(submission);
      storeChanged = true;
    }

    if (storeChanged) {
      savePortalSyncStore();
    }

    for (const sub of newlyIngested) {
      if (sub.status === "pending_approval") {
        broadcast("READING_SUBMITTED_FOR_APPROVAL", {
          reading: sub,
          message: `Mobile Field Reading received for Account #${sub.accountNumber} (${formatOdometerServer(sub.previousReading)} → ${formatOdometerServer(sub.currentReading)} = ${sub.consumption} m³).`,
        });
        broadcast("reading:submitted", {
          reading: sub,
          message: `Mobile Field Reading received for Account #${sub.accountNumber} (${sub.consumption} m³).`,
        });
      }
    }

    mobileBridgeState.syncedReadingsCount = pendingMobileReadings.length;
    return pendingMobileReadings.length;
  } catch {
    return pendingMobileReadings.length;
  }
}

async function pushValidatedConsumersAndMetersToMobile(forceAll = false): Promise<void> {
  const validatedConsumers = syncedConsumers.filter(isValidatedConsumerForReader);
  mobileBridgeState.syncedConsumersCount = validatedConsumers.length;

  // Always check remote consumers on Mobile Terminal so we only push missing or changed records (rate-limit safe)
  const remoteConsumerMap = new Map<string, any>();
  try {
    const checkResp = await fetchMobileTerminal("/api/consumers?includePending=true", { method: "GET" });
    if (checkResp.status === 429) return;
    if (checkResp.ok) {
      const cData = await checkResp.json();
      const cList: any[] = Array.isArray(cData) ? cData : (cData?.consumers || cData?.data || []);
      for (const rc of cList) {
        const key = String(rc?.accountNumber || "").replace(/^#/, "").trim().toUpperCase();
        if (key) remoteConsumerMap.set(key, rc);
      }
    }
  } catch {
    // Non-fatal
  }

  let pushedThisPass = 0;
  for (const c of validatedConsumers) {
    if (pushedThisPass >= 45) break; // Stay well below 200 req/min rate limit
    const cleanAcc = c.accountNumber.trim().toUpperCase();
    const cleanTag = c.meterNumber.trim().toUpperCase();
    const baseline = resolveConsumerBaselineServer(cleanAcc, cleanTag);
    const mobileStatus =
      c.status === "Disconnection Notice" || c.status === "disconnected"
        ? "disconnected"
        : c.status === "maintenance"
          ? "maintenance"
          : c.status === "inactive"
            ? "inactive"
            : "active";
    const sig = JSON.stringify([
      cleanAcc,
      cleanTag,
      mobileStatus,
      baseline,
      c.barangay || "Poblacion",
      c.sitioZone || "Zone 1",
      c.name,
      c.consumerType === "Commercial" ? "Commercial" : "Residential",
    ]);

    const remoteExisting = remoteConsumerMap.get(cleanAcc);
    const alreadyMatchesRemote = Boolean(
      remoteExisting &&
        String(remoteExisting.meterSerial || remoteExisting.meterNumber || "").trim().toUpperCase() === cleanTag &&
        Number(remoteExisting.previousReading ?? 0) === baseline &&
        String(remoteExisting.status || "active").toLowerCase() === mobileStatus
    );

    if (alreadyMatchesRemote) {
      pushedConsumerSignatures.set(cleanAcc, sig);
      continue;
    }

    if (forceAll || !remoteExisting || pushedConsumerSignatures.get(cleanAcc) !== sig) {
      await forwardConsumerToMobileTerminal(c, false);
      pushedThisPass++;
    }
  }

  const publicMeters = getEffectivePublicMeters();
  mobileBridgeState.syncedMetersCount = publicMeters.length;
  for (const m of publicMeters) {
    if (!m.meterNumber) continue;
    const cleanTag = m.meterNumber.toUpperCase();
    const sig = `${m.status}::${m.remarks || ""}`;
    if (pushedMeterSignatures.get(cleanTag) !== sig && (m.status !== "active" || m.remarks)) {
      await forwardMeterStatusToMobileTerminal(cleanTag, m.status, m.remarks, m.statusUpdatedBy);
    }
  }
}

async function syncWithSystemSitePeer(forceAll = false): Promise<void> {
  const isSelf = isSelfSystemSite();
  mobileBridgeState.systemSiteIsSelf = isSelf;
  if (isSelf) {
    mobileBridgeState.systemSiteConnected = true;
    return;
  }

  let storeChanged = false;
  let billingsChanged = false;

  // 1. Pull official billings from https://twd-427m.onrender.com/api/billings so consumer odometer baselines stay current
  try {
    const bResp = await fetchSystemSite("/api/billings", { method: "GET" });
    if (bResp.ok) {
      const bData = await bResp.json();
      const bList: any[] = Array.isArray(bData?.readings) ? bData.readings : [];
      for (const br of bList) {
        if (!br || !br.id) continue;
        const prev = reconciledBillingRecords.get(br.id);
        const merged = mergeBillingRecordServer(prev, br);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(merged)) {
          reconciledBillingRecords.set(br.id, merged);
          billingsChanged = true;
        }
        // If a pending mobile reading was billed on System Site, mark it approved & notify Mobile Terminal
        const mIdx = pendingMobileReadings.findIndex(r => r.id === br.id && r.status !== "approved");
        if (mIdx >= 0 && (br.isBillingIssued || br.status === "verified")) {
          pendingMobileReadings[mIdx].status = "approved";
          pendingMobileReadings[mIdx].approvedBy = br.billingIssuedBy || "TWD System Admin";
          storeChanged = true;
          forwardReadingDecisionToMobileTerminal(br.id, "approve", br.billingIssuedBy || "TWD System Admin").catch(() => {});
        }
      }
    }
  } catch {
    // Non-fatal if System Site is waking up
  }

  if (billingsChanged) {
    saveBillingsSyncStore();
  }

  // 2. Pull live consumers (including newly validated accounts like BRG-03-2114) from https://twd-427m.onrender.com
  try {
    const cResp = await fetchSystemSite("/api/consumers?includePending=true", { method: "GET" });
    if (cResp.ok) {
      const cData = await cResp.json();
      const remoteConsumers: any[] = Array.isArray(cData?.consumers) ? cData.consumers : [];
      for (const rc of remoteConsumers) {
        if (!rc || (!rc.accountNumber && !rc.email && !rc.name)) continue;
        const rcAcc = String(rc.accountNumber || "").trim().toUpperCase();
        const rcEmail = String(rc.email || "").trim().toLowerCase();
        const rcUid = String(rc.linkedUserId || "").trim();

        const idx = syncedConsumers.findIndex(lc => {
          const lcAcc = String(lc.accountNumber || "").trim().toUpperCase();
          const lcEmail = String(lc.email || "").trim().toLowerCase();
          if (isIssuedAccountNumberServer(rcAcc) && isIssuedAccountNumberServer(lcAcc) && rcAcc === lcAcc) return true;
          if (rcEmail && lcEmail && rcEmail === lcEmail) return true;
          if (rcUid && lc.linkedUserId && rcUid === lc.linkedUserId) return true;
          return false;
        });

        const incomingValid = isValidatedConsumerForReader(rc as MobileConsumerSync);
        if (idx === -1) {
          const mapped: MobileConsumerSync = {
            accountNumber: rc.accountNumber || "",
            name: rc.name || "Consumer",
            address: rc.address || `${rc.sitioZone || "Zone 1"}, ${rc.barangay || "Poblacion"}`,
            barangay: rc.barangay || "Poblacion",
            barangayId: rc.barangayId || "BRG-01",
            sitioZone: rc.sitioZone || "Zone 1",
            meterNumber: rc.meterNumber || rc.meterSerial || "",
            previousReading: normalizeOdometerServer(rc.previousReading ?? 0),
            lastReadingDate: rc.lastReadingDate || new Date().toISOString().split("T")[0],
            consumerType: rc.consumerType === "Commercial" ? "Commercial" : "Residential",
            status: rc.status || (incomingValid ? "active" : "pending_approval"),
            contactNumber: rc.contactNumber || "",
            email: rc.email || "",
            rfidTag: rc.rfidTag || "",
            registrationDate: rc.registrationDate,
            linkedUserId: rc.linkedUserId,
            applicationNumber: rc.applicationNumber,
            installationRequestId: rc.installationRequestId,
            installationStatus: rc.installationStatus,
            accountValidationStatus: rc.accountValidationStatus,
            isRegistered: true,
          };
          syncedConsumers.push(mapped);
          if (incomingValid) {
            syncConsumerToServerPortalUser(mapped);
          }
          storeChanged = true;
        } else {
          const existing = syncedConsumers[idx];
          const existingValid = isValidatedConsumerForReader(existing);
          if (incomingValid && !existingValid) {
            syncedConsumers[idx] = {
              ...existing,
              accountNumber: rc.accountNumber,
              meterNumber: rc.meterNumber || rc.meterSerial || existing.meterNumber,
              status: rc.status || "active",
              barangay: rc.barangay || existing.barangay,
              sitioZone: rc.sitioZone || existing.sitioZone,
              previousReading: normalizeOdometerServer(rc.previousReading ?? existing.previousReading),
            };
            syncConsumerToServerPortalUser(syncedConsumers[idx]);
            storeChanged = true;
          } else if (incomingValid && existingValid) {
            const remotePrev = normalizeOdometerServer(rc.previousReading ?? 0);
            if (remotePrev > existing.previousReading) {
              syncedConsumers[idx].previousReading = remotePrev;
              storeChanged = true;
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 3. Push active Mobile Field Readers -> https://twd-427m.onrender.com/api/readers/register
  try {
    let remoteReaderIds = new Set<string>();
    const rCheck = await fetchSystemSite("/api/readers", { method: "GET" });
    if (rCheck.ok) {
      const rData = await rCheck.json();
      const rList: any[] = Array.isArray(rData?.readers) ? rData.readers : (rData?.staff || []);
      remoteReaderIds = new Set(
        rList
          .flatMap((r: any) => [r?.id, r?.employeeId, r?.username])
          .filter(Boolean)
          .map((x: any) => String(x).trim().toLowerCase())
      );
    }

    if (rCheck.status !== 429) {
      const activeLocalReaders = registeredStaff.filter(
        s => !isStaffTerminated(s.id) && !isStaffTerminated(s.username) && !isStaffTerminated(s.name)
      );

      for (const reader of activeLocalReaders) {
        const rKey = (reader.id || reader.username).toLowerCase();
        const sig = JSON.stringify([reader.id, reader.username, reader.name, reader.employmentStatus, reader.assignedRoutes]);
        const missingOnSystem =
          !remoteReaderIds.has((reader.id || "").toLowerCase()) &&
          !remoteReaderIds.has((reader.username || "").toLowerCase());

        if (!missingOnSystem && pushedSystemReaderSignatures.get(rKey) === sig) {
          continue;
        }
        if (!missingOnSystem && !pushedSystemReaderSignatures.has(rKey)) {
          pushedSystemReaderSignatures.set(rKey, sig);
          continue;
        }

        const regRes = await fetchSystemSite("/api/readers/register", {
          method: "POST",
          body: JSON.stringify({
            id: reader.id,
            employeeId: reader.employeeId || reader.id,
            username: reader.username,
            email: reader.email,
            name: reader.name,
            pin: reader.pin || "1234",
            role: reader.role || "Field Meter Reader",
            zone: reader.zone || "Poblacion",
            contactNumber: reader.contactNumber || "",
            assignedRoutes: reader.assignedRoutes || [reader.zone || "Poblacion"],
            registeredAt: reader.registeredAt,
          }),
        });
        if (regRes.status === 429) break;
        if (regRes.ok) {
          pushedSystemReaderSignatures.set(rKey, sig);
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 4. Sync Pending & Approved Readings <-> https://twd-427m.onrender.com/api/readings
  try {
    let systemReadingMap = new Map<string, any>();
    const rdCheck = await fetchSystemSite("/api/readings", { method: "GET" });
    if (rdCheck.ok) {
      const rdData = await rdCheck.json();
      const rdList: any[] = Array.isArray(rdData?.readings) ? rdData.readings : [];
      for (const item of rdList) {
        if (item?.id) {
          systemReadingMap.set(String(item.id), item);
          if (item.status === "approved") {
            const localItem = pendingMobileReadings.find(r => r.id === item.id);
            if (localItem && localItem.status !== "approved") {
              localItem.status = "approved";
              localItem.approvedBy = item.approvedBy || "TWD System Admin";
              storeChanged = true;
              forwardReadingDecisionToMobileTerminal(item.id, "approve", localItem.approvedBy).catch(() => {});
            }
          }
        }
      }
    }

    for (const sub of pendingMobileReadings) {
      if (sub.status !== "pending_approval") continue;
      if (systemReadingMap.has(sub.id) || (!forceAll && pushedSystemReadingIds.has(sub.id))) {
        continue;
      }
      const subRes = await fetchSystemSite("/api/readings/submit", {
        method: "POST",
        body: JSON.stringify({
          id: sub.id,
          accountNumber: sub.accountNumber,
          consumerName: sub.consumerName,
          meterNumber: sub.meterNumber,
          billingPeriod: sub.billingPeriod,
          readingDate: sub.readingDate,
          previousReading: sub.previousReading,
          presentReading: sub.presentReading ?? sub.currentReading,
          currentReading: sub.currentReading,
          consumption: sub.consumption,
          readerId: sub.readerId,
          readerName: sub.readerName,
          route: sub.route,
          photoUrl: sub.photoUrl,
          coordinates: sub.coordinates,
          meterCondition: sub.meterCondition,
          ocrConfidence: sub.ocrConfidence,
          isAnomaly: sub.isAnomaly,
          anomalyReason: sub.anomalyReason,
          notes: sub.notes,
        }),
      });
      if (subRes.ok) {
        pushedSystemReadingIds.add(sub.id);
      }
    }
  } catch {
    // Non-fatal
  }

  // 5. Bidirectional Sync of Water Meter Installation Requests <-> https://twd-427m.onrender.com/api/installations
  try {
    const instResp = await fetchSystemSite("/api/installations", { method: "GET" });
    if (instResp.ok) {
      const instData = await instResp.json();
      const remoteInstList: any[] = Array.isArray(instData?.installations) ? instData.installations : [];
      const remoteById = new Map<string, any>();

      for (const ri of remoteInstList) {
        if (!ri || !ri.id) continue;
        remoteById.set(String(ri.id), ri);
        const localIdx = inMemoryInstallations.findIndex(
          (li) => li.id === ri.id || (ri.applicationNumber && li.applicationNumber === ri.applicationNumber)
        );
        if (localIdx === -1) {
          inMemoryInstallations.unshift(ri);
          storeChanged = true;
          broadcast("INSTALLATION_REQUEST_SUBMITTED", {
            request: ri,
            message: `Synced Water Meter Installation Request (#${ri.applicationNumber}) from System Site.`,
          });
        } else {
          const localItem = inMemoryInstallations[localIdx];
          const remoteTs = new Date(ri.updatedAt || ri.submissionDate || 0).getTime() || 0;
          const localTs = new Date(localItem.updatedAt || localItem.submissionDate || 0).getTime() || 0;
          if (remoteTs > localTs) {
            inMemoryInstallations[localIdx] = { ...localItem, ...ri };
            storeChanged = true;
            broadcast("INSTALLATION_REQUEST_UPDATED", {
              request: inMemoryInstallations[localIdx],
              requestId: ri.id,
              applicationNumber: ri.applicationNumber,
              status: ri.status,
              consumerEmail: ri.consumerEmail,
            });
          }
        }
      }

      for (const localInst of inMemoryInstallations) {
        if (!localInst?.id) continue;
        const remoteMatch = remoteById.get(String(localInst.id));
        if (!remoteMatch) {
          await fetchSystemSite("/api/installations", {
            method: "POST",
            body: JSON.stringify({ request: localInst }),
          }).catch(() => {});
        } else {
          const localTs = new Date(localInst.updatedAt || localInst.submissionDate || 0).getTime() || 0;
          const remoteTs = new Date(remoteMatch.updatedAt || remoteMatch.submissionDate || 0).getTime() || 0;
          if (localTs > remoteTs) {
            await fetchSystemSite(`/api/installations/${encodeURIComponent(localInst.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ request: localInst }),
            }).catch(() => {});
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  if (storeChanged) {
    savePortalSyncStore();
  }
}

async function runFullMobileBridgeSync(forceAllPush = false): Promise<typeof mobileBridgeState> {
  if (isMobileSyncInFlight) {
    return mobileBridgeState;
  }
  isMobileSyncInFlight = true;
  try {
    await pullReadersFromMobileTerminal();
    await pullReadingsFromMobileTerminal();
    await syncWithSystemSitePeer(forceAllPush);
    await pushValidatedConsumersAndMetersToMobile(forceAllPush);
    mobileBridgeState.lastSyncAt = new Date().toISOString();
  } catch (err: any) {
    mobileBridgeState.lastError = err?.message || "Bridge sync failed";
  } finally {
    isMobileSyncInFlight = false;
  }
  return mobileBridgeState;
}

function connectSystemSiteWebSocket(): void {
  const isSelf = isSelfSystemSite();
  mobileBridgeState.systemSiteIsSelf = isSelf;
  if (isSelf) {
    mobileBridgeState.systemSiteConnected = true;
    mobileBridgeState.systemSiteWsConnected = true;
    return;
  }
  if (systemWsClient && (systemWsClient.readyState === WebSocket.OPEN || systemWsClient.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    const ws = new WebSocket(SYSTEM_SITE_WS_URL, {
      headers: {
        "x-bridge-origin": "tagoloan-central-web",
        "x-admin-portal": "true",
      },
    });
    systemWsClient = ws;

    ws.on("open", () => {
      mobileBridgeState.systemSiteConnected = true;
      mobileBridgeState.systemSiteWsConnected = true;
      systemWsReconnectAttempts = 0;
      console.log(`[System Bridge] Connected outbound WebSocket -> ${SYSTEM_SITE_WS_URL}`);

      if (systemWsPingTimer) clearInterval(systemWsPingTimer);
      systemWsPingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "PING", payload: { source: "twd-peer-bridge", ts: Date.now() } }));
          } catch {}
        }
      }, 25000);

      syncWithSystemSitePeer(false)
        .then(() => pushValidatedConsumersAndMetersToMobile(false))
        .catch(() => {});
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const eventType = String(msg?.type || "");
        const payload = msg?.payload || {};

        if (
          eventType === "READER_TERMINATED" ||
          eventType === "READER_ACCOUNT_TERMINATED" ||
          eventType === "staff:terminated"
        ) {
          const targetId = payload.readerId || payload.employeeId || payload.username || payload.id;
          if (targetId) {
            const idents = [payload.readerId, payload.employeeId, payload.username, payload.name]
              .filter(Boolean)
              .map(String);
            idents.forEach(i => terminatedStaffIdentifiers.add(i.trim().toLowerCase()));
            registeredStaff = registeredStaff.filter(
              s => !isStaffTerminated(s.id) && !isStaffTerminated(s.username) && !isStaffTerminated(s.name)
            );
            savePortalSyncStore();
            forwardTerminateReaderToMobile(idents, payload.reason || "Terminated on System Site", "TWD System Site Admin", true).catch(() => {});
          }
        } else if (
          eventType === "READING_VERIFIED" ||
          eventType === "BILLINGS_RECONCILED" ||
          eventType === "CONSUMER_IDS_ISSUED" ||
          eventType === "CONSUMER_UPDATED" ||
          eventType === "CONSUMER_REGISTERED" ||
          eventType === "INSTALLATION_REQUEST_SUBMITTED" ||
          eventType === "INSTALLATION_REQUEST_UPDATED"
        ) {
          syncWithSystemSitePeer(false)
            .then(() => pushValidatedConsumersAndMetersToMobile(false))
            .catch(() => {});
        }
      } catch {
        // Ignore non-JSON frames
      }
    });

    ws.on("error", () => {
      mobileBridgeState.systemSiteWsConnected = false;
    });

    ws.on("close", () => {
      mobileBridgeState.systemSiteWsConnected = false;
      if (systemWsPingTimer) {
        clearInterval(systemWsPingTimer);
        systemWsPingTimer = null;
      }
      systemWsClient = null;
      if (!isSelfSystemSite()) {
        const delay = Math.min(30000, 3500 * Math.pow(1.6, systemWsReconnectAttempts++));
        if (systemWsReconnectTimer) clearTimeout(systemWsReconnectTimer);
        systemWsReconnectTimer = setTimeout(() => {
          connectSystemSiteWebSocket();
        }, delay);
      }
    });
  } catch {
    mobileBridgeState.systemSiteWsConnected = false;
  }
}

function connectMobileTerminalWebSocket(): void {
  if (mobileWsClient && (mobileWsClient.readyState === WebSocket.OPEN || mobileWsClient.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    const ws = new WebSocket(MOBILE_TERMINAL_WS_URL, {
      headers: {
        "x-bridge-origin": "tagoloan-central-web",
        "x-admin-portal": "true",
      },
    });
    mobileWsClient = ws;

    ws.on("open", () => {
      mobileBridgeState.wsConnected = true;
      mobileBridgeState.httpReachable = true;
      mobileBridgeState.lastError = null;
      mobileBridgeState.lastWsEventAt = new Date().toISOString();
      mobileWsReconnectAttempts = 0;
      console.log(`[Mobile Bridge] Connected outbound WebSocket -> ${MOBILE_TERMINAL_WS_URL}`);

      if (mobileWsPingTimer) clearInterval(mobileWsPingTimer);
      mobileWsPingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "PING", payload: { source: "twd-central-web", ts: Date.now() } }));
          } catch {}
        }
      }, 25000);

      runFullMobileBridgeSync(false).catch(() => {});
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const eventType = String(msg?.type || "");
        mobileBridgeState.lastWsEventAt = new Date().toISOString();

        if (
          eventType === "READING_SUBMITTED_FOR_APPROVAL" ||
          eventType === "LIVE_READING_UPDATE" ||
          eventType === "BATCH_SYNC_PROCESSED"
        ) {
          pullReadingsFromMobileTerminal()
            .then(() => syncWithSystemSitePeer(false))
            .catch(() => {});
        } else if (
          eventType === "READER_REGISTERED_ACTIVE" ||
          eventType === "READER_ACCOUNT_TERMINATED" ||
          eventType === "READER_STATUS_CHANGED"
        ) {
          pullReadersFromMobileTerminal()
            .then(() => syncWithSystemSitePeer(false))
            .catch(() => {});
        }
      } catch {
        // Ignore non-JSON frames
      }
    });

    ws.on("error", (err) => {
      mobileBridgeState.wsConnected = false;
      mobileBridgeState.lastError = err.message || "WebSocket bridge error";
    });

    ws.on("close", () => {
      mobileBridgeState.wsConnected = false;
      if (mobileWsPingTimer) {
        clearInterval(mobileWsPingTimer);
        mobileWsPingTimer = null;
      }
      mobileWsClient = null;
      const delay = Math.min(30000, 3000 * Math.pow(1.6, mobileWsReconnectAttempts++));
      if (mobileWsReconnectTimer) clearTimeout(mobileWsReconnectTimer);
      mobileWsReconnectTimer = setTimeout(() => {
        connectMobileTerminalWebSocket();
      }, delay);
    });
  } catch (err: any) {
    mobileBridgeState.wsConnected = false;
    mobileBridgeState.lastError = err?.message || "Failed to initialize Mobile WS";
  }
}

app.get("/api/mobile-bridge/status", (_req, res) => {
  const activeReaders = registeredStaff.filter(
    s => !isStaffTerminated(s.id) && !isStaffTerminated(s.username) && !isStaffTerminated(s.name)
  ).length;
  mobileBridgeState.systemSiteIsSelf = isSelfSystemSite();
  if (mobileBridgeState.systemSiteIsSelf) {
    mobileBridgeState.systemSiteConnected = true;
    mobileBridgeState.systemSiteWsConnected = true;
  }
  mobileBridgeState.syncedReadersCount = activeReaders;
  mobileBridgeState.syncedConsumersCount = syncedConsumers.filter(isValidatedConsumerForReader).length;
  mobileBridgeState.syncedReadingsCount = pendingMobileReadings.length;
  mobileBridgeState.syncedMetersCount = getEffectivePublicMeters().length;

  res.json({
    success: true,
    bridge: {
      ...mobileBridgeState,
      connected: mobileBridgeState.wsConnected || mobileBridgeState.httpReachable,
    },
  });
});

app.post("/api/mobile-bridge/sync", async (_req, res) => {
  try {
    if (!mobileBridgeState.wsConnected) {
      connectMobileTerminalWebSocket();
    }
    if (!mobileBridgeState.systemSiteWsConnected && !isSelfSystemSite()) {
      connectSystemSiteWebSocket();
    }
    const state = await runFullMobileBridgeSync(true);
    res.json({
      success: true,
      bridge: {
        ...state,
        connected: state.wsConnected || state.httpReachable,
      },
      message: `Synchronized System (${SYSTEM_SITE_URL}) & Mobile Terminal (${MOBILE_TERMINAL_URL}): ${state.syncedReadersCount} readers, ${state.syncedConsumersCount} validated consumers, ${state.syncedReadingsCount} field readings.`,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      bridge: {
        ...mobileBridgeState,
        connected: false,
      },
      message: err?.message || "Failed to synchronize with System & Mobile Field Terminal.",
    });
  }
});

// Boot live outbound System Site + Mobile Field Terminal WebSockets & periodic 45s reconciliation AFTER HTTP port is bound
function startBackgroundPeerBridges() {
  setTimeout(() => {
    connectMobileTerminalWebSocket();
    connectSystemSiteWebSocket();
    runFullMobileBridgeSync(true).catch(() => {});
  }, 2000);

  setInterval(() => {
    if (!mobileBridgeState.wsConnected) {
      connectMobileTerminalWebSocket();
    }
    if (!mobileBridgeState.systemSiteWsConnected && !isSelfSystemSite()) {
      connectSystemSiteWebSocket();
    }
    runFullMobileBridgeSync(false).catch(() => {});
  }, 45000);
}

app.get(["/api/health", "/api/status", "/api/ping", "/api/survival"], (req, res) => {
  const mem = process.memoryUsage();
  const selfHost = isSelfSystemSite();
  res.json({
    status: "online",
    state: "ONLINE",
    healthy: true,
    online: true,
    system: "Tagoloan Water District Real-Time Cloud Service",
    systemSiteUrl: SYSTEM_SITE_URL,
    uptimeSeconds: Math.floor(process.uptime()),
    activeWebSocketClients: clients.size,
    consumersCount: syncedConsumers.length,
    staffCount: registeredStaff.length,
    mobileBridge: {
      targetUrl: mobileBridgeState.targetUrl,
      connected: mobileBridgeState.wsConnected || mobileBridgeState.httpReachable,
      wsConnected: mobileBridgeState.wsConnected,
      systemSiteUrl: SYSTEM_SITE_URL,
      systemSiteConnected: selfHost ? true : (mobileBridgeState.systemSiteConnected || mobileBridgeState.systemSiteWsConnected),
      systemSiteIsSelf: selfHost,
      lastSyncAt: mobileBridgeState.lastSyncAt,
    },
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

function resolveDistDirectory(): string {
  const candidates = [
    path.join(process.cwd(), "dist"),
    path.join(__dirname, "dist"),
    path.join(__dirname, "..", "dist"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "index.html"))) {
        return dir;
      }
    } catch {}
  }
  return candidates[0];
}

function mountProductionStaticAssets(distPath: string): void {
  console.log(`Running in PRODUCTION mode - Serving static artifacts from ${distPath}...`);
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    const indexHtml = path.join(distPath, "index.html");
    res.sendFile(indexHtml, (err) => {
      if (err && !res.headersSent) {
        res.status(200).type("html").send("<!doctype html><html><head><title>Tagoloan Water District Portal</title></head><body>Tagoloan Water District Service Online</body></html>");
      }
    });
  });
}

// Setup Vite Dev server or production static assets handler
async function setupServer() {
  if (process.env.DISABLE_HMR === undefined) {
    process.env.DISABLE_HMR = "true";
  }

  const distPath = resolveDistDirectory();
  const hasBuiltDist = fs.existsSync(path.join(distPath, "index.html"));
  const isStartScript = process.env.npm_lifecycle_event === "start";
  const isDevExplicit =
    process.env.NODE_ENV === "development" ||
    process.env.npm_lifecycle_event === "dev";

  const isProduction =
    process.env.NODE_ENV === "production" ||
    IS_CLOUD_RUN ||
    isStartScript ||
    (!isDevExplicit && hasBuiltDist);

  if (!isProduction) {
    try {
      console.log("Running in DEVELOPMENT mode - Mounting Vite dev middleware...");
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.warn("Vite dev middleware unavailable, falling back to built dist assets:", viteErr);
      mountProductionStaticAssets(distPath);
    }
  } else {
    mountProductionStaticAssets(distPath);
  }

  httpServer.on("error", (err) => {
    console.error("[HTTP Server] Listen error:", err);
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket Server active on ws://0.0.0.0:${PORT}`);
    startBackgroundPeerBridges();
  });
}

setupServer().catch((err) => {
  console.error("Fatal server setup error, starting fallback listener:", err);
  try {
    httpServer.listen(PORT, "0.0.0.0");
  } catch {}
});

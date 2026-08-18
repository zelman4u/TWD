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

// Keep pool of connected sockets
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("WebSocket client connected. Active connections:", clients.size);

  // Send initial welcome event
  ws.send(JSON.stringify({ 
    type: "system:connected", 
    message: "Connected to Tagoloan District Secure Payment Broker" 
  }));

  ws.on("message", (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());
      console.log("WS received payload:", data);

      if (data.type === "payment:start") {
        const { readingId, accountNumber, amount, paymentMethod, billingPeriod } = data.payload;

        // Simulate multi-tier payment verification over WS lines
        // 1. Initial Processing
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

        // 2. Gateway Authorization
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

        // 3. Database Sync & Ledger Settle
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

        // 4. Success Completion
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

            // Broadcast payment announcement to other connected clients
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

// Serve health route
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", activeWebSocketClients: clients.size });
});

// Setup Vite Dev server or production static assets handler
async function setupVite() {
  if (process.env.DISABLE_HMR === undefined) {
    // Ensure we follow platform parameters
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
    console.log(`Server launched on http://0.0.0.5:${PORT}`);
    console.log(`WebSocket Server active on ws://0.0.0.5:${PORT}`);
  });
}

setupVite();

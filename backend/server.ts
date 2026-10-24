import express from "express";
import { masterApiRouter } from "./routes/index.ts";
import { authMiddleware } from "./middlewares/authMiddleware.ts";
import { errorHandler } from "./middlewares/errorHandler.ts";
import { rateLimiterMiddleware } from "./middlewares/rateLimiter.ts";
import { ENV_CONFIG } from "./config/env.ts";

export function createBackendApp() {
  const app = express();

  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  // Global Anti-Bot Rate Limiting Middleware
  app.use(rateLimiterMiddleware(180, 60000));

  // Global Auth/Security Middleware
  app.use(authMiddleware);

  // Mount API Subsystem
  app.use("/api/v1", masterApiRouter);

  // Central Error Handler
  app.use(errorHandler);

  return app;
}

export { ENV_CONFIG };

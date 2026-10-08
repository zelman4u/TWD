import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.ts";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  logger.error(`Unhandled error at ${req.method} ${req.url}:`, err);
  res.status(500).json({
    success: false,
    message: err.message || "An unexpected error occurred in Tagoloan Water District backend.",
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
}

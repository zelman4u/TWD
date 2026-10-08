import { Response } from "express";

export function successResponse<T>(res: Response, data: T, message = "Success", statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
}

export function errorResponse(res: Response, message = "Internal Server Error", statusCode = 500, error?: unknown) {
  return res.status(statusCode).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : error,
    timestamp: new Date().toISOString()
  });
}

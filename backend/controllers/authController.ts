import { Request, Response } from "express";
import { successResponse, errorResponse } from "../utils/responseHelper.ts";

export const authController = {
  login: async (req: Request, res: Response) => {
    try {
      const { username, password, role } = req.body;
      if (!username || !password) {
        return errorResponse(res, "Username and password are required.", 400);
      }
      return successResponse(res, {
        token: `twd_auth_${Date.now()}`,
        user: {
          id: "USR-001",
          username,
          name: role === "admin" ? "District General Manager" : "Field Meter Officer",
          role: role || "admin"
        }
      }, "Authentication successful.");
    } catch (err) {
      return errorResponse(res, "Login failed", 500, err);
    }
  },

  verifySession: async (req: Request, res: Response) => {
    return successResponse(res, { valid: true }, "Session is valid.");
  }
};

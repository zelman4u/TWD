import { Request, Response, NextFunction } from "express";

export type UserRole = "ADMIN" | "METER_READER" | "CONSUMER" | "GUEST";

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  assignedBarangays?: string[];
  accountNumber?: string;
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Global Authentication Token Parser
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  // Public and health probe paths
  if (
    req.path.startsWith("/public") ||
    req.path.startsWith("/health") ||
    req.path.startsWith("/api/health") ||
    req.path.startsWith("/api/status") ||
    req.path.startsWith("/api/barangays")
  ) {
    return next();
  }

  // Parse Bearer Token or Identity Headers
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token.startsWith("twd_admin_")) {
      req.user = { id: "admin-master", role: "ADMIN" };
    } else if (token.startsWith("twd_jwt_")) {
      const parts = token.split("_");
      const readerId = parts[parts.length - 1] || "staff";
      req.user = { id: readerId, role: "METER_READER" };
    } else if (token.startsWith("consumer_")) {
      req.user = { id: token, role: "CONSUMER" };
    }
  }

  next();
}

/**
 * Enforces Role-Based Access Control (RBAC) on Protected Endpoints
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role || "GUEST";

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: `Access denied. Endpoint requires one of [${allowedRoles.join(", ")}]. Your current role is '${userRole}'.`
      });
    }

    next();
  };
}


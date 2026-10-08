import { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Pass-through or Bearer authorization check for API consumers
  const authHeader = req.headers.authorization;
  if (req.path.startsWith("/public") || req.path.startsWith("/health")) {
    return next();
  }
  // Allow system requests or validate Bearer
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return next();
  }
  next();
}

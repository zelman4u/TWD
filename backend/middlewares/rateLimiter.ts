import { Request, Response, NextFunction } from "express";

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const ipBuckets = new Map<string, RateLimitRecord>();

export function rateLimiterMiddleware(maxRequests: number = 180, windowMs: number = 60000) {
  // Prune expired buckets periodically
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipBuckets.entries()) {
      if (now > record.resetTime) {
        ipBuckets.delete(ip);
      }
    }
  }, windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    // Exempt health probes
    if (req.path.includes("/health") || req.path.includes("/status")) {
      return next();
    }

    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let record = ipBuckets.get(clientIp);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      ipBuckets.set(clientIp, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", retryAfter);

    if (record.count > maxRequests) {
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({
        success: false,
        error: "Too Many Requests",
        message: `Rate limit exceeded. Exceeded limit of ${maxRequests} requests per minute.`,
        retryAfterSeconds: retryAfter
      });
    }

    next();
  };
}

import type { NextFunction, Request, RequestHandler, Response } from "express";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export function decodedImageBytes(dataUrl: string): number | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const encoded = dataUrl.slice(comma + 1);
  if (
    encoded.length === 0 ||
    encoded.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    return null;
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    public readonly max: number,
    public readonly windowMs: number,
  ) {}

  consume(
    key: string,
    now = Date.now(),
  ): { allowed: boolean; remaining: number; resetAt: number } {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (this.buckets.size > 5_000) {
      for (const [candidate, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(candidate);
      }
      if (this.buckets.size > 10_000) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (oldest) this.buckets.delete(oldest);
      }
    }

    return {
      allowed: bucket.count <= this.max,
      remaining: Math.max(0, this.max - bucket.count),
      resetAt: bucket.resetAt,
    };
  }
}

export function rateLimit(options: {
  max: number;
  windowMs: number;
  message: string;
}): RequestHandler {
  const limiter = new FixedWindowRateLimiter(options.max, options.windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const result = limiter.consume(key);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(result.remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
      );
      res.status(429).json({ error: options.message });
      return;
    }
    next();
  };
}

export const analysisRateLimit = rateLimit({
  max: 6,
  windowMs: 60 * 60 * 1000,
  message: "Too many analysis requests. Please try again later.",
});

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self' data: https://fonts.gstatic.com",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    ].join("; "),
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
}

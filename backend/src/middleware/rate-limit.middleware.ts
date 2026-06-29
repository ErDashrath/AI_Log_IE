import rateLimit from "express-rate-limit";

/**
 * Rate Limiter Middleware
 * 
 * Global rate limiter: 100 requests per 15 minutes per IP.
 * Prevents abuse of the AI endpoints which are expensive (LLM calls).
 */
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
    processingTimeMs: 0,
    data: null,
  },
});

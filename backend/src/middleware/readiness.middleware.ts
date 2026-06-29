import { Request, Response, NextFunction } from "express";
import { IMemoryRepository } from "../repository/IMemoryRepository";

/**
 * Readiness Guard Middleware
 * 
 * A single global Express middleware applied before all /api/ai routes.
 * Inspects the MemoryRepository state before any controller logic runs.
 * 
 * This eliminates the TOCTOU race condition from V6.0 where each
 * controller had its own if-statement check.
 * 
 * States:
 *   $LOADING$ → 503 with retryAfterMs
 *   $FAILED$  → 500 with error message
 *   $READY$   → next() — controller is guaranteed safe
 */
export function readinessGuard(repo: IMemoryRepository) {
  return (req: Request, res: Response, next: NextFunction) => {
    const state = repo.getState();

    if (state === "$LOADING$") {
      return res.status(503).json({
        success: false,
        message: "Engine initializing. Retry in a few seconds.",
        processingTimeMs: 0,
        data: null,
        retryAfterMs: repo.estimatedReadyMs(),
      });
    }

    if (state === "$FAILED$") {
      return res.status(500).json({
        success: false,
        message: "Engine failed to initialize. Check server logs.",
        processingTimeMs: 0,
        data: null,
      });
    }

    next(); // state === "$READY$" — guaranteed safe
  };
}

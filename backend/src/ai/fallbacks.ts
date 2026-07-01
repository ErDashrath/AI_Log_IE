import { ClassificationResponse } from "../schemas/classification.schema";
import { TimelineResponse } from "../schemas/timeline.schema";
import { RCAResponse } from "../schemas/rca.schema";

/**
 * Typed Fallback Objects
 * 
 * Returned when the circuit breaker opens or all retries are exhausted.
 * Critically, these are schema-validated against the same Zod schema 
 * as a successful response — the frontend never receives an untyped 
 * null or empty object.
 */

export const FALLBACK_CLASSIFICATION: ClassificationResponse = {
  classifications: [],
  totalClassified: 0,
  categorySummary: {},
  mode: "auto",
  fallback: true,
  fallbackReason: "AI service temporarily unavailable. Classification results pending.",
};


export const FALLBACK_TIMELINE: TimelineResponse = {
  events: [],
  fallback: true,
  fallbackReason: "AI service temporarily unavailable. Timeline generation pending.",
};

export const FALLBACK_RCA: RCAResponse = {
  rootCause: "Analysis unavailable",
  evidence: [],
  impact: "Unknown — AI service temporarily unavailable.",
  recommendation: "Retry when AI service recovers.",
  confidence: 0,
  fallback: true,
};

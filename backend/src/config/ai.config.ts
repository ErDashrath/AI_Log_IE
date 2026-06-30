import { ApiEndpoint } from "../retrieval/IRetrievalFactory";

/**
 * AI Configuration
 * 
 * Centralized configuration for AI model parameters.
 * Temperature values are tuned per-endpoint based on the
 * determinism-creativity spectrum of each task.
 */
export const AI_CONFIG = {
  /** Gemini model identifier */
  model: process.env.GEMINI_MODEL || "gemini-2.0-flash",

  /** Temperature per endpoint */
  temperatures: {
    classification: 0.0,  // Deterministic mapping — no hallucinated categories
    timeline: 0.2,        // Summarization flexibility, but must stay factual
    rca: 0.3,             // Inductive reasoning — forming hypotheses from evidence
  } as Record<ApiEndpoint, number>,

  /** Max output tokens per LLM call */
  completionBudget: 4096,

  /** Max logs sent to LLM per request */
  contextBudget: 20,

  /** Max log entries accepted in classification request */
  maxClassificationLogs: 50,
};

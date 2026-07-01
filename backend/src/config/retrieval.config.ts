/**
 * Retrieval Configuration
 * 
 * Tuning parameters for the Evidence Ranker scoring formula
 * and MiniSearch BM25 configuration.
 */
export const RETRIEVAL_CONFIG = {
  /** Evidence Ranker weights — must sum to 1.0 */
  evidenceWeights: {
    severity: 0.35,
    bm25: 0.30,
    timeProximity: 0.20,
    contextDensity: 0.15,
  },

  /** MiniSearch configuration */
  miniSearch: {
    fields: ["message", "template", "component"],
    storeFields: ["message", "template", "component", "severity"],
    searchOptions: {
      boost: { message: 2, template: 1.5, component: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  },

  /** Maximum logs to send to LLM after ranking (keep small for speed) */
  contextBudget: 10,


  /** Max duplicate templates allowed in context */
  maxTemplatesPerGroup: 2,

  /** Time window (ms) for auto-detect error density analysis */
  errorDensityWindowMs: 30 * 60 * 1000, // 30 minutes
};

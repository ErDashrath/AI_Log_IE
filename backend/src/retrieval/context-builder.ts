import { ParsedLog, RankedLog } from "../types/models";
import { RETRIEVAL_CONFIG } from "../config/retrieval.config";

/**
 * Context Builder — Final Gate Before LLM
 * 
 * Three jobs:
 *   1. Deduplication by log template (max 2 per template)
 *      → Prevents sending 50 identical "worker child exiting" lines
 *   2. Hard enforcement of the 20-log budget
 *      → Prevents token exhaustion in Gemini
 *   3. Chronological ordering
 *      → LLM can reason about temporal patterns
 */
export class ContextBuilder {
  /**
   * Builds the final context array from ranked candidates.
   * 
   * @param ranked - Logs ranked by Evidence Ranker (highest score first)
   * @param budget - Max logs to include (default: 20)
   * @returns Deduplicated, budget-capped, chronologically sorted logs
   */
  buildContext(
    ranked: RankedLog[],
    budget: number = RETRIEVAL_CONFIG.contextBudget
  ): ParsedLog[] {
    const maxPerTemplate = RETRIEVAL_CONFIG.maxTemplatesPerGroup;
    const templateCounts = new Map<string, number>();
    const context: ParsedLog[] = [];

    for (const { log } of ranked) {
      if (context.length >= budget) break;

      // Dedup: allow max N logs per unique template
      const currentCount = templateCounts.get(log.template) || 0;
      if (currentCount >= maxPerTemplate) continue;

      context.push(log);
      templateCounts.set(log.template, currentCount + 1);
    }

    // Sort chronologically before sending to LLM
    return context.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
  }
}

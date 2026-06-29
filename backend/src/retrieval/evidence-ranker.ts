import { ParsedLog, RankedLog } from "../types/models";
import { RETRIEVAL_CONFIG } from "../config/retrieval.config";

/**
 * Evidence Ranker — Production Scoring Formula
 * 
 * The intelligence layer between BM25 candidate selection and LLM context.
 * 
 * Scoring Formula (V7.0 — BM25 max-normalized):
 *   FinalScore = 0.35 × SeverityWeight
 *              + 0.30 × NormalizedBM25     (capped at 1.0)
 *              + 0.20 × TimeProximity      (recency bias)
 *              + 0.15 × ContextDensity     (error-cluster density)
 * 
 * Critical fix from V6.0:
 *   BM25 scores are max-normalized to [0, 1] before weighting.
 *   This prevents keyword-stuffing attacks from gaming the ranking.
 *   A log with 100 repetitions of "error" scores identically to one with 1.
 */
export class EvidenceRanker {
  private readonly weights = RETRIEVAL_CONFIG.evidenceWeights;

  rank(
    candidates: { id: number; score: number }[],
    query: string,
    allLogs: readonly ParsedLog[]
  ): RankedLog[] {
    if (candidates.length === 0) return [];

    // Step 1: Max-normalize BM25 scores to [0, 1] — critical fix
    const maxBM25 = candidates.reduce((m, c) => Math.max(m, c.score), 1);

    // Step 2: Find the most recent timestamp for recency calculation
    const now = new Date();
    const timestamps = candidates
      .map((c) => allLogs[c.id]?.timestamp?.getTime() || 0)
      .filter((t) => t > 0);
    const maxTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : now.getTime();
    const minTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : now.getTime();
    const timeRange = maxTimestamp - minTimestamp || 1; // prevent division by zero

    return candidates
      .map((c) => {
        const log = allLogs[c.id];
        if (!log) return null;

        const normBM25 = Math.min(c.score / maxBM25, 1.0); // capped at 1.0
        const sevWeight = this.severityWeight(log.severity);
        const timeProx = this.timeProximity(log.timestamp, minTimestamp, timeRange);
        const ctxDensity = this.contextDensity(log, c.id, allLogs);

        const finalScore =
          this.weights.severity * sevWeight +
          this.weights.bm25 * normBM25 +
          this.weights.timeProximity * timeProx +
          this.weights.contextDensity * ctxDensity;

        return { log, lineNum: c.id, finalScore };
      })
      .filter((r): r is RankedLog => r !== null)
      .sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Deterministic severity weights.
   * Higher severity → higher weight → more likely to appear in context.
   */
  private severityWeight(severity: string): number {
    const weights: Record<string, number> = {
      emerg: 1.0,
      alert: 1.0,
      crit: 1.0,
      error: 0.9,
      warn: 0.7,
      warning: 0.7,
      notice: 0.4,
      info: 0.2,
      debug: 0.1,
      trace: 0.05,
    };
    return weights[severity.toLowerCase()] ?? 0.1;
  }

  /**
   * Time proximity — how recent is this log relative to the full range?
   * Returns 0-1 where 1 = most recent.
   */
  private timeProximity(timestamp: Date, minTimestamp: number, timeRange: number): number {
    const t = timestamp.getTime();
    return (t - minTimestamp) / timeRange;
  }

  /**
   * Context density — do neighboring logs also contain errors?
   * A log surrounded by other errors is more likely to be part of
   * a meaningful incident pattern.
   * 
   * Checks ±5 neighbors for error/crit/warn severity.
   */
  private contextDensity(
    log: ParsedLog,
    lineNum: number,
    allLogs: readonly ParsedLog[]
  ): number {
    const windowSize = 5;
    const start = Math.max(0, lineNum - windowSize);
    const end = Math.min(allLogs.length - 1, lineNum + windowSize);
    const errorSeverities = new Set(["error", "crit", "emerg", "alert", "warn", "warning"]);

    let errorNeighbors = 0;
    let totalNeighbors = 0;

    for (let i = start; i <= end; i++) {
      if (i === lineNum) continue;
      totalNeighbors++;
      if (allLogs[i] && errorSeverities.has(allLogs[i].severity)) {
        errorNeighbors++;
      }
    }

    return totalNeighbors > 0 ? errorNeighbors / totalNeighbors : 0;
  }
}

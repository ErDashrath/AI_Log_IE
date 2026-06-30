import { injectable } from "tsyringe";
import { IMemoryRepository, RepositoryState } from "./IMemoryRepository";
import { ParsedLog } from "../types/models";

/**
 * MemoryRepository — The Single Source of Truth
 * 
 * All log data lives exclusively in Node.js process memory.
 * A single canonical ParsedLog[] array holds all parsed logs.
 * All indexes (Phase 3) store integer line numbers pointing
 * into this array — not object references.
 * 
 * This means the GC sees exactly ONE reference to each log object,
 * keeping memory at O(n) instead of O(5n).
 * 
 * State Machine:
 *   $LOADING$  → Ingestion in progress. AI APIs return 503.
 *   $READY$    → Ingestion complete. AI APIs are available.
 *   $FAILED$   → Ingestion failed. AI APIs return 500.
 */
@injectable()
export class MemoryRepository implements IMemoryRepository {
  private logs: ParsedLog[] = [];
  private state: RepositoryState = "$LOADING$";
  private ingestionStartMs: number = Date.now();

  /**
   * Appends a parsed log to the canonical array.
   * @returns The line number (index) of the inserted log.
   */
  addLog(log: ParsedLog): number {
    this.logs.push(log);
    return this.logs.length - 1;
  }

  /**
   * Resolves line numbers to their ParsedLog objects.
   * O(1) per lookup — no copies, no clones.
   */
  getByLineNums(lineNums: number[]): ParsedLog[] {
    return lineNums
      .filter((n) => n >= 0 && n < this.logs.length)
      .map((n) => this.logs[n]);
  }

  /**
   * Returns a read-only view of all logs.
   * No clone is made — callers must not mutate.
   */
  getLogs(): readonly ParsedLog[] {
    return this.logs;
  }

  /**
   * Returns the current repository state.
   */
  getState(): RepositoryState {
    return this.state;
  }

  /**
   * Transitions the repository to a new state.
   */
  setState(state: RepositoryState): void {
    this.state = state;
    if (state === "$LOADING$") {
      this.ingestionStartMs = Date.now();
    }
  }

  /**
   * Estimates the remaining time until ingestion completes.
   * Used by the readiness middleware to inform clients when to retry.
   */
  estimatedReadyMs(): number {
    if (this.state !== "$LOADING$") return 0;
    const elapsed = Date.now() - this.ingestionStartMs;
    // Rough estimate: ingestion takes ~2s for 2k logs
    const estimatedTotal = 2000;
    return Math.max(0, estimatedTotal - elapsed);
  }

  /**
   * Returns summary statistics about the ingested logs.
   * Used by the /ready health endpoint.
   */
  getStats(): {
    totalLogs: number;
    errorCount: number;
    warningCount: number;
    uniqueTemplates: number;
    uniqueComponents: number;
  } {
    const errorCount = this.logs.filter(
      (l) => l.severity === "error" || l.severity === "crit"
    ).length;

    const warningCount = this.logs.filter(
      (l) => l.severity === "warn" || l.severity === "warning"
    ).length;

    const uniqueTemplates = new Set(this.logs.map((l) => l.template)).size;
    const uniqueComponents = new Set(this.logs.map((l) => l.component)).size;

    return {
      totalLogs: this.logs.length,
      errorCount,
      warningCount,
      uniqueTemplates,
      uniqueComponents,
    };
  }

  /**
   * Resets all data for a new file upload.
   */
  reset(): void {
    this.logs = [];
    this.state = "$LOADING$";
    this.ingestionStartMs = Date.now();
  }
}

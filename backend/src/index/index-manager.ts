import { injectable } from "tsyringe";
import { IIndexManager } from "./IIndexManager";
import { ParsedLog } from "../types/models";

/**
 * IndexManager — Stub for Phase 2
 * 
 * Minimal implementation that accepts index() calls from the ingestor.
 * Full indexing (Map<string, number[]>, MiniSearch BM25, severity/timestamp
 * indexes) will be implemented in Phase 3.
 * 
 * All indexes store number[] (line numbers into the canonical ParsedLog[]),
 * NOT object references. This is the key memory optimization.
 */
@injectable()
export class IndexManager implements IIndexManager {
  private severityIndex = new Map<string, number[]>();
  private componentIndex = new Map<string, number[]>();
  private templateIndex = new Map<string, number[]>();
  private timestampSorted: number[] = [];

  /**
   * Indexes a parsed log entry by storing its line number
   * in each relevant index map.
   */
  index(log: ParsedLog, lineNum: number): void {
    // Severity index
    this.addToMap(this.severityIndex, log.severity, lineNum);

    // Component index
    this.addToMap(this.componentIndex, log.component, lineNum);

    // Template index
    this.addToMap(this.templateIndex, log.template, lineNum);

    // Timestamp sorted (append — logs are generally chronological)
    this.timestampSorted.push(lineNum);
  }

  /**
   * Stub — will be implemented with MiniSearch BM25 in Phase 3
   */
  search(query: string, options?: any): any[] {
    return [];
  }

  /**
   * Stub — will be implemented in Phase 3
   */
  getLogsByTimeWindow(startTime?: Date, endTime?: Date): number[] {
    return this.timestampSorted;
  }

  /**
   * Stub — will be implemented in Phase 3
   */
  getHighestErrorDensityWindow(): { start: Date; end: Date } {
    return { start: new Date(), end: new Date() };
  }

  // --- Internal helpers ---

  private addToMap(map: Map<string, number[]>, key: string, lineNum: number): void {
    const existing = map.get(key);
    if (existing) {
      existing.push(lineNum);
    } else {
      map.set(key, [lineNum]);
    }
  }

  // Expose for Phase 3
  getSeverityIndex(): Map<string, number[]> { return this.severityIndex; }
  getComponentIndex(): Map<string, number[]> { return this.componentIndex; }
  getTemplateIndex(): Map<string, number[]> { return this.templateIndex; }
  getTimestampSorted(): number[] { return this.timestampSorted; }
}

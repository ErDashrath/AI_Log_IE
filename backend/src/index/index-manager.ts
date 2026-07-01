import { injectable } from "tsyringe";
import { IIndexManager } from "./IIndexManager";
import { ParsedLog } from "../types/models";
import MiniSearch from "minisearch";
import { RETRIEVAL_CONFIG } from "../config/retrieval.config";
import pino from "pino";

const logger = pino({ name: "index-manager" });

/**
 * IndexManager — In-Memory Multi-Index with BM25 Full-Text Search
 * 
 * All indexes store number[] (line numbers into the canonical ParsedLog[]),
 * NOT object references. This is the key memory optimization — the GC sees
 * exactly one reference per log object.
 * 
 * Indexes:
 *   - severityIndex:  Map<string, number[]>  — O(1) filter by severity
 *   - componentIndex: Map<string, number[]>  — O(1) filter by component
 *   - templateIndex:  Map<string, number[]>  — O(1) filter by template
 *   - timestampSorted: number[]              — chronological order
 *   - miniSearch:     MiniSearch              — BM25 full-text search
 * 
 * Memory at 200k logs: ~50MB for indexes (vs ~240MB total system).
 */
@injectable()
export class IndexManager implements IIndexManager {
  private severityIndex = new Map<string, number[]>();
  private componentIndex = new Map<string, number[]>();
  private templateIndex = new Map<string, number[]>();
  private timestampSorted: { lineNum: number; timestamp: Date }[] = [];
  private allLogs: ParsedLog[] = []; // reference for time-window lookups
  private miniSearchDocs: any[] = [];

  private miniSearch: MiniSearch;


  constructor() {
    this.miniSearch = new MiniSearch({
      fields: RETRIEVAL_CONFIG.miniSearch.fields,
      storeFields: RETRIEVAL_CONFIG.miniSearch.storeFields,
      idField: "id",
    });
  }

  /**
   * Indexes a parsed log entry by storing its line number
   * in each relevant index map + MiniSearch.
   */
  index(log: ParsedLog, lineNum: number): void {
    // Map-based indexes — store lineNum only
    this.addToMap(this.severityIndex, log.severity, lineNum);
    this.addToMap(this.componentIndex, log.component, lineNum);
    this.addToMap(this.templateIndex, log.template, lineNum);

    // Timestamp sorted list
    this.timestampSorted.push({ lineNum, timestamp: log.timestamp });

    // Keep reference for time-window lookups
    this.allLogs[lineNum] = log;

    // MiniSearch — collect for batch indexing
    this.miniSearchDocs.push({
      id: lineNum,
      message: log.message,
      template: log.template,
      component: log.component,
      severity: log.severity,
    });
  }

  /**
   * Finalizes indexing after ingestion completes.
   * Performs a batch add to MiniSearch which is vastly faster than 1x1.
   */
  finalize(): void {
    if (this.miniSearchDocs.length > 0) {
      this.miniSearch.addAll(this.miniSearchDocs);
      logger.info({
        msg: "MiniSearch batch indexing complete",
        count: this.miniSearchDocs.length,
      });
      this.miniSearchDocs = [];
    }
  }


  /**
   * BM25 full-text search via MiniSearch.
   * Returns results with { id (lineNum), score, match }.
   */
  search(query: string, options?: any): any[] {
    return this.miniSearch.search(query, {
      ...RETRIEVAL_CONFIG.miniSearch.searchOptions,
      ...options,
    });
  }

  /**
   * Returns line numbers of logs within a time window.
   * If no window specified, returns all sorted line numbers.
   */
  getLogsByTimeWindow(startTime?: Date, endTime?: Date): number[] {
    if (!startTime && !endTime) {
      return this.timestampSorted.map((e) => e.lineNum);
    }

    return this.timestampSorted
      .filter((entry) => {
        const t = entry.timestamp.getTime();
        if (startTime && t < startTime.getTime()) return false;
        if (endTime && t > endTime.getTime()) return false;
        return true;
      })
      .map((e) => e.lineNum);
  }

  /**
   * Finds the 30-minute window with the highest density of error/crit logs.
   * Used by Timeline and RCA auto-detect when no time range is specified.
   */
  getHighestErrorDensityWindow(): { start: Date; end: Date } {
    const errorLineNums = [
      ...(this.severityIndex.get("error") || []),
      ...(this.severityIndex.get("crit") || []),
    ];

    if (errorLineNums.length === 0) {
      // No errors — use the full dataset time range
      if (this.timestampSorted.length === 0) {
        return { start: new Date(), end: new Date() };
      }
      return {
        start: this.timestampSorted[0].timestamp,
        end: this.timestampSorted[this.timestampSorted.length - 1].timestamp,
      };
    }

    // Get error timestamps sorted
    const errorTimestamps = errorLineNums
      .map((ln) => this.allLogs[ln]?.timestamp)
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime());

    // Sliding window: find the 30-min window with the most errors
    const windowMs = RETRIEVAL_CONFIG.errorDensityWindowMs;
    let bestStart = errorTimestamps[0];
    let bestCount = 0;

    for (let i = 0; i < errorTimestamps.length; i++) {
      const windowEnd = new Date(errorTimestamps[i].getTime() + windowMs);
      let count = 0;
      for (let j = i; j < errorTimestamps.length; j++) {
        if (errorTimestamps[j].getTime() <= windowEnd.getTime()) {
          count++;
        } else {
          break;
        }
      }
      if (count > bestCount) {
        bestCount = count;
        bestStart = errorTimestamps[i];
      }
    }

    logger.info({
      msg: "Error density window detected",
      start: bestStart.toISOString(),
      end: new Date(bestStart.getTime() + windowMs).toISOString(),
      errorCount: bestCount,
    });

    return {
      start: bestStart,
      end: new Date(bestStart.getTime() + windowMs),
    };
  }

  /**
   * Returns line numbers filtered by severity.
   */
  getLogsBySeverity(severity: string): number[] {
    return this.severityIndex.get(severity) || [];
  }

  /**
   * Returns line numbers filtered by component.
   */
  getLogsByComponent(component: string): number[] {
    return this.componentIndex.get(component) || [];
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

  // Expose indexes for retrieval strategies
  getSeverityIndex(): Map<string, number[]> { return this.severityIndex; }
  getComponentIndex(): Map<string, number[]> { return this.componentIndex; }
  getTemplateIndex(): Map<string, number[]> { return this.templateIndex; }
  getTimestampSorted(): { lineNum: number; timestamp: Date }[] { return this.timestampSorted; }

  /**
   * Resets all indexes for a new file upload.
   */
  reset(): void {
    this.severityIndex = new Map();
    this.componentIndex = new Map();
    this.templateIndex = new Map();
    this.timestampSorted = [];
    this.allLogs = [];
    this.miniSearchDocs = [];
    this.miniSearch = new MiniSearch({

      fields: RETRIEVAL_CONFIG.miniSearch.fields,
      storeFields: RETRIEVAL_CONFIG.miniSearch.storeFields,
      idField: "id",
    });
  }
}

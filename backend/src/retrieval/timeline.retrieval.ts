import { IRetrievalStrategy } from "./IRetrievalFactory";
import { ParsedLog } from "../types/models";
import { IMemoryRepository } from "../repository/IMemoryRepository";
import { IIndexManager } from "../index/IIndexManager";
import { RETRIEVAL_CONFIG } from "../config/retrieval.config";

/**
 * TimelineRetrieval — Timestamp-Based Slicing Strategy
 * 
 * Timeline is purely temporal — BM25 on message content would
 * introduce topical bias. Instead, we slice the timestamp index
 * for the requested time window.
 * 
 * If no time window is specified, auto-detects the highest
 * error-density 30-minute window.
 */
export class TimelineRetrieval implements IRetrievalStrategy {
  constructor(
    private repo: IMemoryRepository,
    private indexManager: IIndexManager,
    private startTime?: Date,
    private endTime?: Date
  ) {}

  async retrieve(): Promise<ParsedLog[]> {
    let lineNums: number[];

    if (this.startTime && this.endTime) {
      // Explicit time window
      lineNums = this.indexManager.getLogsByTimeWindow(this.startTime, this.endTime);
    } else {
      // Auto-detect: highest error-density window
      const window = this.indexManager.getHighestErrorDensityWindow();
      lineNums = this.indexManager.getLogsByTimeWindow(window.start, window.end);
    }

    // Get full log objects, cap at context budget
    const logs = this.repo.getByLineNums(lineNums);
    
    // For timeline, we want chronological order and a reasonable budget
    return logs
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(0, RETRIEVAL_CONFIG.contextBudget);
  }
}

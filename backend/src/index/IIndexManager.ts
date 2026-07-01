import { ParsedLog } from "../types/models";

export interface IIndexManager {
  index(log: ParsedLog, lineNum: number): void;
  
  // To be implemented in Phase 3
  search(query: string, options?: any): any[];
  getLogsByTimeWindow(startTime?: Date, endTime?: Date): number[];
  getHighestErrorDensityWindow(): { start: Date; end: Date };
  finalize?(): void;
}


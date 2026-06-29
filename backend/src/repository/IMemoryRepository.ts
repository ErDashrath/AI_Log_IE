import { ParsedLog } from "../types/models";

export type RepositoryState = "$LOADING$" | "$READY$" | "$FAILED$";

export interface IMemoryRepository {
  addLog(log: ParsedLog): number;
  getByLineNums(lineNums: number[]): ParsedLog[];
  getLogs(): readonly ParsedLog[];
  getState(): RepositoryState;
  setState(state: RepositoryState): void;
  estimatedReadyMs(): number;
}

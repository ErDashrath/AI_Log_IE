import { ParsedLog } from "../types/models";

export interface ILogParser {
  parseLine(line: string): ParsedLog | null;
}

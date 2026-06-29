export interface ParsedLog {
  raw: string;
  timestamp: Date;
  severity: string;
  component: string;
  message: string;
  template: string;
}

export interface RankedLog {
  log: ParsedLog;
  lineNum: number;
  finalScore: number;
}

export interface SearchResult {
  id: number;
  score: number;
  match: any;
}

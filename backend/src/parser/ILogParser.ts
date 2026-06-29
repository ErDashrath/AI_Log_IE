import { ParsedLog } from "../types/models";

/**
 * ILogParser — Format-Agnostic Parser Interface
 * 
 * Every log format (Apache, NGINX, Syslog, cloud-native, etc.)
 * is implemented as a plugin behind this interface.
 * 
 * To add a new format:
 *   1. Create a new class implementing ILogParser
 *   2. Register it in ParserRegistry
 *   3. No business logic changes needed — ingestion, indexing, 
 *      retrieval, and AI layers are format-agnostic.
 */
export interface ILogParser {
  /** Unique identifier for this parser (e.g., "apache", "nginx", "syslog") */
  readonly formatName: string;

  /** 
   * Attempts to parse a single log line.
   * Returns null if the line doesn't match this parser's format.
   */
  parseLine(line: string): ParsedLog | null;

  /**
   * Tests whether this parser can handle a sample of log lines.
   * Used by ParserRegistry for auto-detection.
   * @param sampleLines First 5-10 lines of the log file
   * @returns confidence score 0-1 (1 = definitely this format)
   */
  detect(sampleLines: string[]): number;
}

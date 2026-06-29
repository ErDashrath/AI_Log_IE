import { injectable } from "tsyringe";
import { ILogParser } from "./ILogParser";
import { ParsedLog } from "../types/models";

/**
 * Generic Fallback Parser
 * 
 * Handles log lines that don't match any specific format.
 * Extracts whatever structure it can using common patterns:
 *   - ISO 8601 timestamps
 *   - Syslog-style timestamps
 *   - Common severity keywords (ERROR, WARN, INFO, DEBUG, etc.)
 * 
 * This ensures the system never fails on unknown formats —
 * it gracefully degrades to best-effort parsing.
 */
@injectable()
export class GenericParser implements ILogParser {
  readonly formatName = "generic";

  // Common timestamp patterns
  private static readonly TIMESTAMP_PATTERNS = [
    // ISO 8601: 2023-12-01T10:02:00Z or 2023-12-01 10:02:00
    /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
    // Syslog: Dec  4 04:47:44
    /(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
    // Apache: [Sun Dec 04 04:47:44 2005]
    /\[(\w{3} \w{3} \d{2} \d{2}:\d{2}:\d{2} \d{4})\]/,
    // Common log: 04/Dec/2005:04:47:44
    /(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2})/,
  ];

  // Severity keywords (case-insensitive)
  private static readonly SEVERITY_REGEX =
    /\b(emerg|alert|crit|critical|error|err|warn|warning|notice|info|debug|trace|fatal)\b/i;

  /**
   * Generic parser has the lowest detection confidence.
   * It's the fallback — always returns 0.1 so specific parsers win.
   */
  detect(sampleLines: string[]): number {
    return 0.1; // Always available as fallback
  }

  parseLine(line: string): ParsedLog | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const timestamp = this.extractTimestamp(trimmed);
    const severity = this.extractSeverity(trimmed);
    const message = this.cleanMessage(trimmed);

    return {
      raw: trimmed,
      timestamp: timestamp || new Date(0), // epoch fallback
      severity,
      component: "unknown",
      message,
      template: this.extractTemplate(message),
    };
  }

  private extractTimestamp(line: string): Date | null {
    for (const pattern of GenericParser.TIMESTAMP_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        const date = new Date(match[1]);
        if (!isNaN(date.getTime())) return date;
      }
    }
    return null;
  }

  private extractSeverity(line: string): string {
    const match = GenericParser.SEVERITY_REGEX.exec(line);
    if (!match) return "info"; // default severity

    const raw = match[1].toLowerCase();
    // Normalize aliases
    const aliases: Record<string, string> = {
      err: "error",
      critical: "crit",
      warning: "warn",
    };
    return aliases[raw] || raw;
  }

  private cleanMessage(line: string): string {
    // Remove common timestamp/severity wrappers to get pure message
    return line
      .replace(/^\[.*?\]\s*/g, "")  // Remove [bracketed] prefixes
      .replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*\s*/, "") // Remove ISO timestamps
      .replace(GenericParser.SEVERITY_REGEX, "")  // Remove severity word
      .replace(/^\s*[:\-]\s*/, "")  // Remove leading separators
      .trim() || line.trim();
  }

  private extractTemplate(message: string): string {
    return message
      .replace(/\/[\w\/\.\-]+/g, "<PATH>")
      .replace(/\b\d+\b/g, "<NUM>")
      .replace(/\b[0-9a-f]{8,}\b/gi, "<HEX>")
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "<IP>")
      .replace(/\s+/g, " ")
      .trim();
  }
}

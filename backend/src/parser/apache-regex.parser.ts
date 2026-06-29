import { injectable } from "tsyringe";
import { ILogParser } from "./ILogParser";
import { ParsedLog } from "../types/models";

/**
 * Apache Error Log Parser
 * 
 * Parses Apache error log format:
 *   [Day Mon DD HH:MM:SS YYYY] [severity] message
 * 
 * Example:
 *   [Sun Dec 04 04:47:44 2005] [notice] workerEnv.init() ok /etc/httpd/conf/workers2.properties
 *   [Sun Dec 04 04:47:44 2005] [error] mod_jk child workerEnv in error state 6
 * 
 * This is a plugin behind the ILogParser interface.
 * To add NGINX/Syslog support, create a new parser implementing ILogParser
 * and register it in ParserRegistry — no business logic changes needed.
 */
@injectable()
export class ApacheRegexParser implements ILogParser {
  readonly formatName = "apache";

  // Matches: [timestamp] [severity] message
  private static readonly LOG_REGEX =
    /^\[(\w{3} \w{3} \d{2} \d{2}:\d{2}:\d{2} \d{4})\] \[(\w+)\] (.+)$/;

  // Common Apache component keywords for template extraction
  private static readonly COMPONENT_PATTERNS: Record<string, RegExp> = {
    "mod_jk":      /mod_jk/i,
    "workerEnv":   /workerEnv/i,
    "jk2_init":    /jk2_init/i,
    "proxy":       /proxy/i,
    "ssl":         /ssl/i,
    "core":        /core/i,
    "mpm_prefork": /mpm_prefork|prefork/i,
    "httpd":       /httpd|apache/i,
  };

  /**
   * Auto-detection: tests sample lines against the Apache error log regex.
   * Returns confidence 0-1 based on how many lines match.
   */
  detect(sampleLines: string[]): number {
    if (sampleLines.length === 0) return 0;
    const matches = sampleLines.filter((line) =>
      ApacheRegexParser.LOG_REGEX.test(line.trim())
    ).length;
    return matches / sampleLines.length;
  }

  parseLine(line: string): ParsedLog | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const match = ApacheRegexParser.LOG_REGEX.exec(trimmed);
    if (!match) return null;

    const [, timestampStr, severity, message] = match;

    const timestamp = this.parseTimestamp(timestampStr);
    if (!timestamp) return null;

    const component = this.extractComponent(message);
    const template = this.extractTemplate(message);

    return {
      raw: trimmed,
      timestamp,
      severity: severity.toLowerCase(),
      component,
      message,
      template,
    };
  }

  /**
   * Parses Apache timestamp format: "Sun Dec 04 04:47:44 2005"
   */
  private parseTimestamp(str: string): Date | null {
    try {
      const date = new Date(str);
      if (isNaN(date.getTime())) return null;
      return date;
    } catch {
      return null;
    }
  }

  /**
   * Extracts the component (module/subsystem) from the message.
   * Falls back to "general" if no known component is found.
   */
  private extractComponent(message: string): string {
    for (const [component, regex] of Object.entries(ApacheRegexParser.COMPONENT_PATTERNS)) {
      if (regex.test(message)) return component;
    }
    return "general";
  }

  /**
   * Extracts a template by replacing variable parts (numbers, paths, PIDs)
   * with placeholders. This allows grouping similar log messages.
   * 
   * Example:
   *   "mod_jk child workerEnv in error state 6"
   *   → "mod_jk child workerEnv in error state <NUM>"
   */
  private extractTemplate(message: string): string {
    return message
      .replace(/\/[\w\/\.\-]+/g, "<PATH>")
      .replace(/\b\d+\b/g, "<NUM>")
      .replace(/\s+/g, " ")
      .trim();
  }
}

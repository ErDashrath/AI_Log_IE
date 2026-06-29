import { ParsedLog } from "../types/models";

/**
 * Timeline Prompt Template — v1
 * 
 * Strategy: Chain-of-thought with explicit grouping instructions.
 * Temperature: 0.2 (summarization flexibility, but must stay factual).
 * 
 * The prompt instructs the LLM to:
 *   1. Group related logs (not just list them)
 *   2. Identify transition events (state changes)
 *   3. Write human-readable summaries (not raw log reproduction)
 *   4. Output chronologically
 */
export const timelinePrompt = (logs: ParsedLog[]): string => `
You are an incident timeline analyst for a Security Information and Event Management (SIEM) platform.

Your task: Generate a concise incident timeline from the following server log entries.

INSTRUCTIONS:
1. Group related log entries into meaningful events (do NOT create one event per log line).
2. Identify important transition points: server starts, failures, recoveries, state changes.
3. Write human-readable summaries — do NOT reproduce raw log text.
4. Each event should reference the original log line numbers for traceability.
5. Order events chronologically by timestamp.
6. Focus on operational significance — what would a system administrator need to know?

RESPONSE JSON SCHEMA:
{
  "events": [
    {
      "timestamp": "ISO 8601 timestamp string",
      "title": "Short event title (3-8 words)",
      "summary": "What happened and why it matters (1-2 sentences)",
      "logReferences": [line numbers as integers]
    }
  ]
}

LOG ENTRIES (with line numbers):
${logs.map((log, i) => `[Line ${i}] [${log.timestamp.toISOString()}] [${log.severity}] ${log.message}`).join("\n")}

Generate the timeline. Respond ONLY with valid JSON.
`;

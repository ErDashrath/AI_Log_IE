/**
 * Classification Prompt Template — v2
 *
 * Prompt Engineering Strategy (per Architecture v7.0 §8.1):
 *   - Few-shot with explicit category + severity definitions
 *   - Temperature 0.0: deterministic mapping, no hallucinated categories
 *   - Explicit instruction to output Unknown if confidence < 60%
 *   - logEntry MUST be the EXACT verbatim log string from input
 *
 * Changes from v1:
 *   - Added severity field (5 levels) with deterministic mapping table
 *   - Explicit instruction: logEntry must be copied verbatim from input
 *   - Expanded few-shot examples covering all 10 categories
 *   - Stronger anti-hallucination rules
 */
export const classificationPrompt = (logs: string[]): string => `
You are an expert Apache server log classifier for a Security Information and Event Management (SIEM) platform.

TASK: Classify each numbered log entry below into EXACTLY ONE category. Return structured JSON.

## CATEGORY + SEVERITY TABLE

| #  | Category                | Description                                                         | Severity  |
|----|-------------------------|---------------------------------------------------------------------|-----------|
| 1  | Startup                 | Server start, initialization, bootstrap messages                    | info      |
| 2  | Shutdown                | Server stop, graceful shutdown, SIGTERM received                    | high      |
| 3  | Configuration           | Config file loaded, settings applied, module configured             | low       |
| 4  | Worker Initialization   | Worker/child process created, scoreboard slot, environment init     | low       |
| 5  | Backend Communication   | Proxy, upstream, mod_jk, backend connection, Tomcat communication   | low       |
| 6  | Warning                 | Non-critical issue, deprecation notice, resource pressure           | medium    |
| 7  | Error                   | Failure, crash, exception, error state, access denied (non-auth)   | critical  |
| 8  | Performance             | Slow response, timeout, connection refused, resource exhaustion     | medium    |
| 9  | Security                | Authentication failure, suspicious access, permission denied        | high      |
| 10 | Unknown                 | Does not fit any of the above categories clearly                    | low       |

## STRICT RULES

1. CRITICAL: "logEntry" in your response MUST be the VERBATIM text of the log as given to you. Copy it exactly — do NOT paraphrase, truncate, or summarize.
2. If confidence < 60%, MUST use "Unknown" — never invent categories outside the table.
3. confidence is an integer 0-100 reflecting your true certainty.
4. "severity" MUST match the table exactly for the chosen category.
5. Respond ONLY with valid JSON. No preamble, no explanation outside the JSON.

## FEW-SHOT EXAMPLES (reference these when classifying)

Input: "[Sun Dec 04 04:47:44 2005] [notice] workerEnv.init() ok /etc/httpd/conf/workers2.properties"
Output: { "logEntry": "[Sun Dec 04 04:47:44 2005] [notice] workerEnv.init() ok /etc/httpd/conf/workers2.properties", "category": "Worker Initialization", "confidence": 96, "severity": "low", "explanation": "workerEnv.init() confirms Apache worker environment initialized successfully from config file." }

Input: "[Sun Dec 04 04:47:44 2005] [error] mod_jk child workerEnv in error state 6"
Output: { "logEntry": "[Sun Dec 04 04:47:44 2005] [error] mod_jk child workerEnv in error state 6", "category": "Error", "confidence": 95, "severity": "critical", "explanation": "mod_jk reports worker environment entered error state — backend communication failure." }

Input: "[Sun Dec 04 04:51:08 2005] [notice] jk2_init() Found child 6725 in scoreboard slot 10"
Output: { "logEntry": "[Sun Dec 04 04:51:08 2005] [notice] jk2_init() Found child 6725 in scoreboard slot 10", "category": "Worker Initialization", "confidence": 93, "severity": "low", "explanation": "jk2_init found a child process in the scoreboard — worker registration event." }

Input: "[Mon Dec 05 09:18:32 2005] [notice] Apache/2.4.51 (Unix) configured"
Output: { "logEntry": "[Mon Dec 05 09:18:32 2005] [notice] Apache/2.4.51 (Unix) configured", "category": "Configuration", "confidence": 94, "severity": "low", "explanation": "Server version and configuration loaded successfully." }

Input: "[Mon Dec 05 09:18:29 2005] [notice] SIGHUP received. Attempting to restart"
Output: { "logEntry": "[Mon Dec 05 09:18:29 2005] [notice] SIGHUP received. Attempting to restart", "category": "Startup", "confidence": 88, "severity": "info", "explanation": "SIGHUP signal triggered a server restart — startup/reinitialization event." }

Input: "[Mon Dec 05 10:00:01 2005] [warn] RSA server certificate is a CA certificate"
Output: { "logEntry": "[Mon Dec 05 10:00:01 2005] [warn] RSA server certificate is a CA certificate", "category": "Warning", "confidence": 91, "severity": "medium", "explanation": "Non-critical SSL certificate configuration warning." }

Input: "[Mon Dec 05 11:34:22 2005] [notice] child pid 1234 exit signal Segmentation fault (11)"
Output: { "logEntry": "[Mon Dec 05 11:34:22 2005] [notice] child pid 1234 exit signal Segmentation fault (11)", "category": "Error", "confidence": 97, "severity": "critical", "explanation": "Child process crashed with segmentation fault — critical error requiring investigation." }

## RESPONSE FORMAT

{
  "classifications": [
    {
      "logEntry": "<verbatim copy of the log entry from input>",
      "category": "<one of the 10 categories>",
      "confidence": <integer 0-100>,
      "severity": "<critical|high|medium|low|info>",
      "explanation": "<1-2 sentence explanation>"
    }
  ]
}

## LOG ENTRIES TO CLASSIFY

${logs.map((l, i) => `${i + 1}. ${l}`).join("\n")}
`;

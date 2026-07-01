import { ParsedLog } from "../types/models";

/**
 * Root Cause Analysis Prompt Template — v1
 * 
 * Strategy: Evidence-first reasoning.
 * Temperature: 0.3 (inductive reasoning — forming hypotheses from evidence).
 * 
 * The prompt forces the LLM to:
 *   1. Examine each piece of evidence individually
 *   2. Explain why it supports or refutes a hypothesis
 *   3. State the conclusion only after presenting evidence
 *   4. Provide actionable recommendations
 */
export const rcaPrompt = (logs: ParsedLog[], hypothesis?: string): string => `
You are a senior site reliability engineer performing root cause analysis on server logs for a SIEM platform.

Your task: Analyze the following log evidence and determine the most probable root cause of the incident.

${hypothesis ? `WORKING HYPOTHESIS: ${hypothesis}\nEvaluate this hypothesis against the evidence below.\n` : ""}

METHODOLOGY:
1. Examine each log entry as a piece of evidence.
2. For each piece of evidence, explain what it tells us about the system state.
3. Identify patterns: repeated failures, cascading errors, timing correlations.
4. Determine the most probable root cause based on the cumulative evidence.
5. Assess the impact on end users and dependent systems.
6. Provide specific, actionable recommendations.

RESPONSE JSON SCHEMA:
{
  "rootCause": "Clear, specific statement of the root cause",
  "evidence": [
    {
      "logEntry": "relevant log entry text",
      "relevance": "why this log entry supports the root cause conclusion"
    }
  ], // NOTE: Include a MAXIMUM of 3 evidence entries to keep the response concise.
  "impact": "Description of user/system impact",
  "recommendation": "Numbered list of specific actions to resolve and prevent recurrence",
  "confidence": number (0-100, how confident are you in this root cause)
}

EVIDENCE (log entries):
${logs.map((log, i) => `[${i + 1}] [${log.timestamp.toISOString()}] [${log.severity}] [${log.component}] ${log.message}`).join("\n")}

Analyze the evidence and determine the root cause. Respond ONLY with valid JSON.
`;

/**
 * RCA Validation Prompt — Used by LangGraph validation node
 * 
 * Takes the hypothesis and remaining evidence to check if the
 * hypothesis holds up under additional scrutiny.
 */
export const rcaValidationPrompt = (
  hypothesis: string,
  confidence: number,
  additionalEvidence: ParsedLog[]
): string => `
You are validating a root cause hypothesis.

HYPOTHESIS: ${hypothesis}
CURRENT CONFIDENCE: ${confidence}%

ADDITIONAL EVIDENCE:
${additionalEvidence.map((log, i) => `[${i + 1}] [${log.severity}] ${log.message}`).join("\n")}

Does the additional evidence support, weaken, or contradict the hypothesis?
If it changes the conclusion, provide the updated root cause.

RESPONSE JSON SCHEMA:
{
  "rootCause": "Updated or confirmed root cause",
  "evidence": [{ "logEntry": "string", "relevance": "string" }],
  "impact": "Updated impact assessment",
  "recommendation": "Updated recommendations",
  "confidence": number (0-100, updated confidence)
}

Respond ONLY with valid JSON.
`;

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { getResilientLLM, invokeWithTimeout } from "../llm-provider";
import { AI_CONFIG } from "../../config/ai.config";
import { rcaPrompt, rcaValidationPrompt } from "../../prompts/v1_rca.prompt";
import { RCAResponse, RCAResponseSchema } from "../../schemas/rca.schema";
import { FALLBACK_RCA } from "../fallbacks";
import { ParsedLog } from "../../types/models";
import pino from "pino";

const logger = pino({ name: "rca-graph" });

/**
 * Extracts a plain string from a LangChain AIMessage content.
 * `response.content` can be a string OR an array of content blocks
 * (e.g., [{type: "text", text: "..."}, ...]) depending on the model
 * and SDK version. This normalizes both cases.
 */
function extractContent(content: string | any[]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) =>
        typeof block === "string" ? block : block.text ?? JSON.stringify(block)
      )
      .join("");
  }
  return String(content);
}

/**
 * Attempts to repair truncated JSON arrays/objects.
 * Groq free tier often cuts off mid-generation when TPM limit is reached.
 */
function repairJSON(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    logger.warn({ msg: "JSON parse failed, attempting repair", snippet: jsonStr.slice(-50) });
    // Try to close hanging evidence arrays and the main object
    const repaired = jsonStr.replace(/,\s*$/, "") + '], "impact": "Partial analysis due to token limit", "recommendation": "Review logs manually.", "confidence": 50 }';
    try {
      return JSON.parse(repaired);
    } catch (e2) {
      // Ultimate fallback regex to extract just the rootCause
      const rcMatch = jsonStr.match(/"rootCause"\s*:\s*"([^"]+)"/);
      if (rcMatch) {
        return {
          rootCause: rcMatch[1],
          evidence: [],
          impact: "Unknown",
          recommendation: "Review manually",
          confidence: 50,
        };
      }
      throw e; // Give up
    }
  }
}

// 1. Define the State
export const RCAStateAnnotation = Annotation.Root({
  context: Annotation<ParsedLog[]>({
    reducer: (x, y) => y,
    default: () => [],
  }),
  allLogs: Annotation<readonly ParsedLog[]>({
    reducer: (x, y) => y,
    default: () => [],
  }),
  hypothesis: Annotation<string | null>({
    reducer: (x, y) => y,
    default: () => null,
  }),
  confidence: Annotation<number>({
    reducer: (x, y) => y,
    default: () => 0,
  }),
  iterations: Annotation<number>({
    reducer: (x, y) => x + y, // increment
    default: () => 0,
  }),
  result: Annotation<RCAResponse | null>({
    reducer: (x, y) => y,
    default: () => null,
  }),
});

export type RCAState = typeof RCAStateAnnotation.State;

// 2. Define Nodes

/**
 * Node 1 — gather_evidence
 *
 * Per Architecture v7.0 §7.4: the evidence-gathering node.
 * Validates the context logs, deduplicates by template, and selects
 * the most relevant evidence before passing to form_hypothesis.
 * No LLM call — deterministic evidence curation.
 */
async function gatherEvidenceNode(
  state: RCAState
): Promise<Partial<RCAState>> {
  logger.info({
    msg: "gather_evidence: curating evidence context",
    rawContextSize: state.context.length,
    allLogsSize: state.allLogs.length,
  });

  if (state.context.length === 0) {
    logger.warn("gather_evidence: no context logs available");
    return { result: FALLBACK_RCA, iterations: 2, confidence: 100 }; // force exit
  }

  // Deduplicate by template — allow max 2 logs per unique template
  const seenTemplates = new Map<string, number>();
  const dedupedContext: ParsedLog[] = [];

  for (const log of state.context) {
    const key = log.template ?? log.message;
    const count = seenTemplates.get(key) ?? 0;
    if (count < 2) {
      dedupedContext.push(log);
      seenTemplates.set(key, count + 1);
    }
  }

  // Sort chronologically
  dedupedContext.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  logger.info({
    msg: "gather_evidence: evidence curated",
    dedupedSize: dedupedContext.length,
    originalSize: state.context.length,
    templatesFound: seenTemplates.size,
    severityBreakdown: {
      errors:   dedupedContext.filter(l => l.severity === "error" || l.severity === "crit").length,
      warnings: dedupedContext.filter(l => l.severity === "warn").length,
      other:    dedupedContext.filter(l => !["error","crit","warn"].includes(l.severity)).length,
    },
  });

  // Update context with the curated set — form_hypothesis reads this
  return { context: dedupedContext };
}

/**
 * Node 2 — form_hypothesis
 *
 * Per Architecture v7.0 §7.4: the hypothesis-formation node.
 * Calls Gemini with temperature 0.3 to form a root-cause hypothesis
 * from the curated evidence context.
 */
async function formHypothesisNode(state: RCAState): Promise<Partial<RCAState>> {
  logger.info({ msg: "Forming RCA hypothesis", iteration: state.iterations });
  
  const prompt = rcaPrompt(state.context, state.hypothesis || undefined);
  const llm = getResilientLLM(
    AI_CONFIG.temperatures.rca,
    AI_CONFIG.completionBudget
  );

  try {
    const response = await invokeWithTimeout(llm, prompt, "rca-hypothesis");

    // Normalize content — handles string or array of content blocks
    let rawText = extractContent(response.content);

    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) rawText = jsonMatch[1].trim();
    const braceMatch = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) rawText = braceMatch[1];

    const parsed = repairJSON(rawText);
    const validated = RCAResponseSchema.parse(parsed);

    return {
      hypothesis: validated.rootCause,
      confidence: validated.confidence,
      result: validated,
      iterations: 1, // Add 1
    };
  } catch (error) {
    logger.error({
      msg: "Form Hypothesis failed, using fallback",
      error: error instanceof Error ? error.message : String(error),
      rawTextSnippet: "See previous logs for full text",
    });
    return { result: FALLBACK_RCA, iterations: 1, confidence: 100 }; // force exit
  }
}

/**
 * Node 3 — validate_hypothesis
 *
 * Per Architecture v7.0 §7.4: the validation node.
 * Checks the hypothesis against remaining (unused) evidence logs.
 * If additional evidence contradicts the hypothesis, refines it.
 */
async function validateHypothesisNode(state: RCAState): Promise<Partial<RCAState>> {
  logger.info({ msg: "Validating RCA hypothesis", iteration: state.iterations, confidence: state.confidence });
  
  if (!state.hypothesis) return { iterations: 1 };

  const contextSet = new Set(state.context.map((l) => l.raw));
  const additionalEvidence = (state.allLogs as ParsedLog[])
    .filter(
      (l) =>
        !contextSet.has(l.raw) &&
        (l.severity === "error" || l.severity === "warn" || l.severity === "crit")
    )
    .slice(0, 10);

  if (additionalEvidence.length === 0) {
    // No additional evidence — hypothesis stands
    return { iterations: 1, confidence: 100 }; // force exit
  }

  const prompt = rcaValidationPrompt(
    state.hypothesis,
    state.confidence,
    additionalEvidence
  );

  const llm = getResilientLLM(
    AI_CONFIG.temperatures.rca,
    AI_CONFIG.completionBudget
  );

  try {
    const response = await invokeWithTimeout(llm, prompt, "rca-validation");

    // Normalize content — handles string or array of content blocks
    let rawText = extractContent(response.content);

    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) rawText = jsonMatch[1].trim();
    const braceMatch = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) rawText = braceMatch[1];

    const parsed = repairJSON(rawText);
    const validated = RCAResponseSchema.parse(parsed);

    return {
      hypothesis: validated.rootCause,
      confidence: validated.confidence,
      result: validated,
      iterations: 1, // Add 1
    };
  } catch (error) {
    logger.error({
      msg: "Validate Hypothesis failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return { iterations: 1, confidence: 100 }; // force exit
  }
}

// 3. Define Conditional Edges
function shouldContinue(state: RCAState): string {
  // Loop control: Stops if confidence > 80% OR iterations >= 2
  if (state.confidence > 80 || state.iterations >= 2) {
    return END;
  }
  return "validate_hypothesis";
}

// 4. Build Graph — 3-node topology per Architecture v7.0 §7.4:
//    gather_evidence → form_hypothesis → [conditional] → validate_hypothesis → [conditional] → END
const workflow = new StateGraph(RCAStateAnnotation)
  .addNode("gather_evidence", gatherEvidenceNode)
  .addNode("form_hypothesis", formHypothesisNode)
  .addNode("validate_hypothesis", validateHypothesisNode)
  
  .addEdge(START, "gather_evidence")
  .addEdge("gather_evidence", "form_hypothesis")
  .addConditionalEdges("form_hypothesis", shouldContinue)
  .addConditionalEdges("validate_hypothesis", shouldContinue);

export const RCAGraphWorkflow = workflow.compile();

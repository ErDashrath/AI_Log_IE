import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { getResilientLLM, invokeWithTimeout } from "../llm-provider";
import { AI_CONFIG } from "../../config/ai.config";
import { rcaPrompt, rcaValidationPrompt } from "../../prompts/v1_rca.prompt";
import { RCAResponse, RCAResponseSchema } from "../../schemas/rca.schema";
import { FALLBACK_RCA } from "../fallbacks";
import { ParsedLog } from "../../types/models";
import pino from "pino";

const logger = pino({ name: "rca-graph" });

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
async function formHypothesisNode(state: RCAState): Promise<Partial<RCAState>> {
  logger.info({ msg: "Forming RCA hypothesis", iteration: state.iterations });
  
  const prompt = rcaPrompt(state.context, state.hypothesis || undefined);
  const llm = getResilientLLM(
    AI_CONFIG.temperatures.rca,
    AI_CONFIG.completionBudget
  );

  try {
    const response = await invokeWithTimeout(llm, prompt, "rca-hypothesis");

    let rawText = response.content as string;

    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) rawText = jsonMatch[1].trim();
    const braceMatch = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) rawText = braceMatch[1];

    const parsed = JSON.parse(rawText);
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
    });
    return { result: FALLBACK_RCA, iterations: 1, confidence: 100 }; // force exit
  }
}

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

    let rawText = response.content as string;

    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) rawText = jsonMatch[1].trim();
    const braceMatch = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) rawText = braceMatch[1];

    const parsed = JSON.parse(rawText);
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

// 4. Build Graph
const workflow = new StateGraph(RCAStateAnnotation)
  .addNode("form_hypothesis", formHypothesisNode)
  .addNode("validate_hypothesis", validateHypothesisNode)
  
  .addEdge(START, "form_hypothesis")
  .addConditionalEdges("form_hypothesis", shouldContinue)
  .addConditionalEdges("validate_hypothesis", shouldContinue);

export const RCAGraphWorkflow = workflow.compile();

import { ParsedLog } from "../types/models";
import { RCAResponse } from "../schemas/rca.schema";
import { rcaPrompt, rcaValidationPrompt } from "../prompts/v1_rca.prompt";
import { RCAResponseSchema } from "../schemas/rca.schema";
import { IAIService } from "./IAIService";
import pino from "pino";

const logger = pino({ name: "rca-graph" });

/**
 * RCA Graph — Multi-Step Reasoning Workflow
 * 
 * Implements a simplified LangGraph-style 3-node reasoning workflow:
 *   1. gather_evidence  → Build initial evidence context
 *   2. form_hypothesis  → Generate root cause hypothesis via Gemini
 *   3. validate_hypothesis → Check hypothesis against additional evidence
 * 
 * Loop control:
 *   - Stops if confidence > 80% OR iterations >= 2
 *   - Prevents infinite loops while allowing hypothesis refinement
 * 
 * Note: This is a manual implementation of the LangGraph pattern
 * to avoid complex dependency issues. The logic is identical to
 * what a StateGraph would produce.
 */

interface RCAState {
  context: ParsedLog[];
  allLogs: readonly ParsedLog[];
  hypothesis: string | null;
  confidence: number;
  iterations: number;
  result: RCAResponse | null;
}

export class RCAGraph {
  constructor(private aiService: IAIService) {}

  /**
   * Executes the full RCA reasoning workflow.
   */
  async execute(
    evidenceLogs: ParsedLog[],
    allLogs: readonly ParsedLog[]
  ): Promise<RCAResponse> {
    let state: RCAState = {
      context: evidenceLogs,
      allLogs,
      hypothesis: null,
      confidence: 0,
      iterations: 0,
      result: null,
    };

    logger.info({
      msg: "RCA graph started",
      evidenceCount: evidenceLogs.length,
    });

    // Node 1: Form initial hypothesis
    state = await this.formHypothesis(state);
    state.iterations++;

    // Node 2: Validate and potentially refine
    while (state.confidence <= 80 && state.iterations < 2) {
      logger.info({
        msg: "RCA validation loop",
        iteration: state.iterations,
        currentConfidence: state.confidence,
      });

      state = await this.validateHypothesis(state);
      state.iterations++;
    }

    logger.info({
      msg: "RCA graph complete",
      finalConfidence: state.confidence,
      iterations: state.iterations,
    });

    return (
      state.result || {
        rootCause: "Analysis could not determine root cause",
        evidence: [],
        impact: "Unknown",
        recommendation: "Manual investigation recommended.",
        confidence: 0,
      }
    );
  }

  /**
   * Node: Form Hypothesis
   * Sends evidence to Gemini and gets initial root cause hypothesis.
   */
  private async formHypothesis(state: RCAState): Promise<RCAState> {
    const prompt = rcaPrompt(state.context, state.hypothesis || undefined);

    const result = await this.aiService.callModel<RCAResponse>(
      prompt,
      RCAResponseSchema,
      "rca"
    );

    return {
      ...state,
      hypothesis: result.rootCause,
      confidence: result.confidence,
      result,
    };
  }

  /**
   * Node: Validate Hypothesis
   * Checks the hypothesis against additional evidence that wasn't
   * in the initial context (neighboring logs around the error cluster).
   */
  private async validateHypothesis(state: RCAState): Promise<RCAState> {
    if (!state.hypothesis) return state;

    // Get additional evidence not already in context
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
      return state;
    }

    const prompt = rcaValidationPrompt(
      state.hypothesis,
      state.confidence,
      additionalEvidence
    );

    const result = await this.aiService.callModel<RCAResponse>(
      prompt,
      RCAResponseSchema,
      "rca"
    );

    return {
      ...state,
      hypothesis: result.rootCause,
      confidence: result.confidence,
      result,
    };
  }
}

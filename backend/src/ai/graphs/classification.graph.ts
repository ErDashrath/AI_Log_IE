import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { getResilientLLM, invokeWithTimeout } from "../llm-provider";
import { AI_CONFIG } from "../../config/ai.config";
import { classificationPrompt } from "../../prompts/v1_classification.prompt";
import {
  ClassificationResponse,
  ClassificationResponseSchema,
} from "../../schemas/classification.schema";
import { FALLBACK_CLASSIFICATION } from "../fallbacks";
import pino from "pino";

const logger = pino({ name: "classification-graph" });

/**
 * Deterministic severity from category — used as a post-processing
 * override to guarantee consistency even if LLM drifts.
 */
const CATEGORY_SEVERITY_MAP: Record<
  string,
  "critical" | "high" | "medium" | "low" | "info"
> = {
  error:                 "critical",
  security:              "high",
  shutdown:              "high",
  performance:           "medium",
  warning:               "medium",
  "backend communication": "low",
  configuration:         "low",
  "worker initialization": "low",
  startup:               "info",
  unknown:               "low",
};

function getSeverity(category: string): "critical" | "high" | "medium" | "low" | "info" {
  return CATEGORY_SEVERITY_MAP[category.toLowerCase()] ?? "low";
}

function buildCategorySummary(
  classifications: { category: string }[]
): Record<string, number> {
  return classifications.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Extract JSON from LLM response — handles markdown fences, raw JSON,
 * and objects wrapped in surrounding text.
 */
function extractJSON(raw: string): string {
  // Remove markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find the outermost JSON object
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) return raw.slice(start, end + 1);

  return raw.trim();
}

// ── State ─────────────────────────────────────────────────────────────────
export const ClassificationStateAnnotation = Annotation.Root({
  rawLogs: Annotation<string[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),
  mode: Annotation<"manual" | "auto">({
    reducer: (_x, y) => y,
    default: () => "auto",
  }),
  result: Annotation<ClassificationResponse | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
});

export type ClassificationState = typeof ClassificationStateAnnotation.State;

// ── Node ──────────────────────────────────────────────────────────────────
async function classifyNode(
  state: ClassificationState
): Promise<Partial<ClassificationState>> {
  if (state.rawLogs.length === 0) {
    return {
      result: {
        classifications: [],
        totalClassified: 0,
        categorySummary: {},
        mode: state.mode,
      },
    };
  }

  // Validate: ensure all rawLogs are actual strings (defensive guard)
  const validLogs = state.rawLogs.filter(
    (l) => typeof l === "string" && l.trim().length > 0
  );

  if (validLogs.length === 0) {
    logger.error({
      msg: "classifyNode: rawLogs contained no valid strings",
      sample: String(state.rawLogs[0]),
    });
    return {
      result: {
        ...FALLBACK_CLASSIFICATION,
        mode: state.mode,
        fallbackReason: "Received non-string log data. Check parser output.",
      },
    };
  }

  logger.info({
    msg: "classifyNode: invoking LLM",
    logCount: validLogs.length,
    firstLog: validLogs[0].slice(0, 120),
  });

  const prompt = classificationPrompt(validLogs);
  const llm = getResilientLLM(
    AI_CONFIG.temperatures.classification,
    AI_CONFIG.completionBudget
  );

  try {
    const response = await invokeWithTimeout(llm, prompt, "classification");
    const rawText = (response.content as string) ?? "";

    logger.debug({
      msg: "classifyNode: LLM raw response",
      responseLength: rawText.length,
      preview: rawText.slice(0, 200),
    });

    const jsonStr = extractJSON(rawText);
    const parsed = JSON.parse(jsonStr);
    const validated = ClassificationResponseSchema.parse(parsed);

    // Post-process: enforce deterministic severity override
    const enriched = validated.classifications.map((entry) => ({
      ...entry,
      severity: getSeverity(entry.category),
    }));

    const categorySummary = buildCategorySummary(enriched);

    logger.info({
      msg: "classifyNode: classification complete",
      classified: enriched.length,
      categorySummary,
    });

    return {
      result: {
        classifications: enriched,
        totalClassified: enriched.length,
        categorySummary,
        mode: state.mode,
        fallback: false,
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ msg: "classifyNode: LLM or parse error", error: msg });

    return {
      result: {
        ...FALLBACK_CLASSIFICATION,
        mode: state.mode,
        fallbackReason: `Classification failed: ${msg}`,
      },
    };
  }
}

// ── Graph ─────────────────────────────────────────────────────────────────
const workflow = new StateGraph(ClassificationStateAnnotation)
  .addNode("classify", classifyNode)
  .addEdge(START, "classify")
  .addEdge("classify", END);

export const ClassificationGraph = workflow.compile();

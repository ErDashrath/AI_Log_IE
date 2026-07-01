import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { getResilientLLM, invokeWithTimeout } from "../llm-provider";
import { AI_CONFIG } from "../../config/ai.config";
import { timelinePrompt } from "../../prompts/v1_timeline.prompt";
import { TimelineResponse, TimelineResponseSchema } from "../../schemas/timeline.schema";
import { FALLBACK_TIMELINE } from "../fallbacks";
import { ParsedLog } from "../../types/models";
import pino from "pino";

const logger = pino({ name: "timeline-graph" });

/**
 * Extracts a plain string from a LangChain AIMessage content.
 * Handles both string and array-of-content-blocks formats.
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
    // Try to close hanging event arrays and the main object
    const repaired = jsonStr.replace(/,\s*$/, "") + ']}';
    try {
      return JSON.parse(repaired);
    } catch (e2) {
      // Ultimate fallback: empty events array to satisfy schema
      return { events: [] };
    }
  }
}

// 1. Define the State
export const TimelineStateAnnotation = Annotation.Root({
  contextLogs: Annotation<ParsedLog[]>({
    reducer: (x, y) => y,
    default: () => [],
  }),
  result: Annotation<TimelineResponse | null>({
    reducer: (x, y) => y,
    default: () => null,
  }),
});

export type TimelineState = typeof TimelineStateAnnotation.State;

// 2. Define Nodes
async function generateTimelineNode(state: TimelineState): Promise<Partial<TimelineState>> {
  if (state.contextLogs.length === 0) {
    return { result: { events: [] } };
  }

  const prompt = timelinePrompt(state.contextLogs);
  const llm = getResilientLLM(
    AI_CONFIG.temperatures.timeline,
    AI_CONFIG.completionBudget
  );

  try {
  const response = await invokeWithTimeout(llm, prompt, "timeline");

    // Normalize content — handles string or array of content blocks
    let rawText = extractContent(response.content);

    // Extract JSON
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) rawText = jsonMatch[1].trim();
    const braceMatch = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) rawText = braceMatch[1];

    const parsed = repairJSON(rawText);
    const validated = TimelineResponseSchema.parse(parsed);

    return { result: validated };
  } catch (error) {
    logger.error({
      msg: "Timeline graph failed, using fallback",
      error: error instanceof Error ? error.message : String(error),
    });
    return { result: FALLBACK_TIMELINE };
  }
}

// 3. Build Graph
const workflow = new StateGraph(TimelineStateAnnotation)
  .addNode("generate_timeline", generateTimelineNode)
  .addEdge(START, "generate_timeline")
  .addEdge("generate_timeline", END);

export const TimelineGraph = workflow.compile();

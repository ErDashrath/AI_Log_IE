import { injectable } from "tsyringe";
import { ZodSchema } from "zod";
import { GoogleGenAI } from "@google/genai";
import {
  retry,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  wrap,
} from "cockatiel";
import { IAIService } from "./IAIService";
import { ApiEndpoint } from "../retrieval/IRetrievalFactory";
import { AI_CONFIG } from "../config/ai.config";
import { TelemetryService } from "../telemetry/telemetry.service";
import {
  FALLBACK_CLASSIFICATION,
  FALLBACK_TIMELINE,
  FALLBACK_RCA,
} from "./fallbacks";
import { config } from "dotenv";
config();
import pino from "pino";

const logger = pino({ name: "gemini-ai-service" });

/**
 * GeminiAIService — Production Circuit Breaker + Gemini 1.5 Flash
 * 
 * Wraps every Gemini call in a cockatiel resilience pipeline:
 *   Retry (3 attempts, exponential backoff + jitter)
 *     └─ Circuit Breaker (CLOSED → OPEN after 5 failures, HALF_OPEN after 30s)
 * 
 * On exhaustion, returns a Typed Fallback Object — never null.
 * All responses are Zod-validated before reaching the controller.
 */
@injectable()
export class GeminiAIService implements IAIService {
  private genai: GoogleGenAI;
  private telemetry = new TelemetryService();

  // Cockatiel retry policy: 3 attempts with exponential backoff + jitter
  private retryPolicy = retry(handleAll, {
    maxAttempts: 3,
    backoff: new ExponentialBackoff({
      initialDelay: 1000,
      maxDelay: 15000,
    }),
  });

  // Circuit breaker: opens after 5 consecutive failures, probes after 30s
  private breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: 30_000,
    breaker: new ConsecutiveBreaker(5),
  });

  // Retry wraps the circuit breaker
  private resilientCall = wrap(this.retryPolicy, this.breakerPolicy);

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.error("GEMINI_API_KEY not set. AI features will use fallback responses.");
    }
    this.genai = new GoogleGenAI({ apiKey: apiKey || "" });
  }

  /**
   * Calls Gemini with resilience (retry + circuit breaker).
   * Returns Zod-validated response or Typed Fallback Object.
   */
  async callModel<T>(
    prompt: string,
    schema: ZodSchema<T>,
    endpoint: ApiEndpoint
  ): Promise<T> {
    const startTime = Date.now();
    let retryCount = 0;

    try {
      const result = await this.resilientCall.execute(async (context) => {
        retryCount = context.attempt;

        // Standard Gemini Implementation
        const response = await this.genai.models.generateContent({
          model: AI_CONFIG.model,
          contents: prompt,
          config: {
            temperature: AI_CONFIG.temperatures[endpoint],
            maxOutputTokens: AI_CONFIG.completionBudget,
            responseMimeType: "application/json",
          },
        });

        const rawText = response.text || "";
        
        // Extract JSON from response (handle markdown code blocks)
        const jsonStr = this.extractJSON(rawText);
        const parsed = JSON.parse(jsonStr);

        // Zod validates the response
        const validated = schema.parse(parsed);

        // Record successful call
        const latency = Date.now() - startTime;
        this.telemetry.recordAICall(
          endpoint,
          latency,
          prompt.length, // approximate prompt tokens
          rawText.length, // approximate completion tokens
          retryCount
        );

        return validated;
      });

      return result;
    } catch (err: any) {
      this.telemetry.recordFallback(err, endpoint);
      logger.warn({
        msg: "Gemini AI call failed — attempting Groq fallback",
        endpoint,
        error: err instanceof Error ? err.message : String(err),
      });

      try {
        const { GroqAIService } = await import("./groq-ai.service");
        const groqService = new GroqAIService();
        return await groqService.callModel(prompt, schema, endpoint);
      } catch (groqErr: any) {
        logger.error({
          msg: "Groq fallback also failed — returning static fallback JSON",
          endpoint,
          error: groqErr instanceof Error ? groqErr.message : String(groqErr),
        });
        return this.getFallback<T>(endpoint, schema);
      }
    }
  }

  /**
   * Returns the appropriate typed fallback for the endpoint.
   */
  private getFallback<T>(endpoint: ApiEndpoint, schema: ZodSchema<T>): T {
    const fallbacks: Record<string, any> = {
      classification: FALLBACK_CLASSIFICATION,
      timeline: FALLBACK_TIMELINE,
      rca: FALLBACK_RCA,
    };
    return fallbacks[endpoint] as T;
  }

  /**
   * Extracts JSON from LLM response, handling markdown code blocks.
   */
  private extractJSON(text: string): string {
    // Remove markdown code fences if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return jsonMatch[1].trim();

    // Try to find JSON object/array directly
    const braceMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) return braceMatch[1];

    return text.trim();
  }

  /**
   * Returns telemetry metrics.
   */
  getMetrics() {
    return this.telemetry.getMetrics();
  }
}

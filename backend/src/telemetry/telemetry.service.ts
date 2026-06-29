import pino from "pino";
import { ApiEndpoint } from "../retrieval/IRetrievalFactory";

const logger = pino({ name: "telemetry" });

/**
 * TelemetryService — Operational Metrics
 * 
 * Tracks AI-layer metrics separately from data-domain metrics
 * (which live in MemoryRepository). Logs structured JSON via Pino.
 */
export class TelemetryService {
  private metrics: {
    aiCalls: number;
    fallbacks: number;
    retries: number;
    totalLatencyMs: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
  } = {
    aiCalls: 0,
    fallbacks: 0,
    retries: 0,
    totalLatencyMs: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
  };

  recordAICall(
    endpoint: ApiEndpoint,
    latencyMs: number,
    promptTokens: number,
    completionTokens: number,
    retryCount: number
  ): void {
    this.metrics.aiCalls++;
    this.metrics.retries += retryCount;
    this.metrics.totalLatencyMs += latencyMs;
    this.metrics.totalPromptTokens += promptTokens;
    this.metrics.totalCompletionTokens += completionTokens;

    logger.info({
      msg: "AI call completed",
      endpoint,
      latencyMs,
      promptTokens,
      completionTokens,
      retryCount,
    });
  }

  recordFallback(error: unknown, endpoint: ApiEndpoint): void {
    this.metrics.fallbacks++;
    logger.warn({
      msg: "AI fallback triggered",
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      totalFallbacks: this.metrics.fallbacks,
    });
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

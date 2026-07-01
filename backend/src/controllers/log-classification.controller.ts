import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { z } from "zod";
import { IAIService } from "../ai/IAIService";
import { IRetrievalFactory } from "../retrieval/IRetrievalFactory";
import { classificationPrompt } from "../prompts/v1_classification.prompt";
import {
  ClassificationResponse,
  ClassificationResponseSchema,
} from "../schemas/classification.schema";
import { AI_CONFIG } from "../config/ai.config";
import { ApiResponse } from "../schemas/api.schema";
import { FALLBACK_CLASSIFICATION } from "../ai/fallbacks";
import pino from "pino";

const logger = pino({ name: "classification-controller" });

// Request body schema — logs is optional (auto mode if omitted)
const ClassificationRequestSchema = z.object({
  logs: z
    .array(z.string().min(1, "Log entry must not be empty"))
    .max(AI_CONFIG.maxClassificationLogs, {
      message: `Maximum ${AI_CONFIG.maxClassificationLogs} log entries per request`,
    })
    .optional(),
});

/**
 * Deterministic severity override table.
 * Applied post-LLM to guarantee consistent severity regardless of model drift.
 * Per Architecture v7.0 §8.2.
 */
const CATEGORY_SEVERITY_MAP: Record<
  string,
  "critical" | "high" | "medium" | "low" | "info"
> = {
  error:                   "critical",
  security:                "high",
  shutdown:                "high",
  performance:             "medium",
  warning:                 "medium",
  "backend communication": "low",
  configuration:           "low",
  "worker initialization": "low",
  startup:                 "info",
  unknown:                 "low",
};

function getSeverity(category: string): "critical" | "high" | "medium" | "low" | "info" {
  return CATEGORY_SEVERITY_MAP[category.toLowerCase()] ?? "low";
}

/**
 * Log Classification Controller
 *
 * POST /api/ai/log-classification
 *
 * Per Architecture v7.0 §7.4:
 *   "Classification … [is] single-pass. LangGraph is used exclusively for RCA."
 *
 * Dual-mode:
 *   Manual mode — caller supplies { logs: string[] }. Logs are used as-is
 *                 (pass-through, per arch §6.1).
 *   Auto mode   — no body logs → ClassificationRetrieval selects a
 *                 diverse, tiered sample from the in-memory repository.
 *
 * Each classified entry includes: category, confidence, severity, explanation.
 * Response includes: totalClassified, categorySummary, mode, processingTimeMs.
 */
@injectable()
export class LogClassificationController {
  constructor(
    @inject("IAIService") private aiService: IAIService,
    @inject("IRetrievalFactory") private retrievalFactory: IRetrievalFactory
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    // --- Validate body ---
    const bodyParse = ClassificationRequestSchema.safeParse(req.body ?? {});
    if (!bodyParse.success) {
      res.status(400).json({
        success: false,
        message: bodyParse.error.errors.map((e) => e.message).join("; "),
        processingTimeMs: Date.now() - startTime,
        data: null,
      } as ApiResponse<null>);
      return;
    }

    const bodyLogs = bodyParse.data.logs;
    const isManualMode = Array.isArray(bodyLogs) && bodyLogs.length > 0;

    let rawLogStrings: string[];
    let mode: "manual" | "auto";

    if (isManualMode) {
      // ── Manual Mode ──────────────────────────────────────────────
      // Logs come directly from the request body — pass-through (arch §6.1)
      rawLogStrings = bodyLogs!
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      mode = "manual";
      logger.info({
        msg: "Classification: manual mode",
        logCount: rawLogStrings.length,
      });
    } else {
      // ── Auto Mode ─────────────────────────────────────────────────
      // Use ClassificationRetrieval to get a diverse sample from the repo
      const strategy = this.retrievalFactory.getStrategy("classification");
      const logsFromRepo = await strategy.retrieve();

      if (logsFromRepo.length === 0) {
        res.status(200).json({
          success: true,
          message: "No logs available in repository to classify",
          processingTimeMs: Date.now() - startTime,
          data: {
            classifications: [],
            totalClassified: 0,
            categorySummary: {},
            mode: "auto",
          },
        } as ApiResponse<any>);
        return;
      }

      // Extract raw strings — defensive guard against missing/non-string .raw
      rawLogStrings = logsFromRepo
        .map((l) => {
          if (typeof l.raw === "string" && l.raw.trim().length > 0) {
            return l.raw.trim();
          }
          // Fallback: reconstruct from parsed fields
          if (l.message) {
            return `[${l.timestamp?.toISOString() ?? ""}] [${l.severity}] ${l.message}`;
          }
          return null;
        })
        .filter((s): s is string => s !== null && s.length > 0);

      if (rawLogStrings.length === 0) {
        logger.error({
          msg: "Classification: all retrieved logs had empty/invalid .raw fields",
          sampleLog: JSON.stringify(logsFromRepo[0]),
        });
        res.status(500).json({
          success: false,
          message: "Log data is malformed — parsed logs have no raw string content.",
          processingTimeMs: Date.now() - startTime,
          data: null,
        } as ApiResponse<null>);
        return;
      }

      mode = "auto";
      logger.info({
        msg: "Classification: auto mode",
        logCount: rawLogStrings.length,
        sampleLog: rawLogStrings[0],
      });
    }

    // --- Single-pass Gemini call via IAIService (per arch v7.0 §7.4) ---
    try {
      const prompt = classificationPrompt(rawLogStrings);
      const aiResult = await this.aiService.callModel<ClassificationResponse>(
        prompt,
        ClassificationResponseSchema as import("zod").ZodSchema<ClassificationResponse>,
        "classification"
      );

      // Post-process: deterministic severity override + summary
      const enriched = aiResult.classifications.map((entry) => ({
        ...entry,
        severity: getSeverity(entry.category),
      }));

      const categorySummary = enriched.reduce<Record<string, number>>((acc, c) => {
        acc[c.category] = (acc[c.category] ?? 0) + 1;
        return acc;
      }, {});

      const result: ClassificationResponse = {
        classifications: enriched,
        totalClassified: enriched.length,
        categorySummary,
        mode,
        fallback: aiResult.fallback ?? false,
        fallbackReason: aiResult.fallbackReason,
      };

      logger.info({
        msg: "Classification: complete",
        classified: enriched.length,
        categorySummary,
        mode,
        fallback: result.fallback,
      });

      const response: ApiResponse<ClassificationResponse> = {
        success: true,
        message: `Classification complete — ${enriched.length} entries classified`,
        processingTimeMs: Date.now() - startTime,
        data: result,
        fallback: result.fallback ?? false,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({
        msg: "Classification error",
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(200).json({
        success: true,
        message: "Classification unavailable — returning fallback",
        processingTimeMs: Date.now() - startTime,
        data: { ...FALLBACK_CLASSIFICATION, mode },
        fallback: true,
      } as ApiResponse<any>);
    }
  }
}

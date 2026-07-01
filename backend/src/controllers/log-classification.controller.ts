import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { z } from "zod";
import { IRetrievalFactory } from "../retrieval/IRetrievalFactory";
import { ClassificationGraph } from "../ai/graphs/classification.graph";
import { AI_CONFIG } from "../config/ai.config";
import { ApiResponse } from "../schemas/api.schema";
import pino from "pino";

const logger = pino({ name: "classification-controller" });

// Request body schema — logs is optional
const ClassificationRequestSchema = z.object({
  logs: z
    .array(z.string().min(1, "Log entry must not be empty"))
    .max(AI_CONFIG.maxClassificationLogs, {
      message: `Maximum ${AI_CONFIG.maxClassificationLogs} log entries per request`,
    })
    .optional(),
});

/**
 * Log Classification Controller
 *
 * POST /api/ai/log-classification
 *
 * Dual-mode:
 *   Manual mode — caller supplies { logs: string[] } in the request body.
 *                 Logs are used as-is (pass-through, per arch §6.1).
 *   Auto mode   — no body logs → ClassificationRetrieval selects a
 *                 diverse, tiered sample from the in-memory repository.
 *
 * Each classified entry includes: category, confidence, severity, explanation.
 * Response includes: totalClassified, categorySummary, mode, processingTimeMs.
 */
@injectable()
export class LogClassificationController {
  constructor(
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
      // Logs come from the request body — clean whitespace, filter empties
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

      // Extract the raw string — DEFENSIVE: guard against missing/non-string .raw
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
        sampleLog: rawLogStrings[0], // log the first raw string for debugging
      });
    }

    // --- Invoke Classification Graph ---
    try {
      const graphState = await ClassificationGraph.invoke({
        rawLogs: rawLogStrings,
        mode,
      });

      const result = graphState.result;
      if (!result) {
        throw new Error("Classification graph returned null result");
      }

      const response: ApiResponse<typeof result> = {
        success: true,
        message: `Classification complete — ${result.totalClassified ?? result.classifications.length} entries classified`,
        processingTimeMs: Date.now() - startTime,
        data: result,
        fallback: result.fallback ?? false,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({
        msg: "Classification graph error",
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        success: false,
        message: `Classification failed: ${error instanceof Error ? error.message : "Internal server error"}`,
        processingTimeMs: Date.now() - startTime,
        data: null,
      } as ApiResponse<null>);
    }
  }
}

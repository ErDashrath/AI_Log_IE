import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { z } from "zod";
import { IAIService } from "../ai/IAIService";
import { ClassificationResponseSchema } from "../schemas/classification.schema";
import { classificationPrompt } from "../prompts/v1_classification.prompt";
import { AI_CONFIG } from "../config/ai.config";
import { ApiResponse } from "../schemas/api.schema";
import pino from "pino";

const logger = pino({ name: "classification-controller" });

// Request validation schema
const ClassificationRequestSchema = z.object({
  logs: z.array(z.string().min(1)).min(1).max(AI_CONFIG.maxClassificationLogs, {
    message: `Maximum ${AI_CONFIG.maxClassificationLogs} log entries per request`,
  }),
});

/**
 * Log Classification Controller
 * 
 * POST /api/ai/log-classification
 * 
 * Accepts user-supplied log entries and classifies each into
 * one of 10 operational categories. No retrieval needed —
 * classification acts on user input directly.
 */
@injectable()
export class LogClassificationController {
  constructor(
    @inject("IAIService") private aiService: IAIService
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate request body with Zod
      const parseResult = ClassificationRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          message: parseResult.error.errors[0].message,
          processingTimeMs: Date.now() - startTime,
          data: null,
        } as ApiResponse<null>);
        return;
      }

      const { logs } = parseResult.data;

      logger.info({ msg: "Classification request", logCount: logs.length });

      // Build prompt and call AI
      const prompt = classificationPrompt(logs);
      const result = await this.aiService.callModel(
        prompt,
        ClassificationResponseSchema,
        "classification"
      );

      const response: ApiResponse<typeof result> = {
        success: true,
        message: "Classification complete",
        processingTimeMs: Date.now() - startTime,
        data: result,
        fallback: (result as any).fallback || false,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({
        msg: "Classification error",
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        success: false,
        message: "Internal server error during classification",
        processingTimeMs: Date.now() - startTime,
        data: null,
      } as ApiResponse<null>);
    }
  }
}

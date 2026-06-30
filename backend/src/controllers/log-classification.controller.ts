import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { z } from "zod";
import { IAIService } from "../ai/IAIService";
import { IRetrievalFactory } from "../retrieval/IRetrievalFactory";
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
    @inject("IAIService") private aiService: IAIService,
    @inject("IRetrievalFactory") private retrievalFactory: IRetrievalFactory
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      // Create and execute retrieval strategy
      const strategy = this.retrievalFactory.getStrategy("classification");
      const logsToClassify = await strategy.retrieve();

      if (logsToClassify.length === 0) {
        res.status(200).json({
          success: true,
          message: "No logs available to classify",
          processingTimeMs: Date.now() - startTime,
          data: { classifications: [] }
        } as ApiResponse<any>);
        return;
      }

      logger.info({ msg: "Classification request", logCount: logsToClassify.length });

      // Build prompt from retrieved logs
      const rawLogs = logsToClassify.map(l => l.raw);
      const prompt = classificationPrompt(rawLogs);
      
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

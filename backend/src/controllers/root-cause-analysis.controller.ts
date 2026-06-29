import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { z } from "zod";
import { IAIService } from "../ai/IAIService";
import { IMemoryRepository } from "../repository/IMemoryRepository";
import { IRetrievalFactory } from "../retrieval/IRetrievalFactory";
import { RetrievalStrategyFactory } from "../retrieval/retrieval-factory";
import { RCAResponseSchema } from "../schemas/rca.schema";
import { RCAGraph } from "../ai/rca-graph";
import { ApiResponse } from "../schemas/api.schema";
import pino from "pino";

const logger = pino({ name: "rca-controller" });

// Request validation — all optional (auto-detect mode)
const RCARequestSchema = z.object({
  query: z.string().optional(),
  filters: z.object({
    severity: z.string().optional(),
    component: z.string().optional(),
  }).optional(),
}).optional();

/**
 * Root Cause Analysis Controller
 * 
 * POST /api/ai/root-cause-analysis
 * 
 * Analyzes related logs and determines the most probable root cause.
 * Uses the full hybrid retrieval pipeline + LangGraph-style
 * multi-step reasoning workflow.
 * 
 * Accepts optional query + filters — if omitted, auto-detects
 * from the highest error-density window.
 */
@injectable()
export class RootCauseAnalysisController {
  constructor(
    @inject("IAIService") private aiService: IAIService,
    @inject("IMemoryRepository") private repo: IMemoryRepository,
    @inject("IRetrievalFactory") private retrievalFactory: RetrievalStrategyFactory
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate request body
      const parseResult = RCARequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          message: parseResult.error.errors[0].message,
          processingTimeMs: Date.now() - startTime,
          data: null,
        } as ApiResponse<null>);
        return;
      }

      const body = parseResult.data || {};

      // Get retrieval strategy (full hybrid pipeline)
      const strategy = this.retrievalFactory.getStrategy("rca", {
        query: body.query,
        filters: body.filters,
      });

      // Retrieve evidence logs
      const evidenceLogs = await strategy.retrieve();

      logger.info({
        msg: "RCA request",
        evidenceLogCount: evidenceLogs.length,
        query: body.query || "auto-detect",
      });

      if (evidenceLogs.length === 0) {
        res.status(200).json({
          success: true,
          message: "No relevant logs found for analysis",
          processingTimeMs: Date.now() - startTime,
          data: {
            rootCause: "Insufficient data for analysis",
            evidence: [],
            impact: "Unknown",
            recommendation: "Provide additional context or check log ingestion.",
            confidence: 0,
          },
        } as ApiResponse<any>);
        return;
      }

      // Execute RCA multi-step reasoning graph
      const rcaGraph = new RCAGraph(this.aiService);
      const result = await rcaGraph.execute(evidenceLogs, this.repo.getLogs());

      const response: ApiResponse<typeof result> = {
        success: true,
        message: "Root cause analysis complete",
        processingTimeMs: Date.now() - startTime,
        data: result,
        fallback: (result as any).fallback || false,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({
        msg: "RCA error",
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        success: false,
        message: "Internal server error during root cause analysis",
        processingTimeMs: Date.now() - startTime,
        data: null,
      } as ApiResponse<null>);
    }
  }
}

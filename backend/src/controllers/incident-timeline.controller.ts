import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { z } from "zod";
import { IAIService } from "../ai/IAIService";
import { IRetrievalFactory } from "../retrieval/IRetrievalFactory";
import { RetrievalStrategyFactory } from "../retrieval/retrieval-factory";
import { TimelineResponseSchema } from "../schemas/timeline.schema";
import { TimelineGraph } from "../ai/graphs/timeline.graph";
import { ApiResponse } from "../schemas/api.schema";
import pino from "pino";

const logger = pino({ name: "timeline-controller" });

// Request validation — both fields optional (auto-detect mode)
const TimelineRequestSchema = z.object({
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
}).optional();

/**
 * Incident Timeline Controller
 * 
 * POST /api/ai/incident-timeline
 * 
 * Generates an incident timeline from log entries.
 * Accepts optional startTime/endTime — if omitted, auto-detects
 * the highest error-density 30-minute window.
 * 
 * Retrieval: TimelineRetrieval (timestamp slice only — no BM25).
 */
@injectable()
export class IncidentTimelineController {
  constructor(
    @inject("IAIService") private aiService: IAIService,
    @inject("IRetrievalFactory") private retrievalFactory: RetrievalStrategyFactory
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate request body
      const parseResult = TimelineRequestSchema.safeParse(req.body);
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

      // Get retrieval strategy
      const strategy = this.retrievalFactory.getStrategy("timeline", {
        startTime: body.startTime ? new Date(body.startTime) : undefined,
        endTime: body.endTime ? new Date(body.endTime) : undefined,
      });

      // Retrieve relevant logs
      const contextLogs = await strategy.retrieve();

      logger.info({
        msg: "Timeline request",
        contextLogCount: contextLogs.length,
        autoDetect: !body.startTime && !body.endTime,
      });

      if (contextLogs.length === 0) {
        res.status(200).json({
          success: true,
          message: "No logs found in the specified time window",
          processingTimeMs: Date.now() - startTime,
          data: { events: [] },
        } as ApiResponse<any>);
        return;
      }

      const graphState = await TimelineGraph.invoke({ contextLogs });
      const result = graphState.result;

      if (!result) throw new Error("Timeline graph returned no result");

      const response: ApiResponse<typeof result> = {
        success: true,
        message: "Timeline generated successfully",
        processingTimeMs: Date.now() - startTime,
        data: result,
        fallback: (result as any).fallback || false,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({
        msg: "Timeline error",
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        success: false,
        message: "Internal server error during timeline generation",
        processingTimeMs: Date.now() - startTime,
        data: null,
      } as ApiResponse<null>);
    }
  }
}

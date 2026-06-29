import { injectable, inject } from "tsyringe";
import { IRetrievalFactory, IRetrievalStrategy, ApiEndpoint } from "./IRetrievalFactory";
import { IMemoryRepository } from "../repository/IMemoryRepository";
import { IIndexManager } from "../index/IIndexManager";
import { ClassificationRetrieval } from "./classification.retrieval";
import { TimelineRetrieval } from "./timeline.retrieval";
import { RCARetrieval } from "./rca.retrieval";

/**
 * RetrievalStrategyFactory — Strategy Pattern Router
 * 
 * Each API endpoint maps to a dedicated retrieval strategy
 * with a different retrieval profile:
 * 
 *   Classification → Pass-through (acts on user-supplied logs)
 *   Timeline       → Timestamp slice (purely temporal)
 *   RCA            → Full hybrid pipeline (BM25 + Evidence Ranker)
 * 
 * The HTTP controller layer never performs retrieval directly.
 * It asks the factory for a strategy and calls retrieve().
 */
@injectable()
export class RetrievalStrategyFactory implements IRetrievalFactory {
  constructor(
    @inject("IMemoryRepository") private repo: IMemoryRepository,
    @inject("IIndexManager") private indexManager: IIndexManager
  ) {}

  /**
   * Creates a retrieval strategy for the given endpoint.
   * 
   * @param endpoint - Which API endpoint needs retrieval
   * @param options  - Endpoint-specific options (logs, time range, query, etc.)
   */
  getStrategy(
    endpoint: ApiEndpoint,
    options?: {
      logs?: string[];
      startTime?: Date;
      endTime?: Date;
      query?: string;
      filters?: { severity?: string; component?: string };
    }
  ): IRetrievalStrategy {
    switch (endpoint) {
      case "classification":
        return new ClassificationRetrieval(options?.logs || []);

      case "timeline":
        return new TimelineRetrieval(
          this.repo,
          this.indexManager,
          options?.startTime,
          options?.endTime
        );

      case "rca":
        return new RCARetrieval(
          this.repo,
          this.indexManager,
          options?.query,
          options?.filters
        );

      default:
        throw new Error(`Unknown endpoint: ${endpoint}`);
    }
  }
}

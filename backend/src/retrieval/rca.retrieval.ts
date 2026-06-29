import { IRetrievalStrategy } from "./IRetrievalFactory";
import { ParsedLog } from "../types/models";
import { IMemoryRepository } from "../repository/IMemoryRepository";
import { IIndexManager } from "../index/IIndexManager";
import { EvidenceRanker } from "./evidence-ranker";
import { ContextBuilder } from "./context-builder";

/**
 * RCARetrieval — Full Hybrid Retrieval Pipeline
 * 
 * RCA requires causal evidence — the full pipeline is necessary:
 *   1. Metadata filter (optional severity/component pre-filter)
 *   2. BM25 search via MiniSearch (keyword relevance)
 *   3. Evidence Ranker (multi-signal scoring with normalized BM25)
 *   4. Context Builder (dedup, budget, chronological sort)
 * 
 * This is the most sophisticated retrieval strategy —
 * it ensures only the most relevant evidence reaches the LLM.
 */
export class RCARetrieval implements IRetrievalStrategy {
  private ranker = new EvidenceRanker();
  private contextBuilder = new ContextBuilder();

  constructor(
    private repo: IMemoryRepository,
    private indexManager: IIndexManager,
    private query?: string,
    private filters?: { severity?: string; component?: string }
  ) {}

  async retrieve(): Promise<ParsedLog[]> {
    const allLogs = this.repo.getLogs();

    // Step 1: If no query, auto-detect from error density window
    let searchQuery = this.query;
    if (!searchQuery) {
      // Build a query from the most common error messages
      const window = this.indexManager.getHighestErrorDensityWindow();
      const windowLogs = this.indexManager.getLogsByTimeWindow(window.start, window.end);
      const errorLogs = this.repo.getByLineNums(windowLogs)
        .filter((l) => l.severity === "error" || l.severity === "crit");
      
      // Use the first few error messages as the implicit query
      searchQuery = errorLogs
        .slice(0, 5)
        .map((l) => l.message)
        .join(" ");
    }

    if (!searchQuery) {
      // Absolute fallback — use severity filter
      searchQuery = "error";
    }

    // Step 2: BM25 search
    let candidates = this.indexManager.search(searchQuery);

    // Step 3: Apply optional metadata filters
    if (this.filters?.severity) {
      const severityLineNums = new Set(
        this.indexManager.getLogsByTimeWindow() // get all
      );
      candidates = candidates.filter((c) => {
        const log = allLogs[c.id as number];
        return log && log.severity === this.filters!.severity;
      });
    }

    if (this.filters?.component) {
      candidates = candidates.filter((c) => {
        const log = allLogs[c.id as number];
        return log && log.component === this.filters!.component;
      });
    }

    // Step 4: Evidence Ranker — multi-signal scoring
    const ranked = this.ranker.rank(candidates, searchQuery, allLogs);

    // Step 5: Context Builder — dedup, budget, chronological sort
    return this.contextBuilder.buildContext(ranked);
  }
}

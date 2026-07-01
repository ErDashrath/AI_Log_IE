/**
 * ClassificationRetrieval — Architecture-Correct Pass-Through
 *
 * Per Architecture v7.0 §6.1:
 *   "ClassificationRetrieval: Pass-through (no retrieval).
 *    Classification acts on user-supplied logs.
 *    Retrieval would contaminate the input."
 *
 * In AUTO mode: pulls top anomaly logs from repository (controller-driven).
 * In MANUAL mode: the controller passes logs directly to the graph — no
 * retrieval needed at all.
 *
 * The strategy's retrieve() method is kept for interface compliance but the
 * controller owns the final decision on which logs to classify.
 */
import { IRetrievalStrategy } from "./IRetrievalFactory";
import { ParsedLog } from "../types/models";
import { IMemoryRepository } from "../repository/IMemoryRepository";
import { RETRIEVAL_CONFIG } from "../config/retrieval.config";
import pino from "pino";

const logger = pino({ name: "classification-retrieval" });

export class ClassificationRetrieval implements IRetrievalStrategy {
  private repository: IMemoryRepository;

  constructor(repository: IMemoryRepository) {
    this.repository = repository;
  }

  /**
   * Returns up to contextBudget representative logs for classification.
   *
   * Priority order:
   *   1. error / crit logs (most operationally significant)
   *   2. warn logs
   *   3. notice logs (startup / shutdown / configuration events)
   *   4. remaining logs (anything else)
   *
   * This ensures a diverse sample across ALL 10 categories,
   * not just errors — so the LLM can produce a meaningful distribution.
   */
  async retrieve(): Promise<ParsedLog[]> {
    const allLogs = this.repository.getLogs();
    const budget = RETRIEVAL_CONFIG.contextBudget; // 10

    if (allLogs.length === 0) {
      logger.warn("ClassificationRetrieval: repository is empty");
      return [];
    }

    // Tier 1 — errors (map to Error / Security categories)
    const errors = allLogs.filter(
      (l) => l.severity === "error" || l.severity === "crit"
    );

    // Tier 2 — warnings
    const warnings = allLogs.filter(
      (l) => l.severity === "warn" || l.severity === "warning"
    );

    // Tier 3 — notices (startup, config, worker init, backend comm)
    const notices = allLogs.filter((l) => l.severity === "notice");

    // Tier 4 — info or unknown severities
    const others = allLogs.filter(
      (l) =>
        l.severity !== "error" &&
        l.severity !== "crit" &&
        l.severity !== "warn" &&
        l.severity !== "warning" &&
        l.severity !== "notice"
    );

    // Build a diverse context: fill budget with tier-1 first, then others
    const result: ParsedLog[] = [];
    const seenTemplates = new Set<string>();

    // Helper: add logs from a tier, deduplicating by template
    const addFromTier = (tier: readonly ParsedLog[], limit: number) => {
      let addedFromThisTier = 0;
      for (const log of tier) {
        if (addedFromThisTier >= limit || result.length >= budget) break;
        
        // Allow max 2 logs per unique template (dedup)
        const templateKey = log.template ?? log.message;
        const count = [...result].filter(
          (r) => (r.template ?? r.message) === templateKey
        ).length;
        
        if (count >= 2) continue;
        
        seenTemplates.add(templateKey);
        result.push(log);
        addedFromThisTier++;
      }
    };

    // Allocate budget: ~40% errors, ~20% warnings, ~30% notices, ~10% others
    addFromTier(errors,   Math.ceil(budget * 0.4));
    addFromTier(warnings, Math.ceil(budget * 0.2));
    addFromTier(notices,  Math.ceil(budget * 0.3));
    addFromTier(others,   budget);

    logger.info({
      msg: "ClassificationRetrieval: selected logs",
      total: allLogs.length,
      selected: result.length,
      breakdown: {
        errors: result.filter((l) => l.severity === "error" || l.severity === "crit").length,
        warnings: result.filter((l) => l.severity === "warn").length,
        notices: result.filter((l) => l.severity === "notice").length,
        others: result.filter(
          (l) => !["error", "crit", "warn", "notice"].includes(l.severity)
        ).length,
      },
    });

    return result;
  }
}

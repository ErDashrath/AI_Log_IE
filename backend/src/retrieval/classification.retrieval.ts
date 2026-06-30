import { IRetrievalStrategy } from "./IRetrievalFactory";
import { ParsedLog } from "../types/models";
import { IMemoryRepository } from "../repository/IMemoryRepository";
import { RETRIEVAL_CONFIG } from "../config/retrieval.config";

/**
 * ClassificationRetrieval — Repository Fetch
 * 
 * Automatically pulls the most relevant anomalous logs from the uploaded file
 * for classification, matching user expectations.
 */
export class ClassificationRetrieval implements IRetrievalStrategy {
  private repository: IMemoryRepository;

  constructor(repository: IMemoryRepository) {
    this.repository = repository;
  }

  async retrieve(): Promise<ParsedLog[]> {
    // Fetch logs from repository to classify (focusing on anomalies)
    const logs = this.repository.getLogs();
    
    // Sort by severity (errors first) and take the top N
    const anomalies = logs.filter((l: ParsedLog) => 
      l.severity.toLowerCase() === "error" || 
      l.severity.toLowerCase() === "warn" || 
      l.severity.toLowerCase() === "critical" || 
      l.severity.toLowerCase() === "fatal"
    );
    
    // If no anomalies found, just grab some random logs to classify
    const targetLogs = anomalies.length > 0 ? anomalies : logs;
    
    // Limit to max configured
    return targetLogs.slice(0, RETRIEVAL_CONFIG.contextBudget);
  }
}

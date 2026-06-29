import { IRetrievalStrategy } from "./IRetrievalFactory";
import { ParsedLog } from "../types/models";

/**
 * ClassificationRetrieval — Pass-Through Strategy
 * 
 * Classification acts on user-supplied log entries.
 * No retrieval is needed — sending repository logs would
 * contaminate the user's input.
 * 
 * The user sends raw log lines → they go directly to the LLM.
 */
export class ClassificationRetrieval implements IRetrievalStrategy {
  private logs: string[];

  constructor(logs: string[]) {
    this.logs = logs;
  }

  async retrieve(): Promise<ParsedLog[]> {
    // Pass-through: convert raw strings to minimal ParsedLog objects
    return this.logs.map((raw, i) => ({
      raw,
      timestamp: new Date(),
      severity: "unknown",
      component: "user-input",
      message: raw,
      template: raw,
    }));
  }
}

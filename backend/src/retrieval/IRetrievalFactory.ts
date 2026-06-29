import { ParsedLog } from "../types/models";

export type ApiEndpoint = "classification" | "timeline" | "rca";

export interface IRetrievalStrategy {
  retrieve(query?: any): Promise<ParsedLog[]>;
}

export interface IRetrievalFactory {
  getStrategy(endpoint: ApiEndpoint): IRetrievalStrategy;
}

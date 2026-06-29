import { ZodSchema } from "zod";
import { ApiEndpoint } from "../retrieval/IRetrievalFactory";

export interface IAIService {
  callModel<T>(
    prompt: string,
    schema: ZodSchema<T>,
    endpoint: ApiEndpoint
  ): Promise<T>;
}

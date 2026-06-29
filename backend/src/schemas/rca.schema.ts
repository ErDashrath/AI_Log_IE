import { z } from "zod";

export const EvidenceEntrySchema = z.object({
  logEntry: z.string(),
  relevance: z.string(),
});

export const RCAResponseSchema = z.object({
  rootCause: z.string(),
  evidence: z.array(EvidenceEntrySchema),
  impact: z.string(),
  recommendation: z.string(),
  confidence: z.number().min(0).max(100),
  fallback: z.boolean().optional(),
});

export type RCAResponse = z.infer<typeof RCAResponseSchema>;

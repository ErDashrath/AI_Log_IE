import { z } from "zod";

export const SeverityLevel = z.enum(["critical", "high", "medium", "low", "info"]);

export const ClassificationEntrySchema = z.object({
  logEntry: z.string(),
  category: z.string(),
  confidence: z.number().min(0).max(100),
  explanation: z.string(),
  severity: SeverityLevel.default("low"),
});

export const ClassificationResponseSchema = z.object({
  classifications: z.array(ClassificationEntrySchema),
  totalClassified: z.number().optional(),
  categorySummary: z.record(z.string(), z.number()).optional(),
  mode: z.enum(["manual", "auto"]).optional(),
  fallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
});

export type SeverityLevel = z.infer<typeof SeverityLevel>;
export type ClassificationEntry = z.infer<typeof ClassificationEntrySchema>;
export type ClassificationResponse = z.infer<typeof ClassificationResponseSchema>;

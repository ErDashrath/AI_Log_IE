import { z } from "zod";

export const ClassificationEntrySchema = z.object({
  logEntry: z.string(),
  category: z.string(),
  confidence: z.number().min(0).max(100),
  explanation: z.string(),
});

export const ClassificationResponseSchema = z.object({
  classifications: z.array(ClassificationEntrySchema),
  fallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
});

export type ClassificationResponse = z.infer<typeof ClassificationResponseSchema>;

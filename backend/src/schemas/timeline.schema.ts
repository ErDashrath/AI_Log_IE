import { z } from "zod";

export const TimelineEventSchema = z.object({
  timestamp: z.string(),
  title: z.string(),
  summary: z.string(),
  logReferences: z.array(z.number()),
});

export const TimelineResponseSchema = z.object({
  events: z.array(TimelineEventSchema),
  fallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
});

export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

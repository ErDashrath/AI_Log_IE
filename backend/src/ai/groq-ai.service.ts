import { injectable } from "tsyringe";
import { ZodSchema } from "zod";
import { IAIService } from "./IAIService";
import { ApiEndpoint } from "../retrieval/IRetrievalFactory";
import { AI_CONFIG } from "../config/ai.config";
import { TelemetryService } from "../telemetry/telemetry.service";
import pino from "pino";

const logger = pino({ name: "groq-ai-service" });

/**
 * GroqAIService — Fallback Provider
 * 
 * Used when Gemini API is unavailable (e.g., 404, rate limits, invalid keys).
 * Uses native fetch to call the OpenAI-compatible Groq API endpoint.
 */
@injectable()
export class GroqAIService implements IAIService {
  private telemetry = new TelemetryService();

  async callModel<T>(
    prompt: string,
    schema: ZodSchema<T>,
    endpoint: ApiEndpoint
  ): Promise<T> {
    const startTime = Date.now();
    
    // Force read the .env file directly to bypass any process.env caching issues
    let apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      try {
        const fs = require('fs');
        const path = require('path');
        const envPath = path.resolve(process.cwd(), '.env');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/^GROQ_API_KEY=(.*)$/m);
        if (match && match[1]) {
          apiKey = match[1].trim();
        }
      } catch (e) {
        // ignore fs errors
      }
    }

    if (!apiKey) {
      throw new Error("GROQ_API_KEY is missing. Cannot use Groq fallback.");
    }

    logger.info({ msg: "Falling back to Groq API", endpoint });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: AI_CONFIG.temperatures[endpoint],
        max_tokens: AI_CONFIG.completionBudget,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API Error: ${response.status} - ${errorText}`);
    }

    const json = await response.json() as any;
    const rawText = json.choices[0].message.content || "";

    const jsonStr = this.extractJSON(rawText);
    const parsed = JSON.parse(jsonStr);

    // Zod validates the response
    const validated = schema.parse(parsed);

    const latency = Date.now() - startTime;
    this.telemetry.recordAICall(
      endpoint,
      latency,
      prompt.length, 
      rawText.length, 
      0 // No retry count recorded for fallback
    );

    return validated;
  }

  private extractJSON(text: string): string {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return jsonMatch[1].trim();

    const braceMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) return braceMatch[1];

    return text.trim();
  }

  getMetrics() {
    return this.telemetry.getMetrics();
  }
}

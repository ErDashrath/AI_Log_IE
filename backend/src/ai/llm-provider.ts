import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage } from "@langchain/core/messages";
import { config } from "dotenv";
import pino from "pino";

config();
const logger = pino({ name: "llm-provider" });

/** Hard timeout (ms) for any single LLM invoke() call. Increased to 300s per user request. */
export const LLM_TIMEOUT_MS = 300_000;

/**
 * Race an LLM invoke() call against a hard timeout.
 * Call this directly at the invoke() call-site — do NOT wrap the LLM object.
 *
 * @example
 *   const response = await invokeWithTimeout(llm, prompt, "classification");
 */
export async function invokeWithTimeout(
  llm: BaseChatModel,
  input: string,
  label: string
): Promise<BaseMessage> {
  let timeoutHandle: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`LLM call timed out after ${LLM_TIMEOUT_MS}ms [${label}]`));
    }, LLM_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([
      llm.invoke(input),
      timeoutPromise,
    ]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (err) {
    clearTimeout(timeoutHandle!);
    throw err;
  }
}

/**
 * Returns the best available LLM.
 *
 * Strategy (per Architecture v7.0 §7.1):
 *   Primary  — Gemini 2.0 Flash (deterministic, fast)
 *   Fallback — Groq Llama 3.3 70B (if Gemini key is absent/invalid)
 *
 * NOTE: Do NOT add timeouts here. Timeouts are applied at the invoke()
 * call-site via invokeWithTimeout(). Wrapping BaseChatModel in a Proxy
 * breaks LangChain's internal method dispatch.
 *
 * @param temperature    Per-endpoint temperature (0.0 for classification)
 * @param maxOutputTokens Max tokens to generate
 */
export function getResilientLLM(
  temperature: number,
  maxOutputTokens: number
): BaseChatModel {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey   = process.env.GROQ_API_KEY;

  // Gemini primary
  if (geminiKey) {
    const gemini = new ChatGoogleGenerativeAI({
      modelName: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      apiKey: geminiKey,
      temperature,
      maxOutputTokens,
    });

    // If Groq is also available, register it as a native LangChain fallback
    if (groqKey) {
      const groq = new ChatGroq({
        apiKey: groqKey,
        modelName: "llama-3.3-70b-versatile",
        temperature,
        maxTokens: maxOutputTokens,
      });

      logger.info("LLM: Gemini (primary) + Groq (fallback)");
      // .withFallbacks() returns a Runnable — cast to BaseChatModel for callers
      return gemini.withFallbacks({ fallbacks: [groq] }) as unknown as BaseChatModel;
    }

    logger.info("LLM: Gemini only (no GROQ_API_KEY)");
    return gemini;
  }

  // Groq-only fallback (no Gemini key)
  if (groqKey) {
    logger.warn("LLM: Gemini key absent — using Groq only");
    return new ChatGroq({
      apiKey: groqKey,
      modelName: "llama-3.3-70b-versatile",
      temperature,
      maxTokens: maxOutputTokens,
    });
  }

  // Neither key configured — will fail at invoke() time with a clear error
  logger.error("LLM: No API keys configured. Set GEMINI_API_KEY or GROQ_API_KEY.");
  return new ChatGoogleGenerativeAI({
    modelName: "gemini-2.0-flash",
    apiKey: "MISSING",
    temperature,
    maxOutputTokens,
  });
}

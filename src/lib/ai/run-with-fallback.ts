import { generateText, streamText, type ModelMessage, type ToolSet } from "ai";
import type { createGateway } from "@ai-sdk/gateway";
import { buildGatewayProviderOptions } from "../aiChat.js";

export function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return ["rate limit", "timeout", "overloaded", "temporarily unavailable", "service unavailable", "gateway", "model unavailable"].some((token) => message.includes(token));
}

interface CommonOptions {
  gateway: ReturnType<typeof createGateway>;
  models: readonly string[];
  providerOptionsFor?: (model: string) => ReturnType<typeof buildGatewayProviderOptions>;
  system: string;
  maxOutputTokens: number;
  taskName: string;
}

export async function runTextWithFallback({ gateway, models, providerOptionsFor, system, prompt, temperature, maxOutputTokens, taskName }: CommonOptions & { prompt: string; temperature?: number; }): Promise<{ text: string; modelUsed: string; fallbackAttempts: number; }> {
  let lastError: unknown;
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    try {
      const result = await generateText({ model: gateway(model), system, prompt, temperature, maxOutputTokens, providerOptions: providerOptionsFor?.(model) });
      return { text: result.text, modelUsed: model, fallbackAttempts: i };
    } catch (error) {
      lastError = error;
      if (i === models.length - 1 || !isRetryableError(error)) break;
    }
  }
  throw new Error(`${taskName} failed across ${models.length} model(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function runStreamWithFallback({ gateway, models, providerOptionsFor, system, messages, tools, maxOutputTokens, taskName }: CommonOptions & { messages: ModelMessage[]; tools?: ToolSet; }): Promise<{ result: ReturnType<typeof streamText>; modelUsed: string; }> {
  let lastError: unknown;
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    try {
      const result = streamText({ model: gateway(model), system, messages, tools, maxOutputTokens, providerOptions: providerOptionsFor?.(model) });
      return { result, modelUsed: model };
    } catch (error) {
      lastError = error;
      if (i === models.length - 1 || !isRetryableError(error)) break;
    }
  }
  throw new Error(`${taskName} failed across ${models.length} model(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

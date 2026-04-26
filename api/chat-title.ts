import { createGateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { z } from "zod";
import { DEFAULT_DEANA_LLM_MODEL } from "../src/lib/aiChat";

declare const process: {
  env: Record<string, string | undefined>;
};

export const config = {
  runtime: "edge",
};

const MAX_BODY_BYTES = 3_000;
const selectedModel = process.env.DEANA_LLM_MODEL ?? DEFAULT_DEANA_LLM_MODEL;

const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN,
});

const titleRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
});

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.VERCEL_ENV !== "production";

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function buildProviderOptions(model: string) {
  const isGeminiGatewayModel = model.startsWith("google/gemini-");
  const isOpenAiGatewayModel = model.startsWith("openai/");

  return {
    ...(isGeminiGatewayModel
      ? {
          google: {
            thinkingLevel: "low",
            includeThoughts: false,
          },
        }
      : {}),
    ...(isOpenAiGatewayModel
      ? {
          openai: {
            reasoningEffort: "low",
          },
        }
      : {}),
    gateway: {
      zeroDataRetention: true,
      disallowPromptTraining: true,
      ...(isGeminiGatewayModel ? { only: ["vertex"] } : {}),
    },
  };
}

function cleanTitle(value: string): string {
  const title = value
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();

  return title.length > 52 ? `${title.slice(0, 49)}...` : title;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  if (!isSameOrigin(request)) {
    return jsonResponse(403, { error: "Title requests must come from this Deana deployment." });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Title context is too large." });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const parsed = titleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(400, { error: "Invalid title request." });
  }

  try {
    const result = await generateText({
      model: gateway(selectedModel),
      system: [
        "Create a short, specific Deana chat title from the user's first message only.",
        "Use two to six words.",
        "Preserve the main topic and intent, such as Baldness Risk, Cancer Risk, or Drug Response Takeaways.",
        "For example, 'Am I likely to go bald?' should become 'Investigating Male Pattern Baldness'.",
        "Do not return vague one-word titles like Genetic, Health, Report, Results, or Findings.",
        "Do not return demographic labels by themselves, such as Male or Female.",
        "Do not include punctuation unless needed inside a medical term.",
        "Do not include profile names, file names, or raw DNA details.",
        "Return only the title text.",
      ].join("\n"),
      prompt: parsed.data.prompt,
      maxOutputTokens: 200,
      providerOptions: buildProviderOptions(selectedModel),
    });

    const title = cleanTitle(result.text);
    return jsonResponse(200, { title: title || "New chat" });
  } catch {
    return jsonResponse(503, { error: "AI title generation is unavailable." });
  }
}

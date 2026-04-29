import { createGateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { getGatewayApiKey, isSameOrigin } from "../src/lib/aiGatewayAuth.js";
import { buildGatewayProviderOptions, formatChatTitle } from "../src/lib/aiChat.js";
import { TASK_MODELS } from "../src/lib/ai/models.js";
import { runTextWithFallback } from "../src/lib/ai/run-with-fallback.js";

declare const process: {
  env: Record<string, string | undefined>;
};

export const config = {
  runtime: "edge",
};

const MAX_BODY_BYTES = 3_000;

const titleRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
});

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  if (!isSameOrigin(request, process.env)) {
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
    const gateway = createGateway({
      apiKey: getGatewayApiKey(request, process.env),
    });

    const models = process.env.DEANA_LLM_MODEL ? [process.env.DEANA_LLM_MODEL] : TASK_MODELS.titleGeneration;
    const result = await runTextWithFallback({
      gateway,
      models,
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
      providerOptionsFor: (model) => buildGatewayProviderOptions(model),
      taskName: "chat-title",
    });

    const title = formatChatTitle(result.text);
    return jsonResponse(200, { title: title || "New chat" });
  } catch {
    return jsonResponse(503, { error: "AI title generation is unavailable." });
  }
}

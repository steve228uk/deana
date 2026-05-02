import { hasGatewayAuth } from "../src/lib/aiGatewayAuth.js";
import { chatModelFromEnv } from "../src/lib/ai/models.js";

declare const process: {
  env: Record<string, string | undefined>;
};

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const body: { enabled: boolean; model?: string } = {
    enabled: hasGatewayAuth(request, process.env),
  };
  if (process.env.VERCEL_ENV !== "production") {
    body.model = chatModelFromEnv(process.env);
  }

  return Response.json(
    body,
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

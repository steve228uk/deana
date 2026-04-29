import { hasGatewayAuth } from "../src/lib/aiGatewayAuth.js";

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

  return Response.json(
    { enabled: hasGatewayAuth(request, process.env) },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

declare const process: {
  env: Record<string, string | undefined>;
};

export const config = {
  runtime: "edge",
};

function hasAiCredentials(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  return Response.json(
    { enabled: hasAiCredentials() },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

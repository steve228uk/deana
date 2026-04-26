const VERCEL_OIDC_HEADER = "x-vercel-oidc-token";

export function getGatewayApiKey(request: Request, env: Record<string, string | undefined>): string | undefined {
  return env.AI_GATEWAY_API_KEY ?? request.headers.get(VERCEL_OIDC_HEADER) ?? env.VERCEL_OIDC_TOKEN;
}

export function hasGatewayAuth(request: Request, env: Record<string, string | undefined>): boolean {
  return Boolean(getGatewayApiKey(request, env));
}

export function isSameOrigin(request: Request, env: Record<string, string | undefined>): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return env.VERCEL_ENV !== "production";

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

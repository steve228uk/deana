import { describe, expect, it } from "vitest";
import { getGatewayApiKey, hasGatewayAuth, isSameOrigin } from "./aiGatewayAuth";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://deana.example/api/ai-status", { headers });
}

describe("AI Gateway auth", () => {
  it("prefers an explicit Gateway API key", () => {
    const request = makeRequest({ "x-vercel-oidc-token": "oidc-token" });

    expect(getGatewayApiKey(request, { AI_GATEWAY_API_KEY: "api-key" })).toBe("api-key");
    expect(hasGatewayAuth(request, { AI_GATEWAY_API_KEY: "api-key" })).toBe(true);
  });

  it("uses Vercel's runtime OIDC header when no explicit API key is set", () => {
    const request = makeRequest({ "x-vercel-oidc-token": "oidc-token" });

    expect(getGatewayApiKey(request, {})).toBe("oidc-token");
    expect(hasGatewayAuth(request, {})).toBe(true);
  });

  it("falls back to the local OIDC env token", () => {
    const request = makeRequest();

    expect(getGatewayApiKey(request, { VERCEL_OIDC_TOKEN: "env-oidc-token" })).toBe("env-oidc-token");
    expect(hasGatewayAuth(request, { VERCEL_OIDC_TOKEN: "env-oidc-token" })).toBe(true);
  });

  it("reports missing Gateway auth when no token is available", () => {
    expect(getGatewayApiKey(makeRequest(), {})).toBeUndefined();
    expect(hasGatewayAuth(makeRequest(), {})).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("accepts a request whose origin matches its own host", () => {
    const request = new Request("https://deana.example/api/chat", {
      headers: { origin: "https://deana.example" },
    });
    expect(isSameOrigin(request, {})).toBe(true);
  });

  it("rejects a request from a different origin", () => {
    const request = new Request("https://deana.example/api/chat", {
      headers: { origin: "https://attacker.example" },
    });
    expect(isSameOrigin(request, {})).toBe(false);
  });

  it("allows requests without an origin header in non-production", () => {
    const request = new Request("https://deana.example/api/chat");
    expect(isSameOrigin(request, {})).toBe(true);
    expect(isSameOrigin(request, { VERCEL_ENV: "development" })).toBe(true);
  });

  it("rejects requests without an origin header in production", () => {
    const request = new Request("https://deana.example/api/chat");
    expect(isSameOrigin(request, { VERCEL_ENV: "production" })).toBe(false);
  });
});

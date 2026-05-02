import { describe, expect, it } from "vitest";
import { buildSystemPrompt, trimMessagesToRecentWindow } from "./chat.js";

function buildMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `message-${index}` }],
  }));
}

describe("trimMessagesToRecentWindow", () => {
  it("keeps payload unchanged when messages are at or under max", () => {
    const payload = {
      consent: { accepted: true, version: "v1" },
      context: { contextVersion: "v1" },
      messages: buildMessages(12),
    };

    expect(trimMessagesToRecentWindow(payload)).toEqual(payload);
  });

  it("trims to the most recent message window", () => {
    const payload = {
      consent: { accepted: true, version: "v1" },
      context: { contextVersion: "v1" },
      messages: buildMessages(16),
    };

    expect(trimMessagesToRecentWindow(payload)).toEqual({
      ...payload,
      messages: payload.messages.slice(-12),
    });
  });

  it("ignores non-object payloads", () => {
    expect(trimMessagesToRecentWindow(null)).toBeNull();
    expect(trimMessagesToRecentWindow("not-an-object")).toBe("not-an-object");
  });
});

describe("buildSystemPrompt", () => {
  it("keeps follow-up suggestions structured and privacy scoped", () => {
    const prompt = buildSystemPrompt({
      contextVersion: 1,
      currentTab: "ai",
      activeFilters: {
        q: "",
        source: "",
        evidence: [],
        significance: [],
        repute: [],
        coverage: [],
        publications: [],
        gene: [],
        tag: [],
        sort: "relevance",
      },
      report: {
        provider: "23andMe",
        build: "GRCh37",
        markerCount: 10,
        coverageScore: 90,
        evidencePackVersion: "test-pack",
        evidenceStatus: "complete",
        evidenceMatchedFindings: 1,
        localEvidenceEntryMatches: 1,
        warnings: [],
        categoryCounts: [],
      },
      selectedFindingId: null,
      findings: [],
    });

    expect(prompt).toContain("<!-- deana-follow-ups:");
    expect(prompt).toContain("\"title\":\"Short button label\"");
    expect(prompt).toContain("\"body\":\"Full follow-up prompt to send\"");
    expect(prompt).toContain("Do not include profile names, uploaded file names, raw DNA");
    expect(prompt).toContain("browser-local search");
  });
});

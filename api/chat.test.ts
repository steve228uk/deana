import { describe, expect, it } from "vitest";
import { chatModelFromEnv, DEANA_MODELS } from "../src/lib/ai/models.js";
import { CHAT_SEARCH_TOOL_PART_TYPE } from "../src/lib/aiChat.js";
import { buildSystemPrompt, shouldRequireReportSearch, trimMessagesToRecentWindow } from "./chat.js";

type ChatContext = Parameters<typeof buildSystemPrompt>[0];

function buildMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `message-${index}` }],
  }));
}

function buildChatContext(): ChatContext {
  return {
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
  };
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

describe("chatModelFromEnv", () => {
  it("uses the configured chat model when present", () => {
    expect(chatModelFromEnv({ DEANA_LLM_MODEL: "openai/gpt-4o-mini" })).toBe("openai/gpt-4o-mini");
  });

  it("falls back to the default chat model for missing or empty values", () => {
    expect(chatModelFromEnv({})).toBe(DEANA_MODELS.default);
    expect(chatModelFromEnv({ DEANA_LLM_MODEL: " " })).toBe(DEANA_MODELS.default);
  });
});

describe("shouldRequireReportSearch", () => {
  it("requires local search for phenotype lookup questions", () => {
    expect(shouldRequireReportSearch([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Will I go bald?" }] },
    ], buildChatContext())).toBe(true);
  });

  it("keeps normal text answers for explanation follow-ups", () => {
    expect(shouldRequireReportSearch([
      { id: "u1", role: "user", parts: [{ type: "text", text: "What does coverage score mean?" }] },
    ], buildChatContext())).toBe(false);
  });

  it("does not require another search while returning completed tool output", () => {
    expect(shouldRequireReportSearch([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Will I go bald?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: CHAT_SEARCH_TOOL_PART_TYPE, state: "output-available", toolCallId: "tool-1", input: {}, output: { findings: [] } }],
      },
    ], buildChatContext())).toBe(false);
  });
});

describe("buildSystemPrompt", () => {
  it("keeps follow-up suggestions structured and privacy scoped", () => {
    const prompt = buildSystemPrompt(buildChatContext());

    expect(prompt).toContain("<!-- deana-follow-ups:");
    expect(prompt).toContain("\"title\":\"Short button label\"");
    expect(prompt).toContain("\"body\":\"Full follow-up prompt to send\"");
    expect(prompt).toContain("Do not include profile names, uploaded file names, raw DNA");
    expect(prompt).toContain("browser-local search");
  });
});

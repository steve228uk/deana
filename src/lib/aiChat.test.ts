import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "./explorer";
import {
  buildChatContext,
  buildGatewayProviderOptions,
  extractChatFollowUps,
  mergeChatFindings,
  MAX_CHAT_CONTEXT_FINDINGS,
  normalizeChatFollowUps,
} from "./aiChat";
import { DEANA_MODELS } from "./ai/models";
import { makeProfileMeta, makeStoredReportEntries } from "../test/fixtures";

describe("buildChatContext", () => {
  it("redacts profile identity and raw DNA data from chat context", () => {
    const profile = makeProfileMeta({
      id: "profile-secret-id",
      name: "Private Profile Name",
      fileName: "private-raw-dna.txt",
    });
    const entries = makeStoredReportEntries(profile.id);
    const context = buildChatContext({
      profile,
      currentTab: "medical",
      filters: DEFAULT_FILTERS,
      visibleEntries: entries,
      selectedEntry: entries[0],
    });
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain("Private Profile Name");
    expect(serialized).not.toContain("private-raw-dna.txt");
    expect(serialized).not.toContain("profile-secret-id");
    expect(serialized).not.toContain(String(profile.dna.markers[0][2]));
    expect(context.report.provider).toBe(profile.dna.provider);
    expect(context.findings[0].markers[0].rsid).toMatch(/^rs\d+$/);
  });

  it("caps and deduplicates findings with the selected finding first", () => {
    const profile = makeProfileMeta();
    const template = makeStoredReportEntries(profile.id)[0];
    const entries = Array.from({ length: MAX_CHAT_CONTEXT_FINDINGS + 5 }, (_, index) => ({
      ...template,
      id: `finding-${index}`,
      title: `Finding ${index}`,
    }));
    const context = buildChatContext({
      profile,
      currentTab: "medical",
      filters: DEFAULT_FILTERS,
      visibleEntries: entries,
      selectedEntry: entries[4],
    });

    expect(context.findings).toHaveLength(MAX_CHAT_CONTEXT_FINDINGS);
    expect(context.findings[0].id).toBe("finding-4");
    expect(new Set(context.findings.map((finding) => finding.id)).size).toBe(context.findings.length);
  });

  it("keeps current findings before prior retrieved findings for follow-ups", () => {
    const profile = makeProfileMeta();
    const entries = makeStoredReportEntries(profile.id);
    const priorContext = buildChatContext({
      profile,
      currentTab: "ai",
      filters: DEFAULT_FILTERS,
      visibleEntries: [],
      selectedEntry: null,
      retrievedFindings: entries.slice(1, 3).map((entry) => ({
        ...buildChatContext({
          profile,
          currentTab: "medical",
          filters: DEFAULT_FILTERS,
          visibleEntries: [entry],
          selectedEntry: entry,
        }).findings[0],
      })),
    });
    const context = buildChatContext({
      profile,
      currentTab: "medical",
      filters: DEFAULT_FILTERS,
      visibleEntries: entries,
      selectedEntry: entries[0],
      retrievedFindings: priorContext.findings,
    });

    expect(context.findings[0].id).toBe(entries[0].id);
    expect(context.findings.map((finding) => finding.id)).toContain(entries[1].id);
    expect(new Set(context.findings.map((finding) => finding.id)).size).toBe(context.findings.length);
  });
});

describe("mergeChatFindings", () => {
  it("deduplicates and caps persisted chat findings", () => {
    const profile = makeProfileMeta();
    const template = buildChatContext({
      profile,
      currentTab: "medical",
      filters: DEFAULT_FILTERS,
      visibleEntries: makeStoredReportEntries(profile.id),
      selectedEntry: null,
    }).findings[0];
    const findings = Array.from({ length: MAX_CHAT_CONTEXT_FINDINGS + 3 }, (_, index) => ({
      ...template,
      id: index === 2 ? "finding-1" : `finding-${index}`,
    }));

    const merged = mergeChatFindings(findings);

    expect(merged).toHaveLength(MAX_CHAT_CONTEXT_FINDINGS);
    expect(merged.filter((finding) => finding.id === "finding-1")).toHaveLength(1);
  });
});

describe("extractChatFollowUps", () => {
  it("extracts hidden follow-up suggestions and strips the marker from assistant content", () => {
    const result = extractChatFollowUps([
      "Here is the answer.",
      '<!-- deana-follow-ups: [{"title":"Explain coverage","body":"What does coverage mean in this report?"},{"title":"Compare findings","body":"Compare the medical and drug findings in this report."}] -->',
    ].join("\n"));

    expect(result.content).toBe("Here is the answer.");
    expect(result.followUps).toEqual([
      { title: "Explain coverage", body: "What does coverage mean in this report?" },
      { title: "Compare findings", body: "Compare the medical and drug findings in this report." },
    ]);
  });

  it("hides malformed follow-up metadata without returning suggestions", () => {
    const result = extractChatFollowUps("Answer. <!-- deana-follow-ups: not-json -->");

    expect(result.content).toBe("Answer.");
    expect(result.followUps).toEqual([]);
  });
});

describe("normalizeChatFollowUps", () => {
  it("trims, deduplicates, and caps follow-up suggestions", () => {
    const result = normalizeChatFollowUps([
      { title: "  A useful follow-up title that is longer than the button limit  ", body: "  Explain the first finding.  " },
      { title: "Duplicate", body: "Explain the first finding." },
      { title: "Second", body: "Explain the second finding." },
      { title: "Third", body: "Explain the third finding." },
      { title: "Fourth", body: "Explain the fourth finding." },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      title: "A useful follow-up title that is longer than",
      body: "Explain the first finding.",
    });
    expect(result.map((followUp) => followUp.title)).toEqual([
      "A useful follow-up title that is longer than",
      "Second",
      "Third",
    ]);
  });
});

describe("buildGatewayProviderOptions", () => {
  it("does not send OpenAI reasoning options to non-reasoning OpenAI models", () => {
    expect(buildGatewayProviderOptions("openai/gpt-4o-mini")).not.toHaveProperty("openai");
  });

  it("keeps OpenAI reasoning options for reasoning models", () => {
    expect(buildGatewayProviderOptions(DEANA_MODELS.strongFallback)).toHaveProperty("openai.reasoningEffort", "low");
  });
});

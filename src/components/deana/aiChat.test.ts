import { describe, expect, it } from "vitest";
import { compactChatMessagesForRequest, generatingStatusDetail, searchMoreFollowUpFromTrace, traceFindingSummary, type SearchStatus } from "./aiChat";

describe("generatingStatusDetail", () => {
  it("uses a generic thinking label until report context search is requested", () => {
    expect(generatingStatusDetail({ status: "idle" })).toBe("Thinking…");
  });

  it("uses context-specific labels for report finding search states", () => {
    const readyStatus: SearchStatus = {
      status: "ready",
      trace: {
        searchedAt: "2026-05-01T12:00:00.000Z",
        scannedCategories: ["medical"],
        searchedTerms: ["factor v"],
        relatedTerms: [],
        resultCount: 3,
        returnedFindings: [],
        rationale: "Matched medical findings.",
      },
    };

    expect(generatingStatusDetail({ status: "searching" })).toBe("Searching saved report findings...");
    expect(generatingStatusDetail(readyStatus)).toBe("Interpreting 3 matched findings...");
    expect(generatingStatusDetail({ status: "error", message: "Search failed." })).toBe("Search failed.");
  });
});

describe("compactChatMessagesForRequest", () => {
  it("keeps only visible text and strips reasoning, tool outputs, and hidden follow-ups", () => {
    expect(compactChatMessagesForRequest([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Compare these findings" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "private model reasoning" },
          { type: "tool-searchReportFindings", state: "output-available", toolCallId: "tool-1", input: {}, output: { findings: [{ detail: "large finding payload" }] } },
          { type: "text", text: 'Here is the comparison.\n<!-- deana-follow-ups: [{"title":"Next","body":"Ask next"}] -->' },
        ],
      },
    ])).toEqual([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Compare these findings" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Here is the comparison." }],
      },
    ]);
  });
});

describe("traceFindingSummary", () => {
  it("shows interpreted findings and remaining local matches instead of the candidate window ratio", () => {
    expect(traceFindingSummary({
      searchedAt: "2026-05-01T12:00:00.000Z",
      scannedCategories: ["medical"],
      searchedTerms: ["factor v"],
      relatedTerms: [],
      resultCount: 18,
      sentCount: 18,
      candidateWindowCount: 180,
      remainingCandidateCount: 162,
      returnedFindings: [],
      rationale: "Matched medical findings.",
    }, 18)).toBe("18 findings interpreted · 162 remaining");
  });

  it("omits the remaining count when there are no more local matches in the window", () => {
    expect(traceFindingSummary({
      searchedAt: "2026-05-01T12:00:00.000Z",
      scannedCategories: ["traits"],
      searchedTerms: ["baldness"],
      relatedTerms: [],
      resultCount: 1,
      sentCount: 1,
      remainingCandidateCount: 0,
      returnedFindings: [],
      rationale: "Matched trait findings.",
    }, 1)).toBe("1 finding interpreted");
  });
});

describe("searchMoreFollowUpFromTrace", () => {
  it("builds the local search-more follow-up only when more findings remain", () => {
    expect(searchMoreFollowUpFromTrace({
      searchedAt: "2026-05-01T12:00:00.000Z",
      scannedCategories: ["medical"],
      searchedTerms: ["factor v"],
      relatedTerms: [],
      resultCount: 8,
      sentCount: 8,
      remainingCandidateCount: 12,
      returnedFindings: [],
      rationale: "Matched medical findings.",
      searchPlan: {
        query: "Factor V",
        categories: ["medical"],
        genes: [],
        rsids: [],
        topics: [],
        conditions: [],
        relatedTerms: [],
        evidence: [],
        rationale: "Find Factor V entries.",
      },
      retrievalCursor: {
        hasMore: true,
        nextOffset: 8,
        sentFindingIds: ["medical-1"],
      },
    })).toEqual({
      title: "Search more findings",
      body: "Show me more local findings for Factor V.",
    });

    expect(searchMoreFollowUpFromTrace({
      searchedAt: "2026-05-01T12:00:00.000Z",
      scannedCategories: ["traits"],
      searchedTerms: ["hair"],
      relatedTerms: [],
      resultCount: 1,
      returnedFindings: [],
      rationale: "Matched trait findings.",
      retrievalCursor: {
        hasMore: false,
        nextOffset: 1,
        sentFindingIds: ["traits-1"],
      },
    })).toBeNull();
  });
});

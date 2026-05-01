import { describe, expect, it } from "vitest";
import { generatingStatusDetail, type SearchStatus } from "./aiChat";

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

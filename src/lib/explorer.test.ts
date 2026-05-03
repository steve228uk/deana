import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, compareEntries, matchesEntryFilters } from "./explorer";
import { generateReport } from "./reportEngine";
import { makeParsedDnaFile } from "../test/fixtures";

describe("explorer filters", () => {
  const report = generateReport(makeParsedDnaFile());

  it("matches fuzzy search terms across finding text", () => {
    const apoe = report.entries.find((entry) => entry.id === "medical-apoe");

    expect(apoe).toBeDefined();
    expect(matchesEntryFilters(apoe!, { ...DEFAULT_FILTERS, q: "alzheimers" }, "medical")).toBe(true);
    expect(matchesEntryFilters(apoe!, { ...DEFAULT_FILTERS, q: "alzhemers" }, "medical")).toBe(true);
  });

  it("supports multi-select clinical significance filters", () => {
    const apoe = report.entries.find((entry) => entry.id === "medical-apoe");
    const factorV = report.entries.find((entry) => entry.id === "medical-factor-v");

    expect(apoe?.normalizedClinicalSignificance).toBe("risk-context");
    expect(factorV?.normalizedClinicalSignificance).toBe("risk-variant");
    expect(matchesEntryFilters(apoe!, { ...DEFAULT_FILTERS, significance: ["risk-context", "risk-variant"] }, "medical")).toBe(true);
    expect(matchesEntryFilters(factorV!, { ...DEFAULT_FILTERS, significance: ["risk-context"] }, "medical")).toBe(false);
  });

  it("uses rank as the default Explorer sort while preserving explicit sorts", () => {
    const base = report.entries.find((entry) => entry.id === "medical-factor-v")!;
    const strongerRank = {
      ...base,
      title: "B finding",
      sort: {
        ...base.sort,
        rank: 900,
        severity: 10,
        publications: 1,
        alphabetical: "b finding",
      },
    };
    const weakerRank = {
      ...base,
      title: "A finding",
      sort: {
        ...base.sort,
        rank: 500,
        severity: 99,
        publications: 50,
        alphabetical: "a finding",
      },
    };

    expect(compareEntries(strongerRank, weakerRank, DEFAULT_FILTERS.sort)).toBeLessThan(0);
    expect(compareEntries(strongerRank, weakerRank, "severity")).toBeGreaterThan(0);
    expect(compareEntries(strongerRank, weakerRank, "publications")).toBeGreaterThan(0);
    expect(compareEntries(strongerRank, weakerRank, "alphabetical")).toBeGreaterThan(0);
  });
});

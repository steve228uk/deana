import { describe, expect, it } from "vitest";
import { ensureCurrentProfile } from "./storage";
import { EVIDENCE_PACK_VERSION } from "./evidencePack";
import { generateReport, REPORT_VERSION } from "./reportEngine";
import { makeParsedDnaFile, makeSavedProfile } from "../test/fixtures";

describe("reportEngine", () => {
  it("produces normalized entries, tabs, and facets for explorer use", () => {
    const report = generateReport(makeParsedDnaFile());

    expect(report.reportVersion).toBe(REPORT_VERSION);
    expect(report.evidencePackVersion).toBe(EVIDENCE_PACK_VERSION);
    expect(report.entries.length).toBeGreaterThan(6);
    expect(report.tabs.map((tab) => tab.tab)).toEqual(["overview", "medical", "traits", "drug", "raw"]);
    expect(report.facets.sources).toContain("ClinVar");
    expect(report.facets.genes).toContain("APOE");
    expect(report.entries[0]).toMatchObject({
      id: expect.any(String),
      category: expect.any(String),
      sources: expect.any(Array),
      matchedMarkers: expect.any(Array),
      sort: expect.any(Object),
    });
  });

  it("regenerates legacy saved profiles to the current report version", () => {
    const legacyProfile = makeSavedProfile({
      reportVersion: 1,
      evidencePackVersion: "legacy-pack",
      report: {
        reportVersion: 1,
        evidencePackVersion: "legacy-pack",
        overview: {
          provider: "AncestryDNA",
          build: "GRCh37",
          markerCount: 1,
          parsedAt: new Date().toISOString(),
          coverageScore: 0,
          curatedMarkerMatches: 0,
          sourceMix: [],
          warnings: [],
          snpediaStatus: "idle",
          snpediaProcessedRsids: 0,
          snpediaTotalRsids: 1,
          snpediaMatchedFindings: 0,
          snpediaUnmatchedRsids: 0,
          snpediaFailedRsids: 0,
        },
        tabs: [],
        entries: [],
        facets: {
          sources: [],
          evidenceTiers: [],
          coverages: [],
          reputes: [],
          clinicalSignificances: [],
          genes: [],
          tags: [],
          conditions: [],
          publicationBuckets: [],
        },
      },
    });

    const migrated = ensureCurrentProfile(legacyProfile);

    expect(migrated.reportVersion).toBe(REPORT_VERSION);
    expect(migrated.evidencePackVersion).toBe(EVIDENCE_PACK_VERSION);
    expect(migrated.report.entries.length).toBeGreaterThan(0);
    expect(migrated.report.tabs.length).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import { ensureCurrentProfile } from "./storage";
import { EVIDENCE_PACK_VERSION } from "./evidencePack";
import { generateReport, REPORT_VERSION } from "./reportEngine";
import { makeParsedDnaFile, makeSavedProfile } from "../test/fixtures";
import type { EvidenceSupplement } from "../types";

describe("reportEngine", () => {
  it("produces normalized entries, tabs, and facets for explorer use", () => {
    const report = generateReport(makeParsedDnaFile());

    expect(report.reportVersion).toBe(REPORT_VERSION);
    expect(report.evidencePackVersion).toBe(EVIDENCE_PACK_VERSION);
    expect(report.entries.length).toBeGreaterThan(6);
    expect(report.tabs.map((tab) => tab.tab)).toEqual(["overview", "medical", "traits", "drug", "other", "raw"]);
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
          evidenceStatus: "idle",
          evidencePackVersion: "legacy-pack",
          evidenceProcessedRsids: 0,
          evidenceMatchedFindings: 0,
          localEvidenceRecordMatches: 0,
          localEvidenceEntryMatches: 0,
          localEvidenceMatchedRsids: 0,
          evidenceUnmatchedRsids: 1,
          evidenceFailedItems: 0,
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
    expect(migrated.report.tabs.length).toBe(6);
    expect(migrated.report.tabs.map((tab) => tab.tab)).toContain("other");
    expect(migrated.report.entries.every((entry) => entry.entryKind)).toBe(true);
  });

  it("tracks bulk local evidence separately from curated marker coverage", () => {
    const dna = makeParsedDnaFile();
    const supplement: EvidenceSupplement = {
      status: "complete",
      fetchedAt: "2026-04-25T00:00:00.000Z",
      attribution: "test",
      packVersion: EVIDENCE_PACK_VERSION,
      manifest: null,
      totalRsids: dna.markerCount,
      processedRsids: dna.markerCount,
      matchedRecords: [
        {
          record: {
            id: "gwas-rs762551-1",
            entryId: "local-trait-gwas-rs762551-1",
            sourceId: "gwas",
            role: "primary",
            category: "traits",
            subcategory: "association",
            markerIds: ["rs762551"],
            genes: ["CYP1A2"],
            title: "rs762551 caffeine association",
            url: "https://example.com/gwas",
            release: "test",
            evidenceLevel: "moderate",
            clinicalSignificance: "trait-association",
            repute: "not-set",
            pmids: ["123"],
            notes: ["test"],
          },
          matchedMarkers: [
            {
              rsid: "rs762551",
              genotype: "AC",
              chromosome: "15",
              position: 75041917,
              gene: "CYP1A2",
            },
          ],
        },
      ],
      unmatchedRsids: dna.markerCount - 1,
      failedItems: [],
      retries: 0,
    };

    const report = generateReport(dna, { evidence: supplement });
    const localEntry = report.entries.find((entry) => entry.id === "local-trait-gwas-rs762551-1");

    expect(localEntry?.entryKind).toBe("local-evidence");
    expect(report.overview.localEvidenceRecordMatches).toBe(1);
    expect(report.overview.localEvidenceEntryMatches).toBe(1);
    expect(report.overview.localEvidenceMatchedRsids).toBe(1);
    expect(report.tabs.find((tab) => tab.tab === "traits")?.count).toBeGreaterThan(4);
    expect(report.tabs.find((tab) => tab.tab === "other")?.count).toBe(1);
    expect(report.overview.curatedMarkerMatches).toBeGreaterThan(1);
  });
});

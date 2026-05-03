import { describe, expect, it } from "vitest";
import { ensureCurrentProfile } from "./storage";
import { EVIDENCE_PACK_VERSION, SOURCE_LIBRARY } from "./evidencePack";
import { buildCategoryFacets, buildFacets, generateReport, REPORT_VERSION } from "./reportEngine";
import { makeParsedDnaFile, makeSavedProfile } from "../test/fixtures";
import type { EvidenceSupplement } from "../types";

describe("reportEngine", () => {
  it("produces normalized entries, tabs, and facets for explorer use", () => {
    const report = generateReport(makeParsedDnaFile());

    expect(report.reportVersion).toBe(REPORT_VERSION);
    expect(report.evidencePackVersion).toBe(EVIDENCE_PACK_VERSION);
    expect(report.entries.length).toBeGreaterThan(6);
    expect(report.tabs.map((tab) => tab.tab)).toEqual(["overview", "medical", "traits", "drug"]);
    expect(report.facets.sources).toContain("ClinVar");
    expect(report.facets.genes).toContain("APOE");
    expect(report.facets.clinicalSignificanceLabels["risk-context"]).toBe("Risk context");
    expect(report.categoryFacets.medical.sources).toContain("ClinVar");
    expect(report.categoryFacets.medical.genes).toContain("APOE");
    expect(report.categoryFacets.drug.genes).not.toContain("APOE");
    expect(report.entries[0]).toMatchObject({
      id: expect.any(String),
      category: expect.any(String),
      outcome: expect.any(String),
      sources: expect.any(Array),
      matchedMarkers: expect.any(Array),
      sort: expect.objectContaining({
        rank: expect.any(Number),
      }),
    });
  });

  it("regenerates legacy saved profiles to the current report version", () => {
    const emptyFacets = buildFacets([]);
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
        },
        tabs: [],
        entries: [],
        facets: emptyFacets,
        categoryFacets: buildCategoryFacets([]),
      },
    });

    const migrated = ensureCurrentProfile(legacyProfile);

    expect(migrated.reportVersion).toBe(REPORT_VERSION);
    expect(migrated.evidencePackVersion).toBe(EVIDENCE_PACK_VERSION);
    expect(migrated.report.entries.length).toBeGreaterThan(0);
    expect(migrated.report.tabs.length).toBe(4);
    expect(migrated.report.tabs.map((tab) => tab.tab)).not.toContain("other");
    expect(migrated.report.entries.every((entry) => entry.entryKind)).toBe(true);
    expect(migrated.report.entries.every((entry) => entry.outcome)).toBe(true);
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
    expect(report.tabs.find((tab) => tab.tab === "traits")?.count).toBeGreaterThan(4);
    expect(report.overview.curatedMarkerMatches).toBeGreaterThan(1);
  });

  it("falls back to the source library URL for curated evidence records without record URLs", () => {
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
            id: "curated-medical-apoe",
            entryId: "medical-apoe",
            sourceId: "clinvar",
            role: "primary",
            markerIds: ["rs429358", "rs7412"],
            genes: [],
            title: "APOE / Alzheimer's & cardiovascular risk",
            url: "",
            release: "Auto-generated from ClinVar/GWAS source data",
            evidenceLevel: "high",
            clinicalSignificance: null,
            clinvarReviewStatus: "reviewed by expert panel",
            clinvarStars: 3,
            pmids: ["30072576"],
            notes: ["test"],
          },
          matchedMarkers: [
            {
              rsid: "rs429358",
              genotype: "CT",
              chromosome: "19",
              position: 45411941,
              gene: "APOE",
            },
          ],
        },
      ],
      unmatchedRsids: dna.markerCount - 1,
      failedItems: [],
      retries: 0,
    };

    const report = generateReport(dna, { evidence: supplement });
    const apoe = report.entries.find((entry) => entry.id === "medical-apoe");

    expect(apoe?.sources).toContainEqual({
      id: "clinvar",
      name: "ClinVar",
      url: SOURCE_LIBRARY.clinvar.url,
    });
    expect(apoe?.clinvarReviewStatus).toBe("reviewed by expert panel");
    expect(apoe?.clinvarStars).toBe(3);
  });

  it("extracts legacy ClinGen classifications from local evidence titles", () => {
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
            id: "clingen-zmynd11-syndromic-complex-neurodevelopmental-disorder",
            entryId: "local-medical-clingen-zmynd11-syndromic-complex-neurodevelopmental-disorder",
            sourceId: "clingen",
            role: "primary",
            category: "medical",
            subcategory: "gene-disease-validity",
            markerIds: ["rs6025"],
            genes: ["ZMYND11"],
            title: "ZMYND11 / syndromic complex neurodevelopmental disorder (ClinGen Definitive)",
            url: "https://search.clinicalgenome.org/kb/gene-validity/test",
            release: "test",
            evidenceLevel: "high",
            clinicalSignificance: "pathogenic",
            repute: "bad",
            pmids: ["123", "456"],
            notes: [
              "ClinGen classification: Definitive.",
              "ClinGen classifications reflect published literature and expert panel review.",
            ],
          },
          matchedMarkers: [
            {
              rsid: "rs6025",
              genotype: "CT",
              chromosome: "1",
              position: 169519049,
              gene: "ZMYND11",
            },
          ],
        },
      ],
      unmatchedRsids: dna.markerCount - 1,
      failedItems: [],
      retries: 0,
    };

    const report = generateReport(dna, { evidence: supplement });
    const localEntry = report.entries.find((entry) =>
      entry.id === "local-medical-clingen-zmynd11-syndromic-complex-neurodevelopmental-disorder"
    );

    expect(localEntry?.title).toBe("ZMYND11 / syndromic complex neurodevelopmental disorder");
    expect(localEntry?.clingenClassification).toBe("Definitive");
  });

  it("keeps SNPedia repute and magnitude as structured report fields", () => {
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
            id: "snpedia-rs762551(a;c)",
            entryId: "local-traits-snpedia-rs762551-ac",
            sourceId: "snpedia",
            role: "supplementary",
            category: "traits",
            subcategory: "snpedia",
            markerIds: ["rs762551"],
            genes: ["CYP1A2"],
            title: "rs762551 caffeine context",
            technicalName: "Rs762551(A;C)",
            url: "https://bots.snpedia.com/index.php/Rs762551(A;C)",
            release: "SNPedia cached page export; page timestamp 2013-08-13T19:59:30Z",
            evidenceLevel: "supplementary",
            clinicalSignificance: null,
            repute: "bad",
            tone: "caution",
            genotype: "A;C",
            magnitude: 1.5,
            pmids: ["16905672"],
            notes: [
              "SNPedia genotype page: Rs762551(A;C).",
              "SNPedia magnitude: 1.5.",
              "SNPedia repute: bad.",
              "SNPedia is supplementary and should not be treated as a primary clinical source.",
            ],
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
    const localEntry = report.entries.find((entry) => entry.id === "local-traits-snpedia-rs762551-ac");

    expect(localEntry).toMatchObject({
      magnitude: 1.5,
      repute: "bad",
      sourceGenotype: "A;C",
    });
    expect(localEntry?.sourceNotes).toContain("SNPedia genotype page: Rs762551(A;C).");
    expect(localEntry?.sourceNotes).toContain("PubMed PMID 16905672");
    expect(localEntry?.sourceNotes).not.toContain("SNPedia magnitude: 1.5.");
    expect(localEntry?.sourceNotes).not.toContain("SNPedia repute: bad.");
  });

  it("demotes unresolved missing findings below actual elevated findings", () => {
    const dna = {
      ...makeParsedDnaFile(),
      markers: [
        ["rs7412", "19", 45412079, "CC"],
        ["rs6025", "1", 169519049, "CT"],
      ] as [string, string, number, string][],
      markerCount: 2,
    };
    const report = generateReport(dna);
    const apoe = report.entries.find((entry) => entry.id === "medical-apoe");
    const factorV = report.entries.find((entry) => entry.id === "medical-factor-v");

    expect(apoe?.outcome).toBe("missing");
    expect(factorV?.outcome).toBe("negative");
    expect(apoe?.sort.severity).toBeLessThan(factorV?.sort.severity ?? 0);
  });

  it("uses the first occurrence when the same rsID appears more than once", () => {
    const dna = {
      ...makeParsedDnaFile(),
      markers: [
        ["rs6025", "1", 169519049, "CT"],
        ["rs6025", "1", 169519049, "CC"],
      ] as [string, string, number, string][],
      markerCount: 2,
    };
    const report = generateReport(dna);
    const factorV = report.entries.find((entry) => entry.id === "medical-factor-v");
    expect(factorV?.summary).toContain("One Leiden allele");
  });

  it("interprets rs6025 CC (minus-strand homozygous reference) as no Leiden allele", () => {
    const dna = {
      ...makeParsedDnaFile(),
      markers: [["rs6025", "1", 169519049, "CC"]] as [string, string, number, string][],
      markerCount: 1,
    };
    const report = generateReport(dna);
    const factorV = report.entries.find((entry) => entry.id === "medical-factor-v");
    expect(factorV?.summary).toContain("No Leiden allele");
  });

  it("interprets rs6025 TT (minus-strand homozygous risk) as two Leiden alleles", () => {
    const dna = {
      ...makeParsedDnaFile(),
      markers: [["rs6025", "1", 169519049, "TT"]] as [string, string, number, string][],
      markerCount: 1,
    };
    const report = generateReport(dna);
    const factorV = report.entries.find((entry) => entry.id === "medical-factor-v");
    expect(factorV?.summary).toContain("Two Leiden alleles");
  });

  it("interprets rs1799963 CC (minus-strand reference) as no prothrombin risk", () => {
    const dna = {
      ...makeParsedDnaFile(),
      markers: [["rs1799963", "11", 46761055, "CC"]] as [string, string, number, string][],
      markerCount: 1,
    };
    const report = generateReport(dna);
    const prothrombin = report.entries.find((entry) => entry.id === "medical-prothrombin");
    expect(prothrombin?.summary).toContain("No risk allele");
    expect(prothrombin?.tone).toBe("good");
  });

  it("interprets rs1799963 CT (minus-strand heterozygous) as one prothrombin risk allele", () => {
    const dna = {
      ...makeParsedDnaFile(),
      markers: [["rs1799963", "11", 46761055, "CT"]] as [string, string, number, string][],
      markerCount: 1,
    };
    const report = generateReport(dna);
    const prothrombin = report.entries.find((entry) => entry.id === "medical-prothrombin");
    expect(prothrombin?.summary).toContain("One risk allele");
  });
});

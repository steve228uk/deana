import { describe, expect, it } from "vitest";
import { clingenCandidateMarkersForDisease, clingenDiseaseWordsOverlap, clinvarRecord } from "./buildEvidencePack";

function clinvarRow(overrides: Record<string, string>): Record<string, string> {
  return {
    "RS# (dbSNP)": "137853281",
    Type: "single nucleotide variant",
    Name: "NM_000053.4(ATP7B):c.3402del (p.Ala1135fs)",
    GeneSymbol: "ATP7B",
    ClinicalSignificance: "Pathogenic",
    ReviewStatus: "criteria provided, multiple submitters, no conflicts",
    PhenotypeList: "Wilson disease",
    Assembly: "GRCh37",
    Chromosome: "13",
    ChromosomeAccession: "NC_000013.10",
    VariationID: "88958",
    ReferenceAlleleVCF: "C",
    AlternateAlleleVCF: "T",
    ...overrides,
  };
}

describe("clingenDiseaseWordsOverlap", () => {
  it("matches when a condition contains a key disease word", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Hereditary breast and ovarian cancer syndrome"],
      "Hereditary breast and ovarian cancer",
    )).toBe(true);
  });

  it("matches when disease and condition share words in different order", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Cardiomyopathy, dilated, 1A"],
      "Dilated cardiomyopathy",
    )).toBe(true);
  });

  it("does not match when conditions are for a clearly different disease", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Fanconi anemia, complementation group D2"],
      "Hereditary breast and ovarian cancer",
    )).toBe(false);
  });

  it("returns false for an empty conditions array", () => {
    expect(clingenDiseaseWordsOverlap([], "Hereditary breast and ovarian cancer")).toBe(false);
  });

  it("ignores stop words when matching", () => {
    // "and" is a stop word and should not cause a spurious match
    expect(clingenDiseaseWordsOverlap(
      ["Type 2 diabetes and insulin resistance"],
      "and",
    )).toBe(false);
  });

  it("matches partial disease name overlap", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Long QT syndrome 1"],
      "Long QT syndrome",
    )).toBe(true);
  });

  it("does not match short words under 3 characters", () => {
    expect(clingenDiseaseWordsOverlap(
      ["QT disorder"],
      "QT",
    )).toBe(false);
  });

  it("matches across multiple conditions in the array", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Unrelated condition", "Breast cancer susceptibility"],
      "Hereditary breast and ovarian cancer",
    )).toBe(true);
  });
});

describe("clingenCandidateMarkersForDisease", () => {
  it("uses disease-overlapping condition-bearing candidates", () => {
    expect(clingenCandidateMarkersForDisease([
      { rsid: "rs1", riskAllele: "A", conditions: ["Fanconi anemia"] },
      { rsid: "rs2", riskAllele: "T", conditions: ["Breast cancer susceptibility"] },
      { rsid: "rs3", riskAllele: "G", conditions: [] },
    ], "Hereditary breast and ovarian cancer")).toEqual([
      { rsid: "rs2", riskAllele: "T", conditions: ["Breast cancer susceptibility"] },
    ]);
  });

  it("does not fall back to conditionless markers when condition-bearing candidates mismatch", () => {
    expect(clingenCandidateMarkersForDisease([
      { rsid: "rs1", riskAllele: "A", conditions: ["Fanconi anemia"] },
      { rsid: "rs2", riskAllele: "T", conditions: [] },
    ], "Hereditary breast and ovarian cancer")).toEqual([]);
  });

  it("falls back to conditionless markers only when no candidates have conditions", () => {
    expect(clingenCandidateMarkersForDisease([
      { rsid: "rs1", riskAllele: "A", conditions: [] },
      { rsid: "rs2", riskAllele: "T", conditions: [] },
    ], "Hereditary breast and ovarian cancer")).toEqual([
      { rsid: "rs1", riskAllele: "A", conditions: [] },
      { rsid: "rs2", riskAllele: "T", conditions: [] },
    ]);
  });
});

describe("clinvarRecord", () => {
  it("does not treat a VCF deletion anchor base as the risk allele", () => {
    const record = clinvarRecord(clinvarRow({
      Type: "Deletion",
      ReferenceAlleleVCF: "CG",
      AlternateAlleleVCF: "C",
    }), new Map());

    expect(record).toMatchObject({
      id: "clinvar-88958-rs137853281",
      riskAllele: undefined,
      riskAllelesByBuild: undefined,
      variantConstraintsByBuild: {
        GRCh37: {
          type: "deletion",
          ref: "CG",
          alt: "C",
          matchAllele: "D",
        },
      },
    });
    expect(record?.notes).toContain("Reported deletion: CG>C.");
  });

  it("keeps ordinary ClinVar SNV records constrained to their alternate allele", () => {
    const record = clinvarRecord(clinvarRow({
      Type: "single nucleotide variant",
      ReferenceAlleleVCF: "C",
      AlternateAlleleVCF: "T",
    }), new Map());

    expect(record).toMatchObject({
      riskAllele: "T",
      riskAllelesByBuild: {
        GRCh37: "T",
      },
      variantConstraintsByBuild: undefined,
    });
    expect(record?.notes).toContain("Reported alternate allele: T.");
  });
});

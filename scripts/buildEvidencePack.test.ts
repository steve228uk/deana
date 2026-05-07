import { describe, expect, it } from "vitest";
import {
  clingenCandidateMarkersForDisease,
  clingenDiseaseWordsOverlap,
  clinvarRecord,
  gwasDedupeKey,
  gwasKnownAlleleIndexFromRows,
  gwasRecords,
} from "./buildEvidencePack";

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

function gwasRow(overrides: Record<string, string>): Record<string, string> {
  return {
    PUBMEDID: "12345678",
    "FIRST AUTHOR": "Curator A",
    DATE: "2026-01-01",
    JOURNAL: "Example Journal",
    LINK: "www.ncbi.nlm.nih.gov/pubmed/12345678",
    "DISEASE/TRAIT": "Example trait",
    "MAPPED_TRAIT": "Example trait",
    "INITIAL SAMPLE SIZE": "1,000 cases, 1,000 controls",
    "REPLICATION SAMPLE SIZE": "500 cases, 500 controls",
    "MAPPED_GENE": "GENE",
    "STRONGEST SNP-RISK ALLELE": "rs123-A",
    SNPS: "rs123",
    "SNP_ID_CURRENT": "123",
    "RISK ALLELE FREQUENCY": "0.1",
    "P-VALUE": "1E-9",
    "OR or BETA": "1.4",
    "95% CI (TEXT)": "[1.2-1.6]",
    "STUDY ACCESSION": "GCST000001",
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

describe("gwasRecords", () => {
  it("skips GWAS rows whose risk allele is unknown and has no override", () => {
    const records = gwasRecords(gwasRow({
      "STRONGEST SNP-RISK ALLELE": "rs123-?",
      SNPS: "rs123",
    }), 1, new Map());

    expect(records).toEqual([]);
  });

  it("uses structured PMID allele resolutions for unknown GWAS alleles", () => {
    const resolvedAlleles = new Map([
      ["32386320|rs55705857", {
        pmid: "32386320",
        rsid: "rs55705857",
        riskAllele: "G",
        sourceType: "pmc-table",
        sourceUrl: "https://example.com/pmc.xml",
        sourceLabel: "PMID 32386320 supplementary table",
        confidence: "structured-table",
      }],
    ]);
    const records = gwasRecords(gwasRow({
      PUBMEDID: "32386320",
      "DISEASE/TRAIT": "Adult diffuse glioma (IDH mutation, 1p/19q codeletion)",
      "MAPPED_TRAIT": "Adult diffuse glioma (IDH mutation, 1p/19q codeletion)",
      "STRONGEST SNP-RISK ALLELE": "rs55705857-?",
      SNPS: "rs55705857",
      "SNP_ID_CURRENT": "55705857",
      "OR or BETA": "10.508",
    }), 136069, new Map(), resolvedAlleles);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "gwas-rs55705857-136069",
      riskAllele: "G",
      summary: "GWAS Catalog links rs55705857-G with Adult diffuse glioma (IDH mutation, 1p/19q codeletion).",
      conditions: ["Adult diffuse glioma (IDH mutation, 1p/19q codeletion)"],
    });
    expect(records[0].notes).toContain(
      "Risk allele resolved from structured PMID evidence: PMID 32386320 supplementary table.",
    );
  });

  it("infers unknown GWAS alleles from compatible catalog rows for the same rsID", () => {
    const knownAlleles = gwasKnownAlleleIndexFromRows([
      gwasRow({
        PUBMEDID: "28346443",
        "MAPPED_TRAIT": "Glioma",
        "STRONGEST SNP-RISK ALLELE": "rs55705857-G",
        SNPS: "rs55705857",
        "OR or BETA": "1.99",
      }),
      gwasRow({
        PUBMEDID: "29743610",
        "MAPPED_TRAIT": "Non-glioblastoma glioma",
        "STRONGEST SNP-RISK ALLELE": "rs55705857-G",
        SNPS: "rs55705857",
        "OR or BETA": "2.66",
      }),
      gwasRow({
        PUBMEDID: "36800424",
        "MAPPED_TRAIT": "Node-level brain connectivity (multivariate analysis)",
        "STRONGEST SNP-RISK ALLELE": "rs55705857-A",
        SNPS: "rs55705857",
        "OR or BETA": "6.85",
        "95% CI (TEXT)": "z score increase",
      }),
    ]);

    const records = gwasRecords(gwasRow({
      PUBMEDID: "32386320",
      "DISEASE/TRAIT": "Adult diffuse glioma (IDH mutation, 1p/19q codeletion)",
      "MAPPED_TRAIT": "Adult diffuse glioma (IDH mutation, 1p/19q codeletion)",
      "STRONGEST SNP-RISK ALLELE": "rs55705857-?",
      SNPS: "rs55705857",
      "SNP_ID_CURRENT": "55705857",
      "OR or BETA": "10.508",
      "95% CI (TEXT)": "NR z score increase",
    }), 136069, new Map(), new Map(), knownAlleles);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      riskAllele: "G",
      summary: "GWAS Catalog links rs55705857-G with Adult diffuse glioma (IDH mutation, 1p/19q codeletion).",
      conditions: ["Adult diffuse glioma (IDH mutation, 1p/19q codeletion)"],
    });
    expect(records[0].notes.some((note) =>
      note.includes("Risk allele inferred from 2 compatible GWAS Catalog rows for rs55705857"),
    )).toBe(true);
  });

  it("does not infer unknown GWAS alleles when compatible catalog rows conflict", () => {
    const knownAlleles = gwasKnownAlleleIndexFromRows([
      gwasRow({
        PUBMEDID: "11111111",
        "MAPPED_TRAIT": "Glioma",
        "STRONGEST SNP-RISK ALLELE": "rs55705857-G",
        SNPS: "rs55705857",
        "OR or BETA": "1.99",
      }),
      gwasRow({
        PUBMEDID: "22222222",
        "MAPPED_TRAIT": "Glioma susceptibility",
        "STRONGEST SNP-RISK ALLELE": "rs55705857-A",
        SNPS: "rs55705857",
        "OR or BETA": "1.40",
      }),
    ]);

    const records = gwasRecords(gwasRow({
      "MAPPED_TRAIT": "Adult diffuse glioma (IDH mutation)",
      "STRONGEST SNP-RISK ALLELE": "rs55705857-?",
      SNPS: "rs55705857",
      "OR or BETA": "10.508",
      "95% CI (TEXT)": "NR z score increase",
    }), 1, new Map(), new Map(), knownAlleles);

    expect(records).toEqual([]);
  });

  it("preserves comma-containing mapped traits as one condition", () => {
    const records = gwasRecords(gwasRow({
      "MAPPED_TRAIT": "Adult diffuse glioma (IDH mutation, 1p/19q non-codeleted)",
    }), 1, new Map());

    expect(records[0].conditions).toEqual(["Adult diffuse glioma (IDH mutation, 1p/19q non-codeleted)"]);
  });

  it("uses the full trait when deduping GWAS records", () => {
    const codeleted = gwasRecords(gwasRow({
      "MAPPED_TRAIT": "Adult diffuse glioma (IDH mutation, 1p/19q codeletion)",
    }), 1, new Map())[0];
    const nonCodeleted = gwasRecords(gwasRow({
      "MAPPED_TRAIT": "Adult diffuse glioma (IDH mutation, 1p/19q non-codeleted)",
    }), 2, new Map())[0];

    expect(gwasDedupeKey(codeleted)).not.toBe(gwasDedupeKey(nonCodeleted));
  });

  it("assigns multi-rsID strongest alleles only to exact matching rsIDs", () => {
    const records = gwasRecords(gwasRow({
      "STRONGEST SNP-RISK ALLELE": "rs123-A; rs456-G",
      SNPS: "rs123; rs456; rs789",
    }), 1, new Map());

    expect(records.map((record) => [record.markerIds[0], record.riskAllele])).toEqual([
      ["rs123", "A"],
      ["rs456", "G"],
    ]);
  });
});
